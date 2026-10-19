import { rm } from 'node:fs/promises'
import { basename, dirname, resolve, sep } from 'node:path'
import type { Context } from '../context.js'
import { ApiError, CliError } from '../errors.js'
import type { ManifestEntry, Scope, Target } from '../manifest.js'

/** Chỉ xoá thư mục nằm trực tiếp trong `.claude/skills` hoặc `.cursor/skills`, phòng manifest bị sửa. */
export function isManagedPath(path: string): boolean {
  const parent = dirname(path)
  const grand = basename(dirname(parent))
  return (basename(parent) === 'skills' && (grand === '.claude' || grand === '.cursor')) && basename(path) !== ''
}

export async function uninstallCommand(
  ctx: Context,
  id: number,
  opts: { target?: Target; project?: boolean } = {},
): Promise<void> {
  const scope: Scope | undefined = opts.project === undefined ? undefined : opts.project ? 'project' : 'global'
  const entries: ManifestEntry[] = ctx.manifest
    .find(id, opts.target)
    .filter((e) => scope === undefined || e.scope === scope)
    // `--project` chỉ gỡ bản của dự án đang đứng, không đụng dự án khác.
    .filter((e) => e.scope !== 'project' || e.path.startsWith(resolve(ctx.cwd) + sep))
  if (entries.length === 0) throw new CliError(`Skill ${id} chưa được cài bằng skillmkt.`)

  for (const entry of entries) {
    if (!isManagedPath(entry.path)) {
      throw new CliError(`Từ chối xoá ${entry.path}: không nằm trong thư mục skills của công cụ.`)
    }
    await rm(entry.path, { recursive: true, force: true })
    ctx.manifest.remove(entry)
    await ctx.manifest.save()
    try {
      await ctx.api.reportUninstall(id, entry.target)
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) {
        ctx.warn('Đã gỡ trên máy nhưng chưa báo được về máy chủ.')
      }
    }
    ctx.log(`Đã gỡ ${entry.name} khỏi ${entry.path}`)
  }
}
