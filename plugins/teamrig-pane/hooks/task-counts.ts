// Each session's tasks as the Teams card counts them (T1245): those it finished, those shipped and waiting on their
// proof, and every one it owns but the dropped, which it never did. Counted over the register the pane folded, so on a
// rotated register they miss the tasks a compaction retired (finished long ago, kept in the archive segments only, core
// register/layout.ts), and say so. Pure.
import type { SessionTaskCounts, TaskCounts } from '../types'
import type { Task } from './core/read/index'

/** The counts of a register with no task. */
export const NO_TASK_COUNTS: TaskCounts = { bySession: {}, archived: false }

/** Each owner's counts over `tasks`, an owner of none (or of dropped ones only) absent; `archived` as given. */
export function taskCountsOf(tasks: Iterable<Task>, archived: boolean): TaskCounts {
  const bySession: Record<string, SessionTaskCounts> = {}
  for (const { owner, status } of tasks) {
    if (status === 'dropped') continue
    const was = bySession[owner] ?? { done: 0, verifying: 0, total: 0 }
    bySession[owner] = {
      done: was.done + (status === 'done' ? 1 : 0),
      verifying: was.verifying + (status === 'verifying' ? 1 : 0),
      total: was.total + 1,
    }
  }
  return { bySession, archived }
}
