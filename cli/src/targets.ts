import { join, resolve } from 'node:path'
import type { Scope, Target } from './manifest.js'

const DIRS: Record<Target, string> = {
  'claude-code': '.claude/skills',
  cursor: '.cursor/skills',
}

export function isTarget(value: string): value is Target {
  return value === 'claude-code' || value === 'cursor'
}

/** Thư mục chứa các skill của một công cụ: toàn cục ở thư mục home, theo dự án ở thư mục làm việc. */
export function skillsRoot(target: Target, scope: Scope, opts: { home: string; cwd: string }): string {
  return resolve(scope === 'global' ? opts.home : opts.cwd, DIRS[target])
}

/** Tên thư mục an toàn từ tên skill: ASCII chữ thường, gạch nối; rỗng thì dùng skill-<id>. */
export function folderName(name: string, id: number): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '')
  return slug || `skill-${id}`
}

export const skillDir = (root: string, folder: string) => join(root, folder)
