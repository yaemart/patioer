# Sprint 10 — 平台降级豁免签字 (AC-P4-27)

> 签署日期: 2026-03-28
> 阶段: Phase 4 · Sprint 10 · Week 7-8

## 概述

根据 Phase 4 计划 §Sprint 10 和 ADR-0004 §D23, 对于非 Shopify 平台联调,
当 API 审核未通过或沙箱环境不可用时，使用 **mock 降级豁免** 策略。

## 各平台状态

### 1. Amazon SP-API

| 项目 | 状态 |
|------|------|
| 审核 | SP-API 开发者注册待审 (D23: "Phase 4 全程 Sandbox") |
| Sandbox | `AmazonHarness` 已实现 sandbox URL 分流 (`useSandbox: true`) |
| 联调结果 | **结构验证通过** — 实例化、接口完整性、3 Region 支持 |
| 降级策略 | Sandbox mock; S14 压测阶段 Amazon 降级 mock (D23) |

**豁免签字**: Amazon SP-API 审核期间，全程使用 Sandbox 模式。
代码已就绪，待审核通过后切换 `useSandbox: false` 即可连通生产 API。

### 2. TikTok Shop

| 项目 | 状态 |
|------|------|
| 审核 | TikTok Shop 开发者审核待审 |
| 签名 | `buildTikTokSign` HMAC-SHA256 签名实现完毕 |
| 联调结果 | **结构验证通过** — 实例化、TenantHarness 接口完整性 |
| 降级策略 | 全 mock; webhook 真实推送待审核通过后验证 |

**豁免签字**: TikTok Shop 开发者审核期间，使用 mock 降级。
`TikTokHarness` 签名算法、请求层、重试逻辑、归一化器均已实现并通过单元测试。

### 3. Shopee Open Platform

| 项目 | 状态 |
|------|------|
| 审核 | Shopee Partner 审核待审 |
| 签名 | `buildShopeeSign` HMAC-SHA256 签名实现完毕 |
| Sandbox | `ShopeeHarness` 支持 sandbox endpoint (`sandbox: true`) |
| 联调结果 | **结构验证通过** — 实例化、sandbox endpoint、TenantHarness 接口完整性 |
| 降级策略 | SG+MY sandbox; 审核未通过则 mock 降级 |

**豁免签字**: Shopee Partner 审核期间，使用 sandbox + mock 降级。
代码已就绪，待审核通过后连通 SG/MY 真实 API。

## 验证证据

1. **multi-platform.integration.test.ts** — 3 平台结构验证全部通过
2. **harness 单元测试** — Amazon/TikTok/Shopee 签名算法、归一化器单元测试已通过
3. **Shopify 全功能联调** — Sprint 8 已完成 (shopify.integration.test.ts)

## 完成标准 (AC-P4-27)

> "至少 1 个非 Shopify 平台联调完成或降级豁免签字"

- [x] Amazon: Sandbox 结构验证 + 降级豁免 ✅
- [x] TikTok: Mock 降级豁免 ✅
- [x] Shopee: Sandbox 结构验证 + 降级豁免 ✅

## 后续计划

| Sprint | 动作 |
|--------|------|
| S11-12 | Amazon SP-API 审核通过 → Sandbox 联调 → 切换生产 |
| S12-13 | TikTok 开发者审核 → webhook 验证 → 生产联调 |
| S13-14 | Shopee Partner 审核 → SG/MY 生产联调 |
| S14 | 3 平台压力测试 + 降级 mock fallback 验证 |
