// The Stats tab's source (T1419): teamrig's stats fold (core register/stats.ts registerStats, the one `teamrig stats`
// prints) over the scope the tab picks, with its Health tiles and the scope's week. It reads the team folders as the
// Teams tab does (team-source.ts TeamFolder, each file re-read only when its stamp moves) for the tree of teams that
// holds the pane's team, and the whole history of each scoped team's register (register-history.ts), each read only
// once a scope takes it in: the pane's own from its register, a peer's from the state folder its config names. It
// folds again only when a history, the scope, the range or the minute moves, so a waiting owner's days move once a
// minute, not at every poll; it writes the view only when it changed, reading every POLL_MS (live.ts) and only while
// the tab shows; a press reads at once (refresh), and one made during a read runs another after it. A team folder or a
// peer's register whose read fails draws as it last read, or is left out before one, named with why; the own team's
// folder or register, never read yet, fails the view. The view holds the fold's numbers and, while a Health tile's
// press picked one (T1864), the tasks behind that count as slim rows; the register's tasks never leave the fold.
import type { StatsChoice, StatsListKind, StatsListRow, StatsNumbers, StatsView, TeamFolderFailure } from '../types'
import {
  dueTime,
  planOrder,
  registerHealth,
  registerStats,
  Roster,
  TeamTree,
  teamNodeOf,
  type PlanPlace,
  type RegisterHealth,
  type StatsRange,
  type StatsTask,
  type StatsTasks,
  type StatsTeam,
  type TimeZone,
} from './core/read/index'
import { POLL_MS, TICK_MS, type Timer } from './live'
import { teamIds, teamStateDir, type TeamFiles } from './places'
import { RegisterHistory } from './register-history'
import type { Files } from './source'
import { weekOf, type TeamRead } from './team'
import { TeamFolder } from './team-source'

/** What the tab picked: the scope, the range, and the Health count whose tasks it lists (null for none). */
export type StatsPick = { readonly scope: StatsChoice; readonly range: StatsRange; readonly list: StatsListKind | null }

/** Each Health count's tasks as slim rows. */
export type StatsLists = Readonly<Record<StatsListKind, readonly StatsListRow[]>>

/** A listed row and where plan order places it, its due parsed once. */
type Placed = { readonly row: StatsListRow; readonly place: PlanPlace }

/**
 * The tasks behind each Health count as slim rows, one row per task shared by every list it is in: each list p1
 * first, then by due date, undated last (teamrig's plan order, core register/tree.ts planOrder, as register/views.ts
 * byPlanOrder orders a task's own due), but the owner's waits as teamrig orders them, the oldest wait first. Each
 * task's due is parsed once, with its row: byPlanOrder parses both dues at every comparison, which over the thousands
 * of tasks a range of all lists made the fold four times slower.
 */
export function listsOf(tasks: StatsTasks, zone: TimeZone): StatsLists {
  const placed = new Map<string, Placed>()
  const placedOf = ({ team, task }: StatsTask): Placed => {
    const key = `${team}/${task.id}`
    const kept = placed.get(key)
    if (kept !== undefined) return kept
    const row: StatsListRow = { team, id: task.id, title: task.title, owner: task.owner, status: task.status, priority: task.priority, due: task.due }
    const made: Placed = { row, place: { id: task.id, priority: task.priority, at: dueTime(task, zone) } }
    placed.set(key, made)
    return made
  }
  const planned = (list: readonly StatsTask[]) =>
    list
      .map(placedOf)
      .sort((a, b) => planOrder(a.place, b.place))
      .map(each => each.row)
  return {
    active: planned(tasks.active),
    opened: planned(tasks.opened),
    closed: planned(tasks.closed),
    overdue: planned(tasks.overdue),
    overdueP1: planned(tasks.overdueP1),
    ownerDecisions: tasks.ownerDecisions.map(task => placedOf(task).row),
  }
}

/** How the own team folds: its register's events (the pane's register), its calendar's zone and the owner's marker. */
export type StatsSettings = {
  /** The own team's register events (source.ts registerPaths), which may sit outside its state folder. */
  readonly events: string
  /** The own team's zone: a day is a calendar day of it, for every team the fold takes in, as `teamrig stats` folds. */
  readonly zone: TimeZone
  /** The own team's `register.ownerSource`: the owner's work and waits. */
  readonly ownerMarker: string
}

export type StatsPorts = {
  /** The names of the folders right under a folder; none when it is not there. It rejects when it cannot list one. */
  folders: (dir: string) => Promise<readonly string[]>
  /** True while the pane shows the Stats tab, open (not minimized). */
  isShown: () => Promise<boolean>
  /** The scope and range the tab shows now. */
  choice: () => Promise<StatsPick>
  publish: (view: StatsView) => Promise<void>
  /** The time now, epoch ms. */
  now: () => Promise<number>
}

/** A team's register history and the events file it reads: a config that moves its state folder reads anew. */
type TeamHistory = { readonly path: string; readonly history: RegisterHistory }

/** The last fold and what it folded, its counts' tasks as rows: a read whose key has not moved takes it as is. */
type Fold = { readonly key: string; readonly stats: StatsNumbers; readonly health: RegisterHealth; readonly lists: StatsLists }

/** The view of a read that found the own team and its register. */
type Folded = Extract<StatsView, { kind: 'stats' }>

/** Why a read failed, as one line. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The scope as it folds: one naming a team no longer in the tree folds the whole tree. */
function scopeIn(choice: StatsChoice, teams: readonly string[]): StatsChoice {
  return choice.kind === 'tree' || teams.includes(choice.team) ? choice : { kind: 'tree' }
}

/** Reads the scope's stats again while the Stats tab shows, and writes them when they changed. */
export class LiveStats {
  private readonly files: Files
  private readonly team: TeamFiles
  private readonly settings: StatsSettings
  private readonly ports: StatsPorts
  /** Each team folder read, by id; a folder no longer listed is dropped, so a team made again is read anew. */
  private readonly folders = new Map<string, TeamFolder>()
  /** Each scoped team's register history, by id, read once a scope took it in; dropped with its folder. */
  private readonly histories = new Map<string, TeamHistory>()
  private timers: Timer[] = []
  private isRefreshing = false
  /** True when a refresh was asked while one ran: the running one reads again, so the press is not lost. */
  private isAsked = false
  private fold: Fold | null = null
  /** The view last written, as JSON: a read that finds the same numbers writes nothing. */
  private shown: string | null = null

  constructor(files: Files, team: TeamFiles, settings: StatsSettings, ports: StatsPorts) {
    this.files = files
    this.team = team
    this.settings = settings
    this.ports = ports
  }

  startTimers(every: (ms: number, fn: () => void) => Timer): void {
    this.stop()
    this.timers = [every(POLL_MS, () => void this.poll())]
  }

  stop(): void {
    for (const timer of this.timers) timer.cancel()
    this.timers = []
  }

  /** Reads the stats again, when the tab shows. */
  async poll(): Promise<void> {
    try {
      if (await this.ports.isShown()) await this.refresh()
    } catch {
      // The next poll asks again.
    }
  }

  /** Reads the stats again and writes them when they changed; asked during a read, it reads again after that one. */
  async refresh(): Promise<void> {
    if (this.isRefreshing) {
      this.isAsked = true
      return
    }
    this.isRefreshing = true
    try {
      do {
        this.isAsked = false
        await this.write()
      } while (this.isAsked)
    } finally {
      this.isRefreshing = false
    }
  }

  private async write(): Promise<void> {
    try {
      const pick = await this.ports.choice()
      const view = await this.read(pick, await this.ports.now())
      const json = JSON.stringify(view)
      if (json !== this.shown) {
        await this.ports.publish(view)
        this.shown = json
      }
    } catch {
      // A failed write is written by the next refresh, which finds the view still unwritten.
    }
  }

  /**
   * The scope's stats as the team folders and registers hold them now; that the own team has no config teamrig takes;
   * or why the folders could not be listed, or the own team's folder or register read before any read of it worked.
   */
  private async read(pick: StatsPick, now: number): Promise<StatsView> {
    try {
      const failures: TeamFolderFailure[] = []
      const reads = await this.readFolders(failures)
      if (!reads.has(this.team.team)) return { kind: 'no-team' }
      return await this.folded(pick, now, reads, failures)
    } catch (error) {
      return { kind: 'failed', reason: reasonOf(error) }
    }
  }

  /** Each listed team folder's read, by id, a failed one as it last read or left out, named in `failures`. */
  private async readFolders(failures: TeamFolderFailure[]): Promise<Map<string, TeamRead>> {
    const ids = teamIds(await this.ports.folders(this.team.teamsDir))
    for (const id of [...this.folders.keys()]) if (!ids.includes(id)) this.folders.delete(id)
    for (const id of [...this.histories.keys()]) if (!ids.includes(id)) this.histories.delete(id)
    const reads = new Map<string, TeamRead>()
    for (const id of ids) {
      const folder = this.folders.get(id) ?? new TeamFolder(this.files, this.team.teamsDir, id)
      this.folders.set(id, folder)
      try {
        const read = await folder.read(null)
        if (read !== null) reads.set(id, read)
      } catch (error) {
        const last = folder.lastRead(null)
        // With no read of the own team, there is no tree to find the scope in: the whole read failed.
        if (last === null && id === this.team.team) throw error
        if (last !== null) reads.set(id, last)
        failures.push({ team: id, reason: reasonOf(error), isLastRead: last !== null })
      }
    }
    return reads
  }

  /** The fold of the scope's teams in the tree that holds the own team, with their week. */
  private async folded(pick: StatsPick, now: number, reads: ReadonlyMap<string, TeamRead>, failures: TeamFolderFailure[]): Promise<Folded> {
    const tree = new TeamTree([...reads.values()].map(read => teamNodeOf(read.team, read.config, new Roster(read.config, read.team, read.renames))))
    const teams = tree.walk(tree.rootOf(this.team.team) ?? this.team.team).map(step => step.team)
    const scope = scopeIn(pick.scope, teams)
    const scoped = scope.kind === 'tree' ? teams : scope.kind === 'team' ? tree.walk(scope.team).map(step => step.team) : [scope.team]
    const scopedReads = scoped.flatMap(team => reads.get(team) ?? [])
    const statsTeams: StatsTeam[] = []
    const versions: (string | number)[][] = []
    for (const read of scopedReads) {
      const { path, history } = this.historyOf(read)
      try {
        await history.refresh()
      } catch (error) {
        // The own register, never read, has no numbers to show; a peer's is left out before a read of it worked.
        if (history.version === 0 && read.team === this.team.team) throw error
        failures.push({ team: read.team, reason: reasonOf(error), isLastRead: history.version > 0 })
        if (history.version === 0) continue
      }
      statsTeams.push({ team: read.team, lead: read.config.roles.lead, events: history.events })
      versions.push([read.team, read.config.roles.lead, path, history.version])
    }
    const minute = Math.floor(now / TICK_MS)
    const key = JSON.stringify({ scope, range: pick.range, versions, minute })
    const fold = this.fold?.key === key ? this.fold : this.foldOf(key, scope, pick.range, statsTeams, minute * TICK_MS)
    this.fold = fold
    const week = weekOf(scopedReads.flatMap(read => read.week ?? []), now)
    const list = pick.list === null ? null : { kind: pick.list, rows: fold.lists[pick.list] }
    return { kind: 'stats', scope, range: pick.range, teams, stats: fold.stats, health: fold.health, list, week, failures }
  }

  /** The stats of `teams` at the minute `at` starts, with the Health tiles over them and their counts' tasks as rows. */
  private foldOf(key: string, scope: StatsChoice, range: StatsRange, teams: readonly StatsTeam[], at: number): Fold {
    const { zone, ownerMarker } = this.settings
    const session = scope.kind === 'session' ? { session: { team: scope.team, session: scope.session } } : {}
    const { tasks, ...stats } = registerStats({ teams, range, now: new Date(at), zone, ownerMarker, ...session })
    return { key, stats, health: registerHealth(stats), lists: listsOf(tasks, zone) }
  }

  /** The team's register history: the own team's at the pane's register, a peer's in the state folder its config names. */
  private historyOf(read: TeamRead): TeamHistory {
    const path = read.team === this.team.team ? this.settings.events : `${teamStateDir(`${this.team.teamsDir}/${read.team}`, read.config)}/events.jsonl`
    const kept = this.histories.get(read.team)
    if (kept?.path === path) return kept
    const made = { path, history: new RegisterHistory(this.files, path) }
    this.histories.set(read.team, made)
    return made
  }
}
