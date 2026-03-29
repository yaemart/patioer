import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreateDataOsClientFromEnv, mockClient } = vi.hoisted(() => ({
  mockCreateDataOsClientFromEnv: vi.fn(),
  mockClient: {
    getFeatures: vi.fn(),
    recallMemory: vi.fn(),
    recordMemory: vi.fn(),
    recordLakeEvent: vi.fn(),
    recordPriceEvent: vi.fn(),
    writeOutcome: vi.fn(),
    upsertFeature: vi.fn(),
    getCapabilities: vi.fn(),
  },
}))

vi.mock('@patioer/dataos-client', () => ({
  createDataOsClientFromEnv: mockCreateDataOsClientFromEnv,
}))

import { tryCreateDataOsPort } from './dataos-port.js'

describe('tryCreateDataOsPort', () => {
  beforeEach(() => {
    for (const fn of Object.values(mockClient)) {
      fn.mockReset()
    }
    mockClient.recordMemory.mockResolvedValue('mem-1')
    mockClient.recordLakeEvent.mockResolvedValue(true)
    mockClient.recordPriceEvent.mockResolvedValue(true)
    mockCreateDataOsClientFromEnv.mockReset()
    mockCreateDataOsClientFromEnv.mockReturnValue(mockClient)
  })

  it('prefers explicit platform for recordMemory', async () => {
    const port = tryCreateDataOsPort('tenant-1', 'shopify')

    await port!.recordMemory({
      agentId: 'content-writer',
      platform: 'amazon',
      entityId: 'p-1',
      context: {},
      action: {},
    })

    expect(mockClient.recordMemory).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'amazon' }),
    )
  })

  it('does not force defaultPlatform for lake events', async () => {
    const port = tryCreateDataOsPort('tenant-1', 'shopify')

    await port!.recordLakeEvent({
      platform: 'amazon',
      agentId: 'content-writer',
      eventType: 'content_generated',
      entityId: 'p-1',
      payload: {},
    })

    expect(mockClient.recordLakeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', platform: 'amazon' }),
    )
  })

  it('still falls back to defaultPlatform for price events', async () => {
    const port = tryCreateDataOsPort('tenant-1', 'shopify')

    await port!.recordPriceEvent({
      productId: 'p-1',
      priceBefore: 10,
      priceAfter: 12,
      changePct: 20,
      approved: true,
    })

    expect(mockClient.recordPriceEvent).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', platform: 'shopify' }),
    )
  })
})
