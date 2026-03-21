# patioer
smart ecommerce SAAS -harness engineering , ai agent native

## 本地目录与仓库目录差异说明

为避免协作时“本地看得到、GitHub 看不到”的困惑，这里说明默认行为：

- `node_modules/` 不会提交到 GitHub。它是依赖安装产物，由 `package.json` + `pnpm-lock.yaml` 通过 `pnpm install` 重新生成。
- `paperclip/` 在本仓库中被 `.gitignore` 忽略，作为本地参考副本使用，不纳入主仓库版本管理。
- GitHub 页面默认展示 `main` 分支内容；若你在功能分支开发（例如 `feat/...`），请切换分支或查看 PR 的 `Files changed` 以看到最新改动。
- `pnpm dev` 对 `paperclip/` 缺失具备容错：若未检测到 `paperclip/package.json`，只启动 API，不会整体启动失败。

如果需要拉起本地开发环境，请以仓库已跟踪文件为准，并先执行依赖安装命令：

```bash
pnpm install
pnpm dev
```

如需本地同时启动 API + Paperclip，请先在仓库根目录准备 `paperclip/`（需包含 `package.json`）。
## 系统概要
1. 双层系统概览
1.1 系统角色
ElectroOS：AI 原生电商 SaaS，负责运营电商业务。
功能：选品、定价、广告投放、库存管理、客服自动化、数据分析。
核心 Agents（Phase 4）：Product Scout、Price Sentinel、Support Relay、Ads Optimizer、Inventory Guard、Content Writer、Market Intel、Finance Agent、CEO Agent。
DevOS：AI 工程团队，维护 ElectroOS 系统，负责自主开发、升级和运维。
功能：从 Bug/Ticket 接收 → 分析 → 系统设计 → 编码 → 测试 → 部署 → 监控与优化。
核心 Agents（Phase 4）：CTO Agent、PM Agent、Architect Agent、Backend Agent、Frontend Agent、DB Agent、Harness Agent、QA Agent、Security Agent、DevOps Agent、SRE Agent、Codebase Intel。
1.2 两层关系
DevOS ──builds & maintains──► ElectroOS
ElectroOS ──reports bugs & requests──► DevOS
ElectroOS 提交 Ticket/需求/Bug，DevOS 自主完成整个开发与部署闭环。
生产部署仍保留人工审批节点。
2. 系统架构原则（摘录）
2.1 模块化与 API First
模块边界清晰，禁止跨模块直接访问数据库。
核心模块：
ElectroOS: platform-harness, agent-runtime, tenant-service, product-service, pricing-service, order-service, customer-service, analytics-service。
DevOS: code-agent-runtime, task-graph, ci-cd-pipeline, monitoring, constitution-guard。
API First：REST + OpenAPI 3.0，版本化保留 ≥12 个月。
2.2 Harness 抽象层
所有平台操作通过 PlatformHarness 接口，Agent 代码不能直接调用 Shopify/Amazon/TikTok SDK。
示例接口：
interface PlatformHarness {
  getProducts(opts?: GetProductsOpts): Promise<Product[]>
  updatePrice(productId: string, price: number): Promise<void>
  getOrders(opts?: GetOrdersOpts): Promise<Order[]>
  replyToMessage(threadId: string, body: string): Promise<void>
  getAnalytics(range: DateRange): Promise<Analytics>
}
2.3 事件驱动

核心事件包括：

product.created / product.updated
order.created / order.fulfilled
price.changed / price.approval_required
agent.heartbeat / agent.budget_exceeded
tenant.onboarded / tenant.suspended
devos.deploy_requested / devos.deploy_approved
2.4 数据所有权与多租户
每个 Service 拥有自己的数据库 schema，服务间通过 API 或事件通信。
PostgreSQL RLS 强制租户隔离，所有核心表携带 tenant_id。
租户可定制审批阈值（5–30%）、Agent 预算上限、客服自动回复语言、平台凭证。
3. 技术栈标准
层级	技术	禁止替代
Backend	Node.js + TypeScript + Fastify	Python (除 ML 模块)
Frontend	Next.js + React + Tailwind	Vue / Angular
DB	PostgreSQL + Redis	MySQL / MongoDB
ORM	Drizzle ORM	Prisma
Message Queue	BullMQ	RabbitMQ
Container	Docker + Kubernetes	裸机部署
CI/CD	GitHub Actions	Jenkins
Monitoring	Prometheus + Grafana + OpenTelemetry	自研
AI 模型使用分层策略：
高频低成本任务 → claude-haiku
高复杂度任务/架构决策 → claude-opus
代码 Agent → claude-code
Agent 编排：唯一框架 Paperclip。
4. 数据结构设计
4.1 多租户基础表（Phase 1）
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  plan TEXT DEFAULT 'starter',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE companies ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE agents ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE tasks ADD COLUMN tenant_id UUID REFERENCES tenants(id);

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON companies USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation ON agents USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation ON tasks USING (tenant_id = current_setting('app.tenant_id')::uuid);
4.2 DataOS 数据存储（Phase 3）
Event Lake（ClickHouse）：不可变事件历史，存储 Agent 操作记录。
Feature Store（Redis + PostgreSQL）：缓存产品特征，15 分钟刷新周期。
Decision Memory（PostgreSQL + pgvector）：存储 Agent 决策情境向量，实现历史决策召回和学习。
示例 Feature Store
CREATE TABLE product_features (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  platform TEXT NOT NULL,
  product_id TEXT NOT NULL,
  price_current NUMERIC(10,2),
  price_avg_30d NUMERIC(10,2),
  conv_rate_7d NUMERIC(5,4),
  units_sold_7d INTEGER,
  stock_qty INTEGER,
  reorder_point INTEGER,
  competitor_min_price NUMERIC(10,2),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, platform, product_id)
);
示例 Decision Memory
CREATE TABLE decision_memory (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  agent_id TEXT NOT NULL,
  platform TEXT,
  entity_id TEXT,
  context JSONB NOT NULL,
  action JSONB NOT NULL,
  outcome JSONB,
  context_vector vector(1536),
  decided_at TIMESTAMPTZ DEFAULT NOW(),
  outcome_at TIMESTAMPTZ
);
CREATE INDEX ON decision_memory USING ivfflat (context_vector vector_cosine_ops) WITH (lists = 100);
5. DevOS 自治开发闭环（Phase 4）

Autonomous Dev Loop 9 阶段：

Ticket 收到 → ElectroOS 上报
PM 分析需求 → 生成 Feature Spec
Architect 设计系统方案
Task Graph 分解工程任务
编码实现 → Backend/Frontend/DB 并行
测试 & 安全扫描 → QA + Security
人工审批 → 生产部署
DevOps 自动部署
SRE 监控 & 回归 → 新问题自动生成 Ticket，循环迭代
DevOS Agents 会自动修复 Harness 适配（48h SLA）、生成 PR、执行 QA 测试、安全扫描，只有生产部署保留人工审批。
系统自我学习能力来自 DataOS，Agent 可以根据历史决策优化未来策略。
6. 核心设计亮点
双层 AI 架构：ElectroOS（业务执行）+ DevOS（系统维护与演进），互为依存。
Agent 原生化：每个 Agent 独立心跳，预算控制，操作不可绕过 Harness。
多租户安全：RLS + API + Event Layer，保证租户隔离和数据安全。
自主演进：DevOS 完整闭环从 Ticket → 部署 → 监控 → 优化。
可扩展性：新平台只需实现 Harness，Agent 代码零改动。
历史决策记忆：DataOS 提供 Feature Store + Decision Memory + Event Lake，Agent 可学习优化决策。
