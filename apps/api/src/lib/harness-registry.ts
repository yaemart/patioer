import { HarnessRegistry } from '@patioer/harness'

/**
 * App-wide singleton shared by all routes that need a TenantHarness
 * (products sync, agent execute, etc.). Using a single instance ensures
 * the TokenBucket rate limiter is shared per tenant:platform key.
 */
export const registry = new HarnessRegistry()
