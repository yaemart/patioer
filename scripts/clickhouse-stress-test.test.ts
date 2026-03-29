import { describe, it, expect } from 'vitest'
import {
  benchmarkWrites,
  benchmarkQueries,
  runClickHouseStressTest,
} from './clickhouse-stress-test.js'

describe('ClickHouse stress test — AC-P4-22', () => {
  it('write benchmark processes 10k events at ≥1000/s', async () => {
    const result = await benchmarkWrites({ totalEvents: 10_000, batchSize: 1000 })

    expect(result.totalEvents).toBe(10_000)
    expect(result.eventsPerSecond).toBeGreaterThanOrEqual(1000)
    expect(result.meetsTarget).toBe(true)
  })

  it('all query benchmarks complete in <500ms', async () => {
    const results = await benchmarkQueries()

    expect(results.length).toBeGreaterThanOrEqual(5)
    for (const q of results) {
      expect(q.latencyMs).toBeLessThan(500)
      expect(q.meetsTarget).toBe(true)
    }
  })

  it('full stress test passes both write and query targets', async () => {
    const summary = await runClickHouseStressTest({ totalEvents: 10_000 })

    expect(summary.writeTest.meetsTarget).toBe(true)
    expect(summary.queryTests.every((q) => q.meetsTarget)).toBe(true)
    expect(summary.allPass).toBe(true)
  })
})
