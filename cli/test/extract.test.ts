import { mkdtemp, readFile, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CliError } from '../src/errors.js'
import { detectPrefix, extractZip, isSafeEntryPath, verifyChecksum } from '../src/extract.js'
import { folderName, skillsRoot } from '../src/targets.js'
import { makeZip, sha } from './helpers.js'

const tmp = () => mkdtemp(join(tmpdir(), 'skillmkt-x-'))

describe('isSafeEntryPath', () => {
  it.each(['SKILL.md', 'scripts/run.sh', 'a/b/c.txt'])('chấp nhận %s', (p) => expect(isSafeEntryPath(p)).toBe(true))
  it.each(['../evil', 'a/../../evil', '/etc/passwd', 'C:/x', 'a\\b', '', 'a\0b'])('chặn %j', (p) =>
    expect(isSafeEntryPath(p)).toBe(false),
  )
})

describe('detectPrefix', () => {
  it('bỏ thư mục gốc duy nhất chứa SKILL.md', () => {
    expect(detectPrefix(['my-skill/SKILL.md', 'my-skill/a.txt'])).toBe('my-skill/')
    expect(detectPrefix(['SKILL.md', 'a.txt'])).toBe('')
    expect(detectPrefix(['a/SKILL.md', 'b/x'])).toBe('')
  })
})

describe('extractZip', () => {
  it('giải nén nguyên gói và bỏ thư mục gốc bọc ngoài', async () => {
    const dest = join(await tmp(), 'out')
    await extractZip(makeZip({ 'skill-x/SKILL.md': '# hi', 'skill-x/scripts/run.sh': 'echo' }), dest)
    expect((await readdir(dest)).sort()).toEqual(['SKILL.md', 'scripts'])
    expect(await readFile(join(dest, 'scripts/run.sh'), 'utf8')).toBe('echo')
  })

  it.skipIf(process.platform === 'win32')('không giữ bit thực thi từ gói', async () => {
    const dest = join(await tmp(), 'out')
    await extractZip(makeZip({ 'SKILL.md': '#', 'run.sh': 'x' }), dest)
    expect((await stat(join(dest, 'run.sh'))).mode & 0o111).toBe(0)
  })

  it('từ chối path traversal và không ghi gì ra ngoài', async () => {
    const root = await tmp()
    const dest = join(root, 'out')
    await expect(extractZip(makeZip({ 'SKILL.md': '#', '../escape.txt': 'x' }), dest)).rejects.toBeInstanceOf(CliError)
    await expect(readFile(join(root, 'escape.txt'))).rejects.toThrow()
  })

  it('yêu cầu có SKILL.md', async () => {
    await expect(extractZip(makeZip({ 'README.md': 'x' }), join(await tmp(), 'o'))).rejects.toThrow(/SKILL\.md/)
  })

  it('từ chối gói hỏng và gói quá nhiều file', async () => {
    await expect(extractZip(new Uint8Array([1, 2, 3]), join(await tmp(), 'o'))).rejects.toThrow(/hỏng/)
    const many = Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`f${i}.txt`, 'x']))
    await expect(extractZip(makeZip({ 'SKILL.md': '#', ...many }), join(await tmp(), 'o'))).rejects.toThrow(/quá nhiều file/)
  })
})

describe('verifyChecksum', () => {
  it('khớp và không khớp', () => {
    const data = new Uint8Array([1, 2, 3])
    expect(() => verifyChecksum(data, `sha256:${sha(data)}`)).not.toThrow()
    expect(() => verifyChecksum(data, sha(data).toUpperCase())).not.toThrow()
    expect(() => verifyChecksum(data, 'sha256:' + '0'.repeat(64))).toThrow(/checksum/)
    expect(() => verifyChecksum(data, null)).not.toThrow()
  })
})

describe('targets', () => {
  it('đặt tên thư mục an toàn từ tên tiếng Việt', () => {
    expect(folderName('Báo cáo tuần', 1)).toBe('bao-cao-tuan')
    expect(folderName('Đổi tên — ../../x', 2)).toBe('doi-ten-x')
    expect(folderName('???', 7)).toBe('skill-7')
  })

  it('thư mục gốc theo công cụ và phạm vi', () => {
    const opts = { home: '/home/u', cwd: '/work/p' }
    expect(skillsRoot('claude-code', 'global', opts)).toBe(resolve('/home/u', '.claude/skills'))
    expect(skillsRoot('cursor', 'project', opts)).toBe(resolve('/work/p', '.cursor/skills'))
  })
})
