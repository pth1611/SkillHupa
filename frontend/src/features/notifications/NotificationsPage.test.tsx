import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { NotificationData } from '../../api/types'
import { me, mockApi, renderApp } from '../../test/utils'
import { internalLink } from './NotificationsPage'

const note = (over: Partial<NotificationData>): NotificationData => ({
  id: 1, type: 'review.approved', message: 'Skill A đã được duyệt', link: '/skills/5', is_read: false,
  created_at: '2026-01-01T00:00:00Z', ...over,
})

function setup(items: NotificationData[]) {
  return mockApi({
    '/api/auth/me': () => me(),
    '/api/notifications': (url: URL) => {
      const only = url.searchParams.get('unread') === 'true'
      const shown = only ? items.filter((n) => !n.is_read) : items
      return { items: shown, total: shown.length, page: 1, page_size: 20 }
    },
    '/api/notifications/1/read': () => new Response(null, { status: 204 }),
    '/api/notifications/read-all': () => new Response(null, { status: 204 }),
    '/api/skills/5': () => new Response('{}', { status: 404 }),
  })
}

describe('internalLink', () => {
  it('chỉ nhận đường dẫn nội bộ', () => {
    expect(internalLink('/skills/1')).toBe('/skills/1')
    expect(internalLink('//evil.example.com')).toBeNull()
    expect(internalLink('https://evil.example.com')).toBeNull()
    expect(internalLink(null)).toBeNull()
  })
})

describe('NotificationsPage', () => {
  it('liệt kê và lọc chưa đọc', async () => {
    const { calls } = setup([note({}), note({ id: 2, message: 'Đã đọc rồi', is_read: true })])
    renderApp('/notifications')
    expect(await screen.findByText('Skill A đã được duyệt')).toBeInTheDocument()
    expect(screen.getByText('Đã đọc rồi')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Chưa đọc' }))
    await waitFor(() => expect(screen.queryByText('Đã đọc rồi')).toBeNull())
    expect(calls.some((c) => c.url.searchParams.get('unread') === 'true')).toBe(true)
  })

  it('mở thông báo thì đánh dấu đã đọc và chuyển tới liên kết', async () => {
    const { calls } = setup([note({})])
    renderApp('/notifications')
    await userEvent.click(await screen.findByText('Skill A đã được duyệt'))
    await waitFor(() => expect(calls.some((c) => c.url.pathname === '/api/notifications/1/read')).toBe(true))
    expect(await screen.findByText('Không tìm thấy trang này.')).toBeInTheDocument() // đã tới /skills/5 (404 giả)
  })

  it('đánh dấu tất cả đã đọc', async () => {
    const { calls } = setup([note({})])
    renderApp('/notifications')
    await userEvent.click(await screen.findByRole('button', { name: 'Đánh dấu tất cả đã đọc' }))
    await waitFor(() => expect(calls.some((c) => c.url.pathname === '/api/notifications/read-all')).toBe(true))
  })

  it('trạng thái rỗng', async () => {
    setup([])
    renderApp('/notifications')
    expect(await screen.findByText('Chưa có thông báo nào.')).toBeInTheDocument()
  })
})
