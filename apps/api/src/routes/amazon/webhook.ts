import type { FastifyPluginAsync } from 'fastify'
import { withTenantDb, schema } from '@patioer/db'
import { randomUUID } from 'node:crypto'

interface SnsNotification {
  Type: string
  MessageId: string
  TopicArn?: string
  Message?: string
  SubscribeURL?: string
  Subject?: string
  Timestamp?: string
}

const amazonWebhookRoute: FastifyPluginAsync = async (app) => {
  // Accept raw body so we can inspect `Content-Type: text/plain` (SNS sends this)
  app.addContentTypeParser(
    'text/plain',
    { parseAs: 'buffer' },
    (_req, body, done) => {
      done(null, body)
    },
  )

  app.post('/api/v1/webhooks/amazon', async (request, reply) => {
    let notification: SnsNotification
    const rawBody = request.body
    try {
      if (rawBody !== null && typeof rawBody === 'object' && !Buffer.isBuffer(rawBody)) {
        // Fastify's built-in JSON parser already parsed the body (application/json)
        notification = rawBody as SnsNotification
      } else {
        // text/plain arrives as a Buffer from our custom content-type parser
        const raw = rawBody as Buffer | string
        notification = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8')) as SnsNotification
      }
    } catch {
      return reply.code(400).send({ error: 'invalid JSON payload' })
    }

    // Amazon SNS SubscriptionConfirmation — respond quickly so SNS confirms the endpoint
    if (notification.Type === 'SubscriptionConfirmation') {
      app.log.info({ subscribeUrl: notification.SubscribeURL }, 'Amazon SNS SubscriptionConfirmation received')
      // In Phase 3 we will auto-confirm via GET on SubscribeURL.
      return reply.code(200).send({ ok: true })
    }

    // All other notification types — persist for downstream processing
    const tenantId = (request.headers as Record<string, string>)['x-tenant-id']
    if (!tenantId) {
      return reply.code(400).send({ error: 'x-tenant-id header is required' })
    }

    try {
      await withTenantDb(tenantId, async (db) => {
        await db
          .insert(schema.webhookEvents)
          .values({
            tenantId,
            platform: 'amazon',
            webhookId: notification.MessageId ?? randomUUID(),
            topic: notification.Subject ?? notification.Type ?? 'unknown',
            shopDomain: null,
            payload: notification as unknown as Record<string, unknown>,
            status: 'received',
          })
          // SNS may redeliver the same MessageId; skip duplicates silently.
          .onConflictDoNothing()
      })
    } catch (err) {
      app.log.error({ err, tenantId }, 'failed to persist Amazon SNS notification')
      return reply.code(500).send({ error: 'failed to persist notification' })
    }

    return reply.code(200).send({ ok: true })
  })
}

export default amazonWebhookRoute
