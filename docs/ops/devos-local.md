# DevOS 本地栈

- **Compose 文件：** 仓库根目录 `docker-compose.devos.yml`
- **HTTP：** DevOS Paperclip 映射到宿主机 **3200**（容器内应用端口仍为 3000）
- **数据库：** 独立 Postgres 服务 `devos-postgres`，库名 **`devos`**，数据卷 **`devos_postgres_data`**，与 ElectroOS 主库 **`patioer`** 分离

启动：

```bash
# 先准备本地 paperclip/ 副本（该目录被 .gitignore 忽略，不随主仓库提交）
ls paperclip/package.json
docker compose -f docker-compose.devos.yml up -d
```

## DevOS 种子（Sprint 5 Day 4 · Task 5.5）

在 `DEVOS_BASE_URL` 可达时，向 DevOS 创建一条 **Engineering / SRE Agent bootstrap** Ticket（组织树 JSON 写入 `description`）：

```bash
export DEVOS_BASE_URL=http://localhost:3200
# 可选：DEVOS_API_KEY=...
pnpm seed:devos
pnpm seed:devos -- --dry-run          # 仅打印结果，不调用 HTTP
pnpm seed:devos -- --skip-probe       # 跳过 GET / 可达性探测（离线调试 createTicket 契约时）
```

与 `@patioer/devos-bridge` 联调时，设置 `DEVOS_BASE_URL=http://localhost:3200`（见根目录 `.env.example`）。

## Harness 报错 → DevOS Ticket（Sprint 5 Day 5 · Task 5.6）

平台调用抛出 `HarnessError` 时，可先 `toHarnessErrorWire(err)`（`@patioer/harness`）得到 `{ platform, code, message }`，再附上 `tenantId` / `agentId` 组成 `HarnessErrorReport`，调用 `reportHarnessErrorToDevOs({ client: createDevOsClient(...), report })` 在 DevOS 创建 **`type: harness_update`** 的 Ticket（需已配置 `DEVOS_BASE_URL` 等）。**dryRun** 时只构造票据、不发起 HTTP。

ElectroOS 侧表 `devos_tickets`（迁移 `0006_devos_tickets.sql`）用于**持久化已上报记录**；本桥接函数只负责 DevOS HTTP，落库可在 API 层在 `createTicket` 成功后追加（后续任务）。

## 健康检查（Day 2）

- **Postgres：** `devos-postgres` 使用 `pg_isready`；`devos-paperclip` 在 DB **healthy** 后才启动（`depends_on: condition: service_healthy`）。
- **Paperclip HTTP：** compose 会显式挂载本地 `./paperclip` 到容器内 `/workspace/paperclip`。若缺少 `paperclip/package.json`，容器会直接报错退出，避免在错误目录里误跑。准备好本地副本后，可用 `curl -sfS http://localhost:3200/` 或项目实际 health 路径验证（以 `paperclip/` 实现为准）。

## ElectroOS 数据库迁移

在 **ElectroOS** 的 Postgres（`DATABASE_URL`，库 `patioer`）上执行 `packages/db/src/migrations/0006_devos_tickets.sql`，与 DevOS 独立库无关；用于本地记录已上报 DevOS 的 Ticket。

## 双库隔离（Sprint 5 Day 3 · 5.10）

- **ElectroOS 业务库：** `DATABASE_URL` → 通常 `…/patioer`
- **DevOS 应用库：** `DEVOS_DATABASE_URL` → 通常 `…@localhost:5433/devos`（与 `docker-compose.devos.yml` 一致）

启动时可用 `assertElectroOsAndDevOsDbIsolated(process.env.DATABASE_URL!, process.env.DEVOS_DATABASE_URL!)`（`@patioer/devos-bridge`）校验二者未指向同一 `host:port/dbname`。

## Prometheus / SRE 告警（Sprint 5 Day 6 · Task 5.7）

规则 YAML、`sre-alert-catalog` 与 DevOS 优先级映射见 [prometheus-sre-alerts.md](./prometheus-sre-alerts.md)。

## Alertmanager → DevOS Ticket（Sprint 5 Day 8–9 · Task 5.8）

Alertmanager 触发后 POST webhook 到 ElectroOS（或独立桥接服务）。`@patioer/devos-bridge` 提供完整处理链：

1. `parseAlertmanagerPayload(body)` — 校验并解析 Alertmanager v4 JSON。
2. `handleAlertmanagerWebhook({ payload, client })` — 遍历 `alerts`，仅对 `firing` 告警调用 `alertToDevOsTicket` → `client.createTicket`；`resolved` 忽略。返回 `{ created, skipped, errors, ticketIds }`。
3. `buildSreResponseSuggestion(alertName)` — 生成结构化响应建议（runbook 路径 + 操作摘要），供 SRE Agent 或通知模板使用。

Alertmanager `webhook_configs` 示例：

```yaml
receivers:
  - name: electroos-devos
    webhook_configs:
      - url: http://electroos-api:3100/api/v1/devos/alertmanager
        send_resolved: true
```

### 一次性管道（Day 9）

`runAlertmanagerPipeline({ body, client, dedup? })` 将上述三步合并：raw body → parse → dedup → createTicket → SRE suggestion，一调完成。适合 webhook 路由或脚本直接使用。

### Fingerprint 去重

`createAlertDedupStore({ ttlMs?, maxSize? })` 提供内存 TTL 去重（默认 15 分钟 / 2048 条）。Alertmanager 重复 POST 同一 fingerprint 时自动跳过，避免重复 Ticket。进程重启后清空。

### 端到端演练

`packages/devos-bridge/src/alertmanager-e2e-fixtures.ts` 导出 5 个预制 payload（4 种 firing + 1 resolved），可直接用于测试或 `curl` 模拟：

```bash
pnpm --filter @patioer/devos-bridge test -- alertmanager-e2e-fixtures
```

## Sprint 5 验收 Checklist（Day 10 · Task 5.11）

`runSprint5AcceptanceChecklist()` 一次性运行四项验收检查，返回 `{ checks, allPassed }`：

| ID | 检查项 | 函数 |
|----|--------|------|
| AC-1 | DevOsTicket 协议完整（type / priority / SLA / isDevOsTicket） | `checkTicketProtocolIntegrity()` |
| AC-2 | Harness 报错 → 合法 DevOsTicket | `checkHarnessToDevOsFlow()` |
| AC-3 | SRE alert catalog 覆盖全部 YAML 规则 + priority 映射 | `checkAlertRulesCatalogComplete()` |
| AC-4 | DB 隔离逻辑（同库拒绝 / 异库通过） | `checkDbIsolationLogic()` |

运行验收测试：

```bash
pnpm --filter @patioer/devos-bridge test -- sprint5-acceptance-checklist
```

跨模块集成测试：

```bash
pnpm --filter @patioer/devos-bridge test -- devos-bridge-integration
```
