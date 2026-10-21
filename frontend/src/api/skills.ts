import { api } from './client'
import { installKeys } from './installs'
import type {
  Category, DownloadInfo, FacetsData, Page, SkillFile, SkillFileContent, SkillCardData, SkillDetailData, SkillSort, TagData, Taxonomy,
  VersionData,
} from './types'

export interface SkillQuery {
  q?: string
  category?: number
  subcategory?: number
  department?: string
  tag?: string[]
  output_type?: string[]
  ecosystem?: string[]
  sort?: SkillSort
  page?: number
  page_size?: number
}

export const skillKeys = {
  featured: ['skills', 'featured'] as const,
  search: (query: SkillQuery) => ['skills', 'search', query] as const,
  detail: (id: number, version?: string) => ['skills', 'detail', id, version ?? 'latest'] as const,
  versions: (id: number) => ['skills', 'versions', id] as const,
  files: (id: number, version: string) => ['skills', 'files', id, version] as const,
  categories: ['categories'] as const,
  taxonomy: ['taxonomy'] as const,
  facets: (query: SkillQuery) => ['skills', 'facets', query] as const,
  departments: ['departments'] as const,
  tags: (q: string) => ['tags', q] as const,
  myInstalls: installKeys.me,
}

export const fetchFeatured = (limit = 8) =>
  api<SkillCardData[]>('/api/skills/featured', { params: { limit } })

export const searchSkills = (query: SkillQuery) =>
  api<Page<SkillCardData>>('/api/skills', { params: { ...query } })

export const fetchTaxonomy = () => api<Taxonomy>('/api/taxonomy')

/** Số đếm chỉ phụ thuộc bộ lọc, không phụ thuộc cách xếp hay trang. */
export const fetchFacets = (query: SkillQuery) => {
  const filters: SkillQuery = { ...query }
  delete filters.sort
  delete filters.page
  delete filters.page_size
  return api<FacetsData>('/api/skills/facets', { params: { ...filters } })
}

export const fetchCategories = () => api<Category[]>('/api/categories')
export const fetchDepartments = () => api<string[]>('/api/departments')
export const fetchTags = (q = '') => api<TagData[]>('/api/tags', { params: { q, limit: 100 } })

export const fetchSkill = (id: number, version?: string) =>
  api<SkillDetailData>(`/api/skills/${id}`, { params: { version } })

export const fetchVersions = (id: number) => api<VersionData[]>(`/api/skills/${id}/versions`)

export const requestDownload = (id: number, version: string, intent: 'install' | 'zip') =>
  api<DownloadInfo>(`/api/skills/${id}/download`, { params: { version, intent } })

export const skillIconUrl = (id: number, version?: string) =>
  version ? `/api/skills/${id}/icon?version=${encodeURIComponent(version)}` : `/api/skills/${id}/icon`

export const fetchSkillFiles = (id: number, version: string) =>
  api<SkillFile[]>(`/api/skills/${id}/versions/${encodeURIComponent(version)}/files`)

export const fetchSkillFileContent = (id: number, version: string, path: string) =>
  api<SkillFileContent>(`/api/skills/${id}/versions/${encodeURIComponent(version)}/files/content`, { params: { path } })
