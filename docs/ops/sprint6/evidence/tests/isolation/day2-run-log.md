# Day 2 隔离测试执行记录

## 变更摘要

- 扩展 `seedTenantData` 支持多平台夹具：
  - Tenant A：`shopify + amazon`
  - Tenant B：`tiktok + shopee`
- 更新 DB 层 RLS 隔离测试，校验平台凭证按租户隔离且平台集合正确。
- 更新 API 层隔离测试，验证 `products` 返回平台分别为 `amazon` / `tiktok`。
- 补充反例场景：
  - `GET /api/v1/ads/campaigns` 缺失 `x-tenant-id` 返回 `401`
  - `GET /api/v1/inventory` 缺失 `x-tenant-id` 返回 `401`
  - Ads/Inventory 在 A/B 两租户下仅返回各自数据

## 执行命令

```bash
pnpm --filter @patioer/db test -- rls-all-tables.integration.test.ts
pnpm --filter @patioer/api test -- e2e-tenant-isolation.integration.test.ts
```

## 结果

- 最终实跑通过（2026-03-25 06:21）：
  - `@patioer/db`：`rls-all-tables.integration.test.ts` → `33 passed`
  - `@patioer/api`：`e2e-tenant-isolation.integration.test.ts` → `18 passed`
- 中间阻塞与修复：
  1. 初始 `skip`：未提供 `DATABASE_URL`。
  2. Docker daemon 不可用：等待 Docker Engine 就绪。
  3. 本地 DB 为 superuser 连接导致 RLS 旁路：创建非 superuser `postgres` 测试角色并授权。
  4. 本地 schema 缺失：执行 `db:push`。
  5. 本地缺 RLS policy：补齐并刷新 policy 后通过。

## 下一步

1. 将 `AC-P2-15` 更新为 ✅（已满足）。
2. 保留本文件作为 Day2 验收证据。
3. 进入 Day3 并发测试（AC-P2-16）。
