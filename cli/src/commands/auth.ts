import { ApiClient } from '../api.js'
import { clearCredentials, deviceCodeLogin, loadCredentials, parseSessionCookies, saveCredentials } from '../auth.js'
import { loadConfig, normalizeServer, saveConfig } from '../config.js'
import { CliError } from '../errors.js'

interface CliConfig {
  tenant_id: string
  client_id: string
  scope: string
  dev_login: boolean
}

export async function loginCommand(
  dir: string,
  opts: { server?: string; dev?: boolean; email?: string; role?: string; department?: string },
  io: { log: (m: string) => void; fetchImpl?: typeof fetch; clientVersion: string },
): Promise<void> {
  const stored = await loadConfig(dir)
  const raw = opts.server ?? stored.server
  if (!raw) throw new CliError('Chưa biết địa chỉ máy chủ. Chạy: skillmkt login --server https://<địa-chỉ>')
  const server = normalizeServer(raw)
  const fetchImpl = io.fetchImpl ?? fetch

  const api = new ApiClient(server, null, io.clientVersion, fetchImpl)
  const remote = await api.json<CliConfig>('GET', '/api/auth/cli-config')

  if (opts.dev) {
    if (!remote.dev_login) throw new CliError('Máy chủ không bật đăng nhập thử (DEV_LOGIN_ENABLED).')
    const response = await fetchImpl(`${server}/api/auth/dev-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Version': `cli/${io.clientVersion}` },
      body: JSON.stringify({ email: opts.email ?? 'dev@example.com', role: opts.role ?? 'user', department: opts.department }),
    })
    if (!response.ok) throw new CliError(`Đăng nhập thử không thành công (${response.status}).`)
    const cookies = parseSessionCookies(response.headers.getSetCookie())
    if (!cookies) throw new CliError('Máy chủ không trả cookie phiên.')
    const user = (await response.json()) as { email: string }
    await saveCredentials(dir, { mode: 'session', ...cookies, username: user.email })
    await saveConfig(dir, { server })
    io.log(`Đã đăng nhập thử với tên ${user.email}.`)
    return
  }

  if (!remote.tenant_id || !remote.client_id || !remote.scope) {
    throw new CliError('Máy chủ chưa cấu hình đăng nhập Entra ID cho CLI. Liên hệ quản trị viên.')
  }
  await saveConfig(dir, { server, tenant_id: remote.tenant_id, client_id: remote.client_id, scope: remote.scope })
  const username = await deviceCodeLogin(
    dir,
    { tenant_id: remote.tenant_id, client_id: remote.client_id, scope: remote.scope },
    io.log,
  )
  io.log(`Đã đăng nhập: ${username}`)
}

export async function logoutCommand(dir: string, log: (m: string) => void): Promise<void> {
  log((await clearCredentials(dir)) ? 'Đã đăng xuất.' : 'Bạn chưa đăng nhập.')
}

export async function whoamiCommand(dir: string, api: ApiClient, log: (m: string) => void): Promise<void> {
  const creds = await loadCredentials(dir)
  if (!creds && !process.env.SKILLMKT_TOKEN) throw new CliError('Chưa đăng nhập. Chạy: skillmkt login')
  const me = await api.me()
  log(`${me.display_name} <${me.email}> — vai trò: ${me.role}`)
}
