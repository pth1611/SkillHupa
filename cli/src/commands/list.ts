import type { CheckResult } from '../api.js'
import type { Context } from '../context.js'
import type { ManifestEntry } from '../manifest.js'
import { ApiError, CliError } from '../errors.js'

export type EntryState = CheckResult['state'] | 'unknown'

export interface Row {
  entry: ManifestEntry
  state: EntryState
  latest: string | null
}

/** Đối chiếu manifest với máy chủ; offline thì trả trạng thái `unknown` và `online=false`. */
export async function inspect(ctx: Context): Promise<{ rows: Row[]; online: boolean }> {
  const entries = ctx.manifest.items
  if (entries.length === 0) return { rows: [], online: true }
  try {
    const results = await ctx.api.check(entries.map((e) => ({ skill_id: e.skill_id, version: e.version })))
    const rows = entries.map((entry, index) => ({
      entry,
      state: results[index]?.state ?? ('unknown' as const),
      latest: results[index]?.latest_version ?? null,
    }))
    return { rows, online: true }
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (error instanceof CliError && /đăng nhập/.test(error.message)) throw error
    return { rows: entries.map((entry) => ({ entry, state: 'unknown' as const, latest: null })), online: false }
  }
}

const LABEL: Record<EntryState, string> = {
  up_to_date: 'mới nhất',
  update_available: 'có bản mới',
  revoked: 'BỊ THU HỒI',
  removed: 'ĐÃ BỊ GỠ',
  no_access: 'MẤT QUYỀN',
  unknown: '?',
}

export function describe(row: Row): string {
  const { entry } = row
  const arrow = row.state === 'update_available' && row.latest ? ` → ${row.latest}` : ''
  return `${String(entry.skill_id).padStart(4)}  ${entry.name}  ${entry.version}${arrow}  [${entry.target}/${entry.scope}]  ${LABEL[row.state]}`
}

export function nextStep(row: Row): string | null {
  const { entry } = row
  const project = entry.scope === 'project' ? ' --project' : ''
  switch (row.state) {
    case 'update_available':
    case 'revoked':
      return `skillmkt update ${entry.skill_id}`
    case 'removed':
    case 'no_access':
      return `skillmkt uninstall ${entry.skill_id} --target ${entry.target}${project}`
    default:
      return null
  }
}

export async function listCommand(ctx: Context): Promise<void> {
  const { rows, online } = await inspect(ctx)
  if (rows.length === 0) {
    ctx.log('Chưa cài skill nào bằng skillmkt.')
    return
  }
  for (const row of rows) ctx.log(describe(row))
  if (!online) ctx.warn('Không kết nối được máy chủ nên chưa biết trạng thái cập nhật.')
}

export async function outdatedCommand(ctx: Context): Promise<number> {
  const { rows, online } = await inspect(ctx)
  if (!online) {
    ctx.warn('Không kết nối được máy chủ; không thể kiểm tra bản mới.')
    return 2
  }
  const pending = rows.filter((r) => r.state !== 'up_to_date' && r.state !== 'unknown')
  if (pending.length === 0) {
    ctx.log('Mọi skill đã cài đều là bản mới nhất.')
    return 0
  }
  for (const row of pending) {
    ctx.log(describe(row))
    const step = nextStep(row)
    if (step) ctx.log(`        → ${step}`)
  }
  return 0
}
