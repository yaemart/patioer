import type { AgentContext } from '../context.js'

export const runPriceSentinel = async (ctx: AgentContext): Promise<void> => {
  await ctx.logAction('price_sentinel.heartbeat', { tenantId: ctx.tenantId })
}
