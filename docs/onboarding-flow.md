# 租户上线流程（Sprint 4 · Day 8–9）

面向「约 30 分钟内跑通」的操作顺序。Day 9 范围：**Agent 初始化**与**健康检查壳**；生产级心跳端到端深化见后续迭代（如 Day 11）。

## Step 1 — 注册租户

- **POST** `/api/v1/onboarding/register`
- 请求头：`x-onboarding-key: <ONBOARDING_REGISTER_API_KEY>`
- 响应体含 `tenantId`，后续步骤均通过 **`x-tenant-id`** 传递。

## Step 2 — 连接店铺（OAuth）

- 按 `nextSteps.shopifyOAuth`（或各平台既有 OAuth 路由）完成授权，确保 `platform_credentials` 中有对应平台凭证。

## Step 3 — 初始化五个默认 Agent

- **POST** `/api/v1/onboarding/initialize-agents`
- 请求头：`x-tenant-id: <tenantId>`
- 幂等：已存在的 `type` 会出现在 `skipped`，新插入的在 `created`。
- 若配置了 Paperclip（见下文），会为当前租户下的 Agent 注册心跳占位（回调 URL 依赖 `APP_BASE_URL`）。

默认五个类型（与 `pnpm seed:agents` / Task 4.9 对齐）：`product-scout`、`price-sentinel`、`support-relay`、`ads-optimizer`、`inventory-guard`。

## Step 4 — 健康检查（Task 4.10 / Day 11）

- **GET** `/api/v1/onboarding/health`
- 请求头：`x-tenant-id: <tenantId>`
- 行为概要：
  - **`platforms[]`**：对每个已连接平台（与 `listEnabledPlatformsFromDb` 一致）执行一次 **`getProducts({ limit: 1 })`**（单次超时默认 **15s**）；失败原因写在对应元素的 `error`，**单平台失败不掩盖**（见 `summary.platformFailures`）。
  - **`agents`**：本租户 Agent 行数与类型；**≥ 5** 时 `meetsMinimum` 为 true（与五 Agent 种子对齐）。
  - **`agentHeartbeats[]`**：Execute-pipeline 探针：按默认 Agent 顺序取**第一条** Agent，验证 **DB agent → credential resolve → harness init** 全链路可达（`agent-execute-probe.ts`）。该探针无副作用，不实际运行 Agent。
  - **`summary`**：`platformProbeCount`、`platformFailures`、`heartbeatOk`。
  - **`meta.phase`**：`day11`。
  - **`paperclip.configured`**：是否设置了 `PAPERCLIP_*` 环境变量（仅信息展示，不影响 `ok` 判定）。

`ok: true` 需要：**至少一个平台且全部平台探测成功**、**Agent 数量达标**，且 **execute-pipeline 探针成功**。无连接店铺时 `platforms` 为空，整体 `ok` 为 `false`。

## 环境变量

| 变量 | 用途 |
|------|------|
| `ONBOARDING_REGISTER_API_KEY` | Step 1 注册租户 |
| `APP_BASE_URL` | OAuth 回调、Agent 执行回调、Paperclip 心跳 URL；生产须 **https** |
| `PAPERCLIP_API_URL` / `PAPERCLIP_API_KEY` | Step 3 可选：Paperclip 公司与心跳注册 |

## 超时与重试

- 健康检查中**单次平台探测**默认 **15s**（见响应 `meta.probeTimeoutMs`）；超时会记为该平台 `ok: false` 并带错误信息。
- Harness 层另有各实现自身的重试策略；本端点不重试，可手动重试 **GET** `/api/v1/onboarding/health`。

## 与 CLI 对齐

- `pnpm seed:agents <tenantId>` 与 **Step 3** 共用 `apps/api/src/lib/seed-default-agents.ts` 逻辑。
- 预览：`pnpm seed:agents -- --dry-run <tenantId>`（不写库、不调 Paperclip）。
- 运维说明（幂等、`DATABASE_URL`、Paperclip）：[docs/ops/agents-seed.md](ops/agents-seed.md)。
