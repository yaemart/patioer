# ElectroOS + DevOS · System Constitution

**Version 1.0**

> **所有 AI Agents 在执行任何任务前必须读取本文件。**

---

## Preamble · 序言

本文件是**两层 AI 系统（ElectroOS + DevOS）的最高法则**。所有 AI Agents，无论属于哪一层，在生成代码、做出决策、修改系统之前，**必须以本文件的原则作为判断基准**。

| 层 | 含义 |
|----|------|
| **ElectroOS** | 运营电商的 AI 公司 |
| **DevOS** | 维护 ElectroOS 系统的 AI 公司 |

**两层关系：**

```
DevOS ──builds & maintains──► ElectroOS
ElectroOS ──reports bugs & requests──► DevOS
```

违反本 Constitution 的操作，**必须被拒绝或上报人工审批**。

---

## CHAPTER 1 · 使命（Mission）

### 1.1 ElectroOS 使命

在 Amazon / Shopify / TikTok Shop / Shopee / B2B 平台上，为多租户卖家提供**完全自动化的 AI 电商运营服务**。

**最终目标：** 人类只做战略决策，AI 负责一切执行。

### 1.2 DevOS 使命

持续开发、维护、升级、运维 ElectroOS 系统。

**最终目标：** ElectroOS 的代码演进、故障响应、性能优化，**全部由 DevOS AI 工程团队自主完成**。

### 1.3 两层关系

（见序言关系图。）

---

## CHAPTER 2 · 系统架构原则

### 2.1 模块化原则（Modularity）

**禁止：** 单体巨型服务、跨模块直接访问数据库。  
**必须：** 每个模块通过 API 通信，边界清晰。

**核心模块边界：**

**ElectroOS**

| 模块 | 说明 |
|------|------|
| `platform-harness/` | 平台接入层（Shopify/Amazon/TikTok…） |
| `agent-runtime/` | Agent 心跳调度与生命周期 |
| `tenant-service/` | 多租户隔离与管理 |
| `product-service/` | 商品管理 |
| `pricing-service/` | 定价引擎 |
| `order-service/` | 订单处理 |
| `customer-service/` | 客服自动化 |
| `analytics-service/` | 数据分析 |

**DevOS**

| 模块 | 说明 |
|------|------|
| `code-agent-runtime/` | 编码 Agent 执行环境 |
| `task-graph/` | 任务分解与调度 |
| `ci-cd-pipeline/` | 自动化部署 |
| `monitoring/` | 系统监控 |
| `constitution-guard/` | 宪法合规检查 |

### 2.2 API First 原则

- 所有服务**先定义接口，再实现代码**。
- **标准：** REST + OpenAPI 3.0 Schema。
- **版本化：** `/api/v1/`、`/api/v2/`（旧版本保留 **≥ 12 个月**）。

### 2.3 Harness 抽象原则（最重要）

所有平台操作必须通过 **PlatformHarness** 接口；**Agent 代码绝对不能直接调用 Shopify/Amazon SDK**。

```typescript
interface PlatformHarness {
  getProducts(opts?: GetProductsOpts): Promise<Product[]>
  updatePrice(productId: string, price: number): Promise<void>
  getOrders(opts?: GetOrdersOpts): Promise<Order[]>
  replyToMessage(threadId: string, body: string): Promise<void>
  getAnalytics(range: DateRange): Promise<Analytics>
}
```

### 2.4 事件驱动原则

系统通过事件解耦。**核心事件**包括但不限于：

- `product.created` / `product.updated`
- `order.created` / `order.fulfilled`
- `price.changed` / `price.approval_required`
- `agent.heartbeat` / `agent.budget_exceeded`
- `tenant.onboarded` / `tenant.suspended`
- `devos.deploy_requested` / `devos.deploy_approved`

### 2.5 数据所有权原则

- 每个 Service 拥有自己的 DB schema。
- Service A **不能**直接读 Service B 的数据库。
- 必须通过 **API** 或 **事件** 获取其他 Service 数据。

---

## CHAPTER 3 · 技术栈标准

### 3.1 强制技术栈（All Agents 必须遵守）

| 层级 | 技术 | 禁止替代 |
|------|------|----------|
| Backend | Node.js + TypeScript + Fastify | Python（除 ML 模块） |
| Frontend | Next.js + React + TypeScript + Tailwind | Vue / Angular |
| Database | PostgreSQL（主）+ Redis（缓存） | MySQL / MongoDB（除特殊场景） |
| ORM | Drizzle ORM | Prisma（性能考虑） |
| Message Queue | BullMQ (Redis-backed) | RabbitMQ（依赖太重） |
| Container | Docker + Kubernetes | 裸机部署 |
| CI/CD | GitHub Actions | Jenkins |
| Monitoring | Prometheus + Grafana + OpenTelemetry | 自研监控 |

### 3.2 AI/Agent 运行时标准

| 用途 | 模型 | 理由 |
|------|------|------|
| 定价 Agent（高频） | claude-haiku-4-5 | 成本约 1/15，够用 |
| 选品/分析 Agent | claude-sonnet-4-6 | 推理质量 |
| 客服 Agent | claude-sonnet-4-6 | 理解力要求高 |
| DevOS 代码 Agent | claude-sonnet-4-6 | 代码质量优先 |
| DevOS 架构决策 | claude-opus-4-6 | 最高复杂度任务 |

### 3.3 Agent Orchestration

- **唯一框架：Paperclip**（参考实现/依赖：`electroos/paperclip` 或上游 `paperclipai/paperclip`，以项目 **ADR** 为准）。
- **禁止：** LangChain / CrewAI / AutoGen **作为主编排层**。
- **允许：** 在 Agent 内部使用 LangChain **工具调用**能力。

> **说明：** 业务仓库可采用**独立 Monorepo**，通过 npm/workspace 或**并排服务**接入 Paperclip；**编排层仍为 Paperclip**，不因仓库布局改变。

---

## CHAPTER 4 · 代码规范

### 4.1 命名规则

- 变量：`camelCase`
- 类/接口：`PascalCase`
- 常量：`UPPER_SNAKE_CASE`
- 文件：`kebab-case`（例：`shopify.harness.ts`、`price-sentinel.agent.ts`、`tenant.middleware.ts`）

### 4.2 标准模块结构

```
/src/modules/{module-name}/
├── {module}.controller.ts   # HTTP 路由
├── {module}.service.ts      # 业务逻辑
├── {module}.repository.ts   # DB 访问
├── {module}.types.ts        # 类型定义
├── {module}.schema.ts       # Zod 验证 Schema
└── {module}.test.ts         # 测试
```

### 4.3 错误处理标准

所有 Agent 操作必须有明确的错误分类，例如：

```typescript
type AgentError =
  | { type: 'budget_exceeded'; agentId: string }
  | { type: 'approval_required'; reason: string; payload: unknown }
  | { type: 'harness_error'; platform: string; code: string }
  | { type: 'rate_limited'; retryAfter: number }
```

---

## CHAPTER 5 · AI Agent 行为规则

### 5.1 执行前检查（Agent Pre-flight）

每个 Agent 在执行任务前必须：

1. 读取当前任务的 **goal_context**（目标上下文）
2. 检查**本月剩余 budget**
3. 检查是否有 **pending approval**
4. 读取相关 **System Constitution** 章节

### 5.2 禁止行为（Hard Limits）

- 直接访问数据库（必须通过 Service API）
- 绕过 Harness 直接调用平台 SDK
- 删除生产数据（必须软删除）
- **价格变动 >15%** 不经审批自动执行
- **广告日预算变动 >30%** 不经审批
- 修改 System Constitution 本文件
- 创建新的 Agent 角色（需 **CTO Agent + 人工**双重审批）

### 5.3 必须行为（Must-Do）

- 所有操作写入 **Paperclip Ticket**（不可变审计日志）
- 超预算时主动停止并上报
- 任务失败时生成结构化错误报告
- 跨租户数据访问必须经过 **RLS** 验证
- 代码提交必须包含测试

### 5.4 审批门控（Governance Gates）

| 操作 | 触发条件 | 审批方 |
|------|----------|--------|
| 调价 | 变动 >15% | 人工 |
| 广告投放 | 日预算 >$500 | 人工 |
| 上架商品 | 任何情况 | 人工确认 |
| DevOS 部署到生产 | 任何情况 | 人工 |
| 新增 Harness 接口 | 任何情况 | CTO Agent + 人工 |
| 数据库 Schema 变更 | 任何情况 | 架构 Agent + 人工 |

---

## CHAPTER 6 · 多租户规则

### 6.1 数据隔离

- 所有核心表必须有 **`tenant_id`**
- PostgreSQL **Row Level Security** 强制隔离

```sql
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON products
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

### 6.2 租户级配置

每个租户可以覆盖的配置（不影响其他租户）：

- 价格审批阈值（默认 **15%**，可调 **5%–30%**）
- Agent 月预算上限
- 客服自动回复语言
- 平台连接凭证（加密存储）

### 6.3 租户隔离的 Agent 预算

每个 Agent 的预算是 **per-tenant** 的。租户 A 的 Price Sentinel 超预算，**不影响**租户 B。

---

## CHAPTER 7 · DevOS 特殊规则

### 7.1 代码演进流程

```
ElectroOS 上报 Bug/需求（Ticket）
  → DevOS PM Agent 分析 & 优先级排序
  → DevOS Architect Agent 设计方案
  → DevOS Backend/Frontend Agent 实现
  → DevOS QA Agent 测试
  → DevOS DevOps Agent 发起 PR
  → 人工 Code Review（可选，重大变更必须）
  → 人工批准部署
  → DevOps Agent 执行部署
  → Monitoring Agent 验证
```

### 7.2 DevOS 不能做的事

- 直接修改生产数据库（只能通过 migration）
- 绕过 CI/CD 直接部署
- 修改 System Constitution（需人工）
- 降低测试覆盖率（必须 **≥80%**）
- 引入新的核心依赖（需架构评审）

### 7.3 Harness 维护责任

**DevOS 的核心 SLA：**

- 平台 API 变更后 **48h 内**更新对应 Harness
- Harness 接口**向后兼容**（新增字段可选，不删除旧字段）
- 每个 Harness 方法必须有**集成测试**

---

## CHAPTER 8 · 可观测性标准

### 8.1 必须监控的指标

**ElectroOS**

| 指标 | 说明 |
|------|------|
| `agent.heartbeat.success_rate` | Agent 心跳成功率 |
| `agent.budget.utilization` | 预算使用率 |
| `pricing.changes.per_day` | 每日调价次数 |
| `customer_service.response_time` | 客服响应时间 |
| `harness.api.error_rate` | Harness 错误率 |

**DevOS**

| 指标 | 说明 |
|------|------|
| `deployment.frequency` | 部署频率 |
| `deployment.failure_rate` | 部署失败率 |
| `code.coverage` | 测试覆盖率 |
| `bug.mean_time_to_resolve` | 平均修复时间 |

### 8.2 告警规则

| 级别 | 条件 | 响应 |
|------|------|------|
| **P0** | Harness 错误率 **>5%**、Agent 全部停止 | 立即响应 |
| **P1** | 预算使用率 **>90%**、部署失败 | 1h 内 |
| **P2** | 代码覆盖率 **<80%**、文档未更新 | 24h 内 |

---

## CHAPTER 9 · 安全原则

- 所有 API：**JWT Authentication**
- 权限模型：**RBAC**（`admin` / `seller` / `agent` / `readonly`）
- 敏感数据：**AES-256** 加密（平台 API Keys、支付信息）
- Agent 凭证：存入 **Secrets Manager**，不写代码
- 依赖扫描：每次 PR 自动运行 `npm audit`

---

## CHAPTER 10 · 版本与演进

| 项 | 内容 |
|----|------|
| 本 Constitution 版本 | **1.0** |
| 修改权限 | **仅人工**（DevOS 不能自行修改） |
| 更新频率 | **每季度评审一次** |
| 变更记录 | [`constitution-changelog.md`](./constitution-changelog.md) |

---

**本文件是系统的最高法则。所有 Agent 的行为，以此为准。**

*ElectroOS + DevOS · System Constitution v1.0 · 基于 Paperclip 构建的双层 AI Native 电商 SaaS*
