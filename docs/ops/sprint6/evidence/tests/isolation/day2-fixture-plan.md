# Day 2 隔离测试夹具准备清单

## 目标

为 `AC-P2-15` 提供可复用的多平台租户测试夹具：

- Tenant A：`shopify + amazon`
- Tenant B：`tiktok + shopee`

## 夹具准备步骤

1. 建立双租户基础数据（tenant、agent、product、order、approval）。
2. 在 Tenant A 注入 Shopify 与 Amazon 的凭证和业务数据。
3. 在 Tenant B 注入 TikTok 与 Shopee 的凭证和业务数据。
4. 确保关键表均有跨租户不可见断言样本：
   - `products`
   - `orders`
   - `inventory_levels`
   - `ads_campaigns`
   - `devos_tickets`

## 反例场景（必须覆盖）

- 错误 `x-tenant-id` 请求任一资源时，返回 `404` 或 `401/400`（按路由设计）。
- Tenant A 请求 Tenant B 的资源 ID，必须不可见。
- 缺失 `x-tenant-id` 头时，必须被拒绝。

## 产出物

- 隔离测试日志：`docs/ops/sprint6/evidence/tests/isolation/`
- 失败样本与修复记录：`docs/ops/sprint6/evidence/tests/isolation/`
- AC 更新：`docs/ops/sprint6/sprint6-ac-evidence-index.md`
