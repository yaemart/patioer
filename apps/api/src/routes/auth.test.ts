import Fastify from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import authRoute, { _getTestUserStore, setUserStore } from './auth.js'
import type { UserStore } from './auth.js'

function createInMemoryStore(): UserStore {
  const users = new Map<string, { id: string; email: string; passwordHash: string; tenantId: string; role: string; plan: string; company: string }>()
  return {
    async findByEmail(email) {
      for (const u of users.values()) { if (u.email === email) return u }
      return null
    },
    async findById(id) { return users.get(id) ?? null },
    async create(user) { users.set(user.id, user) },
    async clear() { users.clear() },
  }
}

function createApp() {
  const store = createInMemoryStore()
  setUserStore(store)
  const app = Fastify()
  app.register(authRoute)
  return { app, store }
}

describe('auth routes', () => {
  afterEach(async () => {
    const store = _getTestUserStore()
    await store.clear()
  })

  describe('POST /api/v1/auth/register', () => {
    it('registers a new user and returns JWT + tenantId', async () => {
      const { app } = createApp()
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { email: 'test@example.com', password: 'password123', company: 'Test Corp' },
      })
      expect(res.statusCode).toBe(201)
      const body = res.json()
      expect(body.token).toBeDefined()
      expect(body.tenantId).toBeDefined()
      expect(body.userId).toBeDefined()
      await app.close()
    })

    it('rejects duplicate email with structured error', async () => {
      const { app } = createApp()
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { email: 'dup@example.com', password: 'password123', company: 'Dup Corp' },
      })
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { email: 'dup@example.com', password: 'password456', company: 'Dup Corp 2' },
      })
      expect(res.statusCode).toBe(409)
      expect(res.json().type).toBe('duplicate_email')
      await app.close()
    })

    it('rejects short password', async () => {
      const { app } = createApp()
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { email: 'short@example.com', password: '123', company: 'Short Corp' },
      })
      expect(res.statusCode).toBe(400)
      await app.close()
    })

    it('rejects missing fields', async () => {
      const { app } = createApp()
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { email: 'no-pass@example.com' },
      })
      expect(res.statusCode).toBe(400)
      await app.close()
    })
  })

  describe('POST /api/v1/auth/login', () => {
    it('returns JWT for valid credentials', async () => {
      const { app } = createApp()
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { email: 'login@example.com', password: 'password123', company: 'Login Corp' },
      })
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'login@example.com', password: 'password123' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().token).toBeDefined()
      await app.close()
    })

    it('rejects wrong password with structured error', async () => {
      const { app } = createApp()
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { email: 'wrong@example.com', password: 'password123', company: 'Wrong Corp' },
      })
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'wrong@example.com', password: 'badpassword' },
      })
      expect(res.statusCode).toBe(401)
      expect(res.json().type).toBe('invalid_credentials')
      await app.close()
    })

    it('rejects non-existent user', async () => {
      const { app } = createApp()
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'ghost@example.com', password: 'password123' },
      })
      expect(res.statusCode).toBe(401)
      expect(res.json().type).toBe('invalid_credentials')
      await app.close()
    })
  })

  describe('GET /api/v1/auth/me', () => {
    it('returns user info from valid JWT', async () => {
      const { app } = createApp()
      const registerRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { email: 'me@example.com', password: 'password123', company: 'Me Corp' },
      })
      const { token, tenantId } = registerRes.json()

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${token}` },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.email).toBe('me@example.com')
      expect(body.tenantId).toBe(tenantId)
      expect(body.role).toBe('owner')
      expect(body.plan).toBe('starter')
      await app.close()
    })

    it('rejects missing Authorization header with structured error', async () => {
      const { app } = createApp()
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
      })
      expect(res.statusCode).toBe(401)
      expect(res.json().type).toBe('missing_token')
      await app.close()
    })

    it('rejects invalid token with structured error', async () => {
      const { app } = createApp()
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: 'Bearer invalid.token.here' },
      })
      expect(res.statusCode).toBe(401)
      expect(res.json().type).toBe('token_invalid')
      await app.close()
    })

    it('rejects tampered token signature', async () => {
      const { app } = createApp()
      const registerRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { email: 'tamper@example.com', password: 'password123', company: 'Tamper Corp' },
      })
      const { token } = registerRes.json()
      const parts = token.split('.')
      const tamperedToken = `${parts[0]}.${parts[1]}.tampered_signature`
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${tamperedToken}` },
      })
      expect(res.statusCode).toBe(401)
      expect(res.json().type).toBe('token_invalid')
      await app.close()
    })

    it('returns machine subject info from valid machine JWT', async () => {
      const { app } = createApp()
      const registerRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { email: 'machine@example.com', password: 'password123', company: 'Machine Corp' },
      })
      const ownerToken = registerRes.json().token as string

      const machineRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/machine-token',
        headers: {
          authorization: `Bearer ${ownerToken}`,
          'content-type': 'application/json',
        },
        payload: { name: 'deploy-bot', scopes: ['clipmart:write'] },
      })
      expect(machineRes.statusCode).toBe(201)
      const machineToken = machineRes.json().token as string

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${machineToken}` },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({
        tenantId: registerRes.json().tenantId,
        role: 'service',
        plan: 'starter',
        subjectType: 'machine',
        serviceAccountId: machineRes.json().serviceAccountId,
        serviceAccountName: 'deploy-bot',
      })
      await app.close()
    })
  })

  describe('POST /api/v1/auth/machine-token', () => {
    it('issues a machine token for owner users', async () => {
      const { app } = createApp()
      const registerRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { email: 'owner@example.com', password: 'password123', company: 'Owner Corp' },
      })

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/machine-token',
        headers: {
          authorization: `Bearer ${registerRes.json().token as string}`,
          'content-type': 'application/json',
        },
        payload: { name: 'ops-bot', scopes: ['growth:write', 'settings:write'] },
      })

      expect(res.statusCode).toBe(201)
      expect(res.json()).toMatchObject({
        tenantId: registerRes.json().tenantId,
        serviceAccountName: 'ops-bot',
        subjectType: 'machine',
        scopes: ['growth:write', 'settings:write'],
      })
      await app.close()
    })

    it('rejects requests without an authenticated user JWT', async () => {
      const { app } = createApp()
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/machine-token',
        headers: { 'content-type': 'application/json' },
        payload: { name: 'ops-bot' },
      })
      expect(res.statusCode).toBe(401)
      expect(res.json().type).toBe('missing_token')
      await app.close()
    })
  })

  it('full register → login → me flow', async () => {
    const { app } = createApp()

    const regRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'flow@example.com', password: 'password123', company: 'Flow Corp' },
    })
    expect(regRes.statusCode).toBe(201)

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'flow@example.com', password: 'password123' },
    })
    expect(loginRes.statusCode).toBe(200)
    const { token } = loginRes.json()

    const meRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(meRes.statusCode).toBe(200)
    expect(meRes.json().email).toBe('flow@example.com')
    await app.close()
  })

  it('scrypt hash produces unique salts per user', async () => {
    const { app, store } = createApp()
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'salt1@example.com', password: 'samepassword', company: 'Salt Corp 1' },
    })
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'salt2@example.com', password: 'samepassword', company: 'Salt Corp 2' },
    })
    const u1 = await store.findByEmail('salt1@example.com')
    const u2 = await store.findByEmail('salt2@example.com')
    expect(u1!.passwordHash).not.toBe(u2!.passwordHash)
    await app.close()
  })
})
