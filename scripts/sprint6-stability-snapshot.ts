import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import pg from 'pg'

type Snapshot = {
  time: string
  activeAgents: number
  errorAgents: number
  pendingApprovals: number
  webhookBacklog: number
  recentEvents10m: number
  openTickets: number
  crashFree: boolean
  health: 'G' | 'A' | 'R'
}

function ensureFile(path: string) {
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  if (!existsSync(path)) {
    writeFileSync(
      path,
      [
        '# Sprint 6 · 48h 稳定性快照（Day7-Day8）',
        '',
        '| 时间 | Active Agents | Error Agents | Pending Approvals | Webhook Backlog | Agent Events(10m) | Open Tickets | CrashFree | Health |',
        '|---|---:|---:|---:|---:|---:|---:|---|---|',
      ].join('\n') + '\n',
      'utf-8',
    )
  }
}

function classifyHealth(s: Omit<Snapshot, 'health'>): 'G' | 'A' | 'R' {
  if (s.activeAgents === 0 && s.errorAgents === 0) return 'A'
  if (s.errorAgents > 0) return 'R'
  if (s.activeAgents < 5) return 'R'
  if (s.webhookBacklog > 300) return 'R'
  if (s.pendingApprovals > 300) return 'R'
  if (s.webhookBacklog > 100 || s.pendingApprovals > 100) return 'A'
  return 'G'
}

async function main() {
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) throw new Error('DATABASE_URL is required')

  const outputPath = resolve(
    process.cwd(),
    process.env.SNAPSHOT_FILE ?? 'docs/ops/sprint6/evidence/metrics/day7-8-stability-snapshots.md',
  )
  ensureFile(outputPath)

  const client = new pg.Client({ connectionString: dbUrl })
  await client.connect()

  try {
    const activeAgents = await client.query(`select count(*)::int as v from agents where status = 'active'`)
    const errorAgents = await client.query(`select count(*)::int as v from agents where status = 'error'`)
    const pendingApprovals = await client.query(
      `select count(*)::int as v from approvals where status = 'pending'`,
    )
    const webhookBacklog = await client.query(
      `select count(*)::int as v from webhook_events where status <> 'processed'`,
    )
    const recentEvents10m = await client.query(
      `select count(*)::int as v from agent_events where created_at >= now() - interval '10 minutes'`,
    )
    const openTickets = await client.query(`select count(*)::int as v from devos_tickets where status = 'open'`)

    const base = {
      time: new Date().toISOString(),
      activeAgents: activeAgents.rows[0]?.v ?? 0,
      errorAgents: errorAgents.rows[0]?.v ?? 0,
      pendingApprovals: pendingApprovals.rows[0]?.v ?? 0,
      webhookBacklog: webhookBacklog.rows[0]?.v ?? 0,
      recentEvents10m: recentEvents10m.rows[0]?.v ?? 0,
      openTickets: openTickets.rows[0]?.v ?? 0,
      crashFree: (errorAgents.rows[0]?.v ?? 0) === 0,
    }

    const snapshot: Snapshot = {
      ...base,
      health: classifyHealth(base),
    }

    const row = `| ${snapshot.time} | ${snapshot.activeAgents} | ${snapshot.errorAgents} | ${snapshot.pendingApprovals} | ${snapshot.webhookBacklog} | ${snapshot.recentEvents10m} | ${snapshot.openTickets} | ${snapshot.crashFree ? 'yes' : 'no'} | ${snapshot.health} |`
    const current = readFileSync(outputPath, 'utf-8')
    writeFileSync(outputPath, `${current}${row}\n`, 'utf-8')

    console.log('[stability] snapshot appended:', outputPath)
    console.log('[stability] values:', JSON.stringify(snapshot))
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error('[stability] failed:', err)
  process.exit(1)
})
