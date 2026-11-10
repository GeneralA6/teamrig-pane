// The tasks the team tree's other registers hold, read as teamrig's TreeTasks reads them (src/cli/tree-tasks.ts): the
// team folders' configs give the tree, its walk from the root gives the registers in order, and each register's
// working set counts, the first to hold an id winning. A poll that finds nothing new costs a few stats: a config or a
// register is re-read only when its stamp moves.
import type { TaskElsewhere } from '../types'
import { parseConfigText, Roster, TeamTree, teamNodeOf, type ConfigRead } from './core/read/index'
import type { ElsewhereSource, TasksElsewhere } from './elsewhere'
import { messageOf } from './errors'
import { teamIds, teamStateDir, type TeamFiles } from './places'
import { LayoutRegister, WatchedFile, type Files } from './source'

type LoadedConfig = Extract<ConfigRead, { status: 'loaded' }>

/** A register of the tree: where its events sit, and whether a read of it ever came through. */
type PeerRegister = { readonly events: string; readonly register: LayoutRegister; read: boolean }

/**
 * The tasks of the registers the pane's team shares a tree with, its own register left out, as the last refresh found
 * them. Only each team's config is watched, not its hires or week as the Teams tab's TeamFolder reads them: the walk
 * reads no more than a team's parent and its state folder.
 */
export class TreeRegisters implements ElsewhereSource {
  private readonly files: Files
  private readonly team: TeamFiles
  private readonly folders: (path: string) => Promise<readonly string[]>
  /** Each team folder's config, by id, as last listed. */
  private readonly configs = new Map<string, WatchedFile<ConfigRead | null>>()
  /** The registers of the teams the walk reaches, the own team's left out, in walk order. */
  private registers = new Map<string, PeerRegister>()
  current: TasksElsewhere = new Map()
  problem: string | null = null

  /** `folders` lists the folders right under a folder, rejecting when it cannot list one. */
  constructor(files: Files, team: TeamFiles, folders: (path: string) => Promise<readonly string[]>) {
    this.files = files
    this.team = team
    this.folders = folders
  }

  /** True when the tasks or the problem moved. A config or register whose read fails counts as last read, and is named. */
  async refresh(): Promise<boolean> {
    const problems: string[] = []
    // The tree is walked again only when a config moved: a poll that finds none builds no tree.
    let tasksMoved = (await this.refreshConfigs(problems)) && this.rewalk()
    for (const [team, peer] of this.registers) {
      try {
        if (await peer.register.refresh()) tasksMoved = true
        peer.read = true
      } catch (error) {
        problems.push(`${team}'s register: ${messageOf(error)}`)
      }
    }
    if (tasksMoved) this.current = this.tasks()
    const problem = problems.length === 0 ? null : problems.join('; ')
    const problemMoved = problem !== this.problem
    this.problem = problem
    return tasksMoved || problemMoved
  }

  /** Re-reads each listed team's config, the listing kept from before when it fails; true when the configs moved. */
  private async refreshConfigs(problems: string[]): Promise<boolean> {
    let ids: string[]
    try {
      ids = teamIds(await this.folders(this.team.teamsDir))
    } catch (error) {
      problems.push(`team folders: ${messageOf(error)}`)
      ids = [...this.configs.keys()]
    }
    let moved = false
    for (const id of [...this.configs.keys()].filter(id => !ids.includes(id))) {
      this.configs.delete(id)
      moved = true
    }
    for (const id of ids) {
      const config = this.configs.get(id) ?? new WatchedFile<ConfigRead | null>(this.files, `${this.team.teamsDir}/${id}/config.json`, text => parseConfigText(text), null)
      this.configs.set(id, config)
      try {
        if (await config.refresh()) moved = true
      } catch (error) {
        problems.push(`${id}'s config: ${messageOf(error)}`)
      }
    }
    return moved
  }

  /**
   * The registers the walk from the tree's root reaches, the own team's left out, each kept while its events path
   * holds; none when the parents above the team go round a loop, which teamrig reads as no tree. True when they moved.
   */
  private rewalk(): boolean {
    const loaded = new Map<string, LoadedConfig>()
    for (const [id, config] of this.configs) {
      const read = config.current
      if (read?.status === 'loaded') loaded.set(id, read)
    }
    const tree = new TeamTree([...loaded].map(([id, read]) => teamNodeOf(id, read.config, new Roster(read.config, id, []))))
    const root = tree.rootOf(this.team.team)
    const walked = root === undefined ? [] : tree.walk(root).map(step => step.team)
    const registers = new Map<string, PeerRegister>()
    for (const team of walked) {
      const read = loaded.get(team)
      if (team === this.team.team || read === undefined) continue
      const events = `${teamStateDir(`${this.team.teamsDir}/${team}`, read.config)}/events.jsonl`
      const kept = this.registers.get(team)
      registers.set(team, kept?.events === events ? kept : { events, register: new LayoutRegister(this.files, events), read: false })
    }
    const before = [...this.registers].map(([team, peer]) => `${team}:${peer.events}`)
    const after = [...registers].map(([team, peer]) => `${team}:${peer.events}`)
    this.registers = registers
    return JSON.stringify(before) !== JSON.stringify(after)
  }

  /** Each register's tasks in walk order, the first to hold an id winning; a register never read counts as none. */
  private tasks(): TasksElsewhere {
    const tasks = new Map<string, TaskElsewhere>()
    for (const [team, peer] of this.registers) {
      if (!peer.read) continue
      for (const task of peer.register.current.state.tasks.values()) {
        if (!tasks.has(task.id)) tasks.set(task.id, { team, task })
      }
    }
    return tasks
  }
}
