// Each session's cards on the owner, as the Teams tab counts them and `teamrig meet` asks them (T1297): those the lead
// asks the owner now, and those the owner put off (Later) with when they come back, in teamrig's words. teamrig's
// reader groups them (ownerCardsBySession); this keeps only what the pane draws, the Later ones soonest back first so
// a session's row names the next. Pure: the clock decides when a Later card comes back, so a poll recomputes them as
// time passes with no file change.
import type { GoalRanks, LaterOwnerCard, OwnerCard, OwnerSettings, SessionOwnerCards, TaskSpend } from '../types'
import { dueTime, ownerCardsBySession, showStored, TaskTree, type LaterCard, type Task, type TimeZone } from './core/read/index'
import { storedDayWords } from './meta'
import { rankingOf } from './ranking'

/** A stored bare day (`2026-11-02`); a stored minute (`2026-11-02 12:00`) is UTC, and Date.parse would read it as local. */
const BARE_DAY = /^\d{4}-\d{2}-\d{2}$/

/** When a Later card comes back, as stored: `Mon 11-02` for a bare day, else teamrig's minute (`11-02 12:00 IDT`). */
export function laterWords(until: string, zone: TimeZone): string {
  return (BARE_DAY.test(until) ? storedDayWords(until) : null) ?? showStored(until, zone)
}

function cardOf(task: Task): OwnerCard {
  return { id: task.id, title: task.title }
}

/** When a Later card comes back, in ms: a stored time wait passes as a stored deadline does (a bare day at its end in `zone`). */
function backAt(card: LaterCard, zone: TimeZone): number {
  return dueTime({ due: card.until }, zone) ?? Number.POSITIVE_INFINITY
}

/**
 * Each session's cards on the owner at `now`, keyed by the session; a session with none is absent. Its due cards keep
 * the register's plan order; its Later ones come soonest back first, plan order among those back at once.
 */
export function ownerCardsOf(tasks: ReadonlyMap<string, Task>, now: number, zone: TimeZone, settings: OwnerSettings, goals: GoalRanks, spend: TaskSpend): Record<string, SessionOwnerCards> {
  const tree = new TaskTree(tasks, new Date(now), zone, undefined, undefined, rankingOf(settings.focus, settings.ownerSource, goals, spend))
  const bySession: Record<string, SessionOwnerCards> = {}
  for (const [session, { due, later }] of ownerCardsBySession([...tasks.values()], tree, settings.ownerSource, settings.requireDecisionCard)) {
    const soonest = [...later].sort((a, b) => backAt(a, zone) - backAt(b, zone))
    const laterCards: LaterOwnerCard[] = soonest.map(({ task, until }) => ({ ...cardOf(task), until: laterWords(until, zone) }))
    bySession[session] = { due: due.map(cardOf), later: laterCards }
  }
  return bySession
}
