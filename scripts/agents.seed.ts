import {
  defaultAgentSpecs,
  seedDefaultAgents,
  type SeedAgentsInput,
} from '../apps/api/src/lib/seed-default-agents.js'

export { defaultAgentSpecs, seedDefaultAgents, type SeedAgentsInput }

function parseArgv(argv: string[]): { tenantId: string; dryRun: boolean } {
  const dryRun = argv.includes('--dry-run')
  const rest = argv.filter((a) => a !== '--dry-run')
  const tenantId = rest[0] ?? ''
  return { tenantId, dryRun }
}

async function main(): Promise<void> {
  const { tenantId, dryRun } = parseArgv(process.argv.slice(2))
  const result = await seedDefaultAgents({ tenantId, dryRun })
  console.log(JSON.stringify(result, null, 2))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
