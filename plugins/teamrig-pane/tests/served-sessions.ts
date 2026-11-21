// The `sessions` document's body as teamrig serves it (interface 1.0), built from teams' files as teamrig's readers
// hand them over, for the specs of the Teams tab's model and the fake teamrig (fake-read.ts): the teams of the tree
// that holds the asking team, the root first, then each team's children by id, depth first; under each its sessions
// in its config's order, then the ones it retired. As teamrig does, a team beside or below the asking one is served
// without its own words (a launch in words, a hire's scope and reason, a retirement's reason), and a retired session
// holds only its names and its retirement. What it does not serve as teamrig does: no session has a state, an ask, a
// host or a conversation, and no text is cut.
import {
  activeHires,
  describeLaunch,
  launchOf,
  LeadTree,
  rehiredFrom,
  retiredSessions,
  Roster,
  TeamTree,
  teamNodeOf,
  type HireRecord,
  type HiringRecord,
  type KitConfig,
  type Rename,
  type RetireRecord,
} from '../hooks/core/read/index'
import type { JsonRecord } from '../hooks/read-document'
import type { SessionPlace } from '../hooks/sessions-document'

/** One team's files as read: its config, its rename and hire logs, and its sessions' unread inbox lines. */
export type TeamSessions = {
  readonly team: string
  readonly config: KitConfig
  readonly renames: readonly Rename[]
  readonly hires: readonly HiringRecord[]
  /** Each session's unread lines, by id, for those that ever marked their inbox read; null for none. */
  readonly unread: ReadonlyMap<string, number> | null
}

type Part = { readonly read: TeamSessions; readonly roster: Roster; readonly retired: readonly RetireRecord[] }

/** The team with its roster over every session ever on it: a retired one keeps the name it left with. */
function partOf(read: TeamSessions): Part {
  const { team, config, renames, hires } = read
  const retired = retiredSessions(hires).filter(retire => !config.sessions.includes(retire.session))
  const roster = new Roster({ ...config, sessions: [...config.sessions, ...retired.map(retire => retire.session)] }, team, renames)
  return { read, roster, retired }
}

function isoOf(at: number): string {
  return new Date(at).toISOString()
}

function servedHire(hire: HireRecord, words: boolean): JsonRecord {
  return {
    at: isoOf(hire.at),
    by: hire.by,
    scope: words ? hire.scope : null,
    reason: words ? hire.reason : null,
    reviewBy: hire.reviewBy,
    approvedBy: hire.approvedBy ?? null,
    burst: hire.burst === undefined ? null : isoOf(hire.burst),
  }
}

function servedRetire(retire: RetireRecord, words: boolean): JsonRecord {
  return { at: isoOf(retire.at), by: retire.by, reason: words ? retire.reason : null, heir: retire.heir ?? null }
}

/** What no session of this document has: a tab's state and ask, a host and a conversation. */
const NO_TAB = { state: null, ask: null, since: null, host: null, conversation: null } as const

/** One team's sessions, `words` saying whether its own words are served. */
function servedTeam({ read, roster, retired }: Part, words: boolean): JsonRecord[] {
  const { team, config, hires } = read
  const leads = new LeadTree(config)
  const hired = new Map(activeHires(hires).map(hire => [hire.session, hire]))
  const members = config.sessions.map((id): JsonRecord => {
    const launch = launchOf(config, id)
    const hire = hired.get(id)
    const before = rehiredFrom(hires, id)
    return {
      team,
      id,
      name: roster.nameOf(id) ?? id,
      formerNames: roster.formerNamesOf(id),
      roles: roster.rolesOf(id),
      leader: leads.leaderOf(id) ?? null,
      ledBy: leads.chainOf(id),
      leads: leads.membersOf(id).length,
      active: true,
      launch: { model: launch.model ?? null, effort: launch.effort ?? null, text: words ? describeLaunch(launch) : null },
      hire: hire === undefined ? null : servedHire(hire, words),
      rehiredFrom: before === undefined ? null : servedRetire(before, words),
      retire: null,
      unread: read.unread?.get(id) ?? null,
      ...NO_TAB,
    }
  })
  const gone = retired.map(
    (retire): JsonRecord => ({
      team,
      id: retire.session,
      name: roster.nameOf(retire.session) ?? retire.session,
      formerNames: roster.formerNamesOf(retire.session),
      roles: [],
      leader: null,
      ledBy: [],
      leads: 0,
      active: false,
      launch: null,
      hire: null,
      rehiredFrom: null,
      retire: servedRetire(retire, words),
      unread: null,
      ...NO_TAB,
    }),
  )
  return [...members, ...gone]
}

/**
 * The `sessions` document's fields for an asker of team `own`, whose conversation runs in `self`: the tree of `reads`
 * that holds `own`; another root team's tree is another project and is left out. With no read of `own` it serves no
 * team.
 */
export function servedSessions(reads: readonly TeamSessions[], own: string, self: SessionPlace | null): JsonRecord {
  const parts = new Map(reads.map(read => [read.team, partOf(read)]))
  const tree = new TeamTree([...parts.values()].map(({ read, roster }) => teamNodeOf(read.team, read.config, roster)))
  const above = tree.ancestorsOf(own)
  const walked = parts.has(own) ? tree.walk(tree.rootOf(own) ?? own).flatMap(step => parts.get(step.team) ?? []) : []
  return {
    self,
    teams: walked.map(({ read, retired }) => ({
      id: read.team,
      parent: read.config.team?.parent ?? null,
      active: read.config.sessions.length,
      retired: retired.length,
    })),
    sessions: walked.flatMap(part => servedTeam(part, part.read.team === own || above.includes(part.read.team))),
    failures: [],
  }
}
