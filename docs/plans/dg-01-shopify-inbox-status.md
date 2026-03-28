# DG-01：Shopify Inbox / Support Relay 对接状态

**最终状态：Phase 4 正式降级 — webhook-only 模式 ✅ 已签署豁免**

---

## 历史

| 阶段 | 日期 | 决策 |
|------|------|------|
| Phase 1 Sprint 2 | 2026-01 | 推迟至 Phase 3 ⏳ |
| Phase 3 Sprint 6 | 2026-03-26 | 仍未获得 Inbox API 权限，继续 ⏳ |
| **Phase 4 Sprint 7** | **2026-03-28** | **正式降级为 webhook-only（ADR-0004 D24）** |

## 降级决策理由

1. Shopify **Inbox / Customer conversations** 需要单独 OAuth scope 与 GraphQL（或 Inbox 专用 API），与标准 Admin REST 接口不同
2. 经 Phase 1–3 三个阶段持续跟进，**Inbox API 权限仍未在 Partners 控制台获批**
3. Support Relay Agent 的核心价值（自动回复客户咨询）在 webhook-only 模式下已可通过 Shopify Webhooks（orders/create, refunds/create 等）实现基础客户通知，满足 MVP 需求
4. 完整 Inbox 对话能力推迟至 **Phase 5 增值功能**（需 Shopify 审批完成为前提）

## 当前实现（降级路径 — 保持不变）

- `ShopifyHarness.getOpenThreads()` 返回空数组 `[]`，**不发起网络请求**
- `ShopifyHarness.replyToMessage()` 抛出 `HarnessError`（`not_implemented`）
- Support Relay Agent 在 webhook-only 模式下正常处理 order/refund 事件

## Phase 5 完整实现前提

1. Shopify Partners → App → API access 中 **Inbox / messaging** 权限审批通过
2. 在 `ShopifyHarness` 中接入 GraphQL Conversation / InboxMessage
3. 补充 `shopify.harness.test.ts` Inbox 相关用例

## 关联测试

- `Support Relay handles empty thread list gracefully`（`shopify.harness.test.ts`）

## 关联文档

- [ADR-0004 · D24 DG-01 处理决策](../adr/0004-phase4-autonomous-loop.md)
- [Phase 4 Plan §2 遗留修复](./phase4-plan.md)

## 豁免签字

- Tech Lead：@davidgao ✅ 2026-03-28
- PM：@davidgao ✅ 2026-03-28
- 下次复核：Phase 5 启动前（预计 2026-Q4）
