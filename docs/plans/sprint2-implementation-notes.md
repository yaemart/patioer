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

## 文档与 CI

- **遗留表：** `phase2-plan.md` §「Phase 1 遗留清理计划」— AC-01 / DG-01 / DG-03 状态已与上表同步。
- **CI：** `.github/workflows/ci.yml` — `lint`、`typecheck`、`test`、`api`/`harness` `test:coverage`。
