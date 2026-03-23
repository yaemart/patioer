import type { TenantHarness } from './base.harness.js'
import type { InventoryCapableHarness } from './inventory.types.js'

export function isInventoryCapable(h: TenantHarness): h is TenantHarness & InventoryCapableHarness {
  return typeof (h as unknown as InventoryCapableHarness).getInventoryLevels === 'function'
}
