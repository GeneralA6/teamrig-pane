// What each session worked, from the register's events: a status change or an update that a task's owner wrote on
// its own task marks that the owner worked it then. A create never marks (an ask handed to an owner is no work of
// theirs yet), nor does an event by anyone but the owner. The owner is followed through the handoffs as the events
// run, so an update that hands a task on still marks for the owner who wrote it. The Log view (log-rows.ts) titles
// each conversation by the tasks its session marked during it. Pure.
import type { WorkMark } from '../types'
import type { RegisterEvent } from './core/read/index'

/** The marks at `since` (ms) or after, oldest first, from the events in the order the register keeps them. */
export function workMarks(events: readonly RegisterEvent[], since: number): WorkMark[] {
  const owners = new Map<string, string>()
  const marks: WorkMark[] = []
  for (const event of events) {
    if (event.type === 'create') {
      owners.set(event.id, event.task.owner)
      continue
    }
    const at = Date.parse(event.at)
    if (owners.get(event.id) === event.by && at >= since) marks.push({ session: event.by, task: event.id, at })
    if (event.type === 'update' && event.changes.owner !== undefined) owners.set(event.id, event.changes.owner)
  }
  return marks.sort((a, b) => a.at - b.at)
}
