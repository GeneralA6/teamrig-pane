// The dim line under a task's title (rows.ts), in plain words: its priority, when it is due (teamrig's effective
// due: an earlier date of a task that needs it, naming that task), how long it has stood at its status and what
// holds it (a waiting task's reasons, an open one's unfinished `after`), whom it holds up (the active tasks of other
// sessions that need it), then what needs a look (late, new, not picked up). An open task's card (card.ts) shows it
// in place of this line, in the same words. Every time is on the team zone's clock, zone-marked (`11:55 IDT`), and
// every day is the zone's, as teamrig prints them (zone.ts); "today" is the zone's day of the snapshot's clock. Pure:
// the words change with the clock and the other tasks' statuses, so view.ts's sameView compares them to know when a
// poll must redraw.
import type { ThemeKey } from 'claude-code'
import type { TaskRow, TaskStatus } from '../types'
import { ACTIVE_STATUSES, priorityText, TaskTree, TimeZone, unfinishedAfter, waitText, type EffectiveDue, type WaitContext } from './core/read/index'
import type { Span } from './rows'
import { dayOf, zoneNamed, type Clock } from './zone'

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

/** overdue: past its due; new: the owner has not touched it yet; unseen: still untouched past the team's hours. */
export type Flag = 'overdue' | 'new' | 'unseen'

/** What treeOf reads from a snapshot (types/index.d.ts Snapshot): its tasks, its clock, the team's NOT PICKED UP hours and zone. */
export type TreeSource = {
  readonly tasks: readonly TaskRow[]
  readonly now: number
  readonly notPickedUpAfterHours: number
  readonly timeZone: string
}

/**
 * teamrig's dependency tree of the snapshot's tasks at its clock in the team's zone (core register/tree.ts), with how
 * long a task may stand untouched by its owner before teamrig's `register check` flags it NOT-PICKED-UP: the team
 * config's `register.check.notPickedUpAfterHours`.
 */
export class PaneTree extends TaskTree<TaskRow> {
  readonly notPickedUpMs: number

  constructor(tasks: ReadonlyMap<string, TaskRow>, now: Date, zone: TimeZone, notPickedUpAfterHours: number) {
    super(tasks, now, zone)
    this.notPickedUpMs = notPickedUpAfterHours * HOUR_MS
  }
}

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

/**
 * At `tree`'s clock, an active task past its effective due (teamrig's, core register/tree.ts: its own, or an earlier
 * one of an active task that needs it), a date-only due at the end of that day in the team's zone, an unreadable one
 * never.
 */
function isOverdue(task: TaskRow, tree: TaskTree<TaskRow>): boolean {
  const due = tree.dueTime(task)
  return ACTIVE_STATUSES.includes(task.status) && due !== undefined && due < tree.context.now
}

/**
 * An active task's flags at `tree`'s clock: overdue (isOverdue), then, while its owner has not touched it, new, or
 * unseen once it has stood so past the team's hours, as teamrig's NOT-PICKED-UP reads it.
 */
export function flagsOf(task: TaskRow, tree: PaneTree): Flag[] {
  if (!ACTIVE_STATUSES.includes(task.status)) return []
  const flags: Flag[] = []
  if (isOverdue(task, tree)) flags.push('overdue')
  if (task.ownerSeenAt === null) flags.push(tree.context.now - Date.parse(task.assignedAt) > tree.notPickedUpMs ? 'unseen' : 'new')
  return flags
}

/** `Tue 10-13`: the zone's day of an instant, with its weekday. */
export function dayWords(ms: number, zone: TimeZone): string {
  const date = new Date(ms)
  return `${zone.weekday(date)} ${zone.day(date).slice(5)}`
}

/**
 * `Mon 10-12`: a stored day (a task's `week`, the Archive's week: `YYYY-MM-DD`, a day of the team's zone as written)
 * with its weekday; null when it cannot be read. A calendar day, not an instant: its UTC midnight is that day in UTC.
 */
export function storedDayWords(day: string): string | null {
  const ms = Date.parse(day)
  return Number.isNaN(ms) ? null : dayWords(ms, TimeZone.UTC)
}

/** `14:02 IDT`: an instant's time on the zone's clock, zone-marked as teamrig prints one; an unreadable time as written. */
export function clockWords(iso: string, zone: TimeZone): string {
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? iso : zone.clock(new Date(ms))
}

/** `11:55 IDT` when it happened on the zone's day of the clock's `now`, else `Tue 10-13`; an unreadable time as written. */
export function whenWords(iso: string, { now, zone }: Clock): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return iso
  return dayOf(ms, zone) === dayOf(now, zone) ? zone.clock(new Date(ms)) : dayWords(ms, zone)
}

/** The date the task works to, teamrig's effective due; a task the tree lacks keeps its own, as the tree's dueTime does. */
function effectiveDueOf(task: TaskRow, tree: TaskTree<TaskRow>): EffectiveDue | undefined {
  if (tree.task(task.id) !== undefined) return tree.effectiveDue(task.id)
  const at = tree.dueTime(task)
  return task.due === null || at === undefined ? undefined : { due: task.due, at, from: null }
}

/**
 * `today 18:00 IDT`, `today`, `Fri 10-17 18:00 IDT` or `Fri 10-17`: a due at the clock's `now`, on the zone's
 * calendar and clock, its time only when written with one.
 */
function dateWords(due: EffectiveDue, { now, zone }: Clock): string {
  const day = dayOf(due.at, zone) === dayOf(now, zone) ? 'today' : dayWords(due.at, zone)
  // A bare day is due at its end there, so only a due written with a time names one.
  return due.due.trim().length > 10 ? `${day} ${zone.clock(new Date(due.at))}` : day
}

/**
 * The effective due at `tree`'s clock in dateWords' words, then `(from T7)` when it is the date of T7, a task that
 * needs this one; a due teamrig cannot read, as written less its year.
 */
export function dueWords(task: TaskRow, tree: TaskTree<TaskRow>): string | null {
  const due = effectiveDueOf(task, tree)
  if (due === undefined) return task.due === null ? null : task.due.slice(5)
  const words = dateWords(due, tree.context)
  return due.from === null ? words : `${words} (from ${due.from})`
}

/** `T7 (beta, due Thu 10-22)`: a task that needs another, its owner, and its effective due when it has one. */
function neederWords(needer: TaskRow, tree: TaskTree<TaskRow>, withDue = true): string {
  const due = withDue ? tree.effectiveDue(needer.id) : undefined
  const facts = due === undefined ? [needer.owner] : [needer.owner, `due ${dateWords(due, tree.context)}`]
  return `${needer.id} (${facts.join(', ')})`
}

/**
 * `needed by T7 (beta, due Thu 10-22) +1`, as teamrig's rows say whom an active task holds up beyond its owner
 * (core register/tree.ts neededByOthers): the active task of another owner that needs it with the earliest effective
 * due, that task's owner and due, and how many more. The due is left out when the task's own due label already names
 * where it comes from (`due Thu 10-22 (from T7)`). Null when no other owner's task needs it.
 */
export function neededByWords(task: TaskRow, tree: TaskTree<TaskRow>): string | null {
  const [first, ...rest] = tree.neededByOthers(task.id)
  if (first === undefined) return null
  const due = tree.effectiveDue(first.id)
  const shown = due !== undefined && tree.effectiveDue(task.id)?.from === (due.from ?? first.id)
  return `needed by ${neederWords(first, tree, !shown)}${rest.length > 0 ? ` +${rest.length}` : ''}`
}

/** Each active task of another owner that needs it, the earliest effective due first, in neederWords' words. */
export function neededByLines(task: TaskRow, tree: TaskTree<TaskRow>): string[] {
  return tree.neededByOthers(task.id).map(needer => neederWords(needer, tree))
}

/**
 * `due today 18:00`, or `verify by …` while verifying: when the task is due, the effective due as dueWords says it,
 * as teamrig's VERIFY-OVERDUE reads it; null with no due.
 */
export function dueLabel(task: TaskRow, tree: TaskTree<TaskRow>): string | null {
  const due = dueWords(task, tree)
  return due === null ? null : `${task.status === 'verifying' ? 'verify by' : 'due'} ${due}`
}

/** `late 1d` while an active task is past its effective due (isOverdue); null otherwise. */
export function lateWords(task: TaskRow, tree: TaskTree<TaskRow>): string | null {
  const deadline = tree.dueTime(task)
  return deadline !== undefined && isOverdue(task, tree) ? `late ${ageWords(tree.context.now - deadline)}` : null
}

/**
 * The snapshot's tasks as teamrig's dependency tree reads them at its clock (core register/tree.ts), with the team's
 * NOT PICKED UP hours; its `context` is what a waiting task's reasons are judged ready by. The snapshot holds the
 * active tasks and those finished within HELD_DAYS (source.ts), so one it lacks finished earlier and reads finished,
 * as in teamrig.
 */
export function treeOf(snap: TreeSource): PaneTree {
  return new PaneTree(new Map(snap.tasks.map(task => [task.id, task])), new Date(snap.now), zoneNamed(snap.timeZone), snap.notPickedUpAfterHours)
}

/**
 * Why a waiting task waits: its reasons in teamrig's words (`decision owner`, `on T1 ready`,
 * `until Fri 10-16 14:00 IDT`, a time in the context's zone), between commas as the meta line's parts take the dots,
 * then its note after `; `. Null with neither.
 */
export function waitingWords(task: TaskRow, context: WaitContext): string | null {
  const reasons = task.waits.map(reason => waitText(reason, context.zone, context)).join(', ')
  const words = [reasons, task.note ?? ''].filter(part => part !== '')
  return words.length === 0 ? null : words.join('; ')
}

/** `3h` under a day (one at least), else `2d`. */
export function ageWords(ms: number): string {
  return ms < DAY_MS ? `${Math.max(1, Math.floor(ms / HOUR_MS))}h` : `${Math.floor(ms / DAY_MS)}d`
}

/**
 * The meta line's parts, in order: `on <owner>` when `viewer` (the area whose list it is) does not own it, the
 * priority, `due …` (`verify by …` while verifying; `(from T7)` on a date taken from T7), `<status> since …` with
 * why a waiting task waits or what proves a verifying one, `after T5` while a task not yet started has one
 * unfinished, `needed by T7 (beta)` while a task of another owner needs it (neededByWords), then the flags: `late 1d`,
 * `new` (to its owner), `not picked up 2d`, and `asked by <who>` on a task not yet started that someone else
 * asked for. `tree` (treeOf) holds the clock and marks the ready reasons. `viewer` null (the all view)
 * names no owner.
 */
export function metaParts(task: TaskRow, tree: PaneTree, viewer: string | null): Span[] {
  const context = tree.context
  const now = context.now
  const others = viewer !== null && task.owner !== viewer
  const parts: Span[] = []
  if (others) parts.push({ text: `on ${task.owner}` })
  parts.push({ text: priorityText(task.priority) })
  const due = dueLabel(task, tree)
  if (due !== null) parts.push({ text: due })
  if (SAYS_SINCE.has(task.status)) {
    // Why a waiting task waits, what proves a verifying one; an in-progress note is the card's.
    const why = task.status === 'waiting' ? waitingWords(task, context) : task.status === 'verifying' ? task.note : null
    const color: ThemeKey | undefined = task.status === 'waiting' ? 'error' : undefined
    parts.push({ text: `${STATUS_WORDS[task.status]} since ${whenWords(task.statusAt, context)}${why === null ? '' : `: ${why}`}`, color })
  }
  // A plan dependency holds a task only until it starts, and only while one of its tasks is unfinished.
  const first = task.status === 'open' ? unfinishedAfter(task.after, context) : []
  if (first.length > 0) parts.push({ text: `after ${first.join(', ')}` })
  const neededBy = neededByWords(task, tree)
  if (neededBy !== null) parts.push({ text: neededBy })
  const late = lateWords(task, tree)
  if (late !== null) parts.push({ text: late, color: 'error' })
  const flags = flagsOf(task, tree)
  if (flags.includes('new') && !others) parts.push({ text: 'new', color: 'suggestion' })
  if (flags.includes('unseen')) parts.push({ text: `not picked up ${ageWords(now - Date.parse(task.assignedAt))}`, color: 'error' })
  if (task.status === 'open' && task.source !== task.owner && task.source !== viewer) parts.push({ text: `asked by ${task.source}` })
  return parts
}

/** The meta line's words alone, as the snapshot's clock and tasks draw them: what sameView compares. */
export function metaText(task: TaskRow, tree: PaneTree): string {
  return metaParts(task, tree, null)
    .map(part => part.text)
    .join(' · ')
}
