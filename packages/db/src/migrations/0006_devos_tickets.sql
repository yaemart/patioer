-- Sprint 5 Task 5.9 — devos_tickets（ElectroOS 侧）+ RLS（系统级 tenant_id IS NULL）
-- See docs/plans/phase2-plan.md §4.4

CREATE TABLE devos_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants (id),
  type TEXT NOT NULL,
  priority TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  context JSONB,
  status TEXT NOT NULL DEFAULT 'open',
  devos_ticket_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ
);

ALTER TABLE devos_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE devos_tickets FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_or_system_devos_tickets ON devos_tickets
  USING (
    tenant_id IS NULL
    OR tenant_id = current_setting('app.tenant_id')::uuid
  );
