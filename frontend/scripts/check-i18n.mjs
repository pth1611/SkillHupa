// Kiểm tra vi.json và en.json có đúng cùng bộ khoá (pipeline.md, CI frontend).
import { readFileSync } from 'node:fs'

const load = (name) => JSON.parse(readFileSync(new URL(`../src/i18n/${name}.json`, import.meta.url), 'utf8'))

function flatten(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) =>
    v !== null && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  )
}

const vi = new Set(flatten(load('vi')))
const en = new Set(flatten(load('en')))
const missingEn = [...vi].filter((k) => !en.has(k))
const missingVi = [...en].filter((k) => !vi.has(k))

if (missingEn.length || missingVi.length) {
  if (missingEn.length) console.error('Thiếu trong en.json:\n  ' + missingEn.join('\n  '))
  if (missingVi.length) console.error('Thiếu trong vi.json:\n  ' + missingVi.join('\n  '))
  process.exit(1)
}
console.log(`i18n: ${vi.size} khoá, hai ngôn ngữ khớp nhau.`)
