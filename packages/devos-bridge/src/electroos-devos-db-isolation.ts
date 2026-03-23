/**
 * Sprint 5 Task 5.10：校验 ElectroOS 与 DevOS 不使用同一 Postgres 库（host+port+dbname）。
 * 用于启动时或运维脚本；与 `docker-compose.devos.yml`（库名 `devos`、宿主机 5433）对齐。
 */

export interface PostgresIdentity {
  hostname: string
  port: string
  database: string
}

/** 从 `postgres://` / `postgresql://` URL 解析库标识（用于隔离比对）。 */
export function postgresIdentityFromUrl(urlString: string): PostgresIdentity {
  const u = new URL(urlString)
  const database = u.pathname.replace(/^\//, '').split('/')[0] ?? ''
  const port = u.port || '5432'
  return { hostname: u.hostname, port, database }
}

/** 是否指向同一物理 Postgres 数据库（同 host、同 port、同 dbname）。 */
export function isSamePostgresDatabase(a: string, b: string): boolean {
  const ia = postgresIdentityFromUrl(a)
  const ib = postgresIdentityFromUrl(b)
  return ia.hostname === ib.hostname && ia.port === ib.port && ia.database === ib.database
}

/** 相同时抛错，避免误把 DevOS 与 ElectroOS 指到同一库。 */
export function assertElectroOsAndDevOsDbIsolated(
  electroOsDatabaseUrl: string,
  devOsDatabaseUrl: string,
): void {
  if (isSamePostgresDatabase(electroOsDatabaseUrl, devOsDatabaseUrl)) {
    throw new Error(
      'electro_os_and_dev_os_must_use_distinct_postgres_databases: same host/port/dbname',
    )
  }
}
