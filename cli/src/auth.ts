import { credentialsPath } from './paths.js'
import { readJson, writeJson } from './store.js'
import type { AuthProvider } from './api.js'
import type { Config } from './config.js'
import { CliError } from './errors.js'

interface BearerCredentials {
  mode: 'bearer'
  msal_cache: string
  home_account_id: string
  username: string
}

interface SessionCredentials {
  mode: 'session'
  session: string
  csrf: string
  username: string
}

export type Credentials = BearerCredentials | SessionCredentials

export const loadCredentials = (dir: string) => readJson<Credentials>(credentialsPath(dir))
export const saveCredentials = (dir: string, value: Credentials) => writeJson(credentialsPath(dir), value, 0o600)

export async function clearCredentials(dir: string): Promise<boolean> {
  const { rm } = await import('node:fs/promises')
  const existed = (await loadCredentials(dir)) !== null
  await rm(credentialsPath(dir), { force: true })
  return existed
}

/** Cookie phiên + CSRF (chỉ khi backend bật đăng nhập thử, dùng lúc phát triển). */
export class SessionAuth implements AuthProvider {
  constructor(private readonly creds: SessionCredentials) {}
  async headers(method: string): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      Cookie: `skillmkt_session=${this.creds.session}; skillmkt_csrf=${this.creds.csrf}`,
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) headers['X-CSRF-Token'] = this.creds.csrf
    return headers
  }
}

/** Access token của Entra lấy từ bộ nhớ đệm MSAL (làm mới âm thầm bằng refresh token). */
export class BearerAuth implements AuthProvider {
  constructor(
    private readonly dir: string,
    private readonly config: Config,
    private readonly creds: BearerCredentials,
  ) {}

  async headers(): Promise<Record<string, string>> {
    const { PublicClientApplication } = await import('@azure/msal-node')
    const app = new PublicClientApplication({
      auth: { clientId: this.config.client_id!, authority: `https://login.microsoftonline.com/${this.config.tenant_id}` },
    })
    app.getTokenCache().deserialize(this.creds.msal_cache)
    const account = await app.getTokenCache().getAccountByHomeId(this.creds.home_account_id)
    if (!account) throw new CliError('Phiên đăng nhập không còn hợp lệ. Chạy: skillmkt login')
    try {
      const result = await app.acquireTokenSilent({ account, scopes: [this.config.scope!] })
      await saveCredentials(this.dir, { ...this.creds, msal_cache: app.getTokenCache().serialize() })
      return { Authorization: `Bearer ${result.accessToken}` }
    } catch {
      throw new CliError('Phiên đăng nhập đã hết hạn. Chạy: skillmkt login')
    }
  }
}

export async function authProvider(dir: string, config: Config): Promise<AuthProvider | null> {
  const env = process.env.SKILLMKT_TOKEN
  if (env) return { headers: async () => ({ Authorization: `Bearer ${env}` }) } // CI hoặc kiểm thử
  const creds = await loadCredentials(dir)
  if (!creds) return null
  if (creds.mode === 'session') return new SessionAuth(creds)
  if (!config.client_id || !config.tenant_id || !config.scope) {
    throw new CliError('Thiếu cấu hình đăng nhập. Chạy lại: skillmkt login')
  }
  return new BearerAuth(dir, config, creds)
}

/** Đăng nhập device code (MSAL). `print` hiển thị hướng dẫn cho người dùng. */
export async function deviceCodeLogin(
  dir: string,
  config: Required<Pick<Config, 'tenant_id' | 'client_id' | 'scope'>>,
  print: (message: string) => void,
): Promise<string> {
  const { PublicClientApplication } = await import('@azure/msal-node')
  const app = new PublicClientApplication({
    auth: { clientId: config.client_id, authority: `https://login.microsoftonline.com/${config.tenant_id}` },
  })
  const result = await app.acquireTokenByDeviceCode({
    scopes: [config.scope],
    deviceCodeCallback: (response) => print(response.message),
  })
  if (!result?.account) throw new CliError('Đăng nhập không thành công.')
  await saveCredentials(dir, {
    mode: 'bearer',
    msal_cache: app.getTokenCache().serialize(),
    home_account_id: result.account.homeAccountId,
    username: result.account.username,
  })
  return result.account.username
}

/** Lấy cookie từ phản hồi dev-login. */
export function parseSessionCookies(setCookie: string[]): { session: string; csrf: string } | null {
  const pick = (name: string) => {
    for (const line of setCookie) {
      const match = line.match(new RegExp(`^${name}=([^;]+)`))
      if (match) return match[1]
    }
    return null
  }
  const session = pick('skillmkt_session')
  const csrf = pick('skillmkt_csrf')
  return session && csrf ? { session, csrf } : null
}
