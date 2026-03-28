/**
 * Phase 4 DevOS 12-Agent 完整种子脚本
 *
 * 用法：
 *   pnpm devos:seed-full                    # 实际执行
 *   pnpm devos:seed-full --dry-run          # 仅打印，不发请求
 *   pnpm devos:seed-full --skip-probe       # 跳过连通性检查
 *
 * 前提：
 *   - DEVOS_BASE_URL 已设置（如 http://localhost:3200）
 *   - Paperclip DevOS 实例已启动（docker-compose.devos.yml）
 *
 * 执行后验收：
 *   - AC-P4-11: Paperclip Dashboard → 12 Agent 全部 ACTIVE
 *   - AC-P4-12: Codebase Intel 查询 "Price Sentinel 在哪个文件？" → 返回 price-sentinel.agent.ts
 */
import {
  createDevOsClient,
  isDevOsBridgeConfigured,
  loadDevOsBridgeEnv,
  probeDevOsHttpBaseUrl,
  buildSreBootstrapTicket,
  DEVOS_ENGINEERING_ORG,
  DEVOS_FULL_SEED,
  DEVOS_MONTHLY_BUDGET_USD,
} from '../packages/devos-bridge/src/index.js'

function parseArgv(argv: string[]): { dryRun: boolean; skipProbe: boolean } {
  return {
    dryRun: argv.includes('--dry-run'),
    skipProbe: argv.includes('--skip-probe'),
  }
}

async function main(): Promise<void> {
  const { dryRun, skipProbe } = parseArgv(process.argv.slice(2))

  console.log('=== Phase 4 DevOS 12-Agent Full Seed ===')
  console.log(`Agents: ${DEVOS_FULL_SEED.length}`)
  console.log(`Monthly budget: $${DEVOS_MONTHLY_BUDGET_USD}`)
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`)
  console.log()

  for (const agent of DEVOS_FULL_SEED) {
    console.log(`  ${agent.id.padEnd(20)} ${agent.model.padEnd(20)} ${agent.trigger.padEnd(15)} $${agent.monthlyBudgetUsd}/mo`)
  }
  console.log()

  if (dryRun) {
    console.log('[dry-run] Skipping actual registration. Pass without --dry-run to execute.')
    return
  }

  const env = loadDevOsBridgeEnv(process.env)
  if (!isDevOsBridgeConfigured(env)) {
    console.error('Missing or invalid DEVOS_BASE_URL. Example: DEVOS_BASE_URL=http://localhost:3200')
    process.exit(1)
  }

  if (!skipProbe) {
    console.log(`Probing DevOS at ${env.baseUrl} ...`)
    const ok = await probeDevOsHttpBaseUrl(env.baseUrl)
    if (!ok) {
      console.error('DevOS base URL not reachable. Start docker-compose.devos.yml or pass --skip-probe.')
      process.exit(1)
    }
    console.log('DevOS reachable ✅')
  }

  const client = createDevOsClient({
    baseUrl: env.baseUrl,
    apiKey: env.apiKey,
  })

  console.log('Creating bootstrap ticket with full 12-Agent org chart ...')
  const ticket = buildSreBootstrapTicket(DEVOS_ENGINEERING_ORG)
  const { ticketId } = await client.createTicket(ticket)
  console.log(`Bootstrap ticket created: ${ticketId} ✅`)

  console.log()
  console.log('=== Next Steps ===')
  console.log('1. Open Paperclip Dashboard → DevOS instance')
  console.log('2. Verify all 12 agents show ACTIVE status (AC-P4-11)')
  console.log('3. Test Codebase Intel: "Price Sentinel 在哪个文件？" → price-sentinel.agent.ts (AC-P4-12)')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
