// Loads the register's files for one Claude session: each file is re-read only when its size
// or mtime moved, so a poll that finds nothing new costs a few stats and no parsing (the usage
// folder a listing at most every minute, usage.ts).
// File access goes through `Files`, which register.tsx backs with $.fs and tests with a fake.
import type { AreaSource, Snapshot, TaskRow } from '../types'
import { parseEvent, type TaskEvent } from './core/events'
import { parseAlias, type AliasRecord } from './core/names'
import { parsePauseRecord, type PauseLogRecord } from './core/pauses'
import {
  areaOfSession,
  countInboxLines,
  parseJsonl,
  parseMark,
  readTasks,
  readTo,
  unreadLines,
  type InboxMark,
  type Parsed,
} from './log'
import { UsageRuns } from './usage'
import { isActive, isRecentlyFinished } from './view'

export type FileStamp = { mtimeMs: number; size: number }

/** A file in a listed folder, with its stamp. */
export type ListedFile = FileStamp & { name: string }

export interface Files {
  /** null when nothing is at the path. */
  stamp(path: string): Promise<FileStamp | null>
  read(path: string): Promise<string>
  /** The files in a folder (not its sub-folders); empty when the folder is not there. */
  list(dir: string): Promise<ListedFile[]>
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
 * The register's files: its events, renames and pauses, which the tasks are folded from, the inbox read marks, and
 * the token-usage folder an estimate's share of a fleet week is read from.
 */
export type RegisterPaths = { events: string; aliases: string; pauses: string; marks: string; inboxDir: string; usageDir: string }

/** The register's folders: its tasks folder (events, renames, pauses, inbox read marks), its inbox and its token-usage folder. */
export type RegisterDirs = { tasksDir: string; inboxDir: string; usageDir: string }

/** A path with forward slashes and no trailing one. */
export function slashed(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/+$/, '')
}

/** The register's files under its folders, with slashes made forward. */
export function registerPaths(dirs: RegisterDirs): RegisterPaths {
  const tasks = slashed(dirs.tasksDir)
  const inbox = slashed(dirs.inboxDir)
  const usage = slashed(dirs.usageDir)
  return {
    events: `${tasks}/events.jsonl`,
    aliases: `${tasks}/aliases.jsonl`,
    pauses: `${tasks}/pauses.jsonl`,
    marks: `${tasks}/inbox-marks.jsonl`,
    inboxDir: inbox,
    usageDir: usage,
  }
}

/**
 * The most one read copies: $.fs.read rejects a bigger file, and has no ranged read. The register is
 * append-only (about 320 bytes an event), so it reaches this near 13,000 events unless it is rotated.
 */
export const MAX_READ_BYTES = 4 * 1024 * 1024

/** A file the pane cannot read at once, named with its size; checked on the stamp, so the read is never tried. */
export function tooBig(path: string, size: number): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return `${name} is ${(size / 2 ** 20).toFixed(2)} MiB, over the 4 MiB a pane can read at once: it needs rotating`
}

/** One file's parsed content, refreshed when its stamp moves; a missing file reads as `empty`. */
class WatchedFile<T> {
  private stampKey: string | null = null
  private value: T

  constructor(
    private readonly files: Files,
    readonly path: string,
    private readonly parse: (content: string) => T,
    private readonly empty: T,
  ) {
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

/** force: build a snapshot even when no file moved (after a failed poll or a new pin). */
export type PollInput = { claudeSession: string; pinned: string | null; now: number; force?: boolean }

export class TaskRegisterSource {
  private readonly events: WatchedFile<Parsed<TaskEvent>>
  private readonly aliases: WatchedFile<Parsed<AliasRecord>>
  private readonly pauses: WatchedFile<Parsed<PauseLogRecord>>
  private readonly marks: WatchedFile<Parsed<InboxMark>>
  private readonly usage: UsageRuns
  /**
   * The tasks a drawing can show, as the register's three logs and the usage run last folded: the active
   * ones and those finished within a day. Every draw reads the snapshot, so it grows with the live tasks,
   * never with the register's history; a finished task ages out of the views between folds (view.ts).
   */
  private tasks: TaskRow[] = []
  private inbox: WatchedFile<number> | null = null
  private lastArea: string | null = null

  constructor(
    private readonly files: Files,
    private readonly paths: RegisterPaths,
  ) {
    this.events = new WatchedFile(files, paths.events, content => parseJsonl(content, parseEvent), { records: [], skipped: 0 })
    this.aliases = new WatchedFile(files, paths.aliases, content => parseJsonl(content, parseAlias), { records: [], skipped: 0 })
    this.pauses = new WatchedFile(files, paths.pauses, content => parseJsonl(content, parsePauseRecord), { records: [], skipped: 0 })
    this.marks = new WatchedFile(files, paths.marks, content => parseJsonl(content, parseMark), { records: [], skipped: 0 })
    this.usage = new UsageRuns(files, paths.usageDir)
  }

  /** A new snapshot when anything it draws from changed since the last poll (or `force`), else null. */
  async poll({ claudeSession, pinned, now, force = false }: PollInput): Promise<Snapshot | null> {
    // Each refresh runs (no short circuit), so every file that moved is read in this poll.
    const moved = [await this.events.refresh(), await this.aliases.refresh(), await this.pauses.refresh(), await this.usage.refresh(now)]
    const registerChanged = moved.includes(true)
    if (registerChanged) {
      const logs = {
        events: this.events.current.records,
        aliases: this.aliases.current.records,
        pauses: this.pauses.current.records,
        usage: this.usage.current,
      }
      this.tasks = readTasks(logs, now).filter(task => isActive(task) || isRecentlyFinished(task, now))
    }
    const marksChanged = await this.marks.refresh()
    const marks = this.marks.current.records
    const inboxArea = areaOfSession(marks, claudeSession)
    const area = pinned ?? inboxArea
    const areaSource: AreaSource | null = pinned !== null ? 'pinned' : inboxArea !== null ? 'inbox-read' : null
    const areaChanged = area !== this.lastArea
    if (areaChanged) this.inbox = area === null ? null : new WatchedFile(this.files, `${this.paths.inboxDir}/${area}.md`, countInboxLines, 0)
    this.lastArea = area
    const inboxChanged = this.inbox ? await this.inbox.refresh() : false
    if (!force && !registerChanged && !marksChanged && !areaChanged && !inboxChanged) return null

    const skipped = [this.events, this.aliases, this.pauses, this.marks].reduce((sum, file) => sum + file.current.skipped, 0)
    return {
      tasks: this.tasks,
      area,
      areaSource,
      unreadInbox: area !== null && this.inbox ? unreadLines(this.inbox.current, readTo(marks, area)) : null,
      problem: skipped > 0 ? `${skipped} register line(s) this pane cannot read` : null,
      now,
    }
  }
}
