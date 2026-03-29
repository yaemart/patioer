/**
 * TaskGraph — DevOS Autonomous Loop 任务图（Phase 4 §S8 任务 8.1）
 *
 * 将工程任务分解为 DAG（有向无环图），支持拓扑排序和并行调度。
 * Loop Stage 04 (Task Decomposition) 由 PM Agent 生成 TaskGraph，
 * Stage 05 (Agent Execute) 按拓扑序并行执行。
 *
 * ADR-0004 D19：TaskGraph 自行实现，不引入外部依赖。
 */

export type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export type TaskKind =
  | 'backend'
  | 'frontend'
  | 'db_migration'
  | 'test'
  | 'security_scan'
  | 'deploy'
  | 'monitor'
  | 'review'

export interface Task {
  id: string
  title: string
  kind: TaskKind
  /** IDs of tasks that must complete before this one can start. */
  dependsOn: string[]
  assignedAgent?: string
  status: TaskStatus
  startedAt?: string
  completedAt?: string
  error?: string
}

export interface TaskGraph {
  ticketId: string
  tasks: Task[]
  createdAt: string
}

export class TaskGraphCycleError extends Error {
  constructor(public readonly cycle: string[]) {
    super(`TaskGraph cycle detected: ${cycle.join(' → ')}`)
    this.name = 'TaskGraphCycleError'
  }
}

/**
 * Kahn's algorithm: returns tasks in topological order (dependencies first).
 * Throws TaskGraphCycleError if the graph contains a cycle.
 */
export function topologicalSort(graph: TaskGraph): Task[] {
  const idToTask = new Map<string, Task>(graph.tasks.map((t) => [t.id, t]))

  // Validate all dependsOn IDs exist
  for (const task of graph.tasks) {
    for (const dep of task.dependsOn) {
      if (!idToTask.has(dep)) {
        throw new Error(`Task "${task.id}" depends on unknown task "${dep}"`)
      }
    }
  }

  // Build in-degree and adjacency list
  const inDegree = new Map<string, number>()
  const dependents = new Map<string, string[]>() // dep → tasks that depend on it

  for (const task of graph.tasks) {
    if (!inDegree.has(task.id)) inDegree.set(task.id, 0)
    if (!dependents.has(task.id)) dependents.set(task.id, [])
    for (const dep of task.dependsOn) {
      inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1)
      const list = dependents.get(dep) ?? []
      list.push(task.id)
      dependents.set(dep, list)
    }
  }

  const queue: string[] = []
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id)
  }

  const sorted: Task[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    sorted.push(idToTask.get(id)!)
    for (const dependent of dependents.get(id) ?? []) {
      const newDeg = (inDegree.get(dependent) ?? 0) - 1
      inDegree.set(dependent, newDeg)
      if (newDeg === 0) queue.push(dependent)
    }
  }

  if (sorted.length !== graph.tasks.length) {
    // Find the cycle for a useful error message
    const remaining = graph.tasks
      .map((t) => t.id)
      .filter((id) => !sorted.some((s) => s.id === id))
    throw new TaskGraphCycleError(remaining)
  }

  return sorted
}

/**
 * Groups tasks into parallel execution waves based on topological order.
 * All tasks within a wave have no interdependencies and can run concurrently.
 */
export function parallelWaves(graph: TaskGraph): Task[][] {
  const sorted = topologicalSort(graph)
  const completedIds = new Set<string>()
  const waves: Task[][] = []

  while (completedIds.size < sorted.length) {
    const wave = sorted.filter(
      (t) =>
        !completedIds.has(t.id) &&
        t.dependsOn.every((dep) => completedIds.has(dep)),
    )
    if (wave.length === 0) break
    waves.push(wave)
    for (const t of wave) completedIds.add(t.id)
  }

  return waves
}

/** Returns tasks that are ready to run (all dependencies done, status pending). */
export function readyTasks(graph: TaskGraph): Task[] {
  const doneIds = new Set(
    graph.tasks.filter((t) => t.status === 'done').map((t) => t.id),
  )
  return graph.tasks.filter(
    (t) => t.status === 'pending' && t.dependsOn.every((dep) => doneIds.has(dep)),
  )
}

/** Returns true when all tasks are in a terminal state (done/failed/skipped). */
export function isGraphComplete(graph: TaskGraph): boolean {
  return graph.tasks.every(
    (t) => t.status === 'done' || t.status === 'failed' || t.status === 'skipped',
  )
}

/** Returns true when the graph succeeded (all tasks done, none failed). */
export function isGraphSuccessful(graph: TaskGraph): boolean {
  return graph.tasks.every((t) => t.status === 'done')
}
