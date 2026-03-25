# Day 10 AC-P2-13 实战演练记录（Prometheus P0 -> DevOS Ticket）

## 目标

- 验证 SRE 告警链路：收到 Prometheus P0 告警后，能够生成 DevOS 响应 Ticket。

## 演练方式

- 使用 `@patioer/devos-bridge` 的真实告警管道：
  - `runAlertmanagerPipeline`
  - `createDevOsClient`
  - `FIXTURE_HARNESS_ERROR_FIRING`（critical / P0）
- 通过本地 HTTP stub 模拟 DevOS Ticket 接口（`POST /api/v1/devos/tickets`），验证完整 HTTP 创建链路和 ticket 字段。

## 执行命令

```bash
pnpm ops:sprint6:drill:ac-p2-13
```

## 演练结果

- `passed: true`
- `created: 1`
- `errors: 0`
- `ticketIds: ["drill-1"]`
- 捕获到的 ticket 关键字段：
  - `type: harness_update`
  - `priority: P0`
  - `title: [SRE] ElectroOsHarnessErrorRateHigh`
  - `sla: acknowledge=1h, resolve=4h`

## 结论

- AC-P2-13 达成，可置 `✅`。
- P0 告警到 DevOS Ticket 的响应链路（解析 -> 映射优先级 -> HTTP 创建 -> 建议动作）已验证可执行。
