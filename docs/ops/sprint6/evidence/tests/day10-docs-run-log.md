# Day 10 文档收口执行记录（Task 6.7 / 6.8 / 6.9）

## 目标

- 完成 Sprint 6 OpenAPI 补充规范（Task 6.7）。
- 完成 Phase 2 架构 ADR-0002（Task 6.9）。
- 完成运维文档更新（Task 6.8）。

## 执行内容

1. 新增 OpenAPI 补充文件：
   - `docs/openapi/sprint6-api.openapi.yaml`
   - 覆盖范围：Onboarding、Ads/Inventory、Amazon/TikTok/Shopee OAuth 与 Webhook、Platform Credentials

2. 新增 ADR-0002：
   - `docs/adr/0002-phase2-harness-market-devos-deployment.md`
   - 决策范围：Harness 扩展策略、Market 层职责、DevOS 独立部署与隔离

3. 更新运维文档：
   - `docs/ops/devos-local.md`（DevOS 端口与运行说明更新为 3101 主入口 + 3200 兼容入口）
   - `docs/operations.md`（新增 Sprint 6 OpenAPI 文件入口、DevOS 部署章节、Prometheus/SRE 告警章节）

## 验证

- `docs/openapi/sprint6-api.openapi.yaml` 已可直接用于文档评审与客户端对接参考。
- `docs/adr/0002-phase2-harness-market-devos-deployment.md` 已进入 `docs/adr` 正式序列。
- 运维文档端口叙述与当前 `docker-compose.devos.yml` 保持一致。

## 结论

- Task 6.7 / 6.8 / 6.9 已完成，可作为 Sprint 6 收口证据归档。
