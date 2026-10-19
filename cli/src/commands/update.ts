import { dirname } from 'node:path'
import type { Context } from '../context.js'
import { CliError } from '../errors.js'
import { installSkill } from './install.js'
import { inspect, nextStep, describe } from './list.js'

/** Người dùng chủ động cập nhật lên bản `latest` (D12); không bao giờ chạy ngầm. */
export async function updateCommand(ctx: Context, id?: number): Promise<void> {
  const { rows, online } = await inspect(ctx)
  if (!online) throw new CliError('Không kết nối được máy chủ; không thể cập nhật.')
  const scoped = id === undefined ? rows : rows.filter((r) => r.entry.skill_id === id)
  if (id !== undefined && scoped.length === 0) throw new CliError(`Skill ${id} chưa được cài bằng skillmkt.`)

  let updated = 0
  for (const row of scoped) {
    if (row.state === 'update_available' || row.state === 'revoked') {
      ctx.log(`Cập nhật ${row.entry.name}: ${row.entry.version} → ${row.latest ?? 'mới nhất'}`)
      await installSkill(ctx, {
        id: row.entry.skill_id,
        target: row.entry.target,
        project: row.entry.scope === 'project',
        root: dirname(row.entry.path),
      })
      updated += 1
    } else if (row.state === 'removed' || row.state === 'no_access') {
      ctx.warn(`${describe(row)}\n        → ${nextStep(row)}`)
    }
  }
  if (updated === 0) ctx.log('Không có skill nào cần cập nhật.')
}
