import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')

const paperclipDir = process.env.PATIOER_PAPERCLIP_DIR ?? './paperclip'
const paperclipPackageJson = `${paperclipDir}/package.json`
const hasPaperclip = existsSync(paperclipPackageJson)

const run = (command, commandArgs) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      stdio: 'inherit',
    })
    child.on('exit', (code) => resolve(code ?? 0))
    child.on('error', reject)
  })

const main = async () => {
  if (dryRun) {
    if (hasPaperclip) {
      process.stdout.write(
        `[dev] dry-run: pnpm exec concurrently -n api,paperclip -c cyan,magenta "pnpm --filter @patioer/api dev" "pnpm --dir ${paperclipDir} dev"\n`,
      )
    } else {
      process.stdout.write(
        `[dev] dry-run: pnpm --filter @patioer/api dev (paperclip missing at ${paperclipPackageJson})\n`,
      )
    }
    return
  }

  if (!hasPaperclip) {
    process.stdout.write(
      `[dev] paperclip not found at ${paperclipPackageJson}; starting API only.\n`,
    )
    process.stdout.write(
      `[dev] to run both services, clone Paperclip into ${paperclipDir}.\n`,
    )

    const code = await run('pnpm', ['--filter', '@patioer/api', 'dev'])
    process.exit(code)
  }

  const code = await run('pnpm', [
    'exec',
    'concurrently',
    '-n',
    'api,paperclip',
    '-c',
    'cyan,magenta',
    'pnpm --filter @patioer/api dev',
    `pnpm --dir ${paperclipDir} dev`,
  ])
  process.exit(code)
}

main().catch((error) => {
  process.stderr.write(`[dev] failed to start: ${String(error)}\n`)
  process.exit(1)
})
