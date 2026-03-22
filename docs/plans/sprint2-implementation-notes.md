# Sprint 2 实现说明（与 `phase2-plan` 对齐）

> 供评审 / 交接：补齐计划文档中「状态」列与验收表之间的缺口。

## DG-03 · Paperclip Issue

| 层次 | 位置 |
|------|------|
| SDK | `packages/agent-runtime/src/paperclip-bridge.ts` — `createIssue()` |
| API 接线 | `apps/api/src/lib/agent-paperclip-ticket.ts` — `createIssueForAgentTicket()` |
| Agent 执行 | `apps/api/src/routes/agents-execute.ts` — `tickets.createTicket` 先调 Paperclip，再写 `agent_events` `ticket.create` |

**冒烟：** 配置 `PAPERCLIP_API_URL` + `PAPERCLIP_API_KEY` + `CRED_ENCRYPTION_KEY`，执行 Product Scout 且存在 flagged SKU 时，Paperclip Issues 应出现记录。详见 [`sprint2-day16-smoke-checklist.md`](./sprint2-day16-smoke-checklist.md)。

## DG-01 · Support Relay / Shopify Inbox

- **当前：** `ShopifyHarness.getOpenThreads` / `replyToMessage` 在未接 Inbox 时表现为空或占位；execute 返回 **warning**（Phase 1 MVP 文案）。
- **计划：** Inbox GraphQL 权限获批后在 Sprint 3+ 对接；与 `phase2-plan` 任务 **2.8** 一致。

## TikTok · `LIVE_ORDER`

- **路由：** `apps/api/src/routes/tiktok/webhook.ts` — 常量 `TIKTOK_WEBHOOK_TOPIC_LIVE_ORDER`，落库 `status=received_live`，并打 `info` 日志。
- **重放：** `apps/api/src/lib/webhook-replay.ts` — `inArray(status, ['received','received_live'])`。

## 健壮性 · execute 加载

- **`previewPromptForLlmStub`：** LLM stub 不因非法 `prompt` 抛错（`agents-execute.ts`）。
- **`createHarness`：** 在 `buildExecutionContext` 内 try/catch → **502** + `request.log.warn`。

## 多平台 · `resolveFirstCredential*`

- **默认顺序：** `shopify` → `amazon` → `tiktok` → `shopee`（常量 `DEFAULT_CREDENTIAL_PLATFORM_ORDER`，`resolve-credential.ts`）。
- **显式选择：** 请求头 **`x-platform: shopify|amazon|tiktok|shopee`**（大小写不敏感）→ 只解析该平台凭据；用于 `resolveHarness` / `resolveFirstCredential` 的路径（含 **`POST .../agents/:id/execute`**）。
- **Region：** 非 Shopify 平台若不存在 `region=global` 行，则取该 tenant+platform **最新一条** `platform_credentials`（覆盖 Amazon `na`/`eu`/`fe`、TikTok seller region、Shopee 多市场等）。

## Agent-native 修复（P0 / P1 / P2）

### P0 · 审批通过后异步执行

- **`PATCH /api/v1/approvals/:id/resolve`** 在 `approved` 时 `enqueueJob('webhook-processing', 'approval.execute', …)`。
- **`approval.execute` job 的 `platform`：** 与执行路由 harness 一致。`POST .../agents/:id/execute` 在写入 `approvals.payload` 时附带 **`electroosPlatform`**；resolve 时入队 **`platform`**（resolve body 可选 **`platform`** 覆盖存量行）。Worker 对 **`price.update`** 调用 `resolveFirstCredentialForTenant(tenantId, platform)`。
- **API 进程**在 `server.ts` 中启动 `webhook-processing` **BullMQ Worker**（`ENABLE_QUEUE_WORKERS=0` 可关闭），处理：
  - **`price.update`**：`harness.updatePrice` + `agent_events` `approval.executed`
  - **`support.escalate`**：仅记 `agent_events`（人工在 Inbox 处理；无自动发消息）
  - **其它 `action`**：记 `approval.executed`（`kind: unknown`）
- **幂等：** 若已存在 `action=approval.executed` 且 `payload.approvalId` 相同则跳过。

### P1 · 执行路由鉴权

- **`POST /api/v1/agents/:id/execute`** 的 `x-api-key` 接受 **`PAPERCLIP_API_KEY`** 或可选的 **`ELECTROOS_EXECUTE_API_KEY`**（租户侧自动化与 Paperclip 调度解耦）。

### P2 · OAuth / Inbox（非全自动说明）

- **店铺 OAuth（Shopify / Amazon / TikTok / Shopee）：** 需 **商户在浏览器完成授权**，无纯 headless 对等流程；生产环境配置 `APP_BASE_URL`、各平台 Console 回调白名单。
- **Shopify Inbox / Support Relay：** 见上文 DG-01；批准「升级」类审批后不会在平台自动发帖，需人工在客服工具中处理。

## 文档与 CI

- **遗留表：** `phase2-plan.md` §「Phase 1 遗留清理计划」— AC-01 / DG-01 / DG-03 状态已与上表同步。
- **CI：** `.github/workflows/ci.yml` — `lint`、`typecheck`、`test`、`api`/`harness` `test:coverage`。
- **运维：** [`../operations.md`](../operations.md) — Agent 执行密钥、队列 Worker、Redis。
