import { api } from './client'
import type { NotificationData, Page } from './types'

export const notificationKeys = {
  list: (unread: boolean, page: number) => ['notifications', { unread, page }] as const,
  all: ['notifications'] as const,
}

export const fetchNotifications = (unread: boolean, page: number) =>
  api<Page<NotificationData>>('/api/notifications', { params: { unread, page, page_size: 20 } })

export const markRead = (id: number) => api(`/api/notifications/${id}/read`, { method: 'POST' })
export const markAllRead = () => api('/api/notifications/read-all', { method: 'POST' })
