import { api } from './client'
import type {
  HistoryItemData, Page, QueueItemData, ReviewDetailData, ReviewFileContent, ReviewFileEntry,
  VisibilityRequestData,
} from './types'

export const reviewKeys = {
  queue: (params: object) => ['reviews', 'queue', params] as const,
  history: (page: number) => ['reviews', 'history', page] as const,
  detail: (id: number) => ['reviews', 'detail', id] as const,
  files: (id: number) => ['reviews', 'files', id] as const,
  content: (id: number, path: string) => ['reviews', 'content', id, path] as const,
  request: (id: number) => ['reviews', 'request', id] as const,
  all: ['reviews'] as const,
}

export interface QueueParams {
  type?: 'version' | 'visibility'
  assigned?: boolean
  overdue?: boolean
  page?: number
  page_size?: number
}

export const fetchQueue = (params: QueueParams) =>
  api<Page<QueueItemData>>('/api/reviews/queue', { params: { ...params } as Record<string, string | number | boolean | undefined> })

export const fetchHistory = (page: number) =>
  api<Page<HistoryItemData>>('/api/reviews/history', { params: { page, page_size: 20 } })

export const fetchReview = (id: number) => api<ReviewDetailData>(`/api/reviews/versions/${id}`)
export const fetchReviewFiles = (id: number) => api<ReviewFileEntry[]>(`/api/reviews/versions/${id}/files`)
export const fetchReviewFile = (id: number, path: string) =>
  api<ReviewFileContent>(`/api/reviews/versions/${id}/files/content`, { params: { path } })

export const decideVersion = (id: number, decision: 'approved' | 'rejected', comment: string | null) =>
  api(`/api/reviews/versions/${id}/decision`, { method: 'POST', json: { decision, comment } })

export const fetchVisibilityRequest = (id: number) =>
  api<VisibilityRequestData>(`/api/reviews/visibility-requests/${id}`)

export const decideRequest = (id: number, decision: 'approved' | 'rejected', comment: string | null) =>
  api(`/api/reviews/visibility-requests/${id}/decision`, { method: 'POST', json: { decision, comment } })

export const reviewIconUrl = (versionId: number) => `/api/reviews/versions/${versionId}/icon`
export const reviewPackageUrl = (versionId: number) => `/api/reviews/versions/${versionId}/package`

export interface ClassificationData {
  output_types: string[]
  ecosystems: string[]
}

export interface AutoClassifyData extends ClassificationData {
  applied: boolean
  suggested_output_types: string[]
  suggested_ecosystems: string[]
  category_id: number | null
}

export const saveClassification = (skillId: number, body: ClassificationData) =>
  api<ClassificationData>(`/api/skills/${skillId}/classification`, { method: 'PUT', json: body })

export const autoClassify = (skillId: number, force: boolean) =>
  api<AutoClassifyData>(`/api/skills/${skillId}/classification/auto`, { method: 'POST', json: { force } })
