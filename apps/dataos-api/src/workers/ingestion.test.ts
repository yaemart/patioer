import { describe, it, expect, vi, beforeEach } from 'vitest'
import { startIngestionWorker } from './ingestion.js'
import type { DataOsServices } from '@patioer/dataos'

const { incFailed } = vi.hoisted(() => ({
  incFailed: vi.fn(),
}))

vi.mock('../metrics.js', () => ({
  ingestionJobsProcessed: { inc: vi.fn() },
  ingestionJobsFailed: { inc: incFailed },
}))

// Processor function captured by the Worker mock.
let capturedProcessor: ((job: unknown) => Promise<void>) | null = null
let capturedQueueName: string | null = null
let capturedFailedHandler: ((job: unknown, err: unknown) => void) | null = null

vi.mock('bullmq', () => ({
  Worker: class MockWorker {
    constructor(queue: string, processor: (job: unknown) => Promise<void>, _opts: unknown) {
      capturedQueueName = queue
      capturedProcessor = processor
    }

    on = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (event === 'failed') {
        capturedFailedHandler = handler as (job: unknown, err: unknown) => void
      }
    })

    close = vi.fn().mockResolvedValue(undefined)
  },
}))

const insertEvent = vi.fn().mockResolvedValue(undefined)

function makeServices(): DataOsServices {
  return {
    eventLake: { insertEvent } as unknown as DataOsServices['eventLake'],
  } as unknown as DataOsServices
}

const fakeRedis = { host: 'localhost', port: 6379, password: undefined, db: 0 }

describe('startIngestionWorker', () => {
  beforeEach(() => {
    insertEvent.mockClear()
    incFailed.mockClear()
    capturedProcessor = null
    capturedQueueName = null
    capturedFailedHandler = null
  })

  it('creates a BullMQ Worker on the correct queue', () => {
    startIngestionWorker(makeServices(), fakeRedis)
    expect(capturedQueueName).toBe('dataos-lake-ingest')
  })

  it('worker processor calls eventLake.insertEvent with correct fields', async () => {
    startIngestionWorker(makeServices(), fakeRedis)
    await capturedProcessor!({
      data: {
        tenantId: '550e8400-e29b-41d4-a716-446655440001',
        platform: 'shopify',
        agentId: 'price-sentinel',
        eventType: 'price.updated',
        entityId: 'sku-123',
        payload: { before: 10, after: 12 },
        metadata: { source: 'test' },
      },
    })
    expect(insertEvent).toHaveBeenCalledTimes(1)
    expect(insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: '550e8400-e29b-41d4-a716-446655440001',
        platform: 'shopify',
        agentId: 'price-sentinel',
        eventType: 'price.updated',
        entityId: 'sku-123',
      }),
    )
  })

  it('worker processor calls insertEvent successfully for minimal job data', async () => {
    startIngestionWorker(makeServices(), fakeRedis)
    await capturedProcessor!({
      data: {
        tenantId: '550e8400-e29b-41d4-a716-446655440001',
        agentId: 'agent-x',
        eventType: 'test',
        payload: {},
      },
    })
    expect(insertEvent).toHaveBeenCalledTimes(1)
  })

  it('worker processor propagates insertEvent error for BullMQ retry', async () => {
    insertEvent.mockRejectedValueOnce(new Error('CH connection refused'))
    startIngestionWorker(makeServices(), fakeRedis)
    await expect(
      capturedProcessor!({
        data: {
          tenantId: '550e8400-e29b-41d4-a716-446655440001',
          agentId: 'agent-x',
          eventType: 'test',
          payload: {},
        },
      }),
    ).rejects.toThrow('CH connection refused')
  })

  it('does not increment ingestionJobsFailed on intermediate failed attempts', () => {
    startIngestionWorker(makeServices(), fakeRedis)
    expect(capturedFailedHandler).toBeTruthy()
    capturedFailedHandler!(
      { id: 'j1', attemptsMade: 1, opts: { attempts: 3 } },
      new Error('transient'),
    )
    expect(incFailed).not.toHaveBeenCalled()
  })

  it('increments ingestionJobsFailed once when attempts are exhausted (DLQ)', () => {
    startIngestionWorker(makeServices(), fakeRedis)
    capturedFailedHandler!(
      { id: 'j1', attemptsMade: 3, opts: { attempts: 3 } },
      new Error('final'),
    )
    expect(incFailed).toHaveBeenCalledTimes(1)
  })

  it('uses job.opts.attempts when present (respects per-job retry config)', () => {
    startIngestionWorker(makeServices(), fakeRedis)
    capturedFailedHandler!(
      { id: 'j1', attemptsMade: 1, opts: { attempts: 1 } },
      new Error('only try'),
    )
    expect(incFailed).toHaveBeenCalledTimes(1)
  })
})
