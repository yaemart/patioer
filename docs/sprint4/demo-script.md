# Sprint 4 演示脚本（Day 12 · D12-04）

目标：在**本地或沙盒**可按步骤复现 **Ads / Inventory / Onboarding** 三条核心路径（无硬编码密钥；敏感值来自环境变量）。

**前置**：`pnpm install`；`DATABASE_URL`、`.env` 见 `.env.example`；API 默认 `PORT=3100`。

---

## 1. Onboarding（四步）

详见 [../onboarding-flow.md](../onboarding-flow.md)。最小化 HTTP 顺序：

1. `POST /api/v1/onboarding/register`（`x-onboarding-key`）→ 得到 `tenantId`
2. 浏览器完成至少一平台 OAuth（`x-tenant-id`）
3. `POST /api/v1/onboarding/initialize-agents`
4. `GET /api/v1/onboarding/health` → JSON 中 `platforms[]`、`agentHeartbeats[]`（execute-pipeline 探针）、`summary.heartbeatOk`、`ok`

或使用种子 CLI（需 DB）：

```bash
pnpm seed:agents <tenant-uuid>
# 或预览
pnpm seed:agents -- --dry-run <tenant-uuid>
```

---

## 2. Ads（只读 API + Agent 执行）

**只读**（需 `x-tenant-id`）：

```bash
curl -sS -H "x-tenant-id: $TENANT_UUID" "http://localhost:3100/api/v1/ads/campaigns"
curl -sS -H "x-tenant-id: $TENANT_UUID" "http://localhost:3100/api/v1/ads/performance"
```

**执行**（需 Agent 行 ID、`x-api-key` 若启用）：

```bash
curl -sS -X POST "http://localhost:3100/api/v1/agents/$ADS_AGENT_UUID/execute" \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: $TENANT_UUID" \
  -d '{}'
```

**探针模式**（验证 pipeline 无副作用）：

```bash
curl -sS -X POST "http://localhost:3100/api/v1/agents/$ADS_AGENT_UUID/execute?probe=1" \
  -H "x-tenant-id: $TENANT_UUID" \
  -H "x-api-key: $API_KEY"
```

具体载荷与平台以 `agents-execute` 路由及 Agent 类型为准。

---

## 3. Inventory（只读 API + Agent 执行）

```bash
curl -sS -H "x-tenant-id: $TENANT_UUID" "http://localhost:3100/api/v1/inventory"
curl -sS -H "x-tenant-id: $TENANT_UUID" "http://localhost:3100/api/v1/inventory/alerts"
```

```bash
curl -sS -X POST "http://localhost:3100/api/v1/agents/$INV_AGENT_UUID/execute" \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: $TENANT_UUID" \
  -d '{}'
```

---

## 4. 与 CI 一致的回归命令

```bash
pnpm test:ci
```

等价于 `.github/workflows/ci.yml` 中 `build-check` 作业（不含 `workflow-lint`）。
