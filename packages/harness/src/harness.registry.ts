import type { TenantHarness } from './base.harness.js'

export class HarnessRegistry {
  private readonly harnessByTenant = new Map<string, TenantHarness>()

  register(harness: TenantHarness): void {
    this.harnessByTenant.set(harness.tenantId, harness)
  }

  get(tenantId: string): TenantHarness {
    const harness = this.harnessByTenant.get(tenantId)

    if (!harness) {
      throw new Error(`Harness not found for tenant: ${tenantId}`)
    }

    return harness
  }
}
