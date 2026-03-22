# Sprint 2 · Day 16 — CARD-D16-04 验收 Checklist + Sprint Review

> 对应 `phase2-plan.md` **CARD-D16-04**。在 Sprint Review 前由负责人逐项勾选并填写依据（PR、冒烟记录、CI 链接等）。

## 代码实现状态（与 checklist 对照）

| 项 | 说明 |
|----|------|
| **DG-03** | 已实现：`PaperclipBridge.createIssue`、`createIssueForAgentTicket`、`agents-execute` 中 `createTicket` 写审计并调 Paperclip；详见 `apps/api/src/lib/agent-paperclip-ticket.ts`。 |
| **DG-01** | 按任务 2.8：未接 Shopify Inbox GraphQL 时 **stub + warning**（`agents-execute` / Support Relay）；完整 Inbox 为 Phase 3。 |
| **LIVE_ORDER** | TikTok Webhook：`type=LIVE_ORDER` → `webhook_events.status=received_live`；`webhook-replay` 含 `received` 与 `received_live`。 |
| **createHarness 失败** | `buildExecutionContext` 内捕获 → **502**，避免绕过 execute 的 `HarnessError` 处理。 |

完整索引：**[`sprint2-implementation-notes.md`](./sprint2-implementation-notes.md)**。

## Sprint 2 完整验收清单

| # | 验收项 | 状态 | 依据 |
|---|--------|------|------|
| 1 | TikTok sandbox `getProducts()` 正常 | ⬜ | Day10 + Day15 冒烟 |
| 2 | Shopee SG + MY 两个市场 `getProducts()` 正常 | ⬜ | Day13 + Day16 冒烟 |
| 3 | TikTok Webhook 接收 `ORDER_STATUS_CHANGE` 事件 | ⬜ | Day11 + Day16 冒烟 |
| 4 | `PaperclipBridge.createIssue()` 可创建 Paperclip Issue | ⬜ | Day14 DG-03 回收 |
| 5 | 三平台 Harness mock 测试全部通过 | ⬜ | Day15 套件整合 |
| 6 | TikTok HMAC-SHA256 签名测试通过 | ⬜ | Day9 |
| 7 | Shopee 多市场签名测试通过 | ⬜ | Day12 |
| 8 | TikTok / Shopee OAuth 路由完整 | ⬜ | Day11 / Day14 |
| 9 | harness-factory 支持 4 平台（Shopify/Amazon/TikTok/Shopee） | ⬜ | Day6 + Day11 + Day14 |
| 10 | CI pipeline 通过（含新 Harness 测试） | ⬜ | Day16 |

## 新增代码统计（预估，来自计划）

| 类别 | 新增文件 | 新增代码行（估） | 新增测试 case |
|------|---------|----------------|-------------|
| packages/harness | 6 文件 | ~700 行 | ~45 case |
| apps/api routes | 4 文件 | ~350 行 | ~20 case |
| apps/api lib | 1 文件（factory 扩展） | ~50 行 | ~4 case |
| packages/db | — | — | — |
| 配置/文档 | 2 文件 | ~20 行 | — |
| **总计** | **~13 文件** | **~1120 行** | **~69 case** |

实际数字可在合并前执行：`git diff origin/main --stat | tail -20`

## Sprint 3 准备事项（Day16 下午）

1. 确认 `packages/market` 包脚手架需要的汇率 API（Open Exchange Rates / Fixer.io）
2. 确认 Amazon SP-API 审核进度（若已通过，Sprint 3 可切换真实凭证）
3. 准备 6 国市场合规规则数据（SG/MY/TH/PH/ID/VN）
4. 评估 Prometheus prom-client 与现有 Fastify 的集成方案

**产出：** Sprint 2 全部验收通过 · Sprint 3 准备就绪
