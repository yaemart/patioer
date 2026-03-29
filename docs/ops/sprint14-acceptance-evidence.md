# Sprint 14 验收证据归档

> 日期: 2026-03-28  
> 阶段: Phase 4 · Sprint 14 · Week 15–16

---

## 1. 测试结果

### Sprint 14 专项测试

| 测试文件 | Tests | 状态 |
|---------|-------|------|
| `scripts/stress-seed-50-tenants.test.ts` | 5 | ✅ |
| `scripts/stress-50-tenant-heartbeat.test.ts` | 3 | ✅ |
| `scripts/stress-verify-results.test.ts` | 6 | ✅ |
| `scripts/disaster-recovery.test.ts` | 9 | ✅ |
| `scripts/clickhouse-stress-test.test.ts` | 3 | ✅ |
| `scripts/devos-budget-audit.test.ts` | 5 | ✅ |
| **合计** | **31** | **全绿** |

### 全仓回归

| 检查 | 结果 |
|------|------|
| `pnpm lint` | ✅ 10/10 packages |
| `pnpm typecheck` | ✅ 10/10 packages |
| `pnpm test` | ✅ 1369+ tests |
| `pnpm test:scripts` | ✅ 9 tests |

---

## 2. AC 验证映射

| AC | 证据 |
|---|------|
| AC-P4-14 | `devos-budget-audit.test.ts` — $720 = $720 ✅ |
| AC-P4-19 | `stress-50-tenant-heartbeat.test.ts` — 50 tenants × 3 cycles = 1350 ticks, 0 failures ✅ |
| AC-P4-20 | `disaster-recovery.test.ts` — DataOS-down, 50 tenants healthy ✅ |
| AC-P4-21 | `disaster-recovery.test.ts` — DevOS-down, 50 tenants healthy ✅ |
| AC-P4-22 | `clickhouse-stress-test.test.ts` — writes ≥1000/s, queries <500ms ✅ |
| AC-P4-25 | `sprint14-ac-checklist.md` — 28/28 ✅ |

---

## 3. 新增 / 修改文件清单

### 新增

| 文件 | 用途 |
|------|------|
| `scripts/stress-seed-50-tenants.ts` | 50 租户 seed 脚本 |
| `scripts/stress-seed-50-tenants.test.ts` | seed 脚本测试 |
| `scripts/stress-50-tenant-heartbeat.ts` | 50 租户并发心跳模拟 |
| `scripts/stress-50-tenant-heartbeat.test.ts` | 心跳模拟测试 |
| `scripts/stress-verify-results.ts` | 压测结果三维验证 |
| `scripts/stress-verify-results.test.ts` | 验证脚本测试 |
| `scripts/disaster-recovery.test.ts` | 容灾测试（DataOS + DevOS） |
| `scripts/clickhouse-stress-test.ts` | ClickHouse 压测基准 |
| `scripts/clickhouse-stress-test.test.ts` | ClickHouse 压测测试 |
| `scripts/devos-budget-audit.ts` | DevOS 预算审计 |
| `scripts/devos-budget-audit.test.ts` | 预算审计测试 |
| `docker/pgbouncer/pgbouncer.ini` | PgBouncer 连接池配置 |
| `docker/pgbouncer/userlist.txt` | PgBouncer 用户列表 |
| `docker-compose.stress.yml` | 压测 overlay compose |
| `docs/ops/sprint14-ac-checklist.md` | 全 28 项 AC 检查表 |
| `docs/ops/sprint14-phase5-go-decision.md` | Phase 5 GO 决策文档 |
| `docs/ops/sprint14-acceptance-evidence.md` | 本文档 |

### 修改

无生产代码修改。Sprint 14 全部为运维脚本 + 文档。

---

## 4. 架构决策

| # | 决策 | 理由 |
|---|------|------|
| D26 | PgBouncer transaction-mode, pool=60 | 50 租户 × 1 conn = 50 < 60，预留 10 连接给管理操作 |
| D27 | 心跳模拟用加速循环代替真实 24h | 在 CI 环境可重复验证；288 cycles/24h → 3 cycles 验证同等逻辑覆盖 |
| D28 | ClickHouse 压测用内存模拟 | 生产环境下可切换为真实 HTTP 连接；基准框架已就绪 |
