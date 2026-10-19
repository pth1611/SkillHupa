import { createHash } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { ApiClient, type AuthProvider } from '../src/api.js'
import type { Context } from '../src/context.js'
import { Manifest } from '../src/manifest.js'

export const SKILL_MD = '---\nname: Báo cáo tuần\ndescription: d\n---\n# Hướng dẫn\n'

export function makeZip(files: Record<string, string> = { 'SKILL.md': SKILL_MD }): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])))
}

export const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex')

export interface FakeSkill {
  id: number
  name: string
  status?: string
  versions: Record<string, Uint8Array>
  latest: string
  revoked?: string[]
}

export interface Recorded {
  method: string
  path: string
  headers: IncomingMessage['headers']
  body: string
}

export class FakeServer {
  skills = new Map<number, FakeSkill>()
  installs: { skill_id: number; version: string; target: string }[] = []
  requests: Recorded[] = []
  states = new Map<string, string>() // `${id}@${version}` -> state
  failReport = false
  badChecksum = false
  server!: Server
  origin = ''

  async start(): Promise<void> {
    this.server = createServer((req, res) => void this.handle(req, res))
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve))
    this.origin = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`
  }

  async stop(): Promise<void> {
    await new Promise((resolve) => this.server.close(resolve))
  }

  add(skill: FakeSkill) {
    this.skills.set(skill.id, skill)
  }

  private json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}) {
    res.writeHead(status, { 'content-type': 'application/json', ...headers })
    res.end(JSON.stringify(body))
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const body = Buffer.concat(chunks).toString('utf8')
    const url = new URL(req.url ?? '/', this.origin)
    this.requests.push({ method: req.method ?? 'GET', path: url.pathname + url.search, headers: req.headers, body })
    const err = (status: number, code: string, message = 'x') => this.json(res, status, { error: { code, message, details: {} } })

    if (url.pathname === '/api/auth/cli-config') {
      return this.json(res, 200, { tenant_id: '', client_id: '', scope: '', dev_login: true, sso_configured: false })
    }
    if (url.pathname === '/api/auth/dev-login' && req.method === 'POST') {
      return this.json(res, 200, { id: 1, email: 'dev@example.com', role: 'user' }, {
        'set-cookie': ['skillmkt_session=SESS123; Path=/; HttpOnly', 'skillmkt_csrf=CSRF456; Path=/'],
      })
    }
    if (url.pathname === '/api/auth/me') return this.json(res, 200, { id: 1, email: 'dev@example.com', display_name: 'Dev', role: 'user' })

    const pkg = url.pathname.match(/^\/pkg\/(\d+)\/(.+)\.zip$/)
    if (pkg) {
      const data = this.skills.get(Number(pkg[1]))?.versions[pkg[2]]
      if (!data) return err(404, 'VERSION_NOT_FOUND')
      res.writeHead(200, { 'content-type': 'application/zip' })
      return res.end(Buffer.from(data))
    }

    const skillMatch = url.pathname.match(/^\/api\/skills\/(\d+)(\/download)?$/)
    if (skillMatch) {
      const skill = this.skills.get(Number(skillMatch[1]))
      if (!skill) return err(404, 'SKILL_NOT_FOUND')
      if (!skillMatch[2]) return this.json(res, 200, { id: skill.id, name: skill.name, status: skill.status ?? 'published', latest_version: { version: skill.latest } })
      const wanted = url.searchParams.get('version') ?? 'latest'
      const version = wanted === 'latest' ? skill.latest : wanted
      if (skill.revoked?.includes(version)) return err(409, 'VERSION_NOT_DOWNLOADABLE')
      const data = skill.versions[version]
      if (!data) return err(404, 'VERSION_NOT_FOUND')
      return this.json(res, 200, {
        url: `/pkg/${skill.id}/${version}.zip`,
        version,
        checksum: this.badChecksum ? `sha256:${'0'.repeat(64)}` : `sha256:${sha(data)}`,
      })
    }

    if (url.pathname === '/api/installs' && req.method === 'POST') {
      if (this.failReport) return err(500, 'INTERNAL')
      this.installs.push(JSON.parse(body))
      return this.json(res, 200, {})
    }
    if (url.pathname === '/api/installs/check' && req.method === 'POST') {
      const items = (JSON.parse(body) as { items: { skill_id: number; version: string }[] }).items
      return this.json(res, 200, items.map((i) => {
        const skill = this.skills.get(i.skill_id)
        const state = this.states.get(`${i.skill_id}@${i.version}`) ?? (skill && skill.latest !== i.version ? 'update_available' : 'up_to_date')
        return { skill_id: i.skill_id, version: i.version, latest_version: skill?.latest ?? null, state }
      }))
    }
    const del = url.pathname.match(/^\/api\/installs\/(\d+)$/)
    if (del && req.method === 'DELETE') {
      res.writeHead(204)
      return res.end()
    }
    return err(404, 'NOT_FOUND')
  }
}

export interface TestEnv {
  ctx: Context
  logs: string[]
  warns: string[]
  root: string
  home: string
  cwd: string
}

export async function makeContext(
  server: FakeServer,
  auth: AuthProvider | null = { headers: async () => ({ Authorization: 'Bearer TEST' }) },
): Promise<TestEnv> {
  const root = await mkdtemp(join(tmpdir(), 'skillmkt-test-'))
  const dir = join(root, 'data')
  const home = join(root, 'home')
  const cwd = join(root, 'project')
  const logs: string[] = []
  const warns: string[] = []
  const ctx: Context = {
    dir,
    home,
    cwd,
    api: new ApiClient(server.origin, auth, '0.0.0-test'),
    manifest: await Manifest.load(dir),
    log: (m) => logs.push(m),
    warn: (m) => warns.push(m),
  }
  return { ctx, logs, warns, root, home, cwd }
}
