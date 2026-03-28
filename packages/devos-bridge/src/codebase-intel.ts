/**
 * Codebase Intel — 代码定位查询引擎 (D-12)
 *
 * 扫描 monorepo 文件结构，建立 Agent / 模块 / 路由索引，
 * 回答"X 在哪个文件？"类定位问题。
 *
 * Phase 4 Sprint 7: 静态索引 + 精确匹配 + 模糊匹配
 * Phase 4 Sprint 8+: 集成到 Paperclip Agent runtime，支持 LLM 增强语义查询
 */
import { readdirSync, statSync } from 'node:fs'
import { join, relative, basename, extname } from 'node:path'

export interface CodebaseEntry {
  path: string
  name: string
  kind: 'agent' | 'harness' | 'route' | 'service' | 'migration' | 'config' | 'test' | 'other'
  aliases: string[]
}

export interface CodebaseIndex {
  entries: CodebaseEntry[]
  scannedAt: string
  rootDir: string
}

export interface QueryResult {
  query: string
  matches: Array<{
    entry: CodebaseEntry
    score: number
    matchedAlias: string
  }>
}

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'coverage', '.turbo', '.next', '.cache',
])

const KIND_PATTERNS: Array<[RegExp, CodebaseEntry['kind']]> = [
  [/\.agent\.ts$/, 'agent'],
  [/\.harness\.ts$/, 'harness'],
  [/routes?[/\\]/, 'route'],
  [/service[s]?\.ts$/, 'service'],
  [/migrations?[/\\]/, 'migration'],
  [/\.seed\.(ts|json)$/, 'config'],
  [/\.test\.ts$/, 'test'],
]

function classifyFile(relPath: string): CodebaseEntry['kind'] {
  for (const [pattern, kind] of KIND_PATTERNS) {
    if (pattern.test(relPath)) return kind
  }
  return 'other'
}

function buildAliases(relPath: string, name: string): string[] {
  const aliases: string[] = [name]

  const base = basename(relPath, extname(relPath))
  if (base !== name) aliases.push(base)

  const withoutExt2 = base.replace(/\.(agent|harness|test|seed)$/, '')
  if (withoutExt2 !== base) aliases.push(withoutExt2)

  const humanReadable = withoutExt2
    .replace(/[-_.]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
  aliases.push(humanReadable)

  const lowerReadable = humanReadable.toLowerCase()
  if (lowerReadable !== humanReadable) aliases.push(lowerReadable)

  return [...new Set(aliases)]
}

function walkDir(dir: string, rootDir: string, entries: CodebaseEntry[]): void {
  let items: string[]
  try {
    items = readdirSync(dir)
  } catch {
    return
  }
  for (const item of items) {
    if (IGNORED_DIRS.has(item) || item.startsWith('.')) continue
    const full = join(dir, item)
    let stat
    try {
      stat = statSync(full)
    } catch {
      continue
    }
    if (stat.isDirectory()) {
      walkDir(full, rootDir, entries)
    } else if (item.endsWith('.ts') || item.endsWith('.json') || item.endsWith('.sql')) {
      const relPath = relative(rootDir, full)
      const kind = classifyFile(relPath)
      const name = basename(item)
      entries.push({
        path: relPath,
        name,
        kind,
        aliases: buildAliases(relPath, name),
      })
    }
  }
}

export function buildCodebaseIndex(rootDir: string): CodebaseIndex {
  const entries: CodebaseEntry[] = []
  for (const subdir of ['packages', 'apps', 'scripts', 'harness-config']) {
    const full = join(rootDir, subdir)
    try {
      statSync(full)
      walkDir(full, rootDir, entries)
    } catch {
      // subdir doesn't exist
    }
  }
  return {
    entries,
    scannedAt: new Date().toISOString(),
    rootDir,
  }
}

function normalizeQuery(q: string): string {
  return q
    .toLowerCase()
    .replace(/[？?。，,！!：:]/g, ' ')
    .replace(/在哪个文件|在哪个目录|在哪里|位于|定义在|是什么文件|file|where|located/gi, '')
    .trim()
}

function scoreSimilarity(needle: string, candidate: string): number {
  const n = needle.toLowerCase()
  const c = candidate.toLowerCase()
  if (c === n) return 1.0
  if (c.includes(n)) return 0.9
  if (n.includes(c)) return 0.8

  const nWords = n.split(/[\s\-_.]/).filter(Boolean)
  const cWords = c.split(/[\s\-_.]/).filter(Boolean)
  let matched = 0
  for (const nw of nWords) {
    if (cWords.some((cw) => cw.includes(nw) || nw.includes(cw))) matched++
  }
  if (nWords.length > 0) {
    const wordScore = matched / nWords.length
    if (wordScore > 0) return 0.5 + wordScore * 0.3
  }

  return 0
}

export function queryCodebase(index: CodebaseIndex, rawQuery: string): QueryResult {
  const query = normalizeQuery(rawQuery)
  const matches: QueryResult['matches'] = []

  for (const entry of index.entries) {
    let bestScore = 0
    let bestAlias = ''

    for (const alias of entry.aliases) {
      const score = scoreSimilarity(query, alias)
      if (score > bestScore) {
        bestScore = score
        bestAlias = alias
      }
    }

    const pathScore = scoreSimilarity(query, entry.path)
    if (pathScore > bestScore) {
      bestScore = pathScore
      bestAlias = entry.path
    }

    if (bestScore > 0.3) {
      matches.push({ entry, score: bestScore, matchedAlias: bestAlias })
    }
  }

  matches.sort((a, b) => b.score - a.score)

  return { query: rawQuery, matches: matches.slice(0, 10) }
}
