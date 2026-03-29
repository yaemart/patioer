import { describe, expect, it } from 'vitest'
import {
  topologicalSort,
  parallelWaves,
  readyTasks,
  isGraphComplete,
  isGraphSuccessful,
  TaskGraphCycleError,
  type TaskGraph,
  type Task,
} from './task-graph.js'

function makeTask(id: string, dependsOn: string[] = [], status: Task['status'] = 'pending'): Task {
  return { id, title: id, kind: 'backend', dependsOn, status }
}

function makeGraph(tasks: Task[]): TaskGraph {
  return { ticketId: 'test-ticket', tasks, createdAt: new Date().toISOString() }
}

describe('topologicalSort', () => {
  it('returns single task unchanged', () => {
    const g = makeGraph([makeTask('a')])
    const sorted = topologicalSort(g)
    expect(sorted).toHaveLength(1)
    expect(sorted[0]!.id).toBe('a')
  })

  it('respects dependency order — b depends on a → [a, b]', () => {
    const g = makeGraph([makeTask('b', ['a']), makeTask('a')])
    const sorted = topologicalSort(g)
    const ids = sorted.map((t) => t.id)
    expect(ids.indexOf('a')).toBeLessThan(ids.indexOf('b'))
  })

  it('handles diamond dependency — d depends on b and c, both depend on a', () => {
    const g = makeGraph([
      makeTask('a'),
      makeTask('b', ['a']),
      makeTask('c', ['a']),
      makeTask('d', ['b', 'c']),
    ])
    const sorted = topologicalSort(g)
    const idx = (id: string) => sorted.findIndex((t) => t.id === id)
    expect(idx('a')).toBeLessThan(idx('b'))
    expect(idx('a')).toBeLessThan(idx('c'))
    expect(idx('b')).toBeLessThan(idx('d'))
    expect(idx('c')).toBeLessThan(idx('d'))
  })

  it('throws TaskGraphCycleError on simple cycle a→b→a', () => {
    const g = makeGraph([makeTask('a', ['b']), makeTask('b', ['a'])])
    expect(() => topologicalSort(g)).toThrow(TaskGraphCycleError)
  })

  it('throws TaskGraphCycleError on self-dependency', () => {
    const g = makeGraph([makeTask('a', ['a'])])
    expect(() => topologicalSort(g)).toThrow(TaskGraphCycleError)
  })

  it('throws Error on unknown dependency ID', () => {
    const g = makeGraph([makeTask('a', ['nonexistent'])])
    expect(() => topologicalSort(g)).toThrow('unknown task')
  })

  it('handles independent tasks (no dependencies)', () => {
    const g = makeGraph([makeTask('x'), makeTask('y'), makeTask('z')])
    const sorted = topologicalSort(g)
    expect(sorted).toHaveLength(3)
    const ids = new Set(sorted.map((t) => t.id))
    expect(ids.has('x')).toBe(true)
    expect(ids.has('y')).toBe(true)
    expect(ids.has('z')).toBe(true)
  })
})

describe('parallelWaves', () => {
  it('single task → one wave', () => {
    const g = makeGraph([makeTask('a')])
    expect(parallelWaves(g)).toHaveLength(1)
    expect(parallelWaves(g)[0]!.map((t) => t.id)).toEqual(['a'])
  })

  it('chain a→b→c → three waves', () => {
    const g = makeGraph([makeTask('a'), makeTask('b', ['a']), makeTask('c', ['b'])])
    const waves = parallelWaves(g)
    expect(waves).toHaveLength(3)
    expect(waves[0]!.map((t) => t.id)).toEqual(['a'])
    expect(waves[1]!.map((t) => t.id)).toEqual(['b'])
    expect(waves[2]!.map((t) => t.id)).toEqual(['c'])
  })

  it('parallel tasks → one wave', () => {
    const g = makeGraph([makeTask('x'), makeTask('y'), makeTask('z')])
    const waves = parallelWaves(g)
    expect(waves).toHaveLength(1)
    expect(waves[0]).toHaveLength(3)
  })

  it('diamond → three waves: [a], [b,c], [d]', () => {
    const g = makeGraph([
      makeTask('a'),
      makeTask('b', ['a']),
      makeTask('c', ['a']),
      makeTask('d', ['b', 'c']),
    ])
    const waves = parallelWaves(g)
    expect(waves).toHaveLength(3)
    expect(waves[0]!.map((t) => t.id)).toEqual(['a'])
    expect(waves[1]!.map((t) => t.id).sort()).toEqual(['b', 'c'])
    expect(waves[2]!.map((t) => t.id)).toEqual(['d'])
  })
})

describe('readyTasks', () => {
  it('returns task with no dependencies when pending', () => {
    const g = makeGraph([makeTask('a')])
    expect(readyTasks(g).map((t) => t.id)).toContain('a')
  })

  it('returns dependent only when dependency is done', () => {
    const g = makeGraph([makeTask('a', [], 'done'), makeTask('b', ['a'])])
    const ready = readyTasks(g)
    expect(ready.map((t) => t.id)).toContain('b')
  })

  it('does not return dependent when dependency is still pending', () => {
    const g = makeGraph([makeTask('a'), makeTask('b', ['a'])])
    const ready = readyTasks(g)
    expect(ready.map((t) => t.id)).not.toContain('b')
  })
})

describe('isGraphComplete / isGraphSuccessful', () => {
  it('not complete when any task is pending', () => {
    const g = makeGraph([makeTask('a', [], 'done'), makeTask('b')])
    expect(isGraphComplete(g)).toBe(false)
  })

  it('complete when all tasks are in terminal states', () => {
    const g = makeGraph([makeTask('a', [], 'done'), makeTask('b', [], 'failed')])
    expect(isGraphComplete(g)).toBe(true)
  })

  it('successful only when all done', () => {
    const g = makeGraph([makeTask('a', [], 'done'), makeTask('b', [], 'done')])
    expect(isGraphSuccessful(g)).toBe(true)
  })

  it('not successful when any failed', () => {
    const g = makeGraph([makeTask('a', [], 'done'), makeTask('b', [], 'failed')])
    expect(isGraphSuccessful(g)).toBe(false)
  })
})
