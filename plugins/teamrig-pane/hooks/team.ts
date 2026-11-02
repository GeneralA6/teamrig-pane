// The Teams tab's model (T780): the tree of teams that holds the pane's own team, each team with its lead on top and
// every session ever on its roster under it, active or retired. It is read from each team's config, rename log and hire
// log through teamrig's own readers (TeamTree, LeadTree, Roster, the hire log), never hard-coded, so the tab shows the
// team as teamrig's commands find it. Each team's week (T1713) is its own week file's and its child teams', summed while
// they share one reset. Pure: the source reads the files, this turns them into nodes, teamRows into the rows a drawing
// shows.
import type { SessionOwnerCards, SessionTaskCounts, TaskCounts, TaskRow } from '../types'
import {
  activeHires,
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
  type LaunchConfig,
  type Rename,
  type RetireRecord,
  type TeamWeekSummary,
} from './core/read/index'

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
 * The week of a team and its child teams from their week files, the team's first: those for the week still running at
 * `now` that share the first one's reset, summed. A file on another reset is another account's (stopgap T1777: the
 * file names no account yet) and is left out; one from a week gone by too. Null when no file is left. How far the week
 * is goes in whole percent, so the tree changes about every 1.7 hours, not at every read. The Stats tab's week tile
 * (stats-source.ts) sums its scope's teams with it too.
 */
export function weekOf(weeks: readonly TeamWeekSummary[], now: number): TeamWeek | null {
  const running = weeks.filter(week => week.resetsAt > now)
  const first = running[0]
  if (first === undefined) return null
  const same = running.filter(week => week.resetsAt === first.resetsAt)
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
  /** The leaders over it, nearest first, ending at the lead (LeadTree chainOf); none for the lead and a retired session. */
  readonly ledBy: readonly string[]
  /**
   * The model and effort teamrig launches it on (launchOf: its `launch` entry, and for the lead teamrig's lead defaults
   * under the keys it leaves unset); null for a retired session, which teamrig no longer launches.
   */
  readonly launch: LaunchConfig | null
  /** Its newest hire, for a hired session; null for one the team was set up with. */
  readonly hire: HireRecord | null
  /** The retire a rehired session came back from; null for a first hire and a session never hired. */
  readonly rehiredFrom: RetireRecord | null
  /** Its retire, for a retired session; null for an active one. */
  readonly retire: RetireRecord | null
  /** Its tasks in progress, in the register's order; none for a retired session, null when the pane does not read its team's register. */
  readonly now: readonly CurrentTask[] | null
  /** Its tasks counted, zeros for one that owns none; null for a retired session and when the pane does not read its team's register. */
  readonly tasks: SessionTasks | null
  /** Its unread inbox lines; null for a retired session, one that never marked its inbox read, or a team whose inbox the pane does not read. */
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

/** A team's own read, with its roster over every session ever on it: the config's sessions, then the retired ones. */
type TeamPart = { readonly read: TeamRead; readonly roster: Roster; readonly retired: readonly RetireRecord[] }

function partOf(read: TeamRead): TeamPart {
  const { team, config, renames, hires } = read
  const retired = retiredSessions(hires).filter(retire => !config.sessions.includes(retire.session))
  const roster = new Roster({ ...config, sessions: [...config.sessions, ...retired.map(retire => retire.session)] }, team, renames)
  return { read, roster, retired }
}

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

/** The session nodes of one team: the lead, each session under its leader, and the retired group. */
function sessionNodes({ read, roster, retired }: TeamPart): TeamTreeNode[] {
  const { team, config, hires } = read
  const leads = new LeadTree(config)
  const hired = new Map(activeHires(hires).map(hire => [hire.session, hire]))
  const facts = (id: string, retire: RetireRecord | null): SessionFacts => {
    const hire = retire === null ? (hired.get(id) ?? null) : null
    return {
      team,
      id,
      name: roster.nameOf(id) ?? id,
      active: retire === null,
      roles: retire === null ? roster.rolesOf(id) : [],
      leads: retire === null ? leads.membersOf(id).length : 0,
      ledBy: retire === null ? leads.chainOf(id) : [],
      launch: retire === null ? launchOf(config, id) : null,
      hire,
      rehiredFrom: hire === null ? null : (rehiredFrom(hires, id) ?? null),
      retire,
      now: retire === null ? currentTasks(read.tasks, id) : [],
      tasks: retire === null ? countsOf(read.taskCounts, id) : null,
      unread: retire === null ? (read.unread?.get(id) ?? null) : null,
      decisions: retire === null ? cardsOf(read.ownerCards, id) : NO_CARDS,
    }
  }
  // The parser keeps the lead tree whole; the seen set only keeps a hand-built config from looping.
  const seen = new Set<string>()
  const led = (id: string): TeamTreeNode => {
    seen.add(id)
    const members = leads.membersOf(id).filter(member => !seen.has(member))
    return { kind: 'session', key: sessionKey(team, id), session: facts(id, null), children: members.map(led) }
  }
  const nodes = [led(leads.lead)]
  if (retired.length > 0) {
    const gone = retired.map((retire): TeamTreeNode => ({ kind: 'session', key: sessionKey(team, retire.session), session: facts(retire.session, retire), children: [] }))
    nodes.push({ kind: 'retired', key: `retired:${team}`, team, children: gone })
  }
  return nodes
}

/** The key of a session's node: its team and id, so a rename keeps it open or closed. */
export function sessionKey(team: string, id: string): string {
  return `session:${team}/${id}`
}

/**
 * The tree that holds `own`: its root team, then every team below it, each with its lead on top, the sessions each
 * leader leads under it, the team's retired group, then its child teams by id. Another root team on the machine is
 * another project and is left out. A team whose parents go round a loop starts the tree itself, and each team is
 * walked once, so a loop ends. Each team's week is its own and its child teams' at `now` (weekOf). Null when `own` has
 * no config read.
 */
export function teamTree(reads: readonly TeamRead[], own: string, now: number): TeamTreeNode | null {
  const parts = new Map(reads.map(read => [read.team, partOf(read)]))
  const tree = new TeamTree([...parts.values()].map(({ read, roster }) => teamNodeOf(read.team, read.config, roster)))
  const walked = new Set<string>()
  /** The team's node, and the week files of it and every team under it, its own first, then depth first. */
  const teamNode = (team: string): { node: TeamTreeNode; weeks: TeamWeekSummary[] } | null => {
    const part = parts.get(team)
    if (part === undefined || walked.has(team)) return null
    walked.add(team)
    const below = tree.childrenOf(team).flatMap(child => teamNode(child) ?? [])
    const { config, week } = part.read
    const weeks = [...(week === null ? [] : [week]), ...below.flatMap(child => child.weeks)]
    const facts: TeamFacts = { team, parent: config.team?.parent ?? null, active: config.sessions.length, retired: part.retired.length, week: weekOf(weeks, now) }
    const node: TeamTreeNode = { kind: 'team', key: `team:${team}`, team: facts, children: [...sessionNodes(part), ...below.map(child => child.node)] }
    return { node, weeks }
  }
  return parts.has(own) ? (teamNode(tree.rootOf(own) ?? own)?.node ?? null) : null
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
