# Day 8 · 48h 稳定性最终报告（AC-P2-10 阶段二）

## 验收目标

- 5 个 Agent 同时运行 48h。
- 运行周期内无 crash。
- 心跳/事件日志连续可追溯。

## 证据清单

- 启动记录：`docs/ops/sprint6/evidence/metrics/day7-stability-run-log.md`
- 快照明细：`docs/ops/sprint6/evidence/metrics/day7-8-stability-snapshots.md`

## 当前观测结论（截至本次）

- 快照采样机制：`已建立`
- 观测窗口：`进行中`
- 当前快照健康度：`G`（最新样本）
- 高优先异常（P0/P1）：`无`

## Day8 自动化执行结果

- 执行 `5 Agent` 引导：
  - `DATABASE_URL='postgres://gaoyuehebabadiannao@localhost:5432/patioer' pnpm ops:sprint6:stability:bootstrap-agents`
  - 结果：`createdAgents=5`，`activeAgents=5`
- 执行快照采集：
  - `DATABASE_URL='postgres://gaoyuehebabadiannao@localhost:5432/patioer' pnpm ops:sprint6:stability:snapshot`
  - 最新样本：`2026-03-24T23:02:53.408Z`，`activeAgents=5`，`errorAgents=0`，`health=G`
- 执行 AC 自动检查：
  - `WINDOW_START_ISO='2026-03-24T23:02:53.408Z' pnpm ops:sprint6:stability:check-ac`
  - 结果：`未通过（windowHours < 48）`
- 执行自动循环采样（短周期验证）：
  - `DATABASE_URL='postgres://gaoyuehebabadiannao@localhost:5432/patioer' ITERATIONS=2 INTERVAL_SEC=1 pnpm ops:sprint6:stability:loop`
  - 结果：连续 2 次快照均为 `activeAgents=5`、`errorAgents=0`、`health=G`

## Day10 自动续跑状态（收口跟进）

- 当前 UTC 时间：`2026-03-25T04:47:30Z`
- 以 5-agent 起点窗口检查：
  - `WINDOW_START_ISO='2026-03-24T23:02:53.408Z' pnpm ops:sprint6:stability:check-ac`
  - 结果：`windowHours=5.31`、`minActiveAgents=5`、`maxErrorAgents=0`、`allCrashFree=true`
  - 未通过原因：仅 `windowHours < 48`
- 已启动自动 6h 采样循环：
  - `DATABASE_URL='postgres://gaoyuehebabadiannao@localhost:5432/patioer' ITERATIONS=9 INTERVAL_SEC=21600 pnpm ops:sprint6:stability:loop`
  - 首次自动样本：`2026-03-25T04:47:49.989Z`，`activeAgents=5`，`errorAgents=0`，`health=G`
- 预计最早可通过时刻（按 WINDOW_START_ISO + 48h）：`2026-03-26T23:02:53.408Z`

## Day8 收口检查清单

- [x] 阶段二收口文档建立（本文件）
- [x] 快照持续追加（Day8 首次采样完成）
- [ ] 满足 48h 连续运行窗口
- [x] 满足「5 Agent 同时运行」约束（已进入观测）
- [ ] AC-P2-10 置 `✅`

## 偏差与修正

- 偏差：48h 观察窗口尚未走完。
- 修正动作：
  1. 保持 5 个目标 Agent 持续 `active`；
  2. 按 6h 频率持续采样；
  3. 窗口满足 48h 后执行 `ops:sprint6:stability:check-ac` 并置 AC `✅`。

## 判定

- 当前判定：`AC-P2-10 = ⏳（阶段二进行中）`
- 达成条件：完成 48h 窗口 + Active Agents 条件后，更新为 `✅`。

## AC-P2-10 最终验收结果（自动收口）

- 验收时间：`2026-03-27T05:09:32.491Z`
- windowHours：`53.75`
- snapshotCount：`14`
- minActiveAgents：`5`
- maxErrorAgents：`0`
- allCrashFree：`true`
- 判定：`AC-P2-10 = ✅`
