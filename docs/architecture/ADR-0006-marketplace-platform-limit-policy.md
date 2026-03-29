# ADR-0006: Marketplace Platform Limit Policy

| 字段 | 值 |
|------|-----|
| 状态 | **deferred** — 延迟至第 6 个 Marketplace 接入时执行 |
| 日期 | 2026-03-23 |
| 决策者 | 待定（需产品、商业、工程三方确认） |
| 触发来源 | Walmart + Wayfair 集成计划 §6 风险 R1 |
| 关联 | ADR-0005（Phase 5 架构决策）、`packages/shared/src/constants.ts` |

---

## 1. 背景

Walmart 接入 `SUPPORTED_PLATFORMS` 后，系统支持的 Marketplace 平台总数达到 **5**：

```
shopify · amazon · tiktok · shopee · walmart
```

`PLAN_PLATFORM_LIMITS` 当前定义：

| 套餐 | Marketplace 上限 | B2B 上限（独立计数） |
|------|------------------|---------------------|
| starter | 1 | 0 |
| growth | 3 | 1 |
| scale | **5** | 3 |

**核心矛盾**：`scale` 套餐（最高付费层级）的 Marketplace 上限恰好等于可用平台数量。若未来新增第 6 个 Marketplace（如 Lazada、eBay、Mercado Libre），`scale` 用户必须解绑现有平台才能接入——对最高付费客户体验不合理。

B2B 连接（Wayfair 等）在 Sprint B 中已与 Marketplace 计数完全解耦（`canAddB2BConnection` vs `canAddPlatform`），**不受此 ADR 影响**。

---

## 2. 触发条件

当以下条件**任一**成立时，本 ADR 从 `deferred` 转为 `proposed`，必须在该平台实施前完成决策：

```
SUPPORTED_PLATFORMS.length > PLAN_PLATFORM_LIMITS.scale
```

即：团队决定将第 6 个 Marketplace 加入 `SUPPORTED_PLATFORMS` 之前。

---

## 3. 决策选项

### 选项 A：逐次递增（scale 上限 +1）

```typescript
scale: 6  // 每新增一个 Marketplace 手动 +1
```

| 优点 | 缺点 |
|------|------|
| 最简单，一行代码 | 每次新增平台都需人工触发评审 |
| 不影响 starter / growth 定价 | scale 含义从"高级"变为"全平台"，定位模糊 |
| 向后兼容 Stripe 现有产品 | 若平台增速加快（8–10 个），每次修改成本累积 |

### 选项 B：scale 套餐设为无限制

```typescript
scale: Infinity  // 或代码中 -1 表示无上限
```

| 优点 | 缺点 |
|------|------|
| 一劳永逸，永远不再为 scale 用户操心平台限额 | 丧失了 "超出 scale 则需 enterprise 协商" 的天然升级漏斗 |
| 对最高付费客户体验最好 | 可能被极端租户滥用（连接 10+ 平台，API 配额吃紧） |
| 简单的代码改动 | 需要更新 Stripe 产品描述 / 官网定价页 |

### 选项 C：按需计费（pay-per-platform）

```typescript
scale: 5  // 基础含量不变
// 超出部分：$X/月/额外平台（Stripe metered billing）
```

| 优点 | 缺点 |
|------|------|
| 最灵活，LTV 最高 | 实现复杂度最高（需改 Stripe 计费逻辑、用量上报管线） |
| 对不同规模客户公平 | 前端需展示用量/超额提示 |
| 不需要在新平台上线时改常量 | 客户对 "隐性超额费用" 可能不满（SaaS 常见投诉） |

### 选项 D：保持不变 + Feature Flag 控制

```typescript
scale: 5  // 不改
// 新平台默认不对 scale 用户开放，需 per-tenant feature flag
```

| 优点 | 缺点 |
|------|------|
| 零代码改动，零定价影响 | 运营成本高（每个 scale 客户需手动开通） |
| 天然 A/B 测试通道 | 违反 "同一套餐同一功能集" 的 SaaS 原则 |
| 可以渐进推出新平台 | 客户支持团队负担增大 |

---

## 4. 推荐

| 时间线 | 推荐 | 理由 |
|--------|------|------|
| **短期**（第 6 平台接入时） | **选项 B** — scale 设为无限制 | 最简单、对最高付费客户体验最优；此时平台总数仍然有限（6–7），资源风险可控 |
| **中长期**（平台数 ≥ 8，或出现企业级大客户） | **选项 C** — 按需计费 | 实现可持续的单位经济模型，为 enterprise 层级铺路 |

**不推荐** 选项 A（每次手动 +1 是 toil）和选项 D（违反 SaaS 一致性原则）。

---

## 5. 当前决策

**Deferred**。在第 6 个 Marketplace 进入实施规划阶段时启动本 ADR 的正式评审。

在此之前：
- `PLAN_PLATFORM_LIMITS.scale` 保持为 `5`
- 不修改 Stripe 产品配置
- 不修改定价页措辞

---

## 6. 检查清单（启动时需确认）

- [ ] 产品确认定价调整方案
- [ ] 财务确认 MRR/ARPU 影响评估
- [ ] 工程确认 Stripe metered billing 改造范围（若选 C）
- [ ] 更新 `packages/shared/src/constants.ts` 中 `PLAN_PLATFORM_LIMITS`
- [ ] 更新 `packages/billing/src/plan-enforcer.ts` 中 `canAddPlatform` 逻辑（若选 B 需处理 Infinity）
- [ ] 更新 `apps/api/src/routes/dashboard.ts` 中 `platforms.limit` 显示逻辑
- [ ] 更新官网定价页
- [ ] 通知现有 scale 客户（若有定价变更）
