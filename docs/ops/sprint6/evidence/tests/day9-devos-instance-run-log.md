# Day 9 DevOS 独立实例验证记录（AC-P2-11）

## 目标

- 验证 DevOS Paperclip 独立实例在 `3200` 端口可访问。
- 验证 DevOS PostgreSQL 使用独立端口 `5433` 且数据库为 `devos`。

## 关键修复

为保证 `docker-compose.devos.yml` 可稳定启动，本次修复了三处配置：

1. `devos-paperclip` 增加独立依赖卷  
   `devos_paperclip_node_modules:/workspace/paperclip/node_modules`  
   （避免宿主机 darwin `node_modules` 与容器 linux 平台冲突）
2. `devos-postgres` 升级到 `postgres:16`  
   （兼容 Paperclip 当前迁移 SQL）
3. `devos-paperclip` 运行参数补齐  
   - 端口映射：`3101:3101` + `3200:3101`（双入口）
   - `HOST=0.0.0.0`
   - `PORT=3101`
   - `PAPERCLIP_DEPLOYMENT_MODE=authenticated`
   - `BETTER_AUTH_SECRET=devos-local-secret`

## 执行命令

```bash
docker compose -f docker-compose.devos.yml up -d
docker compose -f docker-compose.devos.yml ps
curl http://localhost:3200
curl http://localhost:3101
curl http://localhost:3200/api/health
curl http://localhost:3101/api/health
```

## 验证结果

- `docker compose ps` 显示：
  - `devos-paperclip` `Up`，端口 `0.0.0.0:3200->3101/tcp` 与 `0.0.0.0:3101->3101/tcp`
  - `devos-postgres` `Up (healthy)`，端口 `0.0.0.0:5433->5432/tcp`
- `curl http://localhost:3200` 返回 `200`
- `curl http://localhost:3101` 返回 `200`
- `curl http://localhost:3200/api/health` 返回 `200`
- `curl http://localhost:3101/api/health` 返回 `200`
- `/api/health` 返回摘要：

```json
{"status":"ok","version":"0.3.1","deploymentMode":"authenticated","deploymentExposure":"private","authReady":true}
```

- 数据库连通性验证：

```bash
postgres://postgres:postgres@localhost:5433/devos
```

查询返回：

```json
{"db":"devos","port":5432}
```

## 结论

- `AC-P2-11` 达成，可置 `✅`。
