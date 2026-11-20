// The Teams tab's model (T780): the tree of teams that holds the pane's own team, each team with its lead on top and
// every session ever on its roster under it, active or retired. Who is on which team, under which leader, on what
// launch, hire and retire is teamrig's `sessions` document (T4742), drawn as served and never worked out here from a
// team's files, so the tab shows the team as teamrig's commands find it. The pane's own register adds each session's
// tasks and cards, numbers and ids only. Each team's week (T1713) is its own week file's and its child teams', summed
// while they share one reset. Pure: the source holds the document and reads the weeks, this turns them into nodes,
// teamRows into the rows a drawing shows.
import type { SessionOwnerCards, SessionTaskCounts, TaskCounts, TaskRow } from '../types'
import type { HiringRecord, KitConfig, Rename, Roster, TeamWeekSummary } from './core/read/index'
import type { SessionHire, SessionLaunch, SessionRetire, SessionRow, SessionsRead, TeamRow as ServedTeam } from './sessions-document'

/** One team's files as read: its id (its folder name), its config, its rename log, its hire log and its week file. */
export type TeamRead = {
  readonly team: string
  readonly config: KitConfig
  readonly renames: readonly Rename[]
  readonly hires: readonly HiringRecord[]
  /** Its own week as teamrig's budget hooks last wrote it (team.week.json), its child teams' apart; null for none or one teamrig cannot read. */
  readonly week: TeamWeekSummary | null
  /** The team's register tasks, for each session's current tasks; null when the pane does not read that register. */
  readonly tasks: readonly TaskRow[] | null
  /**
   * Each session's unread inbox lines, by id, for those that ever marked their inbox read; null when the pane does
   * not read the team's inbox (a peer team's).
   */
  readonly unread: ReadonlyMap<string, number> | null
  /**
   * Each session's cards on the owner, by id (Snapshot.ownerCards), a session with none absent; null when the pane
   * does not read the team's register (a peer team's).
   */
  readonly ownerCards: Readonly<Record<string, SessionOwnerCards>> | null
  /**
   * Each session's tasks counted (Snapshot.taskCounts), a session with none absent; null when the pane does not read
   * the team's register (a peer team's).
   */
  readonly taskCounts: TaskCounts | null
}

/** A role a team config gives a session (`roles`), as teamrig's Roster names it. */
export type Role = ReturnType<Roster['rolesOf']>[number]

/** A task a session has in progress. */
export type CurrentTask = { readonly id: string; readonly title: string }

/** A session's tasks counted, and whether a compaction archived its team's tasks finished long ago, which they miss. */
export type SessionTasks = SessionTaskCounts & { readonly archived: boolean }

export type TeamFacts = {
  readonly team: string
  /** The parent team the config names (`team.parent`); null for a root. */
  readonly parent: string | null
  /** The sessions on the team now: the config's `sessions`. */
  readonly active: number
  /** The sessions retired and no longer on the team. */
  readonly retired: number
  /** Its week with its child teams', in percent of the account's week; null when none of them has a week file for this week. */
  readonly week: TeamWeek | null
}

/** A team's week with its child teams': used and planned to the week's end, in percent of the account's week (hundredths), and how far the week is, in whole percent. */
export type TeamWeek = { readonly usedPct: number; readonly plannedPct: number; readonly elapsedPct: number }

/** The account's week, from its reset to the next. */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** A percent to hundredths, as the week file keeps it, so a sum reads as its parts do. */
function hundredths(pct: number): number {
  return Math.round(pct * 100) / 100
}

/**
 * Whether `file` counts in `first`'s week: it is on the same reset and the two name no two accounts. The account alone
 * will not do: a reset can move inside a week, so on one account another reset is an idle team's stale week, and adding
 * it mixes two weeks. A format 1 file names no account, so the reset is all it has.
 */
function inWeekOf(first: TeamWeekSummary, file: TeamWeekSummary): boolean {
  if (file.resetsAt !== first.resetsAt) return false
  return first.account === undefined || file.account === undefined || file.account === first.account
}

/**
 * The week of a team and its child teams from their week files, the team's first: those for the week still running at
 * `now` that count in the first one's week (`inWeekOf`), summed. Any other file is left out, one from a week gone by
 * too. Null when no file is left. How far the week is goes in whole percent, so the tree changes about every 1.7 hours,
 * not at every read. The Stats tab's week tile (stats-source.ts) sums its scope's teams with it too.
 */
export function weekOf(weeks: readonly TeamWeekSummary[], now: number): TeamWeek | null {
  const running = weeks.filter(week => week.resetsAt > now)
  const first = running[0]
  if (first === undefined) return null
  const same = running.filter(week => inWeekOf(first, week))
  const elapsed = Math.min(1, Math.max(0, (now - (first.resetsAt - WEEK_MS)) / WEEK_MS))
  return {
    usedPct: hundredths(same.reduce((sum, week) => sum + week.usedPct, 0)),
    plannedPct: hundredths(same.reduce((sum, week) => sum + week.plannedPct, 0)),
    elapsedPct: Math.round(elapsed * 100),
  }
}

export type SessionFacts = {
  readonly team: string
  readonly id: string
  /** The name it runs under now; for a retired session, the last name it held. */
  readonly name: string
  /** On the team's config now; false for a retired session no longer on it. */
  readonly active: boolean
  readonly roles: readonly Role[]
  /** How many sessions it leads directly, as the lead or a sub-lead; 0 when it leads none. */
  readonly leads: number
  /** The leaders over it, nearest first, ending at the lead; none for the lead and a retired session. */
  readonly ledBy: readonly string[]
  /**
   * The model and effort teamrig launches it on, and the two in teamrig's words (null for a team beside or below the
   * pane's own); null for a retired session, which teamrig no longer launches.
   */
  readonly launch: SessionLaunch | null
  /** Its newest hire, for a hired session; null for one the team was set up with. */
  readonly hire: SessionHire | null
  /** The retire a rehired session came back from; null for a first hire and a session never hired. */
  readonly rehiredFrom: SessionRetire | null
  /** Its retire, for a retired session; null for an active one. */
  readonly retire: SessionRetire | null
  /** Its tasks in progress, in the register's order; none for a retired session, null when the pane does not read its team's register. */
  readonly now: readonly CurrentTask[] | null
  /** Its tasks counted, zeros for one that owns none; null for a retired session and when the pane does not read its team's register. */
  readonly tasks: SessionTasks | null
  /** Its unread inbox lines as teamrig serves them; null for a retired session and one that never marked its inbox read. */
  readonly unread: number | null
  /** Its cards on the owner, due now and put off; none for a retired session, null when the pane does not read its team's register. */
  readonly decisions: SessionOwnerCards | null
}

/** The cards of a session with none on the owner. */
const NO_CARDS: SessionOwnerCards = { due: [], later: [] }

/** The counts of a session that owns no task. */
const NO_TASKS: SessionTaskCounts = { done: 0, verifying: 0, total: 0 }

type NodeBase = { readonly key: string; readonly children: readonly TeamTreeNode[] }

/**
 * A node of the tab's tree: a team (over its lead, its retired group and its child teams), a session (over the sessions
 * it leads), or a team's retired group (over its retired sessions). The key names it across reads, for its open state.
 */
export type TeamTreeNode =
  | (NodeBase & { readonly kind: 'team'; readonly team: TeamFacts })
  | (NodeBase & { readonly kind: 'session'; readonly session: SessionFacts })
  | (NodeBase & { readonly kind: 'retired'; readonly team: string })

/** A session's node, the kind of node the tab's search finds (team-search.ts). */
export type SessionNode = Extract<TeamTreeNode, { kind: 'session' }>
/** A team's node. */
export type TeamNode = Extract<TeamTreeNode, { kind: 'team' }>
/** A team's retired group's node. */
export type RetiredNode = Extract<TeamTreeNode, { kind: 'retired' }>

/** The tasks `id` has in progress; null when the register is not read. */
function currentTasks(tasks: readonly TaskRow[] | null, id: string): CurrentTask[] | null {
  if (tasks === null) return null
  return tasks.filter(task => task.owner === id && task.status === 'in-progress').map(({ id: task, title }) => ({ id: task, title }))
}

/** The tasks `id` owns, counted; zeros for none, null when the register is not read. */
function countsOf(counts: TaskCounts | null, id: string): SessionTasks | null {
  if (counts === null) return null
  return { ...(counts.bySession[id] ?? NO_TASKS), archived: counts.archived }
}

/** The cards `id` has on the owner; null when the register is not read. */
function cardsOf(cards: Readonly<Record<string, SessionOwnerCards>> | null, id: string): SessionOwnerCards | null {
  if (cards === null) return null
  return cards[id] ?? NO_CARDS
}

/**
 * What the pane's register says of one team's sessions: its tasks, each session's cards on the owner (a session with
 * none absent) and each session's tasks counted.
 */
export type TeamRegister = {
  readonly tasks: readonly TaskRow[]
  readonly ownerCards: Readonly<Record<string, SessionOwnerCards>>
  readonly taskCounts: TaskCounts
}

/** What the tree is built from. */
export type TreeInput = {
  /** The teams and sessions as teamrig's `sessions` document serves them. */
  readonly read: SessionsRead
  /** The pane's own team. */
  readonly own: string
  /** The register of each team the pane reads one of, by team id. */
  readonly registers: ReadonlyMap<string, TeamRegister>
  /** Each team's own week file, by team id; a team with none, or one teamrig cannot read, absent. */
  readonly weeks: ReadonlyMap<string, TeamWeekSummary>
  readonly now: number
}

/** A session's facts: the served row, and from its team's register its tasks and cards (null with no register read). */
function factsOf(row: SessionRow, register: TeamRegister | null): SessionFacts {
  const { team, id, name, active, roles, leads, ledBy, launch, hire, rehiredFrom, retire, unread } = row
  const served = { team, id, name, active, roles, leads, ledBy, launch, hire, rehiredFrom, retire, unread }
  if (!active) return { ...served, now: [], tasks: null, decisions: NO_CARDS }
  return {
    ...served,
    now: currentTasks(register?.tasks ?? null, id),
    tasks: countsOf(register?.taskCounts ?? null, id),
    decisions: cardsOf(register?.ownerCards ?? null, id),
  }
}

/**
 * The session nodes of one team from its served rows, in their order: each active session under the leader teamrig
 * names for it, one with no leader on the team (the lead, or every session of a config that names no lead) on top,
 * then the retired group. Each session is drawn once: one a loop of leaders would leave out is put on top.
 */
function sessionNodes(team: string, rows: readonly SessionRow[], register: TeamRegister | null): TeamTreeNode[] {
  const active = rows.filter(row => row.active)
  const ids = new Set(active.map(row => row.id))
  const seen = new Set<string>()
  const led = (row: SessionRow): TeamTreeNode => {
    seen.add(row.id)
    const members = active.filter(member => member.leader === row.id).flatMap(member => (seen.has(member.id) ? [] : [led(member)]))
    return { kind: 'session', key: sessionKey(team, row.id), session: factsOf(row, register), children: members }
  }
  const tops = active.filter(row => row.leader === null || !ids.has(row.leader))
  const nodes = [...tops, ...active].flatMap(row => (seen.has(row.id) ? [] : [led(row)]))
  const retired = rows.filter(row => !row.active)
  if (retired.length > 0) {
    const gone = retired.map((row): TeamTreeNode => ({ kind: 'session', key: sessionKey(team, row.id), session: factsOf(row, null), children: [] }))
    nodes.push({ kind: 'retired', key: `retired:${team}`, team, children: gone })
  }
  return nodes
}

/** The key of a session's node: its team and id, so a rename keeps it open or closed. */
export function sessionKey(team: string, id: string): string {
  return `session:${team}/${id}`
}

/** The top of the tree that holds `own`: up its served parents; `own` itself when they go round a loop. */
function rootOf(teams: ReadonlyMap<string, ServedTeam>, own: string): string {
  const seen = new Set([own])
  let at = own
  for (;;) {
    const parent = teams.get(at)?.parent ?? null
    if (parent === null || !teams.has(parent)) return at
    if (seen.has(parent)) return own
    seen.add(parent)
    at = parent
  }
}

/**
 * The tree that holds `own`: its root team, then every team below it, each with its lead on top, the sessions each
 * leader leads under it, the team's retired group, then its child teams in the served order (by id). A team teamrig
 * does not serve is left out. A team whose parents go round a loop starts the tree itself, and each team is walked
 * once, so a loop ends. Each team's week is its own and its child teams' at `now` (weekOf). Null when `own` is not
 * served.
 */
export function teamTree({ read, own, registers, weeks, now }: TreeInput): TeamTreeNode | null {
  const teams = new Map(read.teams.map(team => [team.id, team]))
  if (!teams.has(own)) return null
  const walked = new Set<string>()
  /** The team's node, and the week files of it and every team under it, its own first, then depth first. */
  const teamNode = (id: string): { node: TeamTreeNode; weeks: TeamWeekSummary[] } | null => {
    const row = teams.get(id)
    if (row === undefined || walked.has(id)) return null
    walked.add(id)
    const below = read.teams.filter(team => team.parent === id).flatMap(child => teamNode(child.id) ?? [])
    const week = weeks.get(id)
    const all = [...(week === undefined ? [] : [week]), ...below.flatMap(child => child.weeks)]
    const facts: TeamFacts = { team: id, parent: row.parent, active: row.active, retired: row.retired, week: weekOf(all, now) }
    const sessions = sessionNodes(id, read.sessions.filter(session => session.team === id), registers.get(id) ?? null)
    return { node: { kind: 'team', key: `team:${id}`, team: facts, children: [...sessions, ...below.map(child => child.node)] }, weeks: all }
  }
  return teamNode(rootOf(teams, own))?.node ?? null
}

/** A node as one row of the tab: how deep it sits, and whether it is open; null for a node with nothing under it. */
export type TeamRow = { readonly node: TeamTreeNode; readonly depth: number; readonly open: boolean | null }

/** Teams and leaders start open; a retired group starts closed, so the open tree stays the size of the active team. */
export function openByDefault(node: TeamTreeNode): boolean {
  return node.kind !== 'retired'
}

/**
 * The rows the tab draws, depth first: a node, then its children while it is open. `toggled` holds the keys the person
 * opened or closed against openByDefault, so a node new to the tree takes its default.
 */
export function teamRows(root: TeamTreeNode | null, toggled: ReadonlySet<string>): TeamRow[] {
  const rows: TeamRow[] = []
  const visit = (node: TeamTreeNode, depth: number): void => {
    const open = node.children.length === 0 ? null : openByDefault(node) !== toggled.has(node.key)
    rows.push({ node, depth, open })
    if (open === true) for (const child of node.children) visit(child, depth + 1)
  }
  if (root !== null) visit(root, 0)
  return rows
}

/**
 * The rows a search draws (team-search.ts), depth first: each node `shown` holds the key of, and every node over one,
 * so a match shows under its team and its leaders whatever is open. A node is open over the rows drawn under it, and
 * has nothing under it when none is.
 */
export function foundRows(root: TeamTreeNode | null, shown: ReadonlySet<string>): TeamRow[] {
  const visit = (node: TeamTreeNode, depth: number): TeamRow[] => {
    const below = node.children.flatMap(child => visit(child, depth + 1))
    if (below.length > 0) return [{ node, depth, open: true }, ...below]
    return shown.has(node.key) ? [{ node, depth, open: null }] : []
  }
  return root === null ? [] : visit(root, 0)
}
