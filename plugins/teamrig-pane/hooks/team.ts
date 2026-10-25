// The Team tab's model (T780): the tree of teams that holds the pane's own team, each team with its lead on top and
// every session ever on its roster under it, active or closed. It is read from each team's config, rename log and hire
// log through teamrig's own readers (TeamTree, LeadTree, Roster, the hire log), never hard-coded, so the tab shows the
// team as teamrig's commands find it. Pure: the source reads the files, this turns them into nodes, teamRows into the
// rows a drawing shows.
import type { TaskRow } from '../types'
import {
  activeHires,
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
} from './core/read/index'

/** One team's files as read: its id (its folder name), its config, its rename log and its hire log. */
export type TeamRead = {
  readonly team: string
  readonly config: KitConfig
  readonly renames: readonly Rename[]
  readonly hires: readonly HiringRecord[]
  /** The team's register tasks, for each session's current tasks; null when the pane does not read that register. */
  readonly tasks: readonly TaskRow[] | null
}

/** A role a team config gives a session (`roles`), as teamrig's Roster names it. */
export type Role = ReturnType<Roster['rolesOf']>[number]

/** A task a session has in progress. */
export type CurrentTask = { readonly id: string; readonly title: string }

export type TeamFacts = {
  readonly team: string
  /** The parent team the config names (`team.parent`); null for a root. */
  readonly parent: string | null
  /** The sessions on the team now: the config's `sessions`. */
  readonly active: number
  /** The sessions retired and no longer on the team. */
  readonly closed: number
}

export type SessionFacts = {
  readonly team: string
  readonly id: string
  /** The name it runs under now; for a closed session, the last name it held. */
  readonly name: string
  readonly formerNames: readonly string[]
  /** On the team's config now; false for a retired session no longer on it. */
  readonly active: boolean
  readonly roles: readonly Role[]
  /** How many sessions it leads directly, as the lead or a sub-lead; 0 when it leads none. */
  readonly leads: number
  /** Its newest hire, for a hired session; null for one the team was set up with. */
  readonly hire: HireRecord | null
  /** The retire a rehired session came back from; null for a first hire and a session never hired. */
  readonly rehiredFrom: RetireRecord | null
  /** Its retire, for a closed session; null for an active one. */
  readonly retire: RetireRecord | null
  /** Its tasks in progress, in the register's order; none when the pane does not read its team's register. */
  readonly now: readonly CurrentTask[]
}

type NodeBase = { readonly key: string; readonly children: readonly TeamTreeNode[] }

/**
 * A node of the tab's tree: a team (over its lead, its closed group and its child teams), a session (over the sessions
 * it leads), or a team's closed group (over its retired sessions). The key names it across reads, for its open state.
 */
export type TeamTreeNode =
  | (NodeBase & { readonly kind: 'team'; readonly team: TeamFacts })
  | (NodeBase & { readonly kind: 'session'; readonly session: SessionFacts })
  | (NodeBase & { readonly kind: 'closed'; readonly team: string })

/** A team's own read, with its roster over every session ever on it: the config's sessions, then the retired ones. */
type TeamPart = { readonly read: TeamRead; readonly roster: Roster; readonly closed: readonly RetireRecord[] }

function partOf(read: TeamRead): TeamPart {
  const { team, config, renames, hires } = read
  const closed = retiredSessions(hires).filter(retire => !config.sessions.includes(retire.session))
  const roster = new Roster({ ...config, sessions: [...config.sessions, ...closed.map(retire => retire.session)] }, team, renames)
  return { read, roster, closed }
}

/** The tasks `id` has in progress; none when the register is not read. */
function currentTasks(tasks: readonly TaskRow[] | null, id: string): CurrentTask[] {
  return (tasks ?? []).filter(task => task.owner === id && task.status === 'in-progress').map(({ id: task, title }) => ({ id: task, title }))
}

/** The session nodes of one team: the lead, each session under its leader, and the closed group. */
function sessionNodes({ read, roster, closed }: TeamPart): TeamTreeNode[] {
  const { team, config, hires } = read
  const leads = new LeadTree(config)
  const hired = new Map(activeHires(hires).map(hire => [hire.session, hire]))
  const facts = (id: string, retire: RetireRecord | null): SessionFacts => {
    const hire = retire === null ? (hired.get(id) ?? null) : null
    return {
      team,
      id,
      name: roster.nameOf(id) ?? id,
      formerNames: roster.formerNamesOf(id),
      active: retire === null,
      roles: retire === null ? roster.rolesOf(id) : [],
      leads: retire === null ? leads.membersOf(id).length : 0,
      hire,
      rehiredFrom: hire === null ? null : (rehiredFrom(hires, id) ?? null),
      retire,
      now: retire === null ? currentTasks(read.tasks, id) : [],
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
  if (closed.length > 0) {
    const retired = closed.map((retire): TeamTreeNode => ({ kind: 'session', key: sessionKey(team, retire.session), session: facts(retire.session, retire), children: [] }))
    nodes.push({ kind: 'closed', key: `closed:${team}`, team, children: retired })
  }
  return nodes
}

/** The key of a session's node: its team and id, so a rename keeps it open or closed. */
export function sessionKey(team: string, id: string): string {
  return `session:${team}/${id}`
}

/**
 * The tree that holds `own`: its root team, then every team below it, each with its lead on top, the sessions each
 * leader leads under it, the team's closed group, then its child teams by id. Another root team on the machine is
 * another project and is left out. A team whose parents go round a loop starts the tree itself, and each team is
 * walked once, so a loop ends. Null when `own` has no config read.
 */
export function teamTree(reads: readonly TeamRead[], own: string): TeamTreeNode | null {
  const parts = new Map(reads.map(read => [read.team, partOf(read)]))
  const tree = new TeamTree([...parts.values()].map(({ read, roster }) => teamNodeOf(read.team, read.config, roster)))
  const walked = new Set<string>()
  const teamNode = (team: string): TeamTreeNode | null => {
    const part = parts.get(team)
    if (part === undefined || walked.has(team)) return null
    walked.add(team)
    const children = tree.childrenOf(team).flatMap(child => teamNode(child) ?? [])
    const { config } = part.read
    const facts: TeamFacts = { team, parent: config.team?.parent ?? null, active: config.sessions.length, closed: part.closed.length }
    return { kind: 'team', key: `team:${team}`, team: facts, children: [...sessionNodes(part), ...children] }
  }
  return parts.has(own) ? teamNode(tree.rootOf(own) ?? own) : null
}

/** A node as one row of the tab: how deep it sits, and whether it is open; null for a node with nothing under it. */
export type TeamRow = { readonly node: TeamTreeNode; readonly depth: number; readonly open: boolean | null }

/** Teams and leaders start open; a closed group starts closed, so the open tree stays the size of the active team. */
export function openByDefault(node: TeamTreeNode): boolean {
  return node.kind !== 'closed'
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
