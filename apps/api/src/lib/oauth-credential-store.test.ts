import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockWithTenantDb,
  mockInvalidate,
  mockOnConflictDoUpdate,
  mockValues,
  mockInsert,
} = vi.hoisted(() => ({
  mockWithTenantDb: vi.fn(),
  mockInvalidate: vi.fn(),
  mockOnConflictDoUpdate: vi.fn(),
  mockValues: vi.fn(),
  mockInsert: vi.fn(),
}))

vi.mock('@patioer/db', () => ({
  withTenantDb: mockWithTenantDb,
  schema: {
    platformCredentials: {
      tenantId: 'tenantId',
      platform: 'platform',
      region: 'region',
    },
  },
}))

vi.mock('./harness-registry.js', () => ({
  registry: {
    invalidate: mockInvalidate,
  },
}))

import { persistOAuthCredential } from './oauth-credential-store.js'

describe('persistOAuthCredential', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOnConflictDoUpdate.mockResolvedValue(undefined)
    mockValues.mockReturnValue({
      onConflictDoUpdate: mockOnConflictDoUpdate,
    })
    mockInsert.mockReturnValue({
      values: mockValues,
    })
    mockWithTenantDb.mockImplementation(async (_tenantId, callback) => {
      return await callback({ insert: mockInsert } as never)
    })
  })

  it('upserts the credential and invalidates the harness cache', async () => {
    await persistOAuthCredential({
      tenantId: 'tenant-1',
      platform: 'amazon',
      credentialType: 'lwa',
      region: 'na',
      accessToken: 'encrypted-token',
      metadata: { sellerId: 'seller-1' },
    })

    expect(mockWithTenantDb).toHaveBeenCalledWith('tenant-1', expect.any(Function))
    expect(mockInsert).toHaveBeenCalled()
    expect(mockValues).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      platform: 'amazon',
      credentialType: 'lwa',
      region: 'na',
      shopDomain: null,
      accessToken: 'encrypted-token',
      scopes: null,
      metadata: { sellerId: 'seller-1' },
    })
    expect(mockOnConflictDoUpdate).toHaveBeenCalledWith({
      target: ['tenantId', 'platform', 'region'],
      set: {
        credentialType: 'lwa',
        shopDomain: null,
        accessToken: 'encrypted-token',
        scopes: null,
        metadata: { sellerId: 'seller-1' },
      },
    })
    expect(mockInvalidate).toHaveBeenCalledWith('tenant-1:amazon')
  })

  it('uses oauth defaults for optional fields', async () => {
    await persistOAuthCredential({
      tenantId: 'tenant-2',
      platform: 'shopify',
      region: 'global',
      accessToken: 'encrypted-token',
      scopes: ['read_products'],
    })

    expect(mockValues).toHaveBeenCalledWith({
      tenantId: 'tenant-2',
      platform: 'shopify',
      credentialType: 'oauth',
      region: 'global',
      shopDomain: null,
      accessToken: 'encrypted-token',
      scopes: ['read_products'],
      metadata: null,
    })
  })
})
