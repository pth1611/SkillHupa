import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminTagData, AuditItemData, ScanData, SourceData } from '../../api/types'
import { me, mockApi, renderApp } from '../../test/utils'
import { toIso } from './AuditPage'
import { CREDENTIAL_RE } from './SourcesPage'

vi.mock('../../utils/download', () => ({ startDownload: vi.fn(), saveTextFile: vi.fn() }))
import { saveTextFile } from '../../utils/download'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const base = { '/api/auth/me': () => me('manager'), '/api/admin/dashboard': () => ({}) }

afterEach(() => vi.clearAllMocks())

const tag = (over: Partial<AdminTagData>): AdminTagData => ({
  id: 1, name: 'excel', status: 'approved', usage_count: 2, proposed_by: null, decided_by: null, decided_at: null, ...over,
})

describe('TagsPage', () => {
  const tags = [
    tag({ id: 1, name: 'excel' }),
    tag({ id: 2, name: 'ex-cel', usage_count: 1 }),
    tag({ id: 3, name: 'chờ', status: 'pending', usage_count: 0 }),
  ]

  it('duyệt tag chờ, tạo tag và xóa tag không còn dùng', async () => {
    const { calls } = mockApi({
      ...base,
      '/api/admin/tags': (_u, init) =>
        init.method === 'POST' ? json(tag({ id: 9, name: 'mới' }), 201) : { items: tags, total: 3, page: 1, page_size: 50 },
      '/api/admin/tags/3/approve': () => json(tag({ id: 3, status: 'approved' })),
      '/api/admin/tags/3': () => new Response(null, { status: 204 }),
    })
    renderApp('/admin/tags')
    expect(await screen.findByText('chờ')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Duyệt' }))
    await waitFor(() => expect(calls.some((c) => c.url.pathname === '/api/admin/tags/3/approve')).toBe(true))

    await userEvent.type(screen.getByRole('textbox', { name: 'Tên tag mới' }), 'mới')
    await userEvent.click(screen.getByRole('button', { name: 'Tạo tag' }))
    await waitFor(() => {
      const post = calls.find((c) => c.url.pathname === '/api/admin/tags' && c.init.method === 'POST')!
      expect(JSON.parse(String(post.init.body))).toEqual({ name: 'mới' })
    })

    await userEvent.click(screen.getByRole('button', { name: 'Xóa' }))
    await waitFor(() => expect(calls.some((c) => c.init.method === 'DELETE' && c.url.pathname === '/api/admin/tags/3')).toBe(true))
  })

  it('từ chối cần lý do và cảnh báo số skill bị gỡ tag', async () => {
    const { calls } = mockApi({
      ...base,
      '/api/admin/tags': () => ({ items: [tag({ id: 3, name: 'chờ', status: 'pending', usage_count: 4 })], total: 1, page: 1, page_size: 50 }),
      '/api/admin/tags/3/reject': () => json(tag({ id: 3, status: 'rejected' })),
    })
    renderApp('/admin/tags')
    await userEvent.click(await screen.findByRole('button', { name: 'Từ chối' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Tag sẽ bị gỡ khỏi 4 skill đang gắn.')).toBeInTheDocument()
    const send = within(dialog).getByRole('button', { name: 'Từ chối' })
    expect(send).toBeDisabled()
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Lý do/ }), 'Trùng nghĩa')
    await userEvent.click(send)
    await waitFor(() => {
      const call = calls.find((c) => c.url.pathname === '/api/admin/tags/3/reject')!
      expect(JSON.parse(String(call.init.body))).toEqual({ reason: 'Trùng nghĩa' })
    })
  })

  it('gộp các tag đã chọn vào tag đích', async () => {
    const { calls } = mockApi({
      ...base,
      '/api/admin/tags': () => ({ items: tags, total: 3, page: 1, page_size: 50 }),
      '/api/admin/tags/merge': () => json({ merged: 1, skills_moved: 1 }),
    })
    renderApp('/admin/tags')
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Chọn tag ex-cel' }))
    await userEvent.click(screen.getByRole('button', { name: 'Gộp 1 tag đã chọn…' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('combobox', { name: /Vào tag/ }))
    await userEvent.click(await screen.findByRole('option', { name: 'excel' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Gộp' }))
    await waitFor(() => {
      const call = calls.find((c) => c.url.pathname === '/api/admin/tags/merge')!
      expect(JSON.parse(String(call.init.body))).toEqual({ from: [2], into: 1 })
    })
  })

  it('lọc theo trạng thái lấy từ URL', async () => {
    const { calls } = mockApi({ ...base, '/api/admin/tags': () => ({ items: [], total: 0, page: 1, page_size: 50 }) })
    renderApp('/admin/tags?status=pending')
    await screen.findByText('Không có tag nào.')
    expect(calls.find((c) => c.url.pathname === '/api/admin/tags')!.url.searchParams.get('status')).toBe('pending')
  })
})

const audit = (over: Partial<AuditItemData>): AuditItemData => ({
  id: 1, created_at: '2026-01-01T00:00:00Z', actor_id: 1, actor_email: 'm@x', actor_name: 'Quản lý',
  action: 'skill.remove', target_type: 'skill', target_id: 5, detail: { reason: 'Vi phạm' }, ...over,
})

describe('AuditPage', () => {
  it('toIso chuyển giờ máy sang ISO và bỏ giá trị lỗi', () => {
    expect(toIso(null)).toBeUndefined()
    expect(toIso('khong-hop-le')).toBeUndefined()
    expect(toIso('2026-01-01T10:00')).toMatch(/^2026-01-01T\d\d:00:00\.000Z$/)
  })

  it('liệt kê, mở chi tiết JSON và gửi bộ lọc từ URL', async () => {
    const { calls } = mockApi({
      ...base,
      '/api/admin/audit-logs': () => ({ items: [audit({}), audit({ id: 2, actor_id: null, actor_name: 'system', action: 'review.auto_assign' })], total: 2, page: 1, page_size: 25 }),
    })
    renderApp('/admin/audit?action=skill.remove&target_type=skill&target_id=5')
    expect(await screen.findByText('skill.remove')).toBeInTheDocument()
    await userEvent.click(screen.getByText('skill.remove'))
    expect(await screen.findByText(/"reason": "Vi phạm"/)).toBeInTheDocument()
    const p = calls.find((c) => c.url.pathname === '/api/admin/audit-logs')!.url.searchParams
    expect(p.get('action')).toBe('skill.remove')
    expect(p.get('target_type')).toBe('skill')
    expect(p.get('target_id')).toBe('5')
  })

  it('xuất CSV theo bộ lọc và lưu file', async () => {
    const { calls } = mockApi({
      ...base,
      '/api/admin/audit-logs': () => ({ items: [audit({})], total: 1, page: 1, page_size: 25 }),
      '/api/admin/audit-logs/export': () =>
        new Response('﻿id,action\n1,skill.remove\n', { status: 200, headers: { 'content-type': 'text/csv' } }),
    })
    renderApp('/admin/audit?action=skill.remove')
    await userEvent.click(await screen.findByRole('button', { name: 'Xuất CSV' }))
    await waitFor(() => expect(saveTextFile).toHaveBeenCalled())
    const [name, text] = vi.mocked(saveTextFile).mock.calls[0]
    expect(name).toMatch(/^audit-logs-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(text).toContain('skill.remove')
    const call = calls.find((c) => c.url.pathname.endsWith('/export'))!
    expect(call.url.searchParams.get('action')).toBe('skill.remove')
  })

  it('quá giới hạn thì báo thu hẹp bộ lọc', async () => {
    mockApi({
      ...base,
      '/api/admin/audit-logs': () => ({ items: [], total: 0, page: 1, page_size: 25 }),
      '/api/admin/audit-logs/export': () => json({ error: { code: 'EXPORT_TOO_LARGE', message: 'x' } }, 413),
    })
    renderApp('/admin/audit')
    await userEvent.click(await screen.findByRole('button', { name: 'Xuất CSV' }))
    expect(await screen.findByText(/Quá nhiều dòng để xuất/)).toBeInTheDocument()
    expect(saveTextFile).not.toHaveBeenCalled()
  })
})

const source = (over: Partial<SourceData> = {}): SourceData => ({
  id: 3, type: 'github', name: 'acme/skills', url: 'https://github.com/acme/skills', ref: null, path_glob: '',
  default_category: 10, default_department: 'Kế toán', default_visibility: 'company', credential_name: null,
  internal: false, is_enabled: true, last_scan_at: '2026-01-01T00:00:00Z', last_scan_status: 'ok',
  last_scan_message: null, skill_count: 4, ...over,
})

const refData = {
  '/api/categories': () => [{ id: 10, name: 'Báo cáo', slug: 'bao-cao' }],
  '/api/departments': () => ['Kế toán', 'Nhân sự'],
}

describe('SourcesPage', () => {
  it('credential phải có tiền tố SOURCE_TOKEN_', () => {
    expect(CREDENTIAL_RE.test('SOURCE_TOKEN_GITHUB')).toBe(true)
    expect(CREDENTIAL_RE.test('SESSION_SECRET')).toBe(false)
    expect(CREDENTIAL_RE.test('source_token_x')).toBe(false)
  })

  it('liệt kê nguồn với trạng thái và lỗi quét', async () => {
    mockApi({
      ...base, ...refData,
      '/api/admin/sources': () => [source(), source({ id: 4, name: 'bad/repo', last_scan_status: 'error', last_scan_message: 'GitHub trả 404', skill_count: 0 })],
    })
    renderApp('/admin/sources')
    expect(await screen.findByText('acme/skills')).toBeInTheDocument()
    expect(screen.getByText('GitHub trả 404')).toBeInTheDocument()
    expect(screen.getByText('Quét lỗi')).toBeInTheDocument()
    expect(screen.getByText(/4 skill đã nhập/)).toBeInTheDocument()
  })

  it('khai báo nguồn mới: kiểm tra URL và tên bí mật trước khi gửi', async () => {
    const { calls } = mockApi({
      ...base, ...refData,
      '/api/admin/sources': (_u, init) => (init.method === 'POST' ? json(source({ id: 9 }), 201) : []),
    })
    renderApp('/admin/sources')
    await userEvent.click(await screen.findByRole('button', { name: 'Khai báo nguồn' }))
    const dialog = await screen.findByRole('dialog')
    const save = within(dialog).getByRole('button', { name: 'Lưu' })
    expect(save).toBeDisabled()
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Địa chỉ repo/ }), 'https://evil.example.com/a/b')
    await userEvent.click(within(dialog).getByRole('combobox', { name: /Danh mục/ }))
    await userEvent.click(await screen.findByRole('option', { name: 'Báo cáo' }))
    await userEvent.click(within(dialog).getByRole('combobox', { name: /Phòng ban/ }))
    await userEvent.click(await screen.findByRole('option', { name: 'Kế toán' }))
    expect(save).toBeDisabled() // URL không phải GitHub
    const url = within(dialog).getByRole('textbox', { name: /Địa chỉ repo/ })
    await userEvent.clear(url)
    await userEvent.type(url, 'https://github.com/acme/skills')
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Tên bí mật/ }), 'SESSION_SECRET')
    expect(save).toBeDisabled()
    const secret = within(dialog).getByRole('textbox', { name: /Tên bí mật/ })
    await userEvent.clear(secret)
    await userEvent.type(secret, 'SOURCE_TOKEN_ACME')
    expect(save).toBeEnabled()
    await userEvent.click(save)
    await waitFor(() => {
      const post = calls.find((c) => c.init.method === 'POST' && c.url.pathname === '/api/admin/sources')!
      expect(JSON.parse(String(post.init.body))).toMatchObject({
        type: 'github', url: 'https://github.com/acme/skills', default_category: 10,
        default_department: 'Kế toán', credential_name: 'SOURCE_TOKEN_ACME', internal: false,
      })
    })
  })

  it('quét ngay hiện kết quả tóm tắt', async () => {
    const { calls } = mockApi({
      ...base, ...refData,
      '/api/admin/sources': () => [source()],
      '/api/admin/sources/3/scan': () => json({ scan_id: 1, status: 'ok', message: null, counts: { new_skill: 2, skipped: 1 } }, 202),
    })
    renderApp('/admin/sources')
    await userEvent.click(await screen.findByRole('button', { name: 'Quét ngay' }))
    expect(await screen.findByText(/Quét xong — Skill mới: 2, Bỏ qua: 1/)).toBeInTheDocument()
    expect(calls.some((c) => c.url.pathname === '/api/admin/sources/3/scan' && c.init.method === 'POST')).toBe(true)
  })

  it('đang quét ở nơi khác thì báo lỗi 409', async () => {
    mockApi({
      ...base, ...refData,
      '/api/admin/sources': () => [source()],
      '/api/admin/sources/3/scan': () => json({ error: { code: 'SCAN_IN_PROGRESS', message: 'Nguồn đang được quét' } }, 409),
    })
    renderApp('/admin/sources')
    await userEvent.click(await screen.findByRole('button', { name: 'Quét ngay' }))
    expect(await screen.findByText('Nguồn đang được quét')).toBeInTheDocument()
  })

  it('lịch sử quét liệt kê từng thư mục kèm lý do bỏ qua', async () => {
    const scan: ScanData = {
      id: 1, source_id: 3, started_at: '2026-01-01T00:00:00Z', finished_at: null, status: 'ok', message: null,
      commit: 'abcdef1234', counts: { skipped: 1 }, total: 1,
      items: [{ path: 'tools/a', outcome: 'skipped', reason: 'Giấy phép GPL-3.0 không nằm trong danh sách cho phép' }],
    }
    mockApi({
      ...base, ...refData,
      '/api/admin/sources': () => [source()],
      '/api/admin/sources/3/scans': () => ({ items: [scan], total: 1, page: 1, page_size: 10 }),
    })
    renderApp('/admin/sources')
    await userEvent.click(await screen.findByRole('button', { name: 'Lịch sử quét' }))
    expect(await screen.findByText('tools/a')).toBeInTheDocument()
    expect(screen.getByText(/GPL-3\.0 không nằm trong danh sách cho phép/)).toBeInTheDocument()
    expect(screen.getByText(/abcdef1/)).toBeInTheDocument()
  })

  it('bật/tắt và xóa nguồn có xác nhận', async () => {
    const { calls } = mockApi({
      ...base, ...refData,
      '/api/admin/sources': () => [source()],
      '/api/admin/sources/3': () => new Response(null, { status: 204 }),
    })
    renderApp('/admin/sources')
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Đang bật' }))
    await waitFor(() => {
      const patch = calls.find((c) => c.init.method === 'PATCH')!
      expect(JSON.parse(String(patch.init.body))).toEqual({ is_enabled: false })
    })
    await userEvent.click(screen.getByRole('button', { name: 'Xóa nguồn' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Xóa nguồn' }))
    await waitFor(() => expect(calls.some((c) => c.init.method === 'DELETE' && c.url.pathname === '/api/admin/sources/3')).toBe(true))
  })
})

describe('Sửa thông tin skill thu thập', () => {
  it('chỉ skill thu thập có nút Sửa thông tin và gọi PATCH', async () => {
    const { calls } = mockApi({
      ...base, ...refData,
      '/api/tags': () => [{ id: 1, name: 'excel', status: 'approved', usage_count: 1 }],
      '/api/admin/skills': () => ({
        items: [
          { id: 7, name: 'Nhập khẩu', status: 'published', origin: 'imported', owner_id: null, department: 'Kế toán', visibility: 'company', latest_version: '0.0.1', download_count: 0, install_count: 0, updated_at: '2026-01-01T00:00:00Z' },
          { id: 8, name: 'Nội bộ', status: 'published', origin: 'internal', owner_id: 2, department: 'Kế toán', visibility: 'company', latest_version: '1.0.0', download_count: 0, install_count: 0, updated_at: '2026-01-01T00:00:00Z' },
        ],
        total: 2, page: 1, page_size: 20,
      }),
      '/api/skills/7': () => ({
        id: 7, name: 'Nhập khẩu', summary: 'Mô tả cũ', category_id: 10, department: 'Kế toán', visibility: 'company',
        status: 'published', origin: 'imported', tag_ids: [1], tags: ['excel'], owner_id: null, owner_name: null,
        has_icon: false, latest_version_id: 1, latest_version: null, viewing_version: null, skill_md: null,
        install_count: 0, download_count: 0, source_url: null, source_name: null, upstream_author: null,
        license: null, upstream_status: null, updated_at: '2026-01-01T00:00:00Z',
      }),
    })
    renderApp('/admin/skills')
    const rows = await screen.findAllByRole('listitem')
    expect(within(rows[1]).queryByRole('button', { name: 'Sửa thông tin' })).toBeNull()
    await userEvent.click(within(rows[0]).getByRole('button', { name: 'Sửa thông tin' }))
    const dialog = await screen.findByRole('dialog')
    const summary = await within(dialog).findByRole('textbox', { name: 'Mô tả ngắn' })
    expect(summary).toHaveValue('Mô tả cũ')
    await userEvent.clear(summary)
    await userEvent.type(summary, 'Mô tả mới')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }))
    await waitFor(() => {
      const patch = calls.find((c) => c.init.method === 'PATCH' && c.url.pathname === '/api/admin/skills/7')!
      expect(JSON.parse(String(patch.init.body))).toMatchObject({ summary: 'Mô tả mới', category_id: 10, tag_ids: [1] })
    })
  })
})
