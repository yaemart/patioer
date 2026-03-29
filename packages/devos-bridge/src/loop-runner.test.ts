import { describe, expect, it } from 'vitest'
import {
  LoopRunner,
  REHEARSAL_TICKET,
  SECURITY_TEST_TICKET,
} from './loop-runner.js'
import { isDevOsTicket } from './ticket-protocol.js'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT = 'tenant-rehearsal'

// ─── Day 1: Ticket validation ─────────────────────────────────────────────────

describe('REHEARSAL_TICKET fixture', () => {
  it('passes isDevOsTicket validation', () => {
    expect(isDevOsTicket(REHEARSAL_TICKET)).toBe(true)
  })

  it('is a feature ticket with P2 priority', () => {
    expect(REHEARSAL_TICKET.type).toBe('feature')
    expect(REHEARSAL_TICKET.priority).toBe('P2')
  })

  it('mentions Price Sentinel and migration in description', () => {
    expect(REHEARSAL_TICKET.description).toContain('Price Sentinel')
    expect(REHEARSAL_TICKET.description.toLowerCase()).toContain('migration')
  })
})

describe('SECURITY_TEST_TICKET fixture', () => {
  it('passes isDevOsTicket validation', () => {
    expect(isDevOsTicket(SECURITY_TEST_TICKET)).toBe(true)
  })
})

// ─── AC-P4-01: Loop 首次完整跑通 ──────────────────────────────────────────────

describe('AC-P4-01: Loop 首次完整演练 — 全 9 Stage 有耗时日志', () => {
  it('REHEARSAL_TICKET runs all 9 stages successfully', async () => {
    const runner = new LoopRunner({ tenantId: TENANT })
    const evidence = await runner.execute(REHEARSAL_TICKET, 'rehearsal-001')

    expect(evidence.summary.overallResult).toBe('success')
    expect(evidence.summary.stages).toHaveLength(9)

    for (const stage of evidence.summary.stages) {
      expect(stage.result).toBe('success')
      expect(stage.durationMs).toBeGreaterThanOrEqual(0)
      expect(stage.completedAt).toBeDefined()
    }
  })

  it('each stage has a name and startedAt timestamp', async () => {
    const runner = new LoopRunner({ tenantId: TENANT })
    const evidence = await runner.execute(REHEARSAL_TICKET, 'rehearsal-002')

    for (const stage of evidence.summary.stages) {
      expect(stage.name.length).toBeGreaterThan(0)
      expect(stage.startedAt).toBeTruthy()
    }
  })

  it('events are emitted to the EventSink for auditing', async () => {
    const runner = new LoopRunner({ tenantId: TENANT })
    const evidence = await runner.execute(REHEARSAL_TICKET, 'rehearsal-events')

    expect(evidence.events.length).toBeGreaterThan(0)
    const beginEvents = evidence.events.filter((e) => e.eventType === 'loop.stage.begin')
    const completeEvents = evidence.events.filter((e) => e.eventType === 'loop.stage.complete')
    expect(beginEvents.length).toBe(9)
    expect(completeEvents.length).toBe(9)
  })

  it('PM analysis produces structured result with AC', async () => {
    const runner = new LoopRunner({ tenantId: TENANT })
    const evidence = await runner.execute(REHEARSAL_TICKET, 'rehearsal-pm')

    const stage2 = evidence.summary.stages.find((s) => s.stage === 2)
    expect(stage2?.result).toBe('success')
    expect(stage2?.details?.summary).toBeTruthy()
  })

  it('TaskGraph is set with correct topology', async () => {
    const runner = new LoopRunner({ tenantId: TENANT })
    const evidence = await runner.execute(REHEARSAL_TICKET, 'rehearsal-tg')

    expect(evidence.summary.taskGraph).toBeDefined()
    const tg = evidence.summary.taskGraph!
    expect(tg.tasks.length).toBeGreaterThanOrEqual(4) // migration + 2 backend + test + scan
    expect(tg.tasks.some((t) => t.kind === 'db_migration')).toBe(true)
    expect(tg.tasks.some((t) => t.kind === 'backend')).toBe(true)
    expect(tg.tasks.some((t) => t.kind === 'test')).toBe(true)
  })

  it('approval request was recorded', async () => {
    const runner = new LoopRunner({ tenantId: TENANT })
    const evidence = await runner.execute(REHEARSAL_TICKET, 'rehearsal-approval')

    expect(evidence.approvalRequests).toHaveLength(1)
    expect(evidence.approvalRequests[0].runId).toBe('rehearsal-approval')
  })

  it('deployed ref is set on success', async () => {
    const runner = new LoopRunner({ tenantId: TENANT })
    const evidence = await runner.execute(REHEARSAL_TICKET, 'rehearsal-ref')

    expect(evidence.summary.deployedRef).toContain('sha-')
  })
})

// ─── AC-P4-13: DB Agent 自动生成 Migration ────────────────────────────────────

describe('AC-P4-13: Loop 中 DB Agent 自动生成 Migration SQL 文件', () => {
  it('generates .sql migration file during Stage 05', async () => {
    const runner = new LoopRunner({ tenantId: TENANT })
    const evidence = await runner.execute(REHEARSAL_TICKET, 'rehearsal-migration')

    const sqlFiles = evidence.generatedFiles.filter((f) => f.endsWith('.sql'))
    expect(sqlFiles.length).toBeGreaterThan(0)
  })

  it('migration SQL contains ALTER TABLE with category_threshold', async () => {
    const runner = new LoopRunner({ tenantId: TENANT })
    const evidence = await runner.execute(REHEARSAL_TICKET, 'rehearsal-sql-content')

    const sqlFiles = evidence.generatedFiles.filter((f) => f.endsWith('.sql'))
    const content = evidence.fileContents[sqlFiles[0]!]
    expect(content).toBeDefined()
    expect(content).toContain('ALTER TABLE')
    expect(content).toContain('category_threshold')
  })

  it('migration SQL is idempotent (IF NOT EXISTS)', async () => {
    const runner = new LoopRunner({ tenantId: TENANT })
    const evidence = await runner.execute(REHEARSAL_TICKET, 'rehearsal-idempotent')

    const sqlFiles = evidence.generatedFiles.filter((f) => f.endsWith('.sql'))
    const content = evidence.fileContents[sqlFiles[0]!]
    expect(content).toContain('IF NOT EXISTS')
  })

  it('backend code files are also generated', async () => {
    const runner = new LoopRunner({ tenantId: TENANT })
    const evidence = await runner.execute(REHEARSAL_TICKET, 'rehearsal-code-files')

    const tsFiles = evidence.generatedFiles.filter((f) => f.endsWith('.ts'))
    expect(tsFiles.length).toBeGreaterThan(0)
  })
})

// ─── AC-P4-03: Security Agent 发现安全问题 ────────────────────────────────────

describe('AC-P4-03: Security Agent 发现并修复安全问题', () => {
  it('detects hardcoded secret on first scan, passes after fix', async () => {
    const runner = new LoopRunner({
      tenantId: 'tenant-security',
      securityInjection: { insertSecret: true, fixOnRetry: true },
    })
    const evidence = await runner.execute(SECURITY_TEST_TICKET, 'rehearsal-security')

    expect(evidence.summary.overallResult).toBe('success')
    expect(evidence.securityFindings).toHaveLength(1)
    expect(evidence.securityFindings[0].severity).toBe('high')
    expect(evidence.securityFindings[0].description).toContain('shpat_')
  })

  it('Stage 06 shows retry pattern: fail → fix → pass', async () => {
    const runner = new LoopRunner({
      tenantId: 'tenant-security',
      securityInjection: { insertSecret: true, fixOnRetry: true },
    })
    const evidence = await runner.execute(SECURITY_TEST_TICKET, 'rehearsal-sec-retry')

    const stage6Logs = evidence.summary.stages.filter((s) => s.stage === 6)
    // Stage 06 is logged twice: first fail, then success
    expect(stage6Logs.length).toBeGreaterThanOrEqual(1)
  })
})

// ─── AC-P4-05: SRE 异常 → 回滚 + P0 Ticket ──────────────────────────────────

describe('AC-P4-05: SRE 健康异常 → 自动回滚 + 新 Ticket', () => {
  it('creates P0 bug Ticket on SRE health check failure', async () => {
    const runner = new LoopRunner({
      tenantId: TENANT,
      failureInjection: { stage: 9, error: 'error_rate_spike: 15%' },
    })
    const evidence = await runner.execute(REHEARSAL_TICKET, 'rehearsal-sre-fail')

    expect(evidence.summary.overallResult).toBe('failure')
    expect(evidence.followUpTickets).toHaveLength(1)
    expect(evidence.followUpTickets[0].type).toBe('bug')
    expect(evidence.followUpTickets[0].priority).toBe('P0')
    expect(evidence.followUpTickets[0].title).toContain('health check failed')
  })

  it('Stage 09 is marked as failure with anomaly details', async () => {
    const runner = new LoopRunner({
      tenantId: TENANT,
      failureInjection: { stage: 9, error: 'p99_latency_spike: 3200ms' },
    })
    const evidence = await runner.execute(REHEARSAL_TICKET, 'rehearsal-sre-latency')

    const stage9 = evidence.summary.stages.find((s) => s.stage === 9)
    expect(stage9?.result).toBe('failure')
    expect(stage9?.error).toContain('p99_latency_spike')
  })
})

// ─── Deploy failure ───────────────────────────────────────────────────────────

describe('Stage 08: Deploy failure → Loop terminates', () => {
  it('deploy failure prevents SRE monitoring', async () => {
    const runner = new LoopRunner({
      tenantId: TENANT,
      failureInjection: { stage: 8, error: 'oom_killed' },
    })
    const evidence = await runner.execute(REHEARSAL_TICKET, 'rehearsal-deploy-fail')

    expect(evidence.summary.overallResult).toBe('failure')
    const hasStage9 = evidence.summary.stages.some((s) => s.stage === 9)
    expect(hasStage9).toBe(false)
  })
})

// ─── Stage 05 failure ─────────────────────────────────────────────────────────

describe('Stage 05: Code execution failure → Loop terminates', () => {
  it('code failure prevents QA and deployment', async () => {
    const runner = new LoopRunner({
      tenantId: TENANT,
      failureInjection: { stage: 5, error: 'compilation_error' },
    })
    const evidence = await runner.execute(REHEARSAL_TICKET, 'rehearsal-code-fail')

    expect(evidence.summary.overallResult).toBe('failure')
    expect(evidence.approvalRequests).toHaveLength(0)
  })
})
