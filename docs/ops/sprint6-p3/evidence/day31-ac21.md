# AC-P3-21 验证证据：ClickHouse TTL 2 年生效

**验证日期：** 2026-03-27
**验收标准：** 数据保留策略验证：ClickHouse TTL 2 年生效

## 验证结果

### events 表

```sql
TTL toDateTime(created_at) + toIntervalYear(2)
```

✅ 生效

### price_events 表

```sql
TTL toDateTime(created_at) + toIntervalYear(2)
```

✅ 生效（原表缺失 TTL，已通过 `ALTER TABLE MODIFY TTL` 修复）

## DDL 源文件一致性

| 文件 | events TTL | price_events TTL |
|---|---|---|
| `docker/clickhouse-init/000-create-tables.sql` | ✅ 2 YEAR | ✅ 2 YEAR |
| `scripts/clickhouse/dataos-events.sql` | ✅ 2 YEAR | ✅ 2 YEAR |

## TTL 工作原理

- ClickHouse 在 merge 时自动删除超过 TTL 的分区数据
- 分区键 `toYYYYMM(created_at)` 确保按月分区，2 年后整月删除
- TTL 生效不需要手动触发，ClickHouse 后台自动执行

## 结论

**AC-P3-21 ✅ PASS** — 两张表均已配置 TTL 2 年数据保留策略
