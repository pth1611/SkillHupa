import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { AdminSkillItem, DashboardData, QueueItemData } from '../../api/types'
import { me, mockApi, renderApp } from '../../test/utils'
import { workloads } from './AssignmentsPage'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const dashboard = (over: Partial<DashboardData> = {}): DashboardData => ({
  unassigned: 4, unassigned_overdue: 1, review_overdue: 0, tags_pending: 3, visibility_requests_pending: 0,
  sources_with_problems: 0, overview: { skills_published: 86, versions_pending: 5 },
  recent_events: [{ action: 'skill.remove', target_type: 'skill', target_id: 9, actor_name: 'Quản lý', created_at: '2026-01-01T00:00:00Z', detail: { name: 'Skill X', reason: 'Vi phạm' } }],
  ...over,
})

const base = { '/api/auth/me': () => me('manager') }

describe('Dashboard', () => {
  it('hiện việc cần làm có liên kết lọc, sự kiện gần đây và tổng quan', async () => {
    mockApi({ ...base, '/api/admin/dashboard': () => dashboard() })
    renderApp('/admin')
    expect(await screen.findByText('Chưa giao người duyệt')).toBeInTheDocument()
    const tile = screen.getByText('Tag chờ duyệt').closest('a')!
    expect(tile).toHaveAttribute('href', '/admin/tags?status=pending')
    expect(screen.getByText('Chưa giao quá hạn').closest('a')).toHaveAttribute('href', '/admin/assignments?filter=unassigned&overdue=1')
    expect(screen.getByText('Gỡ skill')).toBeInTheDocument()
    expect(screen.getByText(/Skill X — Vi phạm/)).toBeInTheDocument()
    expect(screen.getByText('Skill đang đăng:')).toBeInTheDocument()
    expect(within(tile).getByText('3')).toBeInTheDocument()
  })

  it('thanh tab quản trị điều hướng và người không phải Manager bị chuyển đi', async () => {
    mockApi({ ...base, '/api/admin/dashboard': () => dashboard() })
    renderApp('/admin')
    expect(await screen.findByRole('tab', { name: 'Phân công' })).toHaveAttribute('href', '/admin/assignments')
  })
})

const item = (over: Partial<QueueItemData>): QueueItemData => ({
  kind: 'version', id: 1, skill_id: 5, skill_name: 'Skill A', origin: 'internal', version: '1.0.0',
  from_visibility: null, to_visibility: null, submitted_at: new Date(Date.now() - 86_400_000).toISOString(),
  assigned_to: null, assigned_to_name: null, overdue: false, unassigned_overdue: false, ...over,
})

const reviewers = {
  items: [
    { id: 21, email: 'b@x', display_name: 'Bình', role: 'reviewer', department: null },
    { id: 22, email: 'c@x', display_name: 'Chi', role: 'reviewer', department: null },
  ],
  total: 2, page: 1, page_size: 100,
}

describe('AssignmentsPage', () => {
  it('workloads đếm việc theo người được giao', () => {
    const map = workloads([item({ assigned_to: 21 }), item({ id: 2, assigned_to: 21 }), item({ id: 3 })])
    expect(map.get(21)).toBe(2)
    expect(map.has(22)).toBe(false)
  })

  it('hiện tải việc, đưa việc quá hạn lên đầu và giao việc', async () => {
    const { calls } = mockApi({
      ...base,
      '/api/reviews/queue': () => ({
        items: [
          item({ id: 1, skill_name: 'Bình thường' }),
          item({ id: 2, skill_name: 'Quá hạn', unassigned_overdue: true }),
          item({ id: 3, skill_name: 'Đã giao', assigned_to: 21, assigned_to_name: 'Bình' }),
        ],
        total: 3, page: 1, page_size: 100,
      }),
      '/api/users': () => reviewers,
      '/api/reviews/versions/2/assignment': () => new Response(null, { status: 204 }),
      '/api/admin/dashboard': () => dashboard(),
    })
    renderApp('/admin/assignments')
    expect(await screen.findByText('Bình: 1 việc')).toBeInTheDocument()
    expect(screen.getByText('Chi: 0 việc')).toBeInTheDocument()
    const names = screen.getAllByRole('link').map((l) => l.textContent).filter((n) => ['Bình thường', 'Quá hạn', 'Đã giao'].includes(n ?? ''))
    expect(names[0]).toBe('Quá hạn')

    const select = screen.getByRole('combobox', { name: 'Giao việc Quá hạn cho' })
    await userEvent.click(select)
    await userEvent.click(await screen.findByRole('option', { name: 'Chi (0)' }))
    await waitFor(() => {
      const call = calls.find((c) => c.url.pathname === '/api/reviews/versions/2/assignment')!
      expect(call.init.method).toBe('PUT')
      expect(JSON.parse(String(call.init.body))).toEqual({ reviewer_id: 22 })
    })
  })

  it('lọc chưa giao theo URL và bỏ giao gọi DELETE', async () => {
    const { calls } = mockApi({
      ...base,
      '/api/reviews/queue': () => ({
        items: [item({ id: 3, skill_name: 'Đã giao', assigned_to: 21, assigned_to_name: 'Bình' }), item({ id: 4, skill_name: 'Chưa giao' })],
        total: 2, page: 1, page_size: 100,
      }),
      '/api/users': () => reviewers,
      '/api/reviews/versions/3/assignment': () => new Response(null, { status: 204 }),
      '/api/admin/dashboard': () => dashboard(),
    })
    renderApp('/admin/assignments?filter=assigned')
    expect(await screen.findByText('Đã giao', { selector: 'a' })).toBeInTheDocument()
    expect(screen.queryByText('Chưa giao', { selector: 'a' })).toBeNull()
    await userEvent.click(screen.getByRole('combobox', { name: 'Giao việc Đã giao cho' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Chưa giao' }))
    await waitFor(() => expect(calls.some((c) => c.init.method === 'DELETE' && c.url.pathname === '/api/reviews/versions/3/assignment')).toBe(true))
  })
})

const skillItem = (over: Partial<AdminSkillItem>): AdminSkillItem => ({
  id: 5, name: 'Báo cáo', status: 'published', origin: 'internal', owner_id: 2, department: 'Kế toán',
  visibility: 'company', latest_version: '1.1.0', download_count: 3, install_count: 12,
  updated_at: '2026-01-01T00:00:00Z', ...over,
})

function skillsRoutes(extra: Parameters<typeof mockApi>[0] = {}) {
  return {
    ...base,
    '/api/admin/skills': () => ({
      items: [skillItem({}), skillItem({ id: 6, name: 'Đã gỡ', status: 'removed' })],
      total: 2, page: 1, page_size: 20,
    }),
    '/api/admin/dashboard': () => dashboard(),
    ...extra,
  }
}

describe('AdminSkillsPage', () => {
  it('hành động hợp lệ theo trạng thái skill', async () => {
    mockApi(skillsRoutes())
    renderApp('/admin/skills')
    const row = (await screen.findByText('Báo cáo', { selector: 'a' })).closest('li')!
    expect(within(row).getByRole('button', { name: 'Gỡ skill' })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Thu hồi phiên bản' })).toBeInTheDocument()
    const removed = screen.getByText('Đã gỡ', { selector: 'a' }).closest('li')!
    expect(within(removed).getByRole('button', { name: 'Khôi phục' })).toBeInTheDocument()
    expect(within(removed).queryByRole('button', { name: 'Gỡ skill' })).toBeNull()
  })

  it('gỡ skill: hiện tác động, bắt buộc lý do rồi gọi remove', async () => {
    const { calls } = mockApi(
      skillsRoutes({
        '/api/admin/skills/5/impact': () => ({ installed_users: 3, zip_users: 2, latest_after_revoke: null }),
        '/api/admin/skills/5/remove': () => json({ id: 5, status: 'removed', latest_version: '1.1.0', owner_id: 2 }),
      }),
    )
    renderApp('/admin/skills')
    const row = (await screen.findByText('Báo cáo', { selector: 'a' })).closest('li')!
    await userEvent.click(within(row).getByRole('button', { name: 'Gỡ skill' }))
    expect(await screen.findByText(/3 người đang cài \(CLI\) và 2 người đã tải \.zip/)).toBeInTheDocument()
    const dialog = screen.getByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: 'Gỡ skill' })
    expect(confirm).toBeDisabled()
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Lý do/ }), 'Vi phạm bản quyền')
    await userEvent.click(confirm)
    await waitFor(() => {
      const call = calls.find((c) => c.url.pathname === '/api/admin/skills/5/remove')!
      expect(JSON.parse(String(call.init.body))).toEqual({ reason: 'Vi phạm bản quyền' })
    })
    expect(await screen.findByText('Đã thực hiện.')).toBeInTheDocument()
  })

  it('từ 20 người cài phải gõ lại tên skill', async () => {
    mockApi(
      skillsRoutes({ '/api/admin/skills/5/impact': () => ({ installed_users: 25, zip_users: 0, latest_after_revoke: null }) }),
    )
    renderApp('/admin/skills')
    const row = (await screen.findByText('Báo cáo', { selector: 'a' })).closest('li')!
    await userEvent.click(within(row).getByRole('button', { name: 'Gỡ skill' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Lý do/ }), 'Lỗi')
    const confirm = within(dialog).getByRole('button', { name: 'Gỡ skill' })
    expect(confirm).toBeDisabled()
    await userEvent.type(await within(dialog).findByRole('textbox', { name: /Gõ lại tên skill/ }), 'Báo cáo')
    expect(confirm).toBeEnabled()
  })

  it('thu hồi: chọn phiên bản, thấy bản mới nhất sẽ quay về đâu', async () => {
    const { calls } = mockApi(
      skillsRoutes({
        '/api/skills/5/versions': () => [
          { id: 1, version: '1.0.0', status: 'published', changelog: null, checksum: null, size_bytes: 1, created_at: '2026-01-01T00:00:00Z', submitted_at: null },
          { id: 2, version: '1.1.0', status: 'published', changelog: null, checksum: null, size_bytes: 1, created_at: '2026-01-02T00:00:00Z', submitted_at: null },
        ],
        '/api/admin/skills/5/impact': () => ({ installed_users: 4, zip_users: 1, latest_after_revoke: '1.0.0' }),
        '/api/admin/skills/5/versions/1.1.0/revoke': () => json({ id: 5, status: 'published', latest_version: '1.0.0', owner_id: 2 }),
      }),
    )
    renderApp('/admin/skills')
    const row = (await screen.findByText('Báo cáo', { selector: 'a' })).closest('li')!
    await userEvent.click(within(row).getByRole('button', { name: 'Thu hồi phiên bản' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(await within(dialog).findByRole('combobox', { name: /Phiên bản cần thu hồi/ }))
    await userEvent.click(await screen.findByRole('option', { name: '1.1.0' }))
    expect(await within(dialog).findByText(/Bản mới nhất sẽ quay về 1\.0\.0/)).toBeInTheDocument()
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Lý do/ }), 'Có lỗi nghiêm trọng')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Thu hồi phiên bản' }))
    await waitFor(() => expect(calls.some((c) => c.url.pathname === '/api/admin/skills/5/versions/1.1.0/revoke')).toBe(true))
  })

  it('thu hồi bị chặn khi chỉ còn một phiên bản đang đăng', async () => {
    mockApi(
      skillsRoutes({
        '/api/skills/5/versions': () => [
          { id: 1, version: '1.0.0', status: 'published', changelog: null, checksum: null, size_bytes: 1, created_at: '2026-01-01T00:00:00Z', submitted_at: null },
        ],
      }),
    )
    renderApp('/admin/skills')
    const row = (await screen.findByText('Báo cáo', { selector: 'a' })).closest('li')!
    await userEvent.click(within(row).getByRole('button', { name: 'Thu hồi phiên bản' }))
    expect(await screen.findByText(/Hãy gỡ skill thay vì thu hồi/)).toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Thu hồi phiên bản' })).toBeDisabled()
  })

  it('chuyển quyền chọn Creator và gọi transfer', async () => {
    const { calls } = mockApi(
      skillsRoutes({
        '/api/users': () => ({
          items: [{ id: 31, email: 'lan@x', display_name: 'Lan Trần', role: 'creator', department: null }],
          total: 1, page: 1, page_size: 20,
        }),
        '/api/admin/skills/5/transfer': () => json({ id: 5, status: 'published', latest_version: '1.1.0', owner_id: 31 }),
      }),
    )
    renderApp('/admin/skills')
    const row = (await screen.findByText('Báo cáo', { selector: 'a' })).closest('li')!
    await userEvent.click(within(row).getByRole('button', { name: 'Chuyển quyền' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Chủ mới' }))
    await userEvent.click(await screen.findByRole('option', { name: /Lan Trần/ }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Chuyển quyền' }))
    await waitFor(() => {
      const call = calls.find((c) => c.url.pathname === '/api/admin/skills/5/transfer')!
      expect(JSON.parse(String(call.init.body))).toEqual({ new_owner_id: 31 })
    })
  })

  it('lọc theo trạng thái gửi đúng tham số', async () => {
    const { calls } = mockApi(skillsRoutes())
    renderApp('/admin/skills?status=removed&q=gỡ')
    await screen.findByText('Báo cáo', { selector: 'a' })
    const call = calls.find((c) => c.url.pathname === '/api/admin/skills')!
    expect(call.url.searchParams.get('status')).toBe('removed')
    expect(call.url.searchParams.get('q')).toBe('gỡ')
  })
})
