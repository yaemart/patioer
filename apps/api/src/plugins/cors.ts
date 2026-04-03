import cors from '@fastify/cors'
import fp from 'fastify-plugin'
import type { FastifyPluginAsync } from 'fastify'

/** Comma-separated browser origins allowed to call the API with credentials (e.g. Next.js app URL). */
export function getCorsAllowedOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS?.trim()
  if (raw) {
    return raw.split(',').map((s) => s.trim()).filter(Boolean)
  }
  if (process.env.NODE_ENV !== 'production') {
    return ['http://localhost:3000', 'http://127.0.0.1:3000']
  }
  return []
}

const corsPlugin: FastifyPluginAsync = async (app) => {
  const allowed = getCorsAllowedOrigins()

  await app.register(cors, {
    credentials: true,
    origin: (origin, cb) => {
      if (!origin) {
        cb(null, true)
        return
      }
      if (allowed.includes(origin)) {
        cb(null, origin)
        return
      }
      cb(null, false)
    },
  })
}

export default fp(corsPlugin, { name: 'cors-plugin' })
