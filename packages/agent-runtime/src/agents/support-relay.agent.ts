import type { AgentContext } from '../context.js'

export const runSupportRelay = async (ctx: AgentContext): Promise<void> => {
  await ctx.logAction('support_relay.heartbeat', { tenantId: ctx.tenantId })
}
