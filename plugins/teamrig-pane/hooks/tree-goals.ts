// The goals a team's tasks may serve, read as teamrig's KitTreeGoals reads them (src/cli/tree-goals.ts): the team's own
// goal records and those of every team above it, so a task on a ranked goal sits where `teamrig list` puts it
// (ranking.ts). Each file is re-read only when its stamp moves; a poll that finds nothing new costs a few stats.
import type { GoalRanks } from '../types'
import { GOALS_FILE, parseConfigText, readGoals, type ConfigRead } from './core/read/index'
import { teamStateDir, type TeamFiles } from './places'
import { WatchedFile, type Files, type GoalSource } from './source'

/** No goals: what a snapshot holds before the first read, and a team with no goals file. */
export const NO_GOAL_RANKS: GoalRanks = {}

/** What a ranking reads of a goals file: each goal's parent and rank, so a new title or target moves nothing. */
function ranksIn(text: string): GoalRanks {
  return Object.fromEntries([...readGoals(text).goals].map(([tag, { parent, rank }]) => [tag, { parent, rank }]))
}

/** A team's folder as the walk up the tree reads it: its config, then the goals file in the state folder that config names. */
class GoalFolder {
  private readonly files: Files
  private readonly home: string
  private readonly config: WatchedFile<ConfigRead | null>
  private goals: WatchedFile<GoalRanks> | null = null

  constructor(files: Files, home: string) {
    this.files = files
    this.home = home
    this.config = new WatchedFile<ConfigRead | null>(files, `${home}/config.json`, text => parseConfigText(text), null)
  }

  async refresh(): Promise<void> {
    await this.config.refresh()
    const read = this.config.current
    if (read?.status !== 'loaded') {
      this.goals = null
      return
    }
    const path = `${teamStateDir(this.home, read.config)}/${GOALS_FILE}`
    if (this.goals?.path !== path) this.goals = new WatchedFile(this.files, path, ranksIn, NO_GOAL_RANKS)
    await this.goals.refresh()
  }

  /** The team above it; null for a root, and with no config teamrig takes, as such a team stands in no tree. */
  get parent(): string | null {
    const read = this.config.current
    return read?.status === 'loaded' ? (read.config.team?.parent ?? null) : null
  }

  get ranks(): GoalRanks {
    return this.goals?.current ?? NO_GOAL_RANKS
  }
}

/** The goals of the pane's register and of the teams above its team, as the last refresh found them. */
export class TreeGoals implements GoalSource {
  private readonly files: Files
  private readonly team: TeamFiles | null
  /** The goals beside the events the pane reads, which a setting may place away from the team's state folder. */
  private readonly own: WatchedFile<GoalRanks>
  private readonly ownConfig: WatchedFile<ConfigRead | null> | null
  /** Each team above read so far, by id. */
  private readonly folders = new Map<string, GoalFolder>()
  current: GoalRanks = NO_GOAL_RANKS

  /** `team` null: a register named with no team, which has no tree above it. */
  constructor(files: Files, goalsPath: string, team: TeamFiles | null) {
    this.files = files
    this.team = team
    this.own = new WatchedFile(files, goalsPath, ranksIn, NO_GOAL_RANKS)
    this.ownConfig = team === null ? null : new WatchedFile<ConfigRead | null>(files, team.config, text => parseConfigText(text), null)
  }

  /** True when a rank or parent moved. A tag two teams hold reads as the nearest team's, as in teamrig. */
  async refresh(): Promise<boolean> {
    await this.own.refresh()
    await this.ownConfig?.refresh()
    const above = await this.above()
    const ranks: GoalRanks = Object.assign({}, ...above.map(folder => folder.ranks), this.own.current)
    if (JSON.stringify(ranks) === JSON.stringify(this.current)) return false
    this.current = ranks
    return true
  }

  /** The teams above, the root first; none when the parents go round a loop, which teamrig reads as no tree above. */
  private async above(): Promise<GoalFolder[]> {
    if (this.team === null) return []
    const read = this.ownConfig?.current
    const walked = new Set([this.team.team])
    const chain: GoalFolder[] = []
    let parent = read?.status === 'loaded' ? (read.config.team?.parent ?? null) : null
    while (parent !== null) {
      if (walked.has(parent)) return []
      walked.add(parent)
      const folder = await this.folderOf(this.team.teamsDir, parent)
      chain.unshift(folder)
      parent = folder.parent
    }
    return chain
  }

  private async folderOf(teamsDir: string, team: string): Promise<GoalFolder> {
    const folder = this.folders.get(team) ?? new GoalFolder(this.files, `${teamsDir}/${team}`)
    this.folders.set(team, folder)
    await folder.refresh()
    return folder
  }
}
