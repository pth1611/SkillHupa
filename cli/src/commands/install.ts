import { randomBytes } from 'node:crypto'
import { access, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { Context } from '../context.js'
import { ApiError, CliError } from '../errors.js'
import { extractZip, verifyChecksum } from '../extract.js'
import type { Scope, Target } from '../manifest.js'
import { folderName, skillsRoot } from '../targets.js'

export interface InstallOptions {
  id: number
  target: Target | 'zip'
  /** Số phiên bản cụ thể; mặc định `latest`. */
  version?: string
  project?: boolean
  force?: boolean
  /** Thư mục xuất file .zip khi `--target zip`. */
  out?: string
  /** Cài vào đúng thư mục chứa skill này (dùng khi cập nhật để giữ nguyên chỗ cũ). */
  root?: string
}

const exists = (path: string) => access(path).then(() => true, () => false)

export async function installSkill(ctx: Context, opts: InstallOptions): Promise<void> {
  const skill = await ctx.api.getSkill(opts.id).catch((error) => {
    if (error instanceof ApiError && error.status === 404) {
      throw new CliError(`Không tìm thấy skill ${opts.id} (hoặc bạn không có quyền xem).`)
    }
    throw error
  })
  const requested = opts.version ?? 'latest'
  const intent = opts.target === 'zip' ? 'zip' : 'install'
  const info = await ctx.api.download(opts.id, requested, intent).catch((error) => {
    if (error instanceof ApiError && error.code === 'VERSION_NOT_DOWNLOADABLE') {
      throw new CliError(`Phiên bản ${requested} của skill ${opts.id} đã bị thu hồi, không thể cài.`)
    }
    if (error instanceof ApiError && error.status === 404) {
      throw new CliError(`Skill ${opts.id} chưa có phiên bản ${requested} đang đăng.`)
    }
    throw error
  })
  const data = await ctx.api.bytes(info.url)
  verifyChecksum(data, info.checksum)

  if (opts.target === 'zip') {
    const dir = resolve(ctx.cwd, opts.out ?? '.')
    await mkdir(dir, { recursive: true })
    const file = join(dir, `${folderName(skill.name, skill.id)}-${info.version}.zip`)
    await writeFile(file, data)
    ctx.log(`Đã tải ${skill.name} ${info.version} → ${file}`)
    return
  }

  const target = opts.target
  const scope: Scope = opts.project ? 'project' : 'global'
  const root = opts.root ? resolve(opts.root) : skillsRoot(target, scope, { home: ctx.home, cwd: ctx.cwd })
  const own = ctx.manifest.get(opts.id, target, scope, root)
  let folder = folderName(skill.name, skill.id)
  if (ctx.manifest.pathTakenByOther(join(root, folder), opts.id)) folder = `${folder}-${skill.id}`
  const final = own ? own.path : join(root, folder)

  if ((await exists(final)) && !own && !opts.force) {
    throw new CliError(`Thư mục ${final} đã tồn tại và không do skillmkt cài. Dùng --force để ghi đè.`)
  }

  // Giải nén vào thư mục tạm cùng ổ đĩa rồi mới thay thế: lỗi giữa chừng không làm hỏng bản đang dùng.
  await mkdir(dirname(final), { recursive: true })
  const staging = join(dirname(final), `.skillmkt-new-${randomBytes(4).toString('hex')}`)
  const backup = join(dirname(final), `.skillmkt-old-${randomBytes(4).toString('hex')}`)
  try {
    await extractZip(data, staging)
    const had = await exists(final)
    if (had) await rename(final, backup)
    try {
      await rename(staging, final)
    } catch (error) {
      if (had) await rename(backup, final)
      throw error
    }
    if (had) await rm(backup, { recursive: true, force: true })
  } finally {
    await rm(staging, { recursive: true, force: true })
  }

  ctx.manifest.upsert({
    skill_id: skill.id,
    name: skill.name,
    version: info.version,
    target,
    scope,
    path: final,
    installed_at: new Date().toISOString(),
    checksum: info.checksum,
  })
  await ctx.manifest.save()

  try {
    await ctx.api.reportInstall(skill.id, info.version, target)
  } catch (error) {
    ctx.warn(
      `Đã cài nhưng chưa báo được về máy chủ (${error instanceof Error ? error.message : 'lỗi'}). ` +
        'Cảnh báo cập nhật/thu hồi có thể chưa hiện trên website.',
    )
  }
  ctx.log(`Đã cài ${skill.name} ${info.version} → ${final}`)
}

