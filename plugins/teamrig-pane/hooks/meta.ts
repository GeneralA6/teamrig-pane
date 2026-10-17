// The dim line under a task's title (rows.ts), in plain words: its priority, when it is due, how long it has
// stood at its status and what holds it (a waiting task's reasons, an open one's unfinished `after`), then
// what needs a look (late, new, not picked up). An open task's card (card.ts) shows it in place of this line,
// in the same words. Every date and time is UTC, as teamrig writes them; "today" is the UTC day of the
// snapshot's clock. Pure: the words change with the clock and the other tasks' statuses, so view.ts's sameView
// compares them to know when a poll must redraw.
import type { ThemeKey } from 'claude-code'
import type { TaskRow, TaskStatus } from '../types'
import { ACTIVE_STATUSES, dueTime, priorityText, TaskTree, unfinishedAfter, waitText, type WaitContext } from './core/read/index'
import type { Span } from './rows'
import { utcDay } from './status-bar'

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/**
 * teamrig's `register check` flags an untouched task as NOT-PICKED-UP after the team config's
 * `register.check.notPickedUpAfterHours`; the pane keeps that setting's default, 24 hours.
 */
export const NOT_PICKED_UP_MS = DAY_MS

/** overdue: past its due; new: the owner has not touched it yet; unseen: still untouched after a day. */
export type Flag = 'overdue' | 'new' | 'unseen'

/** How a status reads in a sentence: `in progress since 11:55`. */
export const STATUS_WORDS: Readonly<Record<TaskStatus, string>> = {
  open: 'not started',
  'in-progress': 'in progress',
  verifying: 'verifying',
  waiting: 'waiting',
  done: 'done',
  dropped: 'dropped',
}

/** The statuses whose meta line says since when: the ones someone is acting on or waiting for. */
const SAYS_SINCE: ReadonlySet<TaskStatus> = new Set<TaskStatus>(['in-progress', 'verifying', 'waiting'])

/** A date-only due is due at the end of that UTC day; an unreadable one is never overdue (teamrig's dueTime). */
export function flagsOf(task: TaskRow, now: number): Flag[] {
  if (!ACTIVE_STATUSES.includes(task.status)) return []
  const flags: Flag[] = []
  const due = dueTime(task)
  if (due !== undefined && due < now) flags.push('overdue')
  if (task.ownerSeenAt === null) flags.push(now - Date.parse(task.assignedAt) > NOT_PICKED_UP_MS ? 'unseen' : 'new')
  return flags
}

/** `Tue 10-13`: a UTC day with its weekday. */
export function dayWords(ms: number): string {
  const date = new Date(ms)
  return `${WEEKDAYS[date.getUTCDay()] ?? ''} ${date.toISOString().slice(5, 10)}`
}

/** `11:55` when it happened on the UTC day of `now`, else `Tue 10-13`; an unreadable time as written. */
export function whenWords(iso: string, now: number): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return iso
  return utcDay(ms) === utcDay(now) ? new Date(ms).toISOString().slice(11, 16) : dayWords(ms)
}

/** `today 18:00`, `today`, `Fri 10-17 18:00` or `Fri 10-17`; a due teamrig cannot read, as written less its year. */
export function dueWords(task: TaskRow, now: number): string | null {
  if (task.due === null) return null
  const at = dueTime(task)
  if (at === undefined) return task.due.slice(5)
  const day = utcDay(at) === utcDay(now) ? 'today' : dayWords(at)
  // A bare day is due at its end, so only a due written with a time names one.
  return task.due.trim().length > 10 ? `${day} ${new Date(at).toISOString().slice(11, 16)}` : day
}

/** `due today 18:00`, or `verify by …` while verifying: when the task is due; null with no due. */
export function dueLabel(task: TaskRow, now: number): string | null {
  const due = dueWords(task, now)
  return due === null ? null : `${task.status === 'verifying' ? 'verify by' : 'due'} ${due}`
}

/** `late 1d` while an active task is past its due (flagsOf); null otherwise. */
export function lateWords(task: TaskRow, now: number): string | null {
  const deadline = dueTime(task)
  return deadline !== undefined && flagsOf(task, now).includes('overdue') ? `late ${ageWords(now - deadline)}` : null
}

/**
 * The snapshot's tasks as teamrig's dependency tree reads them at its clock (core register/tree.ts); its `context` is
 * what a waiting task's reasons are judged ready by. The snapshot holds the active tasks and those finished within
 * HELD_DAYS (source.ts), so one it lacks finished earlier and reads finished, as in teamrig.
 */
export function treeOf(tasks: readonly TaskRow[], now: number): TaskTree<TaskRow> {
  return new TaskTree(new Map(tasks.map(task => [task.id, task])), new Date(now))
}

/**
 * Why a waiting task waits: its reasons in teamrig's words (`decision owner`, `on T1 ready`, `until Fri 10-16 14:00`),
 * between commas as the meta line's parts take the dots, then its note after `; `. Null with neither.
 */
export function waitingWords(task: TaskRow, context: WaitContext): string | null {
  const reasons = task.waits.map(reason => waitText(reason, context)).join(', ')
  const words = [reasons, task.note ?? ''].filter(part => part !== '')
  return words.length === 0 ? null : words.join('; ')
}

/** `3h` under a day (one at least), else `2d`. */
export function ageWords(ms: number): string {
  return ms < DAY_MS ? `${Math.max(1, Math.floor(ms / HOUR_MS))}h` : `${Math.floor(ms / DAY_MS)}d`
}

/**
 * The meta line's parts, in order: `on <owner>` when `viewer` (the area whose list it is) does not own it, the
 * priority, `due …` (`verify by …` while verifying), `<status> since …` with why a waiting task waits or what
 * proves a verifying one, `after T5` while a task not yet started has one unfinished, then the flags: `late 1d`,
 * `new` (to its owner), `not picked up 2d`, and `asked by <who>` on a task not yet started that someone else
 * asked for. `tree` (treeOf) holds the clock and marks the ready reasons. `viewer` null (the all view)
 * names no owner.
 */
export function metaParts(task: TaskRow, tree: TaskTree<TaskRow>, viewer: string | null): Span[] {
  const context = tree.context
  const now = context.now
  const others = viewer !== null && task.owner !== viewer
  const parts: Span[] = []
  if (others) parts.push({ text: `on ${task.owner}` })
  parts.push({ text: priorityText(task.priority) })
  const due = dueLabel(task, now)
  if (due !== null) parts.push({ text: due })
  if (SAYS_SINCE.has(task.status)) {
    // Why a waiting task waits, what proves a verifying one; an in-progress note is the card's.
    const why = task.status === 'waiting' ? waitingWords(task, context) : task.status === 'verifying' ? task.note : null
    const color: ThemeKey | undefined = task.status === 'waiting' ? 'error' : undefined
    parts.push({ text: `${STATUS_WORDS[task.status]} since ${whenWords(task.statusAt, now)}${why === null ? '' : `: ${why}`}`, color })
  }
  // A plan dependency holds a task only until it starts, and only while one of its tasks is unfinished.
  const first = task.status === 'open' ? unfinishedAfter(task.after, context) : []
  if (first.length > 0) parts.push({ text: `after ${first.join(', ')}` })
  const late = lateWords(task, now)
  if (late !== null) parts.push({ text: late, color: 'error' })
  const flags = flagsOf(task, now)
  if (flags.includes('new') && !others) parts.push({ text: 'new', color: 'suggestion' })
  if (flags.includes('unseen')) parts.push({ text: `not picked up ${ageWords(now - Date.parse(task.assignedAt))}`, color: 'error' })
  if (task.status === 'open' && task.source !== task.owner && task.source !== viewer) parts.push({ text: `asked by ${task.source}` })
  return parts
}

/** The meta line's words alone, as the snapshot's clock and tasks draw them: what sameView compares. */
export function metaText(task: TaskRow, tree: TaskTree<TaskRow>): string {
  return metaParts(task, tree, null)
    .map(part => part.text)
    .join(' · ')
}
