import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InstallItem, SkillDetailData, VersionData } from '../../api/types'
import { me, mockApi, renderApp } from '../../test/utils'

vi.mock('../../utils/download', () => ({ startDownload: vi.fn() }))
import { startDownload } from '../../utils/download'

const version = (id: number, v: string, status: VersionData['status'] = 'published'): VersionData => ({
  id, version: v, status, changelog: `Thay đổi ${v}`, checksum: 'abc', size_bytes: 10,
  created_at: '2026-01-01T00:00:00Z', submitted_at: null,
})

const skill = (over: Partial<SkillDetailData> = {}): SkillDetailData => ({
  id: 5, name: 'Báo cáo tuần', summary: 'Tạo báo cáo tuần', category_id: 10, department: 'Kế toán',
  visibility: 'company', status: 'published', origin: 'internal', owner_id: 2, owner_name: 'Lan Trần',
  has_icon: false, latest_version_id: 2, latest_version: version(2, '1.1.0'), viewing_version: version(2, '1.1.0'),
  skill_md: '# Hướng dẫn\n\nDùng **đậm**.\n\n[ok](https://example.com) [bad](javascript:alert(1))\n\n<script>alert(1)</script>\n\n![x](https://tracker.example/p.png)',
  tags: ['excel'], tag_ids: [], output_types: ['code'], ecosystems: [], install_count: 12, download_count: 3, source_url: null, source_name: null,
  upstream_author: null, license: null, upstream_status: null, updated_at: '2026-01-01T00:00:00Z', ...over,
})

const install = (over: Partial<InstallItem> = {}): InstallItem => ({
  skill_id: 5, name: 'Báo cáo tuần', summary: null, has_icon: false, source: 'cli', target: 'claude-code',
  installed_version: '1.0.0', latest_version: '1.1.0', state: 'update_available', installed_at: '2026-01-02T00:00:00Z', ...over,
})

function setup(opts: { detail?: SkillDetailData; installs?: InstallItem[]; versions?: VersionData[] } = {}) {
  return mockApi({
    '/api/auth/me': () => me(),
    '/api/categories': () => [{ id: 10, name: 'Báo cáo', slug: 'bao-cao' }],
    '/api/skills/5': (url: URL) => {
      const v = url.searchParams.get('version')
      const base = opts.detail ?? skill()
      return v === '1.0.0' ? { ...base, viewing_version: version(1, '1.0.0') } : base
    },
    '/api/skills/5/versions/1.1.0/files': () => [
      { path: 'SKILL.md', size: 120, is_text: true },
      { path: 'scripts/run.py', size: 30, is_text: true },
    ],
    '/api/skills/5/versions/1.1.0/files/content': () => ({
      path: 'scripts/run.py', size: 30, is_text: true, too_large: false, content: 'print("xin chào")',
    }),
    '/api/skills/5/versions': () => opts.versions ?? [version(1, '1.0.0'), version(2, '1.1.0')],
    '/api/installs/me': () => ({ items: opts.installs ?? [], total: 0, page: 1, page_size: 100 }),
    '/api/skills/5/download': () => ({ url: '/api/skills/5/versions/1.1.0/package', expires_at: null, version: '1.1.0', checksum: null }),
  })
}

afterEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

describe('SkillDetailPage', () => {
  it('hiện thông tin, lệnh cài và lịch sử phiên bản', async () => {
    setup()
    renderApp('/skills/5')
    expect(await screen.findByRole('heading', { name: 'Báo cáo tuần', level: 1 })).toBeInTheDocument()
    expect(screen.getByText(/Chủ skill: Lan Trần/)).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(await screen.findByText('2 file · 150 B')).toBeInTheDocument()
    expect(screen.getByTestId('install-command')).toHaveTextContent(
      'skillmkt install 5 --target claude-code',
    )
    expect(await screen.findByText('Thay đổi 1.0.0')).toBeInTheDocument()
    expect(screen.getAllByText('Mới nhất').length).toBeGreaterThan(0)
  })

  it('chọn file trong cây thư mục để xem nội dung', async () => {
    setup()
    renderApp('/skills/5')
    await userEvent.click(await screen.findByRole('button', { name: 'run.py' }))
    expect(await screen.findByText('print("xin chào")')).toBeInTheDocument()
  })

  it('làm sạch Markdown: không script, không liên kết javascript:, không ảnh ngoài', async () => {
    setup()
    const { container } = renderApp('/skills/5')
    await screen.findByRole('heading', { name: 'Hướng dẫn', level: 1 })
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img[src*="tracker"]')).toBeNull()
    const ok = screen.getByRole('link', { name: 'ok' })
    expect(ok).toHaveAttribute('href', 'https://example.com')
    expect(ok).toHaveAttribute('rel', expect.stringContaining('noopener'))
    expect(screen.queryByRole('link', { name: 'bad' })).toBeNull()
    expect(screen.getByText('bad')).toBeInTheDocument()
  })

  it('đổi tab công cụ và nhớ lựa chọn', async () => {
    setup()
    renderApp('/skills/5')
    await userEvent.click(await screen.findByRole('tab', { name: 'Cursor' }))
    expect(screen.getByTestId('install-command')).toHaveTextContent('--target cursor')
    expect(localStorage.getItem('skillmkt.installTarget')).toBe('cursor')
  })

  it('xem bản cũ thì lệnh cài có --version', async () => {
    setup()
    renderApp('/skills/5')
    const card = (await screen.findByText('Thay đổi 1.0.0')).closest('.MuiCard-root') as HTMLElement
    await userEvent.click(within(card).getByRole('button', { name: 'Xem' }))
    await waitFor(() =>
      expect(screen.getByTestId('install-command')).toHaveTextContent('--version 1.0.0'),
    )
  })

  it('tải .zip gọi download?intent=zip rồi bắt đầu tải', async () => {
    const { calls } = setup()
    renderApp('/skills/5')
    await userEvent.click(await screen.findByRole('tab', { name: 'Thủ công' }))
    await userEvent.click(screen.getByRole('button', { name: 'Tải .zip' }))
    await waitFor(() => expect(startDownload).toHaveBeenCalledWith('/api/skills/5/versions/1.1.0/package'))
    const call = calls.find((c) => c.url.pathname === '/api/skills/5/download')!
    expect(call.url.searchParams.get('intent')).toBe('zip')
    expect(call.url.searchParams.get('version')).toBe('1.1.0')
  })

  it.each([
    ['revoked', /Phiên bản 1\.0\.0 bạn đã cài bị thu hồi/],
    ['removed', /Skill này đã bị gỡ\. Hãy gỡ/],
    ['no_access', /không còn quyền dùng skill này/],
    ['update_available', /Bạn đang dùng 1\.0\.0, đã có bản 1\.1\.0/],
  ] as const)('cảnh báo trạng thái %s của bản đã cài', async (state, text) => {
    setup({ installs: [install({ state })] })
    renderApp('/skills/5')
    expect(await screen.findByText(text)).toBeInTheDocument()
  })

  it('không có cảnh báo khi đã mới nhất', async () => {
    setup({ installs: [install({ state: 'up_to_date', installed_version: '1.1.0' })] })
    renderApp('/skills/5')
    await screen.findByRole('heading', { name: 'Báo cáo tuần', level: 1 })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('skill thu thập hiện tác giả gốc, giấy phép và liên kết nguồn an toàn', async () => {
    setup({
      detail: skill({ origin: 'imported', owner_id: null, owner_name: null, upstream_author: 'acme', license: 'MIT',
        source_url: 'https://github.com/acme/skills' }),
    })
    renderApp('/skills/5')
    expect(await screen.findByText(/Tác giả gốc: acme · Giấy phép: MIT/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Xem tại nguồn' })).toHaveAttribute('href', 'https://github.com/acme/skills')
  })

  it('không hiện liên kết nguồn nếu không phải http(s)', async () => {
    setup({ detail: skill({ origin: 'imported', source_url: 'javascript:alert(1)' }) })
    renderApp('/skills/5')
    await screen.findByRole('heading', { name: 'Báo cáo tuần', level: 1 })
    expect(screen.queryByRole('link', { name: 'Xem tại nguồn' })).toBeNull()
  })

  it('404 hiện trang không tìm thấy', async () => {
    mockApi({ '/api/auth/me': () => me() })
    renderApp('/skills/999')
    expect(await screen.findByText('Không tìm thấy trang này.')).toBeInTheDocument()
  })
})
