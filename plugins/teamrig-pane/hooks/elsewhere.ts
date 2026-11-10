// The tasks of the team tree's other registers that the pane's own tasks are judged by (T2190): an own task planned
// after, or waiting on, a task another team holds stays back until that task is done, and one an active task of
// another team needs is not parked, as `teamrig list` reads them (core register/tree.ts TasksElsewhere). The tree's
// registers are read in the worker (tree-registers.ts); only the few tasks the snapshot's tasks touch cross
// `$.state`, so a big peer register costs the drawing nothing.
import type { TaskElsewhere, TaskRow } from '../types'
import { ACTIVE_STATUSES, needsOf, taskNumber } from './core/read/index'

/** The tasks the tree's other registers hold, by id: what a register's read asks for an id it lacks. */
export type TasksElsewhere = ReadonlyMap<string, TaskElsewhere>

/**
 * Where a poll reads the tree's other registers: `refresh` re-reads what moved and says whether `current` or
 * `problem` did; `problem` names each register it could not read, whose last good read stays in `current`.
 */
export type ElsewhereSource = {
  refresh(): Promise<boolean>
  readonly current: TasksElsewhere
  readonly problem: string | null
}

/** A register in no team tree, or one whose team the pane did not find: it reads nothing elsewhere and never moves. */
export const NO_ELSEWHERE: ElsewhereSource = { refresh: async () => false, current: new Map(), problem: null }

/**
 * The tasks of `elsewhere` the snapshot's `tasks` are judged by, in task order: each one a snapshot task needs (its
 * `after` and the tasks it waits on, whatever their status, as a need's status is what is asked), and each active one
 * that needs a snapshot task (what keeps that task from being parked). Exact for every question teamrig's TaskTree
 * asks of its elsewhere about the snapshot's tasks: a need's status, a move held by another team's task, and whether
 * an active task of the tree needs one. An id the own register holds is left out, finished long ago or not, as the
 * read's own task wins an id: `own` is the whole register, where the snapshot keeps only the recent finished tasks.
 */
export function neededElsewhere(tasks: readonly TaskRow[], own: Pick<ReadonlyMap<string, unknown>, 'has'>, elsewhere: TasksElsewhere): TaskElsewhere[] {
  const ids = new Set(tasks.map(task => task.id))
  const needed = new Set(tasks.flatMap(task => needsOf(task)))
  const needsOne = ({ task }: TaskElsewhere) => ACTIVE_STATUSES.includes(task.status) && needsOf(task).some(id => ids.has(id))
  return [...elsewhere.values()]
    .filter(away => !own.has(away.task.id) && (needed.has(away.task.id) || needsOne(away)))
    .sort((a, b) => taskNumber(a.task.id) - taskNumber(b.task.id))
}
