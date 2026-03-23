/** Alertmanager v4 webhook alert entry（精简子集，只保留 DevOS 桥接用到的字段）。 */
export interface AlertmanagerAlert {
  status: 'firing' | 'resolved'
  labels: Record<string, string>
  annotations: Record<string, string>
  startsAt: string
  endsAt: string
  fingerprint: string
}

/** Alertmanager webhook POST body 顶层结构（精简子集）。 */
export interface AlertmanagerWebhookPayload {
  version: string
  status: 'firing' | 'resolved'
  alerts: AlertmanagerAlert[]
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isStringRecord(v: unknown): v is Record<string, string> {
  if (!isPlainObject(v)) return false
  for (const val of Object.values(v)) {
    if (typeof val !== 'string') return false
  }
  return true
}

function isValidAlert(v: unknown): v is AlertmanagerAlert {
  if (!isPlainObject(v)) return false
  if (v.status !== 'firing' && v.status !== 'resolved') return false
  if (!isStringRecord(v.labels)) return false
  if (!isStringRecord(v.annotations)) return false
  if (typeof v.startsAt !== 'string') return false
  if (typeof v.endsAt !== 'string') return false
  if (typeof v.fingerprint !== 'string') return false
  return true
}

/** 从 `request.body` 解析；返回 null 表示格式不符。 */
export function parseAlertmanagerPayload(
  body: unknown,
): AlertmanagerWebhookPayload | null {
  if (!isPlainObject(body)) return null
  if (typeof body.version !== 'string') return null
  if (body.status !== 'firing' && body.status !== 'resolved') return null
  if (!Array.isArray(body.alerts)) return null
  for (const a of body.alerts) {
    if (!isValidAlert(a)) return null
  }
  return body as unknown as AlertmanagerWebhookPayload
}
