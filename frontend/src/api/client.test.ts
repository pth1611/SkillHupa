import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api, buildUrl, setUnauthorizedHandler } from './client'

function respond(status: number, body?: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
    }),
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  setUnauthorizedHandler(null)
  document.cookie = 'skillmkt_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
})

describe('buildUrl', () => {
  it('bỏ giá trị rỗng và lặp tham số mảng', () => {
    expect(buildUrl('/api/skills', { q: 'a b', tag: ['x', 'y'], category: undefined, sort: '' })).toBe(
      '/api/skills?q=a+b&tag=x&tag=y',
    )
    expect(buildUrl('/api/skills')).toBe('/api/skills')
  })
})

describe('api', () => {
  it('gắn CSRF cho ghi, không gắn cho GET', async () => {
    document.cookie = 'skillmkt_csrf=tok123; path=/'
    const spy = respond(204)
    await api('/api/x', { method: 'POST', json: { a: 1 } })
    await api('/api/y')
    const post = new Headers(spy.mock.calls[0][1]!.headers)
    const get = new Headers(spy.mock.calls[1][1]!.headers)
    expect(post.get('X-CSRF-Token')).toBe('tok123')
    expect(post.get('Content-Type')).toBe('application/json')
    expect(get.get('X-CSRF-Token')).toBeNull()
  })

  it('trả lỗi có mã và thông điệp của backend', async () => {
    respond(409, { error: { code: 'VERSION_ALREADY_EXISTS', message: 'Trùng', details: { v: '1.0.0' } } })
    await expect(api('/api/x')).rejects.toMatchObject({
      status: 409,
      code: 'VERSION_ALREADY_EXISTS',
      message: 'Trùng',
      details: { v: '1.0.0' },
    })
  })

  it('401 gọi handler đăng nhập lại, trừ khi bỏ qua', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    respond(401, { error: { code: 'NOT_AUTHENTICATED', message: 'x' } })
    await expect(api('/api/x')).rejects.toBeInstanceOf(ApiError)
    expect(handler).toHaveBeenCalledTimes(1)
    await expect(api('/api/auth/me', { skipUnauthorizedHandler: true })).rejects.toBeInstanceOf(ApiError)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('429 và lỗi mạng được gán mã riêng', async () => {
    respond(429, { error: { code: 'X', message: 'chậm lại' } })
    await expect(api('/api/x')).rejects.toMatchObject({ status: 429, code: 'RATE_LIMITED' })
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'))
    await expect(api('/api/x')).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' })
  })
})
