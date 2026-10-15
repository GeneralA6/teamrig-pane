// The pane's body as blocks of rows of styled spans: pure data from a snapshot. A block is what
// draws as one element (layout.ts): a task with what it waits for, its proof note or its details under it, a header, a
// heading. The terminal lays out and paints a pane's whole tree, its scroll only a window over it,
// and an inline pane's frame grows to fit the tree in the live area redrawn on every keystroke: the
// tree's size is what the pane costs, so a block is one Text (its unstyled spans plain strings, a
// task's inside the Button that expands it), never a box per row, and inline the rows are capped.
import type { ThemeKey } from 'claude-code'
import type { BarStatus, ExpandedTasks, Snapshot, TaskDetail, TaskRow, TaskStatus, ViewMode } from '../types'
import { priorityText, waitsText } from './core/read/index'
import { COMMAND } from './command'
import { refLabel, refParts } from './details'
import { BAR_LOOK } from './status-bar'
import { areaView, ownerGroups, shortDue, shortTime, statusLines, type TaskLine } from './view'

/** A run of text in one style. No `color` (absent or undefined, as a span picks it by a condition) draws in the theme's text color. */
export type Span = { text: string; color?: ThemeKey | undefined; bold?: boolean; dim?: boolean }
/**
 * One line of a block before layout: `hang` starts each line it wraps onto (none, absent or
 * undefined as `single` passes it on, starts them at the edge); a `rule` row ends in a rule.
 */
export type Row = { key: string; spans: Span[]; hang?: Span | undefined; rule?: boolean }
/**
 * What draws as one element. `toggle` names the task a press on it expands or collapses;
 * `opensSection` leads it with a blank line, past the gap every block has.
 */
export type Block = { key: string; rows: Row[]; toggle?: string; opensSection?: boolean }

export const NOTHING_EXPANDED: ExpandedTasks = {}
/** Where a task's wrapped title and the lines under it start: under its id, past the marker and status glyph. */
const UNDER_ID = '    '
/** Starts each detail line, a wrapped one too: the guide that ties the details to their task. */
const DETAIL_LEAD: Span = { text: `${UNDER_ID}│ `, dim: true }

/** By the task's status: `◑` is shipped work waiting for its proof, the other half of `◐` working. */
export const GLYPH: Readonly<Record<TaskStatus, string>> = { open: '○', 'in-progress': '◐', verifying: '◑', waiting: '■', done: '✓', dropped: '✗' }
export const GLYPH_COLOR: Partial<Record<TaskStatus, ThemeKey>> = { 'in-progress': 'warning', verifying: 'success', waiting: 'error', done: 'success' }
/** A status note's color: what a waiting task waits for, what proves a verifying one; others draw in the text color. */
const NOTE_COLOR: Partial<Record<TaskStatus, ThemeKey>> = { waiting: 'error', verifying: 'success' }

const NO_AREA = `No area for this session yet: /rename the tab to its session's id or name, run \`inbox read --session <id>\`, or /${COMMAND} <session> to pin one.`

/** A block of one row, its key the block's. */
export function single(key: string, spans: Span[], hang?: Span): Block {
  return { key, rows: [{ key, spans, hang }] }
}

/** `▸` collapsed, `▾` expanded: the row is pressed to switch. */
function marker(task: TaskRow, expanded: ExpandedTasks): string {
  return expanded[task.id] === undefined ? '▸ ' : '▾ '
}

/** `p2`, and `p2 correctness` when the team config names it. */
function priorityLabel(task: TaskRow): string {
  const text = priorityText(task.priority)
  return task.priorityName === null ? text : `${text} ${task.priorityName}`
}

/**
 * The lines under an expanded task: the quoted ask, who asked and when with its priority, week and goals, its status
 * note and evidence, where else to read. A field with no value draws no line.
 */
function detailRows(section: string, task: TaskRow, detail: TaskDetail): Row[] {
  const line = (name: string, spans: Span[]): Row => ({
    key: `${section}-detail:${task.id}:${name}`,
    spans: [DETAIL_LEAD, ...spans],
    hang: DETAIL_LEAD,
  })
  // Quotes read for another ref (the task's ref changed since it was expanded) are not this ask.
  const quotes = detail.ref === task.ref ? detail.quotes : []
  // A bare guide line opens the details and sets each quote apart from the next and from the facts.
  const rows = quotes.flatMap((quote, i) => [line(`gap:${i}`, []), ...quote.lines.map((text, j) => line(`quote:${i}:${j}`, [{ text }]))])
  rows.push(line('gap:facts', []))
  const added = task.createdBy === task.source ? [] : [`added by ${task.createdBy}`]
  const week = task.week === null ? [] : [`week ${shortDue(task.week)}`]
  const asked = [`asked by ${task.source}`, ...added, shortTime(task.createdAt), priorityLabel(task), ...week, ...task.goals]
  rows.push(line('asked', [{ text: asked.join(' · '), dim: true }]))
  const outcome = [task.note, task.evidence === null ? null : `evidence ${task.evidence}`].filter(part => part !== null)
  if (outcome.length > 0) {
    rows.push(line('note', [{ text: `${task.status}: ${outcome.join(' · ')}`, color: NOTE_COLOR[task.status], dim: true }]))
  }
  // The files nothing was quoted from, named without line numbers.
  const quoted = new Set(quotes.map(quote => refLabel(quote.ref)))
  const others = [...new Set(refParts(task.ref).map(refLabel))].filter(label => !quoted.has(label))
  if (others.length > 0) rows.push(line('see', [{ text: `see ${others.join(' · ')}`, dim: true }]))
  return rows
}

/**
 * What its status says under a task: what a waiting one waits for, then its note, as `teamrig list` words them
 * (`decision owner · on T5; the schema first`); `proof: …` what a verifying one waits for; null for other statuses
 * or nothing to say.
 */
function noteText(task: TaskRow): string | null {
  if (task.status === 'waiting') {
    const parts = [task.waits.length > 0 ? waitsText(task.waits) : null, task.note].filter((part): part is string => part !== null)
    return parts.length === 0 ? null : parts.join('; ')
  }
  if (task.note === null) return null
  if (task.status === 'verifying') return `proof: ${task.note}`
  return null
}

/** Its details when expanded, else what holds it or what proves it under it. */
function belowTask(section: string, task: TaskRow, expanded: ExpandedTasks): Row[] {
  const detail = expanded[task.id]
  if (detail !== undefined) return detailRows(section, task, detail)
  const note = noteText(task)
  if (note === null) return []
  const spans = [{ text: `${UNDER_ID}↳ ${note}`, color: NOTE_COLOR[task.status], dim: true }]
  return [{ key: `${section}-note:${task.id}`, spans, hang: { text: `${UNDER_ID}  ` } }]
}

/** `▸ ◐ T12 →po p2 10-14 NEW title`, its title wrapping under its id, then its details or what holds it. */
function taskBlock(section: string, { task, flags }: TaskLine, expanded: ExpandedTasks, owner?: string): Block {
  const spans: Span[] = [
    { text: marker(task, expanded), dim: true },
    { text: `${GLYPH[task.status]} ${task.id}`, color: GLYPH_COLOR[task.status], bold: true },
  ]
  if (owner !== undefined) spans.push({ text: ` →${owner}`, color: 'suggestion' })
  const due = task.due === null ? '' : ` ${shortDue(task.due)}`
  const priority = ` ${priorityText(task.priority)}`
  if (flags.includes('overdue')) spans.push({ text: priority, dim: true }, { text: due, color: 'error', bold: true })
  else spans.push({ text: `${priority}${due}`, dim: true })
  if (flags.includes('new')) spans.push({ text: ' NEW', color: 'suggestion' })
  if (flags.includes('unseen')) spans.push({ text: ' NOT PICKED UP', color: 'error' })
  spans.push({ text: ` ${task.title}` })
  const key = `${section}:${task.id}`
  return { key, toggle: task.id, rows: [{ key, spans, hang: { text: UNDER_ID } }, ...belowTask(section, task, expanded)] }
}

function finishedBlock(task: TaskRow, expanded: ExpandedTasks): Block {
  const key = `finished:${task.id}`
  const text = `${marker(task, expanded)}${GLYPH[task.status]} ${task.id} ${task.title}`
  const rows = [{ key, spans: [{ text, dim: true }], hang: { text: UNDER_ID } }, ...belowTask('finished', task, expanded)]
  return { key, toggle: task.id, rows }
}

/**
 * The dim line under the finished tasks when the cap cut `more` of them: how many, how many of those were dropped,
 * and the key that lists today's done ones in full (the status bar's filter, which leaves the dropped ones out).
 */
export function finishedMoreText(more: number, dropped: number): string {
  const droppedText = dropped > 0 ? ` (${dropped} dropped)` : ''
  const list = more > dropped ? `; press ${BAR_LOOK['done-today'].hotkey} for today's done` : ''
  return `… ${more} more${droppedText}${list}`
}

/** `── label ───────`, ruled to the body's edge, a blank line above it. */
export function heading(key: string, label: Span[]): Block {
  return { key, opensSection: true, rows: [{ key, spans: [{ text: '── ', dim: true }, ...label], rule: true }] }
}

/** The area's tasks at the status the bar filters to, under no heading: what the filter's line names. */
function filteredBlocks(snap: Snapshot, area: string, filter: BarStatus, expanded: ExpandedTasks): Block[] {
  const lines = statusLines(snap.tasks, area, snap.now, filter)
  if (lines.length === 0) return [single('none-filtered', [{ text: BAR_LOOK[filter].none, dim: true }])]
  if (filter === 'done-today') return lines.map(line => finishedBlock(line.task, expanded))
  return lines.map(line => taskBlock(filter === 'verifying' ? 'proof' : 'active', line, expanded))
}

function mineBlocks(snap: Snapshot, expanded: ExpandedTasks, filter: BarStatus | null): Block[] {
  if (snap.area === null) return [single('no-area', [{ text: NO_AREA, dim: true }])]
  const view = areaView(snap.tasks, snap.area, snap.now)
  const header: Span[] = [{ text: view.area, bold: true }]
  if (snap.areaSource === 'pinned') header.push({ text: ' (pinned)', dim: true })
  const activeTotal = view.verifying.length + view.active.length
  header.push({ text: ` · ${activeTotal} active`, dim: true })
  if (snap.unreadInbox !== null)
    header.push({ text: ` · inbox ${snap.unreadInbox} unread`, color: snap.unreadInbox > 0 ? 'warning' : 'subtle' })
  const blocks: Block[] = [{ key: 'header', rows: [{ key: 'header', spans: header, rule: true }] }]
  // Filtered from the status bar, the header leads that status's tasks alone.
  if (filter !== null) return [...blocks, ...filteredBlocks(snap, view.area, filter, expanded)]
  if (activeTotal === 0) blocks.push(single('none-active', [{ text: 'Nothing active.', dim: true }]))
  // Work waiting for its proof leads, the tasks to close first; the rest of the active work then has its own heading.
  if (view.verifying.length > 0) {
    blocks.push(heading('proof', [{ text: `verifying (${view.verifying.length})`, color: 'success' }]))
    blocks.push(...view.verifying.map(line => taskBlock('proof', line, expanded)))
    if (view.active.length > 0) blocks.push(heading('active', [{ text: `other active (${view.active.length})`, dim: true }]))
  }
  blocks.push(...view.active.map(line => taskBlock('active', line, expanded)))
  if (view.askedTotal > 0) blocks.push(heading('asked', [{ text: `asked of others (${view.askedTotal})`, dim: true }]))
  blocks.push(...view.asked.map(line => taskBlock('asked', line, expanded, line.task.owner)))
  if (view.finishedTotal > 0) blocks.push(heading('finished', [{ text: `finished today (${view.finishedTotal})`, dim: true }]))
  blocks.push(...view.finished.map(task => finishedBlock(task, expanded)))
  const finishedMore = view.finishedTotal - view.finished.length
  if (finishedMore > 0)
    blocks.push(single('finished-more', [{ text: finishedMoreText(finishedMore, view.finishedMoreDropped), dim: true }]))
  return blocks
}

function allBlocks(snap: Snapshot, expanded: ExpandedTasks): Block[] {
  const groups = ownerGroups(snap.tasks, snap.now)
  if (groups.length === 0) return [single('none-active', [{ text: 'No active tasks.', dim: true }])]
  return groups.flatMap((group, i) => {
    const waiting = group.waiting > 0 ? ` · ${group.waiting} waiting` : ''
    const verifying = group.verifying > 0 ? ` · ${group.verifying} verifying` : ''
    const counts = ` · ${group.active.length} active${waiting}${verifying}`
    const owner: Span[] = [
      { text: group.owner, bold: true, color: group.owner === snap.area ? 'claude' : undefined },
      { text: counts, dim: true },
    ]
    // The first group sits under the buttons, already a gap away.
    const head = { ...heading(`owner:${group.owner}`, owner), opensSection: i > 0 }
    return [head, ...group.active.map(line => taskBlock(group.owner, line, expanded))]
  })
}

/**
 * The body under the buttons: the register's problem, if any, then the mode's view, expanded tasks with their details.
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
  if (snap.now === 0 && snap.problem === null) return [single('reading', [{ text: 'Reading the register…', dim: true }])]
  const problem = snap.problem === null ? [] : [single('problem', [{ text: `WARN ${snap.problem}`, color: 'warning' }], { text: '  ' })]
  return [...problem, ...(mode === 'mine' ? mineBlocks(snap, expanded, filter) : allBlocks(snap, expanded))]
}
