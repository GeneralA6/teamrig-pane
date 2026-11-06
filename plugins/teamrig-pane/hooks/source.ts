// Loads the register's files for one Claude session: each file is re-read only when its size or
// mtime moved, so a poll that finds nothing new costs a few stats and no parsing. Each file is parsed
// and the register put together by teamrig's own read entry (hooks/core/read), so the pane shows what
// teamrig's commands show, on a register never rotated and on a rotated one alike.
// File access goes through `Files`, which register.tsx backs with $.fs and tests with a fake.
import type { AreaSource, DrawnSettings, GoalRanks, OwnerSettings, SessionOwnerCards, Snapshot, TaskCounts, TaskRow, TeamLeads, TeamSettings, WorkMark } from '../types'
import {
  assemble,
  GOALS_FILE,
  indexMarks,
  inboxLines,
  layoutPaths,
  MissingSegmentError,
  parseConfigText,
  readEvents,
  readMarks,
  readRegister,
  readRenames,
  readSnapshotText,
  Roster,
  taskNumber,
  unreadOf,
  workingSetPlan,
  type ConfigRead,
  type EventLogRead,
  type LayoutPaths,
  type MarkLogRead,
  type RegisterSnapshot,
  type Rename,
  type SnapshotRead,
  type TimeZone,
} from './core/read/index'
import { lineHash } from './line-hash'
import { isHeldFinished } from './done'
import { inboxItems } from './inbox'
import { teamLeads } from './leads'
import { rowOf } from './log'
import { ownerCardsOf } from './owner-cards'
import type { TeamFiles } from './places'
import { NO_TASK_COUNTS, taskCountsOf } from './task-counts'
import { isActive } from './view'
import { workMarks } from './work'
import { zoneNamed } from './zone'

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000

export type FileStamp = { mtimeMs: number; size: number }

export interface Files {
  /** null when nothing is at the path. */
  stamp(path: string): Promise<FileStamp | null>
  read(path: string): Promise<string>
}

/** A refusal naming a file that is there but cannot be read now: locked by a writer, or denied. */
const UNREADABLE = /\b(EBUSY|EPERM|EACCES)\b/

/**
 * `call`'s answer, or `missing` when nothing is at the path. A failed stat or listing counts as
 * missing only when `exists` says so and the error names no locked or denied file: Windows answers
 * `exists` false for a file it denies (a pending delete, an ACL), and reading that as missing would
 * empty the register for a poll. Thrown instead, the poll keeps the last good tasks under the problem.
 */
export async function unlessMissing<T, M>(call: () => Promise<T>, exists: () => Promise<boolean>, missing: M): Promise<T | M> {
  try {
    return await call()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (UNREADABLE.test(message) || (await exists())) throw error
    return missing
  }
}

/**
 * The register's files: the events the tasks are folded from (the tail, beside which a rotated register
 * keeps its snapshot and archive, named by teamrig's layoutPaths), the inbox read marks, the team's goals, and the inbox
 * folder.
 */
export type RegisterPaths = { events: string; marks: string; goals: string; inboxDir: string }

/** The register's folders: its state folder (events, inbox read marks, goals) and its inbox folder. */
export type RegisterDirs = { tasksDir: string; inboxDir: string }

/** A path with forward slashes and no trailing one. */
export function slashed(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/+$/, '')
}

/** The register's files under its folders, named as teamrig names them, with slashes made forward. */
export function registerPaths(dirs: RegisterDirs): RegisterPaths {
  const tasks = slashed(dirs.tasksDir)
  return { events: `${tasks}/events.jsonl`, marks: `${tasks}/inbox-marks.jsonl`, goals: `${tasks}/${GOALS_FILE}`, inboxDir: slashed(dirs.inboxDir) }
}

/**
 * The goals a ranking reads (tree-goals.ts TreeGoals), handed in as tree-goals.ts reads WatchedFile from here: `refresh`
 * answers true when a rank or a parent moved, and a throw keeps the last good ranks.
 */
export type GoalSource = { refresh(): Promise<boolean>; readonly current: GoalRanks }

/**
 * The most one read copies: $.fs.read rejects a bigger file, and has no ranged read. A register never
 * rotated is one append-only file (about 320 bytes an event), so it reaches this near 13,000 events. A
 * rotated one splits its history into archive segments and keeps the working set in its snapshot, so the
 * pane reads small files: the snapshot and tail on each change, and a segment only when the snapshot
 * cannot be used (and then once, as segments never change).
 */
export const MAX_READ_BYTES = 4 * 1024 * 1024

/** The last part of a path. */
function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** A file the pane cannot read at once, named with its size; checked on the stamp, so the read is never tried. */
export function tooBig(path: string, size: number): string {
  return `${fileName(path)} is ${(size / 2 ** 20).toFixed(2)} MiB, over the 4 MiB a pane can read at once: it needs rotating`
}

/**
 * The lines teamrig's reader skipped, in the words of its own WARN line (register commands): damaged
 * lines, lines from a newer teamrig and events naming no task, then the inbox marks'; null when none.
 */
export function skippedText(paths: RegisterPaths, register: RegisterSnapshot, marks: MarkLogRead): string | null {
  const { unreadable, newer } = register.read
  const { orphans } = register.state
  const parts: string[] = []
  if (unreadable + newer + orphans > 0) {
    parts.push(
      `${fileName(paths.events)}: ${unreadable} unreadable line(s), ${newer} line(s) from a newer teamrig, ${orphans} event(s) naming no task`,
    )
  }
  if (marks.unreadable + marks.newer > 0) {
    parts.push(`${fileName(paths.marks)}: ${marks.unreadable} unreadable line(s), ${marks.newer} line(s) from a newer teamrig`)
  }
  return parts.length > 0 ? parts.join('; ') : null
}

/** One file's parsed content, refreshed when its stamp moves; a missing file reads as `empty`. */
export class WatchedFile<T> {
  private stampKey: string | null = null
  private value: T
  private readonly files: Files
  readonly path: string
  private readonly parse: (content: string) => T
  private readonly empty: T

  constructor(files: Files, path: string, parse: (content: string) => T, empty: T) {
    this.files = files
    this.path = path
    this.parse = parse
    this.empty = empty
    this.value = empty
  }

  get current(): T {
    return this.value
  }

  /**
   * True when the content changed. A failed read keeps the old stamp, so the next poll retries; so does
   * a file over MAX_READ_BYTES, which throws before the read, keeping the last good content drawn.
   */
  async refresh(): Promise<boolean> {
    const stamp = await this.files.stamp(this.path)
    const key = stamp ? `${stamp.mtimeMs}:${stamp.size}` : 'missing'
    if (key === this.stampKey) return false
    if (stamp && stamp.size > MAX_READ_BYTES) throw new Error(tooBig(this.path, stamp.size))
    this.value = stamp ? this.parse(await this.files.read(this.path)) : this.empty
    this.stampKey = key
    return true
  }
}

/**
 * The team's session names, as teamrig's Roster gives them over the team's config and rename log, and who leads whom
 * (leads.ts), each file re-read only when its stamp moves, so a rename or a promotion shows on the next poll. A missing
 * config, or one teamrig refuses, names no session and no lead (places.ts already refused the pane for a config it
 * cannot read).
 */
class TeamNames {
  readonly team: string
  private readonly config: WatchedFile<ConfigRead | null>
  private readonly renames: WatchedFile<readonly Rename[]>
  private roster: Roster | null = null
  /** The lead tree of the config last read; null with none read. */
  leads: TeamLeads | null = null

  constructor(files: Files, team: TeamFiles) {
    this.team = team.team
    this.config = new WatchedFile<ConfigRead | null>(files, team.config, text => parseConfigText(text), null)
    this.renames = new WatchedFile<readonly Rename[]>(files, team.renames, text => readRenames(text).renames, [])
  }

  /** True when the names or the leads may have changed: the config or the rename log moved. */
  async refresh(): Promise<boolean> {
    const configMoved = await this.config.refresh()
    const renamesMoved = await this.renames.refresh()
    if (!configMoved && !renamesMoved) return false
    const read = this.config.current
    this.roster = read?.status === 'loaded' ? new Roster(read.config, this.team, this.renames.current) : null
    this.leads = read?.status === 'loaded' ? teamLeads(read.config) : null
    return true
  }

  /** The name teamrig messages the session by; null with no config read, or for an id that is not on the team. */
  nameOf(id: string): string | null {
    return this.roster?.nameOf(id) ?? null
  }
}

/**
 * Archive segment `n` of the register at `paths`, checked on its stamp: one that is gone (MissingSegmentError) or over
 * MAX_READ_BYTES throws before any read. A segment is never rewritten once rotated, so a caller reads each once.
 */
export async function readSegment(files: Files, paths: LayoutPaths, n: number): Promise<EventLogRead> {
  const path = paths.segment(n)
  const stamp = await files.stamp(path)
  if (stamp === null) throw new MissingSegmentError(path)
  if (stamp.size > MAX_READ_BYTES) throw new Error(tooBig(path, stamp.size))
  return readEvents(await files.read(path))
}

/**
 * The register as teamrig's working-set read puts it together (core register/layout.ts): the snapshot,
 * the archive segments it does not cover, then the tail. A register never rotated has neither snapshot nor
 * segments, so it is its tail alone, as before rotation. The snapshot is refreshed before the tail, as
 * teamrig reads them: a rotation replaces the tail before it writes the snapshot, so a snapshot read first
 * never covers more than the tail read after it names.
 */
class LayoutRegister {
  private readonly snapshot: WatchedFile<SnapshotRead>
  private readonly tail: WatchedFile<EventLogRead>
  /** The segments the last read plan named, by number: a segment is never rewritten, so each is read once. */
  private segments = new Map<number, EventLogRead>()
  private value: RegisterSnapshot = readRegister('')
  /** True until a read put the register together: a failed one (a segment missing or locked) is retried on the next poll, though no file moved. */
  private stale = true
  private readonly files: Files
  private readonly paths: LayoutPaths

  constructor(files: Files, eventsPath: string) {
    this.files = files
    this.paths = layoutPaths(eventsPath)
    this.snapshot = new WatchedFile(files, this.paths.snapshot, readSnapshotText, readSnapshotText(undefined))
    this.tail = new WatchedFile(files, this.paths.tail, readEvents, readEvents(''))
  }

  get current(): RegisterSnapshot {
    return this.value
  }

  /** True when the register changed. A throw keeps the last good register, so the pane keeps drawing it under the problem. */
  async refresh(): Promise<boolean> {
    const snapshotMoved = await this.snapshot.refresh()
    const tailMoved = await this.tail.refresh()
    if (!snapshotMoved && !tailMoved && !this.stale) return false
    this.stale = true
    const plan = workingSetPlan(this.snapshot.current, this.tail.current)
    const segments = new Map<number, EventLogRead>()
    for (const n of plan.segments) segments.set(n, this.segments.get(n) ?? (await readSegment(this.files, this.paths, n)))
    this.segments = segments
    this.value = assemble(plan, [...segments.values()], this.tail.current)
    this.stale = false
    return true
  }
}

/** force: build a snapshot even when no file moved (after a failed poll or a new pin). */
export type PollInput = { claudeSession: string; pinned: string | null; now: number; force?: boolean }

export class TaskRegisterSource {
  private readonly register: LayoutRegister
  private readonly marks: WatchedFile<MarkLogRead>
  /**
   * The tasks a drawing can show, as the events last folded: the active ones and those finished within HELD_DAYS of
   * the fold (done.ts isHeldFinished, teamrig's own retention), which Done today, the Done page and search read. Every
   * draw reads the snapshot, so it grows with the live tasks and the last days' finished ones, never with the
   * register's history, on a register never rotated as on a rotated one (whose working set keeps those days whole).
   */
  private tasks: TaskRow[] = []
  /** The sessions' work on their own tasks over the turn log's kept hours, as the events last folded (work.ts). */
  private work: readonly WorkMark[] = []
  /** Each session's tasks counted over every task folded, finished long ago or not (task-counts.ts), as the events last folded. */
  private taskCounts: TaskCounts = NO_TASK_COUNTS
  private inbox: WatchedFile<string[]> | null = null
  private lastArea: string | null = null
  private readonly files: Files
  private readonly paths: RegisterPaths
  /** The team config's settings each snapshot carries (places.ts teamSettings), read once when the session starts. */
  private readonly drawn: DrawnSettings
  /** The team config's settings that decide which waits are the owner's, read with the others. */
  private readonly owner: OwnerSettings
  /** The team's zone, the day a card is put off to ends in. */
  private readonly zone: TimeZone
  /** Each session's cards on the owner, as last counted (owner-cards.ts). */
  private ownerCards: Record<string, SessionOwnerCards> = {}
  /** The minute they were last counted at: while a card is put off, a new minute counts them again. */
  private ownerCardsMinute = -1
  /** The team's session names, for the area's name; null when the pane found no team. */
  private readonly names: TeamNames | null
  /** The hours the team keeps its turn log, the work marks' window; null with no team or no team config, which have none. */
  private readonly keepHours: number | null
  /** The goals of the tree, which a task's score and the owner's cards' order read. */
  private readonly goals: GoalSource

  constructor(files: Files, paths: RegisterPaths, settings: TeamSettings, team: TeamFiles | null, goals: GoalSource) {
    this.files = files
    this.paths = paths
    this.goals = goals
    const { requireDecisionCard, ...drawn } = settings
    this.drawn = drawn
    this.owner = { ownerSource: settings.ownerSource, requireDecisionCard, focus: settings.focus }
    this.zone = zoneNamed(settings.timeZone)
    this.register = new LayoutRegister(files, paths.events)
    this.marks = new WatchedFile(files, paths.marks, readMarks, readMarks(''))
    this.names = team === null ? null : new TeamNames(files, team)
    this.keepHours = team?.turnLog?.keepHours ?? null
  }

  /** A new snapshot when anything it draws from changed since the last poll (or `force`), else null. */
  async poll({ claudeSession, pinned, now, force = false }: PollInput): Promise<Snapshot | null> {
    const registerChanged = await this.register.refresh()
    if (registerChanged) {
      this.tasks = [...this.register.current.state.tasks.values()]
        .map(task => rowOf(task))
        .filter(task => isActive(task) || isHeldFinished(task, now))
        .sort((a, b) => taskNumber(a.id) - taskNumber(b.id))
      // The working set keeps each live and recently finished task's whole history, so its events cover the window;
      // a task a compaction retired that is touched again marks nothing, its create no longer read.
      this.work = this.keepHours === null ? [] : workMarks(this.register.current.read.events, now - this.keepHours * HOUR_MS)
      this.taskCounts = taskCountsOf(this.register.current.state.tasks.values(), this.register.current.retired !== null)
    }
    // Before the cards: a moved rank reorders them with no register event.
    const goalsChanged = await this.goals.refresh()
    const ownerChanged = this.refreshOwnerCards(registerChanged || goalsChanged, now)
    const marksChanged = await this.marks.refresh()
    const { byArea, areaBySession } = indexMarks(this.marks.current.marks)
    const inboxArea = areaBySession.get(claudeSession) ?? null
    const area = pinned ?? inboxArea
    const areaSource: AreaSource | null = pinned !== null ? 'pinned' : inboxArea !== null ? 'inbox-read' : null
    const areaChanged = area !== this.lastArea
    if (areaChanged) this.inbox = area === null ? null : new WatchedFile(this.files, `${this.paths.inboxDir}/${area}.md`, inboxLines, [])
    this.lastArea = area
    const inboxChanged = this.inbox ? await this.inbox.refresh() : false
    const namesChanged = this.names ? await this.names.refresh() : false
    if (!force && !registerChanged && !goalsChanged && !ownerChanged && !marksChanged && !areaChanged && !inboxChanged && !namesChanged) return null

    // An area that never ran `inbox read` has no mark: its count is unknown, not everything.
    const mark = area === null ? undefined : byArea.get(area)
    const lines = this.inbox?.current ?? []
    const unread = area !== null && mark !== undefined ? unreadOf(area, lines, mark, lineHash) : null
    return {
      tasks: this.tasks,
      area,
      areaSource,
      team: this.names?.team ?? null,
      areaName: area === null ? null : (this.names?.nameOf(area) ?? null),
      leads: this.names?.leads ?? null,
      work: this.work,
      unreadInbox: unread === null ? null : unread.lines.length,
      inbox: inboxItems(lines, unread === null ? null : unread.total - unread.lines.length, now),
      problem: skippedText(this.paths, this.register.current, this.marks.current),
      ...this.drawn,
      goals: this.goals.current,
      ownerCards: this.ownerCards,
      taskCounts: this.taskCounts,
      now,
    }
  }

  /**
   * Counts the cards on the owner again when the register or the goals moved, or when a card is put off and a minute
   * passed (its time may have come); true when they changed.
   */
  private refreshOwnerCards(ranksMoved: boolean, now: number): boolean {
    const minute = Math.floor(now / MINUTE_MS)
    const putOff = Object.values(this.ownerCards).some(cards => cards.later.length > 0)
    if (!ranksMoved && !(putOff && minute !== this.ownerCardsMinute)) return false
    this.ownerCardsMinute = minute
    const cards = ownerCardsOf(this.register.current.state.tasks, now, this.zone, this.owner, this.goals.current)
    if (JSON.stringify(cards) === JSON.stringify(this.ownerCards)) return false
    this.ownerCards = cards
    return true
  }
}
