// The week files of the Teams tab's teams (T1713, T4742): each team's own week as teamrig's budget hooks last wrote it
// (`usage/team.week.json` in the state folder its config names), numbers only. teamrig's `sessions` document serves
// who is on a team and not yet its week, so these files are the one thing the tab still reads itself. A team is read
// only when the kit home lists a folder of its id, so an id from a document is never made a path unchecked. Each file
// is re-read only when its stamp moves (source.ts WatchedFile). A read that fails keeps the team's last week: the bar
// stays as it was, and the team itself is teamrig's to name as failed.
import { parseConfigText, parseTeamWeek, type TeamWeekSummary } from './core/read/index'
import { teamIds, teamStateDir } from './places'
import { WatchedFile, type Files } from './source'

/** One team's week file, found through its config. */
class TeamWeekFile {
  private readonly files: Files
  /** The state folder the team's config names; null with no config, or one teamrig refuses. */
  private readonly state: WatchedFile<string | null>
  /** The week file in the state folder last named; made again when the config moves that folder. */
  private week: WatchedFile<TeamWeekSummary | null> | null = null
  /** The week last read; null for none, or a file teamrig cannot read. */
  private last: TeamWeekSummary | null = null

  constructor(files: Files, home: string) {
    this.files = files
    this.state = new WatchedFile<string | null>(
      files,
      `${home}/config.json`,
      text => {
        const config = parseConfigText(text)
        return config.status === 'loaded' ? teamStateDir(home, config.config) : null
      },
      null,
    )
  }

  /** The team's week now; its last one when a file cannot be read, which the next read tries again. */
  async read(): Promise<TeamWeekSummary | null> {
    try {
      await this.state.refresh()
      const state = this.state.current
      if (state === null) {
        this.week = null
        this.last = null
        return null
      }
      const path = `${state}/usage/team.week.json`
      // A damaged file, or one in a format this pane cannot read, shows no week, as a missing one does.
      const week = this.week?.path === path ? this.week : new WatchedFile<TeamWeekSummary | null>(this.files, path, text => parseTeamWeek(text) ?? null, null)
      this.week = week
      await week.refresh()
      this.last = week.current
    } catch {
      // The last week stays.
    }
    return this.last
  }

  get held(): TeamWeekSummary | null {
    return this.last
  }
}

/** The week files of the teams asked for, each kept between reads. */
export class TeamWeeks {
  private readonly files: Files
  private readonly teamsDir: string
  private readonly folders: (dir: string) => Promise<readonly string[]>
  /** Each team read, by id; one whose folder is no longer listed is dropped, so a team made again is read anew. */
  private readonly teams = new Map<string, TeamWeekFile>()

  /** `folders` names the folders right under a folder, and rejects when it cannot list one. */
  constructor(files: Files, teamsDir: string, folders: (dir: string) => Promise<readonly string[]>) {
    this.files = files
    this.teamsDir = teamsDir
    this.folders = folders
  }

  /**
   * The week of each of `teams` that has a folder in the kit home and a week file, by team id. When the folders
   * cannot be listed, the weeks last read.
   */
  async read(teams: readonly string[]): Promise<ReadonlyMap<string, TeamWeekSummary>> {
    const weeks = new Map<string, TeamWeekSummary>()
    const listed = await this.listed()
    if (listed !== null) for (const id of [...this.teams.keys()]) if (!listed.includes(id)) this.teams.delete(id)
    for (const id of teams) {
      const week = listed === null ? (this.teams.get(id)?.held ?? null) : listed.includes(id) ? await this.fileOf(id).read() : null
      if (week !== null) weeks.set(id, week)
    }
    return weeks
  }

  /** The team ids the kit home holds a folder of; null when it cannot be listed. */
  private async listed(): Promise<readonly string[] | null> {
    try {
      return teamIds(await this.folders(this.teamsDir))
    } catch {
      return null
    }
  }

  private fileOf(id: string): TeamWeekFile {
    const file = this.teams.get(id) ?? new TeamWeekFile(this.files, `${this.teamsDir}/${id}`)
    this.teams.set(id, file)
    return file
  }
}
