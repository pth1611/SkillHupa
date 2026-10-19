import { api } from './client'
import type {
  AdminSkillItem, AdminTagData, AuditItemData, DashboardData, ImpactData, Page, ScanData, SkillStatus, SourceData,
  TagStatus, UserData, VersionData,
} from './types'

export const adminKeys = {
  dashboard: ['admin', 'dashboard'] as const,
  skills: (params: object) => ['admin', 'skills', params] as const,
  skillsAll: ['admin', 'skills'] as const,
  impact: (id: number, version?: string) => ['admin', 'impact', id, version ?? ''] as const,
  versions: (id: number) => ['admin', 'versions', id] as const,
  users: (params: object) => ['admin', 'users', params] as const,
  assignQueue: ['admin', 'assign-queue'] as const,
}

export const fetchDashboard = () => api<DashboardData>('/api/admin/dashboard')

export interface AdminSkillQuery {
  status?: SkillStatus
  q?: string
  page?: number
  page_size?: number
}

export const fetchAdminSkills = (params: AdminSkillQuery) =>
  api<Page<AdminSkillItem>>('/api/admin/skills', { params: { ...params } })

export const fetchImpact = (id: number, version?: string) =>
  api<ImpactData>(`/api/admin/skills/${id}/impact`, { params: { version } })

export const fetchAdminVersions = (id: number) => api<VersionData[]>(`/api/skills/${id}/versions`)

export const removeSkill = (id: number, reason: string) =>
  api(`/api/admin/skills/${id}/remove`, { method: 'POST', json: { reason } })

export const restoreSkill = (id: number) => api(`/api/admin/skills/${id}/restore`, { method: 'POST' })

export const revokeVersion = (id: number, version: string, reason: string) =>
  api(`/api/admin/skills/${id}/versions/${encodeURIComponent(version)}/revoke`, { method: 'POST', json: { reason } })

export const transferSkill = (id: number, newOwnerId: number) =>
  api(`/api/admin/skills/${id}/transfer`, { method: 'POST', json: { new_owner_id: newOwnerId } })

export const fetchUsers = (params: { q?: string; role?: string; page_size?: number }) =>
  api<Page<UserData>>('/api/users', { params: { ...params } })

export const assignVersion = (versionId: number, reviewerId: number) =>
  api(`/api/reviews/versions/${versionId}/assignment`, { method: 'PUT', json: { reviewer_id: reviewerId } })

export const unassignVersion = (versionId: number) =>
  api(`/api/reviews/versions/${versionId}/assignment`, { method: 'DELETE' })

export const assignRequest = (requestId: number, reviewerId: number) =>
  api(`/api/reviews/visibility-requests/${requestId}/assignment`, { method: 'PUT', json: { reviewer_id: reviewerId } })

// ---- tag ------------------------------------------------------------------


export const tagKeys = {
  list: (params: object) => ['admin', 'tags', params] as const,
  all: ['admin', 'tags'] as const,
}

export const fetchAdminTags = (params: { status?: TagStatus; q?: string; page?: number; page_size?: number }) =>
  api<Page<AdminTagData>>('/api/admin/tags', { params: { ...params } })

export const createTag = (name: string) => api<AdminTagData>('/api/admin/tags', { method: 'POST', json: { name } })
export const approveTag = (id: number) => api<AdminTagData>(`/api/admin/tags/${id}/approve`, { method: 'POST' })
export const rejectTag = (id: number, reason: string) =>
  api<AdminTagData>(`/api/admin/tags/${id}/reject`, { method: 'POST', json: { reason } })
export const mergeTags = (from: number[], into: number) =>
  api<{ merged: number; skills_moved: number }>('/api/admin/tags/merge', { method: 'POST', json: { from, into } })
export const deleteTag = (id: number) => api(`/api/admin/tags/${id}`, { method: 'DELETE' })

// ---- nhật ký --------------------------------------------------------------

export interface AuditQuery {
  actor_id?: number
  action?: string
  target_type?: string
  target_id?: number
  from?: string
  to?: string
}

export const auditKeys = {
  list: (params: object) => ['admin', 'audit', params] as const,
}

export const fetchAudit = (params: AuditQuery & { page?: number; page_size?: number }) =>
  api<Page<AuditItemData>>('/api/admin/audit-logs', { params: { ...params } })

/** CSV theo cùng bộ lọc; trả văn bản (đã có BOM) để lưu thành file. */
export const exportAudit = (params: AuditQuery) =>
  api<string>('/api/admin/audit-logs/export', { params: { ...params } })

// ---- nguồn thu thập -------------------------------------------------------

export const sourceKeys = {
  list: ['admin', 'sources'] as const,
  scans: (id: number, page: number) => ['admin', 'sources', id, 'scans', page] as const,
}

export interface SourceInput {
  type: 'github'
  url: string
  ref?: string | null
  path_glob?: string
  default_category: number
  default_department: string
  default_visibility: 'company' | 'department'
  credential_name?: string | null
  internal: boolean
  name?: string | null
}

export const fetchSources = () => api<SourceData[]>('/api/admin/sources')
export const createSource = (body: SourceInput) =>
  api<SourceData>('/api/admin/sources', { method: 'POST', json: body })
export const updateSource = (id: number, body: Partial<Omit<SourceInput, 'type' | 'url'>> & { is_enabled?: boolean }) =>
  api<SourceData>(`/api/admin/sources/${id}`, { method: 'PATCH', json: body })
export const deleteSource = (id: number) => api(`/api/admin/sources/${id}`, { method: 'DELETE' })
export const scanSource = (id: number) =>
  api<{ scan_id: number; status: 'ok' | 'error'; message: string | null; counts: Record<string, number> }>(
    `/api/admin/sources/${id}/scan`,
    { method: 'POST' },
  )
export const fetchScans = (id: number, page: number) =>
  api<Page<ScanData>>(`/api/admin/sources/${id}/scans`, { params: { page, page_size: 10 } })

// ---- sửa thông tin hiển thị skill thu thập (D48) ------------------------------

export const patchImportedSkill = (
  id: number,
  body: { summary?: string; category_id?: number; department?: string; visibility?: 'company' | 'department'; tag_ids?: number[] },
) => api(`/api/admin/skills/${id}`, { method: 'PATCH', json: body })
