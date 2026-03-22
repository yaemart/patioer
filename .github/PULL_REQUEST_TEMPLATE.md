## Summary

<!-- 1-3 bullet points describing what this PR does and why -->

-

## Changes

<!-- List key files/modules changed. Group by area if helpful. -->

-

## Checklist

### Code Quality
- [ ] No new lint warnings (`pnpm lint`)
- [ ] TypeScript compiles cleanly (`pnpm typecheck`)
- [ ] Tests pass (`pnpm test`)
- [ ] API coverage thresholds met (`pnpm --filter api test:coverage`)
- [ ] Harness coverage thresholds met (`pnpm --filter @patioer/harness test:coverage`) — required when changing `packages/harness`

### Security
- [ ] No secrets or credentials committed
- [ ] API endpoints validate input (Zod / schema)
- [ ] Auth checks in place for new routes

### Multi-Tenant
- [ ] All DB queries go through `request.withDb` (RLS context)
- [ ] No raw `db` access outside `withTenantDb`
- [ ] New tables include `tenantId` + RLS policy (if applicable)

### Agent System
- [ ] Agent actions logged to `agent_events`
- [ ] Budget gate respected for execution routes
- [ ] Approval workflow triggered where required

### Observability
- [ ] Errors logged with structured context
- [ ] New env vars documented in `.env.example`

## Test Plan

<!-- How was this tested? Link to test files or describe manual verification. -->

-

## Related Issues

<!-- Link GitHub issues: Closes #123, Fixes #456 -->
