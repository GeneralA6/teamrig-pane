// Each session's cards on the owner, as the Team tab counts them and `teamrig meet` asks them (T1297): those the lead
// asks the owner now, and those the owner put off (Later) with when they come back, in teamrig's words. teamrig's
// reader groups them (ownerCardsBySession); this keeps only what the pane draws. Pure: the clock decides when a Later
// card comes back, so a poll recomputes them as time passes with no file change.
import type { LaterOwnerCard, OwnerCard, OwnerSettings, SessionOwnerCards } from '../types'
import { ownerCardsBySession, showStored, TaskTree, type Task, type TimeZone } from './core/read/index'
import { storedDayWords } from './meta'

/** A stored bare day (`2026-11-02`); a stored minute (`2026-11-02 12:00`) is UTC, and Date.parse would read it as local. */
const BARE_DAY = /^\d{4}-\d{2}-\d{2}$/

/** When a Later card comes back, as stored: `Mon 11-02` for a bare day, else teamrig's minute (`11-02 12:00 IDT`). */
export function laterWords(until: string, zone: TimeZone): string {
  return (BARE_DAY.test(until) ? storedDayWords(until) : null) ?? showStored(until, zone)
}

function cardOf(task: Task): OwnerCard {
  return { id: task.id, title: task.title }
}

/** Each session's cards on the owner at `now`, keyed by the session; a session with none is absent. */
export function ownerCardsOf(tasks: ReadonlyMap<string, Task>, now: number, zone: TimeZone, settings: OwnerSettings): Record<string, SessionOwnerCards> {
  const tree = new TaskTree(tasks, new Date(now), zone)
  const bySession: Record<string, SessionOwnerCards> = {}
  for (const [session, { due, later }] of ownerCardsBySession([...tasks.values()], tree, settings.ownerSource, settings.requireDecisionCard)) {
    const laterCards: LaterOwnerCard[] = later.map(({ task, until }) => ({ ...cardOf(task), until: laterWords(until, zone) }))
    bySession[session] = { due: due.map(cardOf), later: laterCards }
  }
  return bySession
}
