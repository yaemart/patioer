# Phase 2 实施计划 · 多平台扩展 + DevOS 基础

**周期：** 12 周（Month 3–5）  
**目标：** 接入 Amazon / TikTok Shop / Shopee 三平台，新增 Ads Optimizer + Inventory Guard，搭建 DevOS 基础结构  
**验收：** 20 项（见 §9）  
**前提：** Phase 1 验收通过（12 有效项中 11 ✅ + 1 ⏳ AC-01 需 Sprint 1 首日完成）  
**不做：** DataOS、完整 Dev Loop、B2B Portal、付费用户

> 术语约定：本文中的 **Agent（智能体）** 统一简称为 **Agent**。

---

## 0. 架构决策（Phase 2 前提）

### 0.1 继承自 Phase 1 的决策

| # | 决策 | 结论 | 来源 |
|---|------|------|------|
| D1 | 仓库策略 | **独立 Monorepo**（`patioer/`）；Paperclip 并排服务 | [ADR-0001](../adr/0001-paperclip-integration.md) |
| D2 | Web 框架 | ElectroOS **Fastify**；Paperclip Express | Constitution Ch3.1 |
| D3 | ORM | **Drizzle ORM**；不侵入 Paperclip schema | Constitution Ch3.1 |
| D4 | Event 存储 | PostgreSQL 追加表（`agent_events`）；Phase 3 再引入 ClickHouse | [数据结构 brainstorm](../brainstorms/2026-03-21-electroos-data-system-structure-brainstorm.md) |

### 0.2 Phase 2 新增决策

| # | 决策 | 结论 | ADR |
|---|------|------|-----|
| D7 | PlatformHarness 扩展 | **广告方法**（`getAdsPerformance` / `updateAdsBid` / `getAdsCampaigns`）和**库存方法**（`getInventoryLevels`）作为 Harness 接口可选扩展（`AdsCapableHarness` / `InventoryCapableHarness`），不破坏已有 Agent 代码 | ADR-0002 |
| D8 | Market Harness 层级 | **独立 `packages/market`**，位于 PlatformHarness 之上；负责货币转换、税务计算、合规检查；Agent 通过 `MarketContext` 获取标准化信息 | ADR-0002 |
| D9 | DevOS 部署 | DevOS 作为**独立 Paperclip 实例**运行（端口 3200）、独立 DB；通过 Ticket 协议与 ElectroOS 通信 | [DevOS 架构 brainstorm](../brainstorms/2026-03-21-electroos-devos-architecture-brainstorm.md) |
| D10 | 多平台凭证模型 | `platform_credentials` 表扩展 `credential_type` / `region` / `metadata` JSONB 字段，适配 Amazon LWA、TikTok HMAC、Shopee 多市场签名 | — |
| D11 | BullMQ 队列 | Phase 2 正式引入 **BullMQ + Redis**，用于 Webhook 分发、多平台 API 请求限流队列、Agent 执行队列 | Constitution 预留 |
| D12 | Phase 1 遗留清理 | AC-01 Paperclip 联调在 Sprint 1 Day 1 完成；DG-01/02/03 在 Sprint 2-3 回收 | Phase 1 §7.1 |

### 关键约束回顾（Constitution 硬门槛 — 延续 Phase 1）

- Agent **绝不**直调平台 SDK → 必须经 Harness
- 所有核心表 **tenant_id + RLS**
- 价格变动 **>15%** 须人工审批
- 广告日预算 **>$500** 须人工审批（Phase 2 新增）
- 所有 Agent 操作写入**不可变审计日志**
- 测试覆盖率 **≥ 80%**（Phase 2 含新平台 Harness）

---

## 1. Monorepo 目录结构变更（Phase 2 增量）

```
patioer/                              # ElectroOS Monorepo root
├── apps/
│   └── api/
│       └── src/
│           ├── routes/
│           │   ├── amazon/           # NEW: Amazon OAuth + Webhook
│           │   │   ├── oauth.ts
│           │   │   └── webhook.ts
│           │   ├── tiktok/           # NEW: TikTok OAuth + Webhook
│           │   │   ├── oauth.ts
│           │   │   └── webhook.ts
│           │   ├── shopee/           # NEW: Shopee OAuth + Webhook
│           │   │   ├── oauth.ts
│           │   │   └── webhook.ts
│           │   ├── inventory.ts      # NEW: 库存 API
│           │   ├── ads.ts            # NEW: 广告 API
│           │   └── onboarding.ts     # NEW: 租户自助 Onboarding
│           ├── lib/
│           │   ├── rate-limiter.ts   # NEW: 多平台 API 限流（基于 BullMQ）
│           │   └── devos-client.ts   # NEW: ElectroOS → DevOS Ticket 客户端
│           └── plugins/
│               └── metrics.ts        # NEW: Prometheus 指标埋点
├── packages/
│   ├── harness/
│   │   └── src/
│   │       ├── amazon.harness.ts     # NEW
│   │       ├── amazon.harness.test.ts
│   │       ├── tiktok.harness.ts     # NEW
│   │       ├── tiktok.harness.test.ts
│   │       ├── shopee.harness.ts     # NEW
│   │       ├── shopee.harness.test.ts
│   │       ├── ads.harness.ts        # NEW: AdsCapableHarness 接口
│   │       └── inventory.harness.ts  # NEW: InventoryCapableHarness 接口
│   ├── market/                       # NEW PACKAGE: 多市场统一层
│   │   ├── src/
│   │   │   ├── currency.ts           # 汇率转换（缓存 1h）
│   │   │   ├── tax.ts               # 税务计算（GST/VAT/SST）
│   │   │   ├── compliance.ts        # 合规检查（禁售品/认证要求）
│   │   │   ├── market-context.ts    # MarketContext 聚合
│   │   │   └── types.ts
│   │   └── package.json
│   ├── devos-bridge/                 # NEW PACKAGE: DevOS 通信桥
│   │   ├── src/
│   │   │   ├── ticket-protocol.ts   # DevOsTicket 类型 + 创建/查询
│   │   │   ├── devos-client.ts      # HTTP 客户端
│   │   │   └── types.ts
│   │   └── package.json
│   ├── agent-runtime/
│   │   └── src/
│   │       ├── agents/
│   │       │   ├── ads-optimizer.agent.ts      # NEW
│   │       │   └── inventory-guard.agent.ts    # NEW
│   │       └── context.ts            # EXTEND: 多平台 getHarness(platform)
│   └── db/
│       └── src/
│           ├── schema/
│           │   ├── ads-campaigns.ts  # NEW
│           │   ├── inventory.ts      # NEW
│           │   └── devos-tickets.ts  # NEW
│           └── migrations/
│               └── 0002_phase2.sql   # NEW: 新表 + RLS
├── docker-compose.devos.yml          # NEW: DevOS 独立实例
└── scripts/
    ├── agents.seed.ts                # EXTEND: 5 Agent 种子
    └── devos-seed.ts                 # NEW: DevOS SRE Agent 种子
```

---

## 2. 六 Sprint 分解（12 周）

### Sprint 1 · Week 1–2 — Phase 1 收尾 + Amazon Harness

**交付物：** Paperclip 联调完成、Phase 1 降级项回收启动、Amazon SP-API Harness、凭证模型扩展

> **关键风险前置：** Amazon SP-API 需 Selling Partner 账号审核（2–4 周），**必须在 Sprint 1 Day 1 提交申请**。Sprint 1 使用沙盒 API 开发，Sprint 3-4 切换真实凭证。

| # | 任务 | 包/目录 | 依赖 | 估时 |
|---|------|---------|------|------|
| 1.1 | **AC-01 闭环**：Paperclip 实例联调 — 3 Agent ACTIVE 验证 | `paperclip/` + `apps/api` | — | 0.5d |
| 1.2 | Amazon SP-API 开发者资质申请（Day 1 提交） | 外部操作 | — | 0.5d |
| 1.3 | `platform_credentials` 扩展：`credential_type` / `region` / `metadata` JSONB | `packages/db` | — | 0.5d |
| 1.4 | RLS migration `0002_phase2.sql`：新增表 + 扩展字段 + RLS 策略 | `packages/db` | 1.3 | 0.5d |
| 1.5 | BullMQ + Redis 基础：连接配置、队列工厂、限流中间件 | `apps/api` lib | — | 1d |
| 1.6 | `PlatformHarness` 接口扩展：`AdsCapableHarness` + `InventoryCapableHarness` 可选接口 | `packages/harness` | — | 1d |
| 1.7 | `AmazonHarness` 实现：`getProducts` / `updatePrice` / `getOrders`（SP-API sandbox） | `packages/harness` | 1.6 | 2d |
| 1.8 | `AmazonHarness` 实现：`getAnalytics`（Reports API 异步）/ `replyToMessage`（Buyer-Seller） | `packages/harness` | 1.7 | 1d |
| 1.9 | Amazon 限流适配：指数退避 + BullMQ 请求队列（Orders API 0.5 req/s） | `packages/harness` + `apps/api` | 1.5, 1.7 | 1d |
| 1.10 | Amazon OAuth flow：LWA Token + Refresh Token 管理 | `apps/api` routes/amazon | 1.3, 1.7 | 1d |

**Sprint 1 验收：**
- [ ] AC-01 闭环：3 Agent 在 Paperclip Dashboard ACTIVE
- [ ] `platform_credentials` 支持 `amazon` 类型凭证
- [ ] Amazon sandbox `getProducts()` 返回商品数据
- [ ] BullMQ 限流队列运行正常
- [ ] CI pipeline 通过（含新包）

#### Sprint 1 · Day-by-Day 实施细节

---

##### Day 1 — Phase 1 闭环 + Amazon 申请 + DB 扩展

---

> **🃏 CARD-D1-01 · Amazon SP-API 开发者资质申请**
>
> **类型：** 外部操作（无代码）  
> **耗时：** 30 min  
> **优先级：** 🔴 Day 1 第一件事，审核周期 2-4 周不可延迟
>
> **操作步骤：**
> 1. 登录 [Amazon Seller Central](https://sellercentral.amazon.com) → Apps & Services → Develop Apps
> 2. 点击 "Add new app client"
> 3. 填写：
>    - App name: `ElectroOS Multi-Platform Manager`
>    - API type: `SP API`
>    - IAM ARN: 按引导创建（选 "Self-authorization"）
> 4. 申请 API 权限勾选：
>    - `Catalog Items` (getCatalogItems)
>    - `Listings` (patchListingsItem)
>    - `Orders` (getOrders)
>    - `Reports` (createReport / getReport)
>    - `Product Pricing` (getCompetitivePricing)
>    - `Messaging` (createConfirmCustomizationDetails)
> 5. 提交后获得 **Application ID** + **Client ID** + **Client Secret**
> 6. 进入 Sandbox 设置 → 确认 Sandbox 模式已激活
>
> **验收：**
> - [ ] Application ID 已记录到团队 Vault / 1Password
> - [ ] Client ID + Client Secret 已安全存储
> - [ ] Sandbox endpoint 可调通：`https://sandbox.sellingpartnerapi-na.amazon.com`
>
> **产出：** 申请确认截图 · Sandbox credentials 记录

---

> **🃏 CARD-D1-02 · AC-01 闭环：Paperclip 实例联调**
>
> **类型：** 运维操作 + 验证  
> **耗时：** 2h  
> **依赖：** Paperclip 源码已在 `paperclip/` 目录
>
> **Step 1 — 启动 Paperclip**
> ```bash
> # 确认 paperclip/ 目录存在
> ls paperclip/package.json
>
> # 启动 PostgreSQL + Paperclip
> docker-compose up -d postgres paperclip
>
> # 等待 Paperclip 就绪（约 30s）
> curl -s http://localhost:3000/api/health | jq .
> # 期望：{ "status": "ok" } 或等价健康响应
> ```
>
> **Step 2 — 配置环境变量**
>
> 在项目根目录 `.env` 中确保以下变量有值：
> ```bash
> PAPERCLIP_API_URL=http://localhost:3000
> PAPERCLIP_API_KEY=dev-api-key-change-me
> APP_BASE_URL=http://localhost:3100
> ```
>
> **Step 3 — 启动 ElectroOS API**
> ```bash
> pnpm dev
> # 确认：ElectroOS API started { port: 3100 }
> # 确认：agent bootstrap complete（或 "Paperclip not configured" 若 key 不对）
> ```
>
> **Step 4 — 执行 Agent 种子**
> ```bash
> # 先确保有一个测试租户（从 staging-seed 或手动插入）
> pnpm seed:agents <test-tenant-uuid>
> # 期望输出：
> # { "created": ["product-scout","price-sentinel","support-relay"],
> #   "skipped": [], "registered": ["product-scout","price-sentinel","support-relay"] }
> ```
>
> **Step 5 — 验证 Paperclip Dashboard**
> - 访问 `http://localhost:3000` → Dashboard → Agents
> - 确认 3 个 Agent 状态为 **ACTIVE**
> - 确认 heartbeat schedule 显示正确 cron
>
> **Step 6 — 验证 heartbeat 回调连通**
> ```bash
> # 模拟 Paperclip 触发 heartbeat 回调
> curl -s -X POST http://localhost:3100/api/v1/agents/<agent-uuid>/execute \
>   -H 'Content-Type: application/json' \
>   -H 'x-api-key: dev-api-key-change-me' \
>   -d '{}' | jq .
> # 期望：200 或 Agent 执行响应（非 404 / 401）
> ```
>
> **验收：**
> - [ ] Paperclip :3000 health 返回 200
> - [ ] `seedDefaultAgents` 输出 3 个 created 或 skipped（幂等）
> - [ ] `ensureCompany` / `ensureProject` / `ensureAgent` / `registerHeartbeat` 均成功
> - [ ] Dashboard 3 Agent ACTIVE
> - [ ] heartbeat callback :3100 连通
>
> **产出：** Phase 1 AC-01 标记 ✅ · 截图存档至 `docs/evidence/`

---

> **🃏 CARD-D1-03 · `platform_credentials` Schema 多平台扩展**
>
> **类型：** 代码变更  
> **耗时：** 1.5h  
> **目标文件：** `packages/db/src/schema/platform-credentials.ts`
>
> **当前文件完整内容：**
> ```
> 1:32:packages/db/src/schema/platform-credentials.ts
> ```
>
> **变更：将整个文件替换为以下内容**
>
> ```typescript
> import {
>   jsonb,
>   pgTable,
>   text,
>   timestamp,
>   uniqueIndex,
>   uuid,
> } from 'drizzle-orm/pg-core'
> import { tenants } from './tenants.js'
>
> /**
>  * Multi-platform credential storage.
>  * accessToken is AES-256 encrypted at the application layer.
>  *
>  * Platform-specific notes:
>  *   Shopify  — credentialType='oauth', shopDomain required
>  *   Amazon   — credentialType='lwa', region required, metadata: { sellerId, marketplaceId }
>  *   TikTok   — credentialType='hmac', metadata: { appKey, appSecret }
>  *   Shopee   — credentialType='hmac', region required (SG/MY/TH/PH/ID/VN),
>  *              metadata: { partnerId, shopId }
>  */
> export const platformCredentials = pgTable(
>   'platform_credentials',
>   {
>     id: uuid('id').defaultRandom().primaryKey(),
>     tenantId: uuid('tenant_id')
>       .notNull()
>       .references(() => tenants.id),
>     platform: text('platform').notNull(),
>     credentialType: text('credential_type').notNull().default('oauth'),
>     shopDomain: text('shop_domain'),
>     accessToken: text('access_token').notNull(),
>     scopes: text('scopes').array(),
>     region: text('region'),
>     metadata: jsonb('metadata').$type<Record<string, unknown>>(),
>     expiresAt: timestamp('expires_at', { withTimezone: true }),
>     createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
>   },
>   (t) => [
>     uniqueIndex('platform_credentials_tenant_platform_idx').on(
>       t.tenantId,
>       t.platform,
>       t.region,
>     ),
>   ],
> )
> ```
>
> **变更清单（与原文件的 diff）：**
>
> | 行为 | 字段/元素 | 变更说明 |
> |------|----------|---------|
> | ADD import | `jsonb` | 新增 `jsonb` 导入 |
> | ADD column | `credentialType` | `text('credential_type').notNull().default('oauth')` |
> | CHANGE column | `shopDomain` | 去掉 `.notNull()` → 可空（Amazon/TikTok 无此字段） |
> | ADD column | `region` | `text('region')` — 可空 |
> | ADD column | `metadata` | `jsonb('metadata').$type<Record<string, unknown>>()` |
> | CHANGE index | 唯一索引 | `(tenantId, platform, shopDomain)` → `(tenantId, platform, region)` |
> | CHANGE index name | 索引名 | `..._domain_idx` → `..._platform_idx` |
>
> **验证命令：**
> ```bash
> pnpm --filter @patioer/db typecheck
> pnpm --filter @patioer/api typecheck   # 确认消费方无破坏
> pnpm test                              # 全量回归
> ```
>
> **兼容性说明：**
> - `credentialType` 有 `.default('oauth')`，现有 Shopify 行无需回填
> - `shopDomain` 去掉 notNull 是向后兼容的（允许 null）
> - `region` / `metadata` 均可空，现有行不受影响
> - 索引变更：**新索引不兼容旧索引**，必须配合 migration（CARD-D1-04）
>
> **产出：** schema 文件更新 · typecheck 通过 · 测试绿色

---

> **🃏 CARD-D1-04 · RLS Migration 0002（Part 1: 凭证表扩展）**
>
> **类型：** 新建文件  
> **耗时：** 1h  
> **目标文件：** `packages/db/src/migrations/0002_phase2.sql`（新建）  
> **依赖：** CARD-D1-03 完成
>
> **文件完整内容：**
>
> ```sql
> -- Phase 2 Migration: Part 1 — Multi-platform credential support
> --
> -- Extends platform_credentials for Amazon (LWA), TikTok (HMAC), Shopee (HMAC).
> -- Part 2 (ads_campaigns, inventory_levels, devos_tickets + RLS) added in Sprint 3-5.
> --
> -- Applied via: psql $DATABASE_URL -f packages/db/src/migrations/0002_phase2.sql
> --       or via: scripts/apply-rls.ts (Phase 1 pattern)
>
> -- 1. New columns on platform_credentials
> ALTER TABLE platform_credentials
>   ADD COLUMN IF NOT EXISTS credential_type TEXT NOT NULL DEFAULT 'oauth';
>
> ALTER TABLE platform_credentials
>   ADD COLUMN IF NOT EXISTS region TEXT;
>
> ALTER TABLE platform_credentials
>   ADD COLUMN IF NOT EXISTS metadata JSONB;
>
> -- 2. Allow shop_domain to be NULL (Amazon/TikTok don't use it)
> ALTER TABLE platform_credentials
>   ALTER COLUMN shop_domain DROP NOT NULL;
>
> -- 3. Replace unique index: old was (tenant_id, platform, shop_domain),
> --    new is (tenant_id, platform, region) with COALESCE for NULL safety.
> DROP INDEX IF EXISTS platform_credentials_tenant_platform_domain_idx;
>
> CREATE UNIQUE INDEX platform_credentials_tenant_platform_idx
>   ON platform_credentials (tenant_id, platform, COALESCE(region, '__none__'));
>
> -- 4. Backfill existing rows: set credential_type = 'oauth' for Shopify
> --    (already the DEFAULT, but explicit for clarity in audits)
> UPDATE platform_credentials
>   SET credential_type = 'oauth'
>   WHERE credential_type IS NULL;
> ```
>
> **验证步骤：**
> ```bash
> # 方式 1：本地 psql 直接执行
> psql postgres://postgres:postgres@localhost:5432/patioer \
>   -f packages/db/src/migrations/0002_phase2.sql
>
> # 方式 2：验证执行后列已存在
> psql postgres://postgres:postgres@localhost:5432/patioer \
>   -c "\d platform_credentials"
> # 期望看到：credential_type, region, metadata 三列
> # 期望看到：shop_domain 允许 NULL
>
> # 方式 3：验证索引
> psql postgres://postgres:postgres@localhost:5432/patioer \
>   -c "\di platform_credentials_*"
> # 期望看到：platform_credentials_tenant_platform_idx
> # 不再看到：platform_credentials_tenant_platform_domain_idx
>
> # 方式 4：验证 RLS 策略仍生效
> psql postgres://postgres:postgres@localhost:5432/patioer \
>   -c "SELECT * FROM platform_credentials;"
> # 期望：报错或空结果（无 app.tenant_id 时 RLS 拒绝）
> ```
>
> **产出：** migration 文件已创建 · 本地 DB 已应用 · RLS 策略未被破坏

---

> **🃏 CARD-D1-05 · `agentTypeEnum` 扩展（为 Phase 2 新 Agent 预留）**
>
> **类型：** 代码变更  
> **耗时：** 15 min  
> **目标文件：** `packages/db/src/schema/agents.ts`
>
> **变更：扩展 `agentTypeEnum` 添加 Phase 2 新 Agent 类型**
>
> 当前值：
> ```typescript
> export const agentTypeEnum = pgEnum('agent_type', [
>   'product-scout',
>   'price-sentinel',
>   'support-relay',
> ])
> ```
>
> 替换为：
> ```typescript
> export const agentTypeEnum = pgEnum('agent_type', [
>   'product-scout',
>   'price-sentinel',
>   'support-relay',
>   'ads-optimizer',
>   'inventory-guard',
> ])
> ```
>
> **同步 migration（追加到 0002_phase2.sql 末尾）：**
> ```sql
> -- 5. Extend agent_type enum for Phase 2 agents
> ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ads-optimizer';
> ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'inventory-guard';
> ```
>
> **验证：**
> ```bash
> pnpm --filter @patioer/db typecheck
> pnpm test
> ```
>
> **产出：** enum 扩展完成 · 不影响现有 Agent 查询

---

> **🃏 CARD-D1-06 · `webhook_events` 表扩展（多平台 source 字段）**
>
> **类型：** 代码变更  
> **耗时：** 20 min  
> **目标文件：** `packages/db/src/schema/webhook-events.ts`
>
> 当前表的 `shopDomain` 列是 Shopify 专用的。Phase 2 需要支持 Amazon / TikTok / Shopee Webhook。
>
> **变更：新增 `platform` 列，`shopDomain` 改为可空**
>
> 在列定义中追加：
> ```typescript
> platform: text('platform').notNull().default('shopify'),
> ```
>
> 修改 `shopDomain`：
> ```typescript
> shopDomain: text('shop_domain'),  // 去掉 .notNull()
> ```
>
> **同步 migration（追加到 0002_phase2.sql 末尾）：**
> ```sql
> -- 6. webhook_events: add platform column, allow null shop_domain
> ALTER TABLE webhook_events
>   ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'shopify';
>
> ALTER TABLE webhook_events
>   ALTER COLUMN shop_domain DROP NOT NULL;
> ```
>
> **验证：**
> ```bash
> pnpm --filter @patioer/db typecheck
> pnpm test   # webhook-dedup / webhook-replay 测试不应失败
> ```
>
> **产出：** webhook_events 支持多平台

---

> **🃏 CARD-D1-07 · Day 1 回归测试 + 检查点**
>
> **类型：** 验证  
> **耗时：** 30 min  
> **依赖：** CARD-D1-01 ~ D1-06 全部完成
>
> **全量验证命令：**
> ```bash
> # 1. 类型检查（全 monorepo）
> pnpm typecheck
>
> # 2. 全量测试
> pnpm test
>
> # 3. Lint
> pnpm lint
>
> # 4. 覆盖率检查（确认不低于 Phase 1 水位）
> pnpm --filter @patioer/api test:coverage
> ```
>
> **检查点清单：**
>
> | # | 检查项 | 命令/方法 | 期望 |
> |---|--------|----------|------|
> | 1 | Amazon SP-API 申请已提交 | 检查邮件确认 | Application ID 已记录 |
> | 2 | Paperclip :3000 运行 | `curl localhost:3000/api/health` | 200 |
> | 3 | 3 Agent ACTIVE | Paperclip Dashboard | 截图 |
> | 4 | typecheck 通过 | `pnpm typecheck` | exit 0 |
> | 5 | 160+ tests 通过 | `pnpm test` | 0 failures |
> | 6 | platform_credentials 新列 | `\d platform_credentials` | credential_type, region, metadata 可见 |
> | 7 | 旧索引已删除 | `\di platform_credentials_*` | 只有 `_tenant_platform_idx` |
> | 8 | agent_type enum | `SELECT unnest(enum_range(NULL::agent_type))` | 含 ads-optimizer, inventory-guard |
> | 9 | webhook_events.platform | `\d webhook_events` | platform 列 default 'shopify' |
> | 10 | RLS 未被破坏 | `SELECT * FROM products` (无 tenant context) | 空或报错 |
>
> **产出：** Day 1 全部完成 · 代码可安全提交

---

**Day 1 卡片执行顺序汇总：**

```
09:00  CARD-D1-01  Amazon SP-API 申请          (30min, 外部操作)
09:30  CARD-D1-02  Paperclip 联调 AC-01        (2h, 运维+验证)
11:30  午餐
13:00  CARD-D1-03  platform_credentials 扩展   (1.5h, schema 变更)
14:30  CARD-D1-04  migration 0002 part 1       (1h, SQL)
15:30  CARD-D1-05  agentTypeEnum 扩展          (15min)
15:45  CARD-D1-06  webhook_events 多平台       (20min)
16:05  CARD-D1-07  回归测试 + 检查点           (30min)
16:35  Day 1 完成
```

---

##### Day 2 — BullMQ + Redis 基础设施

---

> **🃏 CARD-D2-01 · 基础依赖与容器准备（Redis + BullMQ）**
>
> **类型：** 环境与依赖  \
> **耗时：** 30 min  \
> **目标文件：** `docker-compose.yml`、`apps/api/package.json`、`.env.example`
>
> **执行步骤：**
> 1. 在 `docker-compose.yml` 新增 `redis` service：
>    - `image: redis:7-alpine`
>    - 暴露端口 `6379`
>    - volume `redis_data:/data`
> 2. 在 `api` service 的 `environment` 添加：`REDIS_URL=redis://redis:6379`
> 3. 在根目录 `.env.example` 添加：`REDIS_URL=redis://localhost:6379`
> 4. 安装依赖（在 `apps/api`）：
>    ```bash
>    pnpm add bullmq ioredis
>    ```
> 5. 验证：
>    ```bash
>    docker-compose up -d redis
>    docker exec -it patioer-redis redis-cli PING
>    # 期望：PONG
>    ```
>
> **验收：**
> - [ ] Redis 容器可启动并返回 `PONG`
> - [ ] `apps/api/package.json` 存在 `bullmq` 与 `ioredis`
> - [ ] `REDIS_URL` 已纳入 compose 与 `.env.example`
>
> **产出：** Day2 基础环境就绪

---

> **🃏 CARD-D2-02 · Redis 连接管理模块**
>
> **类型：** 新建文件  \
> **耗时：** 45 min  \
> **目标文件：** `apps/api/src/lib/redis.ts`
>
> **函数签名模板（可直接复制）：**
>
> ```typescript
> import IORedis from 'ioredis'
>
> let redisClient: IORedis | null = null
>
> export function getRedisClient(): IORedis {
>   // TODO
>   throw new Error('not implemented')
> }
>
> export async function closeRedisClient(): Promise<void> {
>   // TODO
> }
>
> export async function assertRedisConnection(): Promise<boolean> {
>   // TODO
>   return false
> }
> ```
>
> **实现约束：**
> - 单例连接（重复调用 `getRedisClient()` 返回同一实例）
> - 默认 URL：`redis://localhost:6379`
> - 配置 `maxRetriesPerRequest: null`（BullMQ 推荐）
> - `closeRedisClient()` 要幂等（重复调用不抛错）
>
> **测试文件：** `apps/api/src/lib/redis.test.ts`
>
> **测试用例名字（逐条实现）：**
> - `getRedisClient returns singleton instance`
> - `getRedisClient uses REDIS_URL from env`
> - `assertRedisConnection returns true when ping is PONG`
> - `closeRedisClient can be called multiple times safely`
>
> **产出：** Redis 连接层可复用、可关闭、可健康探测

---

> **🃏 CARD-D2-03 · BullMQ 队列工厂模块**
>
> **类型：** 新建文件  \
> **耗时：** 1h  \
> **目标文件：** `apps/api/src/lib/queue-factory.ts`
>
> **函数签名模板（可直接复制）：**
>
> ```typescript
> import { Queue, Worker, type JobsOptions, type WorkerOptions, type Job } from 'bullmq'
>
> export type QueueName =
>   | 'amazon-api-requests'
>   | 'tiktok-api-requests'
>   | 'shopee-api-requests'
>   | 'webhook-processing'
>
> export function getQueue(name: QueueName): Queue {
>   // TODO
>   throw new Error('not implemented')
> }
>
> export async function enqueueJob<T = unknown>(
>   queueName: QueueName,
>   jobName: string,
>   payload: T,
>   opts?: JobsOptions,
> ): Promise<Job<T>> {
>   // TODO
>   throw new Error('not implemented')
> }
>
> export function createWorker<T = unknown>(
>   queueName: QueueName,
>   processor: (job: Job<T>) => Promise<unknown>,
>   opts?: Omit<WorkerOptions, 'connection'>,
> ): Worker<T> {
>   // TODO
>   throw new Error('not implemented')
> }
>
> export async function closeAllQueues(): Promise<void> {
>   // TODO
> }
> ```
>
> **实现约束：**
> - `Map<QueueName, Queue>` 缓存，避免重复创建队列对象
> - 所有队列都复用 `getRedisClient()` 连接
> - `closeAllQueues()` 遍历关闭并清空缓存
>
> **测试文件：** `apps/api/src/lib/queue-factory.test.ts`
>
> **测试用例名字（逐条实现）：**
> - `getQueue returns same queue instance for same name`
> - `getQueue returns different queue instances for different names`
> - `enqueueJob adds job into target queue`
> - `createWorker binds processor with redis connection`
> - `closeAllQueues closes and clears queue cache`
>
> **产出：** 统一队列入口，为 Day6 限流与排队打基础

---

> **🃏 CARD-D2-04 · 平台限流配置与 Amazon 请求队列入口**
>
> **类型：** 新建文件  \
> **耗时：** 45 min  \
> **目标文件：** `apps/api/src/lib/rate-limiter.ts`
>
> **函数签名模板（可直接复制）：**
>
> ```typescript
> import type { JobsOptions } from 'bullmq'
> import { enqueueJob, getQueue, type QueueName } from './queue-factory.js'
>
> export interface PlatformRateLimit {
>   maxPerSecond: number
>   burst: number
> }
>
> export type PlatformId = 'shopify' | 'amazon' | 'tiktok' | 'shopee'
>
> export function getPlatformRateLimit(platform: PlatformId): PlatformRateLimit {
>   // TODO
>   throw new Error('not implemented')
> }
>
> export function getPlatformQueueName(platform: PlatformId): QueueName {
>   // TODO
>   throw new Error('not implemented')
> }
>
> export async function enqueuePlatformRequest<T = unknown>(
>   platform: PlatformId,
>   jobName: string,
>   payload: T,
>   opts?: JobsOptions,
> ) {
>   // TODO
>   throw new Error('not implemented')
> }
>
> export function getAmazonRequestQueue() {
>   // TODO
>   throw new Error('not implemented')
> }
> ```
>
> **默认参数建议：**
> - `shopify`: `2 req/s`, `burst=2`
> - `amazon`: `0.5 req/s`, `burst=1`
> - `tiktok`: `10 req/s`, `burst=20`
> - `shopee`: `10 req/s`, `burst=20`
>
> **测试文件：** `apps/api/src/lib/rate-limiter.test.ts`
>
> **测试用例名字（逐条实现）：**
> - `getPlatformRateLimit returns configured value for amazon`
> - `getPlatformRateLimit returns configured value for shopify`
> - `getPlatformQueueName maps platform to expected queue`
> - `enqueuePlatformRequest pushes job into mapped queue`
> - `getAmazonRequestQueue returns amazon-api-requests queue`
>
> **产出：** Day2 限流配置中心完成

---

> **🃏 CARD-D2-05 · Server 优雅关闭接入 Redis**
>
> **类型：** 代码变更  \
> **耗时：** 20 min  \
> **目标文件：** `apps/api/src/server.ts`
>
> **改动点：**
> - 导入 `closeRedisClient`（来自 `lib/redis.ts`）
> - 在 `shutdown` 流程中，`app.close()` 后调用 `closeRedisClient()`
> - 保证任何一步失败都不会导致进程挂死（兜底 `process.exit(1)`）
>
> **函数签名模板（新增 helper，可选）：**
>
> ```typescript
> async function gracefulShutdown(): Promise<void> {
>   // TODO
> }
> ```
>
> **测试文件：** `apps/api/src/server.shutdown.test.ts`（可新增）
>
> **测试用例名字（逐条实现）：**
> - `gracefulShutdown closes fastify app and redis client`
> - `gracefulShutdown exits with failure when close throws`
>
> **产出：** 进程退出时不遗留 Redis 连接

---

> **🃏 CARD-D2-06 · Day2 回归与验收门禁**
>
> **类型：** 验证  \
> **耗时：** 30 min  \
> **依赖：** CARD-D2-01 ~ D2-05 完成
>
> **执行命令（按顺序）：**
>
> ```bash
> # 1) 依赖安装与锁文件一致性
> pnpm install
>
> # 2) 类型检查
> pnpm typecheck
>
> # 3) Lint
> pnpm lint
>
> # 4) 全量测试
> pnpm test
>
> # 5) API 覆盖率
> pnpm --filter @patioer/api test:coverage
> ```
>
> **Day2 验收清单：**
> - [ ] `docker-compose.yml` 已包含 `redis` service
> - [ ] `apps/api` 已安装 `bullmq` + `ioredis`
> - [ ] `redis.ts` 可提供单例连接并安全关闭
> - [ ] `queue-factory.ts` 提供队列缓存与通用 enqueue
> - [ ] `rate-limiter.ts` 含 4 平台限流配置与 Amazon 队列入口
> - [ ] `server.ts` 退出流程已纳入 Redis close
> - [ ] `pnpm typecheck && pnpm lint && pnpm test` 全绿
>
> **产出：** Day2 可合并状态（功能 + 测试 + 文档）

---

**Day 2 卡片执行顺序汇总：**

```
09:00  CARD-D2-01  Redis 环境与依赖准备              (30min)
09:30  CARD-D2-02  redis.ts 连接管理                  (45min)
10:15  CARD-D2-03  queue-factory.ts 队列工厂          (1h)
11:15  CARD-D2-04  rate-limiter.ts 限流入口           (45min)
13:30  CARD-D2-05  server.ts 优雅关闭                 (20min)
14:00  CARD-D2-06  回归验证与验收门禁                 (30min)
```

---

##### Day 3 — Harness 接口扩展 + AmazonHarness 骨架

---

> **🃏 CARD-D3-01 · `ads.harness.ts` 接口与类型守卫**
>
> **类型：** 新建文件  \
> **耗时：** 45 min  \
> **目标文件：** `packages/harness/src/ads.harness.ts`
>
> **函数签名模板（可直接复制）：**
>
> ```typescript
> import type { TenantHarness } from './base.harness.js'
>
> export interface AdsPerformanceOpts {
>   days?: number
>   campaignIds?: string[]
> }
>
> export interface AdsPerformance {
>   campaignId: string
>   campaignName: string
>   platform: string
>   spend: number
>   revenue: number
>   roas: number
>   impressions: number
>   clicks: number
> }
>
> export interface AdsCampaign {
>   id: string
>   name: string
>   status: 'active' | 'paused' | 'ended'
>   dailyBudget: number
>   totalSpend: number
> }
>
> export interface AdsCapableHarness {
>   getAdsPerformance(opts?: AdsPerformanceOpts): Promise<AdsPerformance[]>
>   getAdsCampaigns(): Promise<AdsCampaign[]>
>   updateAdsBid(adId: string, newBid: number): Promise<void>
>   updateAdsBudget(campaignId: string, dailyBudget: number): Promise<void>
> }
>
> export function isAdsCapable(h: TenantHarness): h is TenantHarness & AdsCapableHarness {
>   // TODO
>   return false
> }
> ```
>
> **测试文件：** `packages/harness/src/ads.harness.test.ts`
>
> **测试用例名字（逐条实现）：**
> - `isAdsCapable returns true when getAdsPerformance exists`
> - `isAdsCapable returns false for plain TenantHarness`
> - `isAdsCapable returns false when value is not function`
>
> **产出：** 广告能力接口 + 类型守卫

---

> **🃏 CARD-D3-02 · `inventory.harness.ts` 接口与类型守卫**
>
> **类型：** 新建文件  \
> **耗时：** 30 min  \
> **目标文件：** `packages/harness/src/inventory.harness.ts`
>
> **函数签名模板（可直接复制）：**
>
> ```typescript
> export interface InventoryLevel {
>   productId: string
>   platform: string
>   quantity: number
>   locationId?: string
> }
>
> export interface InventoryCapableHarness {
>   getInventoryLevels(productIds?: string[]): Promise<InventoryLevel[]>
> }
>
> export function isInventoryCapable(h: unknown): h is InventoryCapableHarness {
>   // TODO
>   return false
> }
> ```
>
> **测试文件：** `packages/harness/src/inventory.harness.test.ts`
>
> **测试用例名字（逐条实现）：**
> - `isInventoryCapable returns true when getInventoryLevels exists`
> - `isInventoryCapable returns false for null and primitive values`
> - `isInventoryCapable returns false when getInventoryLevels is not function`
>
> **产出：** 库存能力接口 + 类型守卫

---

> **🃏 CARD-D3-03 · 扩展 `types.ts` 与 `index.ts` 导出**
>
> **类型：** 代码变更  \
> **耗时：** 20 min  \
> **目标文件：** `packages/harness/src/types.ts`、`packages/harness/src/index.ts`
>
> **变更 1：扩展 `Product`（向后兼容）**
>
> ```typescript
> export interface Product {
>   id: string
>   title: string
>   price: number
>   inventory: number
>   variantCount?: number
>   platform?: string
>   currency?: string
>   asin?: string
>   sku?: string
> }
> ```
>
> **变更 2：统一导出**
>
> ```typescript
> export * from './ads.harness.js'
> export * from './inventory.harness.js'
> ```
>
> **测试文件（可复用）**：`packages/harness/src/ads.harness.test.ts`、`packages/harness/src/inventory.harness.test.ts`
>
> **测试用例名字（可新增）：**
> - `Product type remains backward compatible with shopify payload`
>
> **产出：** 新接口可被外部包导入使用

---

> **🃏 CARD-D3-04 · Amazon 内部类型定义**
>
> **类型：** 新建文件  \
> **耗时：** 20 min  \
> **目标文件：** `packages/harness/src/amazon.types.ts`
>
> **类型模板（可直接复制）：**
>
> ```typescript
> export interface AmazonCatalogItem {
>   asin: string
>   summaries?: Array<{
>     marketplaceId: string
>     itemName: string
>     brandName?: string
>   }>
>   attributes?: Record<string, unknown>
> }
>
> export interface AmazonOrder {
>   AmazonOrderId: string
>   OrderStatus: string
>   OrderTotal?: { Amount: string; CurrencyCode: string }
> }
>
> export interface AmazonListingsPatch {
>   op: 'replace' | 'delete'
>   path: string
>   value?: unknown[]
> }
> ```
>
> **测试文件：**（Day3 不强制，Day5 的 `amazon.harness.test.ts` 覆盖）
>
> **产出：** AmazonHarness 实现前置类型资产

---

> **🃏 CARD-D3-05 · `amazon.harness.ts` 骨架（构造 + token 刷新）**
>
> **类型：** 新建文件  \
> **耗时：** 1.5h  \
> **目标文件：** `packages/harness/src/amazon.harness.ts`
>
> **函数签名模板（可直接复制）：**
>
> ```typescript
> import type { TenantHarness } from './base.harness.js'
> import { HarnessError } from './harness-error.js'
> import type {
>   Product,
>   Order,
>   Thread,
>   Analytics,
>   DateRange,
>   PaginationOpts,
> } from './types.js'
>
> const REGION_ENDPOINTS: Record<'NA' | 'EU' | 'FE', string> = {
>   NA: 'https://sellingpartnerapi-na.amazon.com',
>   EU: 'https://sellingpartnerapi-eu.amazon.com',
>   FE: 'https://sellingpartnerapi-fe.amazon.com',
> }
>
> const SANDBOX_ENDPOINT = 'https://sandbox.sellingpartnerapi-na.amazon.com'
> const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token'
>
> export interface AmazonCredentials {
>   clientId: string
>   clientSecret: string
>   refreshToken: string
>   region: 'NA' | 'EU' | 'FE'
>   sellerId: string
>   marketplaceId: string
>   sandbox?: boolean
> }
>
> export class AmazonHarness implements TenantHarness {
>   readonly platformId = 'amazon'
>   private accessToken: string | null = null
>   private tokenExpiresAt = 0
>   private readonly endpoint: string
>
>   constructor(
>     readonly tenantId: string,
>     private readonly credentials: AmazonCredentials,
>   ) {
>     this.endpoint = credentials.sandbox
>       ? SANDBOX_ENDPOINT
>       : REGION_ENDPOINTS[credentials.region]
>   }
>
>   private async ensureAccessToken(): Promise<string> {
>     // TODO
>     throw new Error('not implemented')
>   }
>
>   async getProducts(_opts?: PaginationOpts): Promise<Product[]> {
>     throw new HarnessError('amazon', 'not_implemented', 'Day4 implementation')
>   }
>
>   async updatePrice(_productId: string, _price: number): Promise<void> {
>     throw new HarnessError('amazon', 'not_implemented', 'Day4 implementation')
>   }
>
>   async updateInventory(_productId: string, _qty: number): Promise<void> {
>     throw new HarnessError('amazon', 'not_implemented', 'Day4 implementation')
>   }
>
>   async getOrders(_opts?: PaginationOpts): Promise<Order[]> {
>     throw new HarnessError('amazon', 'not_implemented', 'Day4 implementation')
>   }
>
>   async replyToMessage(_threadId: string, _body: string): Promise<void> {
>     throw new HarnessError('amazon', 'not_implemented', 'Day5 implementation')
>   }
>
>   async getOpenThreads(): Promise<Thread[]> {
>     return []
>   }
>
>   async getAnalytics(_range: DateRange): Promise<Analytics> {
>     return { revenue: 0, orders: 0, truncated: true }
>   }
> }
> ```
>
> **测试文件：** `packages/harness/src/amazon.harness.test.ts`（Day3 先写 token 相关子集）
>
> **测试用例名字（Day3 先实现这些）：**
> - `ensureAccessToken fetches token when cache is empty`
> - `ensureAccessToken reuses cached token before expiry`
> - `ensureAccessToken refreshes token after expiry`
> - `ensureAccessToken throws HarnessError on non-2xx response`
>
> **产出：** AmazonHarness 骨架文件落地，Day4 可直接补方法实现

---

> **🃏 CARD-D3-06 · Day3 回归与验收门禁**
>
> **类型：** 验证  \
> **耗时：** 30 min  \
> **依赖：** CARD-D3-01 ~ D3-05
>
> **执行命令：**
>
> ```bash
> pnpm --filter @patioer/harness typecheck
> pnpm --filter @patioer/harness test
> pnpm typecheck
> pnpm test
> pnpm lint
> ```
>
> **Day3 验收清单：**
> - [ ] `ads.harness.ts` / `inventory.harness.ts` 已创建
> - [ ] 类型守卫测试通过
> - [ ] `types.ts` 中 Product 扩展字段生效
> - [ ] `index.ts` 已导出新接口
> - [ ] `amazon.types.ts` 已创建
> - [ ] `amazon.harness.ts` 骨架可编译
> - [ ] Day3 新增测试全部通过
>
> **产出：** Day3 可合并状态（接口 + 骨架 + 测试）

---

**Day 3 卡片执行顺序汇总：**

```
09:00  CARD-D3-01  ads.harness.ts 接口与守卫          (45min)
09:45  CARD-D3-02  inventory.harness.ts 接口与守卫    (30min)
10:15  CARD-D3-03  types.ts / index.ts 扩展导出       (20min)
10:40  CARD-D3-04  amazon.types.ts 类型定义           (20min)
11:10  CARD-D3-05  amazon.harness.ts 骨架 + token     (1.5h)
14:00  CARD-D3-06  回归验证与验收门禁                 (30min)
```

---

##### Day 4 — AmazonHarness 核心方法（可复制任务卡）

---

> **🃏 CARD-D4-01 · `amazonFetch` 通用请求层（重试 + query + header）**
>
> **类型：** 代码变更  \
> **耗时：** 60 min  \
> **目标文件：** `packages/harness/src/amazon.harness.ts`
>
> **函数签名模板（可直接复制）：**
>
> ```typescript
> const MAX_RETRIES = 3
> const BASE_DELAY_MS = 500
> const FETCH_TIMEOUT_MS = 15_000
>
> interface AmazonRequestInit extends RequestInit {
>   query?: Record<string, string | undefined>
> }
>
> async function sleep(ms: number): Promise<void> {
>   return new Promise((resolve) => setTimeout(resolve, ms))
> }
>
> private buildUrl(path: string, query?: Record<string, string | undefined>): string {
>   const url = new URL(path, this.baseUrl)
>   if (query) {
>     for (const [k, v] of Object.entries(query)) {
>       if (v !== undefined) url.searchParams.set(k, v)
>     }
>   }
>   return url.toString()
> }
>
> private async amazonFetch<T>(path: string, init?: AmazonRequestInit): Promise<T> {
>   const token = await this.ensureAccessToken()
>   const url = this.buildUrl(path, init?.query)
>
>   for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
>     const res = await fetch(url, {
>       ...init,
>       signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
>       headers: {
>         'Content-Type': 'application/json',
>         'x-amz-access-token': token,
>         ...(init?.headers as Record<string, string> | undefined),
>       },
>     })
>
>     if (res.ok) return (await res.json()) as T
>
>     const retryable = res.status === 429 || res.status >= 500
>     if (retryable && attempt < MAX_RETRIES) {
>       await sleep(BASE_DELAY_MS * 2 ** attempt)
>       continue
>     }
>
>     throw new HarnessError('amazon', String(res.status), `Amazon API error ${res.status}`)
>   }
>
>   throw new HarnessError('amazon', 'max_retries', 'Amazon API max retries exceeded')
> }
> ```
>
> **测试文件：** `packages/harness/src/amazon.harness.test.ts`
>
> **测试用例名字（逐条实现）：**
> - `amazonFetch appends query parameters and sends x-amz-access-token header`
> - `amazonFetch retries on 429 and succeeds on later attempt`
> - `amazonFetch throws HarnessError after max retries`
>
> **产出：** Amazon 通用请求入口可复用到 Catalog / Listings / Orders

---

> **🃏 CARD-D4-02 · `getProductsPage/getProducts`（Catalog Items API）**
>
> **类型：** 代码变更  \
> **耗时：** 90 min  \
> **目标文件：** `packages/harness/src/amazon.harness.ts`
>
> **函数签名模板（可直接复制）：**
>
> ```typescript
> import type { AmazonCatalogItemSummary } from './amazon.types.js'
>
> interface AmazonCatalogSearchResponse {
>   items?: AmazonCatalogItemSummary[]
>   pagination?: { nextToken?: string }
> }
>
> function normalizeAmazonProduct(
>   item: AmazonCatalogItemSummary,
>   marketplaceId: string,
> ): Product {
>   return {
>     id: item.asin,
>     title: item.title ?? item.asin,
>     price: 0,
>     inventory: 0,
>     sku: item.sku,
>     currency: marketplaceId.startsWith('A1') ? 'USD' : 'UNKNOWN',
>     platformMeta: { asin: item.asin, source: 'catalog-items' },
>   }
> }
>
> async getProductsPage(opts?: PaginationOpts): Promise<PaginatedResult<Product>> {
>   const data = await this.amazonFetch<AmazonCatalogSearchResponse>(
>     '/catalog/2022-04-01/items',
>     {
>       query: {
>         marketplaceIds: this.credentials.marketplaceId,
>         sellerId: this.credentials.sellerId,
>         pageSize: String(opts?.limit ?? 20),
>         pageToken: opts?.cursor,
>       },
>     },
>   )
>
>   const items = (data.items ?? []).map((item) =>
>     normalizeAmazonProduct(item, this.credentials.marketplaceId),
>   )
>   return { items, nextCursor: data.pagination?.nextToken }
> }
>
> async getProducts(opts?: PaginationOpts): Promise<Product[]> {
>   const page = await this.getProductsPage(opts)
>   return page.items
> }
> ```
>
> **测试文件：** `packages/harness/src/amazon.harness.test.ts`
>
> **测试用例名字（逐条实现）：**
> - `getProductsPage maps catalog items into Product domain model`
> - `getProductsPage returns empty items when Amazon response has no items`
> - `getProducts returns page items from getProductsPage`
> - `getProductsPage returns nextCursor from pagination token`
>
> **产出：** Amazon 商品读取路径（分页 + 标准化）完成

---

> **🃏 CARD-D4-03 · `updatePrice`（Listings Items PATCH）**
>
> **类型：** 代码变更  \
> **耗时：** 45 min  \
> **目标文件：** `packages/harness/src/amazon.harness.ts`
>
> **函数签名模板（可直接复制）：**
>
> ```typescript
> private buildPricePatch(price: number): Array<{ op: 'replace'; path: string; value: unknown[] }> {
>   return [
>     {
>       op: 'replace',
>       path: '/attributes/purchasable_offer',
>       value: [
>         {
>           marketplace_id: this.credentials.marketplaceId,
>           currency: 'USD',
>           our_price: [{ schedule: [{ value_with_tax: price.toFixed(2) }] }],
>         },
>       ],
>     },
>   ]
> }
>
> async updatePrice(productId: string, price: number): Promise<void> {
>   await this.amazonFetch(
>     `/listings/2021-08-01/items/${this.credentials.sellerId}/${productId}`,
>     {
>       method: 'PATCH',
>       body: JSON.stringify({
>         productType: 'PRODUCT',
>         patches: this.buildPricePatch(price),
>       }),
>       query: { marketplaceIds: this.credentials.marketplaceId },
>     },
>   )
> }
> ```
>
> **测试文件：** `packages/harness/src/amazon.harness.test.ts`
>
> **测试用例名字（逐条实现）：**
> - `updatePrice sends PATCH request with purchasable_offer payload`
> - `updatePrice formats value_with_tax to two decimals`
> - `updatePrice throws HarnessError when listings API fails`
>
> **产出：** Amazon 价格更新链路完成

---

> **🃏 CARD-D4-04 · `getOrdersPage/getOrders`（Orders API）**
>
> **类型：** 代码变更  \
> **耗时：** 75 min  \
> **目标文件：** `packages/harness/src/amazon.harness.ts`
>
> **函数签名模板（可直接复制）：**
>
> ```typescript
> interface AmazonOrder {
>   AmazonOrderId: string
>   OrderStatus: string
>   OrderTotal?: { Amount: string }
> }
>
> interface AmazonOrdersResponse {
>   payload?: { Orders?: AmazonOrder[]; NextToken?: string }
> }
>
> function normalizeAmazonOrder(order: AmazonOrder): Order {
>   return {
>     id: order.AmazonOrderId,
>     status: order.OrderStatus,
>     totalPrice: Number(order.OrderTotal?.Amount ?? 0),
>   }
> }
>
> async getOrdersPage(opts?: PaginationOpts): Promise<PaginatedResult<Order>> {
>   // Amazon Orders API 限流较低：后续 Day6 接入队列限流
>   const data = await this.amazonFetch<AmazonOrdersResponse>('/orders/v0/orders', {
>     query: {
>       MarketplaceIds: this.credentials.marketplaceId,
>       CreatedAfter: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
>       MaxResultsPerPage: String(opts?.limit ?? 50),
>       NextToken: opts?.cursor,
>     },
>   })
>
>   const items = (data.payload?.Orders ?? []).map(normalizeAmazonOrder)
>   return { items, nextCursor: data.payload?.NextToken }
> }
>
> async getOrders(opts?: PaginationOpts): Promise<Order[]> {
>   const page = await this.getOrdersPage(opts)
>   return page.items
> }
> ```
>
> **测试文件：** `packages/harness/src/amazon.harness.test.ts`
>
> **测试用例名字（逐条实现）：**
> - `getOrdersPage maps Amazon Orders payload to Order domain model`
> - `getOrdersPage returns nextCursor from payload NextToken`
> - `getOrders returns items from getOrdersPage`
> - `getOrdersPage returns empty array when payload Orders missing`
>
> **产出：** Amazon 订单读取链路完成

---

> **🃏 CARD-D4-05 · `updateInventory`（Listings Items PATCH）**
>
> **类型：** 代码变更  \
> **耗时：** 45 min  \
> **目标文件：** `packages/harness/src/amazon.harness.ts`
>
> **函数签名模板（可直接复制）：**
>
> ```typescript
> private buildInventoryPatch(qty: number): Array<{ op: 'replace'; path: string; value: unknown[] }> {
>   return [
>     {
>       op: 'replace',
>       path: '/attributes/fulfillment_availability',
>       value: [{ fulfillment_channel_code: 'DEFAULT', quantity: qty }],
>     },
>   ]
> }
>
> async updateInventory(productId: string, qty: number): Promise<void> {
>   await this.amazonFetch(
>     `/listings/2021-08-01/items/${this.credentials.sellerId}/${productId}`,
>     {
>       method: 'PATCH',
>       body: JSON.stringify({
>         productType: 'PRODUCT',
>         patches: this.buildInventoryPatch(qty),
>       }),
>       query: { marketplaceIds: this.credentials.marketplaceId },
>     },
>   )
> }
> ```
>
> **测试文件：** `packages/harness/src/amazon.harness.test.ts`
>
> **测试用例名字（逐条实现）：**
> - `updateInventory sends PATCH request with fulfillment_availability payload`
> - `updateInventory includes DEFAULT fulfillment_channel_code`
> - `updateInventory throws HarnessError when listings API fails`
>
> **产出：** Amazon 库存更新链路完成

---

> **🃏 CARD-D4-06 · Day4 回归与验收门禁**
>
> **类型：** 验证  \
> **耗时：** 30 min  \
> **依赖：** CARD-D4-01 ~ D4-05
>
> **执行命令：**
>
> ```bash
> pnpm --filter @patioer/harness typecheck
> pnpm --filter @patioer/harness test
> pnpm typecheck
> pnpm lint
> pnpm test
> ```
>
> **Day4 验收清单：**
> - [ ] `amazonFetch` 已支持 query 拼接、token header、429/5xx 重试
> - [ ] `getProductsPage/getProducts` 已完成并返回标准 `Product`
> - [ ] `updatePrice` PATCH payload 正确
> - [ ] `getOrdersPage/getOrders` 已完成并返回标准 `Order`
> - [ ] `updateInventory` PATCH payload 正确
> - [ ] Day4 新增测试全部通过
> - [ ] 全仓 `typecheck/lint/test` 全绿
>
> **产出：** Day4 可合并状态（AmazonHarness 核心方法 + 测试）

---

**Day 4 卡片执行顺序汇总：**

```
09:00  CARD-D4-01  amazonFetch 通用请求层                (60min)
10:10  CARD-D4-02  getProductsPage/getProducts            (90min)
13:30  CARD-D4-03  updatePrice PATCH                      (45min)
14:20  CARD-D4-04  getOrdersPage/getOrders                (75min)
15:45  CARD-D4-05  updateInventory PATCH                  (45min)
16:40  CARD-D4-06  回归验证与验收门禁                     (30min)
```

---

##### Day 5 — AmazonHarness 剩余方法 + 导出 + 单元测试（可复制任务卡）

---

> **🃏 CARD-D5-01 · `getAnalytics` 实现（MVP 聚合策略）**
>
> **类型：** 代码变更  \
> **耗时：** 45 min  \
> **目标文件：** `packages/harness/src/amazon.harness.ts`
>
> **函数签名模板（可直接复制）：**
>
> ```typescript
> async getAnalytics(range: DateRange): Promise<Analytics> {
>   // MVP：复用 getOrders 聚合，避免 Day5 引入 Reports API 异步链路复杂度
>   const orders = await this.getOrders({ limit: 100 })
>   const from = range.from.getTime()
>   const to = range.to.getTime()
>
>   // Day5 暂以 getOrders 返回集作为窗口；Phase 3 再对接 Reports API 精准窗口过滤
>   const filtered = orders.filter(() => true)
>   const revenue = filtered.reduce((sum, order) => sum + order.totalPrice, 0)
>
>   return {
>     revenue,
>     orders: filtered.length,
>     truncated: orders.length >= 100,
>   }
> }
> ```
>
> **测试文件：** `packages/harness/src/amazon.harness.test.ts`
>
> **测试用例名字（逐条实现）：**
> - `getAnalytics aggregates revenue and order count from getOrders`
> - `getAnalytics returns zero when getOrders returns empty list`
> - `getAnalytics sets truncated=true when order count reaches limit`
>
> **产出：** Amazon 分析能力在 MVP 阶段可用

---

> **🃏 CARD-D5-02 · `replyToMessage` / `getOpenThreads` 实现**
>
> **类型：** 代码变更  \
> **耗时：** 60 min  \
> **目标文件：** `packages/harness/src/amazon.harness.ts`
>
> **函数签名模板（可直接复制）：**
>
> ```typescript
> interface AmazonMessagePayload {
>   text: string
> }
>
> async replyToMessage(threadId: string, body: string): Promise<void> {
>   await this.amazonFetch(
>     `/messaging/v1/orders/${threadId}/messages/confirmCustomizationDetails`,
>     {
>       method: 'POST',
>       body: JSON.stringify({ text: body } satisfies AmazonMessagePayload),
>     },
>   )
> }
>
> async getOpenThreads(): Promise<Thread[]> {
>   // Amazon 当前无统一“open threads”列表接口
>   // Sprint 1 返回空数组；后续在 Messaging/SNS 路由中补齐会话聚合
>   return []
> }
> ```
>
> **测试文件：** `packages/harness/src/amazon.harness.test.ts`
>
> **测试用例名字（逐条实现）：**
> - `replyToMessage sends POST request to messaging endpoint with text payload`
> - `replyToMessage throws HarnessError when messaging API responds non-2xx`
> - `getOpenThreads returns empty array in MVP mode`
>
> **产出：** Amazon 消息能力具备可调用实现（含 MVP 降级）

---

> **🃏 CARD-D5-03 · `index.ts` 与类型导出对齐**
>
> **类型：** 代码变更  \
> **耗时：** 20 min  \
> **目标文件：** `packages/harness/src/index.ts`、`packages/harness/src/amazon.types.ts`
>
> **函数/导出模板（可直接复制）：**
>
> ```typescript
> // packages/harness/src/index.ts
> export * from './amazon.types.js'
> export * from './amazon.harness.js'
> ```
>
> ```typescript
> // packages/harness/src/amazon.types.ts（按需要补充）
> export interface AmazonMessageResult {
>   messageId?: string
>   status?: string
> }
> ```
>
> **测试文件：** `packages/harness/src/amazon.harness.test.ts`（可复用）
>
> **测试用例名字（可新增）：**
> - `package index exports AmazonHarness constructor`
> - `package index exports AmazonCredentials type`
>
> **产出：** `@patioer/harness` 对外 Amazon API 一致可导入

---

> **🃏 CARD-D5-04 · 扩展 `amazon.harness.test.ts`（剩余行为）**
>
> **类型：** 测试实现  \
> **耗时：** 90 min  \
> **目标文件：** `packages/harness/src/amazon.harness.test.ts`
>
> **测试结构模板（可直接复制）：**
>
> ```typescript
> describe('AmazonHarness getAnalytics', () => {
>   it('getAnalytics aggregates revenue and order count from getOrders', async () => {
>     // TODO
>   })
> })
>
> describe('AmazonHarness messaging', () => {
>   it('replyToMessage sends POST request to messaging endpoint with text payload', async () => {
>     // TODO
>   })
>
>   it('getOpenThreads returns empty array in MVP mode', async () => {
>     // TODO
>   })
> })
> ```
>
> **测试用例名字（逐条实现）：**
> - `getAnalytics aggregates revenue and order count from getOrders`
> - `getAnalytics returns zero when getOrders returns empty list`
> - `getAnalytics sets truncated=true when order count reaches limit`
> - `replyToMessage sends POST request to messaging endpoint with text payload`
> - `replyToMessage throws HarnessError when messaging API responds non-2xx`
> - `getOpenThreads returns empty array in MVP mode`
>
> **产出：** Day5 新增行为具备稳定单测覆盖

---

> **🃏 CARD-D5-05 · AmazonHarness 回归补测（Day4+Day5 合并）**
>
> **类型：** 测试整理  \
> **耗时：** 45 min  \
> **目标文件：** `packages/harness/src/amazon.harness.test.ts`
>
> **补测建议模板（可直接复制）：**
>
> ```typescript
> describe('AmazonHarness regression', () => {
>   it('core methods keep working after Day5 additions', async () => {
>     // 复用 Day4 mock：getProducts / updatePrice / getOrders / updateInventory
>   })
> })
> ```
>
> **测试用例名字（逐条实现）：**
> - `core methods keep working after Day5 additions`
> - `token refresh flow still works with analytics and messaging calls`
>
> **产出：** Day5 新增改动不破坏 Day4 核心链路

---

> **🃏 CARD-D5-06 · Day5 回归与验收门禁**
>
> **类型：** 验证  \
> **耗时：** 30 min  \
> **依赖：** CARD-D5-01 ~ D5-05
>
> **执行命令：**
>
> ```bash
> pnpm --filter @patioer/harness typecheck
> pnpm --filter @patioer/harness test
> pnpm typecheck
> pnpm lint
> pnpm test
> ```
>
> **Day5 验收清单：**
> - [ ] `getAnalytics` 已实现并可返回聚合结果
> - [ ] `replyToMessage` 已接通 Messaging endpoint
> - [ ] `getOpenThreads` 已提供 MVP 返回策略
> - [ ] `index.ts` Amazon 导出对齐
> - [ ] Day5 新增测试全部通过
> - [ ] 全仓 `typecheck/lint/test` 全绿
>
> **产出：** Day5 可合并状态（剩余方法 + 导出 + 测试）

---

**Day 5 卡片执行顺序汇总：**

```
09:00  CARD-D5-01  getAnalytics 实现                      (45min)
09:50  CARD-D5-02  replyToMessage/getOpenThreads          (60min)
11:00  CARD-D5-03  index.ts 与类型导出对齐               (20min)
13:30  CARD-D5-04  amazon.harness.test.ts 行为扩展        (90min)
15:10  CARD-D5-05  Day4+Day5 回归补测                     (45min)
16:10  CARD-D5-06  回归验证与验收门禁                     (30min)
```

---

##### Day 6 — Amazon 限流队列 + HarnessRegistry 多平台（可复制任务卡）

---

> **🃏 CARD-D6-01 · `amazon.harness.ts` — TokenBucket per-API-family 限流**
>
> **类型：** 代码变更  \
> **耗时：** 60 min  \
> **目标文件：** `packages/harness/src/amazon.harness.ts`
>
> **函数签名模板（可直接复制）：**
>
> ```typescript
> // ── 放在文件顶部常量区 ──────────────────────────────────────────
> const AMAZON_API_FAMILIES: Record<string, { capacity: number; refillRate: number }> = {
>   '/catalog/':   { capacity: 2, refillRate: 2 },
>   '/listings/':  { capacity: 5, refillRate: 5 },
>   '/orders/':    { capacity: 1, refillRate: 0.5 },   // Amazon Orders: 0.5 req/s
>   '/reports/':   { capacity: 1, refillRate: 0.5 },
>   '/messaging/': { capacity: 1, refillRate: 1 },
> }
> const AMAZON_DEFAULT_FAMILY = { capacity: 2, refillRate: 2 }
>
> // ── TokenBucket（与 ShopifyHarness 相同实现，Day6 inline，Phase 3 提取公共） ──
> class TokenBucket {
>   private tokens: number
>   private lastRefillMs: number
>
>   constructor(
>     private readonly capacity: number,
>     private readonly refillRatePerSecond: number,
>   ) {
>     this.tokens = capacity
>     this.lastRefillMs = Date.now()
>   }
>
>   async acquire(): Promise<void> {
>     while (true) {
>       const now = Date.now()
>       const elapsed = (now - this.lastRefillMs) / 1000
>       this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRatePerSecond)
>       this.lastRefillMs = now
>       if (this.tokens >= 1) {
>         this.tokens -= 1
>         return
>       }
>       const waitMs = Math.ceil(((1 - this.tokens) / this.refillRatePerSecond) * 1000)
>       await new Promise<void>((resolve) => setTimeout(resolve, waitMs))
>     }
>   }
> }
>
> // ── 在 AmazonHarness class 内 ──────────────────────────────────
> private readonly apiBuckets = new Map<string, TokenBucket>()
>
> private getApiBucket(path: string): TokenBucket {
>   const family =
>     Object.keys(AMAZON_API_FAMILIES).find((prefix) => path.includes(prefix)) ?? '/default/'
>   const config = AMAZON_API_FAMILIES[family] ?? AMAZON_DEFAULT_FAMILY
>
>   let bucket = this.apiBuckets.get(family)
>   if (!bucket) {
>     bucket = new TokenBucket(config.capacity, config.refillRate)
>     this.apiBuckets.set(family, bucket)
>   }
>   return bucket
> }
> ```
>
> **`amazonFetch` 集成点（在 retry 循环内首行调用）：**
>
> ```typescript
> // amazonFetch 循环体第一行：
> await this.getApiBucket(path).acquire()
> ```
>
> **测试文件：** `packages/harness/src/amazon.harness.test.ts`
>
> **测试用例名字（逐条实现）：**
> - `getApiBucket returns different buckets for catalog and orders paths`
> - `getApiBucket reuses same bucket for same path family`
>
> **产出：** Amazon 各 API 族独立限流，Orders API 受 0.5 req/s 约束

---

> **🃏 CARD-D6-02 · `amazonFetch` — 429 header 感知退避 + 扩大重试次数**
>
> **类型：** 代码变更  \
> **耗时：** 45 min  \
> **目标文件：** `packages/harness/src/amazon.harness.ts`
>
> **函数签名模板（可直接复制）：**
>
> ```typescript
> // 将顶部常量改为：
> const MAX_RETRIES = 5   // Amazon SP-API 允许更多次重试
>
> // amazonFetch 内 429 处理逻辑替换为：
> if (response.status === 429) {
>   const limitHeader = response.headers.get('x-amzn-RateLimit-Limit')
>   const rateLimit = limitHeader !== null ? Number(limitHeader) : 0
>   // header 给出的是允许 req/s，换算成最小间隔 ms
>   const headerDelayMs = rateLimit > 0 ? Math.ceil(1000 / rateLimit) : 0
>   const backoffDelayMs = BASE_DELAY_MS * 2 ** attempt
>   await sleep(Math.max(headerDelayMs, backoffDelayMs))
>   continue
> }
>
> // 5xx 仍用指数退避
> if (response.status >= 500) {
>   await sleep(BASE_DELAY_MS * 2 ** attempt)
>   continue
> }
> ```
>
> **测试文件：** `packages/harness/src/amazon.harness.test.ts`
>
> **测试用例名字（逐条实现）：**
> - `amazonFetch uses x-amzn-RateLimit-Limit header delay on 429`
> - `amazonFetch retries up to 5 times on 5xx before throwing`
>
> **产出：** 429 退避可感知 Amazon 官方限速；重试上限与 Amazon 策略对齐

---

> **🃏 CARD-D6-03 · 限流行为测试（`amazon.harness.test.ts`）**
>
> **类型：** 测试实现  \
> **耗时：** 60 min  \
> **目标文件：** `packages/harness/src/amazon.harness.test.ts`
>
> **测试结构模板（可直接复制）：**
>
> ```typescript
> describe('AmazonHarness rate limiting', () => {
>   it('getApiBucket returns different buckets for catalog and orders paths', () => {
>     // TODO: 通过 bracket access 拿到 getApiBucket，验证路径映射
>   })
>
>   it('getApiBucket reuses same bucket for same path family', () => {
>     // TODO
>   })
>
>   it('amazonFetch uses x-amzn-RateLimit-Limit header delay on 429', async () => {
>     // vi.useFakeTimers()
>     // mock: token fetch → 429 (header: x-amzn-RateLimit-Limit: 0.5) → success
>     // assert: sleep 被调用，延迟 ≥ 2000ms (1000/0.5)
>   })
>
>   it('amazonFetch retries up to 5 times on 5xx before throwing', async () => {
>     // vi.useFakeTimers()
>     // mock: token fetch + 6× 500 → 共 7 次 fetch 调用
>     // assert: rejects with code='500', mockFetch called 7 times (1 token + 6 api)
>   })
> })
> ```
>
> **测试用例名字（逐条实现）：**
> - `getApiBucket returns different buckets for catalog and orders paths`
> - `getApiBucket reuses same bucket for same path family`
> - `amazonFetch uses x-amzn-RateLimit-Limit header delay on 429`
> - `amazonFetch retries up to 5 times on 5xx before throwing`
>
> **产出：** 限流与退避行为具备稳定单测覆盖

---

> **🃏 CARD-D6-04 · `harness-factory.ts` — 多平台 Harness 工厂**
>
> **类型：** 新建文件  \
> **耗时：** 60 min  \
> **目标文件：** `apps/api/src/lib/harness-factory.ts`
>
> **函数签名模板（可直接复制）：**
>
> ```typescript
> import { AmazonHarness, ShopifyHarness, type TenantHarness } from '@patioer/harness'
> import { decryptToken } from './crypto.js'
>
> export interface HarnessCredentialInput {
>   accessToken: string
>   shopDomain?: string | null
>   region?: string | null
>   metadata?: Record<string, unknown> | null
> }
>
> export function createHarness(
>   tenantId: string,
>   platform: string,
>   credential: HarnessCredentialInput,
> ): TenantHarness {
>   const encKey = process.env.CRED_ENCRYPTION_KEY
>   if (!encKey) {
>     throw new Error('CRED_ENCRYPTION_KEY not configured')
>   }
>   const token = decryptToken(credential.accessToken, encKey)
>
>   switch (platform) {
>     case 'shopify': {
>       if (!credential.shopDomain) {
>         throw new Error('shopDomain is required for Shopify harness')
>       }
>       return new ShopifyHarness(tenantId, credential.shopDomain, token)
>     }
>     case 'amazon': {
>       const meta = credential.metadata as {
>         clientId: string
>         clientSecret: string
>         sellerId: string
>         marketplaceId: string
>       } | null
>
>       if (!meta?.clientId || !meta?.sellerId || !meta?.marketplaceId) {
>         throw new Error('Amazon metadata (clientId, sellerId, marketplaceId) is required')
>       }
>
>       const region = ((credential.region ?? 'na') as string).toLowerCase() as 'na' | 'eu' | 'fe'
>       return new AmazonHarness(tenantId, {
>         clientId: meta.clientId,
>         clientSecret: meta.clientSecret ?? '',
>         refreshToken: token,
>         region,
>         sellerId: meta.sellerId,
>         marketplaceId: meta.marketplaceId,
>       })
>     }
>     default:
>       throw new Error(`Unsupported platform: ${platform}`)
>   }
> }
> ```
>
> **测试文件：** `apps/api/src/lib/harness-factory.test.ts`
>
> **测试用例名字（逐条实现）：**
> - `createHarness throws when CRED_ENCRYPTION_KEY is missing`
> - `createHarness creates ShopifyHarness with decrypted token`
> - `createHarness throws when shopDomain is missing for shopify`
> - `createHarness creates AmazonHarness with decrypted token and metadata`
> - `createHarness throws when amazon metadata is missing`
> - `createHarness throws for unsupported platform`
>
> **产出：** 统一工厂支持 Shopify + Amazon，可供 routes 直接复用

---

> **🃏 CARD-D6-05 · `harness-factory.test.ts` — 工厂单元测试**
>
> **类型：** 新建文件  \
> **耗时：** 60 min  \
> **目标文件：** `apps/api/src/lib/harness-factory.test.ts`
>
> **测试结构模板（可直接复制）：**
>
> ```typescript
> import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
> import { createHarness } from './harness-factory.js'
> import { ShopifyHarness, AmazonHarness } from '@patioer/harness'
>
> // mock crypto 模块，避免真实 AES 加解密
> vi.mock('./crypto.js', () => ({
>   decryptToken: (_cipher: string, _key: string) => 'decrypted-token',
> }))
>
> beforeEach(() => {
>   process.env.CRED_ENCRYPTION_KEY = 'a'.repeat(64)   // 32 bytes hex
> })
>
> afterEach(() => {
>   delete process.env.CRED_ENCRYPTION_KEY
> })
>
> describe('createHarness', () => {
>   it('createHarness throws when CRED_ENCRYPTION_KEY is missing', () => {
>     delete process.env.CRED_ENCRYPTION_KEY
>     expect(() => createHarness('t1', 'shopify', {
>       accessToken: 'enc', shopDomain: 'shop.myshopify.com',
>     })).toThrow('CRED_ENCRYPTION_KEY not configured')
>   })
>
>   it('createHarness creates ShopifyHarness with decrypted token', () => {
>     const harness = createHarness('t1', 'shopify', {
>       accessToken: 'enc', shopDomain: 'shop.myshopify.com',
>     })
>     expect(harness).toBeInstanceOf(ShopifyHarness)
>     expect(harness.tenantId).toBe('t1')
>     expect(harness.platformId).toBe('shopify')
>   })
>
>   it('createHarness throws when shopDomain is missing for shopify', () => {
>     expect(() => createHarness('t1', 'shopify', { accessToken: 'enc' }))
>       .toThrow('shopDomain is required')
>   })
>
>   it('createHarness creates AmazonHarness with decrypted token and metadata', () => {
>     const harness = createHarness('t1', 'amazon', {
>       accessToken: 'enc',
>       region: 'na',
>       metadata: {
>         clientId: 'cid', clientSecret: 'csec',
>         sellerId: 'sid', marketplaceId: 'mid',
>       },
>     })
>     expect(harness).toBeInstanceOf(AmazonHarness)
>     expect(harness.platformId).toBe('amazon')
>   })
>
>   it('createHarness throws when amazon metadata is missing', () => {
>     expect(() => createHarness('t1', 'amazon', { accessToken: 'enc' }))
>       .toThrow('Amazon metadata')
>   })
>
>   it('createHarness throws for unsupported platform', () => {
>     expect(() => createHarness('t1', 'tiktok', {
>       accessToken: 'enc', shopDomain: null,
>     })).toThrow('Unsupported platform: tiktok')
>   })
> })
> ```
>
> **产出：** 工厂行为 6 个分支均有覆盖，crypto 通过 mock 隔离

---

> **🃏 CARD-D6-06 · Day6 回归与验收门禁**
>
> **类型：** 验证  \
> **耗时：** 30 min  \
> **依赖：** CARD-D6-01 ~ D6-05
>
> **执行命令：**
>
> ```bash
> pnpm --filter @patioer/harness typecheck
> pnpm --filter @patioer/harness test
> pnpm --filter @patioer/api typecheck
> pnpm --filter @patioer/api test
> pnpm typecheck
> pnpm lint
> pnpm test
> ```
>
> **Day6 验收清单：**
> - [ ] `amazon.harness.ts` 已集成 `TokenBucket`，各 API 族限流独立
> - [ ] `amazonFetch` 读取 `x-amzn-RateLimit-Limit` header 并用于退避
> - [ ] `MAX_RETRIES` 已扩大到 5
> - [ ] 限流行为 4 个测试通过
> - [ ] `harness-factory.ts` 支持 Shopify + Amazon 两条创建路径
> - [ ] `harness-factory.test.ts` 6 个用例全部通过
> - [ ] 全仓 `typecheck/lint/test` 全绿
>
> **产出：** Day6 可合并状态（限流 + 工厂 + 测试）

---

**Day 6 卡片执行顺序汇总：**

```
09:00  CARD-D6-01  TokenBucket per-API-family 集成          (60min)
10:10  CARD-D6-02  429 header 感知退避 + MAX_RETRIES=5      (45min)
11:00  CARD-D6-03  限流行为测试                              (60min)
13:30  CARD-D6-04  harness-factory.ts 工厂实现               (60min)
14:40  CARD-D6-05  harness-factory.test.ts 工厂测试          (60min)
15:50  CARD-D6-06  回归验证与验收门禁                        (30min)
```

---

##### Day 7 — Amazon OAuth Flow（可复制任务卡）

---

> **🃏 CARD-D7-01 · `amazon/oauth.ts` — LWA OAuth 路由（auth + callback）**
>
> **类型：** 新建文件  \
> **耗时：** 90 min  \
> **目标文件：** `apps/api/src/routes/amazon/oauth.ts`
>
> **函数签名模板（可直接复制）：**
>
> ```typescript
> import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
> import type { FastifyPluginAsync } from 'fastify'
> import { withTenantDb, schema } from '@patioer/db'
> import { encryptToken } from '../../lib/crypto.js'
> import { registry } from '../../lib/harness-registry.js'
>
> const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token'
> // Seller Central authorization endpoint
> const LWA_AUTH_BASE = 'https://sellercentral.amazon.com/apps/authorize/consent'
>
> interface LwaTokenResponse {
>   access_token: string
>   refresh_token: string
>   token_type: string
>   expires_in: number
> }
>
> interface AmazonStatePayload {
>   tenantId: string
>   sellerId: string
>   marketplaceId: string
>   nonce: string
>   iat: number
> }
>
> // CSRF state helpers — same sign/verify pattern as shopify/oauth.ts
> function signAmazonState(payload: Omit<AmazonStatePayload, 'nonce' | 'iat'>, secret: string): string {
>   const full: AmazonStatePayload = {
>     ...payload,
>     nonce: randomBytes(8).toString('hex'),
>     iat: Date.now(),
>   }
>   const encoded = Buffer.from(JSON.stringify(full)).toString('base64url')
>   const hmac = createHmac('sha256', secret).update(encoded).digest('hex')
>   return `${encoded}.${hmac}`
> }
>
> function verifyAmazonState(state: string, secret: string): AmazonStatePayload | null {
>   const dot = state.lastIndexOf('.')
>   if (dot === -1) return null
>   const payload = state.slice(0, dot)
>   const hmac = state.slice(dot + 1)
>   const expected = createHmac('sha256', secret).update(payload).digest('hex')
>   const hmacBuf = Buffer.from(hmac, 'hex')
>   const expectedBuf = Buffer.from(expected, 'hex')
>   if (hmacBuf.length !== expectedBuf.length || !timingSafeEqual(hmacBuf, expectedBuf)) return null
>   try {
>     return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AmazonStatePayload
>   } catch {
>     return null
>   }
> }
>
> // GET /api/v1/amazon/auth?tenantId=&sellerId=&marketplaceId=
> // GET /api/v1/amazon/auth/callback?code=&state=&selling_partner_id=
> const amazonOAuthRoute: FastifyPluginAsync = async (app) => {
>   app.get('/api/v1/amazon/auth', async (request, reply) => {
>     // TODO: build LWA auth URL, redirect
>   })
>
>   app.get('/api/v1/amazon/auth/callback', async (request, reply) => {
>     // TODO: verify state, exchange code → tokens, encrypt + persist refresh_token
>   })
> }
>
> export default amazonOAuthRoute
> ```
>
> **关键实现要点：**
>
> - `GET /auth`：从 query 读取 `tenantId/sellerId/marketplaceId`；校验非空；用 `signAmazonState()` 生成 CSRF state；重定向到 `LWA_AUTH_BASE?application_id=...&state=...&version=beta`
> - `GET /auth/callback`：用 `verifyAmazonState()` 解析 state；POST `LWA_TOKEN_URL` 换取 `refresh_token`；用 `encryptToken` 加密；写入 `platform_credentials`（platform=`'amazon'`, credentialType=`'lwa'`, region 取 query 或默认 `'na'`, metadata 存 `sellerId/marketplaceId/clientId`）；`registry.invalidate(...)` 清缓存；`reply.send({ ok: true })`
> - 环境变量：`AMAZON_CLIENT_ID`、`AMAZON_CLIENT_SECRET`、`APP_BASE_URL`、`CRED_ENCRYPTION_KEY`
>
> **测试文件：** `apps/api/src/routes/amazon/oauth.test.ts`
>
> **测试用例名字（逐条实现）：**
> - `GET /api/v1/amazon/auth returns 400 when tenantId is missing`
> - `GET /api/v1/amazon/auth returns 400 when sellerId is missing`
> - `GET /api/v1/amazon/auth returns 503 when env vars not configured`
> - `GET /api/v1/amazon/auth redirects to LWA authorization URL with state`
> - `GET /api/v1/amazon/auth/callback returns 400 when state is invalid`
> - `GET /api/v1/amazon/auth/callback returns 400 when code is missing`
> - `GET /api/v1/amazon/auth/callback returns 502 when LWA token exchange fails`
> - `GET /api/v1/amazon/auth/callback persists encrypted refresh_token and invalidates registry`
>
> **产出：** Amazon LWA OAuth 完整流程可用

---

> **🃏 CARD-D7-02 · `amazon/oauth.test.ts` — LWA OAuth 路由单元测试**
>
> **类型：** 新建文件  \
> **耗时：** 75 min  \
> **目标文件：** `apps/api/src/routes/amazon/oauth.test.ts`
>
> **测试结构模板（可直接复制）：**
>
> ```typescript
> import { createHmac } from 'node:crypto'
> import Fastify from 'fastify'
> import { beforeEach, describe, expect, it, vi } from 'vitest'
>
> const { mockWithTenantDb, mockEncryptToken, mockInvalidateRegistry } = vi.hoisted(() => ({
>   mockWithTenantDb: vi.fn(),
>   mockEncryptToken: vi.fn(),
>   mockInvalidateRegistry: vi.fn(),
> }))
>
> vi.mock('@patioer/db', () => ({
>   withTenantDb: mockWithTenantDb,
>   schema: {
>     platformCredentials: {
>       tenantId: 'tenantId',
>       platform: 'platform',
>       region: 'region',
>     },
>   },
> }))
> vi.mock('../../lib/crypto.js', () => ({ encryptToken: mockEncryptToken }))
> vi.mock('../../lib/harness-registry.js', () => ({
>   registry: { invalidate: mockInvalidateRegistry },
> }))
>
> // mock global fetch for LWA token endpoint
> const mockFetch = vi.fn()
> vi.stubGlobal('fetch', mockFetch)
>
> import amazonOAuthRoute from './oauth.js'
>
> const CLIENT_ID = 'amzn-client-id'
> const CLIENT_SECRET = 'amzn-client-secret'
> const APP_BASE_URL = 'https://app.example.com'
> const ENC_KEY = 'a'.repeat(64)
>
> function createApp() {
>   const app = Fastify({ logger: false })
>   app.decorateRequest('tenantId', undefined)
>   app.register(amazonOAuthRoute)
>   return app
> }
>
> beforeEach(() => {
>   vi.clearAllMocks()
>   process.env.AMAZON_CLIENT_ID = CLIENT_ID
>   process.env.AMAZON_CLIENT_SECRET = CLIENT_SECRET
>   process.env.APP_BASE_URL = APP_BASE_URL
>   process.env.CRED_ENCRYPTION_KEY = ENC_KEY
>   mockEncryptToken.mockReturnValue('encrypted-refresh-token')
>   mockWithTenantDb.mockImplementation(async (_tid: string, fn: (db: unknown) => Promise<void>) => {
>     await fn({ insert: () => ({ values: () => ({ onConflictDoUpdate: () => Promise.resolve() }) }) })
>   })
> })
> ```
>
> **测试用例名字（逐条实现）：**
> - `GET /api/v1/amazon/auth returns 400 when tenantId is missing`
> - `GET /api/v1/amazon/auth returns 400 when sellerId is missing`
> - `GET /api/v1/amazon/auth returns 503 when env vars not configured`
> - `GET /api/v1/amazon/auth redirects to LWA authorization URL with state`
> - `GET /api/v1/amazon/auth/callback returns 400 when state is invalid`
> - `GET /api/v1/amazon/auth/callback returns 400 when code is missing`
> - `GET /api/v1/amazon/auth/callback returns 502 when LWA token exchange fails`
> - `GET /api/v1/amazon/auth/callback persists encrypted refresh_token and invalidates registry`
>
> **产出：** OAuth 路由 8 个关键行为均有测试覆盖

---

> **🃏 CARD-D7-03 · `amazon/webhook.ts` — SNS 通知骨架路由**
>
> **类型：** 新建文件  \
> **耗时：** 45 min  \
> **目标文件：** `apps/api/src/routes/amazon/webhook.ts`
>
> **函数签名模板（可直接复制）：**
>
> ```typescript
> import type { FastifyPluginAsync } from 'fastify'
> import { withTenantDb, schema } from '@patioer/db'
>
> // Amazon SP-API uses SNS/SQS for notifications, not traditional webhooks.
> // Sprint 1: accept + record the raw SNS message; Sprint 3 wires full SQS consumer.
>
> const amazonWebhookRoute: FastifyPluginAsync = async (app) => {
>   app.addContentTypeParser(
>     'application/json',
>     { parseAs: 'buffer' },
>     (_req, body, done) => done(null, body),
>   )
>
>   // POST /api/v1/webhooks/amazon
>   //   Body: Amazon SNS JSON notification (SubscriptionConfirmation | Notification)
>   app.post('/api/v1/webhooks/amazon', async (request, reply) => {
>     const rawBody = request.body as Buffer
>     let parsed: Record<string, unknown>
>     try {
>       parsed = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>
>     } catch {
>       return reply.code(400).send({ error: 'invalid JSON' })
>     }
>
>     const messageType = request.headers['x-amz-sns-message-type']
>
>     // Acknowledge SNS subscription confirmation without persisting
>     if (messageType === 'SubscriptionConfirmation') {
>       app.log.info({ subscribeUrl: parsed.SubscribeURL }, 'amazon sns subscription confirmation')
>       return reply.code(200).send({ ok: true })
>     }
>
>     const tenantId = request.headers['x-tenant-id']
>     if (typeof tenantId !== 'string' || !tenantId) {
>       return reply.code(401).send({ error: 'x-tenant-id required' })
>     }
>
>     try {
>       await withTenantDb(tenantId, async (db) => {
>         await db.insert(schema.webhookEvents).values({
>           tenantId,
>           platform: 'amazon',
>           topic: String(parsed.Subject ?? 'unknown'),
>           shopDomain: null,
>           payload: parsed,
>           idempotencyKey: String(parsed.MessageId ?? crypto.randomUUID()),
>         })
>       })
>     } catch (err) {
>       app.log.error({ err }, 'failed to persist amazon webhook event')
>       return reply.code(500).send({ error: 'internal error' })
>     }
>
>     return reply.code(200).send({ ok: true })
>   })
> }
>
> export default amazonWebhookRoute
> ```
>
> **测试文件：** `apps/api/src/routes/amazon/webhook.test.ts`
>
> **测试用例名字（逐条实现）：**
> - `POST /api/v1/webhooks/amazon returns 400 for invalid JSON`
> - `POST /api/v1/webhooks/amazon returns 200 for SubscriptionConfirmation without persisting`
> - `POST /api/v1/webhooks/amazon returns 401 when x-tenant-id is missing`
> - `POST /api/v1/webhooks/amazon persists notification to webhook_events`
> - `POST /api/v1/webhooks/amazon returns 500 when db insert fails`
>
> **产出：** Amazon SNS 通知骨架路由可运行，数据可审计

---

> **🃏 CARD-D7-04 · `amazon/webhook.test.ts` — Webhook 骨架测试**
>
> **类型：** 新建文件  \
> **耗时：** 45 min  \
> **目标文件：** `apps/api/src/routes/amazon/webhook.test.ts`
>
> **测试结构模板（可直接复制）：**
>
> ```typescript
> import Fastify from 'fastify'
> import { beforeEach, describe, expect, it, vi } from 'vitest'
>
> const { mockWithTenantDb } = vi.hoisted(() => ({
>   mockWithTenantDb: vi.fn(),
> }))
>
> vi.mock('@patioer/db', () => ({
>   withTenantDb: mockWithTenantDb,
>   schema: { webhookEvents: 'webhookEvents' },
> }))
>
> import amazonWebhookRoute from './webhook.js'
>
> function createApp() {
>   const app = Fastify({ logger: false })
>   app.register(amazonWebhookRoute)
>   return app
> }
>
> beforeEach(() => {
>   vi.clearAllMocks()
>   mockWithTenantDb.mockImplementation(
>     async (_tid: string, fn: (db: unknown) => Promise<void>) => {
>       await fn({ insert: () => ({ values: () => Promise.resolve() }) })
>     },
>   )
> })
> ```
>
> **测试用例名字（逐条实现）：**
> - `POST /api/v1/webhooks/amazon returns 400 for invalid JSON`
> - `POST /api/v1/webhooks/amazon returns 200 for SubscriptionConfirmation without persisting`
> - `POST /api/v1/webhooks/amazon returns 401 when x-tenant-id is missing`
> - `POST /api/v1/webhooks/amazon persists notification to webhook_events`
> - `POST /api/v1/webhooks/amazon returns 500 when db insert fails`
>
> **产出：** Webhook 骨架路由 5 个分支均有测试覆盖

---

> **🃏 CARD-D7-05 · `app.ts` — 注册 Amazon 路由**
>
> **类型：** 代码变更  \
> **耗时：** 15 min  \
> **目标文件：** `apps/api/src/app.ts`
>
> **变更模板（可直接复制）：**
>
> ```typescript
> // 在现有 shopify 路由导入后新增：
> import amazonOAuthRoute from './routes/amazon/oauth.js'
> import amazonWebhookRoute from './routes/amazon/webhook.js'
>
> // 在 buildServer 函数内，shopifyWebhookRoute 注册后新增：
> app.register(amazonOAuthRoute)
> app.register(amazonWebhookRoute)
> ```
>
> **测试文件：** `apps/api/src/app.test.ts`（现有集成测试）
>
> **测试用例名字（可新增 smoke test）：**
> - `GET /api/v1/amazon/auth responds (not 404)`
> - `POST /api/v1/webhooks/amazon responds (not 404)`
>
> **产出：** Amazon 路由纳入 app 路由树，GET /api/v1/amazon/auth 与 POST /api/v1/webhooks/amazon 可访问

---

> **🃏 CARD-D7-06 · Day7 回归与验收门禁**
>
> **类型：** 验证  \
> **耗时：** 30 min  \
> **依赖：** CARD-D7-01 ~ D7-05
>
> **执行命令：**
>
> ```bash
> pnpm --filter @patioer/api typecheck
> pnpm --filter @patioer/api lint
> pnpm --filter @patioer/api test
> pnpm typecheck
> pnpm lint
> pnpm test
> ```
>
> **Day7 验收清单：**
> - [ ] `amazon/oauth.ts` 已实现 auth + callback 两条路由
> - [ ] `amazon/webhook.ts` 已实现 SNS 骨架路由
> - [ ] `app.ts` 已注册两个 Amazon 路由
> - [ ] `oauth.test.ts` 8 个用例全部通过
> - [ ] `webhook.test.ts` 5 个用例全部通过
> - [ ] 全仓 `typecheck/lint/test` 全绿
>
> **产出：** Day7 可合并状态（OAuth + Webhook 骨架 + 测试 + 注册）

---

**Day 7 卡片执行顺序汇总：**

```
09:00  CARD-D7-01  amazon/oauth.ts 路由实现               (90min)
10:40  CARD-D7-02  amazon/oauth.test.ts                    (75min)
13:30  CARD-D7-03  amazon/webhook.ts 骨架路由              (45min)
14:20  CARD-D7-04  amazon/webhook.test.ts                  (45min)
15:15  CARD-D7-05  app.ts 路由注册                         (15min)
15:35  CARD-D7-06  回归验证与验收门禁                      (30min)
```

---

##### Day 8 — Sprint 1 收尾 + 回归测试 + Sprint Review（可复制任务卡）

---

> **🃏 CARD-D8-01 · `.env.example` — Amazon + CRED 环境变量补全**
>
> **类型：** 配置更新  \
> **耗时：** 10 min  \
> **目标文件：** `.env.example`
>
> **需新增的变量块（追加到 Shopify 段落之后）：**
>
> ```dotenv
> # Amazon SP-API OAuth (obtain from Seller Central → Developer Console)
> # Applies to both LWA OAuth flow (oauth.ts) and HarnessFactory token decryption
> AMAZON_CLIENT_ID=your-amazon-client-id
> AMAZON_CLIENT_SECRET=your-amazon-client-secret
>
> # 32-byte key as 64-char hex for Amazon refresh_token encryption
> # Share with SHOPIFY_ENCRYPTION_KEY style: openssl rand -hex 32
> # Used by: harness-factory.ts (CRED_ENCRYPTION_KEY)
> CRED_ENCRYPTION_KEY=replace-with-64-char-hex-string
>
> # Redis (already present — verify it matches docker-compose.yml)
> REDIS_URL=redis://localhost:6379
> ```
>
> **实现约束：**
> - `CRED_ENCRYPTION_KEY` 与 `SHOPIFY_ENCRYPTION_KEY` 可以是同一个值（AES-256 key），但命名分开以便将来轮换
> - `APP_BASE_URL` 已存在，Amazon OAuth 复用同一变量，无需重复添加
>
> **验收：**
> - [ ] `.env.example` 包含 `AMAZON_CLIENT_ID`、`AMAZON_CLIENT_SECRET`、`CRED_ENCRYPTION_KEY`
> - [ ] 每个变量附有单行注释说明来源
>
> **产出：** 环境变量文档补全，新人 onboarding 一键复制

---

> **🃏 CARD-D8-02 · `apps/api/src/routes/app.smoke.test.ts` — 全路由注册冒烟测试**
>
> **类型：** 新建测试文件  \
> **耗时：** 45 min  \
> **目标文件：** `apps/api/src/routes/app.smoke.test.ts`
>
> **设计目的：** 验证所有路由已正确注册至 `buildServer()` 返回的 Fastify 实例——
> 路由缺失时响应 404，路由存在时响应任意非 404 状态码（env 缺失 → 503、参数缺失 → 400 等均视为"已注册"）。
>
> **函数签名模板（可直接复制）：**
>
> ```typescript
> import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
> import { buildServer } from '../app.js'
> import type { FastifyInstance } from 'fastify'
>
> // 屏蔽所有外部依赖，只测试路由注册本身
> vi.mock('@patioer/db', () => ({
>   withTenantDb: vi.fn(),
>   db: { select: vi.fn(), insert: vi.fn() },
>   schema: {
>     platformCredentials: { tenantId: '', platform: '', region: '' },
>     webhookEvents: 'webhook_events',
>     tenants: {},
>   },
> }))
> vi.mock('../lib/harness-registry.js', () => ({
>   registry: { get: vi.fn(), invalidate: vi.fn() },
> }))
> vi.mock('../lib/crypto.js', () => ({
>   encryptToken: vi.fn(() => 'enc'),
>   decryptToken: vi.fn(() => 'dec'),
> }))
>
> let app: FastifyInstance
>
> beforeAll(async () => {
>   app = buildServer()
>   await app.ready()
> })
>
> afterAll(async () => {
>   await app.close()
> })
>
> // --- 辅助：assert route is registered (status !== 404) ---
> async function assertRegistered(
>   method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
>   url: string,
>   headers?: Record<string, string>,
> ): Promise<void> {
>   const res = await app.inject({ method, url, headers })
>   expect(res.statusCode, `${method} ${url} should be registered (not 404)`).not.toBe(404)
> }
> ```
>
> **测试用例名字（按路由分组）：**
>
> ```
> describe('Smoke — System routes') {
>   'GET /api/v1/health returns 200'
>   'GET /api/v1/docs returns 200 (Swagger UI)'
> }
>
> describe('Smoke — Shopify routes') {
>   'GET /api/v1/shopify/auth is registered (non-404)'
>   'GET /api/v1/shopify/callback is registered (non-404)'
>   'POST /api/v1/webhooks/shopify is registered (non-404)'
> }
>
> describe('Smoke — Amazon routes') {
>   'GET /api/v1/amazon/auth is registered (non-404)'
>   'GET /api/v1/amazon/auth/callback is registered (non-404)'
>   'POST /api/v1/webhooks/amazon is registered (non-404)'
> }
>
> describe('Smoke — Business routes') {
>   'POST /api/v1/products/sync is registered (non-404)'
>   'POST /api/v1/orders is registered (non-404)'
>   'GET /api/v1/agents is registered (non-404)'
>   'GET /api/v1/approvals is registered (non-404)'
> }
>
> describe('Smoke — Unknown route') {
>   'GET /api/v1/nonexistent returns 404'
> }
> ```
>
> **实现约束：**
> - 所有 test case 只断言 `statusCode !== 404`（即路由已挂载），不关心业务逻辑
> - `beforeAll` 中调用 `app.ready()` 确保插件链完全初始化
> - 对需要 `x-tenant-id` 的路由，传入任意 UUID（会返回 401/400 而非 404）
>
> **验收：**
> - [ ] 所有 13 个 smoke test case 通过
> - [ ] 确认 Amazon 路由（`/api/v1/amazon/auth`、`/api/v1/webhooks/amazon`）出现在测试结果中
>
> **产出：** 路由注册 smoke test 文件，防止未来路由遗漏注册的回归

---

> **🃏 CARD-D8-03 · `docs/operations.md` — Amazon OAuth + Redis 运营文档**
>
> **类型：** 文档更新  \
> **耗时：** 30 min  \
> **目标文件：** `docs/operations.md`
>
> **需要新增的章节（追加到现有 § Shopify 之后）：**
>
> ```markdown
> ### Amazon SP-API
>
> | Variable | Required | Description |
> |----------|----------|-------------|
> | `AMAZON_CLIENT_ID` | Yes | SP-API app client ID (Seller Central → Developer Console) |
> | `AMAZON_CLIENT_SECRET` | Yes | SP-API app client secret |
> | `CRED_ENCRYPTION_KEY` | Yes | 32-byte hex key for refresh_token encryption (`openssl rand -hex 32`) |
>
> **OAuth Flow:**
> 1. Redirect merchant: `GET /api/v1/amazon/auth?tenantId=<id>&sellerId=<id>&marketplaceId=<id>&region=na`
> 2. Amazon redirects back to `GET /api/v1/amazon/auth/callback?code=...&state=...`
> 3. Encrypted refresh_token persisted in `platform_credentials` (platform=`amazon`, credentialType=`lwa`)
>
> ### Redis
>
> | Variable | Required | Default | Description |
> |----------|----------|---------|-------------|
> | `REDIS_URL` | Yes (Phase 2) | `redis://localhost:6379` | BullMQ + rate-limiter connection |
>
> Redis is required for BullMQ job queues (platform API rate limiting). Start locally:
> ```bash
> docker compose up -d redis
> docker exec patioer-redis redis-cli PING   # expected: PONG
> ```
> ```
>
> **需要更新的路由表（§ API Documentation → Route Groups）：**
> 在 Shopify OAuth 行之后追加：
>
> ```
> | Amazon OAuth | `GET /api/v1/amazon/auth`, `GET /api/v1/amazon/auth/callback` | None (OAuth flow) |
> | Amazon Webhooks | `POST /api/v1/webhooks/amazon` | `x-tenant-id` header |
> ```
>
> **验收：**
> - [ ] `docs/operations.md` §2 包含 Amazon + Redis 环境变量表
> - [ ] §4 Route Groups 表包含 Amazon OAuth 和 Amazon Webhooks 行
>
> **产出：** 运营文档与代码实现同步

---

> **🃏 CARD-D8-04 · 全量回归 + 覆盖率门禁**
>
> **类型：** 验证  \
> **耗时：** 20 min
>
> ```bash
> # 1. 全仓 typecheck + lint
> pnpm typecheck
> pnpm lint
>
> # 2. 全量测试（含 Day 8 新增的 smoke test）
> pnpm test
>
> # 3. API 包覆盖率报告（门槛: statements ≥80%, branches ≥70%）
> pnpm --filter @patioer/api test:coverage
>
> # 4. 手动冒烟（需本地 docker 环境）
> docker compose up -d postgres redis
> pnpm --filter @patioer/api dev &
> sleep 3
> curl -s http://localhost:3100/api/v1/health | jq .
> # expected: { "status": "ok" }
>
> curl -s -o /dev/null -w "%{http_code}" \
>   "http://localhost:3100/api/v1/amazon/auth?tenantId=x&sellerId=y&marketplaceId=z"
> # expected: 503 (env not set) or 302 (env set) — never 404
>
> curl -s -o /dev/null -w "%{http_code}" \
>   -X POST http://localhost:3100/api/v1/webhooks/amazon \
>   -H "Content-Type: text/plain" \
>   -d 'bad'
> # expected: 400 — never 404
> ```
>
> **Sprint 1 验收 checklist：**
>
> | # | 验收项 | 状态 | 依据 |
> |---|--------|------|------|
> | 1 | AC-01 闭环：3 Agent Paperclip ACTIVE | ⬜ | Day 1 联调 |
> | 2 | `platform_credentials` 支持 amazon 凭证存储 | ✅ | Day 1 schema + Day 7 OAuth |
> | 3 | `AmazonHarness` 全接口实现（getProducts/updatePrice/getOrders/updateInventory/getAnalytics/replyToMessage） | ✅ | Day 3–5 |
> | 4 | BullMQ 限流队列 + TokenBucket 集成 | ✅ | Day 2 + Day 6 |
> | 5 | Amazon LWA OAuth 路由 + 凭证持久化 | ✅ | Day 7 |
> | 6 | Amazon SNS Webhook 骨架 | ✅ | Day 7 |
> | 7 | CI pipeline 全绿（typecheck + lint + test） | ✅ | Day 7 门禁 |
> | 8 | `app.smoke.test.ts` 全路由注册验证 | ✅ | Day 8 — 13 case 全绿 |
>
> **验收：**
> - [ ] `pnpm test` 全部通过（无 failed）
> - [ ] 覆盖率报告 statements ≥ 80%
> - [ ] smoke test 13 个 case 全绿
>
> **产出：** Sprint 1 技术验收完成

---

> **🃏 CARD-D8-05 · Sprint 1 关闭 + Sprint 2 准备**
>
> **类型：** 检查点 + 规划  \
> **耗时：** 1h
>
> **Sprint 1 代码产出统计（实际）：**
>
> | 类别 | 文件 | 测试 case |
> |------|------|-----------|
> | packages/harness | `amazon.types.ts`, `amazon.harness.ts`, `ads.harness.ts`, `inventory.harness.ts` | ~35 case |
> | apps/api lib | `redis.ts`, `queue-factory.ts`, `rate-limiter.ts`, `harness-factory.ts`, `graceful-shutdown.ts` | ~20 case |
> | apps/api routes | `amazon/oauth.ts`, `amazon/webhook.ts`, `app.smoke.test.ts` | ~20 case |
> | packages/db | `platform-credentials.ts` 扩展, `0002_phase2.sql` | — |
> | 配置 | `.env.example`, `docker-compose.yml` | — |
>
> **Sprint 2 准备 checklist：**
>
> ```
> □  确认 TikTok Shop Sandbox 申请状态（Developer Portal 审核周期约 3-5 工作日）
> □  确认 Shopee test-stable 环境可访问（需 Partner ID + Partner Key）
> □  确认 Amazon SP-API 审核进度（预计 Sprint 2 期间仍在审核；sandbox 可先用）
> □  记录 TikTok HMAC-SHA256 签名规范（App Key + App Secret + timestamp + body）
> □  记录 Shopee 多市场 partner_id 映射（SG: 2009xxx, MY: 2010xxx）
> □  在 GitHub Project 中将 Sprint 2 工单移入 In Progress
> ```
>
> **Sprint 2 核心目标（Week 3–4）：**
> - `TikTokHarness` — HMAC-SHA256 签名 + 全接口
> - `ShopeeHarness` — 多市场签名 + 全接口
> - TikTok/Shopee OAuth + Webhook 路由
> - Phase 1 降级项回收：`DG-01`（Agent 内测 UI）、`DG-03`（PaperclipBridge.createIssue）
>
> **验收：**
> - [ ] Sprint 1 验收 checklist 第 1–8 项全部 ✅
> - [ ] Sprint 2 工单已在 Project Board 就位
>
> **产出：** Sprint 1 正式关闭 · Sprint 2 就绪

---

**Day 8 卡片执行顺序汇总：**

```
09:00  CARD-D8-01  .env.example Amazon 变量补全                (10min)
09:10  CARD-D8-02  app.smoke.test.ts 路由注册冒烟测试           (45min)
10:00  CARD-D8-03  docs/operations.md Amazon + Redis 文档      (30min)
10:30  CARD-D8-04  全量回归 + 覆盖率门禁 + 手动冒烟             (20min)
11:00  CARD-D8-05  Sprint 1 关闭 + Sprint 2 准备               (1h)
```

> 产出：Sprint 1 全部验收通过 · Sprint 2 准备就绪

---

#### Sprint 1 · 每日产出汇总

```
Day 1  │ AC-01 ✅ │ Amazon 申请 │ DB schema 扩展 │ migration part1
Day 2  │ Redis + BullMQ │ 队列工厂 │ 限流配置 │ 优雅关闭
Day 3  │ AdsCapable 接口 │ InventoryCapable 接口 │ AmazonHarness 骨架 + LWA
Day 4  │ getProducts │ updatePrice │ getOrders │ updateInventory
Day 5  │ getAnalytics │ replyToMessage │ ~15 test cases │ 导出更新
Day 6  │ 限流队列 │ 指数退避增强 │ harness-factory │ 多平台 Registry
Day 7  │ Amazon OAuth │ Webhook 骨架 │ OAuth 测试 │ CI 全绿
Day 8  │ 集成冒烟 │ 回归测试 │ .env 更新 │ Sprint Review
```

---

### Sprint 2 · Week 3–4 — TikTok + Shopee Harness + Phase 1 回收

**交付物：** TikTok Shop / Shopee Harness 实现、Phase 1 降级项 DG-01/DG-03 回收

| # | 任务 | 包/目录 | 依赖 | 估时 |
|---|------|---------|------|------|
| 2.1 | `TikTokHarness` 实现：HMAC-SHA256 签名 + `getProducts` / `updatePrice` | `packages/harness` | S1 完成 | 1.5d |
| 2.2 | `TikTokHarness` 实现：`getOrders` + 直播订单 Webhook（`ORDER_STATUS_CHANGE` + `LIVE_ORDER`） | `packages/harness` | 2.1 | 1d |
| 2.3 | TikTok OAuth + Webhook 路由 | `apps/api` routes/tiktok | 2.1 | 1d |
| 2.4 | `ShopeeHarness` 实现：多市场签名（partner_id + shop_id + access_token）+ `getProducts` / `updatePrice` | `packages/harness` | S1 完成 | 1.5d |
| 2.5 | `ShopeeHarness` 多市场适配：SG / MY / TH / PH / ID / VN 的 `baseUrl` + `shopId` | `packages/harness` | 2.4 | 1d |
| 2.6 | Shopee OAuth + Webhook 路由 | `apps/api` routes/shopee | 2.4 | 1d |
| 2.7 | **DG-03 回收**：`PaperclipBridge.createIssue()` 完整实现 + Product Scout 对接 | `packages/agent-runtime` | S1.1 | 0.5d |
| 2.8 | **DG-01 回收**：Support Relay 对接 Shopify Inbox API（若权限已获批）或保持 stub + warning | `packages/harness` + `packages/agent-runtime` | — | 0.5d |
| 2.9 | 三平台 Harness 测试：Amazon / TikTok / Shopee 各 mock 测试套件 | `packages/harness` | 2.1–2.6 | 2d |

**Sprint 2 验收：**
- [ ] TikTok sandbox `getProducts()` 正常
- [ ] Shopee SG + MY 两个市场 `getProducts()` 正常
- [ ] TikTok Webhook 接收 `ORDER_STATUS_CHANGE` 事件
- [ ] PaperclipBridge.createIssue() 可创建 Paperclip Issue
- [ ] 三平台 Harness mock 测试全部通过

---

#### Sprint 2 · Day-by-Day 实施细节

---

##### Day 9 — TikTokHarness 骨架 + HMAC-SHA256 签名

---

> **🃏 CARD-D9-01 · TikTok 内部类型定义**
>
> **类型：** 新建文件  \
> **耗时：** 20 min  \
> **目标文件：** `packages/harness/src/tiktok.types.ts`
>
> **类型模板（可直接复制）：**
>
> ```typescript
> export interface TikTokProduct {
>   id: string
>   title: string
>   status: string
>   price: { amount: string; currency: string }
>   inventory: number
>   skus?: Array<{ id: string; price: { amount: string }; inventory: number }>
> }
>
> export interface TikTokOrder {
>   order_id: string
>   status: string
>   payment_info: { total_amount: string; currency: string }
>   create_time: number
>   line_items: Array<{ product_id: string; quantity: number }>
> }
>
> export interface TikTokApiResponse<T> {
>   code: number
>   message: string
>   data?: T
>   request_id?: string
> }
>
> export interface TikTokProductListData {
>   products: TikTokProduct[]
>   next_page_token?: string
>   total_count?: number
> }
>
> export interface TikTokOrderListData {
>   order_list: TikTokOrder[]
>   next_page_token?: string
>   total_count?: number
> }
> ```
>
> **产出：** TikTokHarness 实现前置类型资产

---

> **🃏 CARD-D9-02 · TikTok HMAC-SHA256 签名工具函数**
>
> **类型：** 新建文件  \
> **耗时：** 1h  \
> **目标文件：** `packages/harness/src/tiktok.harness.ts`（仅签名部分）
>
> **函数签名模板（可直接复制）：**
>
> ```typescript
> import crypto from 'node:crypto'
>
> const TIKTOK_BASE_URL = 'https://open-api.tiktokshop.com'
>
> export interface TikTokCredentials {
>   appKey: string
>   appSecret: string
>   accessToken: string
>   shopId?: string
> }
>
> function buildTikTokSign(
>   appSecret: string,
>   path: string,
>   params: Record<string, string>,
>   body?: string,
> ): string {
>   // TikTok Shop 签名算法：
>   // 1. 收集所有非 sign / access_token 的参数，按 key 排序
>   // 2. 拼接：appSecret + path + key1value1key2value2... + body（如有）+ appSecret
>   // 3. HMAC-SHA256
>   const excludeKeys = new Set(['sign', 'access_token'])
>   const paramStr = Object.keys(params)
>     .filter((k) => !excludeKeys.has(k))
>     .sort()
>     .map((k) => `${k}${params[k]}`)
>     .join('')
>   const rawStr = `${appSecret}${path}${paramStr}${body ?? ''}${appSecret}`
>   return crypto.createHmac('sha256', appSecret).update(rawStr).digest('hex')
> }
>
> function buildTikTokParams(
>   appKey: string,
>   appSecret: string,
>   path: string,
>   extra: Record<string, string> = {},
>   body?: string,
> ): Record<string, string> {
>   const timestamp = String(Math.floor(Date.now() / 1000))
>   const baseParams: Record<string, string> = { app_key: appKey, timestamp, ...extra }
>   const sign = buildTikTokSign(appSecret, path, baseParams, body)
>   return { ...baseParams, sign }
> }
> ```
>
> **测试文件：** `packages/harness/src/tiktok.harness.test.ts`
>
> **测试用例名字（逐条实现）：**
> - `buildTikTokSign returns deterministic HMAC-SHA256 for given params`
> - `buildTikTokSign excludes sign and access_token from param string`
> - `buildTikTokSign sorts params by key before hashing`
> - `buildTikTokParams includes app_key and timestamp in result`
>
> **产出：** TikTok 签名算法封装，可复用于所有 API 调用

---

> **🃏 CARD-D9-03 · `TikTokHarness` 骨架（构造 + tikTokFetch）**
>
> **类型：** 代码变更  \
> **耗时：** 1.5h  \
> **目标文件：** `packages/harness/src/tiktok.harness.ts`
>
> **函数签名模板（可直接复制）：**
>
> ```typescript
> import type { TenantHarness } from './base.harness.js'
> import { HarnessError } from './harness-error.js'
> import type {
>   Product, Order, Thread, Analytics, DateRange, PaginationOpts,
> } from './types.js'
> import type { TikTokApiResponse, TikTokProduct, TikTokOrder } from './tiktok.types.js'
>
> const MAX_RETRIES = 3
> const BASE_DELAY_MS = 500
>
> async function sleep(ms: number): Promise<void> {
>   return new Promise((resolve) => setTimeout(resolve, ms))
> }
>
> export class TikTokHarness implements TenantHarness {
>   readonly platformId = 'tiktok'
>
>   constructor(
>     readonly tenantId: string,
>     private readonly credentials: TikTokCredentials,
>   ) {}
>
>   private async tikTokFetch<T>(
>     path: string,
>     opts: {
>       method?: 'GET' | 'POST' | 'PUT'
>       query?: Record<string, string>
>       body?: unknown
>     } = {},
>   ): Promise<T> {
>     const method = opts.method ?? 'GET'
>     const bodyStr = opts.body ? JSON.stringify(opts.body) : undefined
>
>     const extraParams: Record<string, string> = {
>       access_token: this.credentials.accessToken,
>       ...(this.credentials.shopId ? { shop_id: this.credentials.shopId } : {}),
>       ...(opts.query ?? {}),
>     }
>     const signedParams = buildTikTokParams(
>       this.credentials.appKey,
>       this.credentials.appSecret,
>       path,
>       extraParams,
>       bodyStr,
>     )
>
>     const url = new URL(path, TIKTOK_BASE_URL)
>     for (const [k, v] of Object.entries(signedParams)) {
>       url.searchParams.set(k, v)
>     }
>
>     for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
>       const res = await fetch(url.toString(), {
>         method,
>         headers: { 'Content-Type': 'application/json' },
>         body: bodyStr,
>         signal: AbortSignal.timeout(15_000),
>       })
>
>       if (!res.ok) {
>         if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
>           await sleep(BASE_DELAY_MS * 2 ** attempt)
>           continue
>         }
>         throw new HarnessError('tiktok', String(res.status), `TikTok API error ${res.status}`)
>       }
>
>       const json = (await res.json()) as TikTokApiResponse<T>
>       if (json.code !== 0) {
>         throw new HarnessError('tiktok', String(json.code), json.message)
>       }
>       return json.data as T
>     }
>
>     throw new HarnessError('tiktok', 'max_retries', 'TikTok API max retries exceeded')
>   }
>
>   async getProducts(_opts?: PaginationOpts): Promise<Product[]> {
>     throw new HarnessError('tiktok', 'not_implemented', 'Day10 implementation')
>   }
>   async updatePrice(_productId: string, _price: number): Promise<void> {
>     throw new HarnessError('tiktok', 'not_implemented', 'Day10 implementation')
>   }
>   async updateInventory(_productId: string, _qty: number): Promise<void> {
>     throw new HarnessError('tiktok', 'not_implemented', 'Day10 implementation')
>   }
>   async getOrders(_opts?: PaginationOpts): Promise<Order[]> {
>     throw new HarnessError('tiktok', 'not_implemented', 'Day11 implementation')
>   }
>   async replyToMessage(_threadId: string, _body: string): Promise<void> {
>     throw new HarnessError('tiktok', 'not_implemented', 'Day11 implementation')
>   }
>   async getOpenThreads(): Promise<Thread[]> { return [] }
>   async getAnalytics(_range: DateRange): Promise<Analytics> {
>     return { revenue: 0, orders: 0, truncated: true }
>   }
> }
> ```
>
> **测试用例名字（逐条实现）：**
> - `tikTokFetch signs request with app_key and timestamp`
> - `tikTokFetch includes shop_id in params when provided`
> - `tikTokFetch throws HarnessError when TikTok code is non-zero`
> - `tikTokFetch retries on 429 with exponential backoff`
> - `tikTokFetch throws after max retries`
>
> **产出：** TikTokHarness 骨架文件落地，Day10 可直接补方法实现

---

> **🃏 CARD-D9-04 · `index.ts` 预留 TikTok 导出 + harness-factory 预占位**
>
> **类型：** 代码变更  \
> **耗时：** 15 min  \
> **目标文件：** `packages/harness/src/index.ts`、`apps/api/src/lib/harness-factory.ts`
>
> **变更 1：index.ts 追加导出**
> ```typescript
> export * from './tiktok.types.js'
> export * from './tiktok.harness.js'
> ```
>
> **变更 2：harness-factory.ts switch 追加占位（TikTok，Day11 完成后再填充）**
> ```typescript
> case 'tiktok':
>   throw new Error('TikTok harness: implementation in progress (Day11)')
> ```
>
> **产出：** 导出路径预留，后续天无需再改 index.ts

---

> **🃏 CARD-D9-05 · Day9 回归与检查点**
>
> **类型：** 验证  \
> **耗时：** 20 min  \
> **依赖：** CARD-D9-01 ~ D9-04
>
> ```bash
> pnpm --filter @patioer/harness typecheck
> pnpm --filter @patioer/harness test
> pnpm typecheck
> pnpm lint
> ```
>
> **Day9 验收清单：**
> - [ ] `tiktok.types.ts` 已创建，类型可被导入
> - [ ] `buildTikTokSign` 签名算法 4 个测试通过
> - [ ] `TikTokHarness` 骨架可编译，`tikTokFetch` 5 个测试通过
> - [ ] `index.ts` 已导出 TikTok 类型与类
> - [ ] 全仓 `typecheck/lint` 通过
>
> **产出：** Day9 可合并状态

---

**Day 9 卡片执行顺序汇总：**

```
09:00  CARD-D9-01  tiktok.types.ts 类型定义           (20min)
09:20  CARD-D9-02  HMAC-SHA256 签名工具函数            (1h)
10:20  CARD-D9-03  TikTokHarness 骨架 + tikTokFetch   (1.5h)
12:00  CARD-D9-04  index.ts 导出 + factory 占位        (15min)
13:30  CARD-D9-05  回归验证与检查点                    (20min)
```

---

##### Day 10 — TikTokHarness 核心方法（getProducts / updatePrice / updateInventory）

---

> **🃏 CARD-D10-01 · `getProductsPage/getProducts`（Products API）**
>
> **类型：** 代码变更  \
> **耗时：** 1h  \
> **目标文件：** `packages/harness/src/tiktok.harness.ts`
>
> **函数签名模板（可直接复制）：**
>
> ```typescript
> function normalizeTikTokProduct(p: TikTokProduct): Product {
>   const primarySku = p.skus?.[0]
>   return {
>     id: p.id,
>     title: p.title,
>     price: Number(primarySku?.price.amount ?? p.price.amount),
>     inventory: primarySku?.inventory ?? p.inventory,
>     currency: p.price.currency,
>     platform: 'tiktok',
>   }
> }
>
> async getProductsPage(opts?: PaginationOpts): Promise<{ items: Product[]; nextCursor?: string }> {
>   const data = await this.tikTokFetch<TikTokProductListData>('/api/products/search', {
>     method: 'POST',
>     body: {
>       page_size: opts?.limit ?? 20,
>       ...(opts?.cursor ? { page_token: opts.cursor } : {}),
>     },
>   })
>   const items = (data.products ?? []).map(normalizeTikTokProduct)
>   return { items, nextCursor: data.next_page_token }
> }
>
> async getProducts(opts?: PaginationOpts): Promise<Product[]> {
>   const page = await this.getProductsPage(opts)
>   return page.items
> }
> ```
>
> **测试用例名字（逐条实现）：**
> - `getProducts maps TikTok products to Product domain model`
> - `getProducts returns empty array when TikTok returns no products`
> - `getProductsPage returns nextCursor from next_page_token`
> - `getProducts normalizes price from primary SKU when available`
>
> **产出：** TikTok 商品读取链路完成

---

> **🃏 CARD-D10-02 · `updatePrice`（Product API PATCH）**
>
> **类型：** 代码变更  \
> **耗时：** 45 min  \
> **目标文件：** `packages/harness/src/tiktok.harness.ts`
>
> **函数签名模板（可直接复制）：**
>
> ```typescript
> async updatePrice(productId: string, price: number): Promise<void> {
>   // TikTok 更新价格通过 SKU 级别的 edit_product API
>   await this.tikTokFetch(`/api/products/${productId}`, {
>     method: 'PUT',
>     body: {
>       skus: [
>         {
>           price: {
>             amount: price.toFixed(2),
>             currency: 'USD',
>           },
>         },
>       ],
>     },
>   })
> }
> ```
>
> **测试用例名字（逐条实现）：**
> - `updatePrice sends PUT request to product endpoint with price payload`
> - `updatePrice formats price to two decimal places`
> - `updatePrice throws HarnessError when TikTok API returns error code`
>
> **产出：** TikTok 价格更新链路完成

---

> **🃏 CARD-D10-03 · `updateInventory`（Inventory API）**
>
> **类型：** 代码变更  \
> **耗时：** 45 min  \
> **目标文件：** `packages/harness/src/tiktok.harness.ts`
>
> **函数签名模板（可直接复制）：**
>
> ```typescript
> async updateInventory(productId: string, qty: number): Promise<void> {
>   await this.tikTokFetch('/api/inventory/update', {
>     method: 'POST',
>     body: {
>       inventory_list: [
>         {
>           sku_id: productId,
>           warehouse_list: [{ available_stock: qty }],
>         },
>       ],
>     },
>   })
> }
> ```
>
> **测试用例名字（逐条实现）：**
> - `updateInventory sends POST request with inventory_list payload`
> - `updateInventory wraps productId as sku_id`
> - `updateInventory throws HarnessError when API responds with error code`
>
> **产出：** TikTok 库存更新链路完成

---

> **🃏 CARD-D10-04 · `getAnalytics` MVP 实现**
>
> **类型：** 代码变更  \
> **耗时：** 30 min  \
> **目标文件：** `packages/harness/src/tiktok.harness.ts`
>
> ```typescript
> async getAnalytics(range: DateRange): Promise<Analytics> {
>   // MVP：通过聚合最近 100 单订单得出分析数据
>   const orders = await this.getOrders({ limit: 100 })
>   const revenue = orders.reduce((sum, o) => sum + o.totalPrice, 0)
>   return { revenue, orders: orders.length, truncated: orders.length >= 100 }
> }
> ```
>
> **测试用例名字（逐条实现）：**
> - `getAnalytics aggregates revenue from getOrders result`
> - `getAnalytics returns zero for empty order list`
> - `getAnalytics sets truncated=true when order count reaches limit`
>
> **产出：** TikTok 分析能力 MVP 可用

---

> **🃏 CARD-D10-05 · Day10 回归与验收门禁**
>
> **类型：** 验证  \
> **耗时：** 30 min  \
> **依赖：** CARD-D10-01 ~ D10-04
>
> ```bash
> pnpm --filter @patioer/harness typecheck
> pnpm --filter @patioer/harness test
> pnpm typecheck && pnpm lint && pnpm test
> ```
>
> **Day10 验收清单：**
> - [ ] `getProductsPage/getProducts` 已完成并返回标准 `Product`
> - [ ] `updatePrice` PUT payload 正确，价格格式化到 2 位小数
> - [ ] `updateInventory` POST payload 正确
> - [ ] `getAnalytics` MVP 聚合逻辑实现
> - [ ] Day10 新增测试全部通过
> - [ ] 全仓 `typecheck/lint/test` 全绿
>
> **产出：** Day10 可合并状态（TikTokHarness 商品+价格+库存+分析）

---

**Day 10 卡片执行顺序汇总：**

```
09:00  CARD-D10-01  getProductsPage/getProducts    (1h)
10:10  CARD-D10-02  updatePrice PUT                (45min)
11:00  CARD-D10-03  updateInventory POST           (45min)
13:30  CARD-D10-04  getAnalytics MVP               (30min)
14:10  CARD-D10-05  回归验证与验收门禁              (30min)
```

---

##### Day 11 — TikTok getOrders + 直播订单 Webhook + OAuth 路由

---

> **🃏 CARD-D11-01 · `getOrdersPage/getOrders`（Orders API）**
>
> **类型：** 代码变更  \
> **耗时：** 1h  \
> **目标文件：** `packages/harness/src/tiktok.harness.ts`
>
> **函数签名模板（可直接复制）：**
>
> ```typescript
> function normalizeTikTokOrder(o: TikTokOrder): Order {
>   return {
>     id: o.order_id,
>     status: o.status,
>     totalPrice: Number(o.payment_info.total_amount),
>   }
> }
>
> async getOrdersPage(
>   opts?: PaginationOpts,
> ): Promise<{ items: Order[]; nextCursor?: string }> {
>   const data = await this.tikTokFetch<TikTokOrderListData>('/api/orders/search', {
>     method: 'POST',
>     body: {
>       page_size: opts?.limit ?? 50,
>       ...(opts?.cursor ? { page_token: opts.cursor } : {}),
>       // 查询最近 30 天
>       create_time_ge: Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000),
>       create_time_lt: Math.floor(Date.now() / 1000),
>     },
>   })
>   const items = (data.order_list ?? []).map(normalizeTikTokOrder)
>   return { items, nextCursor: data.next_page_token }
> }
>
> async getOrders(opts?: PaginationOpts): Promise<Order[]> {
>   const page = await this.getOrdersPage(opts)
>   return page.items
> }
> ```
>
> **测试用例名字（逐条实现）：**
> - `getOrders maps TikTok order list to Order domain model`
> - `getOrdersPage returns nextCursor from next_page_token`
> - `getOrders returns empty array when order_list is missing`
> - `getOrders correctly parses totalPrice from payment_info`
>
> **产出：** TikTok 订单读取链路完成

---

> **🃏 CARD-D11-02 · `replyToMessage` + `getOpenThreads` 实现**
>
> **类型：** 代码变更  \
> **耗时：** 30 min  \
> **目标文件：** `packages/harness/src/tiktok.harness.ts`
>
> ```typescript
> async replyToMessage(threadId: string, body: string): Promise<void> {
>   // TikTok Shop buyer-seller messaging
>   await this.tikTokFetch('/api/customer_service/message/send', {
>     method: 'POST',
>     body: {
>       conversation_id: threadId,
>       message_type: 'TEXT',
>       content: { text: body },
>     },
>   })
> }
>
> async getOpenThreads(): Promise<Thread[]> {
>   // MVP：返回空数组；Sprint 3 对接 /api/customer_service/conversations
>   return []
> }
> ```
>
> **测试用例名字（逐条实现）：**
> - `replyToMessage sends POST to customer_service message endpoint`
> - `replyToMessage includes conversation_id and text content`
> - `getOpenThreads returns empty array in MVP mode`
>
> **产出：** TikTok 消息能力 MVP 可用

---

> **🃏 CARD-D11-03 · TikTok OAuth 路由（`routes/tiktok/oauth.ts`）**
>
> **类型：** 新建文件  \
> **耗时：** 1.5h  \
> **目标文件：** `apps/api/src/routes/tiktok/oauth.ts`
>
> **函数签名模板（可直接复制）：**
>
> ```typescript
> import type { FastifyPluginAsync } from 'fastify'
> import { withTenantDb, schema } from '@patioer/db'
> import { encryptToken } from '../../lib/crypto.js'
>
> // GET  /api/v1/tiktok/auth        — 重定向到 TikTok 授权页
> // GET  /api/v1/tiktok/auth/callback — 换取 access_token，存储凭证
>
> const TIKTOK_AUTH_URL = 'https://auth.tiktok-shops.com/oauth/authorize'
> const TIKTOK_TOKEN_URL = 'https://auth.tiktok-shops.com/api/v2/token/get'
>
> export const tikTokOAuthRoutes: FastifyPluginAsync = async (app) => {
>   app.get('/auth', async (request, reply) => {
>     const { tenantId, appKey } = request.query as Record<string, string>
>     if (!tenantId) return reply.code(400).send({ error: 'tenantId required' })
>     if (!appKey) return reply.code(400).send({ error: 'appKey required' })
>
>     const state = Buffer.from(JSON.stringify({ tenantId, appKey })).toString('base64url')
>     const url = new URL(TIKTOK_AUTH_URL)
>     url.searchParams.set('app_key', appKey)
>     url.searchParams.set('state', state)
>     return reply.redirect(url.toString())
>   })
>
>   app.get('/auth/callback', async (request, reply) => {
>     const { code, state } = request.query as Record<string, string>
>     if (!code || !state) return reply.code(400).send({ error: 'code and state required' })
>
>     let tenantId: string
>     let appKey: string
>     try {
>       const decoded = JSON.parse(Buffer.from(state, 'base64url').toString()) as Record<string, string>
>       tenantId = decoded.tenantId
>       appKey = decoded.appKey
>     } catch {
>       return reply.code(400).send({ error: 'invalid state' })
>     }
>
>     // 换取 access_token
>     const tokenRes = await fetch(TIKTOK_TOKEN_URL, {
>       method: 'POST',
>       headers: { 'Content-Type': 'application/json' },
>       body: JSON.stringify({ app_key: appKey, auth_code: code, grant_type: 'authorized_code' }),
>     })
>     if (!tokenRes.ok) return reply.code(502).send({ error: 'token exchange failed' })
>
>     const tokenData = (await tokenRes.json()) as {
>       data?: { access_token: string; shop_id?: string; app_key: string }
>     }
>     const { access_token, shop_id } = tokenData.data ?? {}
>     if (!access_token) return reply.code(502).send({ error: 'no access_token in response' })
>
>     const encKey = process.env.CRED_ENCRYPTION_KEY!
>     const encryptedToken = encryptToken(access_token, encKey)
>
>     await withTenantDb(tenantId, async (db) => {
>       await db
>         .insert(schema.platformCredentials)
>         .values({
>           tenantId,
>           platform: 'tiktok',
>           credentialType: 'hmac',
>           accessToken: encryptedToken,
>           metadata: { appKey, shopId: shop_id },
>         })
>         .onConflictDoUpdate({
>           target: [
>             schema.platformCredentials.tenantId,
>             schema.platformCredentials.platform,
>           ],
>           set: { accessToken: encryptedToken, metadata: { appKey, shopId: shop_id } },
>         })
>     })
>
>     return reply.send({ ok: true, shopId: shop_id })
>   })
> }
> ```
>
> **测试文件：** `apps/api/src/routes/tiktok/oauth.test.ts`
>
> **测试用例名字（逐条实现）：**
> - `GET /auth returns 400 when tenantId is missing`
> - `GET /auth returns 400 when appKey is missing`
> - `GET /auth redirects to TikTok authorization URL with state`
> - `GET /auth/callback returns 400 when code or state is missing`
> - `GET /auth/callback returns 400 when state is invalid base64`
> - `GET /auth/callback returns 502 when TikTok token exchange fails`
> - `GET /auth/callback persists encrypted access_token to platform_credentials`
>
> **产出：** TikTok OAuth 完整授权流程

---

> **🃏 CARD-D11-04 · TikTok Webhook 路由（`routes/tiktok/webhook.ts`）**
>
> **类型：** 新建文件  \
> **耗时：** 45 min  \
> **目标文件：** `apps/api/src/routes/tiktok/webhook.ts`
>
> **函数签名模板（可直接复制）：**
>
> ```typescript
> import type { FastifyPluginAsync } from 'fastify'
> import crypto from 'node:crypto'
>
> // TikTok Shop Webhook 签名验证：
> // HMAC-SHA256(appSecret, timestamp + nonce + body)
> function verifyTikTokWebhookSignature(
>   appSecret: string,
>   signature: string,
>   timestamp: string,
>   nonce: string,
>   body: Buffer,
> ): boolean {
>   const expected = crypto
>     .createHmac('sha256', appSecret)
>     .update(`${timestamp}${nonce}${body.toString('utf8')}`)
>     .digest('base64')
>   return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
> }
>
> export const tikTokWebhookRoute: FastifyPluginAsync = async (app) => {
>   app.addContentTypeParser(
>     'application/json',
>     { parseAs: 'buffer' },
>     (_req, body, done) => done(null, body),
>   )
>
>   // POST /api/v1/webhooks/tiktok
>   // Headers: x-tiktok-signature, x-tiktok-timestamp, x-tiktok-nonce
>   app.post('/api/v1/webhooks/tiktok', async (request, reply) => {
>     const rawBody = request.body as Buffer
>     const appSecret = process.env.TIKTOK_APP_SECRET ?? ''
>     const signature = request.headers['x-tiktok-signature'] as string
>     const timestamp = request.headers['x-tiktok-timestamp'] as string
>     const nonce = request.headers['x-tiktok-nonce'] as string
>
>     if (!verifyTikTokWebhookSignature(appSecret, signature, timestamp, nonce, rawBody)) {
>       return reply.code(401).send({ error: 'invalid signature' })
>     }
>
>     const payload = JSON.parse(rawBody.toString('utf8')) as {
>       type: string
>       data: unknown
>       shop_id?: string
>     }
>
>     app.log.info({ type: payload.type, shopId: payload.shop_id }, 'tiktok webhook received')
>     // Phase 2 Sprint 2：记录 + 触发对应 handler
>     // ORDER_STATUS_CHANGE / LIVE_ORDER 分别路由到各 handler
>
>     return reply.code(200).send({ ok: true })
>   })
> }
> ```
>
> **测试用例名字（逐条实现）：**
> - `POST /webhooks/tiktok returns 401 when signature is invalid`
> - `POST /webhooks/tiktok returns 200 for ORDER_STATUS_CHANGE with valid signature`
> - `POST /webhooks/tiktok returns 200 for LIVE_ORDER event type`
>
> **产出：** TikTok Webhook 接收 + 签名验证 + 分发骨架

---

> **🃏 CARD-D11-05 · harness-factory 补充 TikTok 分支 + 路由注册**
>
> **类型：** 代码变更  \
> **耗时：** 20 min  \
> **目标文件：** `apps/api/src/lib/harness-factory.ts`、`apps/api/src/server.ts`
>
> **harness-factory 补充 TikTok 分支：**
> ```typescript
> case 'tiktok': {
>   const meta = credential.metadata as { appKey: string; shopId?: string } | null
>   if (!meta?.appKey) throw new Error('TikTok metadata (appKey) is required')
>   return new TikTokHarness(tenantId, {
>     appKey: meta.appKey,
>     appSecret: token,   // appSecret 存于 accessToken 字段加密
>     accessToken: token,
>     shopId: meta.shopId,
>   })
> }
> ```
>
> **路由注册（server.ts 追加）：**
> ```typescript
> import { tikTokOAuthRoutes } from './routes/tiktok/oauth.js'
> import { tikTokWebhookRoute } from './routes/tiktok/webhook.js'
> app.register(tikTokOAuthRoutes, { prefix: '/api/v1/tiktok' })
> app.register(tikTokWebhookRoute)
> ```
>
> **产出：** TikTok 完整接入链路（factory + 路由）

---

> **🃏 CARD-D11-06 · Day11 回归与验收门禁**
>
> **类型：** 验证  \
> **耗时：** 30 min  \
> **依赖：** CARD-D11-01 ~ D11-05
>
> ```bash
> pnpm --filter @patioer/harness typecheck
> pnpm --filter @patioer/harness test
> pnpm --filter @patioer/api typecheck
> pnpm --filter @patioer/api test
> pnpm typecheck && pnpm lint && pnpm test
> ```
>
> **Day11 验收清单：**
> - [ ] `getOrdersPage/getOrders` 已完成并返回标准 `Order`
> - [ ] `replyToMessage` 已接通 customer_service 端点
> - [ ] TikTok OAuth `auth` + `callback` 路由已实现，7 个测试通过
> - [ ] TikTok Webhook 签名验证 + 3 个测试通过
> - [ ] harness-factory 包含 TikTok 分支
> - [ ] 路由已注册到 server.ts
> - [ ] 全仓 `typecheck/lint/test` 全绿
>
> **产出：** Day11 可合并状态（TikTokHarness 完整 + OAuth + Webhook）

---

**Day 11 卡片执行顺序汇总：**

```
09:00  CARD-D11-01  getOrdersPage/getOrders          (1h)
10:10  CARD-D11-02  replyToMessage/getOpenThreads    (30min)
10:45  CARD-D11-03  TikTok OAuth 路由                 (1.5h)
13:30  CARD-D11-04  TikTok Webhook 路由               (45min)
14:20  CARD-D11-05  factory + 路由注册                (20min)
14:50  CARD-D11-06  回归验证与验收门禁                 (30min)
```

---

##### Day 12 — ShopeeHarness 骨架 + 多市场签名

---

> **🃏 CARD-D12-01 · Shopee 内部类型定义**
>
> **类型：** 新建文件  \
> **耗时：** 20 min  \
> **目标文件：** `packages/harness/src/shopee.types.ts`
>
> **类型模板（可直接复制）：**
>
> ```typescript
> export type ShopeeMarket = 'SG' | 'MY' | 'TH' | 'PH' | 'ID' | 'VN'
>
> export const SHOPEE_MARKET_ENDPOINTS: Record<ShopeeMarket, string> = {
>   SG: 'https://partner.shopeemobile.com',
>   MY: 'https://partner.shopeemobile.com',
>   TH: 'https://partner.shopeemobile.com',
>   PH: 'https://partner.shopeemobile.com',
>   ID: 'https://partner.shopeemobile.com',
>   VN: 'https://partner.shopeemobile.com',
> }
>
> export const SHOPEE_SANDBOX_ENDPOINT = 'https://partner.test-stable.shopeemobile.com'
>
> export interface ShopeeCredentials {
>   partnerId: number
>   partnerKey: string
>   accessToken: string
>   shopId: number
>   market: ShopeeMarket
>   sandbox?: boolean
> }
>
> export interface ShopeeItem {
>   item_id: number
>   item_name: string
>   price_info: Array<{ current_price: number; currency: string }>
>   stock_info_v2?: { summary_info?: { total_available_stock: number } }
> }
>
> export interface ShopeeOrder {
>   order_sn: string
>   order_status: string
>   total_amount: number
>   currency: string
>   create_time: number
> }
>
> export interface ShopeeApiResponse<T> {
>   error: string
>   message: string
>   response?: T
>   request_id?: string
> }
> ```
>
> **产出：** ShopeeHarness 实现前置类型资产

---

> **🃏 CARD-D12-02 · Shopee 多市场签名工具函数**
>
> **类型：** 代码变更  \
> **耗时：** 1h  \
> **目标文件：** `packages/harness/src/shopee.harness.ts`（仅签名部分）
>
> **函数签名模板（可直接复制）：**
>
> ```typescript
> import crypto from 'node:crypto'
>
> /**
>  * Shopee Open Platform 签名算法：
>  * sign = HMAC-SHA256(partnerKey, partnerId + path + timestamp + accessToken + shopId)
>  */
> function buildShopeeSign(
>   partnerKey: string,
>   partnerId: number,
>   path: string,
>   timestamp: number,
>   accessToken: string,
>   shopId: number,
> ): string {
>   const base = `${partnerId}${path}${timestamp}${accessToken}${shopId}`
>   return crypto.createHmac('sha256', partnerKey).update(base).digest('hex')
> }
>
> function buildShopeeQuery(
>   credentials: ShopeeCredentials,
>   path: string,
>   extra: Record<string, string | number> = {},
> ): Record<string, string> {
>   const timestamp = Math.floor(Date.now() / 1000)
>   const sign = buildShopeeSign(
>     credentials.partnerKey,
>     credentials.partnerId,
>     path,
>     timestamp,
>     credentials.accessToken,
>     credentials.shopId,
>   )
>   return {
>     partner_id: String(credentials.partnerId),
>     shop_id: String(credentials.shopId),
>     timestamp: String(timestamp),
>     access_token: credentials.accessToken,
>     sign,
>     ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, String(v)])),
>   }
> }
> ```
>
> **测试文件：** `packages/harness/src/shopee.harness.test.ts`
>
> **测试用例名字（逐条实现）：**
> - `buildShopeeSign produces deterministic HMAC-SHA256 for given inputs`
> - `buildShopeeSign concatenates fields in correct order`
> - `buildShopeeQuery includes partner_id, shop_id, timestamp, sign`
> - `buildShopeeQuery accepts extra query parameters`
>
> **产出：** Shopee 多市场签名算法封装

---

> **🃏 CARD-D12-03 · `ShopeeHarness` 骨架（构造 + shopeeFetch）**
>
> **类型：** 代码变更  \
> **耗时：** 1.5h  \
> **目标文件：** `packages/harness/src/shopee.harness.ts`
>
> **函数签名模板（可直接复制）：**
>
> ```typescript
> import type { TenantHarness } from './base.harness.js'
> import { HarnessError } from './harness-error.js'
> import type { Product, Order, Thread, Analytics, DateRange, PaginationOpts } from './types.js'
> import type {
>   ShopeeCredentials, ShopeeMarket, ShopeeApiResponse,
>   ShopeeItem, ShopeeOrder,
> } from './shopee.types.js'
> import { SHOPEE_MARKET_ENDPOINTS, SHOPEE_SANDBOX_ENDPOINT } from './shopee.types.js'
>
> const MAX_RETRIES = 3
> const BASE_DELAY_MS = 500
>
> async function sleep(ms: number): Promise<void> {
>   return new Promise((resolve) => setTimeout(resolve, ms))
> }
>
> export class ShopeeHarness implements TenantHarness {
>   readonly platformId = 'shopee'
>   private readonly baseUrl: string
>
>   constructor(
>     readonly tenantId: string,
>     private readonly credentials: ShopeeCredentials,
>   ) {
>     this.baseUrl = credentials.sandbox
>       ? SHOPEE_SANDBOX_ENDPOINT
>       : SHOPEE_MARKET_ENDPOINTS[credentials.market]
>   }
>
>   private async shopeeFetch<T>(
>     path: string,
>     opts: {
>       method?: 'GET' | 'POST'
>       extra?: Record<string, string | number>
>       body?: unknown
>     } = {},
>   ): Promise<T> {
>     const method = opts.method ?? 'GET'
>     const query = buildShopeeQuery(this.credentials, path, opts.extra)
>     const url = new URL(path, this.baseUrl)
>     for (const [k, v] of Object.entries(query)) {
>       url.searchParams.set(k, v)
>     }
>
>     for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
>       const res = await fetch(url.toString(), {
>         method,
>         headers: { 'Content-Type': 'application/json' },
>         body: opts.body ? JSON.stringify(opts.body) : undefined,
>         signal: AbortSignal.timeout(15_000),
>       })
>
>       if (!res.ok) {
>         if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
>           await sleep(BASE_DELAY_MS * 2 ** attempt)
>           continue
>         }
>         throw new HarnessError('shopee', String(res.status), `Shopee API error ${res.status}`)
>       }
>
>       const json = (await res.json()) as ShopeeApiResponse<T>
>       if (json.error && json.error !== '') {
>         throw new HarnessError('shopee', json.error, json.message)
>       }
>       return json.response as T
>     }
>
>     throw new HarnessError('shopee', 'max_retries', 'Shopee API max retries exceeded')
>   }
>
>   async getProducts(_opts?: PaginationOpts): Promise<Product[]> {
>     throw new HarnessError('shopee', 'not_implemented', 'Day13 implementation')
>   }
>   async updatePrice(_productId: string, _price: number): Promise<void> {
>     throw new HarnessError('shopee', 'not_implemented', 'Day13 implementation')
>   }
>   async updateInventory(_productId: string, _qty: number): Promise<void> {
>     throw new HarnessError('shopee', 'not_implemented', 'Day13 implementation')
>   }
>   async getOrders(_opts?: PaginationOpts): Promise<Order[]> {
>     throw new HarnessError('shopee', 'not_implemented', 'Day13 implementation')
>   }
>   async replyToMessage(_threadId: string, _body: string): Promise<void> {
>     throw new HarnessError('shopee', 'not_implemented', 'Day13 implementation')
>   }
>   async getOpenThreads(): Promise<Thread[]> { return [] }
>   async getAnalytics(_range: DateRange): Promise<Analytics> {
>     return { revenue: 0, orders: 0, truncated: true }
>   }
> }
> ```
>
> **测试用例名字（逐条实现）：**
> - `ShopeeHarness uses sandbox endpoint when sandbox=true`
> - `ShopeeHarness uses market endpoint from SHOPEE_MARKET_ENDPOINTS`
> - `shopeeFetch appends signed query parameters to URL`
> - `shopeeFetch throws HarnessError when Shopee error field is non-empty`
> - `shopeeFetch retries on 429 with exponential backoff`
>
> **产出：** ShopeeHarness 骨架落地，Day13 可直接补充方法实现

---

> **🃏 CARD-D12-04 · `index.ts` 预留 Shopee 导出 + factory 占位**
>
> **类型：** 代码变更  \
> **耗时：** 15 min
>
> ```typescript
> // packages/harness/src/index.ts 追加
> export * from './shopee.types.js'
> export * from './shopee.harness.js'
> ```
>
> ```typescript
> // harness-factory.ts switch 追加占位
> case 'shopee':
>   throw new Error('Shopee harness: implementation in progress (Day14)')
> ```
>
> **产出：** 导出路径预留

---

> **🃏 CARD-D12-05 · Day12 回归与检查点**
>
> **类型：** 验证  \
> **耗时：** 20 min
>
> ```bash
> pnpm --filter @patioer/harness typecheck
> pnpm --filter @patioer/harness test
> pnpm typecheck && pnpm lint
> ```
>
> **Day12 验收清单：**
> - [ ] `shopee.types.ts` 类型定义完整
> - [ ] `buildShopeeSign` 签名算法 4 个测试通过
> - [ ] `ShopeeHarness` 骨架可编译，`shopeeFetch` 5 个测试通过
> - [ ] `index.ts` 已导出 Shopee 类型与类
> - [ ] 全仓 `typecheck/lint` 通过
>
> **产出：** Day12 可合并状态

---

**Day 12 卡片执行顺序汇总：**

```
09:00  CARD-D12-01  shopee.types.ts 类型定义           (20min)
09:20  CARD-D12-02  多市场签名工具函数                  (1h)
10:20  CARD-D12-03  ShopeeHarness 骨架 + shopeeFetch   (1.5h)
12:00  CARD-D12-04  index.ts 导出 + factory 占位        (15min)
13:30  CARD-D12-05  回归验证与检查点                    (20min)
```

---

##### Day 13 — ShopeeHarness 核心方法 + 多市场适配

---

> **🃏 CARD-D13-01 · `getItemList/getProducts`（商品列表 API）**
>
> **类型：** 代码变更  \
> **耗时：** 1h  \
> **目标文件：** `packages/harness/src/shopee.harness.ts`
>
> **函数签名模板（可直接复制）：**
>
> ```typescript
> interface ShopeeItemListResponse {
>   item?: Array<{ item_id: number; item_status: string }>
>   total_count?: number
>   has_next_page?: boolean
>   next_offset?: number
> }
>
> interface ShopeeItemDetailResponse {
>   item_list?: ShopeeItem[]
> }
>
> function normalizeShopeeItem(item: ShopeeItem): Product {
>   const price = item.price_info?.[0]?.current_price ?? 0
>   const currency = item.price_info?.[0]?.currency ?? 'SGD'
>   const inventory = item.stock_info_v2?.summary_info?.total_available_stock ?? 0
>   return {
>     id: String(item.item_id),
>     title: item.item_name,
>     price,
>     inventory,
>     currency,
>     platform: 'shopee',
>   }
> }
>
> async getProductsPage(
>   opts?: PaginationOpts,
> ): Promise<{ items: Product[]; nextCursor?: string }> {
>   // Step 1: 获取商品 ID 列表
>   const listData = await this.shopeeFetch<ShopeeItemListResponse>('/api/v2/product/get_item_list', {
>     extra: {
>       offset: opts?.cursor ? Number(opts.cursor) : 0,
>       page_size: opts?.limit ?? 20,
>       item_status: 'NORMAL',
>     },
>   })
>
>   const itemIds = (listData.item ?? []).map((i) => i.item_id)
>   if (itemIds.length === 0) return { items: [] }
>
>   // Step 2: 批量获取详情
>   const detailData = await this.shopeeFetch<ShopeeItemDetailResponse>(
>     '/api/v2/product/get_item_base_info',
>     { extra: { item_id_list: itemIds.join(',') } },
>   )
>
>   const items = (detailData.item_list ?? []).map(normalizeShopeeItem)
>   const nextCursor = listData.has_next_page
>     ? String((opts?.cursor ? Number(opts.cursor) : 0) + itemIds.length)
>     : undefined
>
>   return { items, nextCursor }
> }
>
> async getProducts(opts?: PaginationOpts): Promise<Product[]> {
>   const page = await this.getProductsPage(opts)
>   return page.items
> }
> ```
>
> **测试用例名字（逐条实现）：**
> - `getProducts maps Shopee item list to Product domain model`
> - `getProducts returns empty array when item list is empty`
> - `getProducts uses price_info and stock_info_v2 for normalization`
> - `getProductsPage returns nextCursor when has_next_page is true`
> - `getProductsPage returns undefined nextCursor when no more pages`
>
> **产出：** Shopee 商品读取链路（两步 API 调用）完成

---

> **🃏 CARD-D13-02 · `updatePrice`（Update Price API）**
>
> **类型：** 代码变更  \
> **耗时：** 45 min  \
> **目标文件：** `packages/harness/src/shopee.harness.ts`
>
> ```typescript
> async updatePrice(productId: string, price: number): Promise<void> {
>   await this.shopeeFetch('/api/v2/product/update_price', {
>     method: 'POST',
>     body: {
>       item_id: Number(productId),
>       price_list: [
>         {
>           model_id: 0,
>           original_price: price,
>         },
>       ],
>     },
>   })
> }
> ```
>
> **测试用例名字（逐条实现）：**
> - `updatePrice sends POST with item_id and original_price`
> - `updatePrice converts productId string to number`
> - `updatePrice throws HarnessError when Shopee returns error`
>
> **产出：** Shopee 价格更新链路完成

---

> **🃏 CARD-D13-03 · `getOrders`（Orders API）**
>
> **类型：** 代码变更  \
> **耗时：** 1h  \
> **目标文件：** `packages/harness/src/shopee.harness.ts`
>
> ```typescript
> interface ShopeeOrderListResponse {
>   order_list?: ShopeeOrder[]
>   more?: boolean
>   next_cursor?: string
> }
>
> function normalizeShopeeOrder(o: ShopeeOrder): Order {
>   return {
>     id: o.order_sn,
>     status: o.order_status,
>     totalPrice: o.total_amount,
>   }
> }
>
> async getOrdersPage(
>   opts?: PaginationOpts,
> ): Promise<{ items: Order[]; nextCursor?: string }> {
>   const now = Math.floor(Date.now() / 1000)
>   const data = await this.shopeeFetch<ShopeeOrderListResponse>(
>     '/api/v2/order/get_order_list',
>     {
>       extra: {
>         time_range_field: 'create_time',
>         time_from: now - 30 * 24 * 60 * 60,
>         time_to: now,
>         page_size: opts?.limit ?? 50,
>         ...(opts?.cursor ? { cursor: opts.cursor } : {}),
>       },
>     },
>   )
>   const items = (data.order_list ?? []).map(normalizeShopeeOrder)
>   return { items, nextCursor: data.next_cursor }
> }
>
> async getOrders(opts?: PaginationOpts): Promise<Order[]> {
>   const page = await this.getOrdersPage(opts)
>   return page.items
> }
> ```
>
> **测试用例名字（逐条实现）：**
> - `getOrders maps Shopee order list to Order domain model`
> - `getOrdersPage returns nextCursor from next_cursor field`
> - `getOrders returns empty array when order_list missing`
>
> **产出：** Shopee 订单读取链路完成

---

> **🃏 CARD-D13-04 · `updateInventory` + `replyToMessage` + `getAnalytics`**
>
> **类型：** 代码变更  \
> **耗时：** 45 min  \
> **目标文件：** `packages/harness/src/shopee.harness.ts`
>
> ```typescript
> async updateInventory(productId: string, qty: number): Promise<void> {
>   await this.shopeeFetch('/api/v2/product/update_stock', {
>     method: 'POST',
>     body: {
>       item_id: Number(productId),
>       stock_list: [{ model_id: 0, normal_stock: qty }],
>     },
>   })
> }
>
> async replyToMessage(threadId: string, body: string): Promise<void> {
>   await this.shopeeFetch('/api/v2/sellerchat/send_message', {
>     method: 'POST',
>     body: {
>       toId: threadId,
>       message_type: 'text',
>       content: { text: body },
>     },
>   })
> }
>
> async getAnalytics(range: DateRange): Promise<Analytics> {
>   const orders = await this.getOrders({ limit: 100 })
>   const revenue = orders.reduce((sum, o) => sum + o.totalPrice, 0)
>   return { revenue, orders: orders.length, truncated: orders.length >= 100 }
> }
> ```
>
> **测试用例名字（逐条实现）：**
> - `updateInventory sends POST with item_id and normal_stock`
> - `replyToMessage sends POST to sellerchat endpoint with text`
> - `getAnalytics aggregates revenue and sets truncated correctly`
>
> **产出：** Shopee 库存 + 消息 + 分析全部实现

---

> **🃏 CARD-D13-05 · 多市场适配验证（SG / MY sandbox 冒烟）**
>
> **类型：** 验证  \
> **耗时：** 30 min
>
> **验证步骤：**
> ```bash
> # 手动创建两个 ShopeeHarness 实例，分别使用 SG 和 MY 市场配置
> # 确认 baseUrl 映射正确
> # sandbox=true 时使用 test-stable 域名
> ```
>
> **测试用例名字（追加）：**
> - `ShopeeHarness SG market uses correct endpoint`
> - `ShopeeHarness MY market uses correct endpoint`
> - `ShopeeHarness sandbox=true uses test-stable endpoint`
>
> **产出：** 多市场端点映射经过单元测试覆盖

---

> **🃏 CARD-D13-06 · Day13 回归与验收门禁**
>
> **类型：** 验证  \
> **耗时：** 30 min  \
> **依赖：** CARD-D13-01 ~ D13-05
>
> ```bash
> pnpm --filter @patioer/harness typecheck
> pnpm --filter @patioer/harness test
> pnpm typecheck && pnpm lint && pnpm test
> ```
>
> **Day13 验收清单：**
> - [ ] `getProductsPage/getProducts` 两步 API 调用完成
> - [ ] `updatePrice` POST payload 正确
> - [ ] `getOrdersPage/getOrders` 链路完成
> - [ ] `updateInventory` / `replyToMessage` / `getAnalytics` 实现
> - [ ] SG / MY / sandbox 端点映射测试通过
> - [ ] 全仓 `typecheck/lint/test` 全绿
>
> **产出：** Day13 可合并状态（ShopeeHarness 核心方法全部实现）

---

**Day 13 卡片执行顺序汇总：**

```
09:00  CARD-D13-01  getProductsPage/getProducts（两步）  (1h)
10:10  CARD-D13-02  updatePrice POST                     (45min)
11:00  CARD-D13-03  getOrdersPage/getOrders              (1h)
13:30  CARD-D13-04  updateInventory/replyToMessage/getAnalytics  (45min)
14:20  CARD-D13-05  多市场适配验证                       (30min)
15:00  CARD-D13-06  回归验证与验收门禁                   (30min)
```

---

##### Day 14 — Shopee OAuth + Webhook + DG-01/DG-03 回收

---

> **🃏 CARD-D14-01 · Shopee OAuth 路由（`routes/shopee/oauth.ts`）**
>
> **类型：** 新建文件  \
> **耗时：** 1.5h  \
> **目标文件：** `apps/api/src/routes/shopee/oauth.ts`
>
> **函数签名模板（可直接复制）：**
>
> ```typescript
> import type { FastifyPluginAsync } from 'fastify'
> import crypto from 'node:crypto'
> import { withTenantDb, schema } from '@patioer/db'
> import { encryptToken } from '../../lib/crypto.js'
>
> // Shopee OAuth 采用 code flow，注意：
> //   1. 签名：HMAC-SHA256(partnerKey, partnerId + '/api/v2/shop/auth_partner' + timestamp)
> //   2. 不同市场用同一套 partner 凭证，shop 授权后获得 shopId + accessToken
>
> const SHOPEE_AUTH_URL = 'https://partner.test-stable.shopeemobile.com/api/v2/shop/auth_partner'
> const SHOPEE_TOKEN_URL = 'https://partner.test-stable.shopeemobile.com/api/v2/auth/token/get'
>
> function buildShopeeAuthSign(partnerKey: string, partnerId: number, path: string, timestamp: number): string {
>   return crypto
>     .createHmac('sha256', partnerKey)
>     .update(`${partnerId}${path}${timestamp}`)
>     .digest('hex')
> }
>
> export const shopeeOAuthRoutes: FastifyPluginAsync = async (app) => {
>   app.get('/auth', async (request, reply) => {
>     const { tenantId, market } = request.query as Record<string, string>
>     if (!tenantId) return reply.code(400).send({ error: 'tenantId required' })
>     if (!market) return reply.code(400).send({ error: 'market required (SG/MY/TH/PH/ID/VN)' })
>
>     const partnerId = Number(process.env.SHOPEE_PARTNER_ID ?? 0)
>     const partnerKey = process.env.SHOPEE_PARTNER_KEY ?? ''
>     const timestamp = Math.floor(Date.now() / 1000)
>     const path = '/api/v2/shop/auth_partner'
>     const sign = buildShopeeAuthSign(partnerKey, partnerId, path, timestamp)
>
>     const redirectUrl = `${process.env.APP_BASE_URL}/api/v1/shopee/auth/callback`
>     const state = Buffer.from(JSON.stringify({ tenantId, market })).toString('base64url')
>     const url = new URL(SHOPEE_AUTH_URL)
>     url.searchParams.set('partner_id', String(partnerId))
>     url.searchParams.set('timestamp', String(timestamp))
>     url.searchParams.set('sign', sign)
>     url.searchParams.set('redirect', redirectUrl)
>     url.searchParams.set('state', state)
>
>     return reply.redirect(url.toString())
>   })
>
>   app.get('/auth/callback', async (request, reply) => {
>     const { code, shop_id, state } = request.query as Record<string, string>
>     if (!code || !shop_id || !state) return reply.code(400).send({ error: 'code, shop_id and state required' })
>
>     let tenantId: string
>     let market: string
>     try {
>       const decoded = JSON.parse(Buffer.from(state, 'base64url').toString()) as Record<string, string>
>       tenantId = decoded.tenantId
>       market = decoded.market
>     } catch {
>       return reply.code(400).send({ error: 'invalid state' })
>     }
>
>     const partnerId = Number(process.env.SHOPEE_PARTNER_ID ?? 0)
>     const partnerKey = process.env.SHOPEE_PARTNER_KEY ?? ''
>
>     const tokenRes = await fetch(SHOPEE_TOKEN_URL, {
>       method: 'POST',
>       headers: { 'Content-Type': 'application/json' },
>       body: JSON.stringify({ code, shop_id: Number(shop_id), partner_id: partnerId }),
>     })
>     if (!tokenRes.ok) return reply.code(502).send({ error: 'token exchange failed' })
>
>     const tokenData = (await tokenRes.json()) as {
>       access_token?: string
>       refresh_token?: string
>     }
>     if (!tokenData.access_token) return reply.code(502).send({ error: 'no access_token' })
>
>     const encKey = process.env.CRED_ENCRYPTION_KEY!
>     const encryptedToken = encryptToken(tokenData.access_token, encKey)
>
>     await withTenantDb(tenantId, async (db) => {
>       await db
>         .insert(schema.platformCredentials)
>         .values({
>           tenantId,
>           platform: 'shopee',
>           credentialType: 'hmac',
>           accessToken: encryptedToken,
>           region: market,
>           metadata: { partnerId, shopId: Number(shop_id) },
>         })
>         .onConflictDoUpdate({
>           target: [
>             schema.platformCredentials.tenantId,
>             schema.platformCredentials.platform,
>             schema.platformCredentials.region,
>           ],
>           set: { accessToken: encryptedToken, metadata: { partnerId, shopId: Number(shop_id) } },
>         })
>     })
>
>     return reply.send({ ok: true, shopId: shop_id, market })
>   })
> }
> ```
>
> **测试用例名字（逐条实现）：**
> - `GET /auth returns 400 when tenantId is missing`
> - `GET /auth returns 400 when market is missing`
> - `GET /auth redirects to Shopee auth URL with signed params`
> - `GET /auth/callback returns 400 when required params missing`
> - `GET /auth/callback returns 400 when state is invalid`
> - `GET /auth/callback returns 502 when token exchange fails`
> - `GET /auth/callback persists encrypted token with region=market`
>
> **产出：** Shopee OAuth 多市场授权流程

---

> **🃏 CARD-D14-02 · Shopee Webhook 路由（`routes/shopee/webhook.ts`）**
>
> **类型：** 新建文件  \
> **耗时：** 30 min  \
> **目标文件：** `apps/api/src/routes/shopee/webhook.ts`
>
> ```typescript
> import type { FastifyPluginAsync } from 'fastify'
> import crypto from 'node:crypto'
>
> // Shopee Webhook 签名验证：
> // HMAC-SHA256(partnerKey, partnerId + url + body)
> function verifyShopeeWebhookSignature(
>   partnerKey: string,
>   partnerId: number,
>   url: string,
>   rawBody: Buffer,
> ): string {
>   const base = `${partnerId}${url}${rawBody.toString('utf8')}`
>   return crypto.createHmac('sha256', partnerKey).update(base).digest('hex')
> }
>
> export const shopeeWebhookRoute: FastifyPluginAsync = async (app) => {
>   app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body))
>
>   // POST /api/v1/webhooks/shopee
>   app.post('/api/v1/webhooks/shopee', async (request, reply) => {
>     const rawBody = request.body as Buffer
>     const partnerKey = process.env.SHOPEE_PARTNER_KEY ?? ''
>     const partnerId = Number(process.env.SHOPEE_PARTNER_ID ?? 0)
>     const providedSign = request.headers['authorization'] as string
>     const fullUrl = request.url
>
>     const expectedSign = verifyShopeeWebhookSignature(partnerKey, partnerId, fullUrl, rawBody)
>     if (providedSign !== expectedSign) {
>       return reply.code(401).send({ error: 'invalid signature' })
>     }
>
>     const payload = JSON.parse(rawBody.toString('utf8')) as { code: number; data: unknown; shop_id?: number }
>     app.log.info({ eventCode: payload.code, shopId: payload.shop_id }, 'shopee webhook received')
>
>     return reply.code(200).send({ ok: true })
>   })
> }
> ```
>
> **测试用例名字（逐条实现）：**
> - `POST /webhooks/shopee returns 401 when signature is invalid`
> - `POST /webhooks/shopee returns 200 for order event with valid signature`
>
> **产出：** Shopee Webhook 接收 + 签名验证

---

> **🃏 CARD-D14-03 · harness-factory 补充 Shopee 分支 + 路由注册**
>
> **类型：** 代码变更  \
> **耗时：** 20 min
>
> **harness-factory.ts 补充 Shopee 分支：**
> ```typescript
> case 'shopee': {
>   const meta = credential.metadata as {
>     partnerId: number
>     shopId: number
>   } | null
>   if (!meta?.partnerId || !meta?.shopId) {
>     throw new Error('Shopee metadata (partnerId, shopId) is required')
>   }
>   const region = (credential.region ?? 'SG') as ShopeeMarket
>   return new ShopeeHarness(tenantId, {
>     partnerId: meta.partnerId,
>     partnerKey: token,
>     accessToken: token,
>     shopId: meta.shopId,
>     market: region,
>   })
> }
> ```
>
> **路由注册（server.ts 追加）：**
> ```typescript
> import { shopeeOAuthRoutes } from './routes/shopee/oauth.js'
> import { shopeeWebhookRoute } from './routes/shopee/webhook.js'
> app.register(shopeeOAuthRoutes, { prefix: '/api/v1/shopee' })
> app.register(shopeeWebhookRoute)
> ```
>
> **额外测试（harness-factory.test.ts 追加）：**
> - `createHarness creates ShopeeHarness with partnerId and shopId from metadata`
> - `createHarness throws when shopee metadata is missing partnerId`
>
> **产出：** Shopee 完整接入链路（factory + 路由）

---

> **🃏 CARD-D14-04 · DG-03 回收：`PaperclipBridge.createIssue()` 完整实现**
>
> **类型：** 代码变更  \
> **耗时：** 1h  \
> **目标文件：** `apps/api/src/lib/paperclip-bridge.ts`
>
> **背景：** Phase 1 中 `createIssue()` 是 stub（打 log 但不实际创建），现在补全。
>
> **函数签名模板（可直接复制）：**
>
> ```typescript
> interface PaperclipIssuePayload {
>   title: string
>   description?: string
>   priority?: 'low' | 'medium' | 'high'
>   agentId?: string
>   context?: Record<string, unknown>
> }
>
> interface PaperclipIssueResult {
>   issueId: string
>   url: string
>   status: string
> }
>
> async createIssue(payload: PaperclipIssuePayload): Promise<PaperclipIssueResult> {
>   const res = await fetch(`${this.baseUrl}/api/issues`, {
>     method: 'POST',
>     headers: {
>       'Content-Type': 'application/json',
>       'x-api-key': this.apiKey,
>     },
>     body: JSON.stringify({
>       title: payload.title,
>       description: payload.description ?? '',
>       priority: payload.priority ?? 'medium',
>       metadata: {
>         agentId: payload.agentId,
>         ...payload.context,
>       },
>     }),
>   })
>
>   if (!res.ok) {
>     throw new Error(`Paperclip createIssue failed: ${res.status} ${await res.text()}`)
>   }
>
>   const data = (await res.json()) as { id: string; url: string; status: string }
>   return { issueId: data.id, url: data.url, status: data.status }
> }
> ```
>
> **测试用例名字（逐条实现）：**
> - `createIssue sends POST to /api/issues with title and description`
> - `createIssue uses default priority medium when not specified`
> - `createIssue returns issueId and url from response`
> - `createIssue throws when Paperclip API returns non-2xx`
>
> **产出：** DG-03 正式回收 ✅

---

> **🃏 CARD-D14-05 · DG-01 回收：Support Relay Shopify Inbox 对接评估**
>
> **类型：** 评估 + 条件实现  \
> **耗时：** 30 min
>
> **判断逻辑：**
>
> ```bash
> # 检查 Shopify Inbox API 权限申请状态
> # 方式：访问 Shopify Partners → App → API Access → Inbox API
> ```
>
> **若权限已获批（实现路径）：**
> - `ShopifyHarness.getOpenThreads()` 调用 `/api/v2024-01/graphql` Inbox Conversation API
> - `ShopifyHarness.replyToMessage()` 发送 InboxMessage mutation
> - 相关测试用例补充到 `shopify.harness.test.ts`
>
> **若权限未获批（降级路径）：**
> ```typescript
> // ShopifyHarness.getOpenThreads() 保持返回 []，添加 warning log
> app.log.warn('Shopify Inbox API permission not granted; getOpenThreads returns empty. Revisit in Phase 3.')
> ```
>
> **测试用例名字（无论哪条路径均需补充）：**
> - `Support Relay handles empty thread list gracefully`
>
> **产出：** DG-01 状态明确记录（回收 ✅ 或 推迟至 Phase 3 ⏳）

---

> **🃏 CARD-D14-06 · Day14 回归与验收门禁**
>
> **类型：** 验证  \
> **耗时：** 30 min  \
> **依赖：** CARD-D14-01 ~ D14-05
>
> ```bash
> pnpm --filter @patioer/harness typecheck
> pnpm --filter @patioer/harness test
> pnpm --filter @patioer/api typecheck
> pnpm --filter @patioer/api test
> pnpm typecheck && pnpm lint && pnpm test
> ```
>
> **Day14 验收清单：**
> - [ ] Shopee OAuth `auth` + `callback` 路由已实现，7 个测试通过
> - [ ] Shopee Webhook 签名验证，2 个测试通过
> - [ ] harness-factory 包含 Shopee 分支，2 个新测试通过
> - [ ] `PaperclipBridge.createIssue()` 真实实现，4 个测试通过（DG-03 ✅）
> - [ ] DG-01 状态已明确记录
> - [ ] 全仓 `typecheck/lint/test` 全绿
>
> **产出：** Day14 可合并状态（Shopee 完整接入 + 遗留项回收）

---

**Day 14 卡片执行顺序汇总：**

```
09:00  CARD-D14-01  Shopee OAuth 路由                  (1.5h)
10:40  CARD-D14-02  Shopee Webhook 路由                (30min)
11:15  CARD-D14-03  factory Shopee 分支 + 路由注册     (20min)
13:30  CARD-D14-04  DG-03 createIssue() 完整实现       (1h)
14:40  CARD-D14-05  DG-01 Shopify Inbox 评估           (30min)
15:20  CARD-D14-06  回归验证与验收门禁                  (30min)
```

---

##### Day 15 — 三平台测试套件整合

---

> **🃏 CARD-D15-01 · `tiktok.harness.test.ts` 完整测试套件**
>
> **类型：** 测试整理  \
> **耗时：** 1.5h  \
> **目标文件：** `packages/harness/src/tiktok.harness.test.ts`
>
> **测试结构模板（可直接复制）：**
>
> ```typescript
> import { describe, it, expect, vi, beforeEach } from 'vitest'
> import { TikTokHarness } from './tiktok.harness.js'
>
> const mockCredentials = {
>   appKey: 'test-app-key',
>   appSecret: 'test-app-secret-32bytes-padding!!',
>   accessToken: 'test-access-token',
>   shopId: 'test-shop-id',
> }
>
> describe('TikTokHarness signing', () => {
>   // CARD-D9-02 的签名测试
> })
>
> describe('TikTokHarness tikTokFetch', () => {
>   // CARD-D9-03 的 fetch 行为测试
> })
>
> describe('TikTokHarness getProducts', () => {
>   // CARD-D10-01 的商品测试
> })
>
> describe('TikTokHarness updatePrice', () => {
>   // CARD-D10-02 的价格测试
> })
>
> describe('TikTokHarness updateInventory', () => {
>   // CARD-D10-03 的库存测试
> })
>
> describe('TikTokHarness getOrders', () => {
>   // CARD-D11-01 的订单测试
> })
>
> describe('TikTokHarness messaging', () => {
>   // CARD-D11-02 的消息测试
> })
>
> describe('TikTokHarness getAnalytics', () => {
>   // CARD-D10-04 的分析测试
> })
>
> describe('TikTokHarness regression', () => {
>   it('all core methods work independently after full implementation', async () => {
>     // 确认 Day9-11 所有方法协同正常
>   })
> })
> ```
>
> **需覆盖的全量测试用例（共 ~20 个）：**
>
> | 分组 | 测试用例 |
> |------|---------|
> | signing | `buildTikTokSign` × 4 |
> | tikTokFetch | 签名 + shop_id + 非零 code + 429 重试 + 超重试 × 5 |
> | getProducts | 映射 + 空列表 + nextCursor + SKU 价格 × 4 |
> | updatePrice | PUT + 格式化 + 错误码 × 3 |
> | updateInventory | POST + sku_id + 错误码 × 3 |
> | getOrders | 映射 + nextCursor + 空列表 + 金额 × 4 |
> | messaging | replyToMessage × 2 + getOpenThreads × 1 |
> | getAnalytics | 聚合 + 空 + truncated × 3 |
>
> **产出：** TikTokHarness 完整测试套件，覆盖率 ≥ 85%

---

> **🃏 CARD-D15-02 · `shopee.harness.test.ts` 完整测试套件**
>
> **类型：** 测试整理  \
> **耗时：** 1.5h  \
> **目标文件：** `packages/harness/src/shopee.harness.test.ts`
>
> **需覆盖的全量测试用例（共 ~22 个）：**
>
> | 分组 | 测试用例 |
> |------|---------|
> | signing | `buildShopeeSign` × 4 |
> | shopeeFetch | 签名参数 + 非空 error + 429 重试 + 超重试 × 4 |
> | endpoint | SG 端点 + MY 端点 + sandbox 端点 × 3 |
> | getProducts | 映射 + 空列表 + nextCursor + price/stock 解析 + 无下一页 × 5 |
> | updatePrice | POST + item_id 转换 + 错误 × 3 |
> | getOrders | 映射 + nextCursor + 空列表 × 3 |
> | updateInventory/messaging/analytics | 各 1-2 个 × 4 |
>
> **产出：** ShopeeHarness 完整测试套件，覆盖率 ≥ 85%

---

> **🃏 CARD-D15-03 · 三平台 Harness 跨平台集成快照测试**
>
> **类型：** 新建文件  \
> **耗时：** 45 min  \
> **目标文件：** `packages/harness/src/harness.registry.test.ts`（如已存在则追加）
>
> **测试目标：** 验证 Amazon / TikTok / Shopee 三个 Harness 均实现了 `TenantHarness` 接口的全部方法，且 `platformId` 各不同。
>
> ```typescript
> describe('TenantHarness interface compliance', () => {
>   const REQUIRED_METHODS = [
>     'getProducts', 'updatePrice', 'updateInventory',
>     'getOrders', 'replyToMessage', 'getOpenThreads', 'getAnalytics',
>   ] as const
>
>   it.each([
>     ['AmazonHarness', AmazonHarness, mockAmazonCreds],
>     ['TikTokHarness', TikTokHarness, mockTikTokCreds],
>     ['ShopeeHarness', ShopeeHarness, mockShopeeCreds],
>   ])('%s implements all TenantHarness methods', (name, HarnessClass, creds) => {
>     const harness = new HarnessClass('tenant-1', creds)
>     for (const method of REQUIRED_METHODS) {
>       expect(typeof harness[method]).toBe('function')
>     }
>   })
>
>   it('each harness has unique platformId', () => {
>     const ids = [
>       new AmazonHarness('t', mockAmazonCreds).platformId,
>       new TikTokHarness('t', mockTikTokCreds).platformId,
>       new ShopeeHarness('t', mockShopeeCreds).platformId,
>     ]
>     expect(new Set(ids).size).toBe(3)
>   })
> })
> ```
>
> **产出：** 三平台 Harness 接口合规性保证

---

> **🃏 CARD-D15-04 · harness-factory 完整测试补充（TikTok + Shopee 分支）**
>
> **类型：** 测试追加  \
> **耗时：** 30 min  \
> **目标文件：** `apps/api/src/lib/harness-factory.test.ts`
>
> **追加测试用例：**
> - `createHarness creates TikTokHarness with appKey from metadata`
> - `createHarness throws when tiktok appKey is missing`
> - `createHarness creates ShopeeHarness with partnerId and shopId from metadata`
> - `createHarness throws when shopee metadata is missing`
>
> **产出：** factory 四平台（Shopify + Amazon + TikTok + Shopee）分支均有测试

---

> **🃏 CARD-D15-05 · 覆盖率检查 + 补缺**
>
> **类型：** 验证  \
> **耗时：** 45 min
>
> ```bash
> pnpm --filter @patioer/harness test:coverage
> pnpm --filter @patioer/api test:coverage
> ```
>
> **目标：**
> - `packages/harness`：覆盖率 ≥ 80%（新平台 Harness 目标 ≥ 85%）
> - `apps/api`：总体覆盖率维持 ≥ 80%
>
> **若覆盖率不达标：** 识别未覆盖分支 → 补 1-2 个边界用例
>
> **产出：** 三平台全量测试通过 + 覆盖率达标

---

> **🃏 CARD-D15-06 · Day15 回归与验收门禁**
>
> **类型：** 验证  \
> **耗时：** 30 min  \
> **依赖：** CARD-D15-01 ~ D15-05
>
> ```bash
> pnpm typecheck
> pnpm lint
> pnpm test
> pnpm --filter @patioer/harness test:coverage
> pnpm --filter @patioer/api test:coverage
> ```
>
> **Day15 验收清单：**
> - [ ] TikTokHarness 完整测试套件 ~20 case 全部通过
> - [ ] ShopeeHarness 完整测试套件 ~22 case 全部通过
> - [ ] 三平台接口合规性快照测试通过
> - [ ] harness-factory TikTok + Shopee 4 个新测试通过
> - [ ] `packages/harness` 覆盖率 ≥ 80%
> - [ ] 全仓 `typecheck/lint/test` 全绿
>
> **产出：** Day15 可合并状态（三平台 Harness 测试完整）

---

**Day 15 卡片执行顺序汇总：**

```
09:00  CARD-D15-01  tiktok.harness.test.ts 完整套件      (1.5h)
10:40  CARD-D15-02  shopee.harness.test.ts 完整套件      (1.5h)
13:30  CARD-D15-03  跨平台接口合规性快照测试              (45min)
14:20  CARD-D15-04  harness-factory TikTok+Shopee 测试   (30min)
15:00  CARD-D15-05  覆盖率检查 + 补缺                    (45min)
16:00  CARD-D15-06  回归验证与验收门禁                    (30min)
```

---

##### Day 16 — Sprint 2 集成冒烟 + 回归测试 + Sprint Review

---

> **🃏 CARD-D16-01 · 三平台集成冒烟测试（手动）**
>
> **类型：** 手动验证  \
> **耗时：** 2h
>
> **执行步骤：**
>
> ```bash
> # 1. 启动全部服务
> docker-compose up -d postgres redis paperclip
> pnpm dev
>
> # 2. TikTok sandbox 冒烟
> # 确认 TikTok sandbox Shop 已申请并激活
> curl -s http://localhost:3100/api/v1/tiktok/auth \
>   -G --data-urlencode "tenantId=<test-tenant>" \
>        --data-urlencode "appKey=<sandbox-app-key>"
> # 期望：重定向到 TikTok 授权页 URL
>
> # 3. Shopee sandbox 冒烟（test-stable 环境）
> curl -s http://localhost:3100/api/v1/shopee/auth \
>   -G --data-urlencode "tenantId=<test-tenant>" \
>        --data-urlencode "market=SG"
> # 期望：重定向到 Shopee 授权页 URL（含正确签名）
>
> # 4. 直接测试 TikTok sandbox getProducts（用种子凭证）
> # （需在 platform_credentials 中插入 sandbox 凭证）
> curl -s http://localhost:3100/api/v1/products \
>   -H "x-tenant-id: <test-tenant>" | jq .
>
> # 5. Webhook 事件模拟测试
> # TikTok ORDER_STATUS_CHANGE
> BODY='{"type":"ORDER_STATUS_CHANGE","data":{"order_id":"test-123"},"shop_id":"test-shop"}'
> SIGN=$(echo -n "test-secret$(date +%s)nonce123${BODY}" | openssl dgst -sha256 -hmac "test-secret" | awk '{print $2}')
> curl -s -X POST http://localhost:3100/api/v1/webhooks/tiktok \
>   -H "Content-Type: application/json" \
>   -H "x-tiktok-signature: $SIGN" \
>   -H "x-tiktok-timestamp: $(date +%s)" \
>   -H "x-tiktok-nonce: nonce123" \
>   -d "$BODY"
> # 期望：200 { ok: true }
>
> # 6. Paperclip createIssue 冒烟
> # 验证 DG-03：Product Scout 触发后 Paperclip Issues 页面出现记录
> ```
>
> **冒烟检查清单：**
>
> | # | 检查项 | 期望结果 |
> |---|--------|---------|
> | 1 | TikTok auth URL 构建正确 | 含 app_key + state 参数 |
> | 2 | Shopee auth URL 构建正确 | 含 partner_id + sign 参数 |
> | 3 | TikTok Webhook 签名验证 | 正确签名 200，错误签名 401 |
> | 4 | Shopee Webhook 签名验证 | 正确签名 200，错误签名 401 |
> | 5 | PaperclipBridge.createIssue() | Paperclip UI 可见 Issue |
> | 6 | 所有已有 Shopify 功能不受影响 | Phase 1 所有功能正常 |
>
> **产出：** 三平台集成路径验证通过

---

> **🃏 CARD-D16-02 · 全量回归测试 + CI 验证**
>
> **类型：** 验证  \
> **耗时：** 1h
>
> ```bash
> # 1. 全量测试
> pnpm test
>
> # 2. 全量类型检查
> pnpm typecheck
>
> # 3. Lint
> pnpm lint
>
> # 4. 覆盖率
> pnpm --filter @patioer/harness test:coverage
> pnpm --filter @patioer/api test:coverage
>
> # 5. 新增代码统计
> git diff origin/main --stat | tail -20
> ```
>
> **关键数字目标：**
>
> | 指标 | 目标 |
> |------|------|
> | 测试通过率 | 100% |
> | harness 覆盖率 | ≥ 80% |
> | api 总体覆盖率 | ≥ 80% |
> | lint 错误 | 0 |
> | TypeScript 错误 | 0 |
>
> **产出：** CI 全绿，可提交 PR

---

> **🃏 CARD-D16-03 · .env.example 更新 + 文档更新**
>
> **类型：** 文档 + 配置  \
> **耗时：** 20 min
>
> **`.env.example` 追加：**
> ```bash
> # TikTok Shop
> TIKTOK_APP_KEY=
> TIKTOK_APP_SECRET=
>
> # Shopee Open Platform
> SHOPEE_PARTNER_ID=
> SHOPEE_PARTNER_KEY=
> ```
>
> **`docs/operations.md` 追加三平台凭证配置说明：**
> - TikTok：AppKey + AppSecret 获取流程
> - Shopee：PartnerID + PartnerKey 获取流程、多市场授权说明
>
> **产出：** 新人上手文档完整

---

> **🃏 CARD-D16-04 · Sprint 2 验收 Checklist + Sprint Review**
>
> **类型：** 验收  \
> **耗时：** 1.5h
>
> **Sprint 2 完整验收清单：**
>
> | # | 验收项 | 状态 | 依据 |
> |---|--------|------|------|
> | 1 | TikTok sandbox `getProducts()` 正常 | ⬜ | Day10 + Day15 冒烟 |
> | 2 | Shopee SG + MY 两个市场 `getProducts()` 正常 | ⬜ | Day13 + Day16 冒烟 |
> | 3 | TikTok Webhook 接收 `ORDER_STATUS_CHANGE` 事件 | ⬜ | Day11 + Day16 冒烟 |
> | 4 | `PaperclipBridge.createIssue()` 可创建 Paperclip Issue | ⬜ | Day14 DG-03 回收 |
> | 5 | 三平台 Harness mock 测试全部通过 | ⬜ | Day15 套件整合 |
> | 6 | TikTok HMAC-SHA256 签名测试通过 | ⬜ | Day9 |
> | 7 | Shopee 多市场签名测试通过 | ⬜ | Day12 |
> | 8 | TikTok / Shopee OAuth 路由完整 | ⬜ | Day11 / Day14 |
> | 9 | harness-factory 支持 4 平台（Shopify/Amazon/TikTok/Shopee） | ⬜ | Day6 + Day11 + Day14 |
> | 10 | CI pipeline 通过（含新 Harness 测试） | ⬜ | Day16 |
>
> **新增代码统计（预估）：**
>
> | 类别 | 新增文件 | 新增代码行（估） | 新增测试 case |
> |------|---------|----------------|-------------|
> | packages/harness | 6 文件 | ~700 行 | ~45 case |
> | apps/api routes | 4 文件 | ~350 行 | ~20 case |
> | apps/api lib | 1 文件（factory 扩展） | ~50 行 | ~4 case |
> | packages/db | — | — | — |
> | 配置/文档 | 2 文件 | ~20 行 | — |
> | **总计** | **~13 文件** | **~1120 行** | **~69 case** |
>
> **Sprint 3 准备事项（Day16 下午）：**
> 1. 确认 `packages/market` 包脚手架需要的汇率 API（Open Exchange Rates / Fixer.io）
> 2. 确认 Amazon SP-API 审核进度（若已通过，Sprint 3 可切换真实凭证）
> 3. 准备 6 国市场合规规则数据（SG/MY/TH/PH/ID/VN）
> 4. 评估 Prometheus prom-client 与现有 Fastify 的集成方案
>
> **产出：** Sprint 2 全部验收通过 · Sprint 3 准备就绪

---

**Day 16 卡片执行顺序汇总：**

```
09:00  CARD-D16-01  三平台集成冒烟测试（手动）            (2h)
11:10  CARD-D16-02  全量回归测试 + CI 验证                (1h)
13:30  CARD-D16-03  .env.example + 文档更新               (20min)
14:00  CARD-D16-04  Sprint 2 验收 Checklist + Sprint Review (1.5h)
```

**可复制落地文档（与上表一一对应）：**

| 卡片 | 仓库内文档 / 位置 |
|------|-------------------|
| CARD-D16-01 | [`docs/plans/sprint2-day16-smoke-checklist.md`](./sprint2-day16-smoke-checklist.md)（含与实现一致的 TikTok Webhook 签名示例） |
| CARD-D16-02 | 根目录 `pnpm test` / `pnpm typecheck` / `pnpm lint`；覆盖率：`pnpm --filter @patioer/harness test:coverage`、`pnpm --filter api test:coverage`；CI：`.github/workflows/ci.yml` |
| CARD-D16-03 | `.env.example`（TikTok / Shopee 变量）；`docs/operations.md`（TikTok Shop · Shopee Open Platform 小节） |
| CARD-D16-04 | [`docs/plans/sprint2-review-checklist.md`](./sprint2-review-checklist.md) |

---

#### Sprint 2 · 每日产出汇总

```
Day 9  │ TikTok 类型 + HMAC签名 + Harness骨架 + tikTokFetch
Day 10 │ TikTok getProducts + updatePrice + updateInventory + getAnalytics
Day 11 │ TikTok getOrders + 消息 + OAuth路由 + Webhook路由 + factory
Day 12 │ Shopee 类型 + 多市场签名 + Harness骨架 + shopeeFetch
Day 13 │ Shopee getProducts（两步API）+ updatePrice + getOrders + 消息 + 多市场验证
Day 14 │ Shopee OAuth + Webhook + DG-03回收（createIssue）+ DG-01评估
Day 15 │ TikTok ~20 tests + Shopee ~22 tests + 跨平台合规性 + 覆盖率
Day 16 │ 三平台冒烟 + 全量回归 + .env文档 + Sprint Review
```

---

### Sprint 3 · Week 5–6 — Market Harness + Webhook 统一 + 凭证切真实

**交付物：** Market Harness 包（货币/税/合规）、多平台 Webhook 统一分发、Amazon 沙盒切真实

| # | 任务 | 包/目录 | 依赖 | 估时 |
|---|------|---------|------|------|
| 3.1 | `packages/market` 脚手架：package.json、tsconfig、types | `packages/market` | — | 0.5d |
| 3.2 | `currency.ts`：汇率 API 接入 + Redis 缓存（TTL 1h）+ 转换方法 | `packages/market` | 3.1 | 1d |
| 3.3 | `tax.ts`：6 市场税务规则（SG GST 9% / MY SST 6% / TH VAT 7% / ID PPN 11% / UK VAT 20% / DE MwSt 19%） | `packages/market` | 3.1 | 1d |
| 3.4 | `compliance.ts`：禁售品类目检测 + 认证要求检查（IMDA/SFA/SIRIM/BPOM/UKCA/WEEE） | `packages/market` | 3.1 | 1.5d |
| 3.5 | `market-context.ts`：`MarketContext` 聚合 — Agent 消费入口（convertPrice + calculateTax + checkCompliance） | `packages/market` | 3.2, 3.3, 3.4 | 0.5d |
| 3.6 | Market 测试：货币转换精度、税务计算正确性、合规规则匹配 | `packages/market` | 3.5 | 1d |
| 3.7 | 多平台 Webhook 统一分发：扩展 `webhook-topic-handler.ts` 支持 Amazon / TikTok / Shopee 事件 | `apps/api` | S2 完成 | 1d |
| 3.8 | Amazon 真实凭证切换（SP-API 审核通过后）+ 端到端验证 | `packages/harness` | S1.10, 外部审核 | 1d |
| 3.9 | `HarnessRegistry` 扩展：支持按 `(tenantId, platform)` 动态实例化多平台 Harness | `packages/harness` | S2 完成 | 1d |
| 3.10 | Prometheus 指标埋点插件：`harness_error_rate` / `api_latency_p99` / `tenant_request_count` | `apps/api` plugins | — | 1d |

**Sprint 3 验收：**
- [ ] `convertPrice(100, 'SGD', 'USD')` 误差 < 0.01%
- [ ] ID 市场商品 PPN 11% 计算正确
- [ ] Amazon 真实 `getProducts()` 返回商品（非 sandbox）
- [ ] 多平台 Webhook 统一分发正常
- [ ] Prometheus `/metrics` 端点可用

---

#### Sprint 3 · Day-by-Day 实施细节

---

##### Day 1 — packages/market 脚手架 + HarnessRegistry 接口设计

---

> **🃏 CARD-D1-01 · packages/market 包脚手架**
>
> **类型：** 新建包  \
> **耗时：** 1h  \
> **目标文件：** `packages/market/package.json`、`packages/market/tsconfig.json`、`packages/market/src/types.ts`、`packages/market/src/index.ts`
>
> **执行步骤：**
> 1. 在 monorepo 根目录创建 `packages/market/` 目录结构：
>    ```
>    packages/market/
>    ├── src/
>    │   ├── types.ts
>    │   ├── currency.ts       # Day 2 实现（今日 stub）
>    │   ├── tax.ts            # Day 3 实现（今日 stub）
>    │   ├── compliance.ts     # Day 4-5 实现（今日 stub）
>    │   ├── market-context.ts # Day 5 实现（今日 stub）
>    │   └── index.ts
>    ├── package.json
>    └── tsconfig.json
>    ```
> 2. `packages/market/package.json`：
>    ```json
>    {
>      "name": "@patioer/market",
>      "version": "0.1.0",
>      "type": "module",
>      "main": "./dist/index.js",
>      "types": "./dist/index.d.ts",
>      "exports": {
>        ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" }
>      },
>      "scripts": {
>        "build": "tsc",
>        "test": "vitest run",
>        "typecheck": "tsc --noEmit"
>      },
>      "dependencies": {
>        "ioredis": "^5.3.2"
>      },
>      "devDependencies": {
>        "typescript": "^5.4.5",
>        "vitest": "^1.6.0"
>      }
>    }
>    ```
> 3. `packages/market/tsconfig.json`：
>    ```json
>    {
>      "extends": "../../tsconfig.base.json",
>      "compilerOptions": {
>        "outDir": "./dist",
>        "rootDir": "./src"
>      },
>      "include": ["src/**/*"]
>    }
>    ```
> 4. 在 `pnpm-workspace.yaml` 中确认 `packages/*` 已包含（通常已有，无需改动）
> 5. 运行 `pnpm install` 更新 workspace
>
> **验收：**
> - [ ] `packages/market/` 目录结构创建完成
> - [ ] `pnpm -r build` 不报 market 包错误（空 stub 可编译）
> - [ ] `@patioer/market` 可在 workspace 内被其他包引用
>
> **产出：** Market 包骨架就绪，Day 2-5 可直接填充实现

---

> **🃏 CARD-D1-02 · packages/market/src/types.ts 类型定义**
>
> **类型：** 新建文件  \
> **耗时：** 45 min  \
> **目标文件：** `packages/market/src/types.ts`
>
> **函数签名模板（可直接复制）：**
>
> ```typescript
> export type Market = 'SG' | 'MY' | 'TH' | 'ID' | 'UK' | 'DE'
>
> export type CertificationBody =
>   | 'IMDA'   // Singapore – Infocomm Media Development Authority
>   | 'SFA'    // Singapore – Singapore Food Agency
>   | 'SIRIM'  // Malaysia – SIRIM Berhad
>   | 'BPOM'   // Indonesia – Badan Pengawas Obat dan Makanan
>   | 'UKCA'   // UK – UK Conformity Assessed
>   | 'WEEE'   // EU – Waste Electrical and Electronic Equipment
>
> export interface ExchangeRate {
>   from: string
>   to: string
>   rate: number
>   fetchedAt: Date
> }
>
> export interface TaxRate {
>   market: Market
>   rate: number        // e.g. 0.09 for 9% GST
>   name: string        // e.g. 'GST', 'SST', 'VAT', 'PPN', 'MwSt'
>   inclusive: boolean  // 价格是否含税（东南亚平台通常含税）
> }
>
> export interface TaxCalculationResult {
>   baseAmount: number
>   taxAmount: number
>   totalAmount: number
>   taxRate: TaxRate
> }
>
> export interface ProductComplianceInfo {
>   category: string        // 商品类目（英文，对应平台分类）
>   subcategory?: string
>   hasElectronics: boolean
>   hasFood: boolean
>   hasCosme: boolean
>   market: Market
> }
>
> export interface ComplianceResult {
>   compliant: boolean
>   issues: string[]
>   requiredCertifications: CertificationBody[]
>   warnings: string[]
> }
> ```
>
> **实现约束：**
> - `Market` 类型枚举 Phase 2 支持的 6 个市场，Phase 3 可扩展
> - `CertificationBody` 明确标注监管机构全称（注释）
> - 所有金额类型用 `number`，精度由调用方保证（≥6位小数）
>
> **验收：**
> - [ ] `types.ts` 导出全部 6 个类型/接口
> - [ ] `tsc --noEmit` 通过（在 `packages/market/` 内）
>
> **产出：** 统一类型定义，所有 Market 包模块共享

---

> **🃏 CARD-D1-03 · HarnessRegistry 多平台接口设计（预研）**
>
> **类型：** 代码分析 + 接口设计（今日不写实现，Day 6 完成）  \
> **耗时：** 1.5h  \
> **目标文件：** `packages/harness/src/harness.registry.ts`（分析现有代码，设计扩展接口）
>
> **执行步骤：**
> 1. 阅读现有 `harness.registry.ts` 和 `types.ts`，了解当前 `HarnessRegistry` 结构
> 2. 设计多平台扩展方案，在文件顶部添加类型扩展注释：
>    ```typescript
>    // Phase 2 扩展：HarnessRegistry 支持按 (tenantId, platform) 动态实例化
>    // Day 1: 接口设计 → Day 6: 完整实现
>    //
>    // 新增类型：
>    //   Platform = 'shopify' | 'amazon' | 'tiktok' | 'shopee'
>    //   HarnessFactory = (tenantId: string) => TenantHarness
>    //   RegistryKey = `${tenantId}:${platform}`
>    ```
> 3. 在 `types.ts` 中新增以下类型（但暂不实现逻辑）：
>    ```typescript
>    export type Platform = 'shopify' | 'amazon' | 'tiktok' | 'shopee'
>    export type HarnessFactory = (tenantId: string) => TenantHarness
>    export type RegistryKey = `${string}:${Platform}`
>    ```
> 4. 记录到 `docs/plans/` 或 PR 描述中：`getHarness(tenantId, platform)` 方法签名规范
>
> **验收：**
> - [ ] `Platform` / `HarnessFactory` / `RegistryKey` 类型已添加到 `types.ts`
> - [ ] `tsc --noEmit` 通过（仅类型变更，不破坏现有编译）
>
> **产出：** Day 6 实现的接口规范已锁定，无 API 破坏风险

---

> **🃏 CARD-D1-04 · packages/market stub 文件创建**
>
> **类型：** 新建文件（stub）  \
> **耗时：** 30 min  \
> **目标文件：** `packages/market/src/currency.ts`、`tax.ts`、`compliance.ts`、`market-context.ts`、`index.ts`
>
> **函数签名模板（可直接复制，Day 2-5 逐步填充）：**
>
> ```typescript
> // packages/market/src/currency.ts
> import type { ExchangeRate } from './types.js'
>
> export async function getExchangeRate(from: string, to: string): Promise<ExchangeRate> {
>   throw new Error('not implemented')
> }
>
> export async function convertPrice(amount: number, from: string, to: string): Promise<number> {
>   throw new Error('not implemented')
> }
> ```
>
> ```typescript
> // packages/market/src/tax.ts
> import type { Market, TaxRate, TaxCalculationResult } from './types.js'
>
> export function getTaxRate(market: Market): TaxRate {
>   throw new Error('not implemented')
> }
>
> export function calculateTax(amount: number, market: Market): TaxCalculationResult {
>   throw new Error('not implemented')
> }
> ```
>
> ```typescript
> // packages/market/src/compliance.ts
> import type { Market, ProductComplianceInfo, ComplianceResult } from './types.js'
>
> export function checkCompliance(info: ProductComplianceInfo): ComplianceResult {
>   throw new Error('not implemented')
> }
> ```
>
> ```typescript
> // packages/market/src/market-context.ts
> import type { Market, ProductComplianceInfo, TaxCalculationResult, ComplianceResult } from './types.js'
>
> export interface MarketContext {
>   convertPrice(amount: number, from: string, to: string): Promise<number>
>   calculateTax(amount: number, market: Market): TaxCalculationResult
>   checkCompliance(info: ProductComplianceInfo): ComplianceResult
> }
>
> export function createMarketContext(): MarketContext {
>   throw new Error('not implemented')
> }
> ```
>
> ```typescript
> // packages/market/src/index.ts
> export * from './types.js'
> export * from './currency.js'
> export * from './tax.js'
> export * from './compliance.js'
> export * from './market-context.js'
> ```
>
> **验收：**
> - [ ] 所有 stub 文件创建完毕，签名与 `types.ts` 一致
> - [ ] `pnpm -r typecheck` 通过
>
> **产出：** Day 2-5 可专注填充实现，无需关注结构

---

> **🃏 CARD-D1-05 · Day 1 验收门禁**
>
> **类型：** 检查点  \
> **耗时：** 15 min
>
> ```bash
> # 1. 编译检查
> pnpm -r typecheck
>
> # 2. 确认包结构
> ls packages/market/src/
> # 期望：compliance.ts  currency.ts  index.ts  market-context.ts  tax.ts  types.ts
>
> # 3. 确认 Platform 类型已添加
> grep -n "Platform" packages/harness/src/types.ts
> ```
>
> **验收：**
> - [ ] `packages/market` 包骨架完整
> - [ ] `types.ts` 6 个核心类型全部导出
> - [ ] HarnessRegistry 扩展类型已添加（不破坏现有编译）
>
> **产出：** Day 1 全部完成 · 可安全提交

---

**Day 1 卡片执行顺序汇总：**

```
09:00  CARD-D1-01  packages/market 包脚手架          (1h)
10:00  CARD-D1-02  types.ts 类型定义                 (45min)
10:45  CARD-D1-03  HarnessRegistry 接口设计（预研）   (1.5h)
13:30  CARD-D1-04  stub 文件创建（currency/tax/…）   (30min)
14:00  CARD-D1-05  Day 1 验收门禁                    (15min)
```

---

##### Day 2 — currency.ts：汇率 API 接入 + Redis 缓存

---

> **🃏 CARD-D2-01 · 汇率 API 选型与环境配置**
>
> **类型：** 环境配置  \
> **耗时：** 30 min  \
> **目标文件：** `.env.example`
>
> **执行步骤：**
> 1. 选定汇率 API（推荐 [Frankfurter](https://www.frankfurter.app/)，免费、无需 Key）：
>    - Base URL：`https://api.frankfurter.app/latest`
>    - 参数格式：`?from=SGD&to=USD`
>    - 响应示例：`{ "rates": { "USD": 0.7412 }, "base": "SGD", "date": "..." }`
> 2. 在 `.env.example` 新增：
>    ```
>    # Market Package
>    EXCHANGE_RATE_API_URL=https://api.frankfurter.app
>    EXCHANGE_RATE_CACHE_TTL_SECONDS=3600
>    ```
> 3. 在 `packages/market/package.json` 确认 `ioredis` 依赖已存在
>
> **验收：**
> - [ ] `.env.example` 包含汇率 API 配置项
> - [ ] 浏览器/curl 能访问 `https://api.frankfurter.app/latest?from=SGD&to=USD`
>
> **产出：** API 选型锁定，环境变量规范已记录

---

> **🃏 CARD-D2-02 · currency.ts 核心实现**
>
> **类型：** 填充实现  \
> **耗时：** 2h  \
> **目标文件：** `packages/market/src/currency.ts`
>
> **函数签名模板（填充 Day 1 的 stub）：**
>
> ```typescript
> import type IORedis from 'ioredis'
> import type { ExchangeRate } from './types.js'
>
> const CACHE_TTL = parseInt(process.env.EXCHANGE_RATE_CACHE_TTL_SECONDS ?? '3600', 10)
> const API_BASE = process.env.EXCHANGE_RATE_API_URL ?? 'https://api.frankfurter.app'
>
> let _redis: IORedis | null = null
>
> export function setCurrencyRedis(redis: IORedis): void {
>   _redis = redis
> }
>
> function cacheKey(from: string, to: string): string {
>   return `market:fx:${from}:${to}`
> }
>
> export async function getExchangeRate(from: string, to: string): Promise<ExchangeRate> {
>   // 1. 先查 Redis 缓存
>   if (_redis) {
>     const cached = await _redis.get(cacheKey(from, to))
>     if (cached) return JSON.parse(cached) as ExchangeRate
>   }
>
>   // 2. 缓存未命中，调 API
>   const url = `${API_BASE}/latest?from=${from}&to=${to}`
>   const resp = await fetch(url)
>   if (!resp.ok) throw new Error(`Exchange rate fetch failed: ${resp.status}`)
>   const data = (await resp.json()) as { rates: Record<string, number>; date: string }
>
>   const rate = data.rates[to]
>   if (rate === undefined) throw new Error(`No rate found for ${from}→${to}`)
>
>   const result: ExchangeRate = { from, to, rate, fetchedAt: new Date() }
>
>   // 3. 写入 Redis 缓存
>   if (_redis) {
>     await _redis.set(cacheKey(from, to), JSON.stringify(result), 'EX', CACHE_TTL)
>   }
>
>   return result
> }
>
> export async function convertPrice(amount: number, from: string, to: string): Promise<number> {
>   if (from === to) return amount
>   const { rate } = await getExchangeRate(from, to)
>   // 保留 6 位小数精度，避免浮点累积误差
>   return Math.round(amount * rate * 1_000_000) / 1_000_000
> }
> ```
>
> **实现约束：**
> - `setCurrencyRedis` 注入式设计（测试时可传入 mock Redis）
> - 精度控制：`Math.round(... * 1_000_000) / 1_000_000`（误差 < 0.0001%）
> - 当 `from === to` 时直接返回原值，不请求 API
> - 错误信息需包含货币对，便于调试
>
> **验收：**
> - [ ] `convertPrice(100, 'SGD', 'SGD')` 返回 `100`（不调 API）
> - [ ] `convertPrice(100, 'SGD', 'USD')` 返回非零数值
> - [ ] Redis 缓存命中时不发起 HTTP 请求（单测可验证）
>
> **产出：** currency.ts 实现完毕，精度和缓存均满足需求

---

> **🃏 CARD-D2-03 · currency.test.ts 单元测试**
>
> **类型：** 新建测试文件  \
> **耗时：** 1.5h  \
> **目标文件：** `packages/market/src/currency.test.ts`
>
> **测试用例名字（逐条实现）：**
> - `convertPrice returns same amount when from === to`
> - `getExchangeRate fetches from API when cache is empty`
> - `getExchangeRate returns cached value on second call`
> - `getExchangeRate sets Redis cache with correct TTL`
> - `convertPrice SGD to USD precision within 0.01% of expected`
> - `getExchangeRate throws when API returns non-ok status`
> - `getExchangeRate throws when currency pair not found in response`
>
> **Mock 策略：**
> ```typescript
> // 全局 mock fetch
> vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
>   ok: true,
>   json: async () => ({ rates: { USD: 0.741234 }, date: '2026-03-22' }),
> }))
>
> // mock Redis
> const mockRedis = {
>   get: vi.fn().mockResolvedValue(null),
>   set: vi.fn().mockResolvedValue('OK'),
> }
> setCurrencyRedis(mockRedis as unknown as IORedis)
> ```
>
> **验收：**
> - [ ] 7 个测试用例全部通过
> - [ ] `vitest --coverage` 显示 `currency.ts` 覆盖率 ≥ 90%
>
> **产出：** currency.ts 精度与缓存行为由测试保证

---

> **🃏 CARD-D2-06 · Day 2 验收门禁**
>
> **类型：** 检查点  \
> **耗时：** 15 min
>
> ```bash
> cd packages/market && pnpm test
> # 期望：7 tests passed
>
> pnpm -r typecheck
> ```
>
> **验收：**
> - [ ] currency.ts 测试全部通过
> - [ ] 无 TypeScript 编译错误
>
> **产出：** Day 2 全部完成 · 汇率模块可用

---

**Day 2 卡片执行顺序汇总：**

```
09:00  CARD-D2-01  汇率 API 选型与环境配置             (30min)
09:30  CARD-D2-02  currency.ts 核心实现                (2h)
11:30  CARD-D2-03  currency.test.ts 单元测试           (1.5h)
14:00  CARD-D2-06  Day 2 验收门禁                      (15min)
```

---

##### Day 3 — tax.ts：6 市场税务规则实现

---

> **🃏 CARD-D3-01 · tax.ts 税率表与计算实现**
>
> **类型：** 填充实现  \
> **耗时：** 2.5h  \
> **目标文件：** `packages/market/src/tax.ts`
>
> **函数签名模板（填充 Day 1 的 stub）：**
>
> ```typescript
> import type { Market, TaxRate, TaxCalculationResult } from './types.js'
>
> const TAX_RATES: Record<Market, TaxRate> = {
>   SG: { market: 'SG', rate: 0.09,  name: 'GST',  inclusive: false },
>   MY: { market: 'MY', rate: 0.06,  name: 'SST',  inclusive: false },
>   TH: { market: 'TH', rate: 0.07,  name: 'VAT',  inclusive: true  },
>   ID: { market: 'ID', rate: 0.11,  name: 'PPN',  inclusive: true  },
>   UK: { market: 'UK', rate: 0.20,  name: 'VAT',  inclusive: false },
>   DE: { market: 'DE', rate: 0.19,  name: 'MwSt', inclusive: false },
> }
>
> export function getTaxRate(market: Market): TaxRate {
>   return TAX_RATES[market]
> }
>
> /**
>  * 对税前金额计算税务（非含税价格）
>  * SG/MY/UK/DE: amount 为税前价，加上税额
>  * TH/ID:       amount 为含税价，反推税额
>  */
> export function calculateTax(amount: number, market: Market): TaxCalculationResult {
>   const taxRate = getTaxRate(market)
>
>   if (taxRate.inclusive) {
>     // 含税价反推：taxAmount = amount * rate / (1 + rate)
>     const taxAmount = round6(amount * taxRate.rate / (1 + taxRate.rate))
>     return {
>       baseAmount: round6(amount - taxAmount),
>       taxAmount,
>       totalAmount: amount,
>       taxRate,
>     }
>   } else {
>     // 税前价加税：totalAmount = amount * (1 + rate)
>     const taxAmount = round6(amount * taxRate.rate)
>     return {
>       baseAmount: amount,
>       taxAmount,
>       totalAmount: round6(amount + taxAmount),
>       taxRate,
>     }
>   }
> }
>
> /**
>  * 从含税总价中分离税前价（用于跨境定价标准化）
>  */
> export function extractBasePrice(totalAmount: number, market: Market): number {
>   const taxRate = getTaxRate(market)
>   if (taxRate.inclusive) {
>     return round6(totalAmount / (1 + taxRate.rate))
>   }
>   return round6(totalAmount / (1 + taxRate.rate))
> }
>
> function round6(n: number): number {
>   return Math.round(n * 1_000_000) / 1_000_000
> }
> ```
>
> **实现约束：**
> - TH/ID 为含税价（平台价格已含税），计算时需反推税额
> - SG/MY/UK/DE 为税前价，消费者看到的是加税后总价
> - `round6` 保留 6 位精度，防止浮点误差在多次计算后累积
> - `TAX_RATES` 常量对象确保 O(1) 查询，不允许运行时修改
>
> **验收：**
> - [ ] `calculateTax(100, 'SG').taxAmount === 9`（GST 9%）
> - [ ] `calculateTax(100, 'ID').taxAmount` ≈ `9.91`（PPN 11% 含税反推）
> - [ ] `calculateTax(100, 'UK').totalAmount === 120`（VAT 20%）
> - [ ] `extractBasePrice(111, 'ID')` ≈ `100`（含税价反推税前价）
>
> **产出：** tax.ts 6 市场税务规则实现完毕

---

> **🃏 CARD-D3-02 · tax.test.ts 单元测试**
>
> **类型：** 新建测试文件  \
> **耗时：** 1.5h  \
> **目标文件：** `packages/market/src/tax.test.ts`
>
> **测试用例名字（逐条实现）：**
> - `getTaxRate returns correct rate for all 6 markets`
> - `calculateTax SG: 100 → taxAmount=9, total=109`
> - `calculateTax MY: 100 → taxAmount=6, total=106`
> - `calculateTax TH: inclusive 107 → taxAmount≈7, base=100`
> - `calculateTax ID: inclusive 111 → taxAmount≈9.91, base≈100.09`
> - `calculateTax UK: 100 → taxAmount=20, total=120`
> - `calculateTax DE: 100 → taxAmount=19, total=119`
> - `extractBasePrice round-trips with calculateTax total`
> - `calculateTax precision: no floating point drift after 1000 iterations`
>
> **精度验证用例（重点）：**
> ```typescript
> it('calculateTax ID: PPN 11% inclusive is correct', () => {
>   const result = calculateTax(100, 'ID')
>   // 100 含税，税额 = 100 * 0.11 / 1.11 ≈ 9.9099...
>   expect(result.taxAmount).toBeCloseTo(9.909909, 4)
>   expect(result.baseAmount).toBeCloseTo(90.090090, 4)
>   expect(result.totalAmount).toBe(100)
> })
>
> it('calculateTax no drift after 1000 iterations', () => {
>   let total = 100
>   for (let i = 0; i < 1000; i++) total = calculateTax(total, 'SG').baseAmount
>   expect(isFinite(total)).toBe(true)
>   expect(total).toBeGreaterThan(0)
> })
> ```
>
> **验收：**
> - [ ] 9 个测试用例全部通过
> - [ ] `tax.ts` 测试覆盖率 ≥ 95%
>
> **产出：** tax.ts 精度与边界行为由测试保证

---

> **🃏 CARD-D3-03 · Day 3 验收门禁**
>
> **类型：** 检查点  \
> **耗时：** 10 min
>
> ```bash
> cd packages/market && pnpm test
> # 期望：currency + tax 共 16 tests passed
>
> # 手动验证 ID 市场
> node -e "
>   const { calculateTax } = await import('./dist/tax.js')
>   console.log(calculateTax(100, 'ID'))
>   // { baseAmount: 90.09..., taxAmount: 9.90..., totalAmount: 100, ... }
> "
> ```
>
> **验收：**
> - [ ] tax.ts + currency.ts 测试全部通过（16 tests）
> - [ ] ID 市场 PPN 计算结果正确
>
> **产出：** Day 3 全部完成 · 税务模块可用

---

**Day 3 卡片执行顺序汇总：**

```
09:00  CARD-D3-01  tax.ts 税率表与计算实现            (2.5h)
11:30  CARD-D3-02  tax.test.ts 单元测试               (1.5h)
14:00  CARD-D3-03  Day 3 验收门禁                     (10min)
```

---

##### Day 4 — compliance.ts：禁售品类目检测

---

> **🃏 CARD-D4-01 · 6 市场禁售品类目规则定义**
>
> **类型：** 新建常量文件  \
> **耗时：** 2h  \
> **目标文件：** `packages/market/src/compliance-rules.ts`（从 compliance.ts 中抽出常量）
>
> **函数签名模板（可直接复制）：**
>
> ```typescript
> import type { Market, CertificationBody } from './types.js'
>
> /**
>  * 各市场完全禁售类目（Agent 绝不可上架此类商品）
>  * 来源：各平台卖家政策 2024-2026
>  */
> export const PROHIBITED_CATEGORIES: Record<Market, string[]> = {
>   SG: [
>     'tobacco', 'chewing-gum', 'firecrackers', 'controlled-drugs',
>     'endangered-species', 'replica-weapons',
>   ],
>   MY: [
>     'tobacco-oral', 'vaping-liquid', 'controlled-drugs',
>     'counterfeit-goods', 'endangered-species',
>   ],
>   TH: [
>     'gambling-equipment', 'prescription-drugs-otc', 'controlled-drugs',
>     'antiques-without-permit', 'counterfeit-goods',
>   ],
>   ID: [
>     'alcohol-spirits', 'controlled-drugs', 'pornographic-material',
>     'counterfeit-goods', 'weapons', 'bpom-unregistered-health',
>   ],
>   UK: [
>     'live-animals', 'human-body-parts', 'prescription-drugs',
>     'controlled-drugs', 'offensive-weapons',
>   ],
>   DE: [
>     'nazi-memorabilia', 'controlled-drugs', 'prescription-drugs',
>     'surveillance-equipment', 'counterfeit-goods',
>   ],
> }
>
> /**
>  * 各市场需要认证的类目 → 所需认证机构
>  * 返回空数组表示无额外认证要求
>  */
> export const CERTIFICATION_REQUIREMENTS: Record<Market, Record<string, CertificationBody[]>> = {
>   SG: {
>     'electronics':        ['IMDA'],
>     'food-supplements':   ['SFA'],
>     'medical-devices':    ['HSA'],
>     'telecommunications': ['IMDA'],
>   },
>   MY: {
>     'electronics':        ['SIRIM'],
>     'electrical-goods':   ['SIRIM'],
>     'food-supplements':   ['MOH'],
>   },
>   TH: {
>     'food-supplements':   ['FDA'],
>     'cosmetics':          ['FDA'],
>   },
>   ID: {
>     'food-supplements':   ['BPOM'],
>     'cosmetics':          ['BPOM'],
>     'medical-devices':    ['BPOM'],
>   },
>   UK: {
>     'electronics':        ['UKCA', 'WEEE'],
>     'electrical-goods':   ['UKCA'],
>     'toys':               ['UKCA'],
>   },
>   DE: {
>     'electronics':        ['WEEE'],
>     'electrical-goods':   ['WEEE'],
>     'batteries':          ['WEEE'],
>   },
> }
> ```
>
> **实现约束：**
> - 类目字符串使用 kebab-case 英文，与平台 taxonomy 对齐
> - 常量为 `const`，运行时不可修改（防止 Agent 自行绕过合规）
> - Phase 2 仅覆盖主流类目，特殊类目在 Phase 3 补充
>
> **验收：**
> - [ ] `PROHIBITED_CATEGORIES` 6 个市场均有至少 4 条规则
> - [ ] `CERTIFICATION_REQUIREMENTS` 6 个市场均有对应条目
> - [ ] `tsc --noEmit` 通过
>
> **产出：** 合规规则常量库就绪

---

> **🃏 CARD-D4-02 · compliance.ts 禁售品检测实现**
>
> **类型：** 填充实现  \
> **耗时：** 2h  \
> **目标文件：** `packages/market/src/compliance.ts`
>
> **函数签名模板（填充 Day 1 的 stub）：**
>
> ```typescript
> import type { Market, ProductComplianceInfo, ComplianceResult, CertificationBody } from './types.js'
> import { PROHIBITED_CATEGORIES, CERTIFICATION_REQUIREMENTS } from './compliance-rules.js'
>
> export function isProhibited(category: string, market: Market): boolean {
>   const prohibited = PROHIBITED_CATEGORIES[market]
>   return prohibited.some(
>     (p) => category.toLowerCase() === p || category.toLowerCase().startsWith(p + '-'),
>   )
> }
>
> export function getRequiredCertifications(
>   category: string,
>   market: Market,
> ): CertificationBody[] {
>   const requirements = CERTIFICATION_REQUIREMENTS[market]
>   const normalised = category.toLowerCase()
>   // 精确匹配 + 前缀匹配（electronics 覆盖 electronics-appliances）
>   for (const [key, certs] of Object.entries(requirements)) {
>     if (normalised === key || normalised.startsWith(key + '-')) {
>       return certs
>     }
>   }
>   return []
> }
>
> export function checkCompliance(info: ProductComplianceInfo): ComplianceResult {
>   const issues: string[] = []
>   const warnings: string[] = []
>   const requiredCertifications: CertificationBody[] = []
>
>   const { category, market, hasElectronics, hasFood, hasCosme } = info
>
>   // 1. 禁售品检测
>   if (isProhibited(category, market)) {
>     issues.push(`Category "${category}" is prohibited in market ${market}`)
>   }
>
>   // 2. 获取认证要求（按主类目）
>   const certs = getRequiredCertifications(category, market)
>   requiredCertifications.push(...certs)
>
>   // 3. 交叉检查（电子 + 食品 + 化妆品）
>   if (hasElectronics) {
>     const elecCerts = getRequiredCertifications('electronics', market)
>     for (const c of elecCerts) {
>       if (!requiredCertifications.includes(c)) requiredCertifications.push(c)
>     }
>   }
>   if (hasFood) {
>     warnings.push(`Food-related product in ${market}: verify SFA/BPOM/FDA registration`)
>   }
>   if (hasCosme) {
>     const cosmeCerts = getRequiredCertifications('cosmetics', market)
>     for (const c of cosmeCerts) {
>       if (!requiredCertifications.includes(c)) requiredCertifications.push(c)
>     }
>   }
>
>   return {
>     compliant: issues.length === 0,
>     issues,
>     requiredCertifications,
>     warnings,
>   }
> }
> ```
>
> **实现约束：**
> - 禁售品检测返回 `compliant: false` + 具体 `issues` 描述（Agent 据此生成人工审批 Ticket）
> - `warnings` 不阻止上架但需记录到 Audit Log
> - 认证要求去重（同一认证体不重复出现）
>
> **验收：**
> - [ ] `isProhibited('controlled-drugs', 'SG')` 返回 `true`
> - [ ] `isProhibited('electronics', 'SG')` 返回 `false`
> - [ ] `checkCompliance({ category: 'electronics', market: 'SG', hasElectronics: true, ... }).requiredCertifications` 包含 `'IMDA'`
> - [ ] `checkCompliance({ category: 'tobacco', market: 'SG', ... }).compliant` 为 `false`
>
> **产出：** compliance.ts 禁售品检测完成，认证要求查询可用

---

> **🃏 CARD-D4-03 · compliance.test.ts（禁售品部分）**
>
> **类型：** 新建测试文件（仅禁售品测试，认证测试在 Day 5 补充）  \
> **耗时：** 1h  \
> **目标文件：** `packages/market/src/compliance.test.ts`
>
> **测试用例名字（逐条实现）：**
> - `isProhibited returns true for controlled-drugs in all 6 markets`
> - `isProhibited returns false for electronics in all 6 markets`
> - `isProhibited returns true for tobacco in SG`
> - `isProhibited returns false for food-supplements in SG`
> - `checkCompliance tobacco in SG: compliant=false, issues not empty`
> - `checkCompliance electronics in SG: compliant=true, IMDA cert required`
> - `checkCompliance counterfeit-goods in MY: compliant=false`
>
> **验收：**
> - [ ] 7 个禁售品测试用例全部通过
>
> **产出：** Day 4 禁售品检测测试覆盖完毕

---

> **🃏 CARD-D4-04 · Day 4 验收门禁**
>
> **类型：** 检查点  \
> **耗时：** 10 min
>
> ```bash
> cd packages/market && pnpm test
> # 期望：currency + tax + compliance(禁售品) 共 23 tests passed
>
> pnpm -r typecheck
> ```
>
> **验收：**
> - [ ] 全部已实现测试通过（23+）
> - [ ] 无 TypeScript 错误
>
> **产出：** Day 4 全部完成 · 禁售品检测模块可用

---

**Day 4 卡片执行顺序汇总：**

```
09:00  CARD-D4-01  compliance-rules.ts 规则常量定义    (2h)
11:00  CARD-D4-02  compliance.ts 禁售品检测实现        (2h)
13:30  CARD-D4-03  compliance.test.ts（禁售品部分）    (1h)
14:30  CARD-D4-04  Day 4 验收门禁                      (10min)
```

---

##### Day 5 — compliance.ts 认证要求完善 + market-context.ts 聚合

---

> **🃏 CARD-D5-01 · compliance.test.ts 认证要求测试补充**
>
> **类型：** 补充测试  \
> **耗时：** 1h  \
> **目标文件：** `packages/market/src/compliance.test.ts`（续 Day 4）
>
> **追加测试用例名字：**
> - `getRequiredCertifications electronics in SG returns [IMDA]`
> - `getRequiredCertifications electronics in UK returns [UKCA, WEEE]`
> - `getRequiredCertifications electronics in DE returns [WEEE]`
> - `getRequiredCertifications cosmetics in ID returns [BPOM]`
> - `getRequiredCertifications unknown category returns []`
> - `checkCompliance hasElectronics=true adds WEEE cert in DE`
> - `checkCompliance hasCosme=true in ID adds BPOM cert`
> - `checkCompliance warnings include food note when hasFood=true`
> - `checkCompliance certifications are deduplicated`
>
> **验收：**
> - [ ] 9 个认证测试用例全部通过
> - [ ] `compliance.ts` 覆盖率 ≥ 85%
>
> **产出：** compliance.ts 认证要求测试全面覆盖

---

> **🃏 CARD-D5-02 · market-context.ts MarketContext 聚合实现**
>
> **类型：** 填充实现  \
> **耗时：** 1.5h  \
> **目标文件：** `packages/market/src/market-context.ts`
>
> **函数签名模板（填充 Day 1 的 stub）：**
>
> ```typescript
> import type IORedis from 'ioredis'
> import type { Market, ProductComplianceInfo, TaxCalculationResult, ComplianceResult } from './types.js'
> import { convertPrice, setCurrencyRedis } from './currency.js'
> import { calculateTax, getTaxRate } from './tax.js'
> import { checkCompliance, isProhibited, getRequiredCertifications } from './compliance.js'
>
> export interface MarketContext {
>   /** 货币转换（带 Redis 缓存） */
>   convertPrice(amount: number, from: string, to: string): Promise<number>
>   /** 税务计算（含税/不含税根据市场自动处理） */
>   calculateTax(amount: number, market: Market): TaxCalculationResult
>   /** 合规检查（禁售 + 认证要求） */
>   checkCompliance(info: ProductComplianceInfo): ComplianceResult
>   /** 快速禁售判断 */
>   isProhibited(category: string, market: Market): boolean
>   /** 获取认证要求 */
>   getRequiredCertifications(category: string, market: Market): string[]
> }
>
> export interface MarketContextOptions {
>   redis?: IORedis
> }
>
> export function createMarketContext(opts: MarketContextOptions = {}): MarketContext {
>   if (opts.redis) setCurrencyRedis(opts.redis)
>
>   return {
>     convertPrice,
>     calculateTax,
>     checkCompliance,
>     isProhibited,
>     getRequiredCertifications,
>   }
> }
> ```
>
> **实现约束：**
> - `MarketContext` 是 Agent 消费 Market 包的唯一入口（Agent 不直接导入子模块）
> - `opts.redis` 注入共享 Redis 连接（与 `apps/api` 复用同一连接）
> - 接口设计保持扁平，Agent 代码调用尽量直观
>
> **验收：**
> - [ ] `createMarketContext()` 返回包含全部 5 个方法的对象
> - [ ] `createMarketContext({ redis })` 正确注入 Redis 到 currency 模块
> - [ ] 调用 `ctx.convertPrice(100, 'SGD', 'USD')` 不抛错（需 mock fetch）
>
> **产出：** MarketContext 聚合入口实现完毕

---

> **🃏 CARD-D5-03 · market-context.test.ts 集成测试**
>
> **类型：** 新建测试文件  \
> **耗时：** 45 min  \
> **目标文件：** `packages/market/src/market-context.test.ts`
>
> **测试用例名字（逐条实现）：**
> - `createMarketContext returns object with all 5 methods`
> - `ctx.calculateTax delegates to tax module correctly`
> - `ctx.checkCompliance delegates to compliance module correctly`
> - `ctx.isProhibited returns correct result for prohibited category`
> - `ctx.convertPrice SGD to USD returns valid number`
>
> **验收：**
> - [ ] 5 个集成测试全部通过
> - [ ] `packages/market` 总测试数 ≥ 35
>
> **产出：** MarketContext 集成测试覆盖

---

> **🃏 CARD-D5-04 · index.ts 导出整理**
>
> **类型：** 更新文件  \
> **耗时：** 15 min  \
> **目标文件：** `packages/market/src/index.ts`
>
> **最终导出清单：**
> ```typescript
> // packages/market/src/index.ts
> export * from './types.js'
> export * from './currency.js'
> export * from './tax.js'
> export * from './compliance.js'
> export * from './compliance-rules.js'
> export * from './market-context.js'
> ```
>
> **验收：**
> - [ ] `import { createMarketContext, calculateTax, checkCompliance } from '@patioer/market'` 可用
>
> **产出：** 公共 API 面整洁，Agent 代码可直接导入

---

> **🃏 CARD-D5-05 · Day 5 验收门禁**
>
> **类型：** 检查点  \
> **耗时：** 15 min
>
> ```bash
> cd packages/market && pnpm test --reporter=verbose
> # 期望：≥ 35 tests passed, 0 failed
>
> pnpm -r build
> pnpm -r typecheck
> ```
>
> **验收：**
> - [ ] `packages/market` ≥ 35 个测试全部通过
> - [ ] `createMarketContext` 可从 `@patioer/market` 导入
> - [ ] 构建产出 `packages/market/dist/` 正常
>
> **产出：** Day 5 全部完成 · packages/market 功能完整可用

---

**Day 5 卡片执行顺序汇总：**

```
09:00  CARD-D5-01  compliance.test.ts 认证要求测试补充  (1h)
10:00  CARD-D5-02  market-context.ts 聚合实现            (1.5h)
11:30  CARD-D5-03  market-context.test.ts 集成测试       (45min)
13:30  CARD-D5-04  index.ts 导出整理                     (15min)
13:45  CARD-D5-05  Day 5 验收门禁                        (15min)
```

---

##### Day 6 — Market 测试套件完整化 + HarnessRegistry 多平台扩展

---

> **🃏 CARD-D6-01 · Market 包覆盖率检查与补测**
>
> **类型：** 测试补充  \
> **耗时：** 1.5h  \
> **目标文件：** 所有 `packages/market/src/*.test.ts`
>
> **执行步骤：**
> 1. 运行覆盖率报告：
>    ```bash
>    cd packages/market && pnpm vitest run --coverage
>    ```
> 2. 检查各文件覆盖率：
>    - `currency.ts` ≥ 90%
>    - `tax.ts` ≥ 95%
>    - `compliance.ts` ≥ 85%
>    - `market-context.ts` ≥ 80%
>    - `compliance-rules.ts`（常量，≥ 60% 即可）
> 3. 对覆盖率不达标的分支补充 edge case 测试：
>    - API 返回 4xx/5xx 错误
>    - 边界金额（0、负数、极大值）
>    - 未知 market 的防御性处理
>
> **重点边界测试用例：**
> ```typescript
> // currency.ts 边界
> it('convertPrice handles amount=0', async () => {
>   expect(await convertPrice(0, 'SGD', 'USD')).toBe(0)
> })
>
> // compliance.ts 边界
> it('getRequiredCertifications with subcategory prefix match', () => {
>   const certs = getRequiredCertifications('electronics-appliances', 'SG')
>   expect(certs).toContain('IMDA')
> })
>
> // tax.ts 边界
> it('calculateTax with very small amount has no precision drift', () => {
>   const result = calculateTax(0.01, 'SG')
>   expect(result.taxAmount).toBeCloseTo(0.0009, 4)
> })
> ```
>
> **验收：**
> - [ ] 所有 Market 包文件覆盖率达标（≥ 80% 总体）
> - [ ] `packages/market` 测试通过数 ≥ 40
>
> **产出：** Market 包测试套件达到 Phase 2 质量门槛

---

> **🃏 CARD-D6-02 · HarnessRegistry 多平台实例化实现**
>
> **类型：** 扩展现有文件  \
> **耗时：** 2h  \
> **目标文件：** `packages/harness/src/harness.registry.ts`
>
> **函数签名模板（在 Day 1 接口设计基础上实现）：**
>
> ```typescript
> import type { TenantHarness } from './base.harness.js'
> import type { Platform, HarnessFactory } from './types.js'
>
> // 工厂函数注册表：platform → factory
> const factories = new Map<Platform, HarnessFactory>()
>
> // 实例缓存：`${tenantId}:${platform}` → harness 实例
> const instances = new Map<string, TenantHarness>()
>
> export function registerHarnessFactory(platform: Platform, factory: HarnessFactory): void {
>   factories.set(platform, factory)
> }
>
> export function getHarness(tenantId: string, platform: Platform): TenantHarness {
>   const key: `${string}:${Platform}` = `${tenantId}:${platform}`
>
>   if (instances.has(key)) {
>     return instances.get(key)!
>   }
>
>   const factory = factories.get(platform)
>   if (!factory) {
>     throw new Error(
>       `No harness factory registered for platform "${platform}". ` +
>       `Call registerHarnessFactory("${platform}", factory) during bootstrap.`,
>     )
>   }
>
>   const harness = factory(tenantId)
>   instances.set(key, harness)
>   return harness
> }
>
> export function clearHarnessInstances(): void {
>   instances.clear()
> }
>
> export function getRegisteredPlatforms(): Platform[] {
>   return [...factories.keys()]
> }
> ```
>
> **Bootstrap 注册示例（在 `apps/api/src/lib/agent-bootstrap.ts` 中调用）：**
> ```typescript
> // 应用启动时注册各平台工厂
> registerHarnessFactory('shopify', (tenantId) => new ShopifyHarness(tenantId, credentials))
> registerHarnessFactory('amazon', (tenantId) => new AmazonHarness(tenantId, credentials))
> registerHarnessFactory('tiktok', (tenantId) => new TikTokHarness(tenantId, credentials))
> registerHarnessFactory('shopee', (tenantId) => new ShopeeHarness(tenantId, credentials))
> ```
>
> **实现约束：**
> - 实例缓存避免同一租户重复创建 Harness（内存泄漏防控：单测调用 `clearHarnessInstances()`）
> - 找不到工厂时抛出含 platform 名称的明确错误
> - `getHarness` 不接受 `undefined`，TypeScript 层面已强制
>
> **验收：**
> - [ ] `registerHarnessFactory + getHarness` 可正常创建并缓存 Harness 实例
> - [ ] 未注册平台调用 `getHarness` 抛出明确错误
> - [ ] 同一 `(tenantId, platform)` 重复调用返回同一实例
>
> **产出：** HarnessRegistry 多平台动态实例化实现完毕

---

> **🃏 CARD-D6-03 · harness.registry.test.ts 扩展测试**
>
> **类型：** 扩展测试文件  \
> **耗时：** 1h  \
> **目标文件：** `packages/harness/src/harness.registry.test.ts`
>
> **追加测试用例名字：**
> - `registerHarnessFactory stores factory for given platform`
> - `getHarness creates instance using registered factory`
> - `getHarness returns same instance on second call (cache)`
> - `getHarness throws for unregistered platform`
> - `clearHarnessInstances resets cache`
> - `getRegisteredPlatforms returns all registered platforms`
> - `getHarness creates different instances for different tenants`
>
> **验收：**
> - [ ] 7 个新测试用例全部通过
> - [ ] `harness.registry.ts` 覆盖率 ≥ 90%
>
> **产出：** HarnessRegistry 多平台行为由测试保证

---

> **🃏 CARD-D6-04 · Day 6 验收门禁**
>
> **类型：** 检查点  \
> **耗时：** 15 min
>
> ```bash
> # Market 包
> cd packages/market && pnpm test --reporter=verbose
> # 期望：≥ 40 tests passed
>
> # Harness 包
> cd packages/harness && pnpm test
> # 期望：registry 相关 7 新 tests passed + 原有 tests 不回归
>
> pnpm -r typecheck
> ```
>
> **验收：**
> - [ ] `packages/market` 覆盖率 ≥ 80%
> - [ ] `packages/harness` HarnessRegistry 扩展测试全部通过
> - [ ] 无 TypeScript 编译错误
>
> **产出：** Day 6 全部完成 · Market 包 + HarnessRegistry 均就绪

---

**Day 6 卡片执行顺序汇总：**

```
09:00  CARD-D6-01  Market 包覆盖率检查与补测            (1.5h)
10:30  CARD-D6-02  HarnessRegistry 多平台实现           (2h)
13:30  CARD-D6-03  harness.registry.test.ts 扩展        (1h)
14:30  CARD-D6-04  Day 6 验收门禁                       (15min)
```

---

##### Day 7 — 多平台 Webhook 统一分发

---

> **🃏 CARD-D7-01 · 分析现有 webhook-topic-handler.ts 结构**
>
> **类型：** 代码分析  \
> **耗时：** 30 min  \
> **目标文件：** `apps/api/src/lib/webhook-topic-handler.ts`
>
> **执行步骤：**
> 1. 阅读 `webhook-topic-handler.ts` 现有代码，了解：
>    - Webhook 分发函数签名
>    - Topic 常量定义方式
>    - Handler 注册/查找机制
> 2. 记录需要扩展的位置（新增 platform 参数或 topic 前缀）
> 3. 确认各平台 Webhook 事件 topic 命名规范：
>    - Amazon: `ORDER_CHANGE` / `ITEM_CHANGE` / `FEED_PROCESSING_FINISHED`
>    - TikTok: `ORDER_STATUS_CHANGE` / `LIVE_ORDER` / `SHOP_PRODUCT_CHANGE`
>    - Shopee: `order.status_update` / `logistics.tracking_update` / `shop.update_profile`
>
> **产出：** 清楚扩展点，可直接实施 CARD-D7-02

---

> **🃏 CARD-D7-02 · webhook-topic-handler.ts 多平台扩展**
>
> **类型：** 扩展现有文件  \
> **耗时：** 2h  \
> **目标文件：** `apps/api/src/lib/webhook-topic-handler.ts`
>
> **扩展策略：** 在现有 Shopify handler 基础上，为 Amazon / TikTok / Shopee 添加带平台前缀的 topic：
>
> ```typescript
> // 扩展 Topic 类型（在现有基础上新增）
> export type WebhookPlatform = 'shopify' | 'amazon' | 'tiktok' | 'shopee'
>
> export type AmazonTopic =
>   | 'amazon:ORDER_CHANGE'
>   | 'amazon:ITEM_CHANGE'
>   | 'amazon:FEED_PROCESSING_FINISHED'
>
> export type TikTokTopic =
>   | 'tiktok:ORDER_STATUS_CHANGE'
>   | 'tiktok:LIVE_ORDER'
>   | 'tiktok:SHOP_PRODUCT_CHANGE'
>
> export type ShopeeTopic =
>   | 'shopee:order.status_update'
>   | 'shopee:logistics.tracking_update'
>   | 'shopee:shop.update_profile'
>
> export type WebhookTopic = ShopifyTopic | AmazonTopic | TikTokTopic | ShopeeTopic
>
> // 多平台统一 Webhook 事件结构
> export interface PlatformWebhookEvent {
>   platform: WebhookPlatform
>   topic: WebhookTopic
>   tenantId: string
>   shopId?: string    // Shopify/Amazon seller ID
>   shopName?: string
>   payload: unknown
>   receivedAt: Date
> }
>
> // 扩展分发函数：支持多平台事件路由
> export async function dispatchWebhook(event: PlatformWebhookEvent): Promise<void> {
>   const handler = handlers.get(event.topic)
>   if (!handler) {
>     logger.warn({ topic: event.topic, platform: event.platform }, 'No handler for webhook topic')
>     return
>   }
>   await handler(event)
> }
>
> // Amazon Webhook 路由（从 routes/amazon/webhook.ts 调用）
> export async function handleAmazonWebhook(
>   tenantId: string,
>   topic: AmazonTopic,
>   payload: unknown,
> ): Promise<void> {
>   await dispatchWebhook({
>     platform: 'amazon',
>     topic,
>     tenantId,
>     payload,
>     receivedAt: new Date(),
>   })
> }
>
> // TikTok Webhook 路由
> export async function handleTikTokWebhook(
>   tenantId: string,
>   topic: TikTokTopic,
>   payload: unknown,
> ): Promise<void> {
>   await dispatchWebhook({ platform: 'tiktok', topic, tenantId, payload, receivedAt: new Date() })
> }
>
> // Shopee Webhook 路由
> export async function handleShopeeWebhook(
>   tenantId: string,
>   topic: ShopeeTopic,
>   payload: unknown,
> ): Promise<void> {
>   await dispatchWebhook({ platform: 'shopee', topic, tenantId, payload, receivedAt: new Date() })
> }
> ```
>
> **实现约束：**
> - Topic 命名使用 `platform:EVENT_NAME` 格式，避免跨平台命名冲突
> - 无匹配 handler 时 **仅 warn 日志，不抛错**（避免 Webhook 重试风暴）
> - 所有 Webhook 事件写入 `webhook_events` 表（调用现有 `recordWebhookEvent`）
>
> **验收：**
> - [ ] `WebhookTopic` union type 包含全部 3 个新平台 topic
> - [ ] `handleAmazonWebhook / handleTikTokWebhook / handleShopeeWebhook` 函数存在
> - [ ] 无已有 Shopify handler 代码被破坏
>
> **产出：** 多平台 Webhook 统一分发架构完成

---

> **🃏 CARD-D7-03 · 各平台 webhook.ts 路由对接**
>
> **类型：** 扩展现有文件  \
> **耗时：** 1.5h  \
> **目标文件：** `apps/api/src/routes/amazon/webhook.ts`、`routes/tiktok/webhook.ts`、`routes/shopee/webhook.ts`
>
> **执行步骤：**
> 对 3 个 webhook 路由文件分别：
> 1. 验证签名（各平台逻辑不同，调用各 Harness 的 `verifyWebhookSignature`）
> 2. 解析 topic（从请求头或请求体中提取）
> 3. 调用对应平台的分发函数：
>    ```typescript
>    // Amazon webhook.ts 示例
>    fastify.post('/amazon/webhook', async (req, reply) => {
>      const topic = req.headers['x-amz-sns-message-type'] as AmazonTopic
>      await handleAmazonWebhook(req.tenantId, `amazon:${topic}`, req.body)
>      return reply.status(200).send({ ok: true })
>    })
>    ```
> 4. 统一返回 `200 OK`（避免平台重试）
>
> **验收：**
> - [ ] 3 个平台 webhook 路由均调用 `handleXxxWebhook`
> - [ ] 签名验证失败返回 `401`
> - [ ] 有效请求返回 `200`
>
> **产出：** 多平台 Webhook 路由接入统一分发层

---

> **🃏 CARD-D7-04 · webhook-topic-handler.test.ts 多平台测试**
>
> **类型：** 扩展测试文件  \
> **耗时：** 1h  \
> **目标文件：** `apps/api/src/lib/webhook-topic-handler.test.ts`（若已存在则追加）
>
> **追加测试用例名字：**
> - `handleAmazonWebhook dispatches to registered handler`
> - `handleTikTokWebhook dispatches to registered handler`
> - `handleShopeeWebhook dispatches to registered handler`
> - `dispatchWebhook logs warning for unknown topic (no throw)`
> - `PlatformWebhookEvent has correct platform field`
>
> **验收：**
> - [ ] 5 个多平台 Webhook 测试全部通过
> - [ ] Shopify 现有测试无回归
>
> **产出：** Webhook 统一分发行为由测试保证

---

> **🃏 CARD-D7-05 · Day 7 验收门禁**
>
> **类型：** 检查点  \
> **耗时：** 15 min
>
> ```bash
> cd apps/api && pnpm test -- --grep "webhook"
> # 期望：Shopify + Amazon + TikTok + Shopee webhook tests passed
>
> pnpm -r typecheck
> ```
>
> **验收：**
> - [ ] 多平台 Webhook 测试全部通过
> - [ ] Shopify 现有 webhook 功能无回归
> - [ ] `tsc --noEmit` 全局通过
>
> **产出：** Day 7 全部完成 · 多平台 Webhook 统一分发就绪

---

**Day 7 卡片执行顺序汇总：**

```
09:00  CARD-D7-01  分析 webhook-topic-handler.ts 结构  (30min)
09:30  CARD-D7-02  webhook-topic-handler.ts 多平台扩展  (2h)
11:30  CARD-D7-03  3 平台 webhook.ts 路由对接           (1.5h)
13:30  CARD-D7-04  webhook-topic-handler.test.ts 测试   (1h)
14:30  CARD-D7-05  Day 7 验收门禁                       (15min)
```

---

##### Day 8 — Prometheus 指标埋点插件

---

> **🃏 CARD-D8-01 · 依赖安装与插件目录**
>
> **类型：** 环境配置  \
> **耗时：** 30 min  \
> **目标文件：** `apps/api/package.json`、`apps/api/src/plugins/metrics.ts`（新建）
>
> **执行步骤：**
> 1. 安装 Prometheus 客户端依赖：
>    ```bash
>    cd apps/api && pnpm add prom-client
>    ```
> 2. 在 `apps/api/src/plugins/` 目录创建 `metrics.ts`
>
> **验收：**
> - [ ] `prom-client` 出现在 `apps/api/package.json` dependencies
>
> **产出：** 依赖就绪，准备实现 metrics 插件

---

> **🃏 CARD-D8-02 · metrics.ts Prometheus 指标插件实现**
>
> **类型：** 新建文件  \
> **耗时：** 2.5h  \
> **目标文件：** `apps/api/src/plugins/metrics.ts`
>
> **函数签名模板（可直接复制）：**
>
> ```typescript
> import fp from 'fastify-plugin'
> import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
> import {
>   register,
>   Counter,
>   Histogram,
>   Gauge,
>   collectDefaultMetrics,
> } from 'prom-client'
>
> // ─── 指标定义 ─────────────────────────────────────────────────────────────────
>
> export const harnessErrorTotal = new Counter({
>   name: 'harness_error_total',
>   help: 'Total harness errors by platform and error type',
>   labelNames: ['platform', 'method', 'error_type'] as const,
> })
>
> export const apiLatencyHistogram = new Histogram({
>   name: 'api_request_duration_seconds',
>   help: 'HTTP API request latency in seconds',
>   labelNames: ['method', 'route', 'status_code'] as const,
>   buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
> })
>
> export const tenantRequestCounter = new Counter({
>   name: 'tenant_request_total',
>   help: 'Total requests by tenant and platform',
>   labelNames: ['tenant_id', 'platform'] as const,
> })
>
> export const agentHeartbeatGauge = new Gauge({
>   name: 'agent_heartbeat_last_timestamp',
>   help: 'Unix timestamp of last successful agent heartbeat',
>   labelNames: ['agent_type', 'tenant_id'] as const,
> })
>
> // ─── Fastify 插件 ─────────────────────────────────────────────────────────────
>
> async function metricsPlugin(fastify: FastifyInstance): Promise<void> {
>   collectDefaultMetrics({ register })
>
>   // /metrics 端点（Prometheus scrape）
>   fastify.get('/metrics', async (_req: FastifyRequest, reply: FastifyReply) => {
>     reply.type('text/plain; version=0.0.4')
>     return register.metrics()
>   })
>
>   // 请求延迟自动埋点（onResponse hook）
>   fastify.addHook('onResponse', (req, reply, done) => {
>     const route = req.routerPath ?? req.url
>     apiLatencyHistogram
>       .labels(req.method, route, String(reply.statusCode))
>       .observe(reply.elapsedTime / 1000)
>     done()
>   })
> }
>
> export default fp(metricsPlugin, {
>   name: 'metrics',
>   fastify: '4.x',
> })
> ```
>
> **Harness 错误上报辅助函数（在 Harness 层调用）：**
> ```typescript
> // packages/harness/src/metrics-reporter.ts（新建）
> export function reportHarnessError(platform: string, method: string, error: Error): void {
>   try {
>     // 动态导入避免循环依赖
>     const { harnessErrorTotal } = require('@patioer/api/plugins/metrics')
>     harnessErrorTotal.labels(platform, method, error.constructor.name).inc()
>   } catch {
>     // metrics 模块不可用时静默失败（测试环境）
>   }
> }
> ```
>
> **实现约束：**
> - `collectDefaultMetrics` 启用 Node.js 默认指标（event loop lag、heap 等）
> - `/metrics` 端点**不需要认证**（Prometheus scraper 内网访问）
> - `apiLatencyHistogram` bucket 覆盖 10ms 到 5s 范围
> - `agentHeartbeatGauge` 在 Agent 每次心跳成功时由 agent-runtime 更新
>
> **验收：**
> - [ ] `GET /metrics` 返回 `text/plain` 格式的 Prometheus 指标
> - [ ] 响应中包含 `harness_error_total`、`api_request_duration_seconds`、`tenant_request_total`
> - [ ] 发起若干 API 请求后 `api_request_duration_seconds_count` 递增
>
> **产出：** Prometheus 指标插件实现完毕，4 个核心指标已注册

---

> **🃏 CARD-D8-03 · server.ts 注册 metrics 插件**
>
> **类型：** 更新现有文件  \
> **耗时：** 20 min  \
> **目标文件：** `apps/api/src/server.ts`
>
> **执行步骤：**
> 1. 在 `server.ts` import 并注册 metrics 插件（在其他路由插件之前注册，确保 hook 覆盖所有请求）：
>    ```typescript
>    import metricsPlugin from './plugins/metrics.js'
>
>    // 在 fastify.register(routes...) 之前
>    await fastify.register(metricsPlugin)
>    ```
>
> **验收：**
> - [ ] 服务启动后 `curl localhost:3000/metrics` 返回指标数据
>
> **产出：** metrics 插件集成到 Fastify 服务器

---

> **🃏 CARD-D8-04 · metrics 集成验证**
>
> **类型：** 手动验证  \
> **耗时：** 30 min
>
> ```bash
> # 启动服务
> docker-compose up -d postgres redis
> cd apps/api && pnpm dev
>
> # 验证 /metrics 端点
> curl http://localhost:3000/metrics | grep -E "harness_error_total|api_request_duration|tenant_request_total|agent_heartbeat"
>
> # 发起几个 API 请求触发埋点
> curl http://localhost:3000/api/v1/products
> curl http://localhost:3000/api/v1/orders
>
> # 确认延迟指标已记录
> curl http://localhost:3000/metrics | grep "api_request_duration_seconds_count"
> ```
>
> **验收：**
> - [ ] `/metrics` 端点可正常访问
> - [ ] 4 个自定义指标（harness_error_total / api_request_duration_seconds / tenant_request_total / agent_heartbeat_last_timestamp）均出现在响应中
> - [ ] 发起 API 请求后 `api_request_duration_seconds_count` 递增
>
> **产出：** Prometheus 指标埋点端到端验证通过

---

> **🃏 CARD-D8-05 · Day 8 验收门禁**
>
> **类型：** 检查点  \
> **耗时：** 10 min
>
> ```bash
> pnpm -r typecheck
> cd apps/api && pnpm test -- --grep "metrics"
> ```
>
> **验收：**
> - [ ] `GET /metrics` 返回 4 个自定义指标
> - [ ] metrics 相关 TypeScript 无报错
>
> **产出：** Day 8 全部完成 · Prometheus 指标埋点就绪

---

**Day 8 卡片执行顺序汇总：**

```
09:00  CARD-D8-01  依赖安装与插件目录                  (30min)
09:30  CARD-D8-02  metrics.ts 指标插件实现              (2.5h)
12:00  CARD-D8-03  server.ts 注册 metrics 插件          (20min)
13:30  CARD-D8-04  metrics 集成验证                     (30min)
14:00  CARD-D8-05  Day 8 验收门禁                       (10min)
```

---

##### Day 9 — Amazon 真实凭证切换 + 端到端验证

---

> **🃏 CARD-D9-01 · 前提确认：SP-API 审核状态检查**
>
> **类型：** 外部操作确认  \
> **耗时：** 30 min  \
> **前提：** SP-API 审核从 Sprint 1 Day 1 提交，预计 Sprint 2-3 期间审核通过
>
> **执行步骤：**
> 1. 登录 Amazon Seller Central → Apps & Services → Manage Apps
> 2. 确认 Application Status 为 **Approved**（非 Pending）
> 3. 如审核**尚未通过**：
>    - 继续使用 Sandbox 模式
>    - 跳过 CARD-D9-03/D9-04，将本卡标记为 BLOCKED
>    - 在 Sprint Review 中记录外部风险
> 4. 如审核**已通过**：
>    - 从 Seller Central 获取 **真实 LWA Client ID + Client Secret + Refresh Token**
>    - 从 Seller Partner App 页面获取**生产环境 marketplace_id**
>
> **验收：**
> - [ ] SP-API 审核状态已确认（通过 or BLOCKED）
> - [ ] 若通过：真实凭证已安全存储到团队 Vault / 1Password
>
> **产出：** 凭证状态明确，可继续或标记风险

---

> **🃏 CARD-D9-02 · .env.staging 和凭证配置更新**
>
> **类型：** 环境配置（仅在审核通过时执行）  \
> **耗时：** 30 min  \
> **目标文件：** `.env.staging`（本地暂存，不提交 git）、`.env.example`（更新 KEY 列表）
>
> **执行步骤：**
> 1. 更新 `.env.staging`（对应生产前环境）：
>    ```
>    # Amazon SP-API 真实凭证（替换 sandbox 值）
>    AMAZON_REGION=NA
>    AMAZON_MARKETPLACE_ID=ATVPDKIKX0DER   # US marketplace
>    AMAZON_CLIENT_ID=amzn1.application-oa2-client.XXXXX
>    AMAZON_CLIENT_SECRET=<真实 secret>
>    AMAZON_REFRESH_TOKEN=<seller refresh token>
>    AMAZON_SELLER_ID=<seller ID>
>    AMAZON_USE_SANDBOX=false
>    ```
> 2. 更新 `.env.example`（无敏感值，仅 KEY 说明）：
>    ```
>    AMAZON_USE_SANDBOX=true   # 改为 false 时使用真实凭证
>    ```
> 3. **不提交** `.env.staging` 到 git（确认 `.gitignore` 已忽略）
>
> **验收：**
> - [ ] `.env.staging` 已更新真实凭证
> - [ ] `.gitignore` 包含 `.env.staging`
> - [ ] `.env.example` 包含 `AMAZON_USE_SANDBOX` 说明
>
> **产出：** 真实凭证环境就绪

---

> **🃏 CARD-D9-03 · AmazonHarness 凭证切换逻辑**
>
> **类型：** 更新现有文件  \
> **耗时：** 1h  \
> **目标文件：** `packages/harness/src/amazon.harness.ts`
>
> **执行步骤：**
> 1. 确认 `AmazonHarness` 构造函数支持 `useSandbox` 配置项：
>    ```typescript
>    export class AmazonHarness implements TenantHarness {
>      private readonly endpoint: string
>
>      constructor(private readonly tenantId: string, private readonly config: AmazonConfig) {
>        this.endpoint = config.useSandbox
>          ? 'https://sandbox.sellingpartnerapi-na.amazon.com'
>          : 'https://sellingpartnerapi-na.amazon.com'
>      }
>    }
>    ```
> 2. 确认 LWA Token 刷新逻辑读取 `config.refreshToken`（真实凭证不走沙盒 bypass）
> 3. 在 `agent-bootstrap.ts` 中根据 `AMAZON_USE_SANDBOX` 环境变量切换配置：
>    ```typescript
>    registerHarnessFactory('amazon', (tenantId) =>
>      new AmazonHarness(tenantId, {
>        clientId: process.env.AMAZON_CLIENT_ID!,
>        clientSecret: process.env.AMAZON_CLIENT_SECRET!,
>        refreshToken: process.env.AMAZON_REFRESH_TOKEN!,
>        sellerId: process.env.AMAZON_SELLER_ID!,
>        marketplaceId: process.env.AMAZON_MARKETPLACE_ID!,
>        useSandbox: process.env.AMAZON_USE_SANDBOX !== 'false',
>      }),
>    )
>    ```
>
> **验收：**
> - [ ] `AMAZON_USE_SANDBOX=false` 时 endpoint 切换为生产 URL
> - [ ] `AMAZON_USE_SANDBOX=true`（默认）时仍使用 sandbox URL
> - [ ] 凭证从环境变量读取，无硬编码
>
> **产出：** AmazonHarness 支持沙盒/真实凭证无缝切换

---

> **🃏 CARD-D9-04 · 真实凭证端到端验证**
>
> **类型：** 手动验证（仅在审核通过时执行）  \
> **耗时：** 1.5h
>
> **执行步骤：**
> ```bash
> # 1. 使用真实凭证启动 API
> source .env.staging
> export AMAZON_USE_SANDBOX=false
> cd apps/api && pnpm dev
>
> # 2. 触发 getProducts 调用（通过测试脚本或 Agent 心跳）
> curl -X POST http://localhost:3000/api/v1/agents/execute \
>   -H "Content-Type: application/json" \
>   -H "X-Tenant-Id: <test-tenant-id>" \
>   -d '{"agentType": "price-sentinel", "trigger": "manual"}'
>
> # 3. 查看日志中的 Amazon API 响应
> # 期望：真实商品数据（非 sandbox mock）
>
> # 4. 确认审计日志记录
> # SELECT * FROM agent_events WHERE created_at > NOW() - INTERVAL '5 minutes';
> ```
>
> **验收：**
> - [ ] Amazon 真实 `getProducts()` 返回至少 1 个真实商品（ASIN 存在于 Seller Central）
> - [ ] LWA Token 自动刷新无报错
> - [ ] 审计日志记录真实 API 调用
>
> **产出：** Amazon 真实凭证端到端验证通过（Sprint 3 核心验收项）

---

> **🃏 CARD-D9-05 · Day 9 验收门禁**
>
> **类型：** 检查点  \
> **耗时：** 15 min
>
> ```bash
> # 确认沙盒模式仍能正常工作（不破坏 CI）
> AMAZON_USE_SANDBOX=true pnpm -r test
>
> pnpm -r typecheck
> ```
>
> **验收：**
> - [ ] 沙盒模式所有测试通过（CI 不受影响）
> - [ ] 真实凭证端到端已验证（或 BLOCKED 状态已记录）
> - [ ] `AMAZON_USE_SANDBOX` 环境变量控制逻辑正确
>
> **产出：** Day 9 全部完成 · Amazon 凭证管理就绪

---

**Day 9 卡片执行顺序汇总：**

```
09:00  CARD-D9-01  SP-API 审核状态确认                 (30min)
09:30  CARD-D9-02  .env.staging 凭证配置更新           (30min)
10:00  CARD-D9-03  AmazonHarness 凭证切换逻辑          (1h)
11:00  CARD-D9-04  真实凭证端到端验证                   (1.5h)
14:00  CARD-D9-05  Day 9 验收门禁                      (15min)
```

---

##### Day 10 — Sprint 3 回归测试 + Sprint Review

---

> **🃏 CARD-D10-01 · 全量回归测试**
>
> **类型：** 验证  \
> **耗时：** 1.5h
>
> ```bash
> # 1. 全量测试（含所有新包）
> pnpm -r test
>
> # 2. 覆盖率报告
> pnpm -r test -- --coverage
>
> # 3. TypeScript 全量检查
> pnpm -r typecheck
>
> # 4. 构建检查
> pnpm -r build
> ```
>
> **期望结果：**
> - 所有包测试通过（packages/market + packages/harness + apps/api + packages/agent-runtime）
> - `packages/market` 覆盖率 ≥ 80%
> - `packages/harness` 覆盖率 ≥ 80%
> - `apps/api` 覆盖率 ≥ 80%
> - 0 TypeScript 错误
> - 构建全部成功
>
> **验收：**
> - [ ] `pnpm -r test` 全部通过，0 failed
> - [ ] 总体覆盖率 ≥ 80%
> - [ ] `pnpm -r build` 成功
>
> **产出：** Sprint 3 全量质量验证通过

---

> **🃏 CARD-D10-02 · Sprint 3 验收清单逐项确认**
>
> **类型：** 验收  \
> **耗时：** 1h
>
> **逐项验证：**
>
> | # | 验收项 | 验证命令 / 方法 | 状态 |
> |---|--------|----------------|------|
> | ✓1 | `convertPrice(100, 'SGD', 'USD')` 误差 < 0.01% | `pnpm test -- currency` 查看精度用例 | ⬜ |
> | ✓2 | ID 市场商品 PPN 11% 计算正确 | `calculateTax(100, 'ID').taxAmount ≈ 9.91` | ⬜ |
> | ✓3 | Amazon 真实 `getProducts()` 返回商品（非 sandbox） | Day 9 端到端验证结果 | ⬜ |
> | ✓4 | 多平台 Webhook 统一分发正常 | `pnpm test -- webhook` | ⬜ |
> | ✓5 | Prometheus `/metrics` 端点可用 | `curl localhost:3000/metrics` | ⬜ |
>
> **额外确认项：**
> - [ ] `HarnessRegistry.getHarness(tenantId, platform)` 多平台实例化正常
> - [ ] `checkCompliance` 禁售品检测正确拦截
> - [ ] `MarketContext` 可从 `@patioer/market` 正常导入并调用
>
> **产出：** Sprint 3 全部 5 项验收通过

---

> **🃏 CARD-D10-03 · CI pipeline 验证**
>
> **类型：** CI 验证  \
> **耗时：** 30 min
>
> **执行步骤：**
> 1. 提交所有 Sprint 3 代码变更：
>    ```bash
>    git add packages/market/ packages/harness/src/harness.registry.ts \
>            apps/api/src/lib/webhook-topic-handler.ts \
>            apps/api/src/plugins/metrics.ts \
>            apps/api/src/server.ts \
>            packages/harness/src/amazon.harness.ts
>    git commit -m "feat(sprint3): market harness, webhook unify, prometheus metrics"
>    git push origin feat/sprint3-...
>    ```
> 2. 在 GitHub Actions 观察 CI 流程
> 3. 确认全部 job 绿灯
>
> **验收：**
> - [ ] CI pipeline 全部通过（lint + typecheck + test）
> - [ ] 无新增 linter 警告
>
> **产出：** Sprint 3 代码通过 CI 验证，可合并 PR

---

> **🃏 CARD-D10-04 · Sprint 3 Review 与 Sprint 4 准备**
>
> **类型：** Sprint Review  \
> **耗时：** 45 min
>
> **Sprint 3 产出回顾：**
> ```
> Day 1  │ packages/market 脚手架 + types.ts + HarnessRegistry 接口设计
> Day 2  │ currency.ts 汇率 API + Redis 缓存（7 tests）
> Day 3  │ tax.ts 6 市场税务规则（9 tests）
> Day 4  │ compliance.ts 禁售品检测 + compliance-rules.ts（7 tests）
> Day 5  │ compliance.ts 认证要求 + market-context.ts（14 tests）
> Day 6  │ Market 包覆盖率补测 + HarnessRegistry 多平台实现（7 tests）
> Day 7  │ webhook-topic-handler.ts 多平台扩展 + 路由对接（5 tests）
> Day 8  │ metrics.ts Prometheus 指标插件 + server 注册
> Day 9  │ Amazon 真实凭证切换 + 端到端验证
> Day 10 │ 回归测试 + 验收清单 + CI 验证
> ```
>
> **Sprint 4 准备事项（本下午）：**
> 1. 确认 `packages/market` 已发布到 workspace（可被 `packages/agent-runtime` 引用）
> 2. 确认 `AgentContext` 扩展方案（Sprint 4 Task 4.1 前提）
> 3. 确认 `ads_campaigns` + `inventory_levels` Schema 设计（Sprint 4 Task 4.2）
> 4. 跟进 Amazon SP-API 审核状态（若 Day 9 仍为 BLOCKED）
> 5. 确认 TikTok Shop Sandbox 额度充足
>
> **验收：**
> - [ ] Sprint 3 所有 5 项验收通过并记录
> - [ ] Sprint 4 准备事项完成确认
>
> **产出：** Sprint 3 完成 · Sprint 4 启动条件就绪

---

**Day 10 卡片执行顺序汇总：**

```
09:00  CARD-D10-01  全量回归测试                        (1.5h)
10:30  CARD-D10-02  Sprint 3 验收清单逐项确认           (1h)
13:30  CARD-D10-03  CI pipeline 验证                    (30min)
14:00  CARD-D10-04  Sprint Review + Sprint 4 准备        (45min)
```

---

#### Sprint 3 · 每日产出汇总

```
Day 1  │ packages/market 脚手架 + types.ts stub 文件 │ HarnessRegistry 接口设计
Day 2  │ currency.ts 汇率 API + Redis 缓存 (7 tests) │ convertPrice 精度 < 0.01%
Day 3  │ tax.ts 6 市场税务规则 (9 tests) │ ID PPN 11% 含税反推
Day 4  │ compliance-rules.ts 常量 + compliance.ts 禁售品检测 (7 tests)
Day 5  │ compliance.ts 认证要求 (9 tests) + market-context.ts MarketContext (5 tests)
Day 6  │ Market 包覆盖率补测 (≥ 40 tests) + HarnessRegistry 多平台实现 (7 tests)
Day 7  │ webhook-topic-handler.ts Amazon/TikTok/Shopee 多平台扩展 (5 tests)
Day 8  │ metrics.ts Prometheus 指标插件 + /metrics 端点可用
Day 9  │ AmazonHarness 凭证切换逻辑 + 真实 getProducts() 端到端验证
Day 10 │ 全量回归 (≥ 80% 覆盖率) + Sprint 验收清单 + CI 绿灯
```

---

### Sprint 4 · Week 7–8 — 2 个新 Agent + Tenant Onboarding

**交付物：** Ads Optimizer / Inventory Guard Agent、租户自助 Onboarding 4 步流程、Agent 种子扩展到 5 个

| # | 任务 | 包/目录 | 依赖 | 估时 |
|---|------|---------|------|------|
| 4.1 | `AgentContext` 扩展：`getHarness(platform)` 多平台 + `getEnabledPlatforms()` + `MarketContext` 注入 | `packages/agent-runtime` | S3 完成 | 1.5d |
| 4.2 | `ads-campaigns` schema + `inventory_levels` schema（Drizzle） | `packages/db` | — | 0.5d |
| 4.3 | Ads Optimizer Agent：每 4h 心跳、跨平台广告数据聚合、ROAS ≥ 3x 目标、日预算 >$500 审批 | `packages/agent-runtime` | 4.1, S3.5 | 2d |
| 4.4 | Inventory Guard Agent：每天 08:00、跨平台库存监控、安全库存阈值告警、补货建议 Ticket | `packages/agent-runtime` | 4.1 | 1.5d |
| 4.5 | 广告 API routes：`GET /api/v1/ads/campaigns` / `GET /api/v1/ads/performance` | `apps/api` routes | 4.2 | 0.5d |
| 4.6 | 库存 API routes：`GET /api/v1/inventory` / `GET /api/v1/inventory/alerts` | `apps/api` routes | 4.2 | 0.5d |
| 4.7 | Governance Gates 扩展：`setAdsBudget` 日预算 >$500 审批 + `adjustInventory` 补货需人工确认 | `apps/api` + `packages/agent-runtime` | 4.3 | 1d |
| 4.8 | Tenant Onboarding API：4 步流程（注册 → 平台授权 → Agent 初始化 → 健康检查） | `apps/api` routes/onboarding | 4.1 | 1.5d |
| 4.9 | `agents.seed.ts` 扩展：5 Agent 种子（3 原有 + Ads Optimizer + Inventory Guard） | `scripts/` | 4.3, 4.4 | 0.5d |
| 4.10 | Onboarding 健康检查：每平台 Harness 调用测试 + Agent 心跳触发验证 | `apps/api` | 4.8 | 0.5d |

**Sprint 4 验收：**
- [ ] Ads Optimizer 每 4h 触发，日志可查
- [ ] 广告日预算 >$500 触发审批 Ticket
- [ ] Inventory Guard 每天 08:00 触发，低库存生成告警 Ticket
- [ ] 5 Agent 种子一键初始化
- [ ] Onboarding 4 步完整流程 < 30 分钟

#### Sprint 4 · 每日实施计划（Day by day）

> **前提（Sprint 3 末 CARD-D10-04）：** `AgentContext` 扩展方案已定稿；`ads_campaigns` / `inventory_levels` 字段与 RLS 策略已评审。  
> **半天粒度：** 以下「上午 / 下午」按各约 3.5–4h 有效开发时间计，可按实际会议弹性微调。

**方案 A — 2 人并行（推荐）**

| Day | 开发者 A（Agent / Governance / Seed） | 开发者 B（Schema / API / Onboarding） |
|-----|----------------------------------------|----------------------------------------|
| 1 上午 | 4.1 `AgentContext`：`getHarness` / `getEnabledPlatforms` / `market` 注入（启动） | 4.2 `ads_campaigns` + `inventory_levels` Drizzle + migration 草稿 |
| 1 下午 | 4.1 继续：与 `HarnessRegistry`、执行路径联调 | 4.2 收尾：RLS policy、与现有 `0001` 风格对齐；本地 migrate 验证 |
| 2 上午 | 4.3 Ads Optimizer：心跳 schedule、跨平台拉数骨架 | 4.5 + 4.6：广告 / 库存 GET routes（读 DB + 鉴权/租户） |
| 2 下午 | 4.3：ROAS 目标、日预算分支、与 Ticket/审批钩子 | 4.5/4.6 收尾 + route 冒烟测试 |
| 3 上午 | 4.3：聚合逻辑、日志与 `agent_events`（若已有） | 4.8 Onboarding：Step 1–2（register + OAuth 回调骨架） |
| 3 下午 | 4.3 收尾；开始 4.7：`setAdsBudget` >$500 → 待审批 | 4.8：Step 3–4（Agent 初始化 + 健康检查 API 壳） |
| 4 上午 | 4.4 Inventory Guard：08:00 cron、跨平台 `getInventoryLevels` | 4.8 与 4.1 对接：执行链上 `getHarness` 实测 |
| 4 下午 | 4.4：阈值告警、补货建议 Ticket | 4.8 收尾：四步串起来、错误码与超时 |
| 5 上午 | 4.7：Governance 收尾（`adjustInventory` 需人工确认） | 4.10：每平台 Harness 探测 + 心跳触发验证 |
| 5 下午 | 4.9 `agents.seed.ts` 五 Agent 种子 | 4.10 收尾；与 A 联调 Onboarding 端到端 |
| 6 | 双人联调：§Sprint 4 验收清单逐项过、P0/P1 缺陷 | 同左 |
| 7–8 | 全量回归、`pnpm vitest`、CI 绿、演示租户数据 | 同左 |
| 9–10 | 缓冲：补测试、文档缺口；**可选** OpenAPI 条目（与 Sprint 6 Task 6.7 衔接） | 可选 |

**方案 B — 1 人串行（无并行）**

> 以下按 **任务 · 质量门禁 · 交付与验收** 组织，实施时以 **当日验收项全部打勾** 为 Day Done；未达标则 **不进入下一日**。

**总览（任务映射）**

> **说明：** 下表按 **每个工作日同级展开**（与上文「Day 1」粒度一致）。单人串行时原合并项（如 4.3 两日、4.8 两日）拆成 **Day 1–Day 12**；若迭代强约束 **10 个日历日**，可将 **Day 4+5**、**Day 8+9**、**Day 11+12** 按组合并实施，验收表仍按条目逐项勾验。

| Day | 覆盖任务 | 粗粒度产出 |
|-----|----------|------------|
| 1 | 4.1 | `AgentContext` 多平台 + `MarketContext` 注入可执行 |
| 2 | 4.2 | `ads_campaigns` / `inventory_levels` + migration + RLS |
| 3 | 4.5、4.6 | 广告 / 库存只读 API |
| 4 | 4.3（上） | Ads Optimizer：调度 / 跨平台拉数 / 骨架与可观测 |
| 5 | 4.3（下） | Ads Optimizer：ROAS / 日预算分支 / 与审批钩子对接 |
| 6 | 4.4 | Inventory Guard Agent 全量 |
| 7 | 4.7 | Governance：`setAdsBudget` / `adjustInventory` 门控 |
| 8 | 4.8（上） | Onboarding：注册 + 平台授权（OAuth 回调） |
| 9 | 4.8（下） | Onboarding：Agent 初始化 + 健康检查 API |
| 10 | 4.9 | 五 Agent `agents.seed.ts` |
| 11 | 4.10 | Onboarding 健康检查（Harness + 心跳） |
| 12 | — | Sprint 4 整体验收与回归 |

---

##### Day 1 · Task 4.1 — `AgentContext` 多平台 + `MarketContext`

**任务（当日必须完成的工作单元）**

1. **接口与类型**：在 `packages/agent-runtime`（或当前 `AgentContext` 定义处）扩展 `AgentContext`：`getHarness(platform?: string)`、`getEnabledPlatforms(): string[]`、`market: MarketContext`；与 §5.4 / Sprint 3 已定稿方案一致。  
2. **实现**：从租户已授权平台（如 `platform_credentials` + `HarnessRegistry`）解析 `getEnabledPlatforms()`；`getHarness(platform)` 返回对应 `TenantHarness`，未授权平台行为明确（抛错或 `null` 策略写清并一致）。  
3. **注入**：`MarketContext` 使用 `packages/market` 已有实现（S3.5），在执行链（如 `/api/v1/agents/:id/execute` 构建 context 处）完成注入，避免 Agent 内重复 new。  
4. **联调最小闭环**：至少一条真实或集成测试路径调用 `getHarness` + `market`（可为 test double），确保非「仅编译通过」。

**质量门禁（当日合并前必须满足）**

- **测试**：新增或扩展单测/集成测，覆盖「多平台列表非空」「请求某平台 harness」「`market.convertPrice` 或等价方法可被调用」；相关包 `pnpm vitest run` 通过。  
- **类型与安全**：不放宽 `strict`；对 `platform` 字符串建议与现有 harness 注册名对齐（大小写约定文档化）。  
- **租户隔离**：`getEnabledPlatforms` / `getHarness` 仅基于**当前请求租户**数据，不泄漏其他租户凭证信息。  
- **可观测**：日志或现有 metrics 中可区分「多平台 context 构建成功 / 失败原因」（无需新指标也可，至少结构化日志一条）。

**交付物与验收标准（Day 1 结束可签字）**

| 序号 | 交付物 | 验收标准（满足即 ✓） |
|------|--------|----------------------|
| D1-01 | 代码合并 | `AgentContext` 扩展已合入主开发分支，CI 绿。 |
| D1-02 | `getHarness` / `getEnabledPlatforms` | 测试用例中断言行为与产品设计一致；未授权平台错误可预期。 |
| D1-03 | `market` 注入 | 执行路径中 Agent 或测试桩可访问 `ctx.market`，且来自 `packages/market`。 |
| D1-04 | 文档 | 代码旁或 `docs/` 短注：`platform` 可选时的语义、平台名与 Registry 键名对照。 |

**当日不纳入（避免范围蔓延）**：不实现 Ads/Inventory 业务逻辑（属 4.3–4.4）；不写 `ads_campaigns` 表（属 Day 2）。

---

##### Day 2 · Task 4.2 — `ads_campaigns` + `inventory_levels`（Drizzle + migration + RLS）

**任务（当日必须完成的工作单元）**

1. **Drizzle schema**：在 `packages/db` 增加 `ads_campaigns`、`inventory_levels` 表定义，字段与 §4.2 `ads_campaigns` / §4.3 `inventory_levels` 及外键（`tenant_id`、`product_id` 等）一致。  
2. **SQL migration**：新增 migration 文件（如 `0002_phase2.sql` 或仓库下一序号）；`ENABLE ROW LEVEL SECURITY` / `FORCE ROW LEVEL SECURITY`；`tenant_isolation` policy 与 `0001_rls.sql` 风格一致。  
3. **导出与类型**：`packages/db` 对外 re-export；迁移在本地 PG **up** 成功；若有 seed 占位行，不污染生产策略。  
4. **RLS 验证**：编写测试或脚本：在 `set_config('app.tenant_id', ...)` 下仅能读写本租户行；跨租户 `SELECT` 为空或拒绝。

**质量门禁（当日合并前必须满足）**

- **迁移**：`down`/`up` 或团队约定的一次性策略明确；CI 或本地文档记录如何应用。  
- **一致性**：表名、列名与 §4 文档、后续 4.5/4.6 API 约定对齐，避免 Day 3 大规模改名。  
- **测试**：至少 1 个针对 RLS 或 repository 的自动化测试（可为 integration）。  
- **无业务逻辑**：本日不写 Ads Agent、不写 HTTP route（属 Day 3+）。

**交付物与验收标准（Day 2 结束可签字）**

| 序号 | 交付物 | 验收标准（满足即 ✓） |
|------|--------|----------------------|
| D2-01 | Schema 代码 | 两表 Drizzle 定义已合并，TypeScript 无报错。 |
| D2-02 | Migration | 本地/CI PG 执行 migration 成功，`\d` 可见新表。 |
| D2-03 | RLS | Policy 生效；自动化或记录在案的跨租户否定用例通过。 |
| D2-04 | 导出 | 其他包可 `import` 新表类型；无循环依赖。 |

**当日不纳入**：`GET /api/v1/ads/*`、`/inventory/*`（属 Day 3）；Agent 同步写表（属 4.3/4.4）。

---

##### Day 3 · Task 4.5、4.6 — 广告 / 库存只读 API

**任务（当日必须完成的工作单元）**

1. **路由**：实现 `GET /api/v1/ads/campaigns`、`GET /api/v1/ads/performance`、`GET /api/v1/inventory`、`GET /api/v1/inventory/alerts`（路径以项目现有 `/api/v1` 惯例为准）。  
2. **数据**：从 Day 2 表读取；空表返回稳定 JSON（如 `[]` / `{ "items": [] }`，与项目统一）。  
3. **安全**：与现有路由相同的 auth + 租户解析；`tenant_id` 来自会话/RLS，禁止 query 参数跨租户。  
4. **注册**：在 `app.ts` 或路由聚合处注册；与 smoke test 列表同步（若项目有 `app.smoke.test.ts`）。

**质量门禁（当日合并前必须满足）**

- **测试**：每路由至少 handler 单测或集成测 1 则；401/403/200 行为明确。  
- **性能**：列表查询带 `tenant` 限定；大表预留 `limit`（若已有分页中间件则接入）。  
- **文档**：响应 JSON 形状在代码注释或 OpenAPI 草稿中可查找（可与 Sprint 6.7 合并补全）。

**交付物与验收标准（Day 3 结束可签字）**

| 序号 | 交付物 | 验收标准（满足即 ✓） |
|------|--------|----------------------|
| D3-01 | 四路由可用 | 带有效租户凭证时四端点均 200；形态符合约定。 |
| D3-02 | 鉴权 | 无凭证 / 错误租户时行为与现有 API 一致。 |
| D3-03 | 测试 | 相关 `vitest` 通过；CI 绿。 |
| D3-04 | 可观测 | 错误路径有日志级别与 request id（若项目已有）。 |

**当日不纳入**：Ads Optimizer 定时写库（属 4.3）；Governance 写预算（属 Day 7）。

---

##### Day 4 · Task 4.3（上）— Ads Optimizer：调度、跨平台拉数、骨架

**任务（当日必须完成的工作单元）**

1. **Agent 骨架**：在 `packages/agent-runtime`（或约定目录）建立 Ads Optimizer Agent 模块；与 Paperclip/心跳约定对齐（**每 4h** 触发配置可查）。  
2. **多平台**：通过 `ctx.getEnabledPlatforms()` / `ctx.getHarness(platform)` 拉取各平台广告能力（`isAdsCapable` 等 §5.1）；无能力平台跳过并记日志。  
3. **数据落库**：将同步结果写入 `ads_campaigns`（或先内存再写入，以当日可测为准）；`synced_at` 更新。  
4. **可观测**：结构化日志含 `agentId`、`platforms`、`runId`；若已有 metrics，增加计数或 histogram 钩子（可选）。

**质量门禁（当日合并前必须满足）**

- **测试**：对「多平台列表为空」「单平台 mock」「写库失败」至少各 1 条覆盖。  
- **幂等**：重复执行不产生重复主键或唯一冲突（依赖 `platform_campaign_id` 唯一策略）。  
- **不完成 ROAS/审批**：复杂策略可留 Day 5，但代码边界清晰（TODO 与接口分离）。

**交付物与验收标准（Day 4 结束可签字）**

| 序号 | 交付物 | 验收标准（满足即 ✓） |
|------|--------|----------------------|
| D4-01 | 调度 | 配置或 cron 表达式可证明 4h 周期；本地可手动触发一次 run。 |
| D4-02 | 跨平台拉数 | 日志中可见每平台尝试结果；mock 下全路径可跑通。 |
| D4-03 | 持久化 | `ads_campaigns` 有合理行或等价集成测断言。 |
| D4-04 | CI | 相关测试绿，无 flaky。 |

**当日不纳入**：ROAS ≥ 3x 完整策略、日预算 >$500 审批闭环（属 Day 5–7）；Inventory Agent（属 Day 6）。

---

##### Day 5 · Task 4.3（下）— Ads Optimizer：ROAS、日预算分支、审批钩子

**任务（当日必须完成的工作单元）**

1. **策略**：实现 ROAS 目标与优化动作（调 bid / 调 budget）的**决策模块**；边界条件单测覆盖。  
2. **日预算 >$500**：在调用 `updateAdsBudget` 前计算新日预算；若 \>$500（或约定货币换算后）则 **不直接写平台**，改为创建/关联审批 Ticket（与现有 Ticket 模型一致）；Day 7 将加固为最终 Governance。  
3. **联调**：至少一次端到端：mock harness 或沙盒下「需审批」路径产生 Ticket 记录或日志等价物。  
4. **日志**：每次 run 输出「触发原因」「是否进入审批」可检索关键词。

**质量门禁（当日合并前必须满足）**

- **测试**：ROAS 纯函数测试；日预算 499 vs 501（或美分整数）边界测试。  
- **安全**：审批前绝无未授权写操作调用。  
- **与 §Sprint 4 对齐**：验收项「每 4h 触发」「日预算 >$500 触发审批 Ticket」本日可演示或自动化断言。

**交付物与验收标准（Day 5 结束可签字）**

| 序号 | 交付物 | 验收标准（满足即 ✓） |
|------|--------|----------------------|
| D5-01 | ROAS 逻辑 | 单测覆盖主要分支；与产品目标（如 ≥3x）一致。 |
| D5-02 | 审批分支 | \>$500 时走 Ticket，不调用平台写 budget。 |
| D5-03 | 可观测 | 日志满足 §Sprint 4「日志可查」的最低要求。 |
| D5-04 | 回归 | Day 4 测试仍绿；无破坏性改动。 |

**当日不纳入**：Governance 统一门控抽象（属 Day 7）；Inventory（Day 6）。

---

##### Day 6 · Task 4.4 — Inventory Guard Agent

**任务（当日必须完成的工作单元）**

1. **调度**：每日 **08:00** 触发（时区文档化：`TZ` 或租户默认时区策略二选一并写明）。  
2. **库存**：`isInventoryCapable` 各平台 `getInventoryLevels`；聚合写入/对比 `inventory_levels`；`status` 与 `safety_threshold` 更新。  
3. **告警**：低于阈值生成 **补货建议 Ticket**（类型与现有 Ticket 一致）；含 SKU/平台/建议数量等上下文。  
4. **联调**：低库存场景可在测试中用固定数据触发。

**质量门禁（当日合并前必须满足）**

- **测试**：cron 解析或时区单测；低库存路径单测；空库存/零阈值边界。  
- **租户隔离**：仅当前租户库存参与判断。  
- **与 §Sprint 对齐**：「每天 08:00」「低库存 Ticket」可验证。

**交付物与验收标准（Day 6 结束可签字）**

| 序号 | 交付物 | 验收标准（满足即 ✓） |
|------|--------|----------------------|
| D6-01 | 调度 | 08:00 规则可配置且文档化；手动触发可测。 |
| D6-02 | 数据 | `inventory_levels` 反映同步结果；状态机合理。 |
| D6-03 | Ticket | 低库存时创建 Ticket；内容可人工读懂。 |
| D6-04 | 测试 | `vitest` 覆盖核心路径；CI 绿。 |

**当日不纳入**：`adjustInventory` 人工确认门控（属 Day 7）；Onboarding（Day 8–9）。

---

##### Day 7 · Task 4.7 — Governance Gates

**任务（当日必须完成的工作单元）**

1. **`setAdsBudget`**：统一入口：凡日预算调整 \>$500 必须 **已审批** 才调用 Harness；与 Day 5 Ticket 状态机对接（`approved` / `pending`）。  
2. **`adjustInventory`**：补货数量或金额超阈值时 **需人工确认**；未确认不调用 `adjustInventory`。  
3. **落点**：门控放在 API 层或 Agent 调用栈的单一 choke point，避免重复检查。  
4. **审计**：可选 `agent_events` 或审计表记录「拒绝原因」「审批 id」。

**质量门禁（当日合并前必须满足）**

- **测试**：499/501、`pending` 审批、`approved` 后成功写；inventory 未确认拒绝写。  
- **一致性**：与 Day 5–6 行为无矛盾；文档更新门控规则摘要。

**交付物与验收标准（Day 7 结束可签字）**

| 序号 | 交付物 | 验收标准（满足即 ✓） |
|------|--------|----------------------|
| D7-01 | 广告门控 | 未批准时零平台写；批准后写成功且可追踪。 |
| D7-02 | 库存门控 | 未确认时零 `adjustInventory` 调用。 |
| D7-03 | 单测 | 边界与状态组合覆盖；CI 绿。 |
| D7-04 | 文档 | 门控规则与 Ticket 状态对照表（短注即可）。 |

**当日不纳入**：Onboarding UI（Phase 3）；DevOS（Sprint 5）。

---

##### Day 8 · Task 4.8（上）— Onboarding：注册 + 平台授权

**任务（当日必须完成的工作单元）**

1. **Step 1 注册**：`POST` 创建租户、初始化 RLS、与现有 `tenants` 流程一致；返回后续 OAuth 所需 id/令牌。  
2. **Step 2 授权**：平台选择 → OAuth/LWA/HMAC 等按现有 `platform_credentials` 扩展字段落地；回调路由保存加密 token；`HarnessRegistry` 可解析。  
3. **错误**：重复注册、OAuth 失败、state 不匹配等返回码稳定；敏感信息不入日志。  
4. **测试**：注册 + 单平台 mock OAuth 回调集成测（可用 stub）。

**质量门禁（当日合并前必须满足）**

- **安全**：HTTPS/回调 URL 配置校验；state/nonce；token 加密存储与 Phase 1 一致。  
- **测试**：至少 1 条集成路径；401/400 覆盖。

**交付物与验收标准（Day 8 结束可签字）**

| 序号 | 交付物 | 验收标准（满足即 ✓） |
|------|--------|----------------------|
| D8-01 | 注册 API | 新租户可创建且 DB 可查；RLS 上下文可设置。 |
| D8-02 | OAuth 回调 | 至少一平台完整回调链路（真实或沙盒）。 |
| D8-03 | 凭证 | `platform_credentials` 行正确；Harness 可实例化。 |
| D8-04 | 日志 | 无 token 明文；错误可诊断。 |

**当日不纳入**：Agent 初始化与心跳（属 Day 9）；`agents.seed`（Day 10）。

---

##### Day 9 · Task 4.8（下）— Onboarding：Agent 初始化 + 健康检查 API

**任务（当日必须完成的工作单元）**

1. **Step 3**：执行或触发 `agents.seed` 等价逻辑（若 Day 10 才脚本化，本日至少 API 可调通创建 5 Agent 记录 + Paperclip 注册 + 预算占位）。  
2. **Step 4 壳**：`GET` 或 `POST` 健康检查端点：定义「每平台一次轻量 Harness 调用」的接口契约（具体探测与 Day 11 可分层）。  
3. **串联**：从 Step 1 到 Step 4 可脚本化顺序执行；总耗时目标为 §「&lt; 30 分钟」留足 OAuth 人工时间。  
4. **文档**：四步顺序、环境变量、常见失败码一页内可读完。

**质量门禁（当日合并前必须满足）**

- **测试**：四步集成测或 e2e（可 headless mock）。  
- **超时**：每步默认超时与重试策略写明。

**交付物与验收标准（Day 9 结束可签字）**

| 序号 | 交付物 | 验收标准（满足即 ✓） |
|------|--------|----------------------|
| D9-01 | Agent 初始化 | 5 Agent 业务上可创建（与 Day 10 种子一致或可合并）。 |
| D9-02 | 健康 API | 端点存在且返回结构化 JSON（含每平台状态占位）。 |
| D9-03 | 流程 | 计时一次完整四步 &lt; 30 min（文档记前提：含人工点击）。 |
| D9-04 | 测试 | 集成测绿；无 P0 泄漏。 |

**当日不纳入**：生产级心跳端到端（Day 11）；种子脚本 polish（Day 10）。

---

##### Day 10 · Task 4.9 — `agents.seed.ts` 五 Agent

**任务（当日必须完成的工作单元）**

1. **扩展种子**：在 `scripts/`（或约定路径）将 Agent 扩至 **5** 个：保留原 3 + **Ads Optimizer** + **Inventory Guard**；id/slug 稳定。  
2. **依赖**：与 Paperclip、DB、预算字段一致；重复执行语义文档化（upsert / skip）。  
3. **CI**：若允许，增加 dry-run 或短 smoke；否则 Makefile/README 一条命令可复制。  
4. **对齐**：与 Day 9 Onboarding 中「初始化 Agent」使用同一数据来源或调用同一模块。

**质量门禁（当日合并前必须满足）**

- **幂等**：二次执行不爆炸、不重复扣费/预算（若适用）。  
- **测试**：脚本级或单元测覆盖核心分支。

**交付物与验收标准（Day 10 结束可签字）**

| 序号 | 交付物 | 验收标准（满足即 ✓） |
|------|--------|----------------------|
| D10-01 | 五 Agent | §「5 Agent 种子一键初始化」命令成功。 |
| D10-02 | 一致性 | Dashboard/DB 中可见五角色定义正确。 |
| D10-03 | 文档 | README 或 ops 笔记含命令与 env。 |
| D10-04 | CI | 不破坏流水线；若有 smoke 则绿。 |

**当日不纳入**：深度健康探测（Day 11）。

---

##### Day 11 · Task 4.10 — Onboarding 健康检查（Harness + 心跳）

**任务（当日必须完成的工作单元）**

1. **Harness**：对 `getEnabledPlatforms()` 每平台执行轻量调用（如 `getProducts` 限 1 条）；失败写入检查报告。  
2. **心跳**：触发一次 Agent execute/heartbeat（与 Paperclip 约定一致），验证链路可达。  
3. **响应**：健康检查 JSON 含 `platforms[]`、`agentHeartbeats[]`、总体 `ok`。  
4. **失败策略**：单平台失败不掩盖整体状态；便于客服排查。

**质量门禁（当日合并前必须满足）**

- **测试**：mock harness 全绿；mock 单平台失败场景。  
- **隔离**：仅当前租户数据与凭证。

**交付物与验收标准（Day 11 结束可签字）**

| 序号 | 交付物 | 验收标准（满足即 ✓） |
|------|--------|----------------------|
| D11-01 | 每平台探测 | 日志/JSON 可证每平台至少一次调用。 |
| D11-02 | 心跳 | 一次心跳成功或明确错误码（与 AC 对齐）。 |
| D11-03 | 新租户 | 走完 Onboarding 后调用健康检查可得预期结果。 |
| D11-04 | 测试 | CI 绿。 |

**当日不纳入**：Sprint 6 压测；OpenAPI 全文（Sprint 6.7）。

---

##### Day 12 — Sprint 4 整体验收与回归

**任务（当日必须完成的工作单元）**

1. **清单**：逐项核对 §**Sprint 4 验收** 五项 + 本方案 B 各日 D\*-** 遗留项。  
2. **缺陷**：P0/P1 清零或登记豁免与负责人。  
3. **回归**：全仓 `pnpm vitest`（或项目命令）；与 `ci.yml` 一致。  
4. **债务**：已知问题列表；可选 OpenAPI/运维备注移交 Sprint 6。

**质量门禁（当日合并前必须满足）**

- **CI**：主分支绿；覆盖率不低于团队 Sprint 门禁（若 §Phase 2 有数值则遵守）。  
- **无静默降级**：验收项未达标不得标为完成。

**交付物与验收标准（Day 12 / Sprint 4 结束可签字）**

| 序号 | 交付物 | 验收标准（满足即 ✓） |
|------|--------|----------------------|
| D12-01 | §Sprint 4 验收 | 五项全部 ✓ 或已批准豁免。 |
| D12-02 | 测试与 CI | 全量测试通过；CI 绿。 |
| D12-03 | 已知问题 | 列表完整，含严重度与后续 Sprint。 |
| D12-04 | 演示 | 可按脚本复现核心路径（Ads / Inventory / Onboarding）。 |

**当日不纳入**：Sprint 5 DevOS、Sprint 6 全量 20 项（按 Phase 2 路线图）。

---

**每日产出汇总（简表，便于站会对照）**

```
方案 A（并行）· Day 1–5 核心交付
Day 1  │ 4.1 AgentContext 可运行 │ 4.2 两表 + RLS migration
Day 2  │ 4.3 Ads 骨架 + 半套业务规则 │ 4.5/4.6 广告与库存只读 API
Day 3  │ 4.3 收尾 + 4.7 启动 │ 4.8 Onboarding 大半完成
Day 4  │ 4.4 Inventory Guard 全 │ 4.8/4.10 联调
Day 5  │ 4.7/4.9 收尾 │ 4.10 + 五 Agent 种子

方案 B（串行 · Day 1–12 同级展开）
Day 1   │ 4.1 AgentContext
Day 2   │ 4.2 两表 + RLS
Day 3   │ 4.5 / 4.6 只读 API
Day 4–5 │ 4.3 Ads Optimizer（上/下）
Day 6   │ 4.4 Inventory Guard
Day 7   │ 4.7 Governance
Day 8–9 │ 4.8 Onboarding（上/下）
Day 10  │ 4.9 五 Agent seed
Day 11  │ 4.10 健康检查
Day 12  │ Sprint 4 整体验收
```

---

### Sprint 5 · Week 9–10 — DevOS 基础结构

**交付物：** DevOS 独立 Paperclip 实例、SRE Agent、Ticket 协议、Prometheus 告警联动

| # | 任务 | 包/目录 | 依赖 | 估时 |
|---|------|---------|------|------|
| 5.1 | `packages/devos-bridge` 脚手架：package.json、tsconfig、types | `packages/devos-bridge` | — | 0.5d |
| 5.2 | `DevOsTicket` 协议定义：type / priority / SLA / context 类型 | `packages/devos-bridge` | 5.1 | 0.5d |
| 5.3 | `DevOsClient` HTTP 客户端：创建 Ticket / 查询状态 / acknowledge / resolve | `packages/devos-bridge` | 5.2 | 1d |
| 5.4 | `docker-compose.devos.yml`：DevOS Paperclip 实例（端口 3200）+ 独立 DB | root | — | 1d |
| 5.5 | `devos-seed.ts`：DevOS Engineering Org Chart + SRE Agent 初始化 | `scripts/` | 5.4 | 0.5d |
| 5.6 | ElectroOS → DevOS 自动 Ticket：Harness 报错时自动创建 `harness_update` 类型 Ticket | `packages/devos-bridge` + `packages/harness` | 5.3 | 1d |
| 5.7 | SRE Agent 配置：Prometheus 告警规则（harness_error_rate >5% → P0、heartbeat_missed → P1、latency_p99 >5s → P1、db_pool >90% → P0） | `packages/devos-bridge` | 5.5, S3.10 | 1d |
| 5.8 | Prometheus → SRE Agent 告警通道：alertmanager webhook → DevOS Ticket → SRE Agent 生成响应 Ticket | `packages/devos-bridge` | 5.7 | 1.5d |
| 5.9 | `devos-tickets` schema（ElectroOS 侧记录已上报 Ticket）+ RLS | `packages/db` | 5.2 | 0.5d |
| 5.10 | DevOS 隔离验证：DevOS DB 与 ElectroOS DB 完全独立 | `tests/` | 5.4 | 0.5d |
| 5.11 | DevOS Bridge 测试套件 | `packages/devos-bridge` | 5.3, 5.6 | 1d |

**Sprint 5 验收：**
- [ ] DevOS Paperclip 实例端口 3200 运行正常
- [ ] ElectroOS Harness 报错后 DevOS 自动收到 Ticket
- [ ] SRE Agent alertRule 正确匹配 Prometheus 指标
- [ ] DevOS 数据库与 ElectroOS 数据库完全独立

**每日产出汇总（简表，10 个工作日 · 站会对照）**

> 与上方任务表一致：5.1→5.2→5.3 串行；5.4 可与 5.1 并行；5.9 依赖 5.2；5.10 依赖 5.4；5.6 依赖 5.3；5.7 依赖 5.5 + Sprint 3 Prometheus 埋点（S3.10）；5.8 依赖 5.7；5.11 依赖 5.3 与 5.6。

```
Day 1  │ 5.1 devos-bridge 脚手架 │ 5.4 docker-compose.devos（Paperclip :3200 + 独立 DB）起盘
Day 2  │ 5.2 DevOsTicket 协议 │ 5.4 收尾 / 健康检查 │ 5.9 devos_tickets schema + RLS（可与 5.2 同 PR 收尾）
Day 3  │ 5.3 DevOsClient（创建 / 查询 / ack / resolve）│ 5.10 DevOS↔ElectroOS DB 隔离验证
Day 4  │ 5.5 devos-seed（Org + SRE Agent）│ 5.3 联调收尾
Day 5  │ 5.6 Harness 报错 → DevOS `harness_update` Ticket（ElectroOS + harness）
Day 6  │ 5.7 SRE Agent：Prometheus 告警规则（依赖现有 `/metrics` 与 S3.10）
Day 7  │ 5.7 规则与指标对齐 / 本地或 staging 冒烟
Day 8  │ 5.8 Alertmanager webhook → DevOS Ticket → SRE 响应（上）
Day 9  │ 5.8 通道收尾、端到端演练（伪造告警 → Ticket）
Day 10 │ 5.11 DevOS Bridge 测试套件 │ Sprint 5 验收 checklist 全绿
```

#### Sprint 5 · Day 1 — 可复制任务卡（5.1 脚手架 + 5.4 compose 起盘）

按卡片顺序实现即可；**5.1 与 5.4 可并行两个 PR**。类型与 env 名可在 Day 2（5.2 协议）收紧，此处仅保证包可 `build` / `test`。

---

**卡片 5.1-a — 包元数据（无逻辑）**

| 文件 | 动作 |
|------|------|
| `packages/devos-bridge/package.json` | `name`: `@patioer/devos-bridge`，`type`: `module`，脚本对齐 `packages/market`：`build` / `lint` / `typecheck` / `test` / `test:coverage` |
| `packages/devos-bridge/tsconfig.json` | `extends`：`../../tsconfig.base.json`，`include`：`["src"]` |
| `pnpm-workspace.yaml` | 已含 `packages/*`，**无需改**；根目录 `pnpm install` 后 workspace 可见新包 |

**自测：** `pnpm --filter @patioer/devos-bridge typecheck`（先完成 5.1-b～d 才有内容）。

---

**卡片 5.1-b — `src/version.ts`**

函数签名模板：

```typescript
/** 包版本，供日志与 DevOS 侧对账；与 package.json version 保持同步（发布前 bump）。 */
export const DEVOS_BRIDGE_VERSION: string
```

测试文件：`src/version.test.ts`

| 用例名（`it(...)`） |
|---------------------|
| `exports non-empty semver-like string` |

---

**卡片 5.1-c — `src/config.ts`（Day 1 唯一环境解析入口）**

函数签名模板：

```typescript
/** Day 1：从 process.env 读取 DevOS 连接信息；未配置时视为「桥接关闭」，不抛异常。 */
export interface DevOsBridgeEnv {
  /** 例：`http://localhost:3200`；空字符串表示未配置。 */
  baseUrl: string
  /** 请求 DevOS 时可选的 `x-api-key`。 */
  apiKey?: string
}

export function loadDevOsBridgeEnv(env: NodeJS.ProcessEnv): DevOsBridgeEnv

/** 纯函数：是否允许发起 DevOS HTTP 调用（baseUrl 非空且为合法 http(s)）。 */
export function isDevOsBridgeConfigured(env: DevOsBridgeEnv): boolean
```

测试文件：`src/config.test.ts`

| 用例名（`describe` / `it`） |
|-----------------------------|
| `describe('loadDevOsBridgeEnv')` |
| `it('reads DEVOS_BASE_URL and DEVOS_API_KEY')` |
| `it('returns empty baseUrl when DEVOS_BASE_URL unset')` |
| `it('trims DEVOS_BASE_URL whitespace')` |
| `describe('isDevOsBridgeConfigured')` |
| `it('returns false for empty baseUrl')` |
| `it('returns true for http:// and https://')` |
| `it('returns false for non-http URL')` |

`.env.example`（根目录追加两行，与卡片同步）：

```bash
# Sprint 5 Day 1 — DevOS Paperclip 桥（独立实例，默认 compose 映射 3200）
# DEVOS_BASE_URL=http://localhost:3200
# DEVOS_API_KEY=
```

---

**卡片 5.1-d — `src/index.ts`**

仅做聚合导出，无新逻辑：

```typescript
export { DEVOS_BRIDGE_VERSION } from './version.js'
export type { DevOsBridgeEnv } from './config.js'
export { loadDevOsBridgeEnv, isDevOsBridgeConfigured } from './config.js'
```

测试：`src/index.test.ts` 可选 — `it('re-exports loadDevOsBridgeEnv')`（或依赖 `config.test.ts` 即可，二选一避免重复）。

---

**卡片 5.1-e — Vitest 与覆盖率门槛**

| 文件 | 动作 |
|------|------|
| `packages/devos-bridge/vitest.config.ts` | 对齐 `packages/market/vitest.config.ts`（同仓库模式） |

**自测：** `pnpm --filter @patioer/devos-bridge test`；`pnpm --filter @patioer/devos-bridge test:coverage`（Day 1 目标：新包阈值与 market 一致或 CI 未接包前本地先绿）。

---

**卡片 5.4-a — `docker-compose.devos.yml`（根目录）**

无 TS 函数；**检查清单（实现时逐条打勾）**：

| 项 | 说明 |
|----|------|
| 独立 PostgreSQL | 服务名例：`devos-postgres`；**库名 ≠ `patioer`**（例：`devos`） |
| 独立 volume | 与 `docker-compose.yml` 的 `postgres_data` **不共享** |
| Paperclip / DevOS 进程 | 端口 **`3200:3000`**（宿主机 3200 → 容器内应用 3000，与主栈 3000 错开） |
| 可选 Redis | 若 DevOS 镜像不需要可省略；需要则端口 **6380:6379** 类，避免与主 Redis 6379 冲突 |
| `depends_on` | DB 就绪后再起应用容器 |

**手工验收命令（可复制）**

```bash
docker compose -f docker-compose.devos.yml up -d
curl -sfS "http://localhost:3200/health" || curl -sfS "http://localhost:3200/"   # 以实际 Paperclip 健康路径为准
docker compose -f docker-compose.devos.yml down
```

（若本地 `paperclip/` 与主 `docker-compose.yml` 同样挂载开发，**working_dir / command** 可与 `paperclip` 服务对齐，仅换端口与 DB。）

---

**卡片 5.4-b — 文档钉一下（1 段）**

| 文件 | 内容 |
|------|------|
| `docs/ops/devos-local.md`（新建，可选 Day 1 末） | 三行即可：compose 文件名、端口 3200、与 ElectroOS DB 分离说明 |

---

**Day 1 完成定义（DoD）**

- [ ] `@patioer/devos-bridge`：`typecheck` + `test` 通过  
- [ ] 根目录 `docker-compose.devos.yml`：`up` 后 **3200** 可访问（或文档说明占位原因）  
- [ ] `.env.example` 含 `DEVOS_*` 占位  

---

#### Sprint 5 · Day 2 — 可复制任务卡（5.2 协议 + 5.4 健康检查 + 5.9 `devos_tickets`）

对应每日简表：**5.2 DevOsTicket 协议**、**5.4 收尾 / 健康检查**、**5.9 schema + RLS**。可按 **5.2-a → 5.2-c → 5.4-a → 5.4-b → 5.9-a → 5.9-b** 顺序开 PR；**5.2 与 5.9 建议同 PR**（类型与表字段对齐）。

---

**卡片 5.2-a — `packages/devos-bridge/src/ticket-protocol.ts`（类型 + 纯函数）**

函数 / 类型签名模板：

```typescript
export type DevOsTicketType = 'bug' | 'feature' | 'harness_update' | 'performance'
export type DevOsTicketPriority = 'P0' | 'P1' | 'P2'
export type DevOsSlaAcknowledge = '1h' | '4h' | '24h'
export type DevOsSlaResolve = '4h' | '24h' | '48h' | '72h'

export interface DevOsTicketContext {
  platform?: string
  agentId?: string
  errorLog?: string
  reproSteps?: string[]
  tenantId?: string
}

export interface DevOsTicket {
  type: DevOsTicketType
  priority: DevOsTicketPriority
  title: string
  description: string
  context: DevOsTicketContext
  sla: { acknowledge: DevOsSlaAcknowledge; resolve: DevOsSlaResolve }
}

/** DevOS HTTP `getTicketStatus` 返回值侧状态（5.3 使用）。 */
export type TicketStatus =
  | 'open'
  | 'acknowledged'
  | 'in_progress'
  | 'resolved'
  | 'closed'

export function defaultSlaForPriority(priority: DevOsTicketPriority): DevOsTicket['sla']

/** 浅层运行时校验（脚本 / 测试入口）；HTTP 响应可再套 Zod。 */
export function isDevOsTicket(value: unknown): value is DevOsTicket
```

测试文件：`src/ticket-protocol.test.ts`

| 用例名（`describe` / `it`） |
|-----------------------------|
| `describe('defaultSlaForPriority')` |
| `it('returns stricter SLA for P0 than P2')` |
| `it('returns mid SLA for P1')` |
| `describe('isDevOsTicket')` |
| `it('accepts a minimal valid ticket')` |
| `it('rejects non-object')` |
| `it('rejects wrong type field')` |
| `it('rejects empty title')` |
| `it('rejects invalid context reproSteps')` |

---

**卡片 5.2-b — `packages/devos-bridge/src/index.ts`**

在 Day 1 导出基础上增加：

```typescript
export type {
  DevOsSlaAcknowledge,
  DevOsSlaResolve,
  DevOsTicket,
  DevOsTicketContext,
  DevOsTicketPriority,
  DevOsTicketType,
  TicketStatus,
} from './ticket-protocol.js'
export { defaultSlaForPriority, isDevOsTicket } from './ticket-protocol.js'
```

---

**卡片 5.2-c — 自测命令**

```bash
pnpm --filter @patioer/devos-bridge typecheck
pnpm --filter @patioer/devos-bridge test
pnpm --filter @patioer/devos-bridge test:coverage
```

---

**卡片 5.4-a — `docker-compose.devos.yml`（Day 2 增量）**

| 项 | 说明 |
|----|------|
| `devos-postgres.healthcheck` | `pg_isready -U postgres -d devos` |
| `devos-paperclip.depends_on` | `devos-postgres: condition: service_healthy` |

（Paperclip 进程级 HTTP 探活因各项目路由不一致，仍以宿主机 `curl` 手测为准。）

---

**卡片 5.4-b — `docs/ops/devos-local.md`（Day 2 增量）**

- 一小节说明：Postgres healthcheck、`depends_on` 行为。
- 一小节说明：ElectroOS 库执行 `0006_devos_tickets.sql`（与 DevOS 独立库区分）。

---

**卡片 5.9-a — `packages/db/src/schema/devos-tickets.ts` + `schema/index.ts` 导出**

Drizzle 表模板（与 §4.4 一致）：

```typescript
export const devosTickets = pgTable('devos_tickets', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  type: text('type').notNull(),
  priority: text('priority').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  context: jsonb('context'),
  status: text('status').notNull().default('open'),
  devosTicketId: text('devos_ticket_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
})
```

---

**卡片 5.9-b — `packages/db/src/migrations/0006_devos_tickets.sql`**

- `CREATE TABLE devos_tickets`（`tenant_id` 可空，FK → `tenants`）。
- `ENABLE` + `FORCE` RLS；`CREATE POLICY tenant_or_system_devos_tickets`：`tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id')::uuid`。

**迁移静态测试：** `packages/db/src/migrations/0001_rls.test.ts` 增加对 `0006_devos_tickets.sql` 关键句断言。

**集成测试（可选，需已跑迁移的 `DATABASE_URL`）：** `rls-all-tables.integration.test.ts` 增加 `devos_tickets` 描述块：租户仅见本租户 + `tenant_id IS NULL` 行；跨租户 id 查询为空。

---

**Day 2 完成定义（DoD）**

- [ ] `ticket-protocol` 单测 + `defaultSlaForPriority` / `isDevOsTicket` 行为符合上表  
- [ ] `0006` 迁移已应用于开发库；`pnpm --filter @patioer/db typecheck` + 迁移相关测试通过  
- [ ] `docker-compose.devos.yml` 含 Postgres healthcheck 与 `depends_on` 条件  
- [ ] `docs/ops/devos-local.md` 已更新 Day 2 说明  

---

#### Sprint 5 · Day 3 — 可复制任务卡（5.3 DevOsClient + 5.10 DB 隔离）

对应每日简表：**5.3** HTTP 客户端；**5.10** ElectroOS / DevOS 两库隔离校验。可按 **5.3-a → 5.3-c → 5.10-a → 5.10-b** 顺序实现。

---

**卡片 5.3-a — `packages/devos-bridge/src/devos-client.ts`**

HTTP 路由约定（与 Paperclip/DevOS 实现联调时可微调，但路径应稳定）：

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/v1/devos/tickets` | JSON body：`{ ticket: DevOsTicket }`；响应：`{ ticketId: string }` |
| `GET` | `/api/v1/devos/tickets/:ticketId/status` | 响应 JSON：`{ status: TicketStatus }` 或纯字符串 `"open"` |
| `POST` | `/api/v1/devos/tickets/:ticketId/acknowledge` | 成功：`2xx`，无 body 要求 |
| `POST` | `/api/v1/devos/tickets/:ticketId/resolve` | 成功：`2xx`，无 body 要求 |

请求头：`x-api-key: <DEVOS_API_KEY>`（若配置）；`Content-Type: application/json`（有 body 时）。

函数签名模板：

```typescript
export class DevOsHttpError extends Error {
  readonly status: number
  readonly responseBody: string
}

export interface DevOsClient {
  createTicket(ticket: DevOsTicket): Promise<{ ticketId: string }>
  getTicketStatus(ticketId: string): Promise<TicketStatus>
  acknowledgeTicket(ticketId: string): Promise<void>
  resolveTicket(ticketId: string): Promise<void>
}

export interface DevOsClientOptions {
  baseUrl: string
  apiKey?: string
  fetch?: typeof fetch
}

export function createDevOsClient(options: DevOsClientOptions): DevOsClient
```

---

**卡片 5.3-b — `packages/devos-bridge/src/index.ts`**

导出：`createDevOsClient`、`DevOsHttpError`、`DevOsClient`、`DevOsClientOptions`（以及既有 `ticket-protocol` 导出）。

---

**卡片 5.3-c — `packages/devos-bridge/src/devos-client.test.ts`**

| 用例名（`it`） |
|----------------|
| `createTicket POSTs /api/v1/devos/tickets with ticket body` |
| `getTicketStatus GETs .../tickets/:id/status` |
| `getTicketStatus accepts bare string JSON` |
| `acknowledgeTicket POSTs .../acknowledge` |
| `resolveTicket POSTs .../resolve` |
| `throws DevOsHttpError on non-OK` |
| `throws when create response missing ticketId` |

**自测：** `pnpm --filter @patioer/devos-bridge test`；`test:coverage`。

---

**卡片 5.10-a — `packages/devos-bridge/src/electroos-devos-db-isolation.ts`**

用于启动脚本或运维：确保 `DATABASE_URL` 与 `DEVOS_DATABASE_URL` 未指向同一 `host:port/dbname`。

```typescript
export interface PostgresIdentity {
  hostname: string
  port: string
  database: string
}

export function postgresIdentityFromUrl(urlString: string): PostgresIdentity

export function isSamePostgresDatabase(a: string, b: string): boolean

export function assertElectroOsAndDevOsDbIsolated(
  electroOsDatabaseUrl: string,
  devOsDatabaseUrl: string,
): void
```

测试文件：`electroos-devos-db-isolation.test.ts`

| 用例名（`describe` / `it`） |
|---------------------------|
| `describe('postgresIdentityFromUrl')` — `parses host port and database` · `defaults port to 5432` |
| `describe('isSamePostgresDatabase')` — `returns true for identical URLs` · `returns false when database name differs` · `returns false when port differs` |
| `describe('assertElectroOsAndDevOsDbIsolated')` — `does not throw when databases differ` · `throws when same host port and dbname` |

---

**卡片 5.10-b — 配置与文档**

| 文件 | 动作 |
|------|------|
| 根目录 `.env.example` | 增加注释占位 `DEVOS_DATABASE_URL`（例：`postgres://postgres:postgres@localhost:5433/devos`） |
| `docs/ops/devos-local.md` | 说明 `DATABASE_URL`（patioer）vs `DEVOS_DATABASE_URL`（devos）及 `assertElectroOsAndDevOsDbIsolated` 用途 |

（原任务表写 `tests/`；本仓库将 5.10 逻辑收拢到 `@patioer/devos-bridge`，与 HTTP 桥同一版本发布。）

---

**Day 3 完成定义（DoD）**

- [ ] `createDevOsClient` 单测覆盖创建 / 查询 / ack / resolve 与错误路径  
- [ ] `assertElectroOsAndDevOsDbIsolated` 单测覆盖  
- [ ] `.env.example` 含 `DEVOS_DATABASE_URL` 注释；`devos-local.md` 含双库说明  

---

#### Sprint 5 · Day 4 — 可复制任务卡（5.5 devos-seed + 5.3 联调收尾）

对应每日简表：**5.5** Engineering Org + SRE Agent 初始化；**5.3** 与 DevOS HTTP 基座联调收尾。建议顺序：**5.5-a → 5.5-b → 5.5-c → 5.5-d → 5.3-a → 5.3-b**。

---

**卡片 5.5-a — `packages/devos-bridge/src/devos-org-chart.ts`**

```typescript
export interface DevOsOrgNode {
  id: string
  name: string
  role: string
  children?: DevOsOrgNode[]
}

/** 默认工程组织树根（Engineering → SRE 团队 → SRE Agent）。 */
export const DEVOS_ENGINEERING_ORG: DevOsOrgNode

/** 生成写入 DevOS 的 bootstrap `DevOsTicket`（`description` 内嵌 `devos-org-chart/v1` JSON）。 */
export function buildSreBootstrapTicket(org?: DevOsOrgNode): DevOsTicket
```

测试文件：`devos-org-chart.test.ts`

| 用例名 |
|--------|
| `has SRE team and agent nodes` |
| `returns feature ticket with JSON org in description` |

---

**卡片 5.5-b — `packages/devos-bridge/src/devos-seed.ts`**

```typescript
export interface DevOsSeedResult {
  ticketId: string
  dryRun: boolean
}

export async function runDevOsSeed(params: {
  client: DevOsClient
  dryRun: boolean
}): Promise<DevOsSeedResult>
```

测试文件：`devos-seed.test.ts`

| 用例名 |
|--------|
| `does not call client when dryRun` |
| `calls createTicket when not dryRun` |

---

**卡片 5.5-c — `packages/devos-bridge/src/index.ts`**

导出：`DEVOS_ENGINEERING_ORG`、`buildSreBootstrapTicket`、`runDevOsSeed`、`DevOsSeedResult`、`DevOsOrgNode`。

---

**卡片 5.5-d — `scripts/devos.seed.ts` + 根 `package.json`**

- 脚本：`pnpm seed:devos` → `tsx ./scripts/devos.seed.ts`
- 行为：`loadDevOsBridgeEnv` → `isDevOsBridgeConfigured` 为 false 则退出码 1；**非 dry-run** 时默认 `probeDevOsHttpBaseUrl(DEVOS_BASE_URL)`，失败则退出（`--skip-probe` 跳过）；`createDevOsClient` + `runDevOsSeed`；stdout 打印 JSON。

---

**卡片 5.3-a — `packages/devos-bridge/src/devos-probe.ts`（联调收尾 · 可达性）**

```typescript
export interface ProbeDevOsOptions {
  fetch?: typeof fetch
  timeoutMs?: number
}

export async function probeDevOsHttpBaseUrl(
  baseUrl: string,
  options?: ProbeDevOsOptions,
): Promise<boolean>
```

测试文件：`devos-probe.test.ts`

| 用例名 |
|--------|
| `returns true on 200` |
| `returns true on 404` |
| `returns false on 502` |
| `returns false when fetch throws` |

---

**卡片 5.3-b — 文档**

| 文件 | 动作 |
|------|------|
| `docs/ops/devos-local.md` | 增加 `pnpm seed:devos` / `--dry-run` / `--skip-probe` 说明 |

---

**Day 4 完成定义（DoD）**

- [ ] `buildSreBootstrapTicket` / `runDevOsSeed` / `probeDevOsHttpBaseUrl` 单测通过  
- [ ] `pnpm seed:devos -- --dry-run` 可执行并输出 JSON  
- [ ] `docs/ops/devos-local.md` 已更新种子段落  

---

#### Sprint 5 · Day 5 — 可复制任务卡（5.6 Harness 报错 → DevOS `harness_update`）

对应每日简表：**5.6** ElectroOS → DevOS 自动 Ticket（`harness_update`）。建议顺序：**5.6-a → 5.6-b → 5.6-c → 5.6-d**。

---

**卡片 5.6-a — `packages/harness/src/harness-error.ts`（Wire 序列化）**

在现有 `HarnessError` 旁追加：

```typescript
/** 与 `@patioer/devos-bridge` 的 `HarnessErrorReport` 对齐的纯数据，避免 harness 依赖 devos-bridge。 */
export interface HarnessErrorWire {
  platform: string
  code: string
  message: string
}

/** `HarnessError` → Wire；非 HarnessError 返回 `null`（调用方决定是否上报）。 */
export function toHarnessErrorWire(err: unknown): HarnessErrorWire | null
```

测试文件：`harness-error.test.ts`（新建）

| 用例名 |
|--------|
| `returns wire for HarnessError` |
| `returns null for non-HarnessError` |

`packages/harness/src/index.ts`：导出 `HarnessErrorWire`、`toHarnessErrorWire`。

---

**卡片 5.6-b — `packages/devos-bridge/src/harness-update-ticket.ts`**

```typescript
import type { DevOsTicket, DevOsTicketPriority } from './ticket-protocol.js'

/** 与 `toHarnessErrorWire` 对齐，并可选附带租户 / Agent 上下文。 */
export interface HarnessErrorReport {
  platform: string
  code: string
  message: string
  tenantId?: string
  agentId?: string
}

/** 按 code 粗分 P1（默认严重）与 P2（典型「资源不存在」类），供 SRE 队列降噪。 */
export function deriveHarnessUpdatePriority(report: HarnessErrorReport): DevOsTicketPriority

/** 构造 `type: harness_update` 的 `DevOsTicket`（context.errorLog / reproSteps 可检索）。 */
export function buildHarnessUpdateTicket(report: HarnessErrorReport): DevOsTicket

export async function reportHarnessErrorToDevOs(params: {
  client: import('./devos-client.js').DevOsClient
  report: HarnessErrorReport
  dryRun?: boolean
}): Promise<{ ticketId: string; dryRun: boolean }>
```

测试文件：`harness-update-ticket.test.ts`

| 用例名 |
|--------|
| `buildHarnessUpdateTicket uses type harness_update and valid DevOsTicket shape` |
| `deriveHarnessUpdatePriority returns P2 for not-found style codes` |
| `deriveHarnessUpdatePriority returns P1 for typical failure codes` |
| `reportHarnessErrorToDevOs does not call client when dryRun` |
| `reportHarnessErrorToDevOs calls createTicket when not dryRun` |

---

**卡片 5.6-c — `packages/devos-bridge/src/index.ts`**

导出：`HarnessErrorReport`、`deriveHarnessUpdatePriority`、`buildHarnessUpdateTicket`、`reportHarnessErrorToDevOs`。

---

**卡片 5.6-d — `docs/ops/devos-local.md`（1 段）**

说明：运行时可将 `toHarnessErrorWire(err)` 与 `reportHarnessErrorToDevOs` 组合（需已配置 `DEVOS_BASE_URL`）；与 `devos_tickets` 表持久化（后续 API 任务）的关系一句话即可。

---

**Day 5 完成定义（DoD）**

- [ ] `toHarnessErrorWire` / `buildHarnessUpdateTicket` / `reportHarnessErrorToDevOs` 单测通过  
- [ ] `pnpm --filter @patioer/harness test` 与 `pnpm --filter @patioer/devos-bridge test` 通过  
- [ ] `docs/ops/devos-local.md` 含 Harness → DevOS 上报说明  

---

#### Sprint 5 · Day 6 — 可复制任务卡（5.7 SRE / Prometheus 告警规则）

对应每日简表：**5.7** Prometheus 告警规则（依赖 `apps/api` `/metrics` 与 Sprint 3.10 指标名）。建议顺序：**5.7-a → 5.7-b → 5.7-c → 5.7-d → 5.7-e → 5.7-f**。

---

**卡片 5.7-a — `packages/devos-bridge/prometheus/electroos-alerts.yml`**

静态 **Prometheus `rule_files`** 片段（可复制到 Prometheus / kube-prometheus-stack），包含至少四条告警，与计划表对齐：

| 告警语义 | DevOS 优先级（`labels.devos_priority`） | 指标 / 表达式要点 |
|----------|------------------------------------------|-------------------|
| Harness 错误率相对租户请求过高（>5%） | P0 | `harness_error_total` / `tenant_request_total` + `rate[5m]` |
| Agent 心跳过久未更新（staleness） | P1 | `agent_heartbeat_last_timestamp` + `time()` |
| API 延迟 p99 过高（>5s） | P1 | `api_request_duration_seconds_bucket` + `histogram_quantile(0.99, …)` |
| DB 连接池占用过高（>90%） | P0 | `electroos_db_pool_usage_ratio`（见 5.7-d） |

无 TS 函数；文件内附简短注释说明部署方式（`rule_files`）。

---

**卡片 5.7-b — `packages/devos-bridge/src/sre-alert-catalog.ts`**

```typescript
import type { DevOsTicketPriority } from './ticket-protocol.js'

/** 与 `prometheus/electroos-alerts.yml` 中 `alert:` 名称一一对应（供 SRE Agent / 文档生成 DevOS SLA）。 */
export const SRE_PROMETHEUS_ALERT_NAMES: readonly string[]

/** 告警名 → 建议 DevOS Ticket 优先级（与 YAML `labels.devos_priority` 一致）。 */
export function sreAlertDevOsPriority(alertName: string): DevOsTicketPriority | undefined
```

测试文件：`sre-alert-catalog.test.ts`

| 用例名 |
|--------|
| `SRE_PROMETHEUS_ALERT_NAMES lists four alert names` |
| `sreAlertDevOsPriority returns P0 for harness and db pool alerts` |
| `sreAlertDevOsPriority returns P1 for heartbeat and latency alerts` |
| `electroos-alerts.yml contains every catalog alert name` |

---

**卡片 5.7-c — `packages/devos-bridge/src/index.ts`**

导出：`SRE_PROMETHEUS_ALERT_NAMES`、`sreAlertDevOsPriority`。

---

**卡片 5.7-d — `apps/api/src/plugins/metrics.ts`（补齐 db 池指标 · S3.10 对齐）**

```typescript
/** 活跃连接数 / pool.max（0..1），供 Prometheus 规则 `electroos_db_pool_usage_ratio > 0.9`。 */
export const dbPoolUsageRatio: Gauge
```

实现：`Gauge` 使用 **`collect()`** 回调（每次 scrape 从 `@patioer/db` 的 `pool` 读取 `totalCount` / `idleCount` / `options.max`），避免 `setInterval`。

---

**卡片 5.7-e — `apps/api/src/plugins/metrics.test.ts`**

| 用例名（新增或扩展） |
|----------------------|
| `GET /metrics exposes electroos_db_pool_usage_ratio` |

---

**卡片 5.7-f — `docs/ops/prometheus-sre-alerts.md`（新建）**

- 说明 `packages/devos-bridge/prometheus/electroos-alerts.yml` 的用途、`sre-alert-catalog` 与 DevOS 优先级映射。  
- `docs/ops/devos-local.md` 增加一行链到该文档。

---

**Day 6 完成定义（DoD）**

- [ ] `electroos-alerts.yml` 存在且四条告警与目录一致  
- [ ] `sre-alert-catalog` 单测通过；YAML 与 catalog 名称一致  
- [ ] `/metrics` 暴露 `electroos_db_pool_usage_ratio`  
- [ ] `docs/ops/prometheus-sre-alerts.md` 已添加  

---

#### Sprint 5 · Day 7 — 可复制任务卡（5.7 续 · 规则↔指标对齐 + 冒烟检查）

对应每日简表：**5.7 规则与指标对齐 / 本地或 staging 冒烟**。Day 6 产出了 YAML 规则与 `sre-alert-catalog`；Day 7 做三件事——① 编程验证 YAML 表达式引用的指标名在 `metrics.ts` 中确实注册；② 提供一个可复用的 `/metrics` 冒烟检查函数（CI 或本地一键跑）；③ 给 YAML 每条规则补齐 `description` 注解（Alertmanager 通知模板用）。建议顺序：**5.7-g → 5.7-h → 5.7-i → 5.7-j → 5.7-k**。

---

**卡片 5.7-g — `packages/devos-bridge/src/sre-alert-metric-alignment.ts`**

```typescript
/** 从 YAML 规则 expr 中提取引用到的 Prometheus metric 名。 */
export function extractMetricNamesFromYaml(yamlContent: string): string[]

/** 编程验证：所有 YAML 表达式引用的 metric 在 `knownMetrics` 集合中存在。 */
export interface AlignmentResult {
  ok: boolean
  missingMetrics: string[]
  extraAlerts: string[]
}
export function checkAlertMetricAlignment(params: {
  yamlContent: string
  knownMetricNames: string[]
  catalogAlertNames: readonly string[]
}): AlignmentResult
```

测试文件：`sre-alert-metric-alignment.test.ts`

| 用例名 |
|--------|
| `extractMetricNamesFromYaml finds all four metric families` |
| `checkAlertMetricAlignment returns ok when all metrics present` |
| `checkAlertMetricAlignment detects missing metric` |
| `checkAlertMetricAlignment detects extra alert not in catalog` |

---

**卡片 5.7-h — `packages/devos-bridge/src/sre-smoke-check.ts`**

```typescript
export interface SmokeCheckResult {
  ok: boolean
  missingMetrics: string[]
  sampleCount: number
}

/** 拉取 /metrics 端点，校验所有 `requiredMetrics` 名出现在响应中。 */
export async function sreMetricsSmokeCheck(params: {
  metricsUrl: string
  requiredMetrics: string[]
  fetch?: typeof fetch
  timeoutMs?: number
}): Promise<SmokeCheckResult>
```

测试文件：`sre-smoke-check.test.ts`

| 用例名 |
|--------|
| `returns ok when all required metrics present` |
| `detects missing metric in response` |
| `returns ok:false when fetch fails` |

---

**卡片 5.7-i — `packages/devos-bridge/prometheus/electroos-alerts.yml`（描述注解）**

为每条告警 `annotations` 补齐 `description`（Alertmanager → DevOS Ticket 时用于 `ticket.description`），无逻辑变更。

---

**卡片 5.7-j — `packages/devos-bridge/src/index.ts`**

导出：`extractMetricNamesFromYaml`、`checkAlertMetricAlignment`、`AlignmentResult`、`sreMetricsSmokeCheck`、`SmokeCheckResult`。

---

**卡片 5.7-k — `docs/ops/prometheus-sre-alerts.md`（补充）**

增加 **「对齐验证」** 一段：说明 `checkAlertMetricAlignment` 用途与 CI 中可选集成思路。

---

**Day 7 完成定义（DoD）**

- [ ] `checkAlertMetricAlignment` 返回 `ok:true`（YAML 所有 expr 引用的 metric 均已在 `metrics.ts` 注册）  
- [ ] `sreMetricsSmokeCheck` 单测通过  
- [ ] YAML 四条规则均含 `description` 注解  
- [ ] `pnpm --filter @patioer/devos-bridge test` 通过  

---

#### Sprint 5 · Day 8 — 可复制任务卡（5.8 上 · Alertmanager webhook → DevOS Ticket → SRE 响应）

对应每日简表：**5.8 Alertmanager webhook → DevOS Ticket → SRE 响应（上）**。建议顺序：**5.8-a → 5.8-b → 5.8-c → 5.8-d → 5.8-e**。

数据流：`Alertmanager POST JSON → parseAlertmanagerPayload → alertToDevOsTicket → client.createTicket → buildSreResponseSuggestion`。

---

**卡片 5.8-a — `packages/devos-bridge/src/alertmanager-webhook-payload.ts`**

Alertmanager webhook JSON 的类型定义与解析函数。

```typescript
/** Alertmanager v4 webhook alert entry（精简子集，只保留 DevOS 桥接用到的字段）。 */
export interface AlertmanagerAlert {
  status: 'firing' | 'resolved'
  labels: Record<string, string>
  annotations: Record<string, string>
  startsAt: string
  endsAt: string
  fingerprint: string
}

/** Alertmanager webhook POST body 顶层结构（精简子集）。 */
export interface AlertmanagerWebhookPayload {
  version: string
  status: 'firing' | 'resolved'
  alerts: AlertmanagerAlert[]
}

/** 从 `request.body` 解析；返回 null 表示格式不符。 */
export function parseAlertmanagerPayload(
  body: unknown,
): AlertmanagerWebhookPayload | null
```

测试文件：`alertmanager-webhook-payload.test.ts`

| 用例名 |
|--------|
| `parses valid firing payload` |
| `parses valid resolved payload` |
| `returns null for non-object` |
| `returns null when alerts missing` |
| `returns null when alert entry lacks required fields` |

---

**卡片 5.8-b — `packages/devos-bridge/src/alertmanager-to-ticket.ts`**

将单条 `AlertmanagerAlert` 转为 `DevOsTicket`，利用 `sreAlertDevOsPriority` 设定优先级。

```typescript
import type { AlertmanagerAlert } from './alertmanager-webhook-payload.js'
import type { DevOsTicket } from './ticket-protocol.js'

/** 单条 firing alert → DevOsTicket（performance / harness_update 类型由 alert name 推断）。 */
export function alertToDevOsTicket(alert: AlertmanagerAlert): DevOsTicket

export interface AlertWebhookResult {
  created: number
  skipped: number
  errors: Array<{ fingerprint: string; error: string }>
  ticketIds: string[]
}

/** 批量处理 webhook payload：仅对 firing 告警创建 Ticket，resolved 忽略。 */
export async function handleAlertmanagerWebhook(params: {
  payload: import('./alertmanager-webhook-payload.js').AlertmanagerWebhookPayload
  client: import('./devos-client.js').DevOsClient
}): Promise<AlertWebhookResult>
```

测试文件：`alertmanager-to-ticket.test.ts`

| 用例名 |
|--------|
| `alertToDevOsTicket builds valid ticket from firing alert` |
| `alertToDevOsTicket uses P0 for HarnessErrorRateHigh` |
| `alertToDevOsTicket falls back to P1 for unknown alert` |
| `handleAlertmanagerWebhook creates tickets for firing alerts` |
| `handleAlertmanagerWebhook skips resolved alerts` |
| `handleAlertmanagerWebhook records errors from createTicket failures` |

---

**卡片 5.8-c — `packages/devos-bridge/src/sre-response-suggestion.ts`**

SRE Agent 对一条告警生成结构化的「初步响应建议」。

```typescript
export interface SreResponseSuggestion {
  alertName: string
  severity: string
  suggestedAction: string
  runbook: string
}

/** 根据告警名生成 SRE 标准响应建议（runbook 链接 + 建议操作）。 */
export function buildSreResponseSuggestion(alertName: string): SreResponseSuggestion
```

测试文件：`sre-response-suggestion.test.ts`

| 用例名 |
|--------|
| `returns runbook for ElectroOsHarnessErrorRateHigh` |
| `returns runbook for ElectroOsDbPoolUsageHigh` |
| `returns generic suggestion for unknown alert` |

---

**卡片 5.8-d — `packages/devos-bridge/src/index.ts`**

导出：`AlertmanagerAlert`、`AlertmanagerWebhookPayload`、`parseAlertmanagerPayload`、`alertToDevOsTicket`、`AlertWebhookResult`、`handleAlertmanagerWebhook`、`SreResponseSuggestion`、`buildSreResponseSuggestion`。

---

**卡片 5.8-e — `docs/ops/devos-local.md`（1 段）**

增加 **「Alertmanager → DevOS Ticket（Day 8–9）」** 段：`handleAlertmanagerWebhook` 用法简述、Alertmanager `webhook_configs` 配置要点。

---

**Day 8 完成定义（DoD）**

- [ ] `parseAlertmanagerPayload` / `alertToDevOsTicket` / `handleAlertmanagerWebhook` / `buildSreResponseSuggestion` 单测通过  
- [ ] `pnpm --filter @patioer/devos-bridge test` 通过  
- [ ] `docs/ops/devos-local.md` 含 Alertmanager → DevOS 段落  

---

#### Sprint 5 · Day 9 — 可复制任务卡（5.8 下 · 通道收尾 + 端到端演练）

对应每日简表：**5.8 通道收尾、端到端演练（伪造告警 → Ticket）**。Day 8 产出了解析 / 转 Ticket / 响应建议三个原子函数；Day 9 做三件事——① 一次性管道函数（raw body → Ticket + SRE 建议）；② fingerprint 幂等守卫（去重）；③ 完整端到端测试（伪造 Alertmanager payload → pipeline → 断言 Ticket 与 Suggestion）。建议顺序：**5.8-f → 5.8-g → 5.8-h → 5.8-i → 5.8-j**。

---

**卡片 5.8-f — `packages/devos-bridge/src/alert-dedup.ts`**

Fingerprint 去重守卫，防止 Alertmanager 重复 webhook 创建重复 Ticket。

```typescript
export interface AlertDedupStore {
  has(fingerprint: string): boolean
  add(fingerprint: string): void
  readonly size: number
}

/** 内存 TTL 去重（进程重启清空；适合单实例 + Paperclip 短窗口）。 */
export function createAlertDedupStore(params?: {
  ttlMs?: number
  maxSize?: number
}): AlertDedupStore
```

测试文件：`alert-dedup.test.ts`

| 用例名 |
|--------|
| `returns false for unseen fingerprint` |
| `returns true for seen fingerprint within TTL` |
| `evicts expired fingerprints` |
| `evicts oldest when maxSize exceeded` |

---

**卡片 5.8-g — `packages/devos-bridge/src/alertmanager-pipeline.ts`**

一次性管道：raw body → parse → dedup → create tickets → SRE suggestions。

```typescript
import type { DevOsClient } from './devos-client.js'
import type { AlertDedupStore } from './alert-dedup.js'
import type { AlertWebhookResult } from './alertmanager-to-ticket.js'
import type { SreResponseSuggestion } from './sre-response-suggestion.js'

export interface AlertPipelineResult {
  webhookResult: AlertWebhookResult
  suggestions: SreResponseSuggestion[]
  dedupSkipped: number
}

export async function runAlertmanagerPipeline(params: {
  body: unknown
  client: DevOsClient
  dedup?: AlertDedupStore
}): Promise<AlertPipelineResult>
```

测试文件：`alertmanager-pipeline.test.ts`

| 用例名 |
|--------|
| `returns parse_error when body is invalid` |
| `creates tickets and returns suggestions for firing alerts` |
| `skips duplicate fingerprints via dedup store` |
| `handles mixed firing and resolved alerts` |

---

**卡片 5.8-h — `packages/devos-bridge/src/alertmanager-e2e-fixtures.ts`**

四条预制 firing payload（每种告警一条）+ 一条 resolved，供测试与演示脚本使用。

```typescript
import type { AlertmanagerWebhookPayload } from './alertmanager-webhook-payload.js'

export const FIXTURE_HARNESS_ERROR_FIRING: AlertmanagerWebhookPayload
export const FIXTURE_HEARTBEAT_STALE_FIRING: AlertmanagerWebhookPayload
export const FIXTURE_LATENCY_P99_FIRING: AlertmanagerWebhookPayload
export const FIXTURE_DB_POOL_FIRING: AlertmanagerWebhookPayload
export const FIXTURE_RESOLVED: AlertmanagerWebhookPayload
```

测试文件：`alertmanager-e2e-fixtures.test.ts`

| 用例名 |
|--------|
| `all firing fixtures pass parseAlertmanagerPayload` |
| `resolved fixture has status resolved` |
| `pipeline processes all four firing fixtures end-to-end` |

---

**卡片 5.8-i — `packages/devos-bridge/src/index.ts`**

导出：`AlertDedupStore`、`createAlertDedupStore`、`AlertPipelineResult`、`runAlertmanagerPipeline`、五个 `FIXTURE_*` 常量。

---

**卡片 5.8-j — `docs/ops/devos-local.md`（更新 Alertmanager 段）**

补充去重说明（`createAlertDedupStore` 默认 TTL / maxSize）与端到端演练命令（指向测试文件路径）。

---

**Day 9 完成定义（DoD）**

- [ ] `createAlertDedupStore` / `runAlertmanagerPipeline` 单测通过  
- [ ] 四条 fixture 端到端测试全部通过  
- [ ] `pnpm --filter @patioer/devos-bridge test` 通过  
- [ ] `docs/ops/devos-local.md` 含去重 + 演练说明  

---

#### Sprint 5 · Day 10 — 可复制任务卡（5.11 DevOS Bridge 测试套件 + Sprint 5 验收 checklist）

对应每日简表：**5.11 DevOS Bridge 测试套件 │ Sprint 5 验收 checklist 全绿**。Day 1–9 各模块已有独立单测；Day 10 补齐三件事——① Sprint 5 验收清单模块（四项 checklist 可编程运行）；② 跨模块集成测试（harness→ticket / alert→pipeline→suggestion / seed→bootstrap 全链路）；③ 公共 API 表面验证（index.ts 每个导出均有值）。建议顺序：**5.11-a → 5.11-b → 5.11-c → 5.11-d → 5.11-e**。

---

**卡片 5.11-a — `packages/devos-bridge/src/sprint5-acceptance-checklist.ts`**

四项 Sprint 5 验收标准的可编程检查，各自独立，汇总返回 `allPassed`。

```typescript
export interface AcceptanceCheck {
  id: string
  description: string
  passed: boolean
  detail?: string
}

export interface Sprint5AcceptanceResult {
  checks: AcceptanceCheck[]
  allPassed: boolean
}

/** AC-1: DevOsTicket 协议完整可用（type / priority / SLA / isDevOsTicket）。 */
export function checkTicketProtocolIntegrity(): AcceptanceCheck

/** AC-2: Harness 报错可生成合法 DevOsTicket（buildHarnessUpdateTicket → isDevOsTicket）。 */
export function checkHarnessToDevOsFlow(): AcceptanceCheck

/** AC-3: SRE alert catalog 覆盖全部 YAML 规则，且 priority 映射无漏。 */
export function checkAlertRulesCatalogComplete(): AcceptanceCheck

/** AC-4: DB 隔离逻辑正确拒绝同库、接受异库。 */
export function checkDbIsolationLogic(): AcceptanceCheck

/** 汇总运行。 */
export function runSprint5AcceptanceChecklist(): Sprint5AcceptanceResult
```

测试文件：`sprint5-acceptance-checklist.test.ts`

| 用例名 |
|--------|
| `AC-1 ticket protocol integrity passes` |
| `AC-2 harness to DevOS flow passes` |
| `AC-3 alert rules catalog complete passes` |
| `AC-4 DB isolation logic passes` |
| `runSprint5AcceptanceChecklist returns allPassed true` |

---

**卡片 5.11-b — `packages/devos-bridge/src/devos-bridge-integration.test.ts`**

跨模块集成测试，验证完整数据链路。

| 用例名 |
|--------|
| `harness error → buildHarnessUpdateTicket → client.createTicket round-trip` |
| `alert fixture → runAlertmanagerPipeline → ticket + suggestion` |
| `duplicate alert is skipped on second pipeline run` |
| `seed bootstrap ticket passes isDevOsTicket validation` |
| `all alertToDevOsTicket outputs pass isDevOsTicket` |

---

**卡片 5.11-c — `packages/devos-bridge/src/devos-bridge-exports.test.ts`**

验证 `index.ts` 每个运行时导出（非纯 type）均为 defined 值。

| 用例名 |
|--------|
| `all runtime exports from index.ts are defined` |
| `exported functions are callable` |

---

**卡片 5.11-d — `packages/devos-bridge/src/index.ts`**

导出：`AcceptanceCheck`、`Sprint5AcceptanceResult`、`runSprint5AcceptanceChecklist`、以及四个 `check*` 函数。

---

**卡片 5.11-e — `docs/ops/devos-local.md`（更新验收段）**

新增「Sprint 5 验收 Checklist」段：`runSprint5AcceptanceChecklist()` 用法、四项检查说明、测试命令。

---

**Day 10 完成定义（DoD）**

- [ ] `runSprint5AcceptanceChecklist` 返回 `allPassed: true`  
- [ ] 跨模块集成测试全部通过  
- [ ] 公共 API 表面验证通过  
- [ ] `pnpm --filter @patioer/devos-bridge test` 全量通过  
- [ ] `docs/ops/devos-local.md` 含验收 checklist 说明  

---

### Sprint 6 · Week 11–12 — 验证 + 压测 + 文档

**交付物：** 20 项验收全部通过、多平台并发压测、完整测试套件、运维文档更新

| # | 任务 | 包/目录 | 依赖 | 估时 |
|---|------|---------|------|------|
| 6.1 | 多平台隔离测试：租户 A（Shopify+Amazon）vs 租户 B（TikTok+Shopee）数据不可见 | `tests/` | S5 完成 | 1.5d |
| 6.2 | 10 租户并发测试：模拟 10 租户同时运行 5 Agent、心跳正常、无数据串混 | `tests/` | 6.1 | 1.5d |
| 6.3 | Amazon API 限流测试：模拟 429 响应，Harness 自动退避重试 | `packages/harness` tests | — | 0.5d |
| 6.4 | 48h 稳定性运行：5 Agent × 多平台连续 48h 无 crash | — | 6.2 | 2d（含观察） |
| 6.5 | 覆盖率检查 + 补测试：新包 ≥ 70%，总体 ≥ 80% | 全包 | 6.1 | 1.5d |
| 6.6 | CI 扩展：PostgreSQL service + Redis service（集成测试自动化） | `.github/workflows` | — | 0.5d |
| 6.7 | OpenAPI spec 更新：新平台 routes + 广告/库存/Onboarding API | `apps/api` | S4 完成 | 0.5d |
| 6.8 | 运维文档更新：多平台配置、DevOS 部署、Prometheus 告警配置 | `docs/` | — | 1d |
| 6.9 | ADR-0002 文档：Phase 2 架构决策（Harness 扩展策略、Market 层、DevOS 部署） | `docs/adr` | — | 0.5d |
| 6.10 | 验收 checklist 逐项通过（见 §9） | — | 6.1–6.9 | 1d |

---

## 3. Phase 1 遗留清理计划

Phase 1 的 3 项书面降级（DG-01/02/03）和 1 项待联调（AC-01）在 Phase 2 中系统性回收：

| # | Phase 1 遗留 | Phase 2 回收计划 | Sprint | 状态 |
|---|-------------|-----------------|--------|------|
| AC-01 | Paperclip 联调 | Sprint 1 Task 1.1（Day 1，0.5d） | S1 | ⏳ 代码路径就绪（bootstrap / execute / budget）；**各环境 ACTIVE 需实测** |
| DG-01 | Support Relay Shopify Inbox | Sprint 2 Task 2.8 — 若 Inbox API 权限获批则对接，否则保持 stub 并推至 Phase 3 | S2 | ⏳ **按 2.8：stub + warning 已交付**；GraphQL Inbox **推迟 Phase 3**（见 `support-relay` / `agents-execute`） |
| DG-02 | 新品上架拦截 | Phase 2 Product Scout 仍为"报告生成"定位，不自动上架 → 仍无需拦截；**若 Phase 3 增加自动上架则补 Approval Gate** | N/A | 设计无变更 |
| DG-03 | PaperclipBridge.createIssue() | Sprint 2 Task 2.7（0.5d） | S2 | ✅ **`createIssue` + execute 路径 `ticket.create` → Paperclip**（`agent-paperclip-ticket.ts`、`agents-execute`）；UI 冒烟见 Day16 |

---

## 4. 数据模型（Phase 2 新增 Drizzle Schema）

### 4.1 platform_credentials 扩展

```typescript
// packages/db/src/schema/platform-credentials.ts — EXTEND
export const platformCredentials = pgTable('platform_credentials', {
  // ... Phase 1 字段保留 ...
  credentialType: text('credential_type').default('oauth'),  // NEW: 'oauth' | 'lwa' | 'hmac'
  region: text('region'),                                    // NEW: 'NA'|'EU'|'FE'|'SG'|'MY'...
  metadata: jsonb('metadata'),                               // NEW: 平台特定配置 JSONB
})
```

### 4.2 ads_campaigns

```typescript
export const adsCampaigns = pgTable('ads_campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  platform: text('platform').notNull(),
  platformCampaignId: text('platform_campaign_id').notNull(),
  name: text('name').notNull(),
  status: text('status').notNull(),    // 'active' | 'paused' | 'ended'
  dailyBudget: numeric('daily_budget', { precision: 10, scale: 2 }),
  totalSpend: numeric('total_spend', { precision: 10, scale: 2 }),
  roas: numeric('roas', { precision: 6, scale: 2 }),
  syncedAt: timestamp('synced_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})
```

### 4.3 inventory_levels

```typescript
export const inventoryLevels = pgTable('inventory_levels', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  productId: uuid('product_id').notNull().references(() => products.id),
  platform: text('platform').notNull(),
  quantity: integer('quantity').notNull().default(0),
  safetyThreshold: integer('safety_threshold').default(10),
  status: text('status').notNull(),    // 'normal' | 'low' | 'out_of_stock'
  syncedAt: timestamp('synced_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})
```

### 4.4 devos_tickets（ElectroOS 侧记录）

```typescript
export const devosTickets = pgTable('devos_tickets', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id'),         // 可空（系统级 Ticket 无租户）
  type: text('type').notNull(),         // 'bug' | 'feature' | 'harness_update' | 'performance'
  priority: text('priority').notNull(), // 'P0' | 'P1' | 'P2'
  title: text('title').notNull(),
  description: text('description'),
  context: jsonb('context'),            // platform, agentId, errorLog, reproSteps
  status: text('status').default('open'),
  devosTicketId: text('devos_ticket_id'), // DevOS 实例返回的 Ticket ID
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
})
```

### 4.5 RLS 策略（migration 0002_phase2.sql）

```sql
-- 新表 RLS
ALTER TABLE ads_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads_campaigns FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ads_campaigns
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE inventory_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_levels FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inventory_levels
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- devos_tickets：允许系统级 Ticket（tenant_id IS NULL）
ALTER TABLE devos_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE devos_tickets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_system ON devos_tickets
  USING (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id')::uuid);
```

---

## 5. 核心接口定义（Phase 2 新增/扩展）

### 5.1 PlatformHarness 扩展（packages/harness/src/ads.harness.ts）

```typescript
export interface AdsCapableHarness {
  getAdsPerformance(opts: AdsPerformanceOpts): Promise<AdsPerformance[]>
  getAdsCampaigns(): Promise<AdsCampaign[]>
  updateAdsBid(adId: string, newBid: number): Promise<void>
  updateAdsBudget(campaignId: string, dailyBudget: number): Promise<void>
}

export interface InventoryCapableHarness {
  getInventoryLevels(productIds?: string[]): Promise<InventoryLevel[]>
  adjustInventory(productId: string, qty: number): Promise<void>
}

export function isAdsCapable(h: TenantHarness): h is TenantHarness & AdsCapableHarness {
  return 'getAdsPerformance' in h
}

export function isInventoryCapable(h: TenantHarness): h is TenantHarness & InventoryCapableHarness {
  return 'getInventoryLevels' in h
}
```

### 5.2 MarketContext（packages/market/src/market-context.ts）

```typescript
export interface MarketContext {
  convertPrice(amount: number, from: Currency, to: Currency): Promise<number>
  calculateTax(price: number, market: Market): TaxResult
  checkCompliance(product: Product, market: Market): Promise<ComplianceResult>
  getMarketConfig(market: Market): MarketConfig
}

export type Market = 'US' | 'UK' | 'DE' | 'SG' | 'MY' | 'TH' | 'PH' | 'ID' | 'VN'

export interface TaxResult {
  type: string        // 'GST' | 'VAT' | 'SST' | 'PPN'
  rate: number
  inclusive: boolean
  taxAmount: number
  priceWithTax: number
  priceWithoutTax: number
}

export interface ComplianceResult {
  passed: boolean
  issues: ComplianceIssue[]
}
```

### 5.3 DevOsTicket 协议（packages/devos-bridge/src/ticket-protocol.ts）

```typescript
export interface DevOsTicket {
  type: 'bug' | 'feature' | 'harness_update' | 'performance'
  priority: 'P0' | 'P1' | 'P2'
  title: string
  description: string
  context: {
    platform?: string
    agentId?: string
    errorLog?: string
    reproSteps?: string[]
    tenantId?: string
  }
  sla: {
    acknowledge: '1h' | '4h' | '24h'
    resolve: '4h' | '24h' | '48h' | '72h'
  }
}

export interface DevOsClient {
  createTicket(ticket: DevOsTicket): Promise<{ ticketId: string }>
  getTicketStatus(ticketId: string): Promise<TicketStatus>
  acknowledgeTicket(ticketId: string): Promise<void>
  resolveTicket(ticketId: string): Promise<void>
}
```

### 5.4 AgentContext 扩展

```typescript
export interface AgentContext {
  // ... Phase 1 接口保留 ...

  // Phase 2 新增
  getHarness(platform?: string): TenantHarness
  getEnabledPlatforms(): string[]
  market: MarketContext

  // DevOS 联动
  reportToDevOS(ticket: Omit<DevOsTicket, 'context'>): Promise<void>
}
```

---

## 6. 集成架构（Phase 2）

### 6.1 三层部署拓扑

```
┌─────────────────────────────┐     HTTP     ┌─────────────────────┐     HTTP     ┌─────────────────────┐
│  ElectroOS API (:3100)      │◄────────────►│  Paperclip (:3000)  │              │  DevOS (:3200)      │
│                             │              │  (Agent 编排)        │              │  (独立 Paperclip)    │
│  5 Agents (运营)             │──── Ticket ──────────────────────────────────────►│  SRE Agent (工程)    │
│  4 Platform Harness         │              │                     │              │                     │
│  Market Layer               │              │                     │              │                     │
│  Prometheus 埋点             │              │                     │              │  独立 DB             │
└──────────┬──────────────────┘              └─────────────────────┘              └─────────────────────┘
           │                                           │
           │         ElectroOS DB (PG + RLS)            │         Paperclip DB
           └───────────────────────────────────────────┘

    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
    │ Shopify  │    │ Amazon   │    │ TikTok   │    │ Shopee   │
    │ API      │    │ SP-API   │    │ Shop API │    │ Open API │
    └──────────┘    └──────────┘    └──────────┘    └──────────┘
         ▲               ▲               ▲               ▲
         └───────────────┴───────────────┴───────────────┘
                            PlatformHarness
```

### 6.2 多平台 Agent 执行流程

```
Paperclip Heartbeat (cron)
  ──► HTTP callback
  ──► ElectroOS /api/v1/agents/:id/execute
                    │
                    ▼
              AgentContext 构建
               ├── 检查 budget
               ├── 获取 enabledPlatforms → ['shopify', 'amazon', 'tiktok']
               ├── 为每个平台获取 TenantHarness
               ├── 注入 MarketContext（货币/税/合规）
               └── 执行 agent.run(ctx)
                    │
                    ├── Ads Optimizer：并行获取各平台广告数据 → LLM 分析 → 调整出价
                    ├── Inventory Guard：跨平台库存聚合 → 低库存预警 → 补货建议 Ticket
                    ├── 门控检查（广告 >$500 → Approval）
                    ├── 写 agent_events（审计）
                    └── Harness 异常 → 自动上报 DevOS Ticket
```

### 6.3 Tenant Onboarding 流程

```
Step 1: 注册                    Step 2: 平台授权
 POST /api/v1/onboarding/       选择平台 → OAuth 跳转 → 回调
 register                        → 加密存储 token
 → 创建 tenants 记录              → HarnessRegistry 注册
 → 初始化 RLS
 → PaperclipBridge.ensureCompany()

Step 3: Agent 初始化             Step 4: 健康检查
 执行 agents.seed.ts             每平台 getProducts() 测试
 → 创建 5 Agent                  Agent 心跳触发一次
 → 注册 Paperclip heartbeat      全部 ACTIVE → 完成
 → 设置预算
```

---

## 7. 技术栈清单（Phase 2 增量）

| 层级 | 技术 | 版本 | 说明 |
|------|------|------|------|
| Queue | **BullMQ** | latest | API 限流队列、Webhook 分发、Agent 执行队列 |
| Cache | **Redis** | 7+ | BullMQ 后端 + 汇率缓存 + 限流状态 |
| Monitoring | **prom-client** | latest | Prometheus 指标埋点 |
| Amazon SDK | **amazon-sp-api** | latest | SP-API 封装（`AmazonHarness` 内部使用） |
| Currency | **Open Exchange Rates** 或等价 API | — | 实时汇率（Redis 缓存 1h） |

---

## 8. 三平台 Harness 对比与实施要点

| 维度 | Amazon SP-API | TikTok Shop | Shopee Open Platform |
|------|--------------|-------------|---------------------|
| **认证** | LWA OAuth + AWS SigV4 | HMAC-SHA256 自定义 | HMAC-SHA256 多参数 |
| **审核** | 2-4 周（**需 Day 1 申请**） | 需申请 Sandbox Shop | test-stable 独立域名 |
| **Rate Limit** | `getOrders` 0.5 req/s（极低） | 一般 10 req/s | 一般 10 req/s |
| **特殊处理** | Reports API 异步（15-30min） | 直播订单 Webhook 与普通订单分离 | 6 国市场 shopId 不同，需逐一授权 |
| **广告** | Amazon PPC（Advertising API 独立域名） | TikTok Ads API | Shopee Ads API |
| **实施风险** | 审核周期长 + Orders 限流极低 | 直播订单实时性高 | 多市场签名复杂 |
| **缓解方案** | 提前申请 + Reports API 替代 getOrders + BullMQ 排队 | 双 Webhook topic 注册 | 签名方法封装 + 市场配置化 |

---

## 9. Phase 2 验收清单（20 项）

> **状态说明：** ⬜ 待做 · ✅ 已达成 · ⏳ 待外部联调 · 🔽 降级

### 多平台 Harness（6 项）

- [ ] **AC-P2-01** Amazon Harness：`getProducts()` 返回真实商品数据（非 mock）
- [ ] **AC-P2-02** Amazon Harness：`updatePrice()` 成功更新一个商品价格并回查验证
- [ ] **AC-P2-03** TikTok Harness：`getProducts()` 正常，Webhook 接收直播订单事件
- [ ] **AC-P2-04** Shopee Harness：至少 2 个市场（SG + MY）的 `getProducts()` 正常
- [ ] **AC-P2-05** Market Harness：SGD→USD 汇率转换误差 < 0.01%
- [ ] **AC-P2-06** Market Harness：ID 市场商品 PPN 11% 计算正确

### 新增 Agents（4 项）

- [ ] **AC-P2-07** Ads Optimizer：每 4 小时触发，Amazon PPC 出价调整日志可查
- [ ] **AC-P2-08** Ads Optimizer：广告日预算 >$500 触发审批 Ticket，未批准不执行
- [ ] **AC-P2-09** Inventory Guard：每天 08:00 触发，库存低于阈值时生成补货建议 Ticket
- [ ] **AC-P2-10** 5 个 Agent 同时运行 48h，无 crash，心跳日志连续

### DevOS 基础（4 项）

- [ ] **AC-P2-11** DevOS Paperclip 实例独立运行（端口 3200），可正常访问
- [ ] **AC-P2-12** ElectroOS Harness 报错时自动创建 DevOS Ticket（P1 级）
- [ ] **AC-P2-13** SRE Agent 收到 Prometheus P0 告警后在 DevOS 生成响应 Ticket
- [ ] **AC-P2-14** DevOS 数据库与 ElectroOS 数据库完全独立，互不影响

### 多平台隔离 & 压测（4 项）

- [ ] **AC-P2-15** 租户 A（Shopify+Amazon）与租户 B（TikTok+Shopee）数据完全隔离
- [ ] **AC-P2-16** 10 个租户并发运行，所有 Agent 心跳正常，无数据串混
- [ ] **AC-P2-17** Harness 测试全部通过：`pnpm vitest run`（覆盖率 ≥ 70%）
- [ ] **AC-P2-18** 模拟 Amazon API 限流（429 响应），Harness 自动退避重试，Agent 正常运行

### Phase 1 遗留回收（2 项）

- [ ] **AC-P2-19** AC-01 闭环：3 个 Agent 在 Paperclip Dashboard 显示 ACTIVE
- [ ] **AC-P2-20** PaperclipBridge.createIssue() 成功创建 Issue 并在 Paperclip UI 可见

---

## 10. 风险 & 缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| Amazon SP-API 审核延迟超 4 周 | 中 | 高 | Day 1 提交申请；Sprint 1-2 使用沙盒开发；审核不过则 Sprint 3 回落为 mock + 集成测试 |
| Amazon Orders API 限流（0.5 req/s）导致数据同步慢 | 高 | 中 | 用 Reports API 异步批量拉取替代实时 getOrders；BullMQ 排队控制并发 |
| Shopee 6 国市场签名复杂、沙盒不稳定 | 中 | 中 | 签名逻辑统一封装 + 重试；MVP 先接 SG + MY 两个市场 |
| TikTok 直播订单 Webhook 实时性要求高 | 中 | 低 | LIVE_ORDER Webhook 独立 handler + 优先队列 |
| Market Harness 汇率 API 不可用 | 低 | 中 | Redis 缓存兜底（最近有效汇率 TTL 24h 兜底） + 多源冗余 |
| DevOS 独立实例部署复杂度 | 低 | 低 | Docker Compose 一键启动；Phase 2 仅基础结构，复杂编排 Phase 4 |
| 10 租户并发导致连接池耗尽 | 中 | 高 | PG 连接池 max 调整 + 连接池监控 Prometheus（`db_connection_pool` 指标） |
| 多平台 Webhook 重复/乱序 | 中 | 中 | Phase 1 已有 `webhook_events` 幂等去重机制，扩展至多平台 |

---

## 11. 不在 Phase 2 范围

以下明确排除，避免范围蔓延：

- **DataOS**：无 ClickHouse Event Lake、Feature Store、Decision Memory → Phase 3
- **完整 Dev Loop**：DevOS 只做基础结构（SRE + Ticket），无 Autonomous Dev Loop → Phase 4
- **B2B Harness**：无 B2B 平台接入 → Phase 4
- **前端 UI**：仍使用 Paperclip Dashboard；自有 Onboarding UI → Phase 3+
- **付费用户 / 商业化**：无 Stripe、套餐 → Phase 5
- **Content Writer / Market Intel Agent**：→ Phase 3
- **CEO / Finance Agent**：→ Phase 4
- **跨租户学习**：→ Phase 4 DataOS 能力
- **Ontology / 全球商品语义**：Phase 2 仅做最小 `concepts` 种子（预留）→ 完整体系 Phase 3
- **Kubernetes 部署**：Phase 2 仍用 Docker Compose → 生产 K8s Phase 3+

---

## 12. 依赖关系图

```mermaid
gantt
    title Phase 2 · 12 Week Plan
    dateFormat  YYYY-MM-DD
    axisFormat  %m/%d

    section Sprint 1 · Amazon + 收尾
    AC-01 Paperclip 联调        :s1_1, 2026-05-19, 1d
    Amazon SP-API 申请           :s1_2, 2026-05-19, 1d
    platform_credentials 扩展    :s1_3, 2026-05-19, 1d
    RLS migration 0002           :s1_4, after s1_3, 1d
    BullMQ + Redis               :s1_5, 2026-05-19, 2d
    Harness 接口扩展             :s1_6, 2026-05-19, 2d
    AmazonHarness 商品+订单      :s1_7, after s1_6, 3d
    AmazonHarness 分析+客服      :s1_8, after s1_7, 2d
    Amazon 限流适配              :s1_9, after s1_5, 2d
    Amazon OAuth                 :s1_10, after s1_7, 2d

    section Sprint 2 · TikTok + Shopee
    TikTokHarness 商品+价格      :s2_1, 2026-06-02, 3d
    TikTokHarness 订单+直播      :s2_2, after s2_1, 2d
    TikTok OAuth + Webhook       :s2_3, after s2_1, 2d
    ShopeeHarness 商品+价格      :s2_4, 2026-06-02, 3d
    ShopeeHarness 多市场          :s2_5, after s2_4, 2d
    Shopee OAuth + Webhook       :s2_6, after s2_4, 2d
    DG-03 回收 createIssue       :s2_7, 2026-06-02, 1d
    DG-01 回收 Support Relay     :s2_8, 2026-06-02, 1d
    三平台 Harness 测试          :s2_9, after s2_2, 3d

    section Sprint 3 · Market 层
    packages/market 脚手架       :s3_1, 2026-06-16, 1d
    currency 汇率转换            :s3_2, after s3_1, 2d
    tax 税务计算                 :s3_3, after s3_1, 2d
    compliance 合规检查          :s3_4, after s3_1, 3d
    MarketContext 聚合           :s3_5, after s3_2, 1d
    Market 测试                  :s3_6, after s3_5, 2d
    多平台 Webhook 统一          :s3_7, 2026-06-16, 2d
    Amazon 切真实凭证            :s3_8, 2026-06-23, 2d
    HarnessRegistry 多平台       :s3_9, 2026-06-16, 2d
    Prometheus 埋点              :s3_10, 2026-06-23, 2d

    section Sprint 4 · 2 新 Agent
    AgentContext 多平台扩展      :s4_1, 2026-06-30, 3d
    广告+库存 schema             :s4_2, 2026-06-30, 1d
    Ads Optimizer Agent          :s4_3, after s4_1, 3d
    Inventory Guard Agent        :s4_4, after s4_1, 3d
    广告 API routes              :s4_5, after s4_2, 1d
    库存 API routes              :s4_6, after s4_2, 1d
    Governance 广告审批          :s4_7, after s4_3, 2d
    Tenant Onboarding            :s4_8, after s4_1, 3d
    5 Agent seed 扩展            :s4_9, after s4_3, 1d
    Onboarding 健康检查          :s4_10, after s4_8, 1d

    section Sprint 5 · DevOS 基础
    devos-bridge 脚手架          :s5_1, 2026-07-14, 1d
    DevOsTicket 协议             :s5_2, after s5_1, 1d
    DevOsClient HTTP 客户端      :s5_3, after s5_2, 2d
    docker-compose.devos.yml     :s5_4, 2026-07-14, 2d
    devos-seed SRE Agent         :s5_5, after s5_4, 1d
    Harness→DevOS 自动 Ticket    :s5_6, after s5_3, 2d
    SRE Agent 告警规则           :s5_7, after s5_5, 2d
    Prometheus→SRE 告警通道      :s5_8, after s5_7, 3d
    devos_tickets schema         :s5_9, after s5_2, 1d
    DevOS 隔离验证               :s5_10, after s5_4, 1d
    DevOS Bridge 测试            :s5_11, after s5_6, 2d

    section Sprint 6 · 验收
    多平台隔离测试               :s6_1, 2026-07-28, 3d
    10 租户并发测试              :s6_2, after s6_1, 3d
    Amazon 限流测试              :s6_3, 2026-07-28, 1d
    48h 稳定性运行               :s6_4, after s6_2, 4d
    覆盖率补测试                 :s6_5, after s6_1, 3d
    CI 扩展 PG+Redis             :s6_6, 2026-07-28, 1d
    OpenAPI spec 更新            :s6_7, 2026-07-28, 1d
    运维文档更新                 :s6_8, after s6_7, 2d
    ADR-0002                     :s6_9, 2026-07-28, 1d
    验收 checklist               :s6_10, after s6_4, 2d
```

---

## 13. 各市场合规规则速查

| 市场 | 货币 | 税种 | 税率 | 含税方式 | 关键认证要求 |
|------|------|------|------|---------|-------------|
| SG | SGD | GST | 9% | 不含税报价 | 电子产品 IMDA 认证，食品 SFA 许可 |
| MY | MYR | SST | 6%（服务）/ 10%（商品） | 不含税 | 部分商品 SIRIM 认证 |
| TH | THB | VAT | 7% | 含税报价 | 跨境清关文件，部分商品 TIS 标准 |
| ID | IDR | PPN | 11% | 不含税 | 进口商品 BPOM（食品/化妆品）或 SNI 认证 |
| UK | GBP | VAT | 20% | 含税展示 | 脱欧后需 UKCA 认证（替代 CE），GPSR |
| DE | EUR | MwSt | 19% | 含税展示 | WEEE 注册（电子产品），包装法 VerpackG |
| US | USD | Sales Tax | 州级不等 | 不含税 | FCC（电子）、FDA（食品/化妆品） |

---

## 14. Agent 配置总览（Phase 2 后共 5 个）

| Agent | 触发 | 模型 | 月预算 | 关键门控 |
|-------|------|------|--------|---------|
| Product Scout | `0 6 * * *`（每天 06:00） | claude-sonnet-4-6 | $30 | 上架需人工确认 |
| Price Sentinel | `0 * * * *`（每小时） | claude-haiku-4-5 | $50 | 变动 >15% 冻结审批 |
| Support Relay | Webhook 实时 | claude-sonnet-4-6 | $80 | 退款/投诉转人工 |
| **Ads Optimizer** | `0 */4 * * *`（每 4h） | claude-haiku-4-5 | $60 | 日预算 >$500 审批 |
| **Inventory Guard** | `0 8 * * *`（每天 08:00） | claude-haiku-4-5 | $20 | 补货建议需人工确认 |

**月总预算：** $240/租户（Phase 1 为 $160，增加 $80）

---

## Related

- [Phase 1 实施计划](./phase1-plan.md)
- [System Constitution v1.0](../system-constitution.md)
- [ADR-0001 · Paperclip 集成策略](../adr/0001-paperclip-integration.md)
- [DevOS 架构 brainstorm](../brainstorms/2026-03-21-electroos-devos-architecture-brainstorm.md)
- [DevOS Master Blueprint brainstorm](../brainstorms/2026-03-21-electroos-devos-master-blueprint-pdf-brainstorm.md)
- [Phase 1–5 路线图 brainstorm](../brainstorms/2026-03-21-electroos-phase1-5-roadmap-pdf-brainstorm.md)
- [数据结构 brainstorm](../brainstorms/2026-03-21-electroos-data-system-structure-brainstorm.md)
- [全球商品语义 brainstorm](../brainstorms/2026-03-21-electroos-global-product-ontology-brainstorm.md)
- [工程师执行清单 brainstorm](../brainstorms/2026-03-21-electroos-engineering-checklist-brainstorm.md)
