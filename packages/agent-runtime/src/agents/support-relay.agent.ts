import type { AgentContext } from '../context.js'
import type { RelayedThread, SupportRelayRunInput } from '../types.js'

const REFUND_KEYWORDS = ['refund', 'return', 'money back', 'cancel order', 'chargeback']

function isRefundRelated(subject: string): boolean {
  const lower = subject.toLowerCase()
  return REFUND_KEYWORDS.some((kw) => lower.includes(kw))
}

export async function runSupportRelay(
  ctx: AgentContext,
  input: SupportRelayRunInput,
): Promise<{ relayed: RelayedThread[] }> {
  const policy = input.autoReplyPolicy ?? 'auto_reply_non_refund'

  const recentEvents = ctx.getRecentEvents ? await ctx.getRecentEvents(5) : []
  await ctx.logAction('support_relay.run.started', { policy, recentEventCount: recentEvents.length })

  if (await ctx.budget.isExceeded()) {
    await ctx.logAction('support_relay.budget_exceeded', { policy })
    return { relayed: [] }
  }

  const threads = await ctx.getHarness().getOpenThreads()
  const relayed: RelayedThread[] = []

  for (const thread of threads) {
    if (policy === 'all_manual' || isRefundRelated(thread.subject)) {
      await ctx.requestApproval({
        action: 'support.escalate',
        payload: { threadId: thread.id, subject: thread.subject },
        reason: isRefundRelated(thread.subject)
          ? 'refund-related thread requires human review'
          : 'all_manual policy — every thread is escalated',
      })
      await ctx.logAction('support_relay.escalated', { threadId: thread.id })
      relayed.push({ threadId: thread.id, subject: thread.subject, action: 'escalated' })
      continue
    }

    const llmResponse = await ctx.llm({
      prompt: `Customer inquiry subject: ${thread.subject}\n\nDraft a concise, friendly reply:`,
      systemPrompt:
        'You are a helpful e-commerce customer support agent. Reply professionally and concisely. Do not mention internal systems or policies not relevant to the customer.',
    })

    await ctx.getHarness().replyToMessage(thread.id, llmResponse.text)
    await ctx.logAction('support_relay.auto_replied', {
      threadId: thread.id,
      replyLength: llmResponse.text.length,
    })
    relayed.push({
      threadId: thread.id,
      subject: thread.subject,
      action: 'auto_replied',
      replyBody: llmResponse.text,
    })
  }

  await ctx.logAction('support_relay.run.completed', {
    totalThreads: threads.length,
    autoReplied: relayed.filter((r) => r.action === 'auto_replied').length,
    escalated: relayed.filter((r) => r.action === 'escalated').length,
  })

  return { relayed }
}
