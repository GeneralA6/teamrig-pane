// The Log view's reads: each team session's prompts and replies from the turn log teamrig writes:
// `<team state>/turn-log/<session id>/<UTC hour>.jsonl`, one JSON line per entry, only ever appended to. teamrig
// removes whole hour files past the team's kept hours (its config's `turnLog.keepHours`), so the oldest file kept
// can still hold older lines: the pane hides every line older than those hours. Each line is read by teamrig's
// parseEntry: one of another version, one that does not parse (a torn last line) or one missing a field is
// skipped, and fields the pane does not know are ignored. The list names the sessions with an hour file of the
// kept hours, the newest change first, with each one's newest prompt; a session's page holds its newest lines,
// oldest first, up to LOG_PAGE_CHARS of text, reading its files newest first and none past that. Each file read
// is kept with its size and mtime, so a poll reads again only a file that moved. While the Log view shows, a
// POLL_MS poll reads what it shows again, writing only what changed. Reads files only: no git, no model.
import type { LogList, LogPage, LogSession, TurnEntry } from '../types'
import { parseEntry, SESSION_NAME } from './core/read/index'
import { messageOf } from './errors'
import { POLL_MS, type Timer } from './live'

const HOUR_MS = 3_600_000
/** The most text a session's page holds, its newest lines: as much as a file page shows (ref-file.ts MAX_PAGE_BYTES), so a busy day never lays out megabytes. */
export const LOG_PAGE_CHARS = 256 * 1024
/** An hour's file, `2026-10-19T09.jsonl`: the names sort by time. */
const HOUR_FILE = /^(\d{4}-\d{2}-\d{2}T\d{2})\.jsonl$/
/** The most of a prompt's first line the list keeps: it draws two lines of it at most. */
const PROMPT_CHARS = 200

/** A folder's entry as the reader needs it: the engine's `$.fs.list` answers these. */
export type LogDirEntry = { name: string; kind: 'file' | 'dir' | 'other'; size: number; mtimeMs: number }

/** A team's turn log: its folder, and the hours teamrig keeps it (the team config's `turnLog.keepHours`), the view's window. */
export type TurnLogPlace = { dir: string; keepHours: number }

/** What the reader needs of the disk. */
export type LogFiles = {
  /** A folder's entries; null when nothing is at the path. */
  list: (dir: string) => Promise<readonly LogDirEntry[] | null>
  read: (path: string) => Promise<string>
}

type JsonRecord = Readonly<Record<string, unknown>>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A line's JSON object; null for one that does not parse, a torn last line among them, or one that is no object. */
function recordOf(line: string): JsonRecord | null {
  try {
    const value: unknown = JSON.parse(line)
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

/** A file's entries, oldest first: each line teamrig's parseEntry reads, blank lines skipped. */
export function parseTurnLines(text: string): TurnEntry[] {
  return text.split('\n').flatMap(raw => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (line.trim() === '') return []
    const record = recordOf(line)
    const entry = record === null ? undefined : parseEntry(record)
    return entry === undefined ? [] : [{ at: entry.at, kind: entry.kind, text: entry.text, claude: entry.claude, isCut: entry.truncated === true }]
  })
}

/** When the window of the last `hours` starts, at `now`. */
function windowStart(now: number, hours: number): number {
  return now - hours * HOUR_MS
}

/** True when the entry falls in the window that starts at `start`; one with an unreadable time never does. */
function isInWindow(entry: TurnEntry, start: number): boolean {
  const at = Date.parse(entry.at)
  return !Number.isNaN(at) && at >= start
}

/** An hour file of a session's folder: its path, its stamp, and when it changed. */
type HourFile = { path: string; stamp: string; changedAt: number }

/** A prompt's first line with text, cut at PROMPT_CHARS. */
function firstLine(text: string): string {
  const line = text.split(/\r?\n/).find(part => part.trim() !== '')?.trim() ?? ''
  return line.length > PROMPT_CHARS ? `${line.slice(0, PROMPT_CHARS - 1)}…` : line
}

/** What a page read found in one file: its entries of the window, and the stamp it was read at. */
type FileRead = { stamp: string; entries: readonly TurnEntry[] }

/** The newest prompt a file holds, when, and the stamp it was read at. */
type PromptRead = { stamp: string; prompt: { at: number; line: string } | null }

/**
 * Reads a team's turn log for the Log view, over the hours teamrig keeps it. Each file it reads is kept with its
 * stamp: the list keeps each file's newest prompt, the page the entries of the session it shows, and both drop what
 * a read no longer lists.
 */
export class TurnLogReader {
  private readonly files: LogFiles
  private readonly log: TurnLogPlace
  private prompts = new Map<string, PromptRead>()
  private pageReads = new Map<string, FileRead>()
  /** The page it last read, and what it was read from: an unmoved read answers that same page. */
  private lastPage: { page: LogPage; from: string } | null = null

  constructor(files: LogFiles, log: TurnLogPlace) {
    this.files = files
    this.log = log
  }

  /** The sessions with an hour file in the window at `now`, the newest change first. */
  async list(now: number): Promise<LogList> {
    const { dir, keepHours } = this.log
    const start = windowStart(now, keepHours)
    try {
      const entries = await this.files.list(dir)
      if (entries === null) return { kind: 'no-log' }
      const ids = entries.filter(entry => entry.kind === 'dir' && SESSION_NAME.test(entry.name)).map(entry => entry.name)
      const kept = new Map<string, PromptRead>()
      const sessions: LogSession[] = []
      for (const id of ids) {
        const hours = await this.hours(dir, id, start)
        const newest = hours.at(-1)
        if (newest === undefined) continue
        sessions.push({ id, changedAt: newest.changedAt, lastPrompt: await this.lastPrompt(hours, start, kept) })
      }
      this.prompts = kept
      return { kind: 'sessions', hours: keepHours, sessions: sessions.sort((a, b) => b.changedAt - a.changedAt || a.id.localeCompare(b.id)) }
    } catch (error) {
      return { kind: 'failed', reason: messageOf(error) }
    }
  }

  /** The session's newest lines of the window at `now`, oldest first, up to LOG_PAGE_CHARS of text. */
  async page(session: string, now: number): Promise<LogPage> {
    const { dir, keepHours } = this.log
    const start = windowStart(now, keepHours)
    let hours: HourFile[]
    try {
      hours = await this.hours(dir, session, start)
    } catch (error) {
      return { session, hours: keepHours, entries: [], isCut: false, problem: messageOf(error) }
    }
    const kept = new Map<string, FileRead>()
    const newestFirst: TurnEntry[] = []
    let chars = 0
    let isCut = false
    let problem: string | null = null
    for (const hour of [...hours].reverse()) {
      if (isCut) break
      let read: FileRead
      try {
        read = await this.pageRead(hour, start)
      } catch (error) {
        problem ??= `${hour.path}: ${messageOf(error)}`
        continue
      }
      kept.set(hour.path, read)
      for (const entry of [...read.entries].reverse()) {
        // The newest line always shows; teamrig cuts each to 64k characters, under the page's cap.
        if (newestFirst.length > 0 && chars + entry.text.length > LOG_PAGE_CHARS) {
          isCut = true
          break
        }
        chars += entry.text.length
        newestFirst.push(entry)
      }
    }
    this.pageReads = kept
    const entries = newestFirst.reverse()
    // The window moves on with `now`, so what was read is the files' stamps and the first line shown.
    const from = [session, problem, ...[...kept.entries()].map(([path, read]) => `${path}@${read.stamp}`), entries[0]?.at, entries.length].join('|')
    if (this.lastPage?.from === from) return this.lastPage.page
    const page: LogPage = { session, hours: keepHours, entries, isCut, problem }
    this.lastPage = { page, from }
    return page
  }

  /** The session's hour files that end inside the window, oldest first; none when its folder is gone. */
  private async hours(dir: string, id: string, start: number): Promise<HourFile[]> {
    const folder = `${dir}/${id}`
    const entries = (await this.files.list(folder)) ?? []
    return entries
      .flatMap(entry => {
        const hour = entry.kind === 'file' ? HOUR_FILE.exec(entry.name)?.[1] : undefined
        if (hour === undefined || Date.parse(`${hour}:00:00Z`) + HOUR_MS <= start) return []
        return [{ hour, file: { path: `${folder}/${entry.name}`, stamp: `${entry.mtimeMs}:${entry.size}`, changedAt: entry.mtimeMs } }]
      })
      .sort((a, b) => a.hour.localeCompare(b.hour))
      .map(found => found.file)
  }

  /** The first line of the session's newest prompt in the window, reading its files newest first; null for none. */
  private async lastPrompt(hours: readonly HourFile[], start: number, kept: Map<string, PromptRead>): Promise<string | null> {
    for (const hour of [...hours].reverse()) {
      const known = this.prompts.get(hour.path)
      const read: PromptRead = known?.stamp === hour.stamp ? known : { stamp: hour.stamp, prompt: newestPrompt(await this.files.read(hour.path)) }
      kept.set(hour.path, read)
      if (read.prompt !== null && read.prompt.at >= start) return read.prompt.line
    }
    return null
  }

  /** The file's entries in the window, read again only when its stamp moved. */
  private async pageRead(hour: HourFile, start: number): Promise<FileRead> {
    const known = this.pageReads.get(hour.path)
    const read = known?.stamp === hour.stamp ? known : { stamp: hour.stamp, entries: parseTurnLines(await this.files.read(hour.path)) }
    return { stamp: read.stamp, entries: read.entries.filter(entry => isInWindow(entry, start)) }
  }
}

/** A file's newest prompt with a readable time, and its first line; null for none. */
function newestPrompt(text: string): PromptRead['prompt'] {
  const prompts = parseTurnLines(text).filter(entry => entry.kind === 'prompt' && !Number.isNaN(Date.parse(entry.at)))
  const newest = prompts.at(-1)
  return newest === undefined ? null : { at: Date.parse(newest.at), line: firstLine(newest.text) }
}

/** What the Log view's poll needs: the reader, the clock, what the view shows, and the writes that redraw it. */
export type LogPorts = {
  reader: TurnLogReader
  now: () => Promise<number>
  /** True while the pane shows the Log view, open (not minimized). */
  isShown: () => Promise<boolean>
  /** The session whose page shows, null for the list. */
  shownPage: () => Promise<string | null>
  publishList: (list: LogList) => Promise<void>
  /** Writes the page, or with null goes back to the list. */
  publishPage: (page: LogPage | null) => Promise<void>
}

/** Two lists that draw the same. */
function sameList(a: LogList, b: LogList): boolean {
  if (a.kind !== 'sessions' || b.kind !== 'sessions') return JSON.stringify(a) === JSON.stringify(b)
  return (
    a.hours === b.hours &&
    a.sessions.length === b.sessions.length &&
    a.sessions.every((session, i) => {
      const other = b.sessions[i]
      return other !== undefined && session.id === other.id && session.changedAt === other.changedAt && session.lastPrompt === other.lastPrompt
    })
  )
}

/**
 * Keeps the Log view in step with the turn logs while it shows: a POLL_MS poll reads the list or the page shown
 * again and writes it only when it changed. A poll never rejects: a failed read shows on the list as its reason,
 * and a failed write leaves the view as last drawn for the next poll.
 */
export class LiveLog {
  private readonly ports: LogPorts
  private timers: Timer[] = []
  private isPolling = false
  private shownList: LogList | null = null
  private shownPage: LogPage | null = null

  constructor(ports: LogPorts) {
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

  /** Reads what the view shows again, when it shows. */
  async poll(): Promise<void> {
    try {
      if (await this.ports.isShown()) await this.refresh()
    } catch {
      // The next poll asks again.
    }
  }

  /** Reads the list, or the page shown, again and writes it when it changed. */
  async refresh(): Promise<void> {
    if (this.isPolling) return
    this.isPolling = true
    try {
      const session = await this.ports.shownPage()
      const now = await this.ports.now()
      if (session === null) {
        const list = await this.ports.reader.list(now)
        if (this.shownList === null || !sameList(this.shownList, list)) {
          await this.ports.publishList(list)
          this.shownList = list
        }
      } else {
        const page = await this.ports.reader.page(session, now)
        if (page !== this.shownPage) {
          await this.ports.publishPage(page)
          this.shownPage = page
        }
      }
    } catch {
      // A failed write is drawn by the next poll that reads a change.
    } finally {
      this.isPolling = false
    }
  }

  /** Opens the session's page, read now. */
  async open(session: string): Promise<void> {
    const page = await this.ports.reader.page(session, await this.ports.now())
    await this.ports.publishPage(page)
    this.shownPage = page
  }

  /** Goes back to the list and reads it again. */
  async close(): Promise<void> {
    await this.ports.publishPage(null)
    this.shownPage = null
    await this.refresh()
  }
}
