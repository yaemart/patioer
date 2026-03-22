import type { FastifyPluginAsync } from 'fastify'
import { SERVICE_IDENTIFIER } from '../config/service.js'

const healthRoute: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/health', {
    schema: {
      tags: ['System'],
      summary: 'Health check',
      response: { 200: { type: 'object', properties: { ok: { type: 'boolean' }, service: { type: 'string' } } } },
    },
  }, async () => {
    return { ok: true, service: SERVICE_IDENTIFIER }
  })
}

export default healthRoute