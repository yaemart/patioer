/**
 * Programmatic alignment check: YAML alert expressions → registered Prometheus metrics.
 * Used in unit tests (Day 7 "冒烟") and optionally in CI to prevent rule drift.
 */

const METRIC_NAME_RE = /[a-zA-Z_:][a-zA-Z0-9_:]*/g

const PROMQL_KEYWORDS = new Set([
  'sum', 'rate', 'avg', 'min', 'max', 'count', 'count_values',
  'stddev', 'stdvar', 'topk', 'bottomk', 'quantile', 'histogram_quantile',
  'clamp_min', 'clamp_max', 'clamp', 'abs', 'ceil', 'floor', 'round',
  'by', 'without', 'on', 'ignoring', 'group_left', 'group_right',
  'unless', 'and', 'or', 'offset', 'bool', 'le', 'NaN', 'Inf',
  'time', 'vector', 'scalar', 'sort', 'sort_desc',
])

/** 从 YAML 规则的 `expr` 字段中提取引用到的 Prometheus metric 名（去重）。 */
export function extractMetricNamesFromYaml(yamlContent: string): string[] {
  const exprBlocks: string[] = []
  const lines = yamlContent.split('\n')
  let inExpr = false
  let currentExpr = ''

  for (const line of lines) {
    const trimmed = line.trim()
    if (/^expr:\s*\|?\s*$/.test(trimmed) || /^expr:\s+\S/.test(trimmed)) {
      if (inExpr && currentExpr) exprBlocks.push(currentExpr)
      inExpr = true
      const afterColon = trimmed.replace(/^expr:\s*\|?\s*/, '')
      currentExpr = afterColon ? afterColon + '\n' : ''
      continue
    }
    if (inExpr) {
      if (/^\S/.test(line) || /^[a-z_]+:/.test(trimmed)) {
        exprBlocks.push(currentExpr)
        inExpr = false
        currentExpr = ''
      } else {
        currentExpr += trimmed + '\n'
      }
    }
  }
  if (inExpr && currentExpr) exprBlocks.push(currentExpr)

  const all = new Set<string>()
  for (const expr of exprBlocks) {
    for (const m of expr.matchAll(METRIC_NAME_RE)) {
      const name = m[0]
      if (PROMQL_KEYWORDS.has(name)) continue
      if (/^\d/.test(name)) continue
      if (name.length < 3) continue
      all.add(name)
    }
  }
  return [...all].sort()
}

export interface AlignmentResult {
  ok: boolean
  /** Metrics referenced in YAML but absent from knownMetricNames. */
  missingMetrics: string[]
  /** Alert names in YAML but not in the TS catalog. */
  extraAlerts: string[]
}

/** 编程验证：所有 YAML 表达式引用的 metric 在 `knownMetrics` 集合中存在。 */
export function checkAlertMetricAlignment(params: {
  yamlContent: string
  knownMetricNames: string[]
  catalogAlertNames: readonly string[]
}): AlignmentResult {
  const known = new Set(params.knownMetricNames)
  const referenced = extractMetricNamesFromYaml(params.yamlContent)
  const missingMetrics = referenced.filter((m) => !known.has(m))

  const catalogSet = new Set<string>(params.catalogAlertNames)
  const alertRe = /alert:\s*(\S+)/g
  const yamlAlerts: string[] = []
  for (const m of params.yamlContent.matchAll(alertRe)) {
    yamlAlerts.push(m[1])
  }
  const extraAlerts = yamlAlerts.filter((a) => !catalogSet.has(a))

  return {
    ok: missingMetrics.length === 0 && extraAlerts.length === 0,
    missingMetrics,
    extraAlerts,
  }
}
