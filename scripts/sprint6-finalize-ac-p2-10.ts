import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

function ensureCheckPassed(checkJsonPath: string) {
  const raw = readFileSync(checkJsonPath, 'utf-8')
  const parsed = JSON.parse(raw) as {
    passed: boolean
    windowHours: number
    snapshotCount: number
    minActiveAgents: number
    maxErrorAgents: number
    allCrashFree: boolean
  }
  if (!parsed.passed) {
    throw new Error(
      `AC-P2-10 check has not passed yet: ${JSON.stringify(
        {
          windowHours: parsed.windowHours,
          minActiveAgents: parsed.minActiveAgents,
          maxErrorAgents: parsed.maxErrorAgents,
          allCrashFree: parsed.allCrashFree,
          snapshotCount: parsed.snapshotCount,
        },
        null,
        2,
      )}`,
    )
  }
  return parsed
}

function updateAcIndex(root: string) {
  const path = resolve(root, 'docs/ops/sprint6/sprint6-ac-evidence-index.md')
  const text = readFileSync(path, 'utf-8')
  const replaced = text.replace(
    /\| AC-P2-10 \| [^|]+ \| ([^|]+) \| `@davidgao` \| `[^`]+` \| [^\n]+ \|/,
    '| AC-P2-10 | ✅ | $1 | `@davidgao` | `2026-03-26` | 48h 窗口达标：minActiveAgents>=5、maxErrorAgents=0、allCrashFree=true |',
  )
  if (replaced === text) throw new Error('failed to update AC-P2-10 row in sprint6-ac-evidence-index.md')
  writeFileSync(path, replaced, 'utf-8')
}

function appendFinalResult(root: string, check: ReturnType<typeof ensureCheckPassed>) {
  const path = resolve(root, 'docs/ops/sprint6/evidence/metrics/day8-stability-final-report.md')
  const now = new Date().toISOString()
  const block = [
    '',
    '## AC-P2-10 最终验收结果（自动收口）',
    '',
    `- 验收时间：\`${now}\``,
    `- windowHours：\`${check.windowHours}\``,
    `- snapshotCount：\`${check.snapshotCount}\``,
    `- minActiveAgents：\`${check.minActiveAgents}\``,
    `- maxErrorAgents：\`${check.maxErrorAgents}\``,
    `- allCrashFree：\`${check.allCrashFree}\``,
    '- 判定：`AC-P2-10 = ✅`',
    '',
  ].join('\n')
  writeFileSync(path, `${readFileSync(path, 'utf-8')}${block}`, 'utf-8')
}

function appendDailyReport(root: string) {
  const path = resolve(root, 'docs/ops/sprint6/daily-report.md')
  const now = new Date().toISOString()
  const block = [
    '',
    `- AC-P2-10：\`✅\`（自动收口时间：\`${now}\`；证据：\`docs/ops/sprint6/evidence/metrics/day8-stability-final-report.md\`）`,
  ].join('\n')
  writeFileSync(path, `${readFileSync(path, 'utf-8')}${block}`, 'utf-8')
}

function main() {
  const root = process.cwd()
  const checkJsonPath = resolve(root, process.env.CHECK_JSON ?? '.tmp/ac-p2-10-check.json')
  const check = ensureCheckPassed(checkJsonPath)
  updateAcIndex(root)
  appendFinalResult(root, check)
  appendDailyReport(root)
  console.log('[ac-p2-10-finalize] done')
}

main()
