// The finished tasks the pane holds (source.ts: those done or dropped within HELD_DAYS, teamrig's own retention), a
// week at a time: the Done page (done-rows.ts) shows one week, its days newest first, each day's tasks in the done
// groups the owner report and the meeting agenda use (core doneGroups: owner asked, a goal, urgent, the week's plan,
// other work, and the dropped apart). A week is a planning week, starting on the weekday of the week plan in force
// (zone.ts planWeekOf), so a page's week and its plan are the same days; its days are the team zone's. The newest
// week is the one `now` falls in, the oldest the one HELD_DAYS before it: the paging stays inside them, the oldest
// week cut where the pane stops holding. Pure.
import type { Snapshot, TaskRow } from '../types'
import { currentWeek, doneGroups, type DoneGroups } from './core/read/index'
import { dayWords } from './meta'
import { newestFirst } from './view'
import { clockOf, dayOf, planWeekOf, weekAfter, type Clock } from './zone'

/**
 * How many days back the pane holds finished tasks: teamrig's own RETAIN_DAYS (its compaction keeps a task finished
 * within it in the working set), so a rotated register and one never rotated hold the same ones.
 */
export const HELD_DAYS = 8
const DAY_MS = 24 * 60 * 60 * 1000

/** Done or dropped. */
export function isFinished(task: TaskRow): boolean {
  return task.status === 'done' || task.status === 'dropped'
}

/** When the pane stops holding finished tasks: those finished before it are left out. */
export function heldSince(now: number): number {
  return now - HELD_DAYS * DAY_MS
}

/** A finished task the pane holds: finished at `heldSince(now)` or later. */
export function isHeldFinished(task: TaskRow, now: number): boolean {
  return isFinished(task) && Date.parse(task.statusAt) >= heldSince(now)
}

/**
 * A clock with the week plan in force (core currentWeek: the newest week tag started by now), whose weekday the pages'
 * weeks start on; null when no task carries one, and the weeks are Monday's.
 */
export type WeekClock = Clock & { readonly plan: string | null }

/** The snapshot's clock, with the week plan in force among its tasks. */
export function weekClockOf(snap: Pick<Snapshot, 'now' | 'timeZone' | 'tasks'>): WeekClock {
  const clock = clockOf(snap)
  return { ...clock, plan: currentWeek(snap.tasks, new Date(snap.now), clock.zone) }
}

/** The planning week an instant falls in, by the zone's day of it. */
export function weekAt(ms: number, { zone, plan }: WeekClock): string {
  return planWeekOf(dayOf(ms, zone), plan)
}

/** The weeks the pane holds finished tasks in: the newest (`now`'s) and the oldest (HELD_DAYS before it). */
export type HeldWeeks = { newest: string; oldest: string }

export function heldWeeks(clock: WeekClock): HeldWeeks {
  return { newest: weekAt(clock.now, clock), oldest: weekAt(heldSince(clock.now), clock) }
}

/**
 * The planning week holding `week`'s day (a week from before the plan moved, or a Monday one, reads as the week holding
 * it), moved inside the held weeks: one older than the oldest is the oldest, one newer than the newest the newest.
 */
export function heldWeek(week: string, clock: WeekClock): string {
  const { newest, oldest } = heldWeeks(clock)
  const holding = planWeekOf(week, clock.plan)
  return holding > newest ? newest : holding < oldest ? oldest : holding
}

/** A week of the held ones (heldWeek), and the held weeks before and after it, null at either end. */
export type WeekSteps = { week: string; prev: string | null; next: string | null }

export function weekSteps(week: string, clock: WeekClock): WeekSteps {
  const shown = heldWeek(week, clock)
  const { newest, oldest } = heldWeeks(clock)
  return { week: shown, prev: shown > oldest ? weekAfter(shown, -1) : null, next: shown < newest ? weekAfter(shown, 1) : null }
}

/**
 * One day of a week in the team's zone: its date (`2026-10-15`), its words (`Thu 10-15`), whether it is `now`'s day,
 * and its finished tasks in the done groups.
 */
export type DoneDay = { day: string; words: string; today: boolean; groups: DoneGroups<TaskRow> }

/**
 * A week of finished tasks: its days, newest first; how many it holds, done and dropped; the weeks before and after it
 * the pane holds (null at either end); and, for the oldest week, when the pane stops holding (else null).
 */
export type DoneWeek = {
  week: string
  days: DoneDay[]
  done: number
  dropped: number
  prev: string | null
  next: string | null
  heldFrom: number | null
}

/** Whose finished tasks a page lists (null: every owner's), and the register's marker for the owner as a source. */
export type DoneScope = { owner: string | null; ownerMarker: string }

/**
 * The finished tasks of `week` among `tasks`, of `scope`'s owner, as the Done page lists them. A week outside the held
 * ones reads as the nearest held one.
 */
export function doneWeek(tasks: readonly TaskRow[], scope: DoneScope, week: string, clock: WeekClock): DoneWeek {
  const { now, zone } = clock
  const steps = weekSteps(week, clock)
  const shown = steps.week
  const finished = tasks
    .filter(task => isHeldFinished(task, now) && (scope.owner === null || task.owner === scope.owner))
    .filter(task => weekAt(Date.parse(task.statusAt), clock) === shown)
    .sort(newestFirst)
  const days: { day: string; words: string; tasks: TaskRow[] }[] = []
  for (const task of finished) {
    const ms = Date.parse(task.statusAt)
    const day = dayOf(ms, zone)
    const last = days[days.length - 1]
    if (last !== undefined && last.day === day) last.tasks.push(task)
    else days.push({ day, words: dayWords(ms, zone), tasks: [task] })
  }
  const today = dayOf(now, zone)
  const dropped = finished.filter(task => task.status === 'dropped').length
  return {
    week: shown,
    // Each task is one of its day's, so the whole span is the day's.
    days: days.map(({ day, words, tasks: closed }) => ({
      day,
      words,
      today: day === today,
      groups: doneGroups({ tasks: closed, ownerMarker: scope.ownerMarker, zone, from: -Infinity, to: Infinity }),
    })),
    done: finished.length - dropped,
    dropped,
    prev: steps.prev,
    next: steps.next,
    heldFrom: steps.prev === null ? heldSince(now) : null,
  }
}

