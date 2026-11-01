// The Teams tab's source (T780): the kit home's team folders and, in each, the team's config and, in the state folder
// that config names, the rename and hire logs and the week file teamrig's budget hooks write (T1713), each file re-read
// only when its stamp moves (source.ts WatchedFile). It puts them into the tree (team.ts teamTree, at the pane's clock's
// now) and writes it only when it changed, reading every POLL_MS (live.ts) and
// only while the tab shows, as the Log view's LiveLog does. The pane's own team's register tasks, its sessions' cards
// on the owner, their tasks counted (task-counts.ts) and their unread inbox lines (team-inboxes.ts) go with its read; a
// peer team's register and inboxes are not the pane's, so its sessions show none of them. A team folder whose read
// fails draws as it last read, or is left out before one, and the view names it with why (T1234); the others draw on.
// The own team's folder, never read yet, holds the tree up: its failure fails the view.
import type { SessionOwnerCards, Snapshot, TaskCounts, TaskRow, TeamFolderFailure, TeamView } from '../types'
import {
  parseConfigText,
  parseTeamWeek,
  readHiringLog,
  readRenames,
  type ConfigRead,
  type HiringRecord,
  type Rename,
  type TeamWeekSummary,
} from './core/read/index'
import { POLL_MS, type Timer } from './live'
import { teamIds, teamStateDir, type TeamFiles } from './places'
import { WatchedFile, type Files } from './source'
import { teamTree, type TeamRead } from './team'
import { TeamInboxes, type InboxPaths } from './team-inboxes'

/**
 * What the pane reads of its own team beside its folder: the register's tasks, each session's cards on the owner and
 * its tasks counted, and its inboxes when it found them.
 */
export type OwnReads = {
  readonly tasks: readonly TaskRow[]
  readonly ownerCards: Readonly<Record<string, SessionOwnerCards>>
  readonly taskCounts: TaskCounts
  readonly inboxes: TeamInboxes | null
}

/** A team's register parts: the own team's from `own`, a peer's (null `own`) none. */
function ownParts(own: OwnReads | null): Pick<TeamRead, 'tasks' | 'ownerCards' | 'taskCounts'> {
  return { tasks: own?.tasks ?? null, ownerCards: own?.ownerCards ?? null, taskCounts: own?.taskCounts ?? null }
}

/** A team's rename and hire logs and its week file, in the state folder its config named when they were made. */
type StateFiles = {
  readonly state: string
  readonly renames: WatchedFile<readonly Rename[]>
  readonly hires: WatchedFile<readonly HiringRecord[]>
  readonly week: WatchedFile<TeamWeekSummary | null>
}

/** One team's folder: its config, then the rename and hire logs and the week file in the state folder that config names. */
export class TeamFolder {
  readonly team: string
  private readonly files: Files
  private readonly home: string
  private readonly config: WatchedFile<ConfigRead | null>
  private stateFiles: StateFiles | null = null
  /** Its last read that worked: null before one, and once that read found no config teamrig takes. */
  private last: TeamRead | null = null

  constructor(files: Files, teamsDir: string, team: string) {
    this.team = team
    this.files = files
    this.home = `${teamsDir}/${team}`
    this.config = new WatchedFile<ConfigRead | null>(files, `${this.home}/config.json`, text => parseConfigText(text), null)
  }

  /**
   * The team's files as read now, with `own` for the pane's own team (null for a peer's): its tasks, its sessions'
   * cards on the owner and task counts, and the unread inbox lines of the sessions on its config. Null when it has no
   * config file or teamrig refuses the one there. A config that moves its state folder reads the logs and the week file
   * from the new one. A failed read throws, keeping the stamps of the files read before it, so the next read tries the
   * rest again, and keeps the last read that worked (lastRead).
   */
  async read(own: OwnReads | null): Promise<TeamRead | null> {
    await this.config.refresh()
    const config = this.config.current
    if (config?.status !== 'loaded') {
      this.last = null
      return null
    }
    const state = teamStateDir(this.home, config.config)
    const files = this.stateFiles?.state === state ? this.stateFiles : this.filesIn(state)
    this.stateFiles = files
    await files.renames.refresh()
    await files.hires.refresh()
    await files.week.refresh()
    const unread = own === null || own.inboxes === null ? null : await own.inboxes.unread(config.config.sessions)
    const read: TeamRead = {
      team: this.team,
      config: config.config,
      renames: files.renames.current,
      hires: files.hires.current,
      week: files.week.current,
      ...ownParts(own),
      unread,
    }
    this.last = read
    return read
  }

  /**
   * Its last read that worked, for a read that failed to fall back on, its register parts taken from `own` as they are
   * now (they are the pane's, not the folder's); null before one, and once a read found no config teamrig takes.
   */
  lastRead(own: OwnReads | null): TeamRead | null {
    return this.last === null ? null : { ...this.last, ...ownParts(own) }
  }

  private filesIn(state: string): StateFiles {
    return {
      state,
      renames: new WatchedFile<readonly Rename[]>(this.files, `${state}/renames.jsonl`, text => readRenames(text).renames, []),
      hires: new WatchedFile<readonly HiringRecord[]>(this.files, `${state}/hires.jsonl`, text => readHiringLog(text).records, []),
      // A damaged file, or one in a format this pane cannot read, shows no week, as a missing one does.
      week: new WatchedFile<TeamWeekSummary | null>(this.files, `${state}/usage/team.week.json`, text => parseTeamWeek(text) ?? null, null),
    }
  }
}

export type TeamPorts = {
  /** The names of the folders right under a folder; none when it is not there. It rejects when it cannot list one. */
  folders: (dir: string) => Promise<readonly string[]>
  /** The pane's own team's register tasks, its sessions' cards on the owner and their tasks counted, as the pane last read them. */
  register: () => Promise<Pick<Snapshot, 'tasks' | 'ownerCards' | 'taskCounts'>>
  /** True while the pane shows the Teams tab, open (not minimized). */
  isShown: () => Promise<boolean>
  publish: (view: TeamView) => Promise<void>
  /** The time now, epoch ms: which week files are for the week still running, and how far it is. */
  now: () => Promise<number>
}

/** Why a read failed, as one line. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Reads the team tree again while the Teams tab shows, and writes it when it changed. */
export class LiveTeam {
  private readonly files: Files
  private readonly team: TeamFiles
  private readonly ports: TeamPorts
  /** The own team's inboxes; null when the pane found no register, so no inbox marks. */
  private readonly inboxes: TeamInboxes | null
  /** Each team folder read, by id; a folder no longer listed is dropped, so a team made again is read anew. */
  private readonly teams = new Map<string, TeamFolder>()
  private timers: Timer[] = []
  private isPolling = false
  /** The view last written, as JSON: a read that finds the same tree writes nothing. */
  private shown: string | null = null

  constructor(files: Files, team: TeamFiles, ports: TeamPorts, inbox: InboxPaths | null) {
    this.files = files
    this.team = team
    this.ports = ports
    this.inboxes = inbox === null ? null : new TeamInboxes(files, inbox)
  }

  startTimers(every: (ms: number, fn: () => void) => Timer): void {
    this.stop()
    this.timers = [every(POLL_MS, () => void this.poll())]
  }

  stop(): void {
    for (const timer of this.timers) timer.cancel()
    this.timers = []
  }

  /** Reads the tree again, when the tab shows. */
  async poll(): Promise<void> {
    try {
      if (await this.ports.isShown()) await this.refresh()
    } catch {
      // The next poll asks again.
    }
  }

  /** Reads the tree again and writes it when it changed. */
  async refresh(): Promise<void> {
    if (this.isPolling) return
    this.isPolling = true
    try {
      const view = await this.read()
      const json = JSON.stringify(view)
      if (json !== this.shown) {
        await this.ports.publish(view)
        this.shown = json
      }
    } catch {
      // A failed write is written by the next poll, which finds the view still unwritten.
    } finally {
      this.isPolling = false
    }
  }

  /**
   * The tree the team folders hold now, a folder whose read failed drawn as it last read, or left out before one, and
   * named with why; or why the folders could not be listed, the register read, or the own team's folder read before
   * any read of it worked.
   */
  private async read(): Promise<TeamView> {
    try {
      const ids = teamIds(await this.ports.folders(this.team.teamsDir))
      for (const id of this.teams.keys()) if (!ids.includes(id)) this.teams.delete(id)
      const { tasks, ownerCards, taskCounts } = await this.ports.register()
      const own: OwnReads = { tasks, ownerCards, taskCounts, inboxes: this.inboxes }
      const reads: TeamRead[] = []
      const failures: TeamFolderFailure[] = []
      for (const id of ids) {
        const folder = this.teams.get(id) ?? new TeamFolder(this.files, this.team.teamsDir, id)
        this.teams.set(id, folder)
        const folderOwn = id === this.team.team ? own : null
        try {
          const read = await folder.read(folderOwn)
          if (read !== null) reads.push(read)
        } catch (error) {
          const last = folder.lastRead(folderOwn)
          // With no read of the own team, there is no tree to draw the others in: the whole read failed.
          if (last === null && id === this.team.team) throw error
          if (last !== null) reads.push(last)
          failures.push({ team: id, reason: reasonOf(error), isLastRead: last !== null })
        }
      }
      return { kind: 'tree', root: teamTree(reads, this.team.team, await this.ports.now()), failures }
    } catch (error) {
      return { kind: 'failed', reason: reasonOf(error) }
    }
  }
}
