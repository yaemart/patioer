import { describe, expect, it, vi } from 'vitest'
import { AutonomousDevLoop, type LoopAgentPorts } from './autonomous-loop.js'
import type { DevOsTicket } from './ticket-protocol.js'
import type { TaskGraph } from './task-graph.js'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TICKET: DevOsTicket = {
  type: 'feature',
  priority: 'P2',
  title: 'Add price threshold per category',
  description: 'Allow Price Sentinel to use different thresholds per product category.',
  context: { agentId: 'ticket-001' },
  sla: { acknowledge: '24h', resolve: '72h' },
}

const TASK_GRAPH: TaskGraph = {
  ticketId: 'ticket-001',
  createdAt: new Date().toISOString(),
  tasks: [
    { id: 'backend-01', title: 'Add threshold column', kind: 'db_migration', dependsOn: [], status: 'pending' },
    { id: 'backend-02', title: 'Update Price Sentinel', kind: 'backend', dependsOn: ['backend-01'], status: 'pending' },
    { id: 'test-01', title: 'Unit tests', kind: 'test', dependsOn: ['backend-02'], status: 'pending' },
  ],
}

function makePorts(overrides: Partial<LoopAgentPorts> = {}): LoopAgentPorts {
  return {
    pm: {
      analyze: vi.fn().mockResolvedValue({
        summary: 'Add per-category price threshold support',
        acceptanceCriteria: ['Threshold configurable per category', 'Existing tests pass'],
        estimatedComplexity: 'medium',
      }),
    },
    architect: {
      design: vi.fn().mockResolvedValue({
        approach: 'Add threshold column to categories table',
        affectedModules: ['price-sentinel', 'dataos'],
        requiresMigration: true,
        riskLevel: 'low',
      }),
    },
    decompose: {
      decompose: vi.fn().mockResolvedValue(TASK_GRAPH),
    },
    code: {
      execute: vi.fn().mockImplementation(async (taskId: string) => ({
        taskId,
        success: true,
        filesChanged: [`src/${taskId}.ts`],
      })),
    },
    qa: {
      runTests: vi.fn().mockResolvedValue({
        passed: true,
        coveragePct: 85,
        failedTests: [],
      }),
    },
    security: {
      scan: vi.fn().mockResolvedValue({
        passed: true,
        vulnerabilities: [],
      }),
    },
    approval: {
      requestApproval: vi.fn().mockResolvedValue('approved-ticket-001'),
    },
    deploy: {
      deploy: vi.fn().mockResolvedValue({
        success: true,
        ref: 'sha-abc123',
      }),
    },
    sre: {
      monitor: vi.fn().mockResolvedValue({
        healthy: true,
        metrics: { errorRate: 0.001, p99LatencyMs: 120 },
        anomalies: [],
      }),
    },
    ...overrides,
  }
}

function makeLoop(ports: LoopAgentPorts) {
  return new AutonomousDevLoop(
    { tenantId: 'tenant-001', sreDurationMs: 100 },
    ports,
  )
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AutonomousDevLoop — full 9-stage E2E stub (AC-P4-01)', () => {
  it('runs all 9 stages successfully and returns summary', async () => {
    const ports = makePorts()
    const loop = makeLoop(ports)
    const summary = await loop.run(TICKET, 'run-001')

    expect(summary.overallResult).toBe('success')
    expect(summary.stages).toHaveLength(9)
    expect(summary.stages.every((s) => s.result === 'success')).toBe(true)
    expect(summary.deployedRef).toBe('sha-abc123')

    // All agent ports were called
    expect(ports.pm.analyze).toHaveBeenCalledOnce()
    expect(ports.architect.design).toHaveBeenCalledOnce()
    expect(ports.decompose.decompose).toHaveBeenCalledOnce()
    expect(ports.qa.runTests).toHaveBeenCalledOnce()
    expect(ports.security.scan).toHaveBeenCalledOnce()
    expect(ports.approval.requestApproval).toHaveBeenCalledOnce()
    expect(ports.deploy.deploy).toHaveBeenCalledOnce()
    expect(ports.sre.monitor).toHaveBeenCalledOnce()
  })

  it('TaskGraph has been set on the context', async () => {
    const ports = makePorts()
    const loop = makeLoop(ports)
    const summary = await loop.run(TICKET, 'run-002')
    expect(summary.taskGraph).toBeDefined()
    expect(summary.taskGraph!.tasks).toHaveLength(3)
  })

  it('each task in the graph was executed by code agent', async () => {
    const ports = makePorts()
    const loop = makeLoop(ports)
    await loop.run(TICKET, 'run-003')
    expect(ports.code.execute).toHaveBeenCalledTimes(3)
  })
})

describe('AC-P4-02: Stage 06 coverage_below_80 throws LoopError', () => {
  it('throws LoopError("coverage_below_80") when coverage < 80% on all retries', async () => {
    const ports = makePorts({
      qa: {
        runTests: vi.fn().mockResolvedValue({
          passed: false,
          coveragePct: 65,
          failedTests: [],
        }),
      },
    })
    const loop = makeLoop(ports)
    const summary = await loop.run(TICKET, 'run-cov-fail')

    expect(summary.overallResult).toBe('failure')
    const stage6 = summary.stages.find((s) => s.stage === 6)
    expect(stage6?.result).toBe('failure')
  })

  it('succeeds on retry when coverage improves above 80%', async () => {
    let callCount = 0
    const ports = makePorts({
      qa: {
        runTests: vi.fn().mockImplementation(async () => {
          callCount++
          if (callCount === 1) return { passed: false, coveragePct: 75, failedTests: [] }
          return { passed: true, coveragePct: 82, failedTests: [] }
        }),
      },
    })
    const loop = new AutonomousDevLoop(
      { tenantId: 'tenant-001', sreDurationMs: 100, maxCodeReviewRetries: 3 },
      ports,
    )
    const summary = await loop.run(TICKET, 'run-cov-retry')
    expect(summary.overallResult).toBe('success')
  })
})

describe('AC-P4-02: Stage 06 security_issues throws LoopError', () => {
  it('returns failure summary when security issues found on all retries', async () => {
    const ports = makePorts({
      security: {
        scan: vi.fn().mockResolvedValue({
          passed: false,
          vulnerabilities: [{ severity: 'high', description: 'CVE-2026-001' }],
        }),
      },
    })
    const loop = makeLoop(ports)
    const summary = await loop.run(TICKET, 'run-sec-fail')
    expect(summary.overallResult).toBe('failure')
    const stage6 = summary.stages.find((s) => s.stage === 6)
    expect(stage6?.result).toBe('failure')
  })
})

describe('AC-P4-04: Stage 07 human approval gate', () => {
  it('does NOT deploy when approval is rejected', async () => {
    const ports = makePorts({
      approval: {
        requestApproval: vi.fn().mockRejectedValue(new Error('Rejected: scope too large')),
      },
    })
    const loop = makeLoop(ports)
    const summary = await loop.run(TICKET, 'run-reject')

    expect(summary.overallResult).toBe('failure')
    expect(ports.deploy.deploy).not.toHaveBeenCalled()
    expect(ports.sre.monitor).not.toHaveBeenCalled()
  })

  it('does NOT deploy when approval times out', async () => {
    const ports = makePorts({
      approval: {
        requestApproval: vi.fn().mockRejectedValue(new Error('timeout waiting for approval')),
      },
    })
    const loop = makeLoop(ports)
    const summary = await loop.run(TICKET, 'run-timeout')

    expect(summary.overallResult).toBe('failure')
    expect(ports.deploy.deploy).not.toHaveBeenCalled()
  })
})

describe('AC-P4-05: Stage 09 SRE health check failure → follow-up Ticket', () => {
  it('creates follow-up Ticket on health check failure', async () => {
    const createTicket = vi.fn().mockResolvedValue({ ticketId: 'bug-001' })
    const ports = makePorts({
      sre: {
        monitor: vi.fn().mockResolvedValue({
          healthy: false,
          metrics: { errorRate: 0.15 },
          anomalies: ['error rate spike: 15%'],
        }),
      },
      devosClient: { createTicket } as never,
    })
    const loop = makeLoop(ports)
    const summary = await loop.run(TICKET, 'run-sre-fail')

    expect(summary.overallResult).toBe('failure')
    expect(createTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'bug',
        priority: 'P0',
      }),
    )
  })
})

describe('Stage 04: TaskGraph cycle detection', () => {
  it('returns failure when decompose returns cyclic graph', async () => {
    const cyclicGraph: TaskGraph = {
      ticketId: 'ticket-001',
      createdAt: new Date().toISOString(),
      tasks: [
        { id: 'a', title: 'a', kind: 'backend', dependsOn: ['b'], status: 'pending' },
        { id: 'b', title: 'b', kind: 'backend', dependsOn: ['a'], status: 'pending' },
      ],
    }
    const ports = makePorts({
      decompose: { decompose: vi.fn().mockResolvedValue(cyclicGraph) },
    })
    const loop = makeLoop(ports)
    const summary = await loop.run(TICKET, 'run-cycle')

    expect(summary.overallResult).toBe('failure')
    const stage4 = summary.stages.find((s) => s.stage === 4)
    expect(stage4?.result).toBe('failure')
    // Subsequent stages must NOT have been called
    expect(ports.qa.runTests).not.toHaveBeenCalled()
    expect(ports.deploy.deploy).not.toHaveBeenCalled()
  })
})

describe('Stage 05: code execution failure', () => {
  it('returns failure when a task fails to execute', async () => {
    const ports = makePorts({
      code: {
        execute: vi.fn().mockResolvedValue({ taskId: 'any', success: false, filesChanged: [] }),
      },
    })
    const loop = makeLoop(ports)
    const summary = await loop.run(TICKET, 'run-code-fail')

    expect(summary.overallResult).toBe('failure')
    expect(ports.approval.requestApproval).not.toHaveBeenCalled()
  })
})

describe('Stage 08: deploy failure', () => {
  it('returns failure when deploy fails', async () => {
    const ports = makePorts({
      deploy: {
        deploy: vi.fn().mockResolvedValue({ success: false, ref: '', error: 'OOM' }),
      },
    })
    const loop = makeLoop(ports)
    const summary = await loop.run(TICKET, 'run-deploy-fail')
    expect(summary.overallResult).toBe('failure')
    expect(ports.sre.monitor).not.toHaveBeenCalled()
  })
})
