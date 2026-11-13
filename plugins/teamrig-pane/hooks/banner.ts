// The banner (T469, T595): the task the session works on now, so a glance at any tab tells what it is doing. It is
// drawn in the band above the prompt (register.tsx), the one place outside the pane the engine gives a mod and one a
// press reaches, so it shows whether the pane is open, minimized or never opened. Now: the area's own in-progress task
// that took its status last, after a dim `working on`. With none in progress, its next: the first open task in plan
// order (teamrig's list order), after a dim `up next`; both labels are the pane list's section names, so the line reads
// as the current task and not one more row (T2355). With neither, a dim line says so. It leads with the session's name (T824), the band's one
// line that stays in view while the pane scrolls. A press opens it to the card's facts the person reads
// first (what it is, where it stands, when it is due) and a second press closes it. At the band's right end a button
// opens the pane, minimized or never opened too, at the task's page, over the list at the task's row (T775). Over the
// banner, the area's previous conversation (T2249), so after a /clear the band names what came before: in a dim frame
// of its own, a head row with a dim `previous conversation` label that names the block (T2355) and two buttons, one
// that opens its page in the pane and one the pane's list of conversations, and under it its title at the frame's
// whole width; a press on the title opens it to its tasks' whole titles, its times and how it opened (T2302). Pure: the blocks of rows
// that layout.ts wraps and register.tsx draws, and the row the button's page goes back to.
import type { BarStatus, LogConversation, Snapshot, TaskDetail, TaskRow, ViewMode } from '../types'
import { cardRows, type CardField } from './card'
import type { TaskTree } from './core/read/index'
import { conversationWhen } from './log-rows'
import { openingSpan, titleSpans, workedTitles, type Worked } from './log-title'
import type { PaneTree } from './meta'
import { SEPARATOR, indentOf, listHeadingKey, listRowKey, titleRow, type Block, type Row, type Span } from './rows'
import { newestFirst } from './view'
import { cells } from './width'
import type { Clock } from './zone'

/** The block's key, and its press's. */
export const BANNER_KEY = 'banner'
export const NOTHING_CURRENT = 'nothing in progress or open'
/** The key and label of the button at the band's right end that opens the pane at the task's page. */
export const BANNER_OPEN_KEY = 'banner-open'
export const BANNER_OPEN_LABEL = 'open in pane'
/** The key of the Box around the banner's press that takes the band's free columns, so the open button ends the row. */
export const BANNER_FILL_KEY = 'banner-fill'
/** The key of the previous conversation's title, and of the Box around it at the frame's whole inner width. */
export const PREVIOUS_KEY = 'previous'
/**
 * The key of its head row, its label then its two buttons, and the label: on a line of its own over the title, since
 * inline before it the label would leave a title 13 cells at 80 columns. The frame's top edge would hold it in one row
 * less, but the engine's border text (a Box's borderText style) is not among the Box props a mod may pass.
 */
export const PREVIOUS_HEAD_KEY = 'previous-head'
export const PREVIOUS_LABEL = 'previous conversation'
/** The key of the press on its title that opens it and closes it, as the banner's does. */
export const PREVIOUS_PRESS_KEY = 'previous-press'
/**
 * The key of the frame round its row, a dim round border, so it never reads as the banner's, and the
 * cells inside the border each side; the border and those cells take their columns from its title's width.
 */
export const PREVIOUS_FRAME_KEY = 'previous-frame'
export const PREVIOUS_FRAME_PADDING = 1
export const PREVIOUS_FRAME_CELLS = 2 * (1 + PREVIOUS_FRAME_PADDING)
/** The key of its button that opens the pane at its page; the label is BANNER_OPEN_LABEL. */
export const PREVIOUS_OPEN_KEY = 'previous-open'
/** The key and label of its button that opens the pane at the list of conversations. */
export const PREVIOUS_ALL_KEY = 'previous-all'
export const PREVIOUS_ALL_LABEL = 'all conversations'

/**
 * Before the task's title, what it is: the pane list's section names for a task in progress and one up next. Inline and
 * unframed: the label names it, the previous conversation's frame already sets the two apart, and a frame would cost
 * two rows of a band the engine scrolls past its cap.
 */
const WORKING_ON: Span = { text: 'working on', dim: true }
const UP_NEXT: Span = { text: 'up next', dim: true }
/** Before how a conversation its tasks title opened, in its open block. */
const OPENED: Span = { text: 'opened', dim: true }
/** The card's facts an open banner shows. */
const BANNER_FACTS: ReadonlySet<CardField> = new Set<CardField>(['description', 'status', 'note', 'proof', 'priority', 'due'])
/** A banner reads nothing beyond the register: its card shows no quote and no goal item. */
const UNREAD: TaskDetail = { ref: null, quotes: [], goals: [] }

/** The task a banner shows: `now` while in progress, `next` when it is the first open one. */
export type Current = { readonly kind: 'now' | 'next'; readonly task: TaskRow }

/** The area's task in progress that took its status last, else its first open task in plan order on `tree`; null for none or no area. */
export function currentTask(snap: Snapshot, tree: TaskTree<TaskRow>): Current | null {
  const own = snap.tasks.filter(task => snap.area !== null && task.owner === snap.area)
  const working = own.filter(task => task.status === 'in-progress').sort(newestFirst)[0]
  if (working !== undefined) return { kind: 'now', task: working }
  const next = own.filter(task => task.status === 'open').sort((a, b) => tree.byPlanOrder(a, b))[0]
  return next === undefined ? null : { kind: 'next', task: next }
}

/**
 * The key of the row `current` sits at on the pane's list of `mode` (rows.ts listRowKey): under Working on while in
 * progress, Up next while next, on every owner's under the area's own.
 */
export function currentRowKey(current: Current, mode: ViewMode): string {
  return listRowKey(current.task, mode, currentStatus(current))
}

/** The status bar's status `current` is listed under: working while in progress, not started while next. */
function currentStatus(current: Current): BarStatus {
  return current.kind === 'now' ? 'working' : 'not-started'
}

/** How the list looks beside its places: the status the bar filters the mine view to (null for all), the folded headings. */
export type ListLook = { readonly filter: BarStatus | null; readonly folded: readonly string[] }

/**
 * `look` changed only as far as the list of `mode` needs to draw `current`'s row (currentRowKey), so back from the
 * page the button opens lands on it (T1291): on the area's list a filter to another status cleared, and the heading
 * over the row unfolded. A filter to the row's own status lists it under no heading, so the folds stay as they were.
 */
export function lookShowing(current: Current, mode: ViewMode, look: ListLook): ListLook {
  const status = currentStatus(current)
  if (mode === 'mine' && look.filter === status) return look
  const heading = listHeadingKey(current.task, mode, status)
  return { filter: mode === 'mine' ? null : look.filter, folded: look.folded.filter(key => key !== heading) }
}

/**
 * The banner's block: `acme-tr-pane · working on · ◐ T12  title` (`up next` for a task not started) cut at one line, or with
 * `isOpen` the title whole and the card's facts under it at the edge. It leads with `name` (session-title.ts
 * sessionName), so the band says whose session it is while the pane's body scrolls. `tree` is the snapshot's (meta.ts
 * treeOf); the band draws none for a session with no area.
 */
export function bannerBlock(current: Current | null, isOpen: boolean, tree: PaneTree, name: string): Block {
  const lead: Span[] = [{ text: name, bold: true }, SEPARATOR]
  if (current === null) return { key: BANNER_KEY, rows: [{ key: BANNER_KEY, spans: [...lead, { text: NOTHING_CURRENT, dim: true }] }] }
  const { task } = current
  const title = titleRow(BANNER_KEY, task, isOpen ? undefined : 1)
  const before = [...lead, current.kind === 'now' ? WORKING_ON : UP_NEXT, SEPARATOR]
  const hang = cells(before.map(span => span.text).join('')) + cells(indentOf(task).text)
  const head: Row = { ...title, spans: [...before, ...title.spans], hang: { text: ' '.repeat(hang) } }
  return { key: BANNER_KEY, rows: isOpen ? [head, ...cardRows(BANNER_KEY, task, UNREAD, tree, null, BANNER_FACTS)] : [head] }
}

/**
 * The previous conversation's block, its title cut at one line, as the Log view's list draws it (log-title.ts
 * titleSpans): the tasks its session worked while it ran, else how it opened. Its frame's head row (PREVIOUS_LABEL)
 * names it, so the title leads its row. With `isOpen`, as a press on the banner opens its card: each task it worked a
 * row of its own with its whole title, then when it ran and its count of lines on `clock`, then how it opened when its
 * tasks title it.
 */
export function previousBlock(conversation: LogConversation, worked: Worked, isOpen: boolean, clock: Clock): Block {
  if (!isOpen) return { key: PREVIOUS_KEY, rows: [{ key: PREVIOUS_KEY, spans: titleSpans(conversation, worked), maxLines: 1 }] }
  const under = (key: string, spans: Span[]): Row => ({ key: `${PREVIOUS_KEY}:${key}`, spans })
  const [first, ...more] = workedTitles(conversation, worked)
  const opening = openingSpan(conversation)
  return {
    key: PREVIOUS_KEY,
    rows: [
      { key: PREVIOUS_KEY, spans: first ?? titleSpans(conversation, worked) },
      ...more.map((spans, i) => under(`task:${i + 1}`, spans)),
      under('when', [{ text: conversationWhen(conversation, clock), dim: true }]),
      ...(first !== undefined && opening !== null ? [under('opened', [OPENED, SEPARATOR, opening])] : []),
    ],
  }
}
