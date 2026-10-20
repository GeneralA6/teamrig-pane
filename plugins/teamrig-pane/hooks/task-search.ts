// The Tasks view's search: the tasks the pane holds (the snapshot's: every area's active tasks and those finished in
// the last HELD_DAYS, done.ts) that a query names, on the shared search (search.ts). A word matches a task's id or the
// start of a word in its title, description, owner, who asked (`source`), goals, week, note, proof, evidence or ref.
// The active matches come in teamrig's plan order, as the list orders them, then the finished ones, newest first; at
// most MAX_RESULTS are kept, with how many more matched. Older weeks' finished tasks are not held, so not searched. Pure.
import type { TaskRow } from '../types'
import type { TaskTree } from './core/read/index'
import { matchRows, type Hit, type SearchSpec } from './search'
import { isActive, newestFirst } from './view'

/** Most results kept for a query; how many more matched is counted. */
export const MAX_RESULTS = 30

/** The fields a word can match the start of a word in, beside the id. */
export const SEARCHED = ['title', 'description', 'owner', 'source', 'goals', 'week', 'note', 'proof', 'evidence', 'ref'] as const
export type SearchedField = (typeof SEARCHED)[number]

/** A field's text as it is searched and drawn: the goals joined by `, `; null when the task has none. */
export function fieldText(task: TaskRow, field: SearchedField): string | null {
  return field === 'goals' ? (task.goals.length === 0 ? null : task.goals.join(', ')) : task[field]
}

/** A task is searched by its id and the SEARCHED fields. */
export const TASK_SEARCH: SearchSpec<TaskRow, SearchedField> = {
  fields: SEARCHED.map(name => ({ name, text: (task: TaskRow) => fieldText(task, name) })),
  id: task => task.id,
}

/** A task the query names, with where its words matched. */
export type TaskHit = Hit<TaskRow, SearchedField>
/** The active matches in plan order, then the finished ones newest first, MAX_RESULTS at most, and how many more matched. */
export type SearchResults = { active: TaskHit[]; done: TaskHit[]; more: number }

export const NO_RESULTS: SearchResults = { active: [], done: [], more: 0 }

/**
 * The held tasks `query` names: the active ones in plan order on the effective dues of `tree` (the tree read over
 * `tasks`, meta.ts treeOf), then the finished ones newest first, MAX_RESULTS in all at most, the active first, and how
 * many more matched. A blank query names none.
 */
export function searchTasks(tasks: readonly TaskRow[], query: string, tree: TaskTree<TaskRow>): SearchResults {
  const hits = matchRows(tasks, query, TASK_SEARCH)
  if (hits.length === 0) return NO_RESULTS
  const active = hits.filter(hit => isActive(hit.row)).sort((a, b) => tree.byPlanOrder(a.row, b.row))
  const done = hits.filter(hit => !isActive(hit.row)).sort((a, b) => newestFirst(a.row, b.row))
  const keptActive = active.slice(0, MAX_RESULTS)
  const keptDone = done.slice(0, MAX_RESULTS - keptActive.length)
  return { active: keptActive, done: keptDone, more: hits.length - keptActive.length - keptDone.length }
}

/** How many tasks matched, those past MAX_RESULTS too. */
export function matchCount(results: SearchResults): number {
  return results.active.length + results.done.length + results.more
}

/** The first result drawn, the first active match, else the newest finished one, which Enter opens or moves to; null when none matched. */
export function topResult(results: SearchResults): TaskRow | null {
  return (results.active[0] ?? results.done[0])?.row ?? null
}
