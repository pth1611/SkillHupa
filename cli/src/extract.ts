import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { unzipSync } from 'fflate'
import { CliError } from './errors.js'

const MAX_FILES = 500
const MAX_TOTAL_BYTES = 100 * 1024 * 1024

export function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/** So sánh băm; `expected` có thể ở dạng `sha256:<hex>`. */
export function verifyChecksum(data: Uint8Array, expected: string | null): void {
  if (!expected) return
  const want = expected.replace(/^sha256:/i, '').toLowerCase()
  if (sha256(data) !== want) {
    throw new CliError('Gói tải về không khớp checksum; đã dừng, không giải nén.')
  }
}

/** Đường dẫn trong gói có an toàn để ghi không (chặn path traversal, đường dẫn tuyệt đối, ổ đĩa Windows). */
export function isSafeEntryPath(name: string): boolean {
  if (!name || name.includes('\0') || name.includes('\\')) return false
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return false
  return !name.split('/').some((part) => part === '..')
}

/** Gói có một thư mục gốc duy nhất chứa SKILL.md thì bỏ tiền tố đó (giống backend). */
export function detectPrefix(names: string[]): string {
  if (names.includes('SKILL.md')) return ''
  const roots = new Set(names.map((n) => n.split('/')[0]))
  if (roots.size === 1) {
    const root = [...roots][0]
    if (names.includes(`${root}/SKILL.md`)) return `${root}/`
  }
  return ''
}

export interface Extracted {
  files: number
  bytes: number
}

/** Giải nén vào `dest` (thư mục phải chưa tồn tại hoặc rỗng; người gọi lo thay thế nguyên tử). */
export async function extractZip(data: Uint8Array, dest: string): Promise<Extracted> {
  let total = 0
  let count = 0
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(data, {
      filter(file) {
        if (file.name.endsWith('/')) return false
        count += 1
        total += file.originalSize
        if (count > MAX_FILES) throw new CliError(`Gói có quá nhiều file (>${MAX_FILES}).`)
        if (total > MAX_TOTAL_BYTES) throw new CliError('Gói giải nén quá lớn.')
        return true
      },
    })
  } catch (error) {
    if (error instanceof CliError) throw error
    throw new CliError('Gói .zip bị hỏng hoặc không đọc được.')
  }

  const names = Object.keys(entries)
  for (const name of names) {
    if (!isSafeEntryPath(name)) throw new CliError(`Gói chứa đường dẫn không an toàn: ${name}`)
  }
  const prefix = detectPrefix(names)
  if (!names.includes(`${prefix}SKILL.md`)) throw new CliError('Gói không có SKILL.md.')

  const base = resolve(dest)
  await mkdir(base, { recursive: true })
  let bytes = 0
  for (const name of names) {
    const rel = prefix ? name.slice(prefix.length) : name
    if (!rel) continue
    if (prefix && !name.startsWith(prefix)) continue // file ngoài thư mục gốc đã chọn
    const target = resolve(join(base, rel))
    if (target !== base && !target.startsWith(base + sep)) {
      throw new CliError(`Gói chứa đường dẫn không an toàn: ${name}`)
    }
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, entries[name], { mode: 0o644 }) // không giữ bit thực thi từ gói
    bytes += entries[name].length
  }
  return { files: names.length, bytes }
}
