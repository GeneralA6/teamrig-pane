// The Teams tab's source (T780, T4742). LiveTeam puts teamrig's `sessions` document, as the pane last read it
// (document-source.ts), into the tree (team.ts teamTree, at the pane's clock's now) and writes it only when it
// changed, looking every POLL_MS (live.ts) and only while the tab shows, as the Log view's LiveLog does. Before a
// document is held the tab says it is reading; no team file stands in for one. The pane's own team's register tasks,
// its sessions' cards on the owner and their tasks counted (task-counts.ts) go with it, and each team's week from
// its week file (team-weeks.ts, T1713); a peer team's register is not the pane's, so its sessions show none of them.
// A team folder teamrig could not serve is left out and named with teamrig's reason (T1234); the others draw on.
// TeamFolder, one team's config, logs and week file read from its folder, is what the Stats tab still folds
// (stats-source.ts).
import type { SessionOwnerCards, TaskCounts, TaskRow, TeamView } from '../types'
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
import { teamStateDir } from './places'
import type { SessionsRead } from './sessions-document'
import { WatchedFile, type Files } from './source'
import { teamTree, type TeamRead, type TeamRegister } from './team'

/**
 * What the pane reads of its own team beside its folder: the register's tasks, each session's cards on the owner and
 * its tasks counted. No inbox is among them: a session's unread lines are teamrig's to serve (the `sessions`
 * document), never counted here from the inbox files.
 */
export type OwnReads = {
  readonly tasks: readonly TaskRow[]
  readonly ownerCards: Readonly<Record<string, SessionOwnerCards>>
  readonly taskCounts: TaskCounts
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
   * The team's files as read now, with `own` for the pane's own team (null for a peer's): its tasks and its sessions'
   * cards on the owner and task counts. Null when it has no config file or teamrig refuses the one there. A config
   * that moves its state folder reads the logs and the week file from the new one. A failed read throws, keeping the
   * stamps of the files read before it, so the next read tries the rest again, and keeps the last read that worked
   * (lastRead).
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
    const read: TeamRead = {
      team: this.team,
      config: config.config,
      renames: files.renames.current,
      hires: files.hires.current,
      week: files.week.current,
      ...ownParts(own),
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
  /** teamrig's `sessions` document as the pane last read it; null before the first one. */
  sessions: () => SessionsRead | null
  /** Each of the teams' own week, by team id, a team with none absent (team-weeks.ts). */
  weeks: (teams: readonly string[]) => Promise<ReadonlyMap<string, TeamWeekSummary>>
  /** The pane's own team's register tasks, its sessions' cards on the owner and their tasks counted, as the pane last read them. */
  register: () => Promise<TeamRegister>
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
  /** The pane's own team. */
  private readonly team: string
  private readonly ports: TeamPorts
  private timers: Timer[] = []
  private isPolling = false
  /** The view last written, as JSON: a read that finds the same tree writes nothing. */
  private shown: string | null = null

  constructor(team: string, ports: TeamPorts) {
    this.team = team
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
   * The tree of the `sessions` document held now, each team teamrig could not serve left out and named with
   * teamrig's reason; that it is not read yet, before a document; or why the register or the weeks could not be read.
   */
  private async read(): Promise<TeamView> {
    try {
      const read = this.ports.sessions()
      if (read === null) return { kind: 'reading' }
      const registers = new Map([[this.team, await this.ports.register()]])
      const weeks = await this.ports.weeks(read.teams.map(team => team.id))
      const root = teamTree({ read, own: this.team, registers, weeks, now: await this.ports.now() })
      // teamrig serves no last read of a folder it cannot read, so a failed team is never drawn.
      return { kind: 'tree', root, failures: read.failures.map(failure => ({ ...failure, isLastRead: false })) }
    } catch (error) {
      return { kind: 'failed', reason: reasonOf(error) }
    }
  }
}
