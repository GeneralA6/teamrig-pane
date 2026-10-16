// The pane's search: the tasks it holds (the snapshot's: every area's active tasks and those finished today) that a
// query names. Each word of the query must match, case aside, a task's id whole (`T52`, or its number `52`) or the
// start of a word in one of its fields: its title, owner, who asked (`source`), goals, week, note, evidence or ref.
// A word that starts with a mark (`.md`, `/docs`) matches anywhere in a field. The active matches come in teamrig's
// plan order, as the list orders them, then the finished ones, newest first; at most MAX_RESULTS are kept, with how
// many more matched, and each keeps where its words matched so the drawing (search-rows.ts) underlines them. One
// pass over the held tasks a query. Older weeks' finished tasks are not held, so not searched. Pure.
import type { TaskRow } from '../types'
import { byPlanOrder } from './core/read/index'
import { isActive, newestFirst } from './view'

/** Most results kept for a query; how many more matched is counted. */
export const MAX_RESULTS = 30

/** The fields a word can match the start of a word in, beside the id. */
export const SEARCHED = ['title', 'owner', 'source', 'goals', 'week', 'note', 'evidence', 'ref'] as const
export type SearchedField = (typeof SEARCHED)[number]

/** Where a word matched in a field's text (fieldText): from `start` up to `end`, as string indexes. */
export type Mark = { start: number; end: number }
/** A task the query names: whether a word named its id, and where words matched in each field, in order, none overlapping. */
export type Hit = { task: TaskRow; isId: boolean; marks: Readonly<Record<SearchedField, readonly Mark[]>> }
/** The active matches in plan order, then the finished ones newest first, MAX_RESULTS at most, and how many more matched. */
export type SearchResults = { active: Hit[]; done: Hit[]; more: number }

export const NO_RESULTS: SearchResults = { active: [], done: [], more: 0 }

/** A letter or a digit: a word starts where one follows anything else. */
const WORD_CHAR = /[\p{L}\p{N}]/u

/** The query's words, lowercased; none for a blank query. */
export function queryWords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(word => word !== '')
}

/** A field's text as it is searched and drawn: the goals joined by `, `; null when the task has none. */
export function fieldText(task: TaskRow, field: SearchedField): string | null {
  return field === 'goals' ? (task.goals.length === 0 ? null : task.goals.join(', ')) : task[field]
}

/** `word` names the task id `id`: the id whole, or its number alone (`52` for `T52`). */
function namesId(id: string, word: string): boolean {
  const lower = id.toLowerCase()
  return lower === word || lower.replace(/^\D+/, '') === word
}

/** A word as a pattern that finds it case aside, its marks taken literally. */
function patternOf(word: string): RegExp {
  return new RegExp(word.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'), 'giu')
}

/** Where `pattern` (of `word`) matches in `text`: at the start of a word, or anywhere for a word that starts with a mark. */
function marksIn(text: string, word: string, pattern: RegExp): Mark[] {
  const anywhere = !WORD_CHAR.test(word.charAt(0))
  return Array.from(text.matchAll(pattern), match => ({ start: match.index, end: match.index + match[0].length })).filter(
    mark => anywhere || mark.start === 0 || !WORD_CHAR.test(text.charAt(mark.start - 1)),
  )
}

/** Marks in order, those that overlap or touch joined into one. */
function joined(marks: readonly Mark[]): Mark[] {
  const out: Mark[] = []
  for (const mark of [...marks].sort((a, b) => a.start - b.start || a.end - b.end)) {
    const last = out[out.length - 1]
    if (last !== undefined && mark.start <= last.end) out[out.length - 1] = { start: last.start, end: Math.max(last.end, mark.end) }
    else out.push(mark)
  }
  return out
}

/** A query word and the pattern that finds it. */
type Term = { word: string; pattern: RegExp }

/** No marks in any field, each list its own to fill. */
function noMarks(): Record<SearchedField, Mark[]> {
  return { title: [], owner: [], source: [], goals: [], week: [], note: [], evidence: [], ref: [] }
}

/** The task as a hit when every term matches its id or one of its fields; null when one does not. */
function hitOf(task: TaskRow, terms: readonly Term[]): Hit | null {
  const marks = noMarks()
  let isId = false
  for (const { word, pattern } of terms) {
    let isMatched = namesId(task.id, word)
    isId ||= isMatched
    for (const field of SEARCHED) {
      const text = fieldText(task, field)
      const found = text === null ? [] : marksIn(text, word, pattern)
      marks[field].push(...found)
      isMatched ||= found.length > 0
    }
    if (!isMatched) return null
  }
  for (const field of SEARCHED) marks[field] = joined(marks[field])
  return { task, isId, marks }
}

/**
 * The held tasks `query` names, in one pass over them: the active ones in plan order, then the finished ones newest
 * first, MAX_RESULTS in all at most, the active first, and how many more matched. A blank query names none.
 */
export function searchTasks(tasks: readonly TaskRow[], query: string): SearchResults {
  const words = queryWords(query)
  if (words.length === 0) return NO_RESULTS
  const terms = words.map((word): Term => ({ word, pattern: patternOf(word) }))
  const active: Hit[] = []
  const done: Hit[] = []
  for (const task of tasks) {
    const hit = hitOf(task, terms)
    if (hit !== null) (isActive(task) ? active : done).push(hit)
  }
  active.sort((a, b) => byPlanOrder(a.task, b.task))
  done.sort((a, b) => newestFirst(a.task, b.task))
  const keptActive = active.slice(0, MAX_RESULTS)
  const keptDone = done.slice(0, MAX_RESULTS - keptActive.length)
  return { active: keptActive, done: keptDone, more: active.length + done.length - keptActive.length - keptDone.length }
}

/** The result Enter opens: the first active match, else the newest finished one; null when none matched. */
export function topResult(results: SearchResults): TaskRow | null {
  return (results.active[0] ?? results.done[0])?.task ?? null
}
