#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { Command, InvalidArgumentError } from 'commander'
import { ApiClient } from './api.js'
import { authProvider } from './auth.js'
import { loginCommand, logoutCommand, whoamiCommand } from './commands/auth.js'
import { installSkill } from './commands/install.js'
import { listCommand, outdatedCommand } from './commands/list.js'
import { uninstallCommand } from './commands/uninstall.js'
import { updateCommand } from './commands/update.js'
import { loadConfig, normalizeServer } from './config.js'
import { defaultHome, type Context } from './context.js'
import { ApiError, CliError } from './errors.js'
import { Manifest } from './manifest.js'
import { dataDir } from './paths.js'
import { isTarget } from './targets.js'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }

const parseId = (value: string): number => {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw new InvalidArgumentError('skill phải là số nguyên dương (id trên website)')
  return id
}

async function buildContext(): Promise<Context> {
  const dir = dataDir()
  const config = await loadConfig(dir)
  if (!config.server) throw new CliError('Chưa cấu hình máy chủ. Chạy: skillmkt login --server https://<địa-chỉ>')
  const auth = await authProvider(dir, config)
  return {
    dir,
    home: defaultHome(),
    cwd: process.cwd(),
    api: new ApiClient(normalizeServer(config.server), auth, pkg.version),
    manifest: await Manifest.load(dir),
    log: (m) => console.log(m),
    warn: (m) => console.error(`! ${m}`),
  }
}

const program = new Command()
program
  .name('skillmkt')
  .description('Cài và cập nhật skill từ Skill Marketplace nội bộ')
  .version(pkg.version)
  .showHelpAfterError()

program
  .command('login')
  .description('Đăng nhập bằng tài khoản công ty (device code)')
  .option('--server <url>', 'địa chỉ máy chủ marketplace')
  .option('--dev', 'đăng nhập thử, chỉ khi máy chủ bật DEV_LOGIN_ENABLED')
  .option('--email <email>', 'email (dùng với --dev)')
  .option('--role <role>', 'vai trò (dùng với --dev)')
  .option('--department <name>', 'phòng ban (dùng với --dev)')
  .action(async (opts) => {
    await loginCommand(dataDir(), opts, { log: (m) => console.log(m), clientVersion: pkg.version })
  })

program
  .command('logout')
  .description('Xoá thông tin đăng nhập trên máy')
  .action(async () => logoutCommand(dataDir(), (m) => console.log(m)))

program
  .command('whoami')
  .description('Cho biết bạn đang đăng nhập là ai')
  .action(async () => {
    const ctx = await buildContext()
    await whoamiCommand(ctx.dir, ctx.api, ctx.log)
  })

program
  .command('install')
  .description('Cài một skill')
  .argument('<skill>', 'id skill (xem trên trang chi tiết)', parseId)
  .option('-t, --target <target>', 'claude-code | cursor | zip', 'claude-code')
  .option('-v, --version <version>', 'phiên bản cụ thể (mặc định: mới nhất)')
  .option('-p, --project', 'cài theo dự án (thư mục hiện tại) thay vì toàn cục')
  .option('-f, --force', 'ghi đè thư mục đã có mà skillmkt không quản lý')
  .option('-o, --out <dir>', 'thư mục lưu file .zip (với --target zip)')
  .action(async (id: number, opts) => {
    if (opts.target !== 'zip' && !isTarget(opts.target)) {
      throw new CliError(`--target phải là claude-code, cursor hoặc zip (nhận: ${opts.target})`)
    }
    await installSkill(await buildContext(), {
      id,
      target: opts.target,
      version: opts.version,
      project: opts.project,
      force: opts.force,
      out: opts.out,
    })
  })

program.command('list').description('Liệt kê skill đã cài trên máy').action(async () => listCommand(await buildContext()))

program
  .command('outdated')
  .description('Liệt kê skill có bản mới, bị thu hồi hoặc đã gỡ (không thay đổi gì)')
  .action(async () => {
    process.exitCode = await outdatedCommand(await buildContext())
  })

program
  .command('update')
  .description('Cập nhật lên bản mới nhất (tất cả hoặc một skill)')
  .argument('[skill]', 'id skill', parseId)
  .action(async (id?: number) => updateCommand(await buildContext(), id))

program
  .command('uninstall')
  .description('Gỡ một skill khỏi máy')
  .argument('<skill>', 'id skill', parseId)
  .option('-t, --target <target>', 'claude-code | cursor (mặc định: mọi nơi đã cài)')
  .option('-p, --project', 'chỉ bản theo dự án trong thư mục hiện tại')
  .action(async (id: number, opts) => {
    if (opts.target !== undefined && !isTarget(opts.target)) {
      throw new CliError(`--target phải là claude-code hoặc cursor (nhận: ${opts.target})`)
    }
    await uninstallCommand(await buildContext(), id, { target: opts.target, project: opts.project })
  })

try {
  await program.parseAsync(process.argv)
} catch (error) {
  if (error instanceof CliError) {
    console.error(`Lỗi: ${error.message}`)
    process.exitCode = error.exitCode
  } else if (error instanceof ApiError) {
    console.error(`Lỗi từ máy chủ (${error.status}): ${error.message}`)
    process.exitCode = 1
  } else {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
