// The Teams tab's source (T780): the kit home's team folders and, in each, the team's config and the rename and hire
// logs in the state folder that config names, each file re-read only when its stamp moves (source.ts WatchedFile). It
// puts them into the tree (team.ts teamTree) and writes it only when it changed, reading every POLL_MS (live.ts) and
// only while the tab shows, as the Log view's LiveLog does. The pane's own team's register tasks, its sessions' cards
// on the owner and their unread inbox lines (team-inboxes.ts) go with its read; a peer team's register and inboxes are
// not the pane's, so its sessions show none of them.
import type { SessionOwnerCards, Snapshot, TaskRow, TeamView } from '../types'
import { parseConfigText, readHiringLog, readRenames, type ConfigRead, type HiringRecord, type Rename } from './core/read/index'
import { POLL_MS, type Timer } from './live'
import { teamIds, teamStateDir, type TeamFiles } from './places'
import { WatchedFile, type Files } from './source'
import { teamTree, type TeamRead } from './team'
import { TeamInboxes, type InboxPaths } from './team-inboxes'

/**
 * What the pane reads of its own team beside its folder: the register's tasks and each session's cards on the owner,
 * and its inboxes when it found them.
 */
export type OwnReads = {
  readonly tasks: readonly TaskRow[]
  readonly ownerCards: Readonly<Record<string, SessionOwnerCards>>
  readonly inboxes: TeamInboxes | null
}

/** A team's rename and hire logs, in the state folder its config named when they were made. */
type TeamLogs = { readonly state: string; readonly renames: WatchedFile<readonly Rename[]>; readonly hires: WatchedFile<readonly HiringRecord[]> }

/** One team's folder: its config, then the rename and hire logs in the state folder that config names. */
export class TeamFolder {
  readonly team: string
  private readonly files: Files
  private readonly home: string
  private readonly config: WatchedFile<ConfigRead | null>
  private logs: TeamLogs | null = null

  constructor(files: Files, teamsDir: string, team: string) {
    this.team = team
    this.files = files
    this.home = `${teamsDir}/${team}`
    this.config = new WatchedFile<ConfigRead | null>(files, `${this.home}/config.json`, text => parseConfigText(text), null)
  }

  /**
   * The team's files as read now, with `own` for the pane's own team (null for a peer's): its tasks, its sessions'
   * cards on the owner, and the unread inbox lines of the sessions on its config. Null when it has no config file or teamrig refuses the one there. A
   * config that moves its state folder reads the logs from the new one. A failed read throws, keeping the stamps of
   * the files read before it, so the next read tries the rest again.
   */
  async read(own: OwnReads | null): Promise<TeamRead | null> {
    await this.config.refresh()
    const config = this.config.current
    if (config?.status !== 'loaded') return null
    const state = teamStateDir(this.home, config.config)
    const logs = this.logs?.state === state ? this.logs : this.logsIn(state)
    this.logs = logs
    await logs.renames.refresh()
    await logs.hires.refresh()
    const unread = own === null || own.inboxes === null ? null : await own.inboxes.unread(config.config.sessions)
    return {
      team: this.team,
      config: config.config,
      renames: logs.renames.current,
      hires: logs.hires.current,
      tasks: own?.tasks ?? null,
      unread,
      ownerCards: own?.ownerCards ?? null,
    }
  }

  private logsIn(state: string): TeamLogs {
    return {
      state,
      renames: new WatchedFile<readonly Rename[]>(this.files, `${state}/renames.jsonl`, text => readRenames(text).renames, []),
      hires: new WatchedFile<readonly HiringRecord[]>(this.files, `${state}/hires.jsonl`, text => readHiringLog(text).records, []),
    }
  }
}

export type TeamPorts = {
  /** The names of the folders right under a folder; none when it is not there. It rejects when it cannot list one. */
  folders: (dir: string) => Promise<readonly string[]>
  /** The pane's own team's register tasks and its sessions' cards on the owner, as the pane last read them. */
  register: () => Promise<Pick<Snapshot, 'tasks' | 'ownerCards'>>
  /** True while the pane shows the Teams tab, open (not minimized). */
  isShown: () => Promise<boolean>
  publish: (view: TeamView) => Promise<void>
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

  /** The tree the team folders hold now, or why they could not be read. */
  private async read(): Promise<TeamView> {
    try {
      const ids = teamIds(await this.ports.folders(this.team.teamsDir))
      for (const id of this.teams.keys()) if (!ids.includes(id)) this.teams.delete(id)
      const { tasks, ownerCards } = await this.ports.register()
      const own: OwnReads = { tasks, ownerCards, inboxes: this.inboxes }
      const reads: TeamRead[] = []
      for (const id of ids) {
        const folder = this.teams.get(id) ?? new TeamFolder(this.files, this.team.teamsDir, id)
        this.teams.set(id, folder)
        const read = await folder.read(id === this.team.team ? own : null)
        if (read !== null) reads.push(read)
      }
      return { kind: 'tree', root: teamTree(reads, this.team.team) }
    } catch (error) {
      return { kind: 'failed', reason: reasonOf(error) }
    }
  }
}
