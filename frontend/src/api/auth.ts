import { api } from './client'
import type { Me, Role } from './types'

export const fetchMe = () => api<Me>('/api/auth/me', { skipUnauthorizedHandler: true })

export const logout = () => api('/api/auth/logout', { method: 'POST' })

export const devLogin = (body: { email: string; role: Role; department?: string; display_name?: string }) =>
  api<Me>('/api/auth/dev-login', { method: 'POST', json: body, skipUnauthorizedHandler: true })

/** Đăng nhập SSO: điều hướng cả trang, không dùng fetch (mục 8, "Đăng nhập trong SPA"). */
export const ssoLoginUrl = (next: string) => `/api/auth/login?next=${encodeURIComponent(next)}`
