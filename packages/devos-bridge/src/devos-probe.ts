/**
 * Sprint 5 Day 4 · 5.3 联调收尾：探测 DevOS HTTP 基座是否可达（不依赖具体 Ticket 路由）。
 */

export interface ProbeDevOsOptions {
  /** 默认 `globalThis.fetch` */
  fetch?: typeof fetch
  /** 超时毫秒，默认 5000 */
  timeoutMs?: number
}

/** 对 `baseUrl` 发 GET `/` 或根路径；`2xx`/`3xx`/`404`（部分栈无根路由）视为可达。 */
export async function probeDevOsHttpBaseUrl(
  baseUrl: string,
  options: ProbeDevOsOptions = {},
): Promise<boolean> {
  const fetchFn = options.fetch ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? 5000
  const root = baseUrl.replace(/\/$/, '')
  const url = `${root}/`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchFn(url, { method: 'GET', signal: controller.signal })
    return res.ok || (res.status >= 300 && res.status < 400) || res.status === 404
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
