import {
  createDevOsClient,
  isDevOsBridgeConfigured,
  loadDevOsBridgeEnv,
  probeDevOsHttpBaseUrl,
} from '../packages/devos-bridge/src/index.js'
import { runDevOsSeed } from '../packages/devos-bridge/src/devos-seed.js'

function parseArgv(argv: string[]): { dryRun: boolean; skipProbe: boolean } {
  return {
    dryRun: argv.includes('--dry-run'),
    skipProbe: argv.includes('--skip-probe'),
  }
}

async function main(): Promise<void> {
  const { dryRun, skipProbe } = parseArgv(process.argv.slice(2))
  const env = loadDevOsBridgeEnv(process.env)
  if (!isDevOsBridgeConfigured(env)) {
    console.error(
      'Missing or invalid DEVOS_BASE_URL. Example: DEVOS_BASE_URL=http://localhost:3200',
    )
    process.exit(1)
  }

  if (!dryRun && !skipProbe) {
    const ok = await probeDevOsHttpBaseUrl(env.baseUrl)
    if (!ok) {
      console.error(
        'DevOS base URL not reachable (GET /). Start docker-compose.devos.yml or pass --skip-probe.',
      )
      process.exit(1)
    }
  }

  const client = createDevOsClient({
    baseUrl: env.baseUrl,
    apiKey: env.apiKey,
  })
  const result = await runDevOsSeed({ client, dryRun })
  console.log(JSON.stringify(result, null, 2))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
