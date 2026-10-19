import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { SkillCardData } from '../../api/types'
import { me, mockApi, renderApp } from '../../test/utils'

const card = (id: number, name: string): SkillCardData => ({
  id, name, summary: 'Mô tả ' + name, category_id: 10, department: null, visibility: 'company',
  origin: 'internal', source_name: null, license: null, latest_version: '1.0.0', has_icon: false,
  tags: [], install_count: 0, download_count: 0, published_at: null,
})

function setup(total = 1) {
  return mockApi({
    '/api/auth/me': () => me(),
    '/api/categories': () => [{ id: 10, name: 'Báo cáo', slug: 'bao-cao' }],
    '/api/departments': () => ['Kế toán', 'Nhân sự'],
    '/api/tags': () => [{ id: 1, name: 'excel', status: 'approved', usage_count: 2 }],
    '/api/skills': (url: URL) => ({
      items: total === 0 ? [] : [card(1, url.searchParams.get('q') ? 'Khớp từ khoá' : 'Mặc định')],
      total,
      page: 1,
      page_size: 12,
    }),
  })
}

const lastSkillsCall = (calls: { url: URL }[]) =>
  [...calls].reverse().find((c) => c.url.pathname === '/api/skills')!.url.searchParams

describe('SearchPage', () => {
  it('đọc bộ lọc từ URL và gửi lên API', async () => {
    const { calls } = setup()
    renderApp('/skills?q=abc&category=10&department=K%E1%BA%BF%20to%C3%A1n&tag=excel&sort=popular&page=2')
    expect(await screen.findByText('Khớp từ khoá')).toBeInTheDocument()
    const p = lastSkillsCall(calls)
    expect(p.get('q')).toBe('abc')
    expect(p.get('category')).toBe('10')
    expect(p.get('department')).toBe('Kế toán')
    expect(p.getAll('tag')).toEqual(['excel'])
    expect(p.get('sort')).toBe('popular')
    expect(p.get('page')).toBe('2')
    expect(screen.getByText('1 kết quả')).toBeInTheDocument()
  })

  it('gửi từ khoá khi bấm Tìm và về trang 1', async () => {
    const { calls } = setup()
    renderApp('/skills?page=3')
    const box = await screen.findByRole('textbox', { name: 'Từ khoá' })
    await userEvent.type(box, 'báo cáo')
    await userEvent.click(screen.getByRole('button', { name: 'Tìm' }))
    await waitFor(() => expect(lastSkillsCall(calls).get('q')).toBe('báo cáo'))
    expect(lastSkillsCall(calls).get('page')).toBe('1')  // về trang 1
  })

  it('trạng thái rỗng và nút xóa bộ lọc', async () => {
    setup(0)
    renderApp('/skills?q=zzz')
    expect(await screen.findByText('Không có skill nào khớp bộ lọc.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Xóa bộ lọc' })).toBeInTheDocument()
  })

  it('phân trang khi nhiều hơn một trang', async () => {
    const { calls } = setup(30)
    renderApp('/skills')
    await userEvent.click(await screen.findByRole('button', { name: /page 2|trang 2|Go to page 2/i }))
    await waitFor(() => expect(lastSkillsCall(calls).get('page')).toBe('2'))
  })
})
