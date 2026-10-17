// What the pane shows, as plain data: pure functions over the folded tasks, so the drawing in
// register.tsx only lays them out. The order and the due are teamrig's own: plan order on the effective due, read
// from the snapshot's dependency tree (meta.ts treeOf, core register/tree.ts).
import type { BarStatus, Snapshot, TaskRow, TaskStatus } from '../types'
import { ACTIVE_STATUSES, type TaskTree } from './core/read/index'
import { metaText, treeOf, whenWords } from './meta'
import { barStatusOf, isFinishedOn, utcDay } from './status-bar'

/** At most this many tasks done today are listed, and this many asked of others; the heading counts them all. */
export const MAX_FINISHED = 6
export const MAX_ASKED = 8

/** The area's own tasks and those it asked of others, each section in teamrig's plan order (priority, effective due, id). */
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
  /** How many tasks wait: its own waiting ones and every one it asked of others. */
  waitingTotal: number
  /** Its tasks done or dropped today, the UTC day of `now` (status-bar.ts isFinishedOn), newest first, at most MAX_FINISHED. */
  doneToday: TaskRow[]
  doneTotal: number
  /** How many past the cap were dropped: the status bar's done-today filter lists the done ones alone. */
  doneMoreDropped: number
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

/** The area's view of `tasks`, `tree` the dependency tree read over them (meta.ts treeOf), today its clock's UTC day. */
export function areaView(tasks: readonly TaskRow[], area: string, tree: TaskTree<TaskRow>): AreaView {
  const planOrder = (a: TaskRow, b: TaskRow) => tree.byPlanOrder(a, b)
  const own = tasks.filter(t => t.owner === area && isActive(t)).sort(planOrder)
  const at = (status: TaskStatus) => own.filter(t => t.status === status)
  const waiting = at('waiting')
  const asked = tasks.filter(t => t.createdBy === area && t.owner !== area && isActive(t)).sort(planOrder)
  const today = utcDay(tree.context.now)
  const done = tasks.filter(t => t.owner === area && isFinishedOn(t, today)).sort(newestFirst)
  return {
    area,
    verifying: at('verifying'),
    working: at('in-progress'),
    upNext: at('open'),
    waiting: [...waiting, ...asked.slice(0, MAX_ASKED)],
    waitingTotal: waiting.length + asked.length,
    doneToday: done.slice(0, MAX_FINISHED),
    doneTotal: done.length,
    doneMoreDropped: done.slice(MAX_FINISHED).filter(t => t.status === 'dropped').length,
  }
}

/**
 * The area's own tasks at one status of the status bar (status-bar.ts), as its filter lists them, today
 * the UTC day of `tree`'s clock: those done today newest first, the others in plan order on `tree`'s effective dues.
 */
export function statusLines(tasks: readonly TaskRow[], area: string, tree: TaskTree<TaskRow>, status: BarStatus): TaskRow[] {
  const today = utcDay(tree.context.now)
  const order = status === 'done-today' ? newestFirst : (a: TaskRow, b: TaskRow) => tree.byPlanOrder(a, b)
  return tasks.filter(t => t.owner === area && barStatusOf(t, today) === status).sort(order)
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

/** "10-14" or "10-14 18:00": a due or week without its year. */
export function shortDue(due: string): string {
  return due.slice(5)
}

/** `10-13 12:19` from an ISO instant, in UTC as the due labels are. */
export function shortTime(iso: string): string {
  return `${iso.slice(5, 10)} ${iso.slice(11, 16)}`
}

/** Every TaskRow field, kept exhaustive by the compiler, so sameView compares all of them. */
const TASK_FIELDS: { readonly [K in keyof TaskRow]-?: K } = {
  id: 'id',
  title: 'title',
  description: 'description',
  owner: 'owner',
  priority: 'priority',
  priorityName: 'priorityName',
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
function timeLabel(task: TaskRow, tree: TaskTree<TaskRow>): string {
  const now = tree.context.now
  return isActive(task) ? `${metaText(task, tree)} · ${whenWords(task.statusAt, now)}` : String(isFinishedOn(task, utcDay(now)))
}

/**
 * Whether two snapshots draw the same pane: the same fields and tasks, and the same labels at
 * their own `now`. Each write of the snapshot redraws the pane, so one that draws the same is skipped.
 */
export function sameView(a: Snapshot, b: Snapshot): boolean {
  if (a.area !== b.area || a.areaSource !== b.areaSource || a.unreadInbox !== b.unreadInbox || a.problem !== b.problem)
    return false
  if (a.tasks.length !== b.tasks.length) return false
  const [treeA, treeB] = [treeOf(a.tasks, a.now), treeOf(b.tasks, b.now)]
  return a.tasks.every((task, i) => {
    const other = b.tasks[i]
    return (
      other !== undefined &&
      FIELDS.every(field => sameValue(task[field], other[field])) &&
      timeLabel(task, treeA) === timeLabel(other, treeB)
    )
  })
}
