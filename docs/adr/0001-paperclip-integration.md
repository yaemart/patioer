# ADR-0001 · Paperclip 集成策略

**状态：** Accepted  
**日期：** 2026-03-21  
**决策者：** 项目创始人  
**关联：** [System Constitution Ch3.3](../system-constitution.md)、[Phase 1 Plan](../plans/phase1-plan.md)

---

## 1. 背景

ElectroOS 的 Agent 编排层必须使用 Paperclip（Constitution Ch3.3）。PDF Blueprint Phase 1 建议「Fork paperclip → 重命名为 electroos」，在 fork 上叠加业务目录。前期讨论中提出了三种替代方案。

## 2. 决策

**采用方案 B：独立 Monorepo，Paperclip 作为并排服务。**

ElectroOS 拥有独立的 Git 仓库（`patioer/`），Paperclip 源码作为子目录保留（`patioer/paperclip/`），以独立进程方式运行。两者通过 HTTP REST API 通信。

## 3. 架构

```
┌─────────────────────────────┐      HTTP (localhost)    ┌─────────────────────┐
│  ElectroOS (:3100)          │ ◄────────────────────►   │  Paperclip (:3000)  │
│  Fastify · 自有 DB schema   │                          │  Express · 自有 DB  │
│  packages/agent-runtime     │                          │  Heartbeat Engine   │
│  packages/harness           │                          │  Budget · Issues    │
│  packages/db                │                          │  Approvals          │
└─────────────────────────────┘                          └─────────────────────┘
```

### 3.1 租户映射

| ElectroOS 概念 | Paperclip 概念 | 关系 |
|----------------|----------------|------|
| `tenants` 表 | `companies` 表 | 1:1 映射；`tenants.paperclip_company_id` 存储 Paperclip company ID |
| 创建租户 | `POST /api/companies` | `PaperclipBridge` 自动调用 |
| 租户删除/暂停 | 对应 company archive | 同步 |

### 3.2 数据库

- **ElectroOS DB**：独立 PostgreSQL database（或同一 PG 实例的不同 schema），存储 `tenants`、`products`、`orders`、`platform_credentials`、`agent_events`、`approvals` 等业务表。
- **Paperclip DB**：Paperclip 自有（PGlite 嵌入或外部 PG），存储 `companies`、`agents`、`issues`、`heartbeat_runs` 等编排表。
- 两者不共享表、不跨库直读。

### 3.3 Web 框架

ElectroOS API 使用 **Fastify**（Constitution Ch3.1），Paperclip 保持 **Express** 不动。两个独立进程，互不干扰。

## 4. Agent 执行对接

```
Paperclip Heartbeat (cron schedule)
  → 触发 Agent wakeup
  → 通过 HTTP adapter 或 Plugin SDK 回调 ElectroOS
  → ElectroOS /api/v1/agents/:id/execute
  → AgentContext 构建 → agent.run(ctx) → Harness → 平台
```

具体对接方式在 Phase 1 Sprint 1 中验证：优先尝试 **Paperclip HTTP adapter**（Agent `adapterType: 'http'`），回退为 **Plugin bridge**。

## 5. 备选方案

| 方案 | 描述 | 不采用原因 |
|------|------|------------|
| A. Fork Paperclip | 在 Paperclip fork 上叠加 ElectroOS 业务代码 | 与上游 sync 困难；业务代码与编排耦合 |
| C. 纯 API + 远程 Paperclip | Paperclip 作为远程托管服务 | 本地开发复杂；Phase 1 不需要 |

## 6. 后果

- **正面**：业务代码与编排框架边界清晰；可独立升级 Paperclip；ElectroOS schema 不受 Paperclip 迁移影响。
- **负面**：需维护 `PaperclipBridge` HTTP 客户端；本地开发需同时启动两个进程。
- **待验证**：Paperclip HTTP adapter 是否满足 Agent 执行回调需求（Sprint 1 Task 1.9）。

## 7. 版本锁定

Paperclip 源码锁定在特定 commit（通过 `paperclip/` 子目录的 `.git`）。升级上游时：

1. `cd paperclip && git pull origin main`
2. 运行 ElectroOS 全量测试
3. 确认 Bridge 兼容性
4. 更新本 ADR 的「当前版本」字段

**当前锁定版本：** `paperclip/` 目录下的 HEAD commit
