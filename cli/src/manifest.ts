import { dirname } from 'node:path'
import { manifestPath } from './paths.js'
import { readJson, writeJson } from './store.js'

export type Target = 'claude-code' | 'cursor'
export type Scope = 'global' | 'project'

export interface ManifestEntry {
  skill_id: number
  name: string
  version: string
  target: Target
  scope: Scope
  /** Đường dẫn tuyệt đối của thư mục đã giải nén. */
  path: string
  installed_at: string
  checksum: string | null
}

interface ManifestFile {
  version: 1
  items: ManifestEntry[]
}

/** Manifest trên máy (D11): cho phép `list` hoạt động khi offline; server vẫn là nguồn đối chiếu. */
export class Manifest {
  private constructor(
    private readonly file: string,
    public items: ManifestEntry[],
  ) {}

  static async load(dir: string): Promise<Manifest> {
    const file = manifestPath(dir)
    const data = await readJson<ManifestFile>(file)
    return new Manifest(file, data?.items ?? [])
  }

  find(skillId: number, target?: Target): ManifestEntry[] {
    return this.items.filter((i) => i.skill_id === skillId && (!target || i.target === target))
  }

  /** Một skill có thể cài ở nhiều nơi (toàn cục, hoặc mỗi dự án một bản): khoá theo thư mục chứa. */
  get(skillId: number, target: Target, scope: Scope, root: string): ManifestEntry | undefined {
    return this.items.find(
      (i) => i.skill_id === skillId && i.target === target && i.scope === scope && dirname(i.path) === root,
    )
  }

  pathTakenByOther(path: string, skillId: number): boolean {
    return this.items.some((i) => i.path === path && i.skill_id !== skillId)
  }

  upsert(entry: ManifestEntry): void {
    this.items = [
      ...this.items.filter(
        (i) =>
          !(
            i.skill_id === entry.skill_id &&
            i.target === entry.target &&
            i.scope === entry.scope &&
            dirname(i.path) === dirname(entry.path)
          ),
      ),
      entry,
    ]
  }

  remove(entry: ManifestEntry): void {
    this.items = this.items.filter((i) => i !== entry)
  }

  async save(): Promise<void> {
    await writeJson(this.file, { version: 1, items: this.items } satisfies ManifestFile, 0o644)
  }
}
