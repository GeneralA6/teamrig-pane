// The banner (T469, T595): the task the session works on now, so a glance at any tab tells what it is doing. It is
// drawn in the band above the prompt (register.tsx), the one place outside the pane the engine gives a mod and one a
// press reaches, so it shows whether the pane is open, minimized or never opened. Now: the area's own in-progress task
// that took its status last. With none in progress, its next: the first open task in plan order (teamrig's list
// order), after a dim `next`. With neither, a dim line says so. It leads with the session's name (T824), the band's one
// line that stays in view while the pane scrolls. A press opens it to the card's facts the person reads
// first (what it is, where it stands, when it is due) and a second press closes it. Beside it a button opens the
// pane, minimized or never opened too, at the task's page, over the list at the task's row (T775). Pure: one block
// of rows that layout.ts wraps and register.tsx draws as one press, and the row the button's page goes back to.
import type { Snapshot, TaskDetail, TaskRow, ViewMode } from '../types'
import { cardRows, type CardField } from './card'
import type { TaskTree } from './core/read/index'
import type { PaneTree } from './meta'
import { SEPARATOR, indentOf, listRowKey, titleRow, type Block, type Row, type Span } from './rows'
import { newestFirst } from './view'
import { cells } from './width'

/** The block's key, and its press's. */
export const BANNER_KEY = 'banner'
export const NOTHING_CURRENT = 'nothing in progress or open'
/** The key and label of the button beside the banner that opens the pane at the task's page. */
export const BANNER_OPEN_KEY = 'banner-open'
export const BANNER_OPEN_LABEL = 'open in pane'

/** Before the title of the task up next, when none is in progress. */
const NEXT: Span = { text: 'next ', dim: true }
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
