# Day 4 Amazon 429 退避测试记录（AC-P2-18）

## 变更摘要

- 更新 `packages/harness/src/amazon.harness.test.ts`，新增 429 限流关键场景：
  - 持续 `429` 时重试 5 次后抛出 `HarnessError(code=429)`
  - `x-amzn-RateLimit-Limit` 非法值时回退到 jittered exponential backoff
- 保留并复用既有场景：
  - 单次 `429` 后恢复成功
  - `x-amzn-RateLimit-Limit=0.5` 时使用 >= 2000ms 延迟

## 执行命令

```bash
pnpm --filter @patioer/harness test -- amazon.harness.test.ts
pnpm --filter @patioer/harness typecheck
```

## 结果

- `amazon.harness.test.ts`：`33 passed`
- `@patioer/harness typecheck`：通过
- 结论：Amazon 429 限流场景下，Harness 具备自动退避重试能力并在耗尽后以标准错误终止，满足 Day4 验收目标。
