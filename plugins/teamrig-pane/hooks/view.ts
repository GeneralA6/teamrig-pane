// What the pane shows, as plain data: pure functions over the folded tasks, so the drawing in
// register.tsx only lays them out. The order and the due are teamrig's own (hooks/core/read).
import type { BarStatus, Snapshot, TaskRow } from '../types'
import { ACTIVE_STATUSES, byPlanOrder, dueTime } from './core/read/index'
import { barStatusOf, utcDay } from './status-bar'

const DAY_MS = 86_400_000
/**
 * teamrig's `register check` flags an untouched task as NOT-PICKED-UP after the team config's
 * `register.check.notPickedUpAfterHours`; the pane keeps that setting's default, 24 hours.
 */
export const NOT_PICKED_UP_MS = DAY_MS
/** Finished tasks stay listed (dim) this long. */
export const RECENT_MS = DAY_MS
export const MAX_FINISHED = 6
export const MAX_ASKED = 8

/** overdue: past its due; new: the owner has not touched it yet; unseen: still untouched after a day. */
export type Flag = 'overdue' | 'new' | 'unseen'

export type TaskLine = { task: TaskRow; flags: Flag[] }

export type AreaView = {
  area: string
  /** Its tasks waiting for their proof (verifying), in plan order: drawn first, as the ones to close. */
  verifying: TaskLine[]
  /** Its other active tasks in teamrig's plan order: by priority, then due (undated last), then id. */
  active: TaskLine[]
  /** Active tasks it asked of other sessions, newest first, capped at MAX_ASKED. */
  asked: TaskLine[]
  askedTotal: number
  /** Its tasks done or dropped within RECENT_MS, newest first, capped at MAX_FINISHED. */
  finished: TaskRow[]
}

/** An owner's active tasks, the verifying ones first, and how many of them are waiting or verifying. */
export type OwnerGroup = { owner: string; active: TaskLine[]; waiting: number; verifying: number }

export function isActive(task: TaskRow): boolean {
  return ACTIVE_STATUSES.includes(task.status)
}

/** Shipped and waiting for its proof: active until the proof is in. */
export function isVerifying(task: TaskRow): boolean {
  return task.status === 'verifying'
}

/** Waiting for proof first, the ones to close, then teamrig's plan order. */
function proofFirst(a: TaskRow, b: TaskRow): number {
  return Number(isVerifying(b)) - Number(isVerifying(a)) || byPlanOrder(a, b)
}

/** A date-only due means the end of that UTC day; an unreadable one is never overdue (teamrig's dueTime). */
export function flagsOf(task: TaskRow, now: number): Flag[] {
  if (!isActive(task)) return []
  const flags: Flag[] = []
  const due = dueTime(task)
  if (due !== undefined && due < now) flags.push('overdue')
  if (task.ownerSeenAt === null) flags.push(now - Date.parse(task.assignedAt) > NOT_PICKED_UP_MS ? 'unseen' : 'new')
  return flags
}

/** Done or dropped within RECENT_MS, so still listed as finished. */
export function isRecentlyFinished(task: TaskRow, now: number): boolean {
  return !isActive(task) && now - Date.parse(task.updatedAt) <= RECENT_MS
}

function lineOf(now: number) {
  return (task: TaskRow): TaskLine => ({ task, flags: flagsOf(task, now) })
}

function newestFirst(a: TaskRow, b: TaskRow): number {
  return Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
}

export function areaView(tasks: readonly TaskRow[], area: string, now: number): AreaView {
  const own = tasks.filter(t => t.owner === area && isActive(t)).sort(byPlanOrder)
  const asked = tasks.filter(t => t.createdBy === area && t.owner !== area && isActive(t)).sort(newestFirst)
  const finished = tasks
    .filter(t => t.owner === area && isRecentlyFinished(t, now))
    .sort(newestFirst)
  return {
    area,
    verifying: own.filter(isVerifying).map(lineOf(now)),
    active: own.filter(t => !isVerifying(t)).map(lineOf(now)),
    asked: asked.slice(0, MAX_ASKED).map(lineOf(now)),
    askedTotal: asked.length,
    finished: finished.slice(0, MAX_FINISHED),
  }
}

/**
 * The area's own tasks at one status of the status bar (status-bar.ts), as its filter lists them, today
 * the UTC day of `now`: those done today newest first, the others in plan order.
 */
export function statusLines(tasks: readonly TaskRow[], area: string, now: number, status: BarStatus): TaskLine[] {
  const today = utcDay(now)
  const order = status === 'done-today' ? newestFirst : byPlanOrder
  return tasks.filter(t => t.owner === area && barStatusOf(t, today) === status).sort(order).map(lineOf(now))
}

/** Every owner with active tasks, by name, each list waiting for proof first, then in plan order. */
export function ownerGroups(tasks: readonly TaskRow[], now: number): OwnerGroup[] {
  const byOwner = new Map<string, TaskRow[]>()
  for (const task of tasks) {
    if (!isActive(task)) continue
    byOwner.set(task.owner, [...(byOwner.get(task.owner) ?? []), task])
  }
  return [...byOwner.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([owner, list]) => ({
      owner,
      active: [...list].sort(proofFirst).map(lineOf(now)),
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
  owner: 'owner',
  priority: 'priority',
  priorityName: 'priorityName',
  due: 'due',
  status: 'status',
  note: 'note',
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

/** What `now` changes in a drawing of the task: its flags and whether it still lists as finished. */
function timeLabel(task: TaskRow, now: number): string {
  return `${flagsOf(task, now).join(',')}|${isRecentlyFinished(task, now)}`
}

/**
 * Whether two snapshots draw the same pane: the same fields and tasks, and the same labels at
 * their own `now`. Each write of the snapshot redraws the pane, so one that draws the same is skipped.
 */
export function sameView(a: Snapshot, b: Snapshot): boolean {
  if (a.area !== b.area || a.areaSource !== b.areaSource || a.unreadInbox !== b.unreadInbox || a.problem !== b.problem)
    return false
  if (a.tasks.length !== b.tasks.length) return false
  return a.tasks.every((task, i) => {
    const other = b.tasks[i]
    return (
      other !== undefined && FIELDS.every(field => sameValue(task[field], other[field])) && timeLabel(task, a.now) === timeLabel(other, b.now)
    )
  })
}
