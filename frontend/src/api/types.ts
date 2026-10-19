// Kiểu dữ liệu theo docs/api.md và backend/app/modules/*/schemas.py.

export type Role = 'user' | 'creator' | 'reviewer' | 'manager'

export interface Me {
  id: number
  email: string
  display_name: string
  role: Role
  department: string | null
  unread_notifications: number
}

export interface Page<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

export interface SkillCardData {
  id: number
  name: string
  summary: string | null
  category_id: number | null
  department: string | null
  visibility: 'company' | 'department'
  origin: 'internal' | 'imported'
  source_name: string | null
  license: string | null
  latest_version: string | null
  has_icon: boolean
  tags: string[]
  output_types: string[]
  ecosystems: string[]
  install_count: number
  download_count: number
  published_at: string | null
}

export interface Category {
  id: number
  name: string
  slug: string
}

export interface Taxonomy {
  output_types: string[]
  ecosystems: string[]
}

/** Số skill khớp theo từng giá trị phân loại, theo bộ lọc hiện tại (D52). */
export interface FacetsData {
  total: number
  categories: Record<string, number>
  output_types: Record<string, number>
  ecosystems: Record<string, number>
}

export type SkillSort = 'newest' | 'popular' | 'name'

export interface VersionData {
  id: number
  version: string
  status: 'draft' | 'validating' | 'pending' | 'published' | 'rejected' | 'revoked'
  changelog: string | null
  checksum: string | null
  size_bytes: number | null
  created_at: string
  submitted_at: string | null
}

export interface SkillDetailData {
  id: number
  name: string
  summary: string | null
  category_id: number | null
  department: string | null
  visibility: 'company' | 'department'
  status: 'draft' | 'published' | 'removed'
  origin: 'internal' | 'imported'
  owner_id: number | null
  owner_name: string | null
  has_icon: boolean
  latest_version_id: number | null
  latest_version: VersionData | null
  viewing_version: VersionData | null
  skill_md: string | null
  tags: string[]
  tag_ids: number[]
  output_types: string[]
  ecosystems: string[]
  /** Slug do bộ phân loại tự động gán, chưa ai xác nhận. */
  auto_output_types?: string[]
  auto_ecosystems?: string[]
  install_count: number
  download_count: number
  source_url: string | null
  source_name: string | null
  upstream_author: string | null
  license: string | null
  upstream_status: string | null
  updated_at: string
}

export interface TagData {
  id: number
  name: string
  usage_count: number
}

export type InstallState = 'up_to_date' | 'update_available' | 'revoked' | 'removed' | 'no_access'

export interface InstallItem {
  skill_id: number
  name: string
  summary: string | null
  has_icon: boolean
  source: 'cli' | 'zip'
  target: string
  installed_version: string
  latest_version: string | null
  state: InstallState
  installed_at: string
}

export interface DownloadInfo {
  url: string
  expires_at: string | null
  version: string
  checksum: string | null
}

export interface NotificationData {
  id: number
  type: string
  message: string
  link: string | null
  is_read: boolean
  created_at: string
}

export type SkillStatus = 'draft' | 'published' | 'removed'

/** Phiên bản kèm thông tin chỉ chủ skill thấy (góp ý duyệt, người được giao). */
export interface OwnerVersionData extends VersionData {
  review_decision: string | null
  review_comment: string | null
  assigned_to_name: string | null
}

export interface SkillMineData {
  id: number
  name: string
  summary: string | null
  category_id: number | null
  department: string | null
  visibility: 'company' | 'department'
  status: SkillStatus
  origin: 'internal' | 'imported'
  latest_version_id: number | null
  output_types: string[]
  ecosystems: string[]
  download_count: number
  updated_at: string
  latest_draft_version: OwnerVersionData | null
}

export interface Finding {
  check: string
  result: 'pass' | 'warn' | 'fail'
  detail: string
  file_path: string | null
  line: number | null
}

export interface ValidationData {
  phase: 'preview' | 'submit'
  ok: boolean
  results: Finding[]
}

export interface Prefill {
  name: string | null
  description: string | null
  version: string | null
  output_types: string[]
  ecosystems: string[]
  category_slug: string | null
  name_suggestion: string | null
}

export interface VersionWithValidation {
  version: VersionData
  validation: ValidationData
  prefill: Prefill
}

export interface CreateSkillResponse extends VersionWithValidation {
  skill: { id: number; name: string }
}

export interface QueueItemData {
  kind: 'version' | 'visibility'
  id: number
  skill_id: number
  skill_name: string
  origin: 'internal' | 'imported'
  version: string | null
  from_visibility: string | null
  to_visibility: string | null
  submitted_at: string
  assigned_to: number | null
  assigned_to_name: string | null
  overdue: boolean
  unassigned_overdue: boolean
}

export interface ReviewDetailData {
  version_id: number
  output_types: string[]
  ecosystems: string[]
  version: string
  status: string
  skill_id: number
  skill_name: string
  summary: string | null
  origin: 'internal' | 'imported'
  department: string | null
  visibility: string
  changelog: string | null
  skill_md: string | null
  submitted_at: string | null
  assigned_to: number | null
  assigned_by_name: string | null
  owner_name: string | null
  has_icon: boolean
  base_version: string | null
  validation: Finding[]
}

export interface ReviewFileEntry {
  path: string
  status: 'added' | 'modified' | 'removed' | 'unchanged'
  size: number
  is_text: boolean
  warnings: number
}

export interface ReviewFileContent {
  path: string
  is_text: boolean
  size: number
  sha256: string
  too_large: boolean
  new: string | null
  old: string | null
  diff: string | null
  warnings: { check: string; line: number | null; detail: string }[]
}

export interface VisibilityRequestData {
  id: number
  skill_id: number
  skill_name: string
  summary: string | null
  status: string
  from_visibility: string
  to_visibility: string
  from_department: string | null
  to_department: string | null
  created_at: string
  assigned_to: number | null
  comment: string | null
}

export interface HistoryItemData {
  kind: 'version' | 'visibility'
  id: number
  skill_id: number
  skill_name: string
  version: string | null
  decision: 'approved' | 'rejected'
  comment: string | null
  decided_at: string
}

export interface DashboardData {
  unassigned: number
  unassigned_overdue: number
  review_overdue: number
  tags_pending: number
  visibility_requests_pending: number
  sources_with_problems: number
  recent_events: {
    action: string
    target_type: string
    target_id: number | null
    actor_name: string | null
    created_at: string
    detail: Record<string, unknown>
  }[]
  overview: Record<string, number>
}

export interface AdminSkillItem {
  id: number
  name: string
  status: SkillStatus
  origin: 'internal' | 'imported'
  owner_id: number | null
  department: string | null
  visibility: 'company' | 'department'
  latest_version: string | null
  download_count: number
  install_count: number
  updated_at: string
}

export interface ImpactData {
  installed_users: number
  zip_users: number
  latest_after_revoke: string | null
}

export interface UserData {
  id: number
  email: string
  display_name: string
  role: Role
  department: string | null
}

export type TagStatus = 'pending' | 'approved' | 'rejected'

export interface AdminTagData {
  id: number
  name: string
  status: TagStatus
  usage_count: number
  proposed_by: number | null
  decided_by: number | null
  decided_at: string | null
}

export interface AuditItemData {
  id: number
  created_at: string
  actor_id: number | null
  actor_email: string | null
  actor_name: string | null
  action: string
  target_type: string
  target_id: number | null
  detail: Record<string, unknown>
}

export interface SourceData {
  id: number
  type: string
  name: string
  url: string
  ref: string | null
  path_glob: string
  default_category: number | null
  default_department: string
  default_visibility: 'company' | 'department'
  credential_name: string | null
  internal: boolean
  is_enabled: boolean
  last_scan_at: string | null
  last_scan_status: 'ok' | 'error' | null
  last_scan_message: string | null
  skill_count: number
}

export interface ScanItemData {
  path: string
  outcome: 'new_skill' | 'new_version' | 'unchanged' | 'skipped' | 'error'
  reason: string | null
  version?: string | null
  skill_id?: number | null
}

export interface ScanData {
  id: number
  source_id: number
  started_at: string
  finished_at: string | null
  status: 'running' | 'ok' | 'error'
  message: string | null
  commit: string | null
  counts: Record<string, number>
  items: ScanItemData[]
  total: number | null
}
