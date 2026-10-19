import { api } from './client'
import type { InstallItem, Page } from './types'

export const installKeys = { me: ['installs', 'me'] as const }

/** Toàn bộ bản ghi cài đang có của tôi (nhiều trang thì gom lại). */
export async function fetchMyInstalls(): Promise<InstallItem[]> {
  const items: InstallItem[] = []
  for (let page = 1; page <= 10; page++) {
    const result = await api<Page<InstallItem>>('/api/installs/me', { params: { page, page_size: 100 } })
    items.push(...result.items)
    if (items.length >= result.total || result.items.length === 0) break
  }
  return items
}

export const hideInstall = (skillId: number, target?: string) =>
  api(`/api/installs/${skillId}`, { method: 'DELETE', params: { target } })
