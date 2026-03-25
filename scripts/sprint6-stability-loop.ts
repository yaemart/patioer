import { spawnSync } from 'node:child_process'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is required')

  const iterationsRaw = process.env.ITERATIONS ?? '8'
  const intervalSecRaw = process.env.INTERVAL_SEC ?? '21600'
  const iterations = Number.parseInt(iterationsRaw, 10)
  const intervalSec = Number.parseInt(intervalSecRaw, 10)

  if (!Number.isFinite(iterations) || iterations <= 0) {
    throw new Error('ITERATIONS must be a positive integer')
  }
  if (!Number.isFinite(intervalSec) || intervalSec <= 0) {
    throw new Error('INTERVAL_SEC must be a positive integer')
  }

  for (let i = 1; i <= iterations; i += 1) {
    console.log(`[stability-loop] snapshot ${i}/${iterations}`)
    const run = spawnSync('pnpm', ['ops:sprint6:stability:snapshot'], {
      env: process.env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })

    if (run.status !== 0) {
      throw new Error(`snapshot command failed at iteration ${i}`)
    }

    if (i < iterations) {
      console.log(`[stability-loop] sleeping ${intervalSec}s`)
      await sleep(intervalSec * 1000)
    }
  }

  console.log('[stability-loop] completed')
}

main().catch((err) => {
  console.error('[stability-loop] failed:', err)
  process.exit(1)
})
