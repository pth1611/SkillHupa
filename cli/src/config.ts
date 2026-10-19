import { configPath } from './paths.js'
import { readJson, writeJson } from './store.js'

export interface Config {
  server?: string
  tenant_id?: string
  client_id?: string
  scope?: string
}

export async function loadConfig(dir: string, env: NodeJS.ProcessEnv = process.env): Promise<Config> {
  const stored = (await readJson<Config>(configPath(dir))) ?? {}
  return { ...stored, ...(env.SKILLMKT_SERVER ? { server: env.SKILLMKT_SERVER } : {}) }
}

export async function saveConfig(dir: string, patch: Config): Promise<void> {
  const current = (await readJson<Config>(configPath(dir))) ?? {}
  await writeJson(configPath(dir), { ...current, ...patch }, 0o644)
}

/** Chuẩn hoá địa chỉ máy chủ: chỉ http(s), bỏ dấu `/` cuối. */
export function normalizeServer(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`Địa chỉ máy chủ không hợp lệ: ${raw}`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Địa chỉ máy chủ phải là http(s)')
  return url.origin + url.pathname.replace(/\/+$/, '')
}
