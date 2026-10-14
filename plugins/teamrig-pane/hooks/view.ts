// What the pane shows, as plain data: pure functions over the folded tasks, so the drawing in
// register.tsx only lays them out. Order and flags follow the register's views.ts/fold.ts.
import type { Snapshot, TaskRow } from '../types'
import { ACTIVE_STATUSES } from './core/model'
import { taskNumber } from './log'

const DAY_MS = 86_400_000
/** The register's `check` flags an untouched task as NOT-PICKED-UP after this. */
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
  /** Its active tasks, by tier, then due, then id. */
  active: TaskLine[]
  /** Active tasks it asked of other sessions, newest first, capped at MAX_ASKED. */
  asked: TaskLine[]
  askedTotal: number
  /** Its tasks done or dropped within RECENT_MS, newest first, capped at MAX_FINISHED. */
  finished: TaskRow[]
}

export type OwnerGroup = { owner: string; active: TaskLine[]; blocked: number }

export function isActive(task: TaskRow): boolean {
  return ACTIVE_STATUSES.includes(task.status)
}

/** A date-only due is due at the end of that UTC day (model.ts dueInstant). */
export function dueInstant(due: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$/.exec(due)
  if (!m) return null
  const [, y, mo, d, hh, mm] = m
  const day = Date.UTC(Number(y), Number(mo) - 1, Number(d))
  if (hh === undefined || mm === undefined) return day + DAY_MS - 1
  return day + (Number(hh) * 60 + Number(mm)) * 60_000
}

function dueTime(task: TaskRow): number {
  return (task.due === null ? null : dueInstant(task.due)) ?? Number.POSITIVE_INFINITY
}

/** Tier first, then the earliest due (undated last), then the oldest id (fold.ts byPlanOrder). */
export function byPlanOrder(a: TaskRow, b: TaskRow): number {
  if (a.tier !== b.tier) return a.tier - b.tier
  const ad = dueTime(a)
  const bd = dueTime(b)
  if (ad !== bd) return ad - bd
  return taskNumber(a) - taskNumber(b)
}

export function flagsOf(task: TaskRow, now: number): Flag[] {
  if (!isActive(task)) return []
  const flags: Flag[] = []
  if (dueTime(task) < now) flags.push('overdue')
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
  const active = tasks.filter(t => t.owner === area && isActive(t)).sort(byPlanOrder)
  const asked = tasks.filter(t => t.createdBy === area && t.owner !== area && isActive(t)).sort(newestFirst)
  const finished = tasks
    .filter(t => t.owner === area && isRecentlyFinished(t, now))
    .sort(newestFirst)
  return {
    area,
    active: active.map(lineOf(now)),
    asked: asked.slice(0, MAX_ASKED).map(lineOf(now)),
    askedTotal: asked.length,
    finished: finished.slice(0, MAX_FINISHED),
  }
}

/** Every owner with active tasks, by name, each list in plan order. */
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
      active: [...list].sort(byPlanOrder).map(lineOf(now)),
      blocked: list.filter(t => t.shown === 'blocked').length,
    }))
}

/** "10-14" or "10-14 18:00" (model.ts shortDate). */
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
  tier: 'tier',
  due: 'due',
  status: 'status',
  shown: 'shown',
  markers: 'markers',
  holds: 'holds',
  pause: 'pause',
  notes: 'notes',
  note: 'note',
  evidence: 'evidence',
  detail: 'detail',
  source: 'source',
  ref: 'ref',
  goals: 'goals',
  createdBy: 'createdBy',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  assignedAt: 'assignedAt',
  ownerSeenAt: 'ownerSeenAt',
  kind: 'kind',
  labels: 'labels',
  start: 'start',
  eta: 'eta',
  dueRevisions: 'dueRevisions',
  etaRevisions: 'etaRevisions',
  startedAt: 'startedAt',
  doneAt: 'doneAt',
  estimate: 'estimate',
  evidenceDue: 'evidenceDue',
  parent: 'parent',
  children: 'children',
  blockedBy: 'blockedBy',
  waits: 'waits',
}
const FIELDS = Object.values(TASK_FIELDS)

type FieldValue = TaskRow[keyof TaskRow]

/** The lists and the note are built anew by each fold, so they compare by value. */
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
