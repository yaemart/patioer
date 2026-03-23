# 五 Agent 种子（Task 4.9 · Day 10）

与 **Onboarding Step 3**（`POST /api/v1/onboarding/initialize-agents`）共用实现：`apps/api/src/lib/seed-default-agents.ts`。

## 一键命令

```bash
# 需要已配置 DATABASE_URL，且能连上租户库（RLS 下 `app.tenant_id` 会设为该租户）
pnpm seed:agents <tenant-uuid>
```

预览（**不写库**、不调 Paperclip）：

```bash
pnpm seed:agents -- --dry-run <tenant-uuid>
```

## 环境变量

| 变量 | 用途 |
|------|------|
| `DATABASE_URL` | 必填，PostgreSQL 连接串 |
| `APP_BASE_URL` | Paperclip 心跳回调 URL 前缀；无则跳过 Paperclip 心跳注册（仍写 DB 行） |
| `PAPERCLIP_API_URL` / `PAPERCLIP_API_KEY` | 二者均配置时，在 `agents` 行写入后为每个 Agent 执行 `ensureAgent` + `registerHeartbeat` |

## 幂等语义

- 以 **`agents.type`**（租户内）为键：已存在则 **skip**，不更新 `name` / `goalContext`（非 upsert）。
- 二次执行：五个类型均在库中则 **`created: []`**，**`skipped`** 为五个类型；**不**重复插入，不产生重复 Paperclip 实体（`ensure*` 为幂等 API 时行为由 Paperclip 侧约定）。
- **`dryRun`**：只读已有 `type` 列表，输出将创建 / 将跳过；无 DB 写入、无 Paperclip、无预算类副作用。

## 五个默认类型（稳定顺序）

`product-scout` → `price-sentinel` → `support-relay` → `ads-optimizer` → `inventory-guard`

名称与 `goalContext` 见源码 `defaultAgentSpecs()`；心跳 cron 见 `DEFAULT_CRON`。

## 验证

- 单元测：`pnpm test:scripts`（根目录）或 `pnpm --filter @patioer/api exec vitest run src/lib/seed-default-agents.test.ts`
- DB：`SELECT type, name, status FROM agents WHERE tenant_id = '<uuid>' ORDER BY type;` 应最多五行、类型与上表一致。

## 相关

- Onboarding 健康检查（Harness + Paperclip canary）：见 [../onboarding-flow.md](../onboarding-flow.md) Step 4。

## 范围外（见 Phase 2 / Sprint 6）

- OpenAPI 全文、压测等（非本脚本职责）。
