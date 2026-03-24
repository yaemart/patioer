/** Day 1：从 process.env 读取 DevOS 连接信息；未配置时视为「桥接关闭」，不抛异常。 */
export interface DevOsBridgeEnv {
  /** 例：`http://localhost:3200`；空字符串表示未配置。 */
  baseUrl: string
  /** 请求 DevOS 时可选的 `x-api-key`。 */
  apiKey?: string
}

export function loadDevOsBridgeEnv(env: NodeJS.ProcessEnv): DevOsBridgeEnv {
  const baseUrl = (env.DEVOS_BASE_URL ?? '').trim()
  const rawKey = env.DEVOS_API_KEY
  if (rawKey === undefined || rawKey === '') {
    return { baseUrl }
  }
  return { baseUrl, apiKey: rawKey.trim() }
}

/** 是否允许发起 DevOS HTTP 调用（baseUrl 非空且为合法 http(s)）。 */
export function isDevOsBridgeConfigured(env: DevOsBridgeEnv): boolean {
  if (!env.baseUrl) return false
  try {
    const u = new URL(env.baseUrl)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}
