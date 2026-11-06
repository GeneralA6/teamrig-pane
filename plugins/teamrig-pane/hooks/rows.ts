// The pane's body as blocks of rows of styled spans: pure data from a snapshot. A block is what
// draws as one element (layout.ts): a task with its meta line under it, a header, a section heading.
// The terminal lays out and paints a pane's whole tree, its scroll only a window over it, and an inline
// pane's frame grows to fit the tree in the live area redrawn on every keystroke: the tree's size is what
// the pane costs, so a block is one Text (its unstyled spans plain strings, a task's inside the Button that
// opens its card), never a box per row, and inline the rows are capped. An open task's card (card.ts) takes
// its meta line's place as a second Text under the Button, outside it, so the card's links take their own press.
import type { ThemeKey } from 'claude-code'
import type { BarStatus, ExpandedTasks, LogRead, OwnerActPress, RefFile, Snapshot, StatsChoice, StatsListKind, TaskRow, TaskStatus, ViewMode } from '../types'
import { actRows, type CardActs } from './act-rows'
import { cardRows, GUIDE } from './card'
import { COMMAND } from './command'
import type { StatsRange } from './core/read/index'
import { teamSessions } from './leads'
import { metaParts, treeOf, whenWords, type PaneTree } from './meta'
import { BAR_LOOK } from './status-bar'
import { areaView, ownerGroups, statusLines } from './view'
import { cells } from './width'

/**
 * A run of text in one style. No `color` (absent or undefined, as a span picks it by a condition) draws in the theme's
 * text color. With `href` the text is a link to that address (a card's Links row), never split across lines. With
 * `task` the text is that task's id in an open card (ids.ts), which a press on opens as a page; never split either.
 * With `file` the text names a file a card's Reference row lists (ref-file.ts), which a press on opens as a page too
 * (file-page.ts); never split. With `inbox` the text is an unread count (a Teams tab card's), which a press
 * on opens: the session's own in the Inbox view, another area's as a file's page at its first unread line; never split. With `toggles` the text is a press that opens or closes that Teams tab key
 * (team-rows.ts): a leader's fold mark its node, its id its card; never split. With `pins` the text is a session's id
 * a press on ties the tab to, as `/teamrig-pane <session>` does (a tab tied to no session, noSessionBlock); never split.
 * With `starts` the text is a press that starts that meeting (a scheduled meeting's card, meetings-rows.ts); never
 * split. With `meets` the text is a press that runs `teamrig meet` on that session, which brings the owner its cards
 * (a Teams tab row's [Meet], team-rows.ts); never split. With `acts` the text is a press of the owner's Note or Next on
 * a task's card (owner-acts.ts); never split. With `stats` the text is a press on the Stats tab's scope or range row
 * that picks that scope or range, or a Health tile's count that lists its tasks (stats-rows.ts); never split.
 * `underline` marks the words a search matched
 * (search-view.ts).
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
  inbox?: InboxPress
  toggles?: string
  pins?: string
  starts?: string
  meets?: string
  acts?: ActPress
  stats?: StatsPress
}

/**
 * A press on the Stats tab (stats-rows.ts): the scope it folds or the range, on the pick rows; or the Health count whose
 * tasks it lists, on a tile. Or one that opens the tab, on a Teams tab row (team-rows.ts): the scope it opens on, and the
 * tree node's key of the `row` back lands on.
 */
export type StatsPress =
  | { readonly kind: 'scope'; readonly scope: StatsChoice }
  | { readonly kind: 'range'; readonly range: StatsRange }
  | { readonly kind: 'list'; readonly list: StatsListKind }
  | { readonly kind: 'open'; readonly scope: StatsChoice; readonly row: string }

/** A scope as one word: `tree`, `team:<team>` or `session:<team>/<session>`. */
function scopeKey(scope: StatsChoice): string {
  switch (scope.kind) {
    case 'tree':
      return 'tree'
    case 'team':
      return `team:${scope.team}`
    case 'session':
      return `session:${scope.team}/${scope.session}`
  }
}

/**
 * What a Stats tab press picks, as one word: its scope's (scopeKey), `range:<range>`, `list:<count>` or, for one that
 * opens the tab, `open:` and its scope's, so two presses that pick the same are one style (layout.ts) and the focus ring
 * keys each press apart (press-keys.ts).
 */
export function statsPressKey(press: StatsPress): string {
  switch (press.kind) {
    case 'range':
      return `range:${press.range}`
    case 'list':
      return `list:${press.list}`
    case 'scope':
      return scopeKey(press.scope)
    case 'open':
      return `open:${scopeKey(press.scope)}`
  }
}
/** What an unread count's press opens: the area whose inbox it is, and how many of its newest lines are unread. */
export type InboxPress = { readonly area: string; readonly unread: number }
/** An owner act's press on a task's card (owner-acts.ts): the task, and which press it is. */
export type ActPress = { readonly task: string; readonly press: OwnerActPress }
/** The Note field on a task's card (owner-acts.ts): the task, and the round of its opening, a new field each. */
export type NoteField = { readonly task: string; readonly round: number }
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
  /** The Note field a task's card draws in the row's place (owner-acts.ts): in a card the row is a field of its own; its spans are drawn nowhere. */
  field?: NoteField
}
/**
 * What draws as one element. `toggle` names the task a press on it opens or closes the card of; `card` holds
 * that card's rows (card.ts) while it is open, drawn under the block's rows and outside its press (a repo's files in
 * the Changes view are its header's card too, each a press of its own: changes-rows.ts); `opens` names
 * the task a press on it opens the page of (a search result, search-rows.ts); `reads` names the conversation a press
 * on it opens the Log page of (log-rows.ts); `folds` names the key a press on it opens or closes: on the Teams tab a
 * node or a session's card (team-rows.ts), on the Meetings view a meeting's card (meetings-rows.ts), on the Tasks
 * view a section's or an owner's tasks under its heading (sectionHeading); docked only
 * while its rows hold no press of their own (`toggles`), which take its place there; `expands` names the Changes file whose diff a press on it opens or closes, docked (a Changes search
 * result, changes-rows.ts); `opensSection` leads it with a blank line, past the gap every block has; `joined` draws it
 * right under the block before it, with no gap, for a list whose lines are presses of their own (done-rows.ts).
 */
export type Block = {
  key: string
  rows: Row[]
  toggle?: string
  opens?: string
  reads?: LogRead
  folds?: string
  expands?: string
  card?: Row[]
  opensSection?: boolean
  joined?: boolean
}

export const NOTHING_EXPANDED: ExpandedTasks = {}
/** The Tasks view's headings whose tasks are folded away, by block key: none, every section and owner shows its tasks. */
export const NOTHING_FOLDED: readonly string[] = []
/** Leads a folded heading: its tasks lie under it, a press shows them. */
export const FOLDED_MARK: Span = { text: '▸ ', dim: true }
/** Leads an open heading that folds, as FOLDED_MARK leads a folded one. */
export const OPEN_MARK: Span = { text: '▾ ', dim: true }
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

/** Between two of the sessions a tab tied to none lists. */
const SESSION_GAP: Span = { text: '   ' }

/**
 * What the Tasks and Inbox views show while the tab is tied to no session (it has no area): the team's sessions, each
 * a press that ties the tab to it as `/teamrig-pane <session>` does; with no team config read, that command alone.
 */
export function noSessionBlock(key: string, snap: Pick<Snapshot, 'team' | 'leads'>): Block {
  const team = snap.team === null ? '' : ` of team ${snap.team}`
  if (snap.leads === null) return single(key, [{ text: `This tab is not tied to a session${team} yet: /${COMMAND} <session> ties it to one.`, dim: true }])
  const sessions = teamSessions(snap.leads).flatMap((id, i): Span[] => (i === 0 ? [{ text: id, pins: id }] : [SESSION_GAP, { text: id, pins: id }]))
  return {
    key,
    rows: [
      { key, spans: [{ text: `This tab is not tied to a session${team} yet. Press the one this tab is:`, dim: true }] },
      { key: `${key}:sessions`, spans: sessions },
      { key: `${key}:command`, spans: [{ text: `(or /${COMMAND} <session>)`, dim: true }] },
    ],
  }
}

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

/** What a task's title row draws: its id, status and title (a pane task, or a Stats list's slim row). */
type Titled = Pick<TaskRow, 'id' | 'status' | 'title'>

/** Where a task's wrapped title and its meta line start: under the title, past its status mark and id. */
export function indentOf(task: Titled): Span {
  return { text: ' '.repeat(cells(`${GLYPH[task.status]} ${task.id}${TITLE_GAP}`)) }
}

/** `◐ T12  title`, keyed `key`: its status mark in its color, its id bold, a wrapped line under the title; cut at `maxLines` when set. */
export function titleRow(key: string, task: Titled, maxLines?: number): Row {
  return {
    key,
    spans: [{ text: GLYPH[task.status], color: GLYPH_COLOR[task.status] }, { text: ` ${task.id}`, bold: true }, { text: `${TITLE_GAP}${task.title}` }],
    hang: indentOf(task),
    maxLines,
  }
}

/**
 * `◐ T12  title`, the title cut at TITLE_LINES lines, and under it one dim meta line (meta.ts) cut at META_LINES;
 * with its card open, the title shows whole and the card (card.ts) takes the meta line's place, the owner's acts
 * (act-rows.ts, drawn from `acts`) at its bottom. `tree` is the snapshot's (meta.ts treeOf); `viewer` is the area
 * whose list it is (null in the all view): a task it does not own says whose it is.
 */
function taskBlock(section: string, task: TaskRow, expanded: ExpandedTasks, tree: PaneTree, viewer: string | null, acts: CardActs | null): Block {
  const detail = expanded[task.id]
  const indent = indentOf(task)
  const key = taskKey(section, task.id)
  const title = titleRow(key, task, detail === undefined ? TITLE_LINES : undefined)
  if (detail !== undefined) return { key, toggle: task.id, rows: [title], card: [...cardRows(section, task, detail, tree), ...actRows(section, task, acts, GUIDE)] }
  const meta: Row = { key: `${section}-meta:${task.id}`, spans: [indent, ...metaSpans(task, tree, viewer)], hang: indent, maxLines: META_LINES }
  return { key, toggle: task.id, rows: [title, meta] }
}

/**
 * `✓ T4  title          14:02`: a task done or dropped today, dim, on one line with when it closed; with its card
 * open (card.ts), the title shows whole and the card follows. `tree` as taskBlock takes it.
 */
function doneBlock(task: TaskRow, expanded: ExpandedTasks, tree: PaneTree): Block {
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
  if (detail !== undefined) return { key, toggle: task.id, rows: [row], card: cardRows('done', task, detail, tree) }
  return { key, toggle: task.id, rows: [row] }
}

/**
 * The dim line under a section the cap cut `left` of (Asked of others, Done today; view.ts):
 * how many, and the key of the status bar's filter, which lists every task the section holds.
 */
export function moreText(status: BarStatus, left: number): string {
  const more = status === 'waiting' ? `${left} more asked of others` : `${left} more`
  return `${more}: press ${BAR_LOOK[status].hotkey} to list them all`
}

/** `── label ───────`, ruled to the body's edge, a blank line above it: a Changes view heading. */
export function heading(key: string, label: Span[]): Block {
  return { key, opensSection: true, rows: [{ key, spans: [{ text: '── ', dim: true }, ...label], rule: true }] }
}

/**
 * `Working on (2)`: a task section's name, bold, and how many it holds, dim, a blank line above it; a press on it folds
 * its tasks away and a second shows them again (`folds` its key). Folded, `▸ ` leads it.
 */
function sectionHeading(key: string, name: Span, count: string, folded: ReadonlySet<string>): Block {
  const spans = [{ ...name, bold: true }, { text: count, dim: true }]
  return { key, opensSection: true, folds: key, rows: [{ key, spans: folded.has(key) ? [FOLDED_MARK, ...spans] : spans }] }
}

/** The key of each status's section: its tasks' blocks are keyed by it in the full list and in the status's filter. */
const SECTION_KEY: Readonly<Record<BarStatus, string>> = {
  'done-today': 'done',
  verifying: 'verifying',
  working: 'working',
  waiting: 'waiting',
  'not-started': 'next',
}

/** A task's block key: its section's key on the area's list, its owner on every owner's (taskBlock). */
const taskKey = (section: string, id: string) => `${section}:${id}`

/**
 * The key of `task`'s block on the list `mode` shows: under its section, `status` (status-bar.ts barStatusOf), on
 * the area's, under its owner on every owner's. A step back to the list scrolls to it (nav.ts).
 */
export function listRowKey(task: TaskRow, mode: ViewMode, status: BarStatus): string {
  return taskKey(mode === 'mine' ? SECTION_KEY[status] : task.owner, task.id)
}

/**
 * A section of the tasks at `status`: its heading, keyed `key`, with how many it holds (`total`, view.ts areaView), its
 * blocks, and a dim line naming how many the cap left out (moreText); in `folded`, its heading alone. An empty section
 * draws nothing.
 */
function section(status: BarStatus, name: Span, total: number, blocks: Block[], folded: ReadonlySet<string>, key = SECTION_KEY[status]): Block[] {
  if (total === 0) return []
  const head = sectionHeading(key, name, ` (${total})`, folded)
  if (folded.has(key)) return [head]
  const left = total - blocks.length
  const rest = left > 0 ? [single(`${key}-more`, [{ text: moreText(status, left), dim: true }])] : []
  return [head, ...blocks, ...rest]
}

/** The area's tasks at the status the bar filters to, under no heading: what the filter's line names. */
function filteredBlocks(snap: Snapshot, area: string, filter: BarStatus, expanded: ExpandedTasks, acts: CardActs | null): Block[] {
  const tree = treeOf(snap)
  const tasks = statusLines(snap.tasks, area, tree, filter)
  if (tasks.length === 0) return [single('none-filtered', [{ text: BAR_LOOK[filter].none, dim: true }])]
  if (filter === 'done-today') return tasks.map(task => doneBlock(task, expanded, tree))
  return tasks.map(task => taskBlock(SECTION_KEY[filter], task, expanded, tree, area, acts))
}

/**
 * The line under the header while the area has nothing active, `asked` the tasks it asked of others, which the list
 * still holds: the bar counts them as waiting, so a bare `Nothing active.` read as wrong. `pinned` names the area
 * a pin shows, which is not the reader's own.
 */
export function noneActiveText(asked: number, pinned: string | null): string {
  if (asked === 0) return 'Nothing active.'
  const whose = pinned === null ? 'yours' : `${pinned}'s`
  const who = pinned === null ? 'you' : 'it'
  return `Nothing of ${whose} is active. ${asked === 1 ? `1 task ${who} asked of others is` : `${asked} tasks ${who} asked of others are`} below.`
}

/**
 * The area's tasks in sections: Verifying (the ones to close first), Working on, Up next, Waiting (its own), Asked
 * of others (its asks still active, which the bar counts as waiting too) and Done today, each heading its count, those
 * in `folded` their heading alone.
 */
function mineBlocks(snap: Snapshot, expanded: ExpandedTasks, filter: BarStatus | null, folded: ReadonlySet<string>, acts: CardActs | null): Block[] {
  if (snap.area === null) return [noSessionBlock('no-area', snap)]
  const tree = treeOf(snap)
  const view = areaView(snap.tasks, snap.area, tree)
  // The session's own area goes unnamed, as the title above names the session (session-title.ts); a pin names the area it shows.
  // The unread inbox lines are counted on the switch's Inbox button, not here.
  const header: Span[] = snap.areaSource === 'pinned' ? [{ text: view.area, bold: true }, { text: ' (pinned) · ', dim: true }] : []
  const activeTotal = view.verifying.length + view.working.length + view.upNext.length + view.waiting.length
  header.push({ text: `${activeTotal} active`, dim: true })
  const blocks: Block[] = [{ key: 'header', rows: [{ key: 'header', spans: header, rule: true }] }]
  // Filtered from the status bar, the header leads that status's tasks alone.
  if (filter !== null) return [...blocks, ...filteredBlocks(snap, view.area, filter, expanded, acts)]
  const pinned = snap.areaSource === 'pinned' ? view.area : null
  if (activeTotal === 0) blocks.push(single('none-active', [{ text: noneActiveText(view.askedTotal, pinned), dim: true }]))
  const tasks = (status: BarStatus, list: readonly TaskRow[]) => list.map(task => taskBlock(SECTION_KEY[status], task, expanded, tree, view.area, acts))
  const done = view.doneToday.map(task => doneBlock(task, expanded, tree))
  const { counts } = view
  // An ask keeps its block key under the waiting status's (listRowKey), as the bar's waiting filter lists it so too.
  return [
    ...blocks,
    ...section('verifying', { text: 'Verifying', color: 'success' }, counts.verifying, tasks('verifying', view.verifying), folded),
    ...section('working', { text: 'Working on' }, counts.working, tasks('working', view.working), folded),
    ...section('not-started', { text: 'Up next' }, counts['not-started'], tasks('not-started', view.upNext), folded),
    ...section('waiting', { text: 'Waiting' }, view.waiting.length, tasks('waiting', view.waiting), folded),
    ...section('waiting', { text: 'Asked of others' }, view.askedTotal, tasks('waiting', view.asked), folded, 'asked'),
    ...section('done-today', { text: 'Done today' }, counts['done-today'], done, folded),
  ]
}

/**
 * Every owner with active tasks under a heading with its counts, the session's own area first and marked: `(you)`,
 * or `(pinned)` for an area a pin shows; an owner in `folded` (`owner:<id>`) its heading alone.
 */
function allBlocks(snap: Snapshot, expanded: ExpandedTasks, folded: ReadonlySet<string>, acts: CardActs | null): Block[] {
  const tree = treeOf(snap)
  const groups = ownerGroups(snap.tasks, tree, snap.area)
  if (groups.length === 0) return [single('none-active', [{ text: 'No active tasks.', dim: true }])]
  return groups.flatMap((group, i) => {
    const waiting = group.waiting > 0 ? ` · ${group.waiting} waiting` : ''
    const verifying = group.verifying > 0 ? ` · ${group.verifying} verifying` : ''
    const isOwn = group.owner === snap.area
    const owner: Span = { text: group.owner, color: isOwn ? 'claude' : undefined }
    const mark = !isOwn ? '' : snap.areaSource === 'pinned' ? ' (pinned)' : ' (you)'
    const key = `owner:${group.owner}`
    // The first group sits under the buttons, already a gap away.
    const head = { ...sectionHeading(key, owner, `${mark} · ${group.active.length} active${waiting}${verifying}`, folded), opensSection: i > 0 }
    if (folded.has(key)) return [head]
    return [head, ...group.active.map(task => taskBlock(group.owner, task, expanded, tree, null, acts))]
  })
}

/**
 * The body under the buttons: the register's problem, if any, then the mode's view, the tasks in `expanded` with their cards open.
 * A snapshot never read (`now` 0: the pane's first moments, or a hot reload's until its first poll) says so, instead of
 * an empty list or a missing area it has not yet looked for. `filter`, the status bar's (status-bar.ts),
 * narrows the mine view to the area's tasks at that status; null shows them all. The headings in `folded` (a section's
 * key in mine, `owner:<id>` in all) show without their tasks. An open card ends in the owner's acts drawn from `acts`
 * (act-rows.ts); none with `acts` null.
 */
export function paneBlocks(
  snap: Snapshot,
  mode: ViewMode,
  expanded: ExpandedTasks = NOTHING_EXPANDED,
  filter: BarStatus | null = null,
  folded: readonly string[] = NOTHING_FOLDED,
  acts: CardActs | null = null,
): Block[] {
  const reading = readingBlock(snap)
  if (reading !== null) return [reading]
  const keys = new Set(folded)
  return [...problemBlocks(snap), ...(mode === 'mine' ? mineBlocks(snap, expanded, filter, keys, acts) : allBlocks(snap, expanded, keys, acts))]
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
