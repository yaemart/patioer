# Sprint 11 — 验收证据归档

> 日期: 2026-03-29
> 阶段: Phase 4 · Sprint 11 · Week 9-10

## 测试结果摘要

| 包 | 测试文件 | 通过 | 失败 | 跳过 |
|----|----------|------|------|------|
| packages/harness | 15 | 全通过 | 0 | 0 |
| packages/agent-runtime | 45 | 全通过 | 0 | 5 |
| packages/devos-bridge | 18 | 全通过 | 0 | 27 |
| packages/shared | 1 | 全通过 | 0 | 0 |
| packages/dataos | 1 | 全通过 | 0 | 0 |
| **全量合计** | **80 通过 / 3 跳过** | **956 passed** | **0** | **32** |

TypeScript 类型检查: ✅ 全部通过 (harness, agent-runtime)
ESLint: ✅ 0 error / 0 warning

## Sprint 11 验收条件

### AC-P4-15: B2B Harness 三接口正常

| 证据 | 文件 | 结果 |
|------|------|------|
| B2B 类型定义 | `packages/harness/src/b2b.types.ts` | ✅ |
| B2B Harness 实现 | `packages/harness/src/b2b.harness.ts` | ✅ |
| `getProducts` (含 MOQ/专属目录) | `b2b.harness.ts::getProducts + filterCatalogByTier` | ✅ |
| `updatePrice` (3 档阶梯价格) | `b2b.harness.ts::updatePrice + buildDefaultTiers` | ✅ |
| `receiveEDIOrder` (EDI 850 → Order) | `b2b.harness.ts::receiveEDIOrder + parseEDI850` | ✅ |
| `getAnalytics` | `b2b.harness.ts::getAnalytics` | ✅ |
| 完整 TenantHarness 接口实现 | 10 个方法全覆盖 | ✅ |
| 单元测试 | `b2b.harness.test.ts` — 28/28 通过 | ✅ |
| E2E 冒烟测试 | `b2b.e2e.test.ts` — 14/14 通过 | ✅ |

### AC-P4-16: B2B 阶梯定价 3 档正确

| 证据 | 文件 | 结果 |
|------|------|------|
| 3 档阶梯结构 | `TieredPrice[3]` tuple 强制 3 档 | ✅ |
| Tier-1: 基础价 (1-99) | `buildDefaultTiers` 测试 | ✅ |
| Tier-2: -10% (100-499) | `buildDefaultTiers` 测试 | ✅ |
| Tier-3: -20% (500+) | `buildDefaultTiers` 测试 | ✅ |
| `resolveUnitPrice` 正确选择 tier | 6 个断言覆盖全部区间 | ✅ |
| `updatePrice` 自动生成 3 档 | `updatePriceSchedule` mock 验证 | ✅ |

## 新增/修改文件清单

### 新增文件 (6 个)

| 文件 | 用途 |
|------|------|
| `packages/harness/src/b2b.types.ts` | B2B 类型定义 (EDI 850, 阶梯定价, buyerTier) |
| `packages/harness/src/b2b.harness.ts` | B2B Harness (TenantHarness 完整实现) |
| `packages/harness/src/b2b.harness.test.ts` | B2B Harness 单元测试 (28 用例) |
| `packages/harness/src/b2b.e2e.test.ts` | B2B E2E 冒烟测试 (14 用例) |
| `packages/agent-runtime/src/b2b-agent-config.ts` | B2B Agent 配置差异 |
| `packages/agent-runtime/src/b2b-agent-config.test.ts` | B2B Agent 配置测试 |

### 修改文件 (5 个)

| 文件 | 变更 |
|------|------|
| `packages/harness/src/types.ts` | Platform 类型 +`'b2b'` |
| `packages/harness/src/index.ts` | +export b2b.types, b2b.harness |
| `packages/agent-runtime/src/types.ts` | SupportRelayRunInput +toneSystemPrompt |
| `packages/agent-runtime/src/agents/support-relay.agent.ts` | 支持可选 toneSystemPrompt |
| `packages/agent-runtime/src/index.ts` | +export b2b-agent-config |

## 架构决策追踪

| ADR | 决策 | 实现 |
|-----|------|------|
| D21 | B2B 独立 tenant_id, 零架构改动 | ✅ B2BHarness 复用 TenantHarness 接口 |
| §2.3 | Agent 不直调 SDK | ✅ B2B 通过 B2BBackendAdapter 抽象 |
| §4.3 | 价格审批阈值 | ✅ B2B 5% (vs B2C 15%) |

## B2B Agent 配置差异

| Agent | B2C 默认 | B2B 差异 | 机制 |
|-------|---------|---------|------|
| Price Sentinel | 15% 审批阈值 | 5% 审批阈值 | `approvalThresholdPercent` 输入参数 |
| Support Relay | 友好口语化 | 正式商务语气 | `toneSystemPrompt` 输入参数 |
