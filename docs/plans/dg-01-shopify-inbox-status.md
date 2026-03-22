# DG-01：Shopify Inbox / Support Relay 对接状态

**Sprint 2 · Day 14（CARD-D14-05）结论：推迟至 Phase 3 ⏳**

## 评估摘要

- Shopify **Inbox / Customer conversations** 与标准 Admin REST 不同，需要单独 OAuth scope 与 GraphQL（或 Inbox 专用 API）。
- 当前未在 Partners 控制台确认 **Inbox API** 权限已获批，无法在集成环境做端到端验证。

## 当前实现（降级路径）

- `ShopifyHarness.getOpenThreads()` 返回空数组 `[]`，**不发起网络请求**，避免误用未授权能力。
- `ShopifyHarness.replyToMessage()` 仍抛出 `HarnessError`（`not_implemented`），与 Inbox 未接线一致。

## Phase 3 跟进项

1. 在 Shopify Partners → App → API access 中确认 **Inbox / messaging** 相关权限状态。
2. 若已获批：在 `ShopifyHarness` 中接入 GraphQL Conversation / InboxMessage，并补充 `shopify.harness.test.ts`。
3. 若仍未获批：保持空实现，并在发布说明中注明依赖权限。

## 关联测试

- `Support Relay handles empty thread list gracefully`（`shopify.harness.test.ts`）
