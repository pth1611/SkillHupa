import { api } from './client'
import type {
  CreateSkillResponse, OwnerVersionData, SkillMineData, TagData, ValidationData, VersionWithValidation,
} from './types'

export const studioKeys = {
  mine: ['studio', 'mine'] as const,
  versions: (id: number) => ['studio', 'versions', id] as const,
  validation: (id: number, version: string, phase?: string) => ['studio', 'validation', id, version, phase ?? 'latest'] as const,
  myTags: ['tags', 'mine'] as const,
}

export const fetchMine = () => api<SkillMineData[]>('/api/skills/mine')

export const fetchOwnerVersions = (id: number) => api<OwnerVersionData[]>(`/api/skills/${id}/versions`)

export const fetchValidation = (id: number, version: string, phase?: string) =>
  api<ValidationData>(`/api/skills/${id}/versions/${encodeURIComponent(version)}/validation`, { params: { phase } })

export interface CreateMetadata {
  name?: string
  summary?: string
  category_id?: number
  department?: string
  visibility?: 'company' | 'department'
  version?: string
  changelog?: string
  tag_ids?: number[]
  output_types?: string[]
  ecosystems?: string[]
}

export function createSkill(pkg: File, icon: File | null, metadata: CreateMetadata = {}) {
  const form = new FormData()
  form.append('package', pkg)
  if (icon) form.append('icon', icon)
  form.append('metadata', JSON.stringify(metadata))
  return api<CreateSkillResponse>('/api/skills', { method: 'POST', body: form })
}

export function addVersion(id: number, pkg: File, icon: File | null, version: string, changelog: string) {
  const form = new FormData()
  form.append('package', pkg)
  if (icon) form.append('icon', icon)
  form.append('version', version)
  if (changelog) form.append('changelog', changelog)
  return api<VersionWithValidation>(`/api/skills/${id}/versions`, { method: 'POST', body: form })
}

export function replacePackage(id: number, version: string, pkg: File) {
  const form = new FormData()
  form.append('package', pkg)
  return api<VersionWithValidation>(`/api/skills/${id}/versions/${encodeURIComponent(version)}/package`, {
    method: 'PUT',
    body: form,
  })
}

export function replaceIcon(id: number, version: string, icon: File) {
  const form = new FormData()
  form.append('icon', icon)
  return api<ValidationData>(`/api/skills/${id}/versions/${encodeURIComponent(version)}/icon`, {
    method: 'PUT',
    body: form,
  })
}

export interface SkillPatch {
  name?: string
  summary?: string
  category_id?: number
  department?: string
  visibility?: 'company' | 'department'
  tag_ids?: number[]
  output_types?: string[]
  ecosystems?: string[]
}

export const patchSkill = (id: number, body: SkillPatch) =>
  api<unknown>(`/api/skills/${id}`, { method: 'PATCH', json: body })

export const patchVersion = (id: number, version: string, body: { version?: string; changelog?: string | null }) =>
  api<VersionWithValidation>(`/api/skills/${id}/versions/${encodeURIComponent(version)}`, {
    method: 'PATCH',
    json: body,
  })

export const submitVersion = (id: number, version: string) =>
  api<VersionWithValidation>(`/api/skills/${id}/versions/${encodeURIComponent(version)}/submit`, { method: 'POST' })

export const deleteVersion = (id: number, version: string) =>
  api(`/api/skills/${id}/versions/${encodeURIComponent(version)}`, { method: 'DELETE' })

export const proposeTag = (name: string) =>
  api<TagData & { status: string }>('/api/tags/proposals', { method: 'POST', json: { name } })

export const fetchMyTagProposals = () => api<(TagData & { status: string })[]>('/api/tags/proposals/mine')
