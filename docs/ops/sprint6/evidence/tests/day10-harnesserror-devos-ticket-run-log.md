# Day 10 AC-P2-12 实跑记录（HarnessError -> DevOS Ticket）

## 目标

- 验证 ElectroOS 在 `HarnessError` 场景下，会触发 DevOS Ticket 链路（远端创建 + 本地审计落库）。

## 代码改动

- 新增：`apps/api/src/lib/harness-error-devos-ticket.ts`
  - 使用 `@patioer/devos-bridge` 构造 `harness_update` ticket
  - 当 `DEVOS_BASE_URL` 配置可用时，调用 DevOS HTTP `createTicket`
  - 无论远端成功与否，都会写入本地 `devos_tickets` 与 `agent_events`（`devos.ticket.create`）
- 接入：`apps/api/src/routes/agents-execute.ts`
  - 在 `catch (HarnessError)` 分支中调用上述函数

## 验证命令

```bash
pnpm --filter api test -- src/lib/harness-error-devos-ticket.test.ts
pnpm --filter api test -- src/routes/agents-execute.test.ts
```

## 验证结果

- `src/lib/harness-error-devos-ticket.test.ts`：
  - `2 passed`
  - 覆盖两种关键路径：
    1. 未配置 DevOS bridge 时，仍本地落 `devos_tickets`
    2. 使用本地 stub DevOS HTTP server 时，成功拿到 `ticketId` 并落库
- `src/routes/agents-execute.test.ts`：
  - `35 passed`
  - `HarnessError` 返回码行为保持不回归（`429` / `502`）

## 结论

- AC-P2-12 达成，可置 `✅`：
  - `HarnessError` 触发后，DevOS ticket 创建链路可执行；
  - 具备本地持久化兜底，不依赖远端可用性。
