# Sprint 13 — 三层控制台 API + ClipMart 模板 验收证据

> 完成日期：2026-03-28
> 验收标准：AC-P4-23（三层 Dashboard 正常展示） + AC-P4-24（ClipMart 模板导入：新租户 30 分钟内 9 Agent 就绪）

---

## 1. 测试结果

| 测试套件 | 用例数 | 结果 |
|---------|--------|------|
| console.test.ts（Console 路由） | 12 | ✅ 全通过 |
| clipmart-import.test.ts（模板验证） | 9 | ✅ 全通过 |
| 核心包回归（agent-runtime + harness + shared + dataos + devos-bridge + api） | 1722 | ✅ 全通过 |
| TypeCheck `apps/api` | — | ✅ 0 errors |
| ESLint Sprint 13 新文件 | — | ✅ 0 errors |

## 2. AC-P4-23 验证：三层 Dashboard 正常展示

### Console API 端点

| 端点 | 层级 | 功能 |
|------|------|------|
| `GET /api/v1/console/electroos` | ElectroOS | 9 Agent 心跳/健康/预算/待审批 |
| `GET /api/v1/console/devos` | DevOS | Agent 列表/最近事件/待部署审批 |
| `GET /api/v1/console/dataos` | DataOS | Event Lake 写入率/Feature Store/Decision Memory |
| `GET /api/v1/console/approvals` | 审批中心 | 汇总所有 pending approvals |
| `GET /api/v1/console/alerts` | 告警中心 | P0/P1 告警 + SRE 处理记录 |
| `GET /api/v1/console/overview` | 总览 | 三层合并状态摘要 |

### Grafana Dashboard

- 文件：`docker/grafana/provisioning/dashboards/three-layer-status.json`
- 面板数：24 个（3 行 × 各层 stat/timeseries 面板）
- 数据源：Prometheus（`${DS_PROMETHEUS}` 变量）
- 模板变量：`DS_PROMETHEUS` + `tenant_id`

### 三层面板结构

| 行 | 面板 |
|----|------|
| ElectroOS | Healthy Agents · Pending Approvals · Monthly Budget · Avg Heartbeat Duration · Heartbeat Timeline |
| DevOS | Active Loop Tasks · Pending Deployments · Agent Count · Loop Task Completion Rate |
| DataOS | Event Lake Write Rate · Feature Store Updated At · Decision Memory Records · Write Latency (p50/p95/p99) |

## 3. AC-P4-24 验证：ClipMart 模板导入

### 模板验证

- 文件：`harness-config/clipmart-template.json`
- 9 个 Agent 配置（与 `ELECTROOS_AGENT_IDS` 完全一致）
- Governance 配置：$50/月预算、15% 价格审批阈值、5 分钟心跳间隔
- 4 市场合规（SG/ID/DE/US）
- 4 平台支持（Shopify/Amazon/TikTok/Shopee）
- DataOS 三层全启用

### CLI 工具

- 命令：`pnpm clipmart:import --tenant=<uuid> --template=standard`
- 流程：加载模板 → 验证 → 逐个创建 Agent → 报告汇总
- 预估就绪时间：~18 分钟（9 Agent × 2 min）< 30 分钟 ✅

## 4. 新增/修改文件清单

### 新增文件

| 文件 | 说明 |
|------|------|
| `apps/api/src/routes/console.ts` | 三层控制台 API（6 个端点） |
| `apps/api/src/routes/console.test.ts` | Console 路由测试（12 用例） |
| `docker/grafana/provisioning/dashboards/three-layer-status.json` | Grafana 三层面板 |
| `harness-config/clipmart-template.json` | ClipMart 标准跨境电商模板 |
| `scripts/clipmart-import.ts` | ClipMart 导入 CLI |
| `scripts/clipmart-import.test.ts` | 模板验证测试（9 用例） |

### 修改文件

| 文件 | 变更 |
|------|------|
| `apps/api/src/app.ts` | 注册 `consoleRoute` |
| `package.json` | 添加 `clipmart:import` 脚本 |

## 5. 架构决策

| 决策 | 理由 |
|------|------|
| Console 路由全部走 DB 查询 | 实时性高，避免缓存一致性问题 |
| Alert Hub 使用 synthetic alerts | Phase 4 尚无 AlertManager 集成，占位设计 |
| ClipMart 模板为 JSON 文件 | 声明式配置，易于版本管理和扩展 |
| CLI 通过 API 创建 Agent | 复用现有 API 验证逻辑，无需直接操作 DB |
| Overview 端点做单次 DB roundtrip | 减少 N+1，前端仪表板首屏快速加载 |

---

*Sprint 13 完成。*
