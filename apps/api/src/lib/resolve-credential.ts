import type { FastifyRequest } from 'fastify'
import { schema, withTenantDb, type AppDb } from '@patioer/db'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { SUPPORTED_PLATFORMS, type SupportedPlatform } from './supported-platforms.js'

type CredRow = typeof schema.platformCredentials.$inferSelect

/**
 * Default order when no `preferredPlatform` / `x-platform` is set.
 * First matching credential row wins (tenant may have multiple platforms).
 */
export const DEFAULT_CREDENTIAL_PLATFORM_ORDER: readonly SupportedPlatform[] = SUPPORTED_PLATFORMS

const PLATFORM_SET = new Set<string>(SUPPORTED_PLATFORMS)

/**
 * Reads persisted platform hint from approval `payload` (set by agents-execute when
 * `requestApproval` runs — matches the harness used for that execution).
 */
export function parseElectroosPlatformFromPayload(payload: unknown): SupportedPlatform | undefined {
  if (payload === null || typeof payload !== 'object') return undefined
  const p = payload as Record<string, unknown>
  const raw = p.electroosPlatform
  if (typeof raw !== 'string') return undefined
  const n = raw.trim().toLowerCase()
  return PLATFORM_SET.has(n) ? (n as SupportedPlatform) : undefined
}

/**
 * Optional header: `x-platform: shopify | amazon | tiktok | shopee`
 * Restricts harness resolution to that platform only (must have a credential row).
 */
export function readPreferredPlatformFromRequest(request: FastifyRequest): SupportedPlatform | null {
  const raw = request.headers['x-platform']
  if (typeof raw !== 'string' || raw.length === 0) return null
  const normalized = raw.trim().toLowerCase()
  return PLATFORM_SET.has(normalized) ? (normalized as SupportedPlatform) : null
}

export async function queryCredentialForPlatform(
  db: AppDb,
  tenantId: string,
  platform: SupportedPlatform,
): Promise<CredRow | null> {
  // Shopify: prefer global row, then legacy rows with NULL region.
  if (platform === 'shopify') {
    const [globalRow] = await db
      .select()
      .from(schema.platformCredentials)
      .where(
        and(
          eq(schema.platformCredentials.tenantId, tenantId),
          eq(schema.platformCredentials.platform, 'shopify'),
          eq(schema.platformCredentials.region, 'global'),
        ),
      )
      .limit(1)
    if (globalRow) return globalRow

    const [legacyRow] = await db
      .select()
      .from(schema.platformCredentials)
      .where(
        and(
          eq(schema.platformCredentials.tenantId, tenantId),
          eq(schema.platformCredentials.platform, 'shopify'),
          isNull(schema.platformCredentials.region),
        ),
      )
      .limit(1)
    return legacyRow ?? null
  }

  // Other platforms: OAuth often stores region != 'global' (Amazon na/eu/fe, TikTok seller base,
  // Shopee market). Prefer `global` when present, else most recently created row for that platform.
  const [globalRow] = await db
    .select()
    .from(schema.platformCredentials)
    .where(
      and(
        eq(schema.platformCredentials.tenantId, tenantId),
        eq(schema.platformCredentials.platform, platform),
        eq(schema.platformCredentials.region, 'global'),
      ),
    )
    .limit(1)
  if (globalRow) return globalRow

  const [anyRow] = await db
    .select()
    .from(schema.platformCredentials)
    .where(
      and(
        eq(schema.platformCredentials.tenantId, tenantId),
        eq(schema.platformCredentials.platform, platform),
      ),
    )
    .orderBy(desc(schema.platformCredentials.createdAt))
    .limit(1)
  return anyRow ?? null
}

/**
 * `override === undefined` → read `x-platform` header.
 * `override === null` → do not use header (explicit “no platform preference” for this call).
 * Otherwise → use `override` as the platform.
 */
function resolveExplicitPlatform(
  request: FastifyRequest,
  override?: SupportedPlatform | null,
): SupportedPlatform | null {
  if (override !== undefined && override !== null) return override
  if (override === null) return null
  return readPreferredPlatformFromRequest(request)
}

async function pickFirstCredentialInDb(
  db: AppDb,
  tenantId: string,
  preferredPlatform?: SupportedPlatform | null,
): Promise<{ cred: CredRow; platform: SupportedPlatform } | null> {
  const platforms: readonly SupportedPlatform[] = preferredPlatform
    ? [preferredPlatform]
    : [...DEFAULT_CREDENTIAL_PLATFORM_ORDER]

  for (const platform of platforms) {
    const cred = await queryCredentialForPlatform(db, tenantId, platform)
    if (cred) return { cred, platform }
  }
  return null
}

/**
 * Resolves credentials for the first matching platform in
 * `DEFAULT_CREDENTIAL_PLATFORM_ORDER`, or only `preferredPlatform` when set
 * (caller argument or `x-platform` header).
 */
export async function resolveFirstCredentialForTenant(
  tenantId: string,
  preferredPlatform?: SupportedPlatform | null,
): Promise<{ cred: CredRow; platform: SupportedPlatform } | null> {
  return withTenantDb(tenantId, (db) => pickFirstCredentialInDb(db, tenantId, preferredPlatform))
}

export async function resolveFirstCredentialFromDb(
  db: AppDb,
  tenantId: string,
  preferredPlatform?: SupportedPlatform | null,
): Promise<{ cred: CredRow; platform: SupportedPlatform } | null> {
  return pickFirstCredentialInDb(db, tenantId, preferredPlatform)
}

export async function resolveFirstCredential(
  request: FastifyRequest,
  preferredPlatform?: SupportedPlatform | null,
): Promise<{ cred: CredRow; platform: SupportedPlatform } | null> {
  if (!request.withDb || !request.tenantId) return null

  const explicit = resolveExplicitPlatform(request, preferredPlatform)

  return request.withDb(async (db) => resolveFirstCredentialFromDb(db, request.tenantId!, explicit))
}

/**
 * Platforms that have at least one credential row for this tenant, in
 * {@link DEFAULT_CREDENTIAL_PLATFORM_ORDER} order.
 */
export async function listEnabledPlatformsFromDb(
  db: AppDb,
  tenantId: string,
): Promise<SupportedPlatform[]> {
  const out: SupportedPlatform[] = []
  for (const platform of DEFAULT_CREDENTIAL_PLATFORM_ORDER) {
    const cred = await queryCredentialForPlatform(db, tenantId, platform)
    if (cred) out.push(platform)
  }
  return out
}
