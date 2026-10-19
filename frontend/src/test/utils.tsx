import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { AuthProvider } from '../auth/AuthProvider'
import { ColorModeProvider } from '../theme/ColorMode'
import { AppRoutes } from '../routes'
import type { Me, Role } from '../api/types'

export const me = (role: Role = 'user'): Me => ({
  id: 1,
  email: 'a@example.com',
  display_name: 'An Nguyễn',
  role,
  department: 'Kế toán',
  unread_notifications: 3,
})

type Handler = (url: URL, init: RequestInit) => unknown | Response

/** Thay fetch toàn cục bằng bảng định tuyến theo đường dẫn; trả JSON hoặc Response. */
export function mockApi(routes: Record<string, Handler>) {
  const calls: { url: URL; init: RequestInit }[] = []
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : (input as Request).url, 'http://localhost')
    calls.push({ url, init })
    const handler = routes[url.pathname]
    if (!handler) return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'x' } }), { status: 404 })
    const result = handler(url, init)
    if (result instanceof Response) return result
    return new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  return { calls, spy }
}

export const unauthorized = () =>
  new Response(JSON.stringify({ error: { code: 'NOT_AUTHENTICATED', message: 'x' } }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  })

export function renderApp(path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui: ReactElement = (
    <ColorModeProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </ColorModeProvider>
  )
  return render(ui)
}
