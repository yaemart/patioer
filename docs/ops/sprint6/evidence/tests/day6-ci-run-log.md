# Day 6 CI 扩展执行记录（6.6）

## 变更范围

- 更新 CI workflow：`.github/workflows/ci.yml`
  - 新增 `integration-isolation` job（PostgreSQL + Redis service）
  - 新增 `integration-concurrency` job（PostgreSQL + Redis service）
  - 新增 `integration-rate-limit` job（Amazon 429 retry）
- 新增脚本：`scripts/ensure-db-test-role.ts`
  - 用于创建 `NOSUPERUSER + NOBYPASSRLS` 测试角色并授予必要权限
- 更新脚本：`scripts/apply-rls.ts`
  - 刷新全量 RLS policy（含 `ads_campaigns` / `inventory_levels` / `devos_tickets`）

## 本地验证命令

```bash
# 1) DB 预置
DATABASE_URL='postgres://gaoyuehebabadiannao@localhost:5432/patioer' pnpm exec tsx ./scripts/apply-rls.ts
DATABASE_URL='postgres://gaoyuehebabadiannao@localhost:5432/patioer' TEST_DATABASE_URL='postgres://patioer_ci:patioer_ci@localhost:5432/patioer' pnpm exec tsx ./scripts/ensure-db-test-role.ts

# 2) DB 隔离测试（non-super role）
DATABASE_URL='postgres://patioer_ci:patioer_ci@localhost:5432/patioer' pnpm --filter @patioer/db test -- rls-all-tables.integration.test.ts

# 3) API 隔离 + 并发
DATABASE_URL='postgres://patioer_ci:patioer_ci@localhost:5432/patioer' REDIS_URL='redis://localhost:6379' pnpm --filter @patioer/api test -- e2e-tenant-isolation.integration.test.ts
DATABASE_URL='postgres://patioer_ci:patioer_ci@localhost:5432/patioer' REDIS_URL='redis://localhost:6379' pnpm --filter @patioer/api test -- e2e-tenant-concurrency.integration.test.ts

# 4) Amazon 429 重试测试
pnpm --filter @patioer/harness test -- amazon.harness.test.ts
```

## 验证结果

- `@patioer/db` `rls-all-tables.integration.test.ts`: `33 passed`
- `@patioer/api` `e2e-tenant-isolation.integration.test.ts`: `18 passed`
- `@patioer/api` `e2e-tenant-concurrency.integration.test.ts`: `2 passed`
- `@patioer/harness` `amazon.harness.test.ts`: `33 passed`

## 备注

- 本地首次回归时存在历史遗留 `devos_tickets` system row，清理后复跑通过；CI 使用全新 service DB，不受该历史数据影响。
