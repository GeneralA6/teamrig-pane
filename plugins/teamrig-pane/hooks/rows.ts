// The pane's body as blocks of rows of styled spans: pure data from a snapshot. A block is what
// draws as one element (layout.ts): a task with its meta line under it, a header, a section heading.
// The terminal lays out and paints a pane's whole tree, its scroll only a window over it, and an inline
// pane's frame grows to fit the tree in the live area redrawn on every keystroke: the tree's size is what
// the pane costs, so a block is one Text (its unstyled spans plain strings, a task's inside the Button that
// opens its card), never a box per row, and inline the rows are capped. An open task's card (card.ts) takes
// its meta line's place as a second Text under the Button, outside it, so the card's links take their own press.
import type { ThemeKey } from 'claude-code'
import type { BarStatus, ExpandedTasks, RefFile, Snapshot, TaskRow, TaskStatus, ViewMode } from '../types'
import { cardRows } from './card'
import { COMMAND } from './command'
import { metaParts, treeOf, whenWords, type PaneTree } from './meta'
import { BAR_LOOK } from './status-bar'
import { areaView, ownerGroups, statusLines } from './view'
import { cells } from './width'

/**
 * A run of text in one style. No `color` (absent or undefined, as a span picks it by a condition) draws in the theme's
 * text color. With `href` the text is a link to that address (a card's Links row), never split across lines. With
 * `task` the text is that task's id in an open card (ids.ts), which a press on opens as a page; never split either.
 * With `file` the text names a file a card's Reference row lists (ref-file.ts), which a press on opens as a page too
 * (file-page.ts); never split. `underline` marks the words a search matched (search-rows.ts).
 */
export type Span = {
  text: string
  color?: ThemeKey | undefined
  bold?: boolean
  dim?: boolean
  underline?: boolean
  href?: string
  task?: string
  file?: RefFile
}
/**
 * One line of a block before layout: `hang` starts each line it wraps onto (none, absent or
 * undefined as `single` passes it on, starts them at the edge); a `rule` row ends in a rule.
 */
export type Row = {
  key: string
  spans: Span[]
  hang?: Span | undefined
  rule?: boolean
  /** Cut the row at this many lines, the last ending in `…`; none (or undefined) draws it whole. */
  maxLines?: number | undefined
  /** Drawn at the right edge of the row's first line, the text wrapping in the room left of it. */
  end?: Span | undefined
  /** The Changes file whose diff a press on the row opens or closes (changes-rows.ts): in a card the row is a press of its own. */
  expands?: string
}
/**
 * What draws as one element. `toggle` names the task a press on it opens or closes the card of; `card` holds
 * that card's rows (card.ts) while it is open, drawn under the block's rows and outside its press (a repo's files in
 * the Changes view are its header's card too, each a press of its own: changes-rows.ts); `opens` names
 * the task a press on it opens the page of (a search result, search-rows.ts); `reads` names the session a press on
 * it opens the Log page of (log-rows.ts); `opensSection` leads it with a blank line, past the gap every block has.
 */
export type Block = { key: string; rows: Row[]; toggle?: string; opens?: string; reads?: string; card?: Row[]; opensSection?: boolean }

export const NOTHING_EXPANDED: ExpandedTasks = {}
/** Between a task's id and its title. */
export const TITLE_GAP = '  '
/** A task's title and its meta line are cut at this many lines each; with its card open, the title shows whole. */
export const TITLE_LINES = 2
export const META_LINES = 2
/** Between the parts of a meta line. */
export const SEPARATOR: Span = { text: ' · ', dim: true }

/** By the task's status: `◑` is shipped work being verified, the other half of `◐` working. */
export const GLYPH: Readonly<Record<TaskStatus, string>> = { open: '○', 'in-progress': '◐', verifying: '◑', waiting: '■', done: '✓', dropped: '✗' }
export const GLYPH_COLOR: Partial<Record<TaskStatus, ThemeKey>> = { 'in-progress': 'warning', verifying: 'success', waiting: 'error', done: 'success' }

const NO_AREA = `No area for this session yet: /rename the tab to its session's id or name, run \`inbox read --session <id>\`, or /${COMMAND} <session> to pin one.`

/** A block of one row, its key the block's. */
export function single(key: string, spans: Span[], hang?: Span): Block {
  return { key, rows: [{ key, spans, hang }] }
}

/** The meta line's parts (meta.ts) between dim dots, each dim unless a color says it needs a look. */
function metaSpans(task: TaskRow, tree: PaneTree, viewer: string | null): Span[] {
  return metaParts(task, tree, viewer).flatMap((part, i) => {
    const span: Span = part.color === undefined ? { text: part.text, dim: true } : part
    return i === 0 ? [span] : [SEPARATOR, span]
  })
}

/** Where a task's wrapped title and its meta line start: under the title, past its status mark and id. */
export function indentOf(task: TaskRow): Span {
  return { text: ' '.repeat(cells(`${GLYPH[task.status]} ${task.id}${TITLE_GAP}`)) }
}

/** `◐ T12  title`, keyed `key`: its status mark in its color, its id bold, a wrapped line under the title; cut at `maxLines` when set. */
export function titleRow(key: string, task: TaskRow, maxLines?: number): Row {
  return {
    key,
    spans: [{ text: GLYPH[task.status], color: GLYPH_COLOR[task.status] }, { text: ` ${task.id}`, bold: true }, { text: `${TITLE_GAP}${task.title}` }],
    hang: indentOf(task),
    maxLines,
  }
}

/**
 * `◐ T12  title`, the title cut at TITLE_LINES lines, and under it one dim meta line (meta.ts) cut at META_LINES;
 * with its card open, the title shows whole and the card (card.ts) takes the meta line's place. `tree` is the
 * snapshot's (meta.ts treeOf); `viewer` is the area whose list it is (null in the all view): a task it does not
 * own says whose it is.
 */
function taskBlock(section: string, task: TaskRow, expanded: ExpandedTasks, tree: PaneTree, viewer: string | null): Block {
  const detail = expanded[task.id]
  const indent = indentOf(task)
  const key = `${section}:${task.id}`
  const title = titleRow(key, task, detail === undefined ? TITLE_LINES : undefined)
  if (detail !== undefined) return { key, toggle: task.id, rows: [title], card: cardRows(section, task, detail, tree, viewer) }
  const meta: Row = { key: `${section}-meta:${task.id}`, spans: [indent, ...metaSpans(task, tree, viewer)], hang: indent, maxLines: META_LINES }
  return { key, toggle: task.id, rows: [title, meta] }
}

/**
 * `✓ T4  title          14:02`: a task done or dropped today, dim, on one line with when it closed; with its card
 * open (card.ts), the title shows whole and the card follows. `tree` and `viewer` as taskBlock takes them.
 */
function doneBlock(task: TaskRow, expanded: ExpandedTasks, tree: PaneTree, viewer: string): Block {
  const detail = expanded[task.id]
  const key = `done:${task.id}`
  const color = GLYPH_COLOR[task.status]
  const row: Row = {
    key,
    spans: [color === undefined ? { text: GLYPH[task.status], dim: true } : { text: GLYPH[task.status], color }, { text: ` ${task.id}${TITLE_GAP}${task.title}`, dim: true }],
    hang: indentOf(task),
    end: { text: whenWords(task.statusAt, tree.context), dim: true },
    maxLines: detail === undefined ? 1 : undefined,
  }
  if (detail !== undefined) return { key, toggle: task.id, rows: [row], card: cardRows('done', task, detail, tree, viewer) }
  return { key, toggle: task.id, rows: [row] }
}

/**
 * The dim line under Done today when the cap cut `more` of its tasks: how many, how many of those were dropped,
 * and the key that lists today's done ones in full (the status bar's filter, which leaves the dropped ones out).
 */
export function doneMoreText(more: number, dropped: number): string {
  const droppedText = dropped > 0 ? ` (${dropped} dropped)` : ''
  const list = more > dropped ? `: press ${BAR_LOOK['done-today'].hotkey} to list today's done` : ''
  return `${more} more${droppedText}${list}`
}

/** `── label ───────`, ruled to the body's edge, a blank line above it: a Changes view heading. */
export function heading(key: string, label: Span[]): Block {
  return { key, opensSection: true, rows: [{ key, spans: [{ text: '── ', dim: true }, ...label], rule: true }] }
}

/** `Working on (2)`: a task section's name, bold, and how many it holds, dim, a blank line above it. */
function sectionHeading(key: string, name: Span, count: string): Block {
  return { key, opensSection: true, rows: [{ key, spans: [{ ...name, bold: true }, { text: count, dim: true }] }] }
}

/**
 * A section of tasks: its heading counting all `total`, its blocks, and a dim line naming how many the cap left out
 * and where they show (`moreText`). An empty section draws nothing.
 */
function section(key: string, name: Span, total: number, blocks: Block[], moreText = (left: number) => `${left} more`): Block[] {
  if (total === 0) return []
  const left = total - blocks.length
  const rest = left > 0 ? [single(`${key}-more`, [{ text: moreText(left), dim: true }])] : []
  return [sectionHeading(key, name, ` (${total})`), ...blocks, ...rest]
}

/** The section a status bar filter's tasks are keyed by, as the full list keys them. */
const FILTER_SECTION: Readonly<Record<BarStatus, string>> = {
  'done-today': 'done',
  verifying: 'verifying',
  working: 'working',
  waiting: 'waiting',
  'not-started': 'next',
}

/** The area's tasks at the status the bar filters to, under no heading: what the filter's line names. */
function filteredBlocks(snap: Snapshot, area: string, filter: BarStatus, expanded: ExpandedTasks): Block[] {
  const tree = treeOf(snap)
  const tasks = statusLines(snap.tasks, area, tree, filter)
  if (tasks.length === 0) return [single('none-filtered', [{ text: BAR_LOOK[filter].none, dim: true }])]
  if (filter === 'done-today') return tasks.map(task => doneBlock(task, expanded, tree, area))
  return tasks.map(task => taskBlock(FILTER_SECTION[filter], task, expanded, tree, area))
}

/**
 * The area's tasks in sections: Verifying (the ones to close first), Working on, Up next, Waiting (its waiting
 * tasks, then those it asked of others) and Done today.
 */
function mineBlocks(snap: Snapshot, expanded: ExpandedTasks, filter: BarStatus | null): Block[] {
  if (snap.area === null) return [single('no-area', [{ text: NO_AREA, dim: true }])]
  const tree = treeOf(snap)
  const view = areaView(snap.tasks, snap.area, tree)
  // The session's own area goes unnamed, as its tab names the session; a pin names the area it shows.
  const header: Span[] = snap.areaSource === 'pinned' ? [{ text: view.area, bold: true }, { text: ' (pinned) · ', dim: true }] : []
  const waiting = view.waiting.filter(task => task.owner === view.area).length
  const activeTotal = view.verifying.length + view.working.length + view.upNext.length + waiting
  header.push({ text: `${activeTotal} active`, dim: true })
  if (snap.unreadInbox !== null)
    header.push({ text: ` · inbox ${snap.unreadInbox} unread`, color: snap.unreadInbox > 0 ? 'warning' : 'subtle' })
  const blocks: Block[] = [{ key: 'header', rows: [{ key: 'header', spans: header, rule: true }] }]
  // Filtered from the status bar, the header leads that status's tasks alone.
  if (filter !== null) return [...blocks, ...filteredBlocks(snap, view.area, filter, expanded)]
  if (activeTotal === 0) blocks.push(single('none-active', [{ text: 'Nothing active.', dim: true }]))
  const tasks = (key: string, list: readonly TaskRow[]) => list.map(task => taskBlock(key, task, expanded, tree, view.area))
  const done = view.doneToday.map(task => doneBlock(task, expanded, tree, view.area))
  return [
    ...blocks,
    ...section('verifying', { text: 'Verifying', color: 'success' }, view.verifying.length, tasks('verifying', view.verifying)),
    ...section('working', { text: 'Working on' }, view.working.length, tasks('working', view.working)),
    ...section('next', { text: 'Up next' }, view.upNext.length, tasks('next', view.upNext)),
    ...section('waiting', { text: 'Waiting' }, view.waitingTotal, tasks('waiting', view.waiting), left => `${left} more asked of others: the all view lists them`),
    ...section('done', { text: 'Done today' }, view.doneTotal, done, left => doneMoreText(left, view.doneMoreDropped)),
  ]
}

/** Every owner with active tasks under a heading with its counts, the session's own area marked. */
function allBlocks(snap: Snapshot, expanded: ExpandedTasks): Block[] {
  const tree = treeOf(snap)
  const groups = ownerGroups(snap.tasks, tree)
  if (groups.length === 0) return [single('none-active', [{ text: 'No active tasks.', dim: true }])]
  return groups.flatMap((group, i) => {
    const waiting = group.waiting > 0 ? ` · ${group.waiting} waiting` : ''
    const verifying = group.verifying > 0 ? ` · ${group.verifying} verifying` : ''
    const owner: Span = { text: group.owner, color: group.owner === snap.area ? 'claude' : undefined }
    // The first group sits under the buttons, already a gap away.
    const head = { ...sectionHeading(`owner:${group.owner}`, owner, ` · ${group.active.length} active${waiting}${verifying}`), opensSection: i > 0 }
    return [head, ...group.active.map(task => taskBlock(group.owner, task, expanded, tree, null))]
  })
}

/**
 * The body under the buttons: the register's problem, if any, then the mode's view, the tasks in `expanded` with their cards open.
 * A snapshot never read (`now` 0: the pane's first moments, or a hot reload's until its first poll) says so, instead of
 * an empty list or a missing area it has not yet looked for. `filter`, the status bar's (status-bar.ts),
 * narrows the mine view to the area's tasks at that status; null shows them all.
 */
export function paneBlocks(
  snap: Snapshot,
  mode: ViewMode,
  expanded: ExpandedTasks = NOTHING_EXPANDED,
  filter: BarStatus | null = null,
): Block[] {
  const reading = readingBlock(snap)
  if (reading !== null) return [reading]
  return [...problemBlocks(snap), ...(mode === 'mine' ? mineBlocks(snap, expanded, filter) : allBlocks(snap, expanded))]
}

/**
 * `Reading the register…`, the whole of a tasks body while the snapshot was never read (`now` 0: the pane's first
 * moments, or a hot reload's until its first poll); null once it was, or when the read failed.
 */
export function readingBlock(snap: Snapshot): Block | null {
  return snap.now === 0 && snap.problem === null ? single('reading', [{ text: 'Reading the register…', dim: true }]) : null
}

/** The register's problem, when it has one, leading a tasks body: what failed to read, the last good tasks drawn under it. */
export function problemBlocks(snap: Snapshot): Block[] {
  return snap.problem === null ? [] : [single('problem', [{ text: `WARN ${snap.problem}`, color: 'warning' }], { text: '  ' })]
}
