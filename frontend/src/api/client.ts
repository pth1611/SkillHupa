// Client fetch dùng chung: cookie phiên, header CSRF, lỗi thống nhất (api.md mục 1).

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

const CSRF_COOKIE = 'skillmkt_csrf'
const CSRF_HEADER = 'X-CSRF-Token'
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

let onUnauthorized: (() => void) | null = null

/** AuthProvider đăng ký để chuyển về trang đăng nhập khi phiên hết hạn giữa chừng. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler
}

function readCookie(name: string): string {
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`))
  return match ? decodeURIComponent(match.slice(name.length + 1)) : ''
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  json?: unknown
  body?: BodyInit
  params?: Record<string, string | number | boolean | string[] | undefined | null>
  /** Không gọi handler 401 (dùng cho /api/auth/me, nơi 401 là kết quả bình thường). */
  skipUnauthorizedHandler?: boolean
}

export function buildUrl(path: string, params?: RequestOptions['params']): string {
  if (!params) return path
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) value.forEach((v) => qs.append(key, v))
    else qs.append(key, String(value))
  }
  const text = qs.toString()
  return text ? `${path}?${text}` : path
}

export async function api<T = void>(path: string, options: RequestOptions = {}): Promise<T> {
  const { json, params, skipUnauthorizedHandler, headers, ...init } = options
  const method = (init.method ?? 'GET').toUpperCase()
  const finalHeaders = new Headers(headers)
  finalHeaders.set('Accept', 'application/json')
  if (json !== undefined) finalHeaders.set('Content-Type', 'application/json')
  if (!SAFE_METHODS.has(method)) finalHeaders.set(CSRF_HEADER, readCookie(CSRF_COOKIE))

  let response: Response
  try {
    response = await fetch(buildUrl(path, params), {
      ...init,
      method,
      headers: finalHeaders,
      credentials: 'same-origin',
      body: json !== undefined ? JSON.stringify(json) : init.body,
    })
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Không kết nối được máy chủ')
  }

  if (response.ok) {
    if (response.status === 204) return undefined as T
    const type = response.headers.get('content-type') ?? ''
    return (type.includes('json') ? await response.json() : await response.text()) as T
  }

  let code = 'HTTP_ERROR'
  let message = response.statusText
  let details: Record<string, unknown> = {}
  try {
    const body = await response.json()
    if (body?.error) {
      code = body.error.code ?? code
      message = body.error.message ?? message
      details = body.error.details ?? {}
    }
  } catch {
    /* thân phản hồi không phải JSON */
  }
  if (response.status === 401 && !skipUnauthorizedHandler) onUnauthorized?.()
  if (response.status === 429) code = 'RATE_LIMITED'
  throw new ApiError(response.status, code, message, details)
}
