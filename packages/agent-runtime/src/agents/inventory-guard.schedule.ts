/**
 * Ops / Paperclip: run once per day at **08:00 local** using cron `0 8 * * *` and set
 * `CRON_TZ` to the tenant’s business timezone (IANA), e.g. `Asia/Shanghai`.
 * Alternatively set `TZ` on the worker process if a single global default is enough.
 *
 * This module only provides helpers for tests and optional `enforceDailyWindow` in the agent;
 * it does not register a cron.
 */
export const INVENTORY_GUARD_LOCAL_HOUR = 8

/** Recommended cron expression (minute hour dom month dow) — 08:00 in `CRON_TZ`. */
export const INVENTORY_GUARD_RECOMMENDED_CRON = '0 8 * * *'

export function getHourInTimeZone(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hourCycle: 'h23',
    timeZone,
  }).formatToParts(date)
  const h = parts.find((p) => p.type === 'hour')?.value
  return h ? parseInt(h, 10) : 0
}
