// The team's time zone as the pane draws in it (teamrig's core/zone.ts): the snapshot keeps its IANA name, since
// $.state holds plain data and a TimeZone holds formatters, and a drawing reads the TimeZone back by that name. A
// stored instant is UTC; the pane prints it on the zone's clock, zone-marked (`14:02 IDT`), and "today" is the
// zone's day of the snapshot's clock, as in teamrig. A week starts Monday 00:00 in the zone and is named by that
// Monday's date (`2026-10-12`); a planning week starts on the weekday of the week plan in force, as the register's
// `week` fields name it (planWeekOf). Pure.
import type { Snapshot } from '../types'
import { TimeZone } from './core/read/index'

const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_DAYS = 7

/** The instant a drawing is at and the zone it prints in: a tree's WaitContext is one. */
export type Clock = { readonly now: number; readonly zone: TimeZone }

/** One TimeZone per name, made on first use: the names are the few the team configs set, and each holds its formatters. */
const zones = new Map<string, TimeZone>()

/**
 * The zone of an IANA name; one the system does not know reads as UTC. Places resolve the name (TimeZone.resolve),
 * so a snapshot's is known unless the system's zone data changed since.
 */
export function zoneNamed(name: string): TimeZone {
  const kept = zones.get(name)
  if (kept !== undefined) return kept
  const zone = TimeZone.of(name) ?? TimeZone.UTC
  zones.set(name, zone)
  return zone
}

/**
 * The machine's zone as a teamrig the session runs reads it: the session's `TZ` when it names a zone (node takes its
 * zone from it), else `system`, the zone the system resolves (`Intl.DateTimeFormat().resolvedOptions().timeZone`).
 */
export function machineZoneOf(tz: string | undefined, system: string): string {
  return (tz === undefined ? undefined : TimeZone.of(tz))?.name ?? system
}

/** The snapshot's clock: when it was built, in the team's zone. */
export function clockOf(snap: Pick<Snapshot, 'now' | 'timeZone'>): Clock {
  return { now: snap.now, zone: zoneNamed(snap.timeZone) }
}

/** `2026-10-15`: the zone's day of an instant, the day the pane's "today", due and time labels are in. */
export function dayOf(ms: number, zone: TimeZone): string {
  return zone.day(new Date(ms))
}

/** `21:04 IDT` on the zone's day of the clock's `now`, else `Mon 10-19 21:04 IDT`: an instant as a list of the day's lines prints it. */
export function momentWords(ms: number, { now, zone }: Clock): string {
  const date = new Date(ms)
  return dayOf(ms, zone) === dayOf(now, zone) ? zone.clock(date) : zone.weekdayMinute(date)
}

/**
 * The `YYYY-MM-DD` Monday of the week `ms` falls in, on the zone's calendar: the zone's day of `ms`, then back to its
 * Monday by calendar days (a day's UTC midnight stands for the day itself).
 */
export function weekOf(ms: number, zone: TimeZone): string {
  const day = Date.parse(dayOf(ms, zone))
  const sinceMonday = (new Date(day).getUTCDay() + WEEK_DAYS - 1) % WEEK_DAYS
  return new Date(day - sinceMonday * DAY_MS).toISOString().slice(0, 10)
}

/** The week `weeks` weeks after `week` (before it when negative). */
export function weekAfter(week: string, weeks: number): string {
  return new Date(Date.parse(week) + weeks * WEEK_DAYS * DAY_MS).toISOString().slice(0, 10)
}

/**
 * The `YYYY-MM-DD` start of the planning week holding `day` (`YYYY-MM-DD`): `plan`, the week plan in force (core
 * currentWeek), moved by whole weeks, so every week starts on its weekday as `teamrig plan` counts weeks; with no
 * plan, the day's Monday week.
 */
export function planWeekOf(day: string, plan: string | null): string {
  if (plan === null) return weekOf(Date.parse(day), TimeZone.UTC)
  return weekAfter(plan, Math.floor((Date.parse(day) - Date.parse(plan)) / (WEEK_DAYS * DAY_MS)))
}
