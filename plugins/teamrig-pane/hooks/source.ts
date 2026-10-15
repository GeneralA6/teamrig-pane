// Loads the register's files for one Claude session: each file is re-read only when its size or
// mtime moved, so a poll that finds nothing new costs a few stats and no parsing. Each file is parsed
// by teamrig's own read entry (hooks/core/read), so the pane shows what teamrig's commands show.
// File access goes through `Files`, which register.tsx backs with $.fs and tests with a fake.
import type { AreaSource, Snapshot, TaskRow } from '../types'
import {
  indexMarks,
  inboxLines,
  readMarks,
  readRegister,
  taskNumber,
  unreadOf,
  type MarkLogRead,
  type PriorityConfig,
  type RegisterSnapshot,
} from './core/read/index'
import { lineHash } from './line-hash'
import { rowOf } from './log'
import { isActive, isRecentlyFinished } from './view'

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

/** The register's files: the events the tasks are folded from, the inbox read marks, and the inbox folder. */
export type RegisterPaths = { events: string; marks: string; inboxDir: string }

/** The register's folders: its state folder (events, inbox read marks) and its inbox folder. */
export type RegisterDirs = { tasksDir: string; inboxDir: string }

/** A path with forward slashes and no trailing one. */
export function slashed(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/+$/, '')
}

/** The register's files under its folders, named as teamrig names them, with slashes made forward. */
export function registerPaths(dirs: RegisterDirs): RegisterPaths {
  const tasks = slashed(dirs.tasksDir)
  return { events: `${tasks}/events.jsonl`, marks: `${tasks}/inbox-marks.jsonl`, inboxDir: slashed(dirs.inboxDir) }
}

/**
 * The most one read copies: $.fs.read rejects a bigger file, and has no ranged read. The register is
 * append-only (about 320 bytes an event), so it reaches this near 13,000 events unless it is rotated.
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
  private readonly events: WatchedFile<RegisterSnapshot>
  private readonly marks: WatchedFile<MarkLogRead>
  /**
   * The tasks a drawing can show, as the events last folded: the active ones and those finished within a
   * day. Every draw reads the snapshot, so it grows with the live tasks, never with the register's
   * history; a finished task ages out of the views between folds (view.ts).
   */
  private tasks: TaskRow[] = []
  private inbox: WatchedFile<string[]> | null = null
  private lastArea: string | null = null

  /** `priorities`: the team config's, which name each priority on a row; none leaves them unnamed. */
  constructor(
    private readonly files: Files,
    private readonly paths: RegisterPaths,
    private readonly priorities: readonly PriorityConfig[] = [],
  ) {
    this.events = new WatchedFile(files, paths.events, readRegister, readRegister(''))
    this.marks = new WatchedFile(files, paths.marks, readMarks, readMarks(''))
  }

  /** A new snapshot when anything it draws from changed since the last poll (or `force`), else null. */
  async poll({ claudeSession, pinned, now, force = false }: PollInput): Promise<Snapshot | null> {
    const registerChanged = await this.events.refresh()
    if (registerChanged) {
      this.tasks = [...this.events.current.state.tasks.values()]
        .map(task => rowOf(task, this.priorities))
        .filter(task => isActive(task) || isRecentlyFinished(task, now))
        .sort((a, b) => taskNumber(a.id) - taskNumber(b.id))
    }
    const marksChanged = await this.marks.refresh()
    const { byArea, areaBySession } = indexMarks(this.marks.current.marks)
    const inboxArea = areaBySession.get(claudeSession) ?? null
    const area = pinned ?? inboxArea
    const areaSource: AreaSource | null = pinned !== null ? 'pinned' : inboxArea !== null ? 'inbox-read' : null
    const areaChanged = area !== this.lastArea
    if (areaChanged) this.inbox = area === null ? null : new WatchedFile(this.files, `${this.paths.inboxDir}/${area}.md`, inboxLines, [])
    this.lastArea = area
    const inboxChanged = this.inbox ? await this.inbox.refresh() : false
    if (!force && !registerChanged && !marksChanged && !areaChanged && !inboxChanged) return null

    // An area that never ran `inbox read` has no mark: its count is unknown, not everything.
    const mark = area === null ? undefined : byArea.get(area)
    return {
      tasks: this.tasks,
      area,
      areaSource,
      unreadInbox: area !== null && this.inbox && mark !== undefined ? unreadOf(area, this.inbox.current, mark, lineHash).lines.length : null,
      problem: skippedText(this.paths, this.events.current, this.marks.current),
      now,
    }
  }
}
