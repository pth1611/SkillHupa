import { homedir } from 'node:os'
import { join } from 'node:path'

/** Thư mục dữ liệu của CLI; SKILLMKT_HOME dùng cho test và máy dùng chung. */
export function dataDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.SKILLMKT_HOME ? env.SKILLMKT_HOME : join(homedir(), '.skillmkt')
}

export const configPath = (dir: string) => join(dir, 'config.json')
export const credentialsPath = (dir: string) => join(dir, 'credentials.json')
export const manifestPath = (dir: string) => join(dir, 'installed.json')
