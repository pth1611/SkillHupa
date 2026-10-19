import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { SkillCardData } from '../../api/types'
import { me, mockApi, renderApp, unauthorized } from '../../test/utils'

const card = (over: Partial<SkillCardData>): SkillCardData => ({
  id: 1, name: 'Báo cáo tuần', summary: 'Tạo báo cáo tuần', category_id: 10, department: 'Kế toán',
  visibility: 'company', origin: 'internal', source_name: null, license: null, latest_version: '1.2.0',
  has_icon: false, tags: ['excel'], install_count: 7, download_count: 0, published_at: null, ...over,
})

const categories = [
  { id: 10, name: 'Báo cáo', slug: 'bao-cao' },
  { id: 20, name: 'Lập trình', slug: 'lap-trinh' },
]

function routes(role: 'user' | 'creator' = 'user') {
  return {
    '/api/auth/me': () => me(role),
    '/api/categories': () => categories,
    '/api/skills/featured': () => [card({ id: 1 })],
    '/api/skills': (url: URL) => {
      const category = url.searchParams.get('category')
      if (category === '20') return { items: [], total: 0, page: 1, page_size: 4 }
      return { items: [card({ id: 2, name: 'Mới nhất' })], total: 1, page: 1, page_size: 8 }
    },
  }
}

describe('HomePage', () => {
  it('hiện banner, khối nổi bật, mới đăng và ẩn khối danh mục rỗng', async () => {
    mockApi(routes())
    renderApp('/')
    expect(await screen.findByRole('heading', { name: 'Nổi bật' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Mới đăng' })).toBeInTheDocument()
    expect(screen.getAllByText('Báo cáo tuần').length).toBeGreaterThan(0)
    expect(screen.getAllByText('7 lượt cài').length).toBeGreaterThan(0)
    // Danh mục có skill hiện thành khối riêng; danh mục rỗng bị ẩn.
    expect(screen.getByRole('region', { name: 'Báo cáo' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Lập trình' })).not.toBeInTheDocument()
    expect(screen.getByText(/nhờ quản trị viên thêm bạn vào nhóm Creator/)).toBeInTheDocument()
  })

  it('Creator thấy nút Gửi skill; người thường không có menu Studio', async () => {
    mockApi(routes('creator'))
    renderApp('/')
    expect(await screen.findByRole('link', { name: 'Gửi skill' })).toHaveAttribute('href', '/studio/new')
    expect(screen.getAllByRole('link', { name: 'Studio' }).length).toBeGreaterThan(0)
  })

  it('tìm kiếm chuyển sang /skills?q=', async () => {
    mockApi(routes())
    renderApp('/')
    const box = await screen.findByRole('textbox', { name: 'Tìm kiếm' })
    await userEvent.type(box, 'báo cáo{enter}')
    expect(await screen.findByRole('heading', { name: 'Tìm kiếm skill' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Từ khoá' })).toHaveValue('báo cáo')
  })

  it('chọn tab danh mục gọi API theo danh mục và giữ trên URL', async () => {
    const { calls } = mockApi(routes())
    renderApp('/')
    const tab = await screen.findByRole('tab', { name: 'Báo cáo' })
    await userEvent.click(tab)
    await waitFor(() =>
      expect(calls.some((c) => c.url.pathname === '/api/skills' && c.url.searchParams.get('category') === '10' && c.url.searchParams.get('page_size') === '8')).toBe(true),
    )
    expect(screen.getByRole('tab', { name: 'Báo cáo' })).toHaveAttribute('aria-selected', 'true')
  })

  it('lỗi tải có nút thử lại', async () => {
    let fail = true
    mockApi({
      ...routes(),
      '/api/skills/featured': () =>
        fail
          ? new Response(JSON.stringify({ error: { code: 'X', message: 'x' } }), { status: 500 })
          : [card({ id: 1 })],
    })
    renderApp('/')
    const retry = await screen.findByRole('button', { name: 'Thử lại' })
    fail = false
    await userEvent.click(retry)
    expect(await screen.findByRole('heading', { name: 'Nổi bật' })).toBeInTheDocument()
  })

  it('trạng thái rỗng khi chưa có skill', async () => {
    mockApi({
      '/api/auth/me': () => me(),
      '/api/categories': () => [],
      '/api/skills/featured': () => [],
      '/api/skills': () => ({ items: [], total: 0, page: 1, page_size: 8 }),
    })
    renderApp('/')
    expect(await screen.findByText('Chưa có skill nào được đăng.')).toBeInTheDocument()
  })
})

describe('xác thực và phân quyền', () => {
  it('chưa đăng nhập thì chuyển tới /login kèm next', async () => {
    mockApi({ '/api/auth/me': unauthorized })
    renderApp('/skills?q=abc')
    const sso = await screen.findByRole('link', { name: 'Đăng nhập bằng tài khoản công ty' })
    expect(sso).toHaveAttribute('href', `/api/auth/login?next=${encodeURIComponent('/skills?q=abc')}`)
  })

  it('đã đăng nhập mà vào /login thì quay về next', async () => {
    mockApi({ ...routes(), '/api/auth/me': () => me() })
    renderApp('/login?next=/my-skills')
    expect(await screen.findByRole('heading', { name: 'Skill của tôi' })).toBeInTheDocument()
  })

  it('không chấp nhận next trỏ ra ngoài', async () => {
    mockApi({ '/api/auth/me': unauthorized })
    renderApp('/login?next=//evil.example.com')
    const sso = await screen.findByRole('link', { name: 'Đăng nhập bằng tài khoản công ty' })
    expect(sso).toHaveAttribute('href', `/api/auth/login?next=${encodeURIComponent('/')}`)
  })

  it('RequireRole chuyển người không đủ quyền về trang chủ', async () => {
    mockApi(routes('user'))
    renderApp('/admin/tags')
    expect(await screen.findByRole('heading', { name: 'Nổi bật' })).toBeInTheDocument()
  })

  it('Manager vào được trang quản trị', async () => {
    mockApi({
      ...routes(),
      '/api/auth/me': () => me('manager'),
      '/api/admin/tags': () => ({ items: [], total: 0, page: 1, page_size: 50 }),
    })
    renderApp('/admin/tags')
    expect(await screen.findByRole('heading', { name: 'Tag' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tạo tag' })).toBeInTheDocument()
  })
})
