// The pane's body as blocks of rows of styled spans: pure data from a snapshot. A block is what
// draws as one element (layout.ts): a task with its blocked note or details under it, a header, a
// heading. The terminal lays out and paints a pane's whole tree, its scroll only a window over it,
// and an inline pane's frame grows to fit the tree in the live area redrawn on every keystroke: the
// tree's size is what the pane costs, so a block is one Text (its unstyled spans plain strings, a
// task's inside the Button that expands it), never a box per row, and inline the rows are capped.
import type { ThemeKey } from 'claude-code'
import type { Cut, ExpandedTasks, NoteLine, RelatedTask, ShownStatus, Snapshot, TaskDetail, TaskRow, ViewMode } from '../types'
import { refLabel, refParts } from './details'
import { areaView, ownerGroups, shortDue, shortTime, type TaskLine } from './view'

export type Span = { text: string; color?: ThemeKey; bold?: boolean; dim?: boolean }
/** One line of a block before layout: `hang` starts each line it wraps onto; a `rule` row ends in a rule. */
export type Row = { key: string; spans: Span[]; hang?: Span; rule?: boolean }
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
/** Where a wrapped tree branch (a related task, a note) goes on: under its text, past the branch. */
const BRANCH_HANG: Span = { text: `${UNDER_ID}│     `, dim: true }

/** By the shown status: a task held by a link or a wait draws blocked, one under a pause paused. */
export const GLYPH: Readonly<Record<ShownStatus, string>> = { open: '○', 'in-progress': '◐', blocked: '■', verifying: '◇', paused: '◌', done: '✓', dropped: '✗' }
const GLYPH_COLOR: Partial<Record<ShownStatus, ThemeKey>> = { 'in-progress': 'warning', blocked: 'error', verifying: 'suggestion', done: 'success' }

const NO_AREA = 'No area for this session yet: run `inbox read --session <area>`, or /tasklist <area> to pin one.'

/** A block of one row, its key the block's. */
export function single(key: string, spans: Span[], hang?: Span): Block {
  return { key, rows: [{ key, spans, hang }] }
}

/** `▸` collapsed, `▾` expanded: the row is pressed to switch. */
function marker(task: TaskRow, expanded: ExpandedTasks): string {
  return expanded[task.id] === undefined ? '▸ ' : '▾ '
}

/** `kind code · labels token-saving,owner-gated`, as the register's `show` writes them; null when neither is set. */
function kindText(task: TaskRow): string | null {
  const parts = [task.kind === null ? null : `kind ${task.kind}`, task.labels.length > 0 ? `labels ${task.labels.join(',')}` : null]
  const set = parts.filter(part => part !== null)
  return set.length > 0 ? set.join(' · ') : null
}

/** `start 10-15 · started 10-14 12:19 · eta 10-19 (moved 2×) · done 10-14 18:00 · due moved 1×`; null when none is set. */
function datesText(task: TaskRow): string | null {
  const moved = (n: number) => (n > 0 ? ` (moved ${n}×)` : '')
  const parts = [
    task.start === null ? null : `start ${shortDue(task.start)}`,
    task.startedAt === null ? null : `started ${shortTime(task.startedAt)}`,
    task.eta === null ? null : `eta ${shortDue(task.eta)}${moved(task.etaRevisions)}`,
    task.doneAt === null ? null : `done ${shortTime(task.doneAt)}`,
    // The due itself is on the task's line.
    task.dueRevisions > 0 ? `due moved ${task.dueRevisions}×` : null,
  ]
  const set = parts.filter(part => part !== null)
  return set.length > 0 ? set.join(' · ') : null
}

/** A related task as a tree line's spans: its glyph and id in its status colour, then its title. */
function relatedSpans(related: RelatedTask): Span[] {
  const finished = related.shown === 'done' || related.shown === 'dropped'
  return [{ text: `${GLYPH[related.shown]} ${related.id}`, color: GLYPH_COLOR[related.shown] }, { text: ` ${related.title}`, dim: finished }]
}

/** Each item under its label as a branch of a small tree, `├` then `└` on the last, which says how many were left out. */
function branches<T>(list: Cut<T>, spansOf: (item: T) => Span[], moreText: (more: number) => string): Span[][] {
  const out = list.items.map((item, i) => {
    const last = i === list.items.length - 1 && list.more === 0
    return [{ text: last ? '  └ ' : '  ├ ', dim: true }, ...spansOf(item)]
  })
  if (list.more > 0) out.push([{ text: `  └ ${moreText(list.more)}`, dim: true }])
  return out
}

const moreTasks = (more: number) => `+${more} more`
const olderNotes = (more: number) => `+${more} older (the register's show has them)`

/**
 * The lines under an expanded task: its detail, the quoted ask, who asked and when, the register v2 facts that are
 * set (kind, dates, estimate, proof due), its parent, sub-tasks and blockers as a small tree, its open waits, the
 * newest notes, where else to read. A field with no value draws no line.
 */
function detailRows(section: string, task: TaskRow, detail: TaskDetail): Row[] {
  const line = (name: string, spans: Span[], hang: Span = DETAIL_LEAD): Row => ({
    key: `${section}-detail:${task.id}:${name}`,
    spans: [DETAIL_LEAD, ...spans],
    hang,
  })
  /** A label line, then its items as branches, each wrapping under its own text. */
  const tree = (name: string, label: string, items: Span[][]): Row[] =>
    items.length === 0
      ? []
      : [line(name, [{ text: label, dim: true }]), ...items.map((spans, i) => line(`${name}:${i}`, spans, BRANCH_HANG))]
  // Quotes read for another ref (the task's ref changed since it was expanded) are not this ask.
  const quotes = detail.ref === task.ref ? detail.quotes : []
  // The register's own statement of the ask comes first: it says what done looks like, which a quote seldom does.
  const ask = task.detail === null ? [] : [line('gap:detail', []), line('detail', [{ text: task.detail }])]
  // A bare guide line opens the details and sets each quote apart from the next and from the facts.
  const rows = [...ask, ...quotes.flatMap((quote, i) => [
    line(`gap:${i}`, []),
    ...quote.lines.map((text, j) => line(`quote:${i}:${j}`, [{ text }])),
  ])]
  rows.push(line('gap:facts', []))
  const added = task.createdBy === task.source ? [] : [`added by ${task.createdBy}`]
  const asked = [`asked by ${task.source}`, ...added, shortTime(task.createdAt), ...task.goals]
  rows.push(line('asked', [{ text: asked.join(' · '), dim: true }]))
  const kind = kindText(task)
  if (kind !== null) rows.push(line('kind', [{ text: kind, dim: true }]))
  const dates = datesText(task)
  if (dates !== null) rows.push(line('dates', [{ text: dates, dim: true }]))
  if (task.estimate !== null) rows.push(line('estimate', [{ text: task.estimate, dim: true }]))
  const outcome = [task.note, task.evidence === null ? null : `evidence ${task.evidence}`].filter(part => part !== null)
  if (outcome.length > 0) {
    const color = task.status === 'blocked' ? 'error' : undefined
    rows.push(line('note', [{ text: `${task.status}: ${outcome.join(' · ')}`, color, dim: true }]))
  }
  // When a verifying task's proof is due: after its status note, in the verifying colour.
  if (task.evidenceDue !== null)
    rows.push(line('evidence-due', [{ text: `evidence due ${shortDue(task.evidenceDue)}`, color: GLYPH_COLOR.verifying, dim: true }]))
  if (task.parent !== null) rows.push(line('parent', [{ text: 'part of ', dim: true }, ...relatedSpans(task.parent)], BRANCH_HANG))
  rows.push(...tree('children', 'sub-tasks', branches(task.children, relatedSpans, moreTasks)))
  rows.push(...tree('blocked-by', 'blocked by', branches({ items: [...task.blockedBy], more: 0 }, relatedSpans, moreTasks)))
  for (const [i, wait] of task.waits.entries())
    rows.push(line(`wait:${i}`, [{ text: `waits on ${wait.on}: ${wait.what}`, color: 'error', dim: true }]))
  if (task.pause !== null) rows.push(line('pause', [{ text: `paused ${task.pause}`, dim: true }]))
  const noteSpans = (note: NoteLine): Span[] => [{ text: `${shortTime(note.at)} ${note.by}: ${note.text}`, dim: true }]
  rows.push(...tree('notes', 'notes, newest first', branches(task.notes, noteSpans, olderNotes)))
  // The files nothing was quoted from, named without line numbers.
  const quoted = new Set(quotes.map(quote => refLabel(quote.ref)))
  const others = [...new Set(refParts(task.ref).map(refLabel))].filter(label => !quoted.has(label))
  if (others.length > 0) rows.push(line('see', [{ text: `see ${others.join(' · ')}`, dim: true }]))
  return rows
}

/** Why a task that shows blocked is held: its blocked note, then `waits on T194 · owner: <what>`; null when nothing says. */
function heldText(task: TaskRow): string | null {
  if (task.shown !== 'blocked') return null
  const note = task.status === 'blocked' ? task.note : null
  const parts = [note, task.holds.length > 0 ? `waits on ${task.holds.join(' · ')}` : null].filter(part => part !== null)
  return parts.length > 0 ? parts.join(' · ') : null
}

/** Its details when expanded, else what holds it under it. */
function belowTask(section: string, task: TaskRow, expanded: ExpandedTasks): Row[] {
  const detail = expanded[task.id]
  if (detail !== undefined) return detailRows(section, task, detail)
  const held = heldText(task)
  if (held !== null)
    return [{ key: `${section}-note:${task.id}`, spans: [{ text: `${UNDER_ID}↳ ${held}`, color: 'error', dim: true }], hang: { text: `${UNDER_ID}  ` } }]
  return []
}

/** `▸ ◐ T12 →po t2 10-14 NEW ⛔T3 ↑T2 title`, its title wrapping under its id, then its details or what holds it. */
function taskBlock(section: string, { task, flags }: TaskLine, expanded: ExpandedTasks, owner?: string): Block {
  const spans: Span[] = [
    { text: marker(task, expanded), dim: true },
    { text: `${GLYPH[task.shown]} ${task.id}`, color: GLYPH_COLOR[task.shown], bold: true },
  ]
  if (owner !== undefined) spans.push({ text: ` →${owner}`, color: 'suggestion' })
  const due = task.due === null ? '' : ` ${shortDue(task.due)}`
  if (flags.includes('overdue')) spans.push({ text: ` t${task.tier}`, dim: true }, { text: due, color: 'error', bold: true })
  else spans.push({ text: ` t${task.tier}${due}`, dim: true })
  if (flags.includes('new')) spans.push({ text: ' NEW', color: 'suggestion' })
  if (flags.includes('unseen')) spans.push({ text: ' NOT PICKED UP', color: 'error' })
  if (task.markers.length > 0) spans.push({ text: ` ${task.markers.join(' ')}`, dim: true })
  spans.push({ text: ` ${task.title}` })
  const key = `${section}:${task.id}`
  return { key, toggle: task.id, rows: [{ key, spans, hang: { text: UNDER_ID } }, ...belowTask(section, task, expanded)] }
}

function finishedBlock(task: TaskRow, expanded: ExpandedTasks): Block {
  const key = `finished:${task.id}`
  const text = `${marker(task, expanded)}${GLYPH[task.shown]} ${task.id} ${task.title}`
  const rows = [{ key, spans: [{ text, dim: true }], hang: { text: UNDER_ID } }, ...belowTask('finished', task, expanded)]
  return { key, toggle: task.id, rows }
}

/** `── label ───────`, ruled to the body's edge, a blank line above it. */
export function heading(key: string, label: Span[]): Block {
  return { key, opensSection: true, rows: [{ key, spans: [{ text: '── ', dim: true }, ...label], rule: true }] }
}

function mineBlocks(snap: Snapshot, expanded: ExpandedTasks): Block[] {
  if (snap.area === null) return [single('no-area', [{ text: NO_AREA, dim: true }])]
  const view = areaView(snap.tasks, snap.area, snap.now)
  const header: Span[] = [{ text: view.area, bold: true }]
  if (snap.areaSource === 'pinned') header.push({ text: ' (pinned)', dim: true })
  header.push({ text: ` · ${view.active.length} active`, dim: true })
  if (snap.unreadInbox !== null)
    header.push({ text: ` · inbox ${snap.unreadInbox} unread`, color: snap.unreadInbox > 0 ? 'warning' : 'subtle' })
  const blocks: Block[] = [{ key: 'header', rows: [{ key: 'header', spans: header, rule: true }] }]
  if (view.active.length === 0) blocks.push(single('none-active', [{ text: 'Nothing active.', dim: true }]))
  blocks.push(...view.active.map(line => taskBlock('active', line, expanded)))
  if (view.askedTotal > 0) blocks.push(heading('asked', [{ text: `asked of others (${view.askedTotal})`, dim: true }]))
  blocks.push(...view.asked.map(line => taskBlock('asked', line, expanded, line.task.owner)))
  if (view.finished.length > 0) blocks.push(heading('finished', [{ text: 'finished today', dim: true }]))
  blocks.push(...view.finished.map(task => finishedBlock(task, expanded)))
  return blocks
}

function allBlocks(snap: Snapshot, expanded: ExpandedTasks): Block[] {
  const groups = ownerGroups(snap.tasks, snap.now)
  if (groups.length === 0) return [single('none-active', [{ text: 'No active tasks.', dim: true }])]
  return groups.flatMap((group, i) => {
    const counts = ` · ${group.active.length} active${group.blocked > 0 ? ` · ${group.blocked} blocked` : ''}`
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
 * an empty list or a missing area it has not yet looked for.
 */
export function paneBlocks(snap: Snapshot, mode: ViewMode, expanded: ExpandedTasks = NOTHING_EXPANDED): Block[] {
  if (snap.now === 0 && snap.problem === null) return [single('reading', [{ text: 'Reading the register…', dim: true }])]
  const problem = snap.problem === null ? [] : [single('problem', [{ text: `⚠ ${snap.problem}`, color: 'warning' }], { text: '  ' })]
  return [...problem, ...(mode === 'mine' ? mineBlocks(snap, expanded) : allBlocks(snap, expanded))]
}
