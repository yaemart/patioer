/**
 * Applies RLS policies that schema push cannot express.
 * Idempotent by design: ALTER TABLE + DROP POLICY IF EXISTS + CREATE POLICY.
 */
import pg from 'pg'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required')

  const client = new pg.Client({ connectionString: url })
  await client.connect()

  try {
    const tenantScopedTables = [
      'platform_credentials',
      'products',
      'orders',
      'agents',
      'agent_events',
      'approvals',
      'webhook_events',
      'ads_campaigns',
      'inventory_levels',
      'devos_tickets',
      // Phase 5 tables
      'billing_usage_logs',
      'billing_reconciliation',
      'clipmart_templates',
      'template_reviews',
      'referral_codes',
      'referral_rewards',
      'nps_responses',
      'onboarding_progress',
      'tenant_governance_settings',
    ]

    for (const table of tenantScopedTables) {
      try {
        await client.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`)
        await client.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`)
      } catch (err: unknown) {
        const pgErr = err as { code?: string }
        // 42P01 undefined_table (some tables may not exist in earlier phases)
        if (pgErr.code === '42P01') {
          console.log(`[rls] skipped missing table: ${table}`)
          continue
        }
        throw err
      }
    }

    const policyStatements = [
      `DROP POLICY IF EXISTS tenant_isolation_platform_credentials ON platform_credentials`,
      `CREATE POLICY tenant_isolation_platform_credentials ON platform_credentials USING (tenant_id = current_setting('app.tenant_id')::uuid)`,

      `DROP POLICY IF EXISTS tenant_isolation_products ON products`,
      `CREATE POLICY tenant_isolation_products ON products USING (tenant_id = current_setting('app.tenant_id')::uuid)`,

      `DROP POLICY IF EXISTS tenant_isolation_orders ON orders`,
      `CREATE POLICY tenant_isolation_orders ON orders USING (tenant_id = current_setting('app.tenant_id')::uuid)`,

      `DROP POLICY IF EXISTS tenant_isolation_agents ON agents`,
      `CREATE POLICY tenant_isolation_agents ON agents USING (tenant_id = current_setting('app.tenant_id')::uuid)`,

      `DROP POLICY IF EXISTS tenant_isolation_agent_events ON agent_events`,
      `CREATE POLICY tenant_isolation_agent_events ON agent_events USING (tenant_id = current_setting('app.tenant_id')::uuid)`,

      `DROP POLICY IF EXISTS tenant_isolation_approvals ON approvals`,
      `CREATE POLICY tenant_isolation_approvals ON approvals USING (tenant_id = current_setting('app.tenant_id')::uuid)`,

      `DROP POLICY IF EXISTS tenant_isolation_webhook_events ON webhook_events`,
      `CREATE POLICY tenant_isolation_webhook_events ON webhook_events USING (tenant_id = current_setting('app.tenant_id')::uuid)`,

      `DROP POLICY IF EXISTS tenant_isolation_ads_campaigns ON ads_campaigns`,
      `CREATE POLICY tenant_isolation_ads_campaigns ON ads_campaigns USING (tenant_id = current_setting('app.tenant_id')::uuid)`,

      `DROP POLICY IF EXISTS tenant_isolation_inventory_levels ON inventory_levels`,
      `CREATE POLICY tenant_isolation_inventory_levels ON inventory_levels USING (tenant_id = current_setting('app.tenant_id')::uuid)`,

      `DROP POLICY IF EXISTS tenant_or_system_devos_tickets ON devos_tickets`,
      `CREATE POLICY tenant_or_system_devos_tickets ON devos_tickets USING (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id')::uuid)`,

      // Phase 5 — billing
      `DROP POLICY IF EXISTS tenant_isolation_billing_usage_logs ON billing_usage_logs`,
      `CREATE POLICY tenant_isolation_billing_usage_logs ON billing_usage_logs USING (tenant_id = current_setting('app.tenant_id')::uuid)`,

      `DROP POLICY IF EXISTS tenant_isolation_billing_reconciliation ON billing_reconciliation`,
      `CREATE POLICY tenant_isolation_billing_reconciliation ON billing_reconciliation USING (tenant_id = current_setting('app.tenant_id')::uuid)`,

      // Phase 5 — clipmart (public templates visible to all; private scoped to author)
      `DROP POLICY IF EXISTS clipmart_template_access ON clipmart_templates`,
      `CREATE POLICY clipmart_template_access ON clipmart_templates USING (is_public = true OR author_tenant_id = current_setting('app.tenant_id')::uuid)`,

      `DROP POLICY IF EXISTS template_review_access ON template_reviews`,
      `CREATE POLICY template_review_access ON template_reviews USING (tenant_id = current_setting('app.tenant_id')::uuid)`,

      // Phase 5 — growth
      `DROP POLICY IF EXISTS tenant_isolation_referral_codes ON referral_codes`,
      `CREATE POLICY tenant_isolation_referral_codes ON referral_codes USING (tenant_id = current_setting('app.tenant_id')::uuid)`,

      `DROP POLICY IF EXISTS tenant_isolation_referral_rewards ON referral_rewards`,
      `CREATE POLICY tenant_isolation_referral_rewards ON referral_rewards USING (referrer_tenant_id = current_setting('app.tenant_id')::uuid)`,

      `DROP POLICY IF EXISTS tenant_isolation_nps_responses ON nps_responses`,
      `CREATE POLICY tenant_isolation_nps_responses ON nps_responses USING (tenant_id = current_setting('app.tenant_id')::uuid)`,

      // Phase 5 — onboarding
      `DROP POLICY IF EXISTS tenant_isolation_onboarding_progress ON onboarding_progress`,
      `CREATE POLICY tenant_isolation_onboarding_progress ON onboarding_progress USING (tenant_id = current_setting('app.tenant_id')::uuid)`,

      // Phase 5 — governance settings
      `DROP POLICY IF EXISTS tenant_isolation_governance_settings ON tenant_governance_settings`,
      `CREATE POLICY tenant_isolation_governance_settings ON tenant_governance_settings USING (tenant_id = current_setting('app.tenant_id')::uuid)`,
    ]

    for (const stmt of policyStatements) {
      try {
        await client.query(stmt)
      } catch (err: unknown) {
        const pgErr = err as { code?: string }
        // 42P01 undefined_table (phase-specific table missing)
        if (pgErr.code === '42P01') continue
        throw err
      }
    }

    console.log('[rls] All RLS policies refreshed.')
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error('[rls] Failed:', err)
  process.exit(1)
})
