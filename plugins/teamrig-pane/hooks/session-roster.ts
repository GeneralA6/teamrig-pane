// One team's sessions out of teamrig's `sessions` document (hooks/sessions-document.ts), for what the pane asked the
// team's config and rename log before (T4742): who leads whom (the card's Lead row), the name a session goes by, and
// the session a `/teamrig-pane <session>` word names, found as teamrig's own commands find one (core Roster.lookup):
// by its id, its current name, or a former name whose session is still on the team. A retired session is on no team:
// it leads no one, has no name to message, and its names only say whose they were. Nothing here reads a file: with no
// sessions document read yet a word is refused with that reason. Pure.
import type { TeamLeads } from '../types'
import { USAGE } from './command'
import { SESSION_NAME } from './core/read/index'
import type { SessionRow, SessionsRead } from './sessions-document'

/** The session's id, or the answer the command gives instead: why no session was pinned. */
export type SessionFound = { ok: true; id: string } | { ok: false; problem: string }

/** The sessions on `team` now, in the order teamrig serves them: its config's. */
function activeOn(read: SessionsRead, team: string): SessionRow[] {
  return read.sessions.filter(session => session.team === team && session.active)
}

/**
 * Who leads `team`'s sessions: its lead is the one session served with no leader, and each other session answers to
 * the leader served for it, in the served order (hooks/leads.ts teamSessions lists them by it). A second session
 * served with no leader answers to the lead, as an owner off the lead tree does (leadOf). Null for a team the
 * document holds no lead of.
 */
export function leadsOf(read: SessionsRead, team: string): TeamLeads | null {
  const active = activeOn(read, team)
  const lead = active.find(session => session.leader === null)
  if (lead === undefined) return null
  const leaderOf: Record<string, string> = {}
  for (const session of active) {
    if (session !== lead) leaderOf[session.id] = session.leader ?? lead.id
  }
  return { lead: lead.id, leaderOf }
}

/** The name to message `team`'s session `id` by; null for an id not on the team now. */
export function nameOf(read: SessionsRead, team: string, id: string): string | null {
  return activeOn(read, team).find(session => session.id === id)?.name ?? null
}

/** The word as the id itself, when it can be one. */
function asId(word: string): SessionFound {
  return SESSION_NAME.test(word) ? { ok: true, id: word } : { ok: false, problem: `Not pinned: "${word}" is not a session id. ${USAGE}` }
}

/**
 * The session of `team` that `word` names: an id, then a current name, then a former name whose session is still on
 * the team; a current name wins over a former one. Refused, each with the team's sessions listed: a current name two
 * sessions share, a name of a session no longer on the team, and a word that names none. With no team, or a team the
 * document does not hold (one with no config yet), the word is taken as the id itself. Refused too with no document
 * read yet (`read` null) and for a team whose folder teamrig could not serve, with its reason.
 */
export function lookupSession(word: string, team: string | null, read: SessionsRead | null): SessionFound {
  if (team === null) return asId(word)
  if (read === null) return { ok: false, problem: `Not pinned: team ${team}'s sessions are not read yet.` }
  const failure = read.failures.find(failed => failed.team === team)
  if (failure !== undefined) return { ok: false, problem: `Not pinned: team ${team} cannot be read (${failure.reason}).` }
  if (!read.teams.some(served => served.id === team)) return asId(word)
  const refused = (error: string): SessionFound => ({ ok: false, problem: `Not pinned (team ${team}): ${error}.` })
  const active = activeOn(read, team)
  if (active.some(session => session.id === word)) return { ok: true, id: word }
  const called = active.filter(session => session.name === word)
  const [first, second] = called
  if (first !== undefined && second === undefined) return { ok: true, id: first.id }
  if (first !== undefined) return refused(`${word} is the name of ${called.length} sessions (${called.map(session => session.id).join(', ')}); use the id`)
  const before = active.find(session => session.formerNames.includes(word))
  if (before !== undefined) return { ok: true, id: before.id }
  const sessions = active.map(session => `${session.id} (${session.name})`).join(', ')
  const gone = read.sessions.find(session => session.team === team && !session.active && (session.name === word || session.formerNames.includes(word)))
  if (gone !== undefined) return refused(`${word} was the name of ${gone.id}, which is no longer on this team (sessions: ${sessions})`)
  return refused(`${word} is not a session on this team (sessions: ${sessions})`)
}
