import { describe, expect, it, vi } from 'vitest'
import { LoopContext, type EventSink } from './loop-context.js'

function makeCtx(sink?: EventSink) {
  return new LoopContext('run-001', 'ticket-xyz', 'tenant-001', sink)
}

describe('LoopContext', () => {
  it('beginStage + completeStage records stage log', () => {
    const ctx = makeCtx()
    ctx.beginStage(1)
    ctx.completeStage(1, { title: 'test' })
    const summary = ctx.getSummary()
    expect(summary.stages).toHaveLength(1)
    expect(summary.stages[0]!.stage).toBe(1)
    expect(summary.stages[0]!.result).toBe('success')
    expect(summary.stages[0]!.completedAt).toBeTruthy()
    expect(summary.stages[0]!.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('failStage records failure with error', () => {
    const ctx = makeCtx()
    ctx.beginStage(6)
    ctx.failStage(6, 'coverage 60% < 80%')
    const summary = ctx.getSummary()
    expect(summary.stages[0]!.result).toBe('failure')
    expect(summary.stages[0]!.error).toBe('coverage 60% < 80%')
  })

  it('setTaskGraph stores graph and emits event', async () => {
    const insertEvent = vi.fn().mockResolvedValue(undefined)
    const ctx = makeCtx({ insertEvent })
    const graph = { ticketId: 't-1', tasks: [], createdAt: new Date().toISOString() }
    ctx.setTaskGraph(graph)
    await new Promise((r) => setTimeout(r, 10))
    expect(ctx.getSummary().taskGraph).toBe(graph)
    expect(insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'loop.task_graph.set' }),
    )
  })

  it('setDeployedRef stores ref', () => {
    const ctx = makeCtx()
    ctx.setDeployedRef('sha-abc123')
    expect(ctx.getSummary().deployedRef).toBe('sha-abc123')
  })

  it('complete sets overallResult', () => {
    const ctx = makeCtx()
    ctx.beginStage(1)
    ctx.completeStage(1)
    ctx.complete('success')
    expect(ctx.getSummary().overallResult).toBe('success')
  })

  it('emits events to eventSink for each stage transition', async () => {
    const insertEvent = vi.fn().mockResolvedValue(undefined)
    const ctx = makeCtx({ insertEvent })
    ctx.beginStage(1)
    ctx.completeStage(1)
    await new Promise((r) => setTimeout(r, 10))
    expect(insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'loop.stage.begin', tenantId: 'tenant-001' }),
    )
    expect(insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'loop.stage.complete' }),
    )
  })

  it('eventSink failure does not throw (best-effort)', async () => {
    const insertEvent = vi.fn().mockRejectedValue(new Error('sink unavailable'))
    const ctx = makeCtx({ insertEvent })
    expect(() => ctx.beginStage(2)).not.toThrow()
    await new Promise((r) => setTimeout(r, 20))
  })

  it('runId and ticketId are accessible', () => {
    const ctx = makeCtx()
    expect(ctx.runId).toBe('run-001')
    expect(ctx.ticketId).toBe('ticket-xyz')
  })
})
