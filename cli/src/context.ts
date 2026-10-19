import { homedir } from 'node:os'
import type { ApiClient } from './api.js'
import type { Manifest } from './manifest.js'

export interface Context {
  /** Thư mục dữ liệu của CLI (config, thông tin đăng nhập, manifest). */
  dir: string
  home: string
  cwd: string
  api: ApiClient
  manifest: Manifest
  log: (message: string) => void
  warn: (message: string) => void
}

export const defaultHome = () => process.env.SKILLMKT_TARGET_HOME ?? homedir()
