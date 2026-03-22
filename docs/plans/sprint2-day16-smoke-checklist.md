# Sprint 2 · Day 16 — CARD-D16-01 三平台集成冒烟（手动）

> 对应 `phase2-plan.md` **CARD-D16-01**。在本地或 staging 完成下列步骤后，在文末「冒烟检查清单」打勾。

## 1. 启动依赖

```bash
docker compose up -d postgres redis paperclip
pnpm dev
# 或：pnpm --filter api dev
```

API 默认：`http://localhost:3100`。

## 2. TikTok sandbox 冒烟

1. 在 TikTok Partner Center 申请并激活 **sandbox** Shop（与计划一致）。
2. 在 `.env` 中设置 `TIKTOK_APP_KEY`、`TIKTOK_APP_SECRET`（与 Partner Center 一致）。
3. 发起 OAuth 入口（浏览器会重定向到 TikTok 授权页）：

```bash
curl -s -o /dev/null -w "%{url_effective}\n" -L "http://localhost:3100/api/v1/tiktok/auth?tenantId=<test-tenant>&appKey=<sandbox-app-key>"
# 期望：最终 URL 含 app_key、state 等参数（重定向到 TikTok 授权页）
```

## 3. Shopee sandbox 冒烟（test-stable）

```bash
curl -s -o /dev/null -w "%{url_effective}\n" -L \
  "http://localhost:3100/api/v1/shopee/auth?tenantId=<test-tenant>&market=SG"
# 期望：重定向到 Shopee 授权页，URL 含 partner_id、sign 等
```

## 4. 商品列表（需已写入 sandbox 凭证）

在 `platform_credentials` 中已有 TikTok / Shopee 凭证后：

```bash
curl -s "http://localhost:3100/api/v1/products" \
  -H "x-tenant-id: <test-tenant>" | jq .
```

## 5. TikTok Webhook — `ORDER_STATUS_CHANGE` / `LIVE_ORDER`

- 普通订单：`type: ORDER_STATUS_CHANGE` → 落库 `webhook_events.status = received`。
- 直播订单：`type: LIVE_ORDER` → 落库 **`status = received_live`**（便于下游优先处理；重放队列与 `received` 一并扫描）。

本仓库校验方式：`HMAC-SHA256(appSecret, timestamp + nonce + rawBody)`，结果 **Base64**，放在 **`Authorization`** 头（与实现一致；非 `x-tiktok-signature`）。

```bash
export TIKTOK_APP_SECRET="test-secret"   # 与 API 进程环境一致
export TENANT_ID="<your-tenant-uuid>"

TS=$(date +%s)
NONCE=nonce123
BODY='{"type":"ORDER_STATUS_CHANGE","data":{"order_id":"test-123"},"shop_id":"test-shop"}'

# Base64(HMAC-SHA256(secret, timestamp+nonce+body))
SIG=$(printf '%s' "${TS}${NONCE}${BODY}" | openssl dgst -sha256 -hmac "${TIKTOK_APP_SECRET}" -binary | base64)

curl -s -w "\nHTTP:%{http_code}\n" -X POST "http://localhost:3100/api/v1/webhooks/tiktok" \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: ${TENANT_ID}" \
  -H "Authorization: ${SIG}" \
  -H "x-timestamp: ${TS}" \
  -H "x-nonce: ${NONCE}" \
  -d "${BODY}"
# 期望：200 且 body 含 ok: true；错误签名应为 401
```

## 6. Shopee Webhook 签名

按 `docs/operations.md` 中 Shopee 说明配置 `SHOPEE_PARTNER_KEY`，使用 Partner Console 要求的签名算法对 body 签名；**错误签名应返回 401**。

## 7. Paperclip `createIssue`（DG-03）

配置 `PAPERCLIP_API_URL` + `PAPERCLIP_API_KEY` 后，`POST /api/v1/agents/:id/execute` 执行 **Product Scout** 在发现异常 SKU 时会 **`ticket.create` 审计事件** 并 **调用 `PaperclipBridge.createIssue`**。在 Paperclip Issues UI 中应能看到对应 Issue（详见 Day 14 DG-03）。

---

## 冒烟检查清单

| # | 检查项 | 期望结果 | 完成 |
|---|--------|---------|------|
| 1 | TikTok auth URL 构建正确 | 含 app_key + state 参数 | ⬜ |
| 2 | Shopee auth URL 构建正确 | 含 partner_id + sign 参数 | ⬜ |
| 3 | TikTok Webhook 签名验证 | 正确签名 200，错误签名 401 | ⬜ |
| 4 | Shopee Webhook 签名验证 | 正确签名 200，错误签名 401 | ⬜ |
| 5 | `PaperclipBridge.createIssue()` | Paperclip UI 可见 Issue | ⬜ |
| 6 | 已有 Shopify 功能不受影响 | Phase 1 路径仍可用 | ⬜ |

**产出：** 三平台集成路径验证通过（本表全部打勾后可归档或附在 Sprint Review）。
