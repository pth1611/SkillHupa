import { ApiError, CliError } from './errors.js'

export interface AuthProvider {
  /** Header xác thực cho một request (Bearer của Entra, hoặc cookie phiên khi dev). */
  headers(method: string): Promise<Record<string, string>>
}

export interface CheckResult {
  skill_id: number
  version: string
  latest_version: string | null
  state: 'up_to_date' | 'update_available' | 'revoked' | 'removed' | 'no_access'
}

export interface SkillInfo {
  id: number
  name: string
  status: string
  latest_version: { version: string } | null
}

export interface DownloadInfo {
  url: string
  version: string
  checksum: string | null
}

type Query = Record<string, string | number | undefined>

export class ApiClient {
  constructor(
    private readonly server: string,
    private readonly auth: AuthProvider | null,
    private readonly clientVersion: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private url(path: string, query?: Query): string {
    const url = new URL(this.server + path)
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v))
    return url.toString()
  }

  private async headers(method: string, target: string): Promise<Record<string, string>> {
    const base: Record<string, string> = { 'X-Client-Version': `cli/${this.clientVersion}`, Accept: 'application/json' }
    // Chỉ gửi thông tin đăng nhập tới đúng máy chủ đã cấu hình (không rò sang URL khác).
    if (this.auth && new URL(target).origin === new URL(this.server).origin) {
      Object.assign(base, await this.auth.headers(method))
    }
    return base
  }

  private async send(method: string, target: string, body?: unknown): Promise<Response> {
    const headers = await this.headers(method, target)
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    try {
      return await this.fetchImpl(target, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
      })
    } catch {
      throw new CliError(`Không kết nối được máy chủ ${this.server}. Kiểm tra mạng hoặc địa chỉ máy chủ.`)
    }
  }

  private async fail(response: Response): Promise<never> {
    let code = 'HTTP_ERROR'
    let message = response.statusText
    let details: Record<string, unknown> = {}
    try {
      const body = (await response.json()) as { error?: { code?: string; message?: string; details?: Record<string, unknown> } }
      code = body.error?.code ?? code
      message = body.error?.message ?? message
      details = body.error?.details ?? {}
    } catch {
      /* thân phản hồi không phải JSON */
    }
    if (response.status === 401) {
      throw new CliError('Chưa đăng nhập hoặc phiên đã hết hạn. Chạy: skillmkt login')
    }
    throw new ApiError(response.status, code, message, details)
  }

  async json<T = void>(method: string, path: string, opts: { query?: Query; body?: unknown } = {}): Promise<T> {
    const response = await this.send(method, this.url(path, opts.query), opts.body)
    if (!response.ok) await this.fail(response)
    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }

  /** Tải gói; `url` có thể là đường dẫn tương đối của backend hoặc URL tuyệt đối (SAS). */
  async bytes(url: string): Promise<Uint8Array> {
    const target = new URL(url, this.server + '/').toString()
    const response = await this.send('GET', target)
    if (!response.ok) await this.fail(response)
    return new Uint8Array(await response.arrayBuffer())
  }

  getSkill = (id: number) => this.json<SkillInfo>('GET', `/api/skills/${id}`)
  download = (id: number, version: string, intent: 'install' | 'zip') =>
    this.json<DownloadInfo>('GET', `/api/skills/${id}/download`, { query: { version, intent } })
  reportInstall = (skillId: number, version: string, target: string) =>
    this.json('POST', '/api/installs', { body: { skill_id: skillId, version, target } })
  reportUninstall = (skillId: number, target: string) =>
    this.json('DELETE', `/api/installs/${skillId}`, { query: { target } })
  check = (items: { skill_id: number; version: string }[]) =>
    this.json<CheckResult[]>('POST', '/api/installs/check', { body: { items } })
  me = () => this.json<{ id: number; email: string; display_name: string; role: string }>('GET', '/api/auth/me')
}
