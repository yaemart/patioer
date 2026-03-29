import { withTenantDb, schema } from '@patioer/db'
import { registry } from './harness-registry.js'

export interface PersistOAuthCredentialInput {
  tenantId: string
  platform: string
  region: string
  accessToken: string
  credentialType?: string
  shopDomain?: string | null
  scopes?: string[] | null
  metadata?: Record<string, unknown> | null
}

export async function persistOAuthCredential(
  input: PersistOAuthCredentialInput,
): Promise<void> {
  await withTenantDb(input.tenantId, async (db) => {
    await db
      .insert(schema.platformCredentials)
      .values({
        tenantId: input.tenantId,
        platform: input.platform,
        credentialType: input.credentialType ?? 'oauth',
        region: input.region,
        shopDomain: input.shopDomain ?? null,
        accessToken: input.accessToken,
        scopes: input.scopes ?? null,
        metadata: input.metadata ?? null,
      })
      .onConflictDoUpdate({
        target: [
          schema.platformCredentials.tenantId,
          schema.platformCredentials.platform,
          schema.platformCredentials.region,
        ],
        set: {
          credentialType: input.credentialType ?? 'oauth',
          shopDomain: input.shopDomain ?? null,
          accessToken: input.accessToken,
          scopes: input.scopes ?? null,
          metadata: input.metadata ?? null,
        },
      })
  })

  registry.invalidate(`${input.tenantId}:${input.platform}`)
}
