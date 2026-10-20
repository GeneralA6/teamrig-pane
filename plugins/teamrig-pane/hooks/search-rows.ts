// The Tasks view's search body, drawn under its Find field (register.tsx) on the shared search view (search-view.ts):
// the count of the matches, then each active match as the list draws a task, its title row and under it a dim line of
// whose it is and the other fields a word matched in, then each finished one dim on one line with when it closed; the
// words that matched underlined. Past the cap (task-search.ts MAX_RESULTS), the count says how many are shown and asks
// for another word. Each result is keyed SEARCH_VIEW and its id (search-view.ts resultKey), and a press on it opens its
// page (`opens`). Pure: blocks of rows (rows.ts) that layout.ts wraps.
import type { Snapshot } from '../types'
import { HELD_DAYS } from './done'
import { whenWords } from './meta'
import { GLYPH, GLYPH_COLOR, indentOf, META_LINES, problemBlocks, readingBlock, SEPARATOR, TITLE_GAP, TITLE_LINES } from './rows'
import type { Block, Row, Span } from './rows'
import { marksOf } from './search'
import { excerpt, markedSpans, resultKey, searchViewBlocks, type Noun } from './search-view'
import { fieldText, matchCount, type SearchedField, type SearchResults, type TaskHit } from './task-search'
import { clockOf, type Clock } from './zone'

/** The fields a result's title row does not show, in the order its meta line names them, each by its words. */
const FIELD_WORDS: ReadonlyArray<readonly [field: Exclude<SearchedField, 'title' | 'owner'>, words: string]> = [
  ['source', 'asked by'],
  ['goals', 'goals'],
  ['week', 'week'],
  ['note', 'note'],
  ['evidence', 'evidence'],
  ['ref', 'ref'],
]
/** What an empty Find field shows. */
export const SEARCH_HINT = 'Type words to find a task by its id, title, owner, who asked, goals, week, note, evidence or ref.'
/** What a query no held task matches shows. */
export const NOTHING_FOUND = `Nothing matches. The pane searches the active tasks and those finished in the last ${HELD_DAYS} days.`

/** The Tasks search's key: its results are keyed `search:<id>`, its own lines `search-count` and the like. */
export const SEARCH_VIEW = 'search'

/** A Tasks search counts tasks. */
export const TASK_NOUN: Noun = { one: 'task', many: 'tasks' }

/** The task's id, in `style`, underlined when a word named it. */
function idSpan(hit: TaskHit, style: Omit<Span, 'text'>): Span {
  return hit.isId ? { ...style, text: hit.row.id, underline: true } : { ...style, text: hit.row.id }
}

/** `on etl · note …matched words…`: whose the task is, then each field not on the title row that a word matched in. */
function matchedParts(hit: TaskHit): Span[] {
  const task = hit.row
  const parts: Span[][] = [[{ text: 'on ', dim: true }, ...markedSpans(task.owner, marksOf(hit, 'owner'), { dim: true })]]
  for (const [field, words] of FIELD_WORDS) {
    const text = fieldText(task, field)
    if (text === null || marksOf(hit, field).length === 0) continue
    const shown = excerpt(text, marksOf(hit, field))
    parts.push([{ text: `${words} `, dim: true }, ...markedSpans(shown.text, shown.marks, { dim: true })])
  }
  return parts.flatMap((part, i) => (i === 0 ? part : [SEPARATOR, ...part]))
}

/** `◐ T12  title`, its title cut at TITLE_LINES lines, and under it the dim line of matchedParts, cut at META_LINES. */
function activeBlock(hit: TaskHit): Block {
  const task = hit.row
  const indent = indentOf(task)
  const key = resultKey(SEARCH_VIEW, task.id)
  const title: Row = {
    key,
    spans: [
      { text: GLYPH[task.status], color: GLYPH_COLOR[task.status] },
      { text: ' ' },
      idSpan(hit, { bold: true }),
      { text: TITLE_GAP },
      ...markedSpans(task.title, marksOf(hit, 'title'), {}),
    ],
    hang: indent,
    maxLines: TITLE_LINES,
  }
  const meta: Row = { key: `search-meta:${task.id}`, spans: [indent, ...matchedParts(hit)], hang: indent, maxLines: META_LINES }
  return { key, opens: task.id, rows: [title, meta] }
}

/** `✓ T4  title          14:02`: a finished match, dim, on one line with when it closed. */
function doneBlock(hit: TaskHit, clock: Clock): Block {
  const task = hit.row
  const key = resultKey(SEARCH_VIEW, task.id)
  const color = GLYPH_COLOR[task.status]
  const row: Row = {
    key,
    spans: [
      color === undefined ? { text: GLYPH[task.status], dim: true } : { text: GLYPH[task.status], color },
      { text: ' ', dim: true },
      idSpan(hit, { dim: true }),
      { text: TITLE_GAP, dim: true },
      ...markedSpans(task.title, marksOf(hit, 'title'), { dim: true }),
    ],
    hang: indentOf(task),
    end: { text: whenWords(task.statusAt, clock), dim: true },
    maxLines: 1,
  }
  return { key, opens: task.id, rows: [row] }
}

/**
 * The search's body for `query` over the snapshot's tasks, `results` the tasks it matched (task-search.ts searchTasks):
 * the register's problem, if any, then the search view of the matches (the hint while the query has no word, the line
 * that says nothing matched, else the count and the results). A snapshot never read says so instead.
 */
export function searchBlocks(snap: Snapshot, query: string, results: SearchResults): Block[] {
  const reading = readingBlock(snap)
  if (reading !== null) return [reading]
  const shown = [...results.active.map(activeBlock), ...results.done.map(hit => doneBlock(hit, clockOf(snap)))]
  const view = { key: SEARCH_VIEW, query, hint: SEARCH_HINT, nothing: NOTHING_FOUND, noun: TASK_NOUN, results: shown, total: matchCount(results) }
  return [...problemBlocks(snap), ...searchViewBlocks(view)]
}
