import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { installSkill } from '../src/commands/install.js'
import { listCommand, outdatedCommand } from '../src/commands/list.js'
import { isManagedPath, uninstallCommand } from '../src/commands/uninstall.js'
import { updateCommand } from '../src/commands/update.js'
import { ApiClient } from '../src/api.js'
import { loginCommand } from '../src/commands/auth.js'
import { CliError } from '../src/errors.js'
import { Manifest } from '../src/manifest.js'
import { authProvider, loadCredentials } from '../src/auth.js'
import { loadConfig, normalizeServer } from '../src/config.js'
import { FakeServer, makeContext, makeZip, type TestEnv } from './helpers.js'

const server = new FakeServer()
beforeAll(() => server.start())
afterAll(() => server.stop())

let env: TestEnv
beforeEach(async () => {
  server.skills.clear()
  server.installs = []
  server.requests = []
  server.states.clear()
  server.failReport = false
  server.badChecksum = false
  server.add({
    id: 5,
    name: 'Báo cáo tuần',
    latest: '1.1.0',
    versions: {
      '1.0.0': makeZip({ 'SKILL.md': '# v1' }),
      '1.1.0': makeZip({ 'SKILL.md': '# v2', 'scripts/run.sh': 'echo' }),
    },
  })
  env = await makeContext(server)
})

describe('install', () => {
  it('cài toàn cục: giải nén, ghi manifest, báo máy chủ', async () => {
    await installSkill(env.ctx, { id: 5, target: 'claude-code' })
    const dir = join(env.home, '.claude/skills/bao-cao-tuan')
    expect(await readFile(join(dir, 'SKILL.md'), 'utf8')).toBe('# v2')
    expect(await readdir(join(env.home, '.claude/skills'))).toEqual(['bao-cao-tuan']) // không để thư mục tạm
    expect(server.installs).toEqual([{ skill_id: 5, version: '1.1.0', target: 'claude-code' }])
    const manifest = await Manifest.load(env.ctx.dir)
    expect(manifest.items).toMatchObject([{ skill_id: 5, version: '1.1.0', target: 'claude-code', scope: 'global', path: dir }])
  })

  it('cài theo dự án và cursor, đúng thư mục', async () => {
    await installSkill(env.ctx, { id: 5, target: 'cursor', project: true, version: '1.0.0' })
    expect(await readFile(join(env.cwd, '.cursor/skills/bao-cao-tuan/SKILL.md'), 'utf8')).toBe('# v1')
    expect(env.ctx.manifest.items[0]).toMatchObject({ scope: 'project', target: 'cursor', version: '1.0.0' })
  })

  it('gửi thông tin đăng nhập và X-Client-Version tới máy chủ', async () => {
    await installSkill(env.ctx, { id: 5, target: 'claude-code' })
    const req = server.requests.find((r) => r.path.startsWith('/api/skills/5'))!
    expect(req.headers.authorization).toBe('Bearer TEST')
    expect(req.headers['x-client-version']).toBe('cli/0.0.0-test')
  })

  it('cài lại thay thế nguyên tử và không để file cũ', async () => {
    await installSkill(env.ctx, { id: 5, target: 'claude-code', version: '1.1.0' })
    await installSkill(env.ctx, { id: 5, target: 'claude-code', version: '1.0.0' })
    const dir = join(env.home, '.claude/skills/bao-cao-tuan')
    expect(await readdir(dir)).toEqual(['SKILL.md']) // scripts/ của bản 1.1.0 đã biến mất
    expect(env.ctx.manifest.items).toHaveLength(1)
    expect(env.ctx.manifest.items[0].version).toBe('1.0.0')
    expect(await readdir(join(env.home, '.claude/skills'))).toEqual(['bao-cao-tuan'])
  })

  it('không ghi đè thư mục lạ nếu thiếu --force', async () => {
    const dir = join(env.home, '.claude/skills/bao-cao-tuan')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'mine.txt'), 'của tôi')
    await expect(installSkill(env.ctx, { id: 5, target: 'claude-code' })).rejects.toThrow(/--force/)
    expect(await readFile(join(dir, 'mine.txt'), 'utf8')).toBe('của tôi')
    await installSkill(env.ctx, { id: 5, target: 'claude-code', force: true })
    expect(await readdir(dir)).toContain('SKILL.md')
  })

  it('checksum sai thì dừng và không để lại gì', async () => {
    server.badChecksum = true
    await expect(installSkill(env.ctx, { id: 5, target: 'claude-code' })).rejects.toThrow(/checksum/)
    await expect(readdir(join(env.home, '.claude/skills'))).rejects.toThrow()
    expect(env.ctx.manifest.items).toHaveLength(0)
    expect(server.installs).toHaveLength(0)
  })

  it('phiên bản bị thu hồi và skill không tồn tại cho thông báo dễ hiểu', async () => {
    server.skills.get(5)!.revoked = ['1.0.0']
    await expect(installSkill(env.ctx, { id: 5, target: 'claude-code', version: '1.0.0' })).rejects.toThrow(/đã bị thu hồi/)
    await expect(installSkill(env.ctx, { id: 99, target: 'claude-code' })).rejects.toThrow(/Không tìm thấy skill 99/)
    await expect(installSkill(env.ctx, { id: 5, target: 'claude-code', version: '9.9.9' })).rejects.toThrow(/chưa có phiên bản 9\.9\.9/)
  })

  it('báo máy chủ lỗi thì vẫn cài và cảnh báo', async () => {
    server.failReport = true
    await installSkill(env.ctx, { id: 5, target: 'claude-code' })
    expect(env.warns.join('\n')).toMatch(/chưa báo được về máy chủ/)
    expect(env.ctx.manifest.items).toHaveLength(1)
  })

  it('--target zip tải file về thư mục chỉ định và không ghi manifest', async () => {
    await installSkill(env.ctx, { id: 5, target: 'zip', out: join(env.root, 'downloads') })
    expect(await readdir(join(env.root, 'downloads'))).toEqual(['bao-cao-tuan-1.1.0.zip'])
    expect(env.ctx.manifest.items).toHaveLength(0)
    const dl = server.requests.find((r) => r.path.includes('/download'))!
    expect(dl.path).toContain('intent=zip')
  })
})

describe('list / outdated / update', () => {
  beforeEach(async () => {
    await installSkill(env.ctx, { id: 5, target: 'claude-code', version: '1.0.0' })
    env.logs.length = 0
  })

  it('list hiện trạng thái từ máy chủ', async () => {
    await listCommand(env.ctx)
    expect(env.logs[0]).toMatch(/Báo cáo tuần\s+1\.0\.0 → 1\.1\.0.*có bản mới/)
  })

  it('list offline vẫn hiện manifest và cảnh báo', async () => {
    const offline = { ...env.ctx, api: new ApiClient('http://127.0.0.1:1', null, 't') }
    await listCommand(offline)
    expect(env.logs[0]).toMatch(/Báo cáo tuần\s+1\.0\.0/)
    expect(env.warns.join('')).toMatch(/Không kết nối được máy chủ/)
  })

  it('outdated chỉ liệt kê, không đổi gì trên máy', async () => {
    const code = await outdatedCommand(env.ctx)
    expect(code).toBe(0)
    expect(env.logs.join('\n')).toMatch(/skillmkt update 5/)
    expect(env.ctx.manifest.items[0].version).toBe('1.0.0')
  })

  it('update chỉ cập nhật skill có bản mới và giữ nguyên thư mục', async () => {
    const before = env.ctx.manifest.items[0].path
    await updateCommand(env.ctx)
    const after = (await Manifest.load(env.ctx.dir)).items[0]
    expect(after.version).toBe('1.1.0')
    expect(after.path).toBe(before)
    expect(await readFile(join(before, 'SKILL.md'), 'utf8')).toBe('# v2')
    env.logs.length = 0
    await updateCommand(env.ctx)
    expect(env.logs).toEqual(['Không có skill nào cần cập nhật.'])
  })

  it('bản thu hồi được cập nhật; skill đã gỡ chỉ cảnh báo, không tự xoá', async () => {
    server.states.set('5@1.0.0', 'revoked')
    await updateCommand(env.ctx, 5)
    expect(env.ctx.manifest.items[0].version).toBe('1.1.0')

    server.states.set('5@1.1.0', 'removed')
    env.warns.length = 0
    await updateCommand(env.ctx)
    expect(env.warns.join('\n')).toMatch(/skillmkt uninstall 5/)
    expect(await readFile(join(env.ctx.manifest.items[0].path, 'SKILL.md'), 'utf8')).toBe('# v2')
  })

  it('update một skill chưa cài báo lỗi rõ', async () => {
    await expect(updateCommand(env.ctx, 77)).rejects.toThrow(/chưa được cài/)
  })
})

describe('uninstall', () => {
  it('xoá thư mục, manifest và báo máy chủ', async () => {
    await installSkill(env.ctx, { id: 5, target: 'claude-code' })
    const path = env.ctx.manifest.items[0].path
    await uninstallCommand(env.ctx, 5)
    await expect(readdir(path)).rejects.toThrow()
    expect(env.ctx.manifest.items).toHaveLength(0)
    expect((await Manifest.load(env.ctx.dir)).items).toHaveLength(0)
    expect(server.requests.some((r) => r.method === 'DELETE' && r.path.startsWith('/api/installs/5?target=claude-code'))).toBe(true)
  })

  it('từ chối xoá đường dẫn ngoài thư mục skills của công cụ', async () => {
    const victim = join(env.root, 'important')
    await mkdir(victim, { recursive: true })
    env.ctx.manifest.upsert({
      skill_id: 5, name: 'x', version: '1', target: 'claude-code', scope: 'global',
      path: victim, installed_at: '', checksum: null,
    })
    await expect(uninstallCommand(env.ctx, 5)).rejects.toBeInstanceOf(CliError)
    expect(await readdir(victim)).toEqual([])
  })

  it('isManagedPath', () => {
    expect(isManagedPath('/h/.claude/skills/x')).toBe(true)
    expect(isManagedPath('/h/.cursor/skills/x')).toBe(true)
    expect(isManagedPath('/h/Documents/x')).toBe(false)
    expect(isManagedPath('/h/.claude/skills')).toBe(false)
  })

  it('skill chưa cài thì báo lỗi', async () => {
    await expect(uninstallCommand(env.ctx, 5)).rejects.toThrow(/chưa được cài/)
  })
})

describe('api client', () => {
  it('401 hướng dẫn đăng nhập lại', async () => {
    const api = new ApiClient(server.origin, null, 't', async () => new Response('{}', { status: 401 }))
    await expect(api.me()).rejects.toThrow(/skillmkt login/)
  })

  it('không gửi thông tin đăng nhập tới máy chủ khác', async () => {
    const seen: Headers[] = []
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      seen.push(new Headers(init.headers))
      return new Response(new Uint8Array([1]))
    }) as unknown as typeof fetch
    const api = new ApiClient('https://marketplace.example.com', { headers: async () => ({ Authorization: 'Bearer SECRET' }) }, 't', fetchImpl)
    await api.bytes('/pkg/1.zip')
    await api.bytes('https://blob.example.net/sas?sig=1')
    expect(seen[0].get('authorization')).toBe('Bearer SECRET')
    expect(seen[1].get('authorization')).toBeNull()
  })

  it('lỗi mạng cho thông báo dễ hiểu', async () => {
    const api = new ApiClient('http://127.0.0.1:1', null, 't')
    await expect(api.me()).rejects.toThrow(/Không kết nối được máy chủ/)
  })
})

describe('config và đăng nhập thử', () => {
  it('normalizeServer', () => {
    expect(normalizeServer('https://m.example.com/')).toBe('https://m.example.com')
    expect(normalizeServer('http://localhost:8000/base/')).toBe('http://localhost:8000/base')
    expect(() => normalizeServer('ftp://x')).toThrow()
    expect(() => normalizeServer('không phải url')).toThrow()
  })

  it('login --dev lưu cookie và các request sau gửi cookie + CSRF', async () => {
    const logs: string[] = []
    await loginCommand(env.ctx.dir, { server: server.origin, dev: true, email: 'dev@example.com', role: 'user' }, {
      log: (m) => logs.push(m), clientVersion: 't',
    })
    expect(logs[0]).toMatch(/dev@example.com/)
    const creds = await loadCredentials(env.ctx.dir)
    expect(creds).toMatchObject({ mode: 'session', session: 'SESS123', csrf: 'CSRF456' })
    const config = await loadConfig(env.ctx.dir, {})
    expect(config.server).toBe(server.origin)

    const auth = await authProvider(env.ctx.dir, config)
    const api = new ApiClient(server.origin, auth, 't')
    server.requests = []
    await api.reportInstall(5, '1.0.0', 'cursor')
    const post = server.requests.find((r) => r.method === 'POST')!
    expect(post.headers.cookie).toContain('skillmkt_session=SESS123')
    expect(post.headers['x-csrf-token']).toBe('CSRF456')
    await api.me()
    expect(server.requests.at(-1)!.headers['x-csrf-token']).toBeUndefined() // GET không cần CSRF
  })
})
