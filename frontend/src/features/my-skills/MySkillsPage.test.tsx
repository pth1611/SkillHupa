import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { InstallItem } from '../../api/types'
import { me, mockApi, renderApp } from '../../test/utils'
import { groupBySkill } from './MySkillsPage'

const item = (over: Partial<InstallItem>): InstallItem => ({
  skill_id: 1, name: 'Báo cáo tuần', summary: null, has_icon: false, source: 'cli', target: 'claude-code',
  installed_version: '1.0.0', latest_version: '1.0.0', state: 'up_to_date', installed_at: '2026-01-01T00:00:00Z', ...over,
})

function setup(items: InstallItem[], extra: Parameters<typeof mockApi>[0] = {}) {
  return mockApi({
    '/api/auth/me': () => me(),
    '/api/installs/me': () => ({ items, total: items.length, page: 1, page_size: 100 }),
    ...extra,
  })
}

describe('groupBySkill', () => {
  it('gộp một skill nhiều bản ghi thành một thẻ, ưu tiên cli và giữ trạng thái khẩn nhất', () => {
    const result = groupBySkill([
      item({ source: 'zip', target: 'zip', state: 'up_to_date' }),
      item({ target: 'claude-code', state: 'update_available', latest_version: '1.1.0' }),
      item({ target: 'cursor', state: 'revoked' }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].item.source).toBe('cli')
    expect(result[0].group).toBe('attention')
    expect(result[0].targets.sort()).toEqual(['claude-code', 'cursor', 'zip'])
  })

  it('sắp theo mức khẩn rồi theo tên', () => {
    const result = groupBySkill([
      item({ skill_id: 1, name: 'B', state: 'up_to_date' }),
      item({ skill_id: 2, name: 'A', state: 'up_to_date' }),
      item({ skill_id: 3, name: 'C', state: 'removed' }),
      item({ skill_id: 4, name: 'D', state: 'update_available', latest_version: '2.0.0' }),
    ])
    expect(result.map((e) => e.item.name)).toEqual(['C', 'D', 'A', 'B'])
  })
})

describe('MySkillsPage', () => {
  it('nhóm theo mức khẩn, có đếm và lệnh gợi ý', async () => {
    setup([
      item({ skill_id: 1, name: 'Cũ', state: 'update_available', installed_version: '1.0.0', latest_version: '1.2.0' }),
      item({ skill_id: 2, name: 'Mới', state: 'up_to_date' }),
      item({ skill_id: 3, name: 'Bị gỡ', state: 'removed' }),
    ])
    renderApp('/my-skills')
    expect(await screen.findByRole('button', { name: 'Tất cả 3' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Cần chú ý 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Có bản mới 1' })).toBeInTheDocument()
    const attention = screen.getByRole('region', { name: 'Cần chú ý' })
    expect(within(attention).getByText('Bị gỡ')).toBeInTheDocument()
    expect(within(attention).getByTestId('install-command')).toHaveTextContent('skillmkt uninstall 3')
    const update = screen.getByRole('region', { name: 'Có bản mới' })
    expect(within(update).getByText('1.0.0 → 1.2.0')).toBeInTheDocument()
    expect(within(update).getByTestId('install-command')).toHaveTextContent('skillmkt update 1')
  })

  it('bấm chip để lọc', async () => {
    setup([item({ skill_id: 1, name: 'Cũ', state: 'update_available', latest_version: '2.0.0' }), item({ skill_id: 2, name: 'Mới' })])
    renderApp('/my-skills')
    await userEvent.click(await screen.findByRole('button', { name: 'Có bản mới 1' }))
    expect(screen.getByText('Cũ')).toBeInTheDocument()
    expect(screen.queryByText('Mới')).toBeNull()
  })

  it('mục .zip có giải thích, không có lệnh, và nút Ẩn gọi DELETE ?target=zip', async () => {
    const { calls } = setup([item({ source: 'zip', target: 'zip', name: 'Gói zip' })])
    renderApp('/my-skills')
    expect(await screen.findByText(/không biết bạn đã đặt gói ở đâu/)).toBeInTheDocument()
    expect(screen.queryByTestId('install-command')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Ẩn' }))
    await waitFor(() => {
      const del = calls.find((c) => c.init.method === 'DELETE')!
      expect(del.url.pathname).toBe('/api/installs/1')
      expect(del.url.searchParams.get('target')).toBe('zip')
    })
  })

  it('trạng thái rỗng dẫn tới khám phá skill', async () => {
    setup([])
    renderApp('/my-skills')
    expect(await screen.findByText('Bạn chưa cài hay tải skill nào.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Khám phá skill' })).toHaveAttribute('href', '/skills')
  })
})
