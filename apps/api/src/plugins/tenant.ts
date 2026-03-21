import fp from 'fastify-plugin'
import type { FastifyPluginAsync } from 'fastify'
import { withTenantDb } from '@patioer/db'

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const tenantPlugin: FastifyPluginAsync = async (app) => {
  // Declare the per-request slot so Fastify can track it properly.
  app.decorateRequest('withDb', null)

  app.addHook('onRequest', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id']

    if (typeof tenantId !== 'string' || tenantId.length === 0) {
      return
    }

    if (!UUID_REGEX.test(tenantId)) {
      await reply.code(400).send({ error: 'x-tenant-id must be a valid UUID' })
      return
    }

    request.tenantId = tenantId
    // Bind a convenience helper so route handlers never touch the global db.
    // Calling request.withDb(cb) opens a transaction, runs SET LOCAL
    // app.tenant_id, executes cb, then commits — fully RLS-enforced.
    request.withDb = (cb) => withTenantDb(tenantId, cb)
  })
}

export default fp(tenantPlugin)
