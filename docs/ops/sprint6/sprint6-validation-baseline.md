# Sprint 6 验证基线

## 1) 分支与代码基线

- 分支：`main`
- 基线 commit：`470a198d4977cce0fc81e607f78ae7f059c6e663`
- 冻结时间：`2026-03-24 21:15`
- 负责人：`@davidgao`

## 2) 环境版本

- Node：`v25.3.0`
- pnpm：`9.15.0`
- PostgreSQL：`14`（from `docker-compose.yml: postgres:14`）
- Redis：`7-alpine`（from `docker-compose.yml: redis:7-alpine`）
- OS/Runtime：`darwin 24.6.0 / zsh`

## 3) 运行参数

- API URL：`http://localhost:3100`
- 关键开关：`S6_VALIDATION_MODE=true`
- 并发配置：`tenants=10, agents-per-tenant=5`
- 重试配置：`maxAttempts=5, backoff=exponential, jitter=on`

## 4) 验证范围

- 目标 AC：`AC-P2-01 ~ AC-P2-20`
- 本 Sprint 关键 AC：`AC-P2-10 / 15 / 16 / 17 / 18`
- 不纳入项：`Phase 3 范围功能与非 Sprint 6 验收项`

## 5) 证据归档路径

- 测试报告：`docs/ops/sprint6/evidence/tests/`
- 日志归档：`docs/ops/sprint6/evidence/logs/`
- 监控截图：`docs/ops/sprint6/evidence/metrics/`
- 文档 PR：`docs/ops/sprint6/evidence/changes/`
