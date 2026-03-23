/**
 * Normalized inventory row from a store catalog / inventory API (Phase 2).
 * Maps to `inventory_levels` in ElectroOS; see `docs/plans/phase2-plan.md` §4.3.
 */
export interface HarnessInventoryLevel {
  /** Platform-native product id (matches `products.platform_product_id`). */
  platformProductId: string
  quantity: number
  sku?: string | null
}

/** Optional harness surface for platforms that expose readable inventory levels. */
export interface InventoryCapableHarness {
  /**
   * When `productIds` is set, implementations should return only those platform ids (best effort).
   */
  getInventoryLevels(productIds?: string[]): Promise<HarnessInventoryLevel[]>
}
