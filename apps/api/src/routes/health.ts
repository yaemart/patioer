import type { FastifyPluginAsync } from 'fastify'
import { SERVICE_IDENTIFIER } from '../config/service.js'

const healthRoute: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/health', async () => {
    return { ok: true, service: SERVICE_IDENTIFIER }
  })
}

export default healthRoute