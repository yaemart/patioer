# Sprint 6 AC 证据索引

> 状态：`⬜ 待做` / `✅ 通过` / `⏳ 待补` / `🔽 降级`

| AC | 状态 | 证据链接 | 负责人 | 最后更新时间 | 备注 |
|---|---|---|---|---|---|
| AC-P2-01 | ⏳ | `docs/ops/sprint6/evidence/tests/day9-ac01-14-audit.md` | `@davidgao` | `2026-03-26` | 代码已具备，待 Amazon 真实联调（非 mock 数据） |
| AC-P2-02 | ⏳ | `docs/ops/sprint6/evidence/tests/day9-ac01-14-audit.md` | `@davidgao` | `2026-03-26` | 待 Amazon 真机更新价并回查 |
| AC-P2-03 | ⏳ | `docs/ops/sprint6/evidence/tests/day9-ac01-14-audit.md` | `@davidgao` | `2026-03-26` | TikTok webhook 需外部联调 |
| AC-P2-04 | ⏳ | `docs/ops/sprint6/evidence/tests/day9-ac01-14-audit.md` | `@davidgao` | `2026-03-26` | Shopee SG+MY 需真实联调 |
| AC-P2-05 | ✅ | `docs/ops/sprint6/evidence/tests/day9-ac01-14-audit.md` | `@davidgao` | `2026-03-26` | market currency 单测通过（SGD→USD 误差阈值） |
| AC-P2-06 | ✅ | `docs/ops/sprint6/evidence/tests/day9-ac01-14-audit.md` | `@davidgao` | `2026-03-26` | market tax 单测通过（ID PPN 11%） |
| AC-P2-07 | ✅ | `docs/ops/sprint6/evidence/tests/day10-ads-inventory-schedule-run-log.md` | `@davidgao` | `2026-03-26` | Day10 演练通过：4h cadence（3 tick）触发 Ads Optimizer 决策日志 |
| AC-P2-08 | ✅ | `docs/ops/sprint6/evidence/tests/day10-ads-inventory-schedule-run-log.md` | `@davidgao` | `2026-03-26` | Day10 演练通过：预算 506 (>500) 请求审批且不执行预算更新 |
| AC-P2-09 | ✅ | `docs/ops/sprint6/evidence/tests/day10-ads-inventory-schedule-run-log.md` | `@davidgao` | `2026-03-26` | Day10 演练通过：08:00 本地窗口运行并创建低库存补货 Ticket |
| AC-P2-10 | ⏳ | `docs/ops/sprint6/evidence/metrics/day8-stability-final-report.md` | `@davidgao` | `2026-03-26` | Day8 已完成 5 Agent 运行态引导，等待 48h 窗口完成后置 ✅ |
| AC-P2-11 | ✅ | `docs/ops/sprint6/evidence/tests/day9-devos-instance-run-log.md` | `@davidgao` | `2026-03-26` | DevOS 独立实例 3200/3101 双入口可访问，devos-postgres 5433 healthy |
| AC-P2-12 | ✅ | `docs/ops/sprint6/evidence/tests/day10-harnesserror-devos-ticket-run-log.md` | `@davidgao` | `2026-03-26` | Day10 实跑通过：HarnessError 分支触发 DevOS ticket 链路（远端+本地审计） |
| AC-P2-13 | ✅ | `docs/ops/sprint6/evidence/tests/day10-alertmanager-p0-run-log.md` | `@davidgao` | `2026-03-26` | Day10 已完成 P0 演练：告警管道创建 DevOS Ticket（P0, harness_update） |
| AC-P2-14 | ✅ | `docs/ops/sprint6/evidence/tests/day10-db-isolation-run-log.md` | `@davidgao` | `2026-03-26` | Day10 实跑通过：隔离测试 7/7 + 5432/5433 端口分离 + 运行时断言通过 |
| AC-P2-15 | ✅ | `docs/ops/sprint6/evidence/tests/isolation/day2-run-log.md` | `@davidgao` | `2026-03-25` | Day2 实跑通过：DB 33/33 + API 18/18 |
| AC-P2-16 | ✅ | `docs/ops/sprint6/evidence/tests/concurrency/day3-run-log.md` | `@davidgao` | `2026-03-25` | Day3 并发实跑通过：10 tenant × 5 agents × 3 rounds |
| AC-P2-17 | ✅ | `docs/ops/sprint6/evidence/tests/coverage/day5-run-log.md` | `@davidgao` | `2026-03-25` | Day5 覆盖率门禁通过（market/devos/harness/api） |
| AC-P2-18 | ✅ | `docs/ops/sprint6/evidence/tests/rate-limit/day4-run-log.md` | `@davidgao` | `2026-03-25` | Amazon 429 退避重试实测通过（harness 33/33） |
| AC-P2-19 | ✅ | `docs/ops/sprint6/evidence/tests/paperclip/day8-active-agents-run-log.md` | `@davidgao` | `2026-03-26` | Day8 实测 Dashboard agents.active=3（S6 Active Agent 1/2/3） |
| AC-P2-20 | ✅ | `docs/ops/sprint6/evidence/tests/paperclip/day8-create-issue-run-log.md` | `@davidgao` | `2026-03-26` | Day8 修复 createIssue 路由并完成真实建单冒烟，返回 issueId + URL |
