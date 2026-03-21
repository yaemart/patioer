import { afterAll, describe, expect, it } from 'vitest'
import { buildServer } from '../app.js'
import { SERVICE_IDENTIFIER } from '../config/service.js'

const app = buildServer()

afterAll(async () => {
  await app.close()
})

describe('health route', () => {
  it('returns 200 on GET /api/v1/health', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      ok: true,
      service: SERVICE_IDENTIFIER,
    })
  })
})
