// The Teams view's teams and sessions from teamrig's `sessions` document (T4742): every team of the tree, each
// session on one now or retired from it, and the team folders teamrig could not serve, read field by field into plain
// rows. A session comes as teamrig serves it, team by team in the tree's order and each team's sessions in its
// config's order, its retired ones after them. A moment is read as milliseconds; a hire's review day stays the
// `YYYY-MM-DD` text it is served as, a day on no clock. A role or a state a later minor adds is one the pane has no
// drawing for, so it is passed over (the role dropped, the state null) rather than the session left out: who is on
// the team still holds. A team, a session or a failed folder with a field the pane cannot read is left out, and the
// left-out ones are told in one line each kind rather than drawn wrong. What a session asks, since when, its host and
// its conversation are served too and not read until a view draws them. An `unchanged` answer holds no lists, so it
// is never handed here. Pure.
import { Fields, isList, isOneOf, leftOutLine, type BodyRead } from './document-fields'
import { isRecord, type ReadDocument } from './read-document'
import type { Role } from './team'

/** What a session is doing, as far as its tab tells: at work, free, or stopped on something only a person answers. */
export type SessionState = 'busy' | 'idle' | 'asking'

/** A session by its team and id. */
export type SessionPlace = { readonly team: string; readonly session: string }

/** One team of the tree, and how many sessions it holds and has retired. */
export type TeamRow = {
  readonly id: string
  /** The team above it; null for the tree's root. */
  readonly parent: string | null
  readonly active: number
  readonly retired: number
}

/** The model and effort a session starts on, each null when left to the host's default. */
export type SessionLaunch = {
  readonly model: string | null
  readonly effort: string | null
  /** The two in words; null for a team beside or below the asking one. */
  readonly text: string | null
}

/** The hire a session is on its team by. Its `scope` and `reason` are null for a team beside or below the asking one. */
export type SessionHire = {
  readonly at: number
  readonly by: string
  readonly scope: string | null
  readonly reason: string | null
  /** The day the hire is reviewed, `YYYY-MM-DD` (UTC). */
  readonly reviewBy: string
  readonly approvedBy: string | null
  /** The start of the burst it was hired for; null for a hire outside a burst. */
  readonly burst: number | null
}

/** A session's retirement. Its `reason` is null for a team beside or below the asking one. */
export type SessionRetire = {
  readonly at: number
  readonly by: string
  readonly reason: string | null
  /** The session its open tasks went to. */
  readonly heir: string | null
}

/** One session of the tree. A retired one (`active` false) holds only its names and `retire`. */
export type SessionRow = {
  readonly team: string
  readonly id: string
  readonly name: string
  readonly formerNames: readonly string[]
  /** The roles it holds that the pane knows. */
  readonly roles: readonly Role[]
  /** Its direct leader, by id; null for the team's lead and for a retired session. */
  readonly leader: string | null
  /** The leaders above it, nearest first, ending at the team's lead. */
  readonly ledBy: readonly string[]
  /** How many sessions it leads directly. */
  readonly leads: number
  readonly active: boolean
  readonly launch: SessionLaunch | null
  /** Null for a session the team's config named with no hire. */
  readonly hire: SessionHire | null
  /** The retirement a hired session came back from. */
  readonly rehiredFrom: SessionRetire | null
  readonly retire: SessionRetire | null
  /** How many inbox lines it has not read; null when it never read its inbox. */
  readonly unread: number | null
  /** Null with no tab open, a tab file teamrig cannot read, or a state the pane does not know. */
  readonly state: SessionState | null
}

/** A team folder teamrig could not serve the sessions of, and why. */
export type TeamFailure = { readonly team: string; readonly reason: string }

/** What the `sessions` document says of the tree of teams. */
export type SessionsRead = {
  /** The session the asked conversation runs in; null when none was asked, or no session of the tree holds it. */
  readonly self: SessionPlace | null
  readonly teams: readonly TeamRow[]
  readonly sessions: readonly SessionRow[]
  readonly failures: readonly TeamFailure[]
}

const ROLES: Readonly<Record<Role, true>> = { lead: true, deliveryOwner: true, securityReviewer: true }

const STATES: Readonly<Record<SessionState, true>> = { busy: true, idle: true, asking: true }

/** A row read from one entry of a list, with what a problem line calls the entry and the fields that name is made of. */
type Named<Row> = { readonly row: Row; readonly name: string; readonly nameFields: readonly string[] }

type Listed<Row> = { readonly rows: readonly Row[]; readonly problems: readonly string[] }

/**
 * The rows of a served list, in its order, and the one line for the entries left out, each with the first field that
 * could not be read. An entry whose naming field is the unreadable one is called `a <what>`, since the name read is a
 * stand-in.
 */
function listed<Row>(served: readonly unknown[], what: string, read: (entry: Fields) => Named<Row>): Listed<Row> {
  const rows: Row[] = []
  const left: string[] = []
  for (const value of served) {
    if (!isRecord(value)) {
      left.push(`an entry that is no ${what}`)
      continue
    }
    const entry = new Fields(value)
    const { row, name, nameFields } = read(entry)
    const bad = entry.bad
    const [first] = bad
    if (first === undefined) rows.push(row)
    else left.push(`${nameFields.some(field => bad.includes(field)) ? `a ${what}` : name} (${first})`)
  }
  return { rows, problems: left.length === 0 ? [] : [leftOutLine(what, left)] }
}

function teamOf(entry: Fields): Named<TeamRow> {
  const row = { id: entry.text('id'), parent: entry.textOrNull('parent'), active: entry.number('active'), retired: entry.number('retired') }
  return { row, name: row.id, nameFields: ['id'] }
}

function launchOf(launch: Fields): SessionLaunch {
  return { model: launch.textOrNull('model'), effort: launch.textOrNull('effort'), text: launch.textOrNull('text') }
}

function hireOf(hire: Fields): SessionHire {
  return {
    at: hire.moment('at'),
    by: hire.text('by'),
    scope: hire.textOrNull('scope'),
    reason: hire.textOrNull('reason'),
    reviewBy: hire.text('reviewBy'),
    approvedBy: hire.textOrNull('approvedBy'),
    burst: hire.momentOrNull('burst'),
  }
}

function retireOf(retire: Fields): SessionRetire {
  return { at: retire.moment('at'), by: retire.text('by'), reason: retire.textOrNull('reason'), heir: retire.textOrNull('heir') }
}

/** The record in an optional field through its reader; null when teamrig serves none. */
function optionalOf<Part>(part: Fields | null, read: (part: Fields) => Part): Part | null {
  return part === null ? null : read(part)
}

function sessionOf(entry: Fields): Named<SessionRow> {
  const state = entry.textOrNull('state')
  const row = {
    team: entry.text('team'),
    id: entry.text('id'),
    name: entry.text('name'),
    formerNames: entry.texts('formerNames'),
    roles: entry.texts('roles').filter((role): role is Role => isOneOf(ROLES, role)),
    leader: entry.textOrNull('leader'),
    ledBy: entry.texts('ledBy'),
    leads: entry.number('leads'),
    active: entry.flag('active'),
    launch: optionalOf(entry.partOrNull('launch'), launchOf),
    hire: optionalOf(entry.partOrNull('hire'), hireOf),
    rehiredFrom: optionalOf(entry.partOrNull('rehiredFrom'), retireOf),
    retire: optionalOf(entry.partOrNull('retire'), retireOf),
    unread: entry.numberOrNull('unread'),
    state: state !== null && isOneOf(STATES, state) ? state : null,
  }
  return { row, name: `${row.team}/${row.id}`, nameFields: ['team', 'id'] }
}

function failureOf(entry: Fields): Named<TeamFailure> {
  const row = { team: entry.text('team'), reason: entry.text('reason') }
  return { row, name: row.team, nameFields: ['team'] }
}

function unreadable(why: string): BodyRead<SessionsRead> {
  return { kind: 'unreadable', reason: `teamrig's sessions document ${why}: update teamrig` }
}

/**
 * The teams and sessions `document` serves, with the entries left out told in one line each kind; unreadable with a
 * `self` that is no session's place, or without its team, session or failure list, which every `sessions` document
 * of this major holds.
 */
export function sessionsOf(document: ReadDocument): BodyRead<SessionsRead> {
  const head = new Fields(document.fields)
  const self = optionalOf(head.partOrNull('self'), place => ({ team: place.text('team'), session: place.text('session') }))
  const [missing] = head.bad
  if (missing !== undefined) return unreadable(`cannot be read (${missing})`)
  const servedTeams = document.fields['teams']
  if (!isList(servedTeams)) return unreadable('holds no team list')
  const servedSessions = document.fields['sessions']
  if (!isList(servedSessions)) return unreadable('holds no session list')
  const servedFailures = document.fields['failures']
  if (!isList(servedFailures)) return unreadable('holds no failure list')
  const teams = listed(servedTeams, 'team', teamOf)
  const sessions = listed(servedSessions, 'session', sessionOf)
  const failures = listed(servedFailures, 'failure', failureOf)
  return {
    kind: 'read',
    value: { self, teams: teams.rows, sessions: sessions.rows, failures: failures.rows },
    problems: [...teams.problems, ...sessions.problems, ...failures.problems],
  }
}
