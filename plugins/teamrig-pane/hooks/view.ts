// What the pane shows, as plain data: pure functions over the folded tasks, so the drawing in
// register.tsx only lays them out. The order and the due are teamrig's own: plan order on the effective due, read
// from the snapshot's dependency tree (meta.ts treeOf, core register/tree.ts).
import type { BarStatus, Snapshot, TaskRow } from '../types'
import { ACTIVE_STATUSES, type TaskTree } from './core/read/index'
import { metaText, treeOf, whenWords, type PaneTree } from './meta'
import { barCounts, barStatusOf, isFinishedOn, type BarCounts } from './status-bar'
import { dayOf } from './zone'

/** At most this many tasks done today are listed, and this many asked of others; the heading counts them all. */
export const MAX_FINISHED = 6
export const MAX_ASKED = 8

/**
 * The area's list: a section per status of the status bar (status-bar.ts barStatusOf), each in the order statusLines
 * gives, so the bar's filter lists a section's tasks as the section does.
 */
export type AreaView = {
  area: string
  /** Verifying (shipped, the proof still to come): the ones to close first. */
  verifying: TaskRow[]
  /** In progress. */
  working: TaskRow[]
  /** Open, not yet started. */
  upNext: TaskRow[]
  /** Its waiting tasks, then up to MAX_ASKED active tasks it asked of other sessions. */
  waiting: TaskRow[]
  /** Its tasks done or dropped today, the team zone's day of `now` (status-bar.ts isFinishedOn), at most MAX_FINISHED. */
  doneToday: TaskRow[]
  /**
   * How many tasks each section holds, those past a cap too: the status bar's counts (barCounts) over the same tasks
   * and clock, so a section's heading names the number its count does.
   */
  counts: BarCounts
}

/** An owner's active tasks, those verifying first, and how many of them are waiting or verifying. */
export type OwnerGroup = { owner: string; active: TaskRow[]; waiting: number; verifying: number }

export function isActive(task: TaskRow): boolean {
  return ACTIVE_STATUSES.includes(task.status)
}

/** Verifying: shipped, and active until what proves it is in. */
export function isVerifying(task: TaskRow): boolean {
  return task.status === 'verifying'
}

/** Verifying first, the ones to close, then teamrig's plan order on `tree`'s effective dues. */
function verifyingFirst(tree: TaskTree<TaskRow>): (a: TaskRow, b: TaskRow) => number {
  return (a, b) => Number(isVerifying(b)) - Number(isVerifying(a)) || tree.byPlanOrder(a, b)
}

/** Newest status change first: the order Done today, and a search's finished matches, list in. */
export function newestFirst(a: TaskRow, b: TaskRow): number {
  return Date.parse(b.statusAt) - Date.parse(a.statusAt)
}

/**
 * The area's view of `tasks`, `tree` the dependency tree read over them (meta.ts treeOf), today its clock's day in the
 * team's zone.
 */
export function areaView(tasks: readonly TaskRow[], area: string, tree: TaskTree<TaskRow>): AreaView {
  const lines = (status: BarStatus) => statusLines(tasks, area, tree, status)
  const waiting = lines('waiting')
  const ownWaiting = waiting.filter(t => t.owner === area).length
  return {
    area,
    verifying: lines('verifying'),
    working: lines('working'),
    upNext: lines('not-started'),
    waiting: waiting.slice(0, ownWaiting + MAX_ASKED),
    doneToday: lines('done-today').slice(0, MAX_FINISHED),
    counts: barCounts(tasks, area, tree.context),
  }
}

/**
 * Every task of the area's list at one status of the status bar (status-bar.ts barStatusOf), in the order its section
 * and the bar's filter list them, today the team zone's day of `tree`'s clock: those done today newest first; the
 * others the area's own first (the waiting ones before those it asked of others), each in plan order on `tree`'s
 * effective dues.
 */
export function statusLines(tasks: readonly TaskRow[], area: string, tree: TaskTree<TaskRow>, status: BarStatus): TaskRow[] {
  const { now, zone } = tree.context
  const today = dayOf(now, zone)
  const lines = tasks.filter(t => barStatusOf(t, area, today, zone) === status)
  const ownFirst = (a: TaskRow, b: TaskRow) => Number(b.owner === area) - Number(a.owner === area) || tree.byPlanOrder(a, b)
  return lines.sort(status === 'done-today' ? newestFirst : ownFirst)
}

/** Every owner with active tasks, by name, each list verifying first, then in plan order on `tree`'s effective dues. */
export function ownerGroups(tasks: readonly TaskRow[], tree: TaskTree<TaskRow>): OwnerGroup[] {
  const byOwner = new Map<string, TaskRow[]>()
  for (const task of tasks) {
    if (!isActive(task)) continue
    byOwner.set(task.owner, [...(byOwner.get(task.owner) ?? []), task])
  }
  return [...byOwner.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([owner, list]) => ({
      owner,
      active: [...list].sort(verifyingFirst(tree)),
      waiting: list.filter(t => t.status === 'waiting').length,
      verifying: list.filter(isVerifying).length,
    }))
}

/** Every TaskRow field, kept exhaustive by the compiler, so sameView compares all of them. */
const TASK_FIELDS: { readonly [K in keyof TaskRow]-?: K } = {
  id: 'id',
  title: 'title',
  description: 'description',
  owner: 'owner',
  priority: 'priority',
  due: 'due',
  status: 'status',
  note: 'note',
  proof: 'proof',
  evidence: 'evidence',
  skill: 'skill',
  statusAt: 'statusAt',
  source: 'source',
  ref: 'ref',
  goals: 'goals',
  week: 'week',
  createdBy: 'createdBy',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  updatedBy: 'updatedBy',
  priorityAt: 'priorityAt',
  assignedAt: 'assignedAt',
  ownerSeenAt: 'ownerSeenAt',
  waits: 'waits',
  after: 'after',
}
const FIELDS = Object.values(TASK_FIELDS)

type FieldValue = TaskRow[keyof TaskRow]

/** The goals list is built anew by each read, so it compares by value. */
function sameValue(a: FieldValue, b: FieldValue): boolean {
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) return JSON.stringify(a) === JSON.stringify(b)
  return a === b
}

/**
 * What the clock and the other tasks change in a drawing of the task: an active one's meta line and its card's
 * `since` words (card.ts: an open task's too, which its meta line leaves out), whether a finished one is done today.
 */
function timeLabel(task: TaskRow, tree: PaneTree): string {
  const { now, zone } = tree.context
  return isActive(task)
    ? `${metaText(task, tree)} · ${whenWords(task.statusAt, tree.context)}`
    : String(isFinishedOn(task, dayOf(now, zone), zone))
}

/**
 * Whether two snapshots draw the same pane: the same fields and tasks, and the same labels at
 * their own `now` in their own zone. Each write of the snapshot redraws the pane, so one that draws the same is skipped.
 */
export function sameView(a: Snapshot, b: Snapshot): boolean {
  if (
    a.area !== b.area ||
    a.areaSource !== b.areaSource ||
    a.unreadInbox !== b.unreadInbox ||
    a.problem !== b.problem ||
    a.notPickedUpAfterHours !== b.notPickedUpAfterHours ||
    a.timeZone !== b.timeZone
  )
    return false
  if (a.tasks.length !== b.tasks.length) return false
  const [treeA, treeB] = [treeOf(a), treeOf(b)]
  return a.tasks.every((task, i) => {
    const other = b.tasks[i]
    return (
      other !== undefined &&
      FIELDS.every(field => sameValue(task[field], other[field])) &&
      timeLabel(task, treeA) === timeLabel(other, treeB)
    )
  })
}
