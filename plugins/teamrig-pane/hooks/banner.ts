// The banner, the pane's first row in every state (T469): the task the session works on now, so a glance at any tab
// tells what it is doing. The engine gives a mod no slot atop the terminal, and only a pane draws a part a press
// reaches, so the banner leads the pane. Now: the area's own in-progress task that took its status last. With none in
// progress, its next: the first open task in plan order (teamrig's list order), after a dim `next`. With neither, a
// dim line says so. A press opens it to the card's facts the person reads first (what it is, where it stands, when
// it is due) and a second press closes it. Pure: one block of rows that layout.ts wraps and register.tsx draws as one
// press, the same element whatever it shows, so the focus ring's index among the pane's elements never moves with it.
import type { Snapshot, TaskDetail, TaskRow } from '../types'
import { cardRows, type CardField } from './card'
import type { TaskTree } from './core/read/index'
import { indentOf, titleRow, type Block, type Row, type Span } from './rows'
import { newestFirst } from './view'
import { cells } from './width'

/** The block's key, and its press's. */
export const BANNER_KEY = 'banner'
/** With no area known; the body says how to give the session one (rows.ts). */
export const NO_AREA_BANNER = 'no area yet'
export const NOTHING_CURRENT = 'nothing in progress or open'

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
 * The banner's block: `◐ T12  title` (after `next` for a task not started) cut at one line, or with `isOpen` the title
 * whole and the card's facts under it at the edge. `tree` is the snapshot's (meta.ts treeOf), `area` the session's.
 */
export function bannerBlock(current: Current | null, isOpen: boolean, tree: TaskTree<TaskRow>, area: string | null): Block {
  if (current === null) return { key: BANNER_KEY, rows: [{ key: BANNER_KEY, spans: [{ text: area === null ? NO_AREA_BANNER : NOTHING_CURRENT, dim: true }] }] }
  const { task } = current
  const title = titleRow(BANNER_KEY, task, isOpen ? undefined : 1)
  const head: Row =
    current.kind === 'now' ? title : { ...title, spans: [NEXT, ...title.spans], hang: { text: ' '.repeat(cells(NEXT.text) + cells(indentOf(task).text)) } }
  return { key: BANNER_KEY, rows: isOpen ? [head, ...cardRows(BANNER_KEY, task, UNREAD, tree, area, null, BANNER_FACTS)] : [head] }
}
