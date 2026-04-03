import type { FastifyPluginAsync } from 'fastify'
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHmac } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { TRIAL_PERIOD_DAYS } from '@patioer/shared'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- auth bootstrap runs before tenant context exists
import * as dbPackage from '@patioer/db'
import { authOperationTotal } from '../plugins/metrics.js'

type AuthErrorType =
  | 'duplicate_email'
  | 'invalid_credentials'
  | 'token_invalid'
  | 'missing_token'
  | 'forbidden'

interface AuthError {
  type: AuthErrorType
  message: string
}

interface RegisterBody {
  email: string
  password: string
  company: string
  referralCode?: string
}

interface LoginBody {
  email: string
  password: string
}

interface MachineTokenBody {
  name: string
  scopes?: string[]
}

function getPublicDb(): NonNullable<(typeof dbPackage)['db']> {
  return dbPackage.db
}

function getSchema(): NonNullable<(typeof dbPackage)['schema']> {
  return dbPackage.schema
}

export interface UserRecord {
  id: string
  email: string
  passwordHash: string
  tenantId: string
  role: string
  plan: string
  company: string
}

export interface UserStore {
  findByEmail(email: string): Promise<UserRecord | null>
  findById(id: string): Promise<UserRecord | null>
  create(user: UserRecord): Promise<void>
  clear(): Promise<void>
}

type TenantRecord = { id: string }
type TenantCreatorInput = {
  company: string
  slug: string
  plan: string
  trialEndsAt: Date
}
type TenantCreator = (input: TenantCreatorInput) => Promise<TenantRecord | null>

interface BaseJwtPayload {
  tenantId: string
  role: string
  plan: string
  iat: number
  exp: number
  subjectType: 'user' | 'machine'
  scopes?: string[]
}

export interface UserJwtPayload extends BaseJwtPayload {
  userId: string
  email: string
  subjectType: 'user'
}

export interface MachineJwtPayload extends BaseJwtPayload {
  serviceAccountId: string
  serviceAccountName: string
  subjectType: 'machine'
}

export type JwtPayload = UserJwtPayload | MachineJwtPayload

const SCRYPT_KEYLEN = 64

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, storedHash] = stored.split(':')
  if (!salt || !storedHash) return false
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex')
  const a = Buffer.from(hash, 'hex')
  const b = Buffer.from(storedHash, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable is required in production')
  }
  return secret ?? 'dev-only-secret-not-for-production'
}

export function generateJwt(payload: { userId: string; tenantId: string; email: string; role: string; plan: string }): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify({
    ...payload,
    subjectType: 'user',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400,
  })).toString('base64url')
  const signature = createHmac('sha256', getJwtSecret()).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${signature}`
}

export function generateMachineJwt(payload: {
  tenantId: string
  serviceAccountId: string
  serviceAccountName: string
  plan: string
  scopes?: string[]
  role?: string
}): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify({
    ...payload,
    role: payload.role ?? 'service',
    subjectType: 'machine',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400,
  })).toString('base64url')
  const signature = createHmac('sha256', getJwtSecret()).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${signature}`
}

const TOKEN_COOKIE_NAME = 'eos_token'
const COOKIE_MAX_AGE_SECONDS = 86400

function setTokenCookie(reply: { header: (name: string, value: string) => void }, token: string): void {
  const isProd = process.env.NODE_ENV === 'production'
  const crossSite = Boolean(process.env.CORS_ORIGINS?.trim())
  const sameSite = isProd && crossSite ? 'None' : 'Lax'
  const secure = isProd ? '; Secure' : ''
  reply.header(
    'Set-Cookie',
    `${TOKEN_COOKIE_NAME}=${token}; HttpOnly; SameSite=${sameSite}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}${secure}`,
  )
}

export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {}
  const result: Record<string, string> = {}
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=')
    if (idx === -1) continue
    result[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim()
  }
  return result
}

export function extractJwtToken(headers: Record<string, string | string[] | undefined>): string | null {
  const authHeader = headers.authorization
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7)
  }
  const cookieHeader = headers.cookie
  const cookies = parseCookies(typeof cookieHeader === 'string' ? cookieHeader : undefined)
  return cookies[TOKEN_COOKIE_NAME] ?? null
}

export function verifyJwt(token: string): JwtPayload | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null
    const expectedSig = createHmac('sha256', getJwtSecret())
      .update(`${parts[0]}.${parts[1]}`)
      .digest('base64url')
    if (expectedSig !== parts[2]) return null
    if (
      typeof payload.tenantId !== 'string'
      || typeof payload.role !== 'string'
      || typeof payload.plan !== 'string'
      || typeof payload.iat !== 'number'
      || typeof payload.exp !== 'number'
    ) {
      return null
    }
    const subjectType = payload.subjectType === 'machine' ? 'machine' : 'user'
    if (subjectType === 'machine') {
      if (
        typeof payload.serviceAccountId !== 'string'
        || typeof payload.serviceAccountName !== 'string'
      ) {
        return null
      }
      return {
        tenantId: payload.tenantId,
        role: payload.role,
        plan: payload.plan,
        iat: payload.iat,
        exp: payload.exp,
        subjectType,
        scopes: Array.isArray(payload.scopes)
          ? payload.scopes.filter((value: unknown): value is string => typeof value === 'string')
          : undefined,
        serviceAccountId: payload.serviceAccountId,
        serviceAccountName: payload.serviceAccountName,
      }
    }
    if (
      typeof payload.userId !== 'string'
      || typeof payload.email !== 'string'
    ) {
      return null
    }
    return {
      tenantId: payload.tenantId,
      role: payload.role,
      plan: payload.plan,
      iat: payload.iat,
      exp: payload.exp,
      subjectType,
      scopes: Array.isArray(payload.scopes)
        ? payload.scopes.filter((value: unknown): value is string => typeof value === 'string')
        : undefined,
      userId: payload.userId,
      email: payload.email,
    }
  } catch {
    return null
  }
}

function createInMemoryUserStore(): UserStore {
  const users = new Map<string, UserRecord>()
  return {
    async findByEmail(email) {
      for (const user of users.values()) {
        if (user.email === email) return user
      }
      return null
    },
    async findById(id) {
      return users.get(id) ?? null
    },
    async create(user) {
      users.set(user.id, user)
    },
    async clear() {
      users.clear()
    },
  }
}

export function createDbUserStore(): UserStore {
  return {
    async findByEmail(email) {
      const schema = getSchema()
      const [row] = await getPublicDb()
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email))
      if (!row) return null
      return {
        id: row.id,
        email: row.email,
        passwordHash: row.passwordHash,
        tenantId: row.tenantId,
        role: row.role,
        plan: row.plan,
        company: row.company,
      }
    },
    async findById(id) {
      const schema = getSchema()
      const [row] = await getPublicDb()
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, id))
      if (!row) return null
      return {
        id: row.id,
        email: row.email,
        passwordHash: row.passwordHash,
        tenantId: row.tenantId,
        role: row.role,
        plan: row.plan,
        company: row.company,
      }
    },
    async create(user) {
      const schema = getSchema()
      await getPublicDb().insert(schema.users).values({
        id: user.id,
        email: user.email,
        passwordHash: user.passwordHash,
        tenantId: user.tenantId,
        role: user.role,
        plan: user.plan,
        company: user.company,
      })
    },
    async clear() {
      await getPublicDb().delete(getSchema().users)
    },
  }
}

const AUTH_ERROR_SCHEMA = {
  type: 'object' as const,
  properties: {
    type: { type: 'string' as const },
    message: { type: 'string' as const },
  },
}

let _userStore: UserStore | null = null
let _tenantCreator: TenantCreator | null = null

export function setUserStore(store: UserStore): void {
  _userStore = store
}

export function setTenantCreatorForTest(creator: TenantCreator | null): void {
  _tenantCreator = creator
}

function getUserStore(): UserStore {
  if (!_userStore) _userStore = createInMemoryUserStore()
  return _userStore
}

async function createTenantRecord(input: TenantCreatorInput): Promise<TenantRecord | null> {
  if (_tenantCreator) return _tenantCreator(input)
  const schema = getSchema()
  const [tenant] = await getPublicDb()
    .insert(schema.tenants)
    .values({
      name: input.company,
      slug: input.slug,
      plan: input.plan,
      trialEndsAt: input.trialEndsAt,
    })
    .returning()
  return tenant ?? null
}

const authRoute: FastifyPluginAsync = async (app) => {
  app.post<{ Body: RegisterBody }>('/api/v1/auth/register', {
    schema: {
      tags: ['Auth'],
      summary: 'Register a new account',
      body: {
        type: 'object',
        required: ['email', 'password', 'company'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 8 },
          company: { type: 'string', minLength: 1 },
          referralCode: { type: 'string' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            token: { type: 'string' },
            tenantId: { type: 'string' },
            userId: { type: 'string' },
          },
        },
        409: AUTH_ERROR_SCHEMA,
      },
    },
  }, async (request, reply) => {
    const { email, password, company } = request.body
    const store = getUserStore()

    const existing = await store.findByEmail(email)
    if (existing) {
      authOperationTotal.labels('register', 'duplicate').inc()
      const err: AuthError = { type: 'duplicate_email', message: 'Email already registered' }
      return reply.status(409).send(err)
    }

    const userId = randomUUID()
    const plan = 'starter'
    const slug = company.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `tenant-${Date.now()}`
    const trialEndsAt = new Date(Date.now() + TRIAL_PERIOD_DAYS * 24 * 60 * 60 * 1000)

    const tenant = await createTenantRecord({ company, slug, plan, trialEndsAt })
    if (!tenant) {
      return reply.status(500).send({ type: 'internal', message: 'Failed to create tenant' })
    }
    const tenantId = tenant.id

    const user: UserRecord = {
      id: userId,
      email,
      passwordHash: hashPassword(password),
      tenantId,
      role: 'owner',
      plan,
      company,
    }
    await store.create(user)

    app.log.info({ userId, tenantId, company, trialEndsAt: trialEndsAt.toISOString() }, 'New user registered')

    const token = generateJwt({ userId, tenantId, email, role: 'owner', plan })
    setTokenCookie(reply, token)
    authOperationTotal.labels('register', 'success').inc()
    return reply.status(201).send({ token, tenantId, userId })
  })

  app.post<{ Body: LoginBody }>('/api/v1/auth/login', {
    schema: {
      tags: ['Auth'],
      summary: 'Login with email and password',
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            token: { type: 'string' },
            tenantId: { type: 'string' },
            userId: { type: 'string' },
          },
        },
        401: AUTH_ERROR_SCHEMA,
      },
    },
  }, async (request, reply) => {
    const { email, password } = request.body
    const store = getUserStore()

    const found = await store.findByEmail(email)
    if (!found || !verifyPassword(password, found.passwordHash)) {
      authOperationTotal.labels('login', 'invalid_credentials').inc()
      const err: AuthError = { type: 'invalid_credentials', message: 'Invalid email or password' }
      return reply.status(401).send(err)
    }

    const token = generateJwt({
      userId: found.id,
      tenantId: found.tenantId,
      email: found.email,
      role: found.role,
      plan: found.plan,
    })

    setTokenCookie(reply, token)
    authOperationTotal.labels('login', 'success').inc()
    return reply.status(200).send({ token, tenantId: found.tenantId, userId: found.id })
  })

  app.post<{ Body: MachineTokenBody }>('/api/v1/auth/machine-token', {
    schema: {
      tags: ['Auth'],
      summary: 'Issue a machine token for tenant automation',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1 },
          scopes: { type: 'array', items: { type: 'string' } },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            token: { type: 'string' },
            tenantId: { type: 'string' },
            serviceAccountId: { type: 'string' },
            serviceAccountName: { type: 'string' },
            subjectType: { type: 'string' },
            scopes: { type: 'array', items: { type: 'string' } },
          },
        },
        401: AUTH_ERROR_SCHEMA,
        403: AUTH_ERROR_SCHEMA,
      },
    },
  }, async (request, reply) => {
    const token = extractJwtToken(request.headers)
    if (!token) {
      const err: AuthError = { type: 'missing_token', message: 'Missing or invalid Authorization header' }
      return reply.status(401).send(err)
    }

    const payload = verifyJwt(token)
    if (!payload) {
      const err: AuthError = { type: 'token_invalid', message: 'Invalid or expired token' }
      return reply.status(401).send(err)
    }

    if (payload.subjectType !== 'user' || !new Set(['owner', 'admin']).has(payload.role)) {
      const err: AuthError = { type: 'forbidden', message: 'Only owner/admin users can issue machine tokens' }
      return reply.status(403).send(err)
    }

    const serviceAccountId = randomUUID()
    const scopes = Array.isArray(request.body.scopes)
      ? request.body.scopes.filter((value): value is string => typeof value === 'string' && value.length > 0)
      : ['clipmart:write', 'growth:write', 'settings:write']

    const machineToken = generateMachineJwt({
      tenantId: payload.tenantId,
      serviceAccountId,
      serviceAccountName: request.body.name,
      plan: payload.plan,
      scopes,
    })

    authOperationTotal.labels('machine_token', 'success').inc()
    return reply.status(201).send({
      token: machineToken,
      tenantId: payload.tenantId,
      serviceAccountId,
      serviceAccountName: request.body.name,
      subjectType: 'machine',
      scopes,
    })
  })

  app.get('/api/v1/auth/me', {
    schema: {
      tags: ['Auth'],
      summary: 'Get current user info from JWT',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            tenantId: { type: 'string' },
            role: { type: 'string' },
            plan: { type: 'string' },
            subjectType: { type: 'string' },
            userId: { type: 'string' },
            email: { type: 'string' },
            serviceAccountId: { type: 'string' },
            serviceAccountName: { type: 'string' },
          },
        },
        401: AUTH_ERROR_SCHEMA,
      },
    },
  }, async (request, reply) => {
    const authHeader = request.headers.authorization
    const cookies = parseCookies(request.headers.cookie)
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : cookies[TOKEN_COOKIE_NAME]

    if (!token) {
      const err: AuthError = { type: 'missing_token', message: 'Missing or invalid Authorization header' }
      return reply.status(401).send(err)
    }

    const payload = verifyJwt(token)
    if (!payload) {
      const err: AuthError = { type: 'token_invalid', message: 'Invalid or expired token' }
      return reply.status(401).send(err)
    }

    if (payload.subjectType === 'machine') {
      return {
        tenantId: payload.tenantId,
        role: payload.role,
        plan: payload.plan,
        subjectType: payload.subjectType,
        serviceAccountId: payload.serviceAccountId,
        serviceAccountName: payload.serviceAccountName,
      }
    }

    return {
      userId: payload.userId,
      tenantId: payload.tenantId,
      email: payload.email,
      role: payload.role,
      plan: payload.plan,
      subjectType: payload.subjectType,
    }
  })
}

export default authRoute

export { getUserStore as _getTestUserStore }
