// The search's body, drawn under its Find field (register.tsx): each active match as the list draws a task, its
// title row and under it a dim line of whose it is and the other fields a word matched in, then each finished one
// dim on one line with when it closed; the words that matched underlined. Past the cap (search.ts MAX_RESULTS), a dim
// line asks for another word; when nothing matches, one dim line says so. A press on a result opens its page
// (`opens`). Pure: blocks of rows (rows.ts) that layout.ts wraps.
import type { Snapshot } from '../types'
import { HELD_DAYS } from './done'
import { treeOf, whenWords } from './meta'
import { GLYPH, GLYPH_COLOR, indentOf, META_LINES, problemBlocks, readingBlock, SEPARATOR, single, TITLE_GAP, TITLE_LINES } from './rows'
import type { Block, Row, Span } from './rows'
import { fieldText, queryWords, searchTasks, type Hit, type Mark, type SearchedField } from './search'

/** The fields a result's title row does not show, in the order its meta line names them, each by its words. */
const FIELD_WORDS: ReadonlyArray<readonly [field: Exclude<SearchedField, 'title' | 'owner'>, words: string]> = [
  ['source', 'asked by'],
  ['goals', 'goals'],
  ['week', 'week'],
  ['note', 'note'],
  ['evidence', 'evidence'],
  ['ref', 'ref'],
]
/** A matched field's text starts at most this many characters before its first match, cut there with `…`. */
export const EXCERPT_LEAD = 20
const ELLIPSIS = '…'

/** What an empty Find field shows. */
export const SEARCH_HINT = 'Type words to find a task by its id, title, owner, who asked, goals, week, note, evidence or ref.'
/** What a query no held task matches shows. */
export const NOTHING_FOUND = `Nothing matches. The pane searches the active tasks and those finished in the last ${HELD_DAYS} days.`

/** `text` as spans in `style`, the `marks` runs underlined. */
export function markedSpans(text: string, marks: readonly Mark[], style: Omit<Span, 'text'>): Span[] {
  const spans: Span[] = []
  let at = 0
  for (const mark of marks) {
    spans.push({ ...style, text: text.slice(at, mark.start) }, { ...style, text: text.slice(mark.start, mark.end), underline: true })
    at = mark.end
  }
  spans.push({ ...style, text: text.slice(at) })
  return spans.filter(span => span.text !== '')
}

/** A field's text from EXCERPT_LEAD characters before its first match, `…` where it was cut, its marks moved with it. */
export function excerpt(text: string, marks: readonly Mark[]): { text: string; marks: Mark[] } {
  const first = marks[0]
  if (first === undefined || first.start <= EXCERPT_LEAD) return { text, marks: [...marks] }
  const cut = first.start - EXCERPT_LEAD
  const shift = ELLIPSIS.length - cut
  return { text: `${ELLIPSIS}${text.slice(cut)}`, marks: marks.map(mark => ({ start: mark.start + shift, end: mark.end + shift })) }
}

/** The task's id, in `style`, underlined when a word named it. */
function idSpan(hit: Hit, style: Omit<Span, 'text'>): Span {
  return hit.isId ? { ...style, text: hit.task.id, underline: true } : { ...style, text: hit.task.id }
}

/** `on etl · note …matched words…`: whose the task is, then each field not on the title row that a word matched in. */
function matchedParts(hit: Hit): Span[] {
  const { task, marks } = hit
  const parts: Span[][] = [[{ text: 'on ', dim: true }, ...markedSpans(task.owner, marks.owner, { dim: true })]]
  for (const [field, words] of FIELD_WORDS) {
    const text = fieldText(task, field)
    if (text === null || marks[field].length === 0) continue
    const shown = excerpt(text, marks[field])
    parts.push([{ text: `${words} `, dim: true }, ...markedSpans(shown.text, shown.marks, { dim: true })])
  }
  return parts.flatMap((part, i) => (i === 0 ? part : [SEPARATOR, ...part]))
}

/** `◐ T12  title`, its title cut at TITLE_LINES lines, and under it the dim line of matchedParts, cut at META_LINES. */
function activeBlock(hit: Hit): Block {
  const task = hit.task
  const indent = indentOf(task)
  const key = `search:${task.id}`
  const title: Row = {
    key,
    spans: [
      { text: GLYPH[task.status], color: GLYPH_COLOR[task.status] },
      { text: ' ' },
      idSpan(hit, { bold: true }),
      { text: TITLE_GAP },
      ...markedSpans(task.title, hit.marks.title, {}),
    ],
    hang: indent,
    maxLines: TITLE_LINES,
  }
  const meta: Row = { key: `search-meta:${task.id}`, spans: [indent, ...matchedParts(hit)], hang: indent, maxLines: META_LINES }
  return { key, opens: task.id, rows: [title, meta] }
}

/** `✓ T4  title          14:02`: a finished match, dim, on one line with when it closed. */
function doneBlock(hit: Hit, now: number): Block {
  const task = hit.task
  const key = `search:${task.id}`
  const color = GLYPH_COLOR[task.status]
  const row: Row = {
    key,
    spans: [
      color === undefined ? { text: GLYPH[task.status], dim: true } : { text: GLYPH[task.status], color },
      { text: ' ', dim: true },
      idSpan(hit, { dim: true }),
      { text: TITLE_GAP, dim: true },
      ...markedSpans(task.title, hit.marks.title, { dim: true }),
    ],
    hang: indentOf(task),
    end: { text: whenWords(task.statusAt, now), dim: true },
    maxLines: 1,
  }
  return { key, opens: task.id, rows: [row] }
}

/**
 * The search's body for `query` over the snapshot's tasks: the register's problem, if any, then the matches, or the
 * hint while the query has no word, or the line that says nothing matched. A snapshot never read says so instead.
 */
export function searchBlocks(snap: Snapshot, query: string): Block[] {
  const reading = readingBlock(snap)
  if (reading !== null) return [reading]
  const problems = problemBlocks(snap)
  if (queryWords(query).length === 0) return [...problems, single('search-hint', [{ text: SEARCH_HINT, dim: true }])]
  const results = searchTasks(snap.tasks, query, treeOf(snap))
  if (results.active.length + results.done.length === 0) return [...problems, single('search-none', [{ text: NOTHING_FOUND, dim: true }])]
  const more = results.more > 0 ? [single('search-more', [{ text: `${results.more} more: add a word`, dim: true }])] : []
  return [...problems, ...results.active.map(activeBlock), ...results.done.map(hit => doneBlock(hit, snap.now)), ...more]
}
