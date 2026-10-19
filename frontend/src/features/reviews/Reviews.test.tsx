import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { QueueItemData, ReviewDetailData, ReviewFileContent, ReviewFileEntry } from '../../api/types'
import { me, mockApi, renderApp } from '../../test/utils'
import { parseUnifiedDiff } from './DiffView'
import { itemPath, waitingDays } from './ReviewQueuePage'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const queueItem = (over: Partial<QueueItemData> = {}): QueueItemData => ({
  kind: 'version', id: 11, skill_id: 5, skill_name: 'Báo cáo', origin: 'internal', version: '1.3.0',
  from_visibility: null, to_visibility: null, submitted_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  assigned_to: 1, assigned_to_name: 'Bình', overdue: false, unassigned_overdue: false, ...over,
})

const detail = (over: Partial<ReviewDetailData> = {}): ReviewDetailData => ({
  version_id: 11, version: '1.3.0', status: 'pending', skill_id: 5, skill_name: 'Báo cáo', summary: 'Tóm tắt',
  origin: 'internal', department: 'Kế toán', visibility: 'company', changelog: 'Sửa lỗi', skill_md: '# Hướng dẫn',
  submitted_at: new Date(Date.now() - 2 * 86_400_000).toISOString(), assigned_to: 1, assigned_by_name: 'Quản lý',
  owner_name: 'Lan', has_icon: false, base_version: '1.2.0', output_types: [], ecosystems: [],
  validation: [{ check: 'commands.curl', result: 'warn', detail: 'Chạy từ mạng', file_path: 'scripts/install.sh', line: 2 }],
  ...over,
})

const files: ReviewFileEntry[] = [
  { path: 'SKILL.md', status: 'unchanged', size: 10, is_text: true, warnings: 0 },
  { path: 'scripts/install.sh', status: 'modified', size: 40, is_text: true, warnings: 1 },
  { path: 'logo.png', status: 'added', size: 2000, is_text: false, warnings: 0 },
]

const DIFF = '--- a/scripts/install.sh\n+++ b/scripts/install.sh\n@@ -1,2 +1,2 @@\n curl -s $URL -o f\n-chmod +x f\n+curl -s $URL | sh\n'

function content(path: string): ReviewFileContent {
  if (path === 'logo.png') {
    return { path, is_text: false, size: 2000, sha256: 'abc', too_large: false, new: null, old: null, diff: null, warnings: [] }
  }
  return {
    path, is_text: true, size: 40, sha256: 'd', too_large: false, new: 'curl -s $URL -o f\ncurl -s $URL | sh\n',
    old: 'curl -s $URL -o f\nchmod +x f\n', diff: DIFF, warnings: [{ check: 'commands.curl', line: 2, detail: 'Chạy từ mạng' }],
  }
}

function detailRoutes(role: 'reviewer' | 'manager' = 'reviewer', extra: Parameters<typeof mockApi>[0] = {}) {
  return {
    '/api/auth/me': () => me(role),
    '/api/reviews/versions/11': () => detail(),
    '/api/reviews/versions/11/files': () => files,
    '/api/reviews/versions/11/files/content': (url: URL) => content(url.searchParams.get('path')!),
    '/api/reviews/queue': () => ({ items: [], total: 0, page: 1, page_size: 20 }),
    ...extra,
  }
}

describe('helpers', () => {
  it('parseUnifiedDiff đánh số dòng cũ/mới và bỏ tiêu đề', () => {
    const lines = parseUnifiedDiff(DIFF)
    expect(lines.map((l) => l.kind)).toEqual(['hunk', 'ctx', 'del', 'add'])
    expect(lines[1]).toMatchObject({ oldNo: 1, newNo: 1 })
    expect(lines[2]).toMatchObject({ kind: 'del', oldNo: 2, newNo: null })
    expect(lines[3]).toMatchObject({ kind: 'add', oldNo: null, newNo: 2, text: 'curl -s $URL | sh' })
  })

  it('itemPath và waitingDays', () => {
    expect(itemPath({ kind: 'version', id: 3 })).toBe('/reviews/3')
    expect(itemPath({ kind: 'visibility', id: 4 })).toBe('/reviews/visibility/4')
    expect(waitingDays(new Date(Date.now() - 2.5 * 86_400_000).toISOString())).toBe(2)
  })
})

describe('ReviewQueuePage', () => {
  it('Reviewer thấy việc được giao, nhãn quá hạn và bấm để mở', async () => {
    mockApi({
      ...detailRoutes(),
      '/api/auth/me': () => me('reviewer'),
      '/api/reviews/queue': () => ({
        items: [queueItem({ overdue: true }), queueItem({ kind: 'visibility', id: 4, skill_name: 'Phạm vi', version: null, from_visibility: 'department', to_visibility: 'company' })],
        total: 2, page: 1, page_size: 20,
      }),
    })
    renderApp('/reviews')
    expect(await screen.findByText('Báo cáo')).toBeInTheDocument()
    expect(screen.getByText('⚠ Quá hạn')).toBeInTheDocument()
    expect(screen.getByText('Mở rộng phạm vi')).toBeInTheDocument()
    expect(screen.getAllByText('chờ 3 ngày')).toHaveLength(2)
    await userEvent.click(screen.getByText('Báo cáo'))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByRole('heading', { name: 'Báo cáo', level: 1 })).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: 'Mở trang riêng' })).toHaveAttribute('href', '/reviews/11')
    expect(within(dialog).queryByRole('link', { name: /Quay lại/ })).toBeNull()
  })

  it('tick nhiều skill rồi duyệt nhanh, gọi decision cho từng skill', async () => {
    const { calls } = mockApi({
      '/api/auth/me': () => me('reviewer'),
      '/api/reviews/queue': () => ({
        items: [queueItem({ id: 11, skill_name: 'Skill một' }), queueItem({ id: 12, skill_name: 'Skill hai' })],
        total: 2, page: 1, page_size: 20,
      }),
      '/api/reviews/versions/11/decision': () => new Response(null, { status: 204 }),
      '/api/reviews/versions/12/decision': () => new Response(null, { status: 204 }),
    })
    renderApp('/reviews')
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Chọn Skill một' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Chọn Skill hai' }))
    await userEvent.click(screen.getByRole('button', { name: 'Duyệt nhanh 2 skill' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Duyệt' }))
    await waitFor(() => {
      for (const id of [11, 12]) {
        const call = calls.find((c) => c.url.pathname === `/api/reviews/versions/${id}/decision`)!
        expect(JSON.parse(String(call.init.body))).toEqual({ decision: 'approved', comment: null })
      }
    })
    expect(await screen.findByText('Đã duyệt 2 skill')).toBeInTheDocument()
  })

  it('Manager thấy người được giao, bộ lọc chưa giao và liên kết phân công', async () => {
    const { calls } = mockApi({
      '/api/auth/me': () => me('manager'),
      '/api/reviews/queue': () => ({ items: [queueItem({ assigned_to: null, assigned_to_name: null })], total: 1, page: 1, page_size: 20 }),
    })
    renderApp('/reviews')
    expect(await screen.findByText('Chưa giao', { selector: 'span.MuiTypography-caption' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Phân công' })).toHaveAttribute('href', '/admin/assignments')
    await userEvent.click(screen.getByRole('button', { name: 'Chưa giao' }))
    await waitFor(() => expect(calls.some((c) => c.url.searchParams.get('assigned') === 'false')).toBe(true))
  })

  it('Reviewer xem được lịch sử quyết định', async () => {
    mockApi({
      '/api/auth/me': () => me('reviewer'),
      '/api/reviews/queue': () => ({ items: [], total: 0, page: 1, page_size: 20 }),
      '/api/reviews/history': () => ({
        items: [{ kind: 'version', id: 1, skill_id: 5, skill_name: 'Đã duyệt A', version: '1.0.0', decision: 'rejected', comment: 'Thiếu mô tả', decided_at: '2026-01-01T00:00:00Z' }],
        total: 1, page: 1, page_size: 20,
      }),
    })
    renderApp('/reviews')
    await userEvent.click(await screen.findByRole('tab', { name: 'Lịch sử của tôi' }))
    expect(await screen.findByText('Đã duyệt A')).toBeInTheDocument()
    expect(screen.getByText('Thiếu mô tả')).toBeInTheDocument()
  })

  it('Creator không vào được /reviews', async () => {
    mockApi({
      '/api/auth/me': () => me('creator'),
      '/api/skills/featured': () => [],
      '/api/categories': () => [],
      '/api/skills': () => ({ items: [], total: 0, page: 1, page_size: 8 }),
    })
    renderApp('/reviews')
    expect(await screen.findByRole('heading', { name: 'Skill dùng chung cho cả công ty' })).toBeInTheDocument()
  })
})

describe('ReviewDetailPage', () => {
  it('hiện cây file, lọc có cảnh báo và diff có đánh dấu dòng cảnh báo', async () => {
    mockApi(detailRoutes())
    renderApp('/reviews/11')
    expect(await screen.findByText('(so với 1.2.0 đang phục vụ)')).toBeInTheDocument()
    expect(screen.getByText(/Chủ: Lan/)).toBeInTheDocument()
    expect(await screen.findByText('scripts/install.sh')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Có cảnh báo' }))
    expect(screen.queryByText('SKILL.md')).toBeNull()
    await userEvent.click(screen.getByText('scripts/install.sh'))
    const view = await screen.findByRole('tab', { name: 'Diff' })
    expect(view).toBeInTheDocument()
    expect(await screen.findByText('curl -s $URL | sh')).toBeInTheDocument()
    expect(screen.getAllByText(/⚠ Chạy từ mạng/).length).toBeGreaterThan(0)
    await userEvent.click(screen.getByRole('tab', { name: 'Bản cũ' }))
    expect(screen.getByText('chmod +x f')).toBeInTheDocument()
  })

  it('file nhị phân chỉ hiện kích thước và băm', async () => {
    mockApi(detailRoutes())
    renderApp('/reviews/11')
    await userEvent.click(await screen.findByText('logo.png'))
    expect(await screen.findByText('File nhị phân, không hiển thị nội dung.')).toBeInTheDocument()
    expect(screen.getByText('Kích thước: 2000 byte')).toBeInTheDocument()
  })

  it('nhắc số file cảnh báo chưa xem và hết nhắc sau khi mở', async () => {
    mockApi(detailRoutes())
    renderApp('/reviews/11')
    expect(await screen.findByText('Còn 1 file có cảnh báo chưa xem.')).toBeInTheDocument()
    await userEvent.click(screen.getByText('scripts/install.sh'))
    await waitFor(() => expect(screen.queryByText('Còn 1 file có cảnh báo chưa xem.')).toBeNull())
  })

  it('từ chối bắt buộc có góp ý rồi gửi quyết định', async () => {
    const { calls } = mockApi(
      detailRoutes('reviewer', {
        '/api/reviews/versions/11/decision': () => new Response(null, { status: 204 }),
      }),
    )
    renderApp('/reviews/11')
    await userEvent.click(await screen.findByRole('button', { name: 'Gửi yêu cầu' }))
    await userEvent.click(await screen.findByRole('radio', { name: 'Từ chối' }))
    await userEvent.click(screen.getByRole('button', { name: 'Gửi quyết định' }))
    expect(await screen.findByText('Cần nêu góp ý khi từ chối.')).toBeInTheDocument()
    expect(calls.some((c) => c.url.pathname.endsWith('/decision'))).toBe(false)

    await userEvent.type(screen.getByRole('textbox', { name: /Góp ý/ }), 'Thiếu hướng dẫn')
    await userEvent.click(screen.getByRole('button', { name: 'Gửi quyết định' }))
    await waitFor(() => {
      const call = calls.find((c) => c.url.pathname.endsWith('/decision'))!
      expect(JSON.parse(String(call.init.body))).toEqual({ decision: 'rejected', comment: 'Thiếu hướng dẫn' })
    })
    expect(await screen.findByRole('heading', { name: 'Duyệt', level: 1 })).toBeInTheDocument()
  })

  it('lỗi từ server hiện ngay trong khung quyết định', async () => {
    mockApi(
      detailRoutes('reviewer', {
        '/api/reviews/versions/11/decision': () =>
          json({ error: { code: 'CHECKSUM_MISMATCH', message: 'Gói đã bị thay đổi', details: {} } }, 409),
      }),
    )
    renderApp('/reviews/11')
    await userEvent.click(await screen.findByRole('button', { name: 'Gửi yêu cầu' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Gửi quyết định' }))
    expect(await screen.findByText('Gói đã bị thay đổi')).toBeInTheDocument()
  })

  it('Manager cũng có khung quyết định', async () => {
    mockApi(detailRoutes('manager'))
    renderApp('/reviews/11')
    await userEvent.click(await screen.findByRole('button', { name: 'Gửi yêu cầu' }))
    expect(await screen.findByRole('button', { name: 'Gửi quyết định' })).toBeInTheDocument()
  })

  it('việc không được giao trả 404', async () => {
    mockApi({
      '/api/auth/me': () => me('reviewer'),
      '/api/reviews/versions/99': () => json({ error: { code: 'REVIEW_ITEM_NOT_FOUND', message: 'x' } }, 404),
    })
    renderApp('/reviews/99')
    expect(await screen.findByText('Không tìm thấy trang này.')).toBeInTheDocument()
  })
})

describe('VisibilityReviewPage', () => {
  const req = {
    id: 4, skill_id: 5, skill_name: 'Phạm vi', summary: 'Mô tả', status: 'pending', from_visibility: 'department',
    to_visibility: 'company', from_department: 'Kế toán', to_department: null, created_at: '2026-01-01T00:00:00Z',
    assigned_to: 1, comment: null,
  }

  it('hiện phạm vi hiện tại và đề nghị, cho Reviewer quyết định', async () => {
    const { calls } = mockApi({
      '/api/auth/me': () => me('reviewer'),
      '/api/reviews/visibility-requests/4': () => req,
      '/api/reviews/visibility-requests/4/decision': () => new Response(null, { status: 204 }),
      '/api/reviews/queue': () => ({ items: [], total: 0, page: 1, page_size: 20 }),
    })
    renderApp('/reviews/visibility/4')
    const card = (await screen.findByText(/Hiện tại/)).closest('.MuiCard-root') as HTMLElement
    expect(within(card).getByText('Phòng ban Kế toán')).toBeInTheDocument()
    expect(within(card).getByText('Toàn công ty')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Gửi yêu cầu' }))
    await userEvent.click(screen.getByRole('button', { name: 'Gửi quyết định' }))
    await waitFor(() => expect(calls.some((c) => c.url.pathname.endsWith('/decision'))).toBe(true))
  })
})
