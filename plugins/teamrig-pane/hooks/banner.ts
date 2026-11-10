// The banner (T469, T595): the task the session works on now, so a glance at any tab tells what it is doing. It is
// drawn in the band above the prompt (register.tsx), the one place outside the pane the engine gives a mod and one a
// press reaches, so it shows whether the pane is open, minimized or never opened. Now: the area's own in-progress task
// that took its status last. With none in progress, its next: the first open task in plan order (teamrig's list
// order), after a dim `next`. With neither, a dim line says so. It leads with the session's name (T824), the band's one
// line that stays in view while the pane scrolls. A press opens it to the card's facts the person reads
// first (what it is, where it stands, when it is due) and a second press closes it. At the band's right end a button
// opens the pane, minimized or never opened too, at the task's page, over the list at the task's row (T775). Over the
// banner, the area's previous conversation (T2249), so after a /clear the band names what came before: its title, a
// button that opens its page in the pane and one that opens the pane's list of conversations, in a dim frame of its
// own, and a press on its title opens it to its tasks' whole titles, its times and how it opened (T2302). Pure: the blocks of rows
// that layout.ts wraps and register.tsx draws, and the row the button's page goes back to.
import type { LogConversation, Snapshot, TaskDetail, TaskRow, ViewMode } from '../types'
import { cardRows, type CardField } from './card'
import type { TaskTree } from './core/read/index'
import { conversationWhen } from './log-rows'
import { openingSpan, titleSpans, workedTitles, type Worked } from './log-title'
import type { PaneTree } from './meta'
import { SEPARATOR, indentOf, listRowKey, titleRow, type Block, type Row, type Span } from './rows'
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
/** The key of the previous conversation's row, and of the Box around it that takes the free columns before its buttons. */
export const PREVIOUS_KEY = 'previous'
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

/** Before the title of the task up next, when none is in progress. */
const NEXT: Span = { text: 'next ', dim: true }
/** Before the previous conversation's title. */
const PREVIOUS: Span = { text: 'previous', dim: true }
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
  return listRowKey(current.task, mode, current.kind === 'now' ? 'working' : 'not-started')
}

/**
 * The banner's block: `acme-tr-pane · ◐ T12  title` (`next` before a task not started) cut at one line, or with
 * `isOpen` the title whole and the card's facts under it at the edge. It leads with `name` (session-title.ts
 * sessionName), so the band says whose session it is while the pane's body scrolls. `tree` is the snapshot's (meta.ts
 * treeOf); the band draws none for a session with no area.
 */
export function bannerBlock(current: Current | null, isOpen: boolean, tree: PaneTree, name: string): Block {
  const lead: Span[] = [{ text: name, bold: true }, SEPARATOR]
  if (current === null) return { key: BANNER_KEY, rows: [{ key: BANNER_KEY, spans: [...lead, { text: NOTHING_CURRENT, dim: true }] }] }
  const { task } = current
  const title = titleRow(BANNER_KEY, task, isOpen ? undefined : 1)
  const before = current.kind === 'now' ? lead : [...lead, NEXT]
  const hang = cells(before.map(span => span.text).join('')) + cells(indentOf(task).text)
  const head: Row = { ...title, spans: [...before, ...title.spans], hang: { text: ' '.repeat(hang) } }
  return { key: BANNER_KEY, rows: isOpen ? [head, ...cardRows(BANNER_KEY, task, UNREAD, tree, null, BANNER_FACTS)] : [head] }
}

/**
 * The previous conversation's block: `previous · <its title>` cut at one line, the title as the Log view's list draws
 * it (log-title.ts titleSpans): the tasks its session worked while it ran, else how it opened. With `isOpen`, as a
 * press on the banner opens its card: each task it worked a row of its own with its whole title, then when it ran and
 * its count of lines on `clock`, then how it opened when its tasks title it, each row under the title.
 */
export function previousBlock(conversation: LogConversation, worked: Worked, isOpen: boolean, clock: Clock): Block {
  const lead = [PREVIOUS, SEPARATOR]
  if (!isOpen) return { key: PREVIOUS_KEY, rows: [{ key: PREVIOUS_KEY, spans: [...lead, ...titleSpans(conversation, worked)], maxLines: 1 }] }
  const hang: Span = { text: ' '.repeat(cells(lead.map(span => span.text).join(''))) }
  const under = (key: string, spans: Span[]): Row => ({ key: `${PREVIOUS_KEY}:${key}`, spans: [hang, ...spans], hang })
  const [first, ...more] = workedTitles(conversation, worked)
  const opening = openingSpan(conversation)
  return {
    key: PREVIOUS_KEY,
    rows: [
      { key: PREVIOUS_KEY, spans: [...lead, ...(first ?? titleSpans(conversation, worked))], hang },
      ...more.map((spans, i) => under(`task:${i + 1}`, spans)),
      under('when', [{ text: conversationWhen(conversation, clock), dim: true }]),
      ...(first !== undefined && opening !== null ? [under('opened', [OPENED, SEPARATOR, opening])] : []),
    ],
  }
}
