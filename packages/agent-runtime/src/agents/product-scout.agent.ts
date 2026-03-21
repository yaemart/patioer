import type { AgentContext } from '../context.js'

export const runProductScout = async (ctx: AgentContext): Promise<void> => {
  await ctx.logAction('product_scout.heartbeat', { tenantId: ctx.tenantId })
}
