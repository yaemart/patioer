import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

type Row = {
  time: Date
  activeAgents: number
  errorAgents: number
  crashFree: boolean
}

function parseRows(path: string): Row[] {
  const text = readFileSync(path, 'utf-8')
  const rows = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('| 20'))

  return rows
    .map((line) => line.split('|').map((s) => s.trim()).filter(Boolean))
    .map((cells) => {
      const [time, activeAgents, errorAgents, _pending, _backlog, _events10m, _openTickets, crashFree] = cells
      return {
        time: new Date(time),
        activeAgents: Number(activeAgents),
        errorAgents: Number(errorAgents),
        crashFree: crashFree === 'yes',
      }
    })
    .filter((r) => !Number.isNaN(r.time.getTime()))
}

function hoursBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / (1000 * 60 * 60)
}

async function main() {
  const file = resolve(
    process.cwd(),
    process.env.SNAPSHOT_FILE ?? 'docs/ops/sprint6/evidence/metrics/day7-8-stability-snapshots.md',
  )

  const rows = parseRows(file)
  if (rows.length === 0) throw new Error('no snapshot rows found')

  const windowStartIso = process.env.WINDOW_START_ISO
  const scopedRows = windowStartIso
    ? rows.filter((r) => r.time.getTime() >= new Date(windowStartIso).getTime())
    : rows
  if (scopedRows.length === 0) throw new Error('no snapshot rows found in selected window')

  const sorted = [...scopedRows].sort((a, b) => a.time.getTime() - b.time.getTime())
  const first = sorted[0]!
  const last = sorted[sorted.length - 1]!
  const windowHours = hoursBetween(first.time, last.time)

  const minActiveAgents = Math.min(...sorted.map((r) => r.activeAgents))
  const maxErrorAgents = Math.max(...sorted.map((r) => r.errorAgents))
  const allCrashFree = sorted.every((r) => r.crashFree)

  const passed =
    windowHours >= 48 &&
    minActiveAgents >= 5 &&
    maxErrorAgents === 0 &&
    allCrashFree

  const result = {
    passed,
    windowStartIso: windowStartIso ?? null,
    windowHours: Number(windowHours.toFixed(2)),
    snapshotCount: sorted.length,
    minActiveAgents,
    maxErrorAgents,
    allCrashFree,
    reasons: passed
      ? ['AC-P2-10 satisfied']
      : [
          windowHours < 48 ? 'windowHours < 48' : null,
          minActiveAgents < 5 ? 'minActiveAgents < 5' : null,
          maxErrorAgents > 0 ? 'maxErrorAgents > 0' : null,
          !allCrashFree ? 'not all snapshots crashFree' : null,
        ].filter(Boolean),
  }

  console.log(JSON.stringify(result, null, 2))
  if (!passed) process.exit(1)
}

main().catch((err) => {
  console.error('[ac-p2-10] failed:', err)
  process.exit(1)
})
