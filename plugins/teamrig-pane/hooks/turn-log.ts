// The Log view's reads: each team session's prompts and replies from the turn log teamrig writes:
// `<team state>/turn-log/<session id>/<UTC hour>.jsonl`, one JSON line per entry, only ever appended to. teamrig
// removes whole hour files past the team's kept hours (its config's `turnLog.keepHours`), so the oldest file kept
// can still hold older lines: the pane hides every line older than those hours. Each line is read by teamrig's
// parseEntry: one of another version, one that does not parse (a torn last line) or one missing a field is
// skipped, and fields the pane does not know are ignored. A conversation is a session's lines with one Claude Code
// session id: a /clear writes its clear line with the new id, so it opens the next conversation, and a compaction's
// keeps the id. The list reads every file of the kept hours and names each conversation with a line in them, the
// newest last line first, with how it opened (the owner's first words, else Claude's first reply); a
// conversation's page holds its newest lines, oldest first, up to LOG_PAGE_CHARS of text, reading the session's
// files newest first and none past that. Each file read is kept with its size and mtime, so a poll reads again only
// a file that moved. While the Log view shows, a POLL_MS poll reads what it shows again, writing only what changed.
// Reads files only: no git, no model.
import type { LogConversation, LogList, LogOpening, LogPage, LogRead, TurnEntry } from '../types'
import { parseEntry, SESSION_NAME } from './core/read/index'
import { messageOf } from './errors'
import { POLL_MS, type Timer } from './live'
import { turnParts } from './turn-text'

const HOUR_MS = 3_600_000
/** The most text a session's page holds, its newest lines: as much as a file page shows (ref-file.ts MAX_PAGE_BYTES), so a busy day never lays out megabytes. */
export const LOG_PAGE_CHARS = 256 * 1024
/** An hour's file, `2026-10-19T09.jsonl`: the names sort by time. */
const HOUR_FILE = /^(\d{4}-\d{2}-\d{2}T\d{2})\.jsonl$/
/** The most of an opening's first line the list keeps: it draws two lines of it at most. */
const OPENING_CHARS = 200

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

/** An hour file of a session's folder: its path, and its stamp. */
type HourFile = { path: string; stamp: string }

/** A text's first line with words, cut at OPENING_CHARS. */
function firstLine(text: string): string {
  const line = text.split(/\r?\n/).find(part => part.trim() !== '')?.trim() ?? ''
  return line.length > OPENING_CHARS ? `${line.slice(0, OPENING_CHARS - 1)}…` : line
}

/** What a page read found in one file: its entries, and the stamp it was read at. */
type FileRead = { stamp: string; entries: readonly TurnEntry[] }

/**
 * A line as the list needs it: when (ms), its Claude Code session id, the first line of the owner's first words in a
 * prompt, and of a reply's words; a clear, and a prompt of harness notices alone, have neither.
 */
export type ListEntry = { readonly at: number; readonly claude: string; readonly owner: string | null; readonly reply: string | null }

/** What a list read found in one file: its entries with a readable time, and the stamp it was read at. */
type ListRead = { stamp: string; entries: readonly ListEntry[] }

/** The entry the list keeps of a line; null for one with an unreadable time. */
function listEntry(entry: TurnEntry): ListEntry | null {
  const at = Date.parse(entry.at)
  if (Number.isNaN(at)) return null
  if (entry.kind === 'clear') return { at, claude: entry.claude, owner: null, reply: null }
  const parts = turnParts(entry.kind, entry.text)
  const said = parts.find(part => part.speaker.kind === (entry.kind === 'prompt' ? 'owner' : 'claude'))
  const line = said === undefined ? null : firstLine(said.text)
  return { at, claude: entry.claude, owner: entry.kind === 'prompt' ? line : null, reply: entry.kind === 'reply' ? line : null }
}

/** How a conversation's entries open: the owner's first words, else Claude's first reply; null for neither. */
function openingOf(entries: readonly ListEntry[]): LogOpening | null {
  const owner = entries.find(entry => entry.owner !== null)?.owner
  if (owner !== undefined && owner !== null) return { by: 'owner', line: owner }
  const reply = entries.find(entry => entry.reply !== null)?.reply
  return reply === undefined || reply === null ? null : { by: 'claude', line: reply }
}

/**
 * A session's conversations in its entries of the window, oldest first: its entries grouped by Claude Code session
 * id, each conversation's next one the one that began after it. Pure.
 */
export function conversationsOf(session: string, entries: readonly ListEntry[]): LogConversation[] {
  const groups = new Map<string, ListEntry[]>()
  for (const entry of entries) {
    const group = groups.get(entry.claude)
    if (group === undefined) groups.set(entry.claude, [entry])
    else group.push(entry)
  }
  const found = [...groups].flatMap(([claude, group]) => {
    const first = group[0]
    const last = group.at(-1)
    if (first === undefined || last === undefined) return []
    return [{ claude, firstAt: first.at, lastAt: last.at, lines: group.length, opening: openingOf(group) }]
  })
  found.sort((a, b) => a.firstAt - b.firstAt)
  return found.map((conversation, i) => ({ session, ...conversation, nextAt: found[i + 1]?.firstAt ?? null }))
}

/**
 * Reads a team's turn log for the Log view, over the hours teamrig keeps it. Each file it reads is kept with its
 * stamp: the list keeps each file's entries as it needs them, the page those of the session it shows, and both drop
 * what a read no longer lists.
 */
export class TurnLogReader {
  private readonly files: LogFiles
  private readonly log: TurnLogPlace
  private listReads = new Map<string, ListRead>()
  /** The previous conversation's reads, apart from the list's: the band reads one session, the list every one. */
  private previousReads = new Map<string, ListRead>()
  private pageReads = new Map<string, FileRead>()
  /** The page it last read, and what it was read from: an unmoved read answers that same page. */
  private lastPage: { page: LogPage; from: string } | null = null

  constructor(files: LogFiles, log: TurnLogPlace) {
    this.files = files
    this.log = log
  }

  /** Each session's conversations with a line in the window at `now`, the newest last line first. */
  async list(now: number): Promise<LogList> {
    const { dir, keepHours } = this.log
    const start = windowStart(now, keepHours)
    try {
      const entries = await this.files.list(dir)
      if (entries === null) return { kind: 'no-log' }
      const ids = entries.filter(entry => entry.kind === 'dir' && SESSION_NAME.test(entry.name)).map(entry => entry.name)
      const kept = new Map<string, ListRead>()
      const conversations: LogConversation[] = []
      for (const id of ids) conversations.push(...conversationsOf(id, await this.windowEntries(id, start, this.listReads, kept)))
      this.listReads = kept
      conversations.sort((a, b) => b.lastAt - a.lastAt || a.session.localeCompare(b.session) || a.claude.localeCompare(b.claude))
      return { kind: 'conversations', hours: keepHours, conversations }
    } catch (error) {
      return { kind: 'failed', reason: messageOf(error) }
    }
  }

  /** The newest lines of the session's conversation `claude` in the window at `now`, oldest first, up to LOG_PAGE_CHARS of text. */
  async page(session: string, claude: string, now: number): Promise<LogPage> {
    const { dir, keepHours } = this.log
    const start = windowStart(now, keepHours)
    let hours: HourFile[]
    try {
      hours = await this.hours(dir, session, start)
    } catch (error) {
      return { session, claude, hours: keepHours, entries: [], isCut: false, problem: messageOf(error) }
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
        read = await this.pageRead(hour)
      } catch (error) {
        problem ??= `${hour.path}: ${messageOf(error)}`
        continue
      }
      kept.set(hour.path, read)
      const shown = read.entries.filter(entry => entry.claude === claude && isInWindow(entry, start))
      for (const entry of shown.reverse()) {
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
    const from = [session, claude, problem, ...[...kept.entries()].map(([path, read]) => `${path}@${read.stamp}`), entries[0]?.at, entries.length].join('|')
    if (this.lastPage?.from === from) return this.lastPage.page
    const page: LogPage = { session, claude, hours: keepHours, entries, isCut, problem }
    this.lastPage = { page, from }
    return page
  }

  /**
   * The session's conversation in the window at `now` with the newest last line, `claude` (the one it works in now)
   * aside: the band names it above the prompt (T2249). Null with none. It reads only that session's folder, each
   * file again only when it moved since its own last read. A failed read throws.
   */
  async previous(session: string, claude: string, now: number): Promise<LogConversation | null> {
    const kept = new Map<string, ListRead>()
    const entries = await this.windowEntries(session, windowStart(now, this.log.keepHours), this.previousReads, kept)
    this.previousReads = kept
    const others = conversationsOf(session, entries).filter(conversation => conversation.claude !== claude)
    return others.reduce<LogConversation | null>((newest, each) => (newest === null || each.lastAt > newest.lastAt ? each : newest), null)
  }

  /** The session's entries of the window from `start`, oldest first, each file read unless `known` holds it unmoved; each read goes into `kept`. */
  private async windowEntries(id: string, start: number, known: ReadonlyMap<string, ListRead>, kept: Map<string, ListRead>): Promise<ListEntry[]> {
    const inWindow: ListEntry[] = []
    for (const hour of await this.hours(this.log.dir, id, start)) {
      const read = await this.listRead(hour, known)
      kept.set(hour.path, read)
      inWindow.push(...read.entries.filter(entry => entry.at >= start))
    }
    return inWindow
  }

  /** The session's hour files that end inside the window, oldest first; none when its folder is gone. */
  private async hours(dir: string, id: string, start: number): Promise<HourFile[]> {
    const folder = `${dir}/${id}`
    const entries = (await this.files.list(folder)) ?? []
    return entries
      .flatMap(entry => {
        const hour = entry.kind === 'file' ? HOUR_FILE.exec(entry.name)?.[1] : undefined
        if (hour === undefined || Date.parse(`${hour}:00:00Z`) + HOUR_MS <= start) return []
        return [{ hour, file: { path: `${folder}/${entry.name}`, stamp: `${entry.mtimeMs}:${entry.size}` } }]
      })
      .sort((a, b) => a.hour.localeCompare(b.hour))
      .map(found => found.file)
  }

  /** The file's entries as the list keeps them, read again only when its stamp moved from the read `reads` holds. */
  private async listRead(hour: HourFile, reads: ReadonlyMap<string, ListRead>): Promise<ListRead> {
    const known = reads.get(hour.path)
    if (known?.stamp === hour.stamp) return known
    const entries = parseTurnLines(await this.files.read(hour.path)).flatMap(entry => listEntry(entry) ?? [])
    return { stamp: hour.stamp, entries }
  }

  /**
   * The file's entries, read again only when its stamp moved: all of them, as a page of another conversation of the
   * session reads the same file.
   */
  private async pageRead(hour: HourFile): Promise<FileRead> {
    const known = this.pageReads.get(hour.path)
    return known?.stamp === hour.stamp ? known : { stamp: hour.stamp, entries: parseTurnLines(await this.files.read(hour.path)) }
  }
}

/** What the Log view's poll needs: the reader, the clock, what the view shows, and the writes that redraw it. */
export type LogPorts = {
  reader: TurnLogReader
  now: () => Promise<number>
  /** True while the pane shows the Log view, open (not minimized). */
  isShown: () => Promise<boolean>
  /** The conversation whose page shows, null for the list. */
  shownPage: () => Promise<LogRead | null>
  publishList: (list: LogList) => Promise<void>
  /** Writes the page, or with null goes back to the list. */
  publishPage: (page: LogPage | null) => Promise<void>
}

/** Two openings that draw the same. */
function sameOpening(a: LogOpening | null, b: LogOpening | null): boolean {
  return a === null || b === null ? a === b : a.by === b.by && a.line === b.line
}

/** Two conversations that draw the same. */
export function sameConversation(a: LogConversation, b: LogConversation): boolean {
  return (
    a.session === b.session &&
    a.claude === b.claude &&
    a.firstAt === b.firstAt &&
    a.lastAt === b.lastAt &&
    a.nextAt === b.nextAt &&
    a.lines === b.lines &&
    sameOpening(a.opening, b.opening)
  )
}

/** Two lists that draw the same. */
function sameList(a: LogList, b: LogList): boolean {
  if (a.kind !== 'conversations' || b.kind !== 'conversations') return JSON.stringify(a) === JSON.stringify(b)
  return (
    a.hours === b.hours &&
    a.conversations.length === b.conversations.length &&
    a.conversations.every((conversation, i) => {
      const other = b.conversations[i]
      return other !== undefined && sameConversation(conversation, other)
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
      const shown = await this.ports.shownPage()
      const now = await this.ports.now()
      if (shown === null) {
        const list = await this.ports.reader.list(now)
        if (this.shownList === null || !sameList(this.shownList, list)) {
          await this.ports.publishList(list)
          this.shownList = list
        }
      } else {
        const page = await this.ports.reader.page(shown.session, shown.claude, now)
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

  /** Opens the conversation's page, read now. */
  async open(read: LogRead): Promise<void> {
    const page = await this.ports.reader.page(read.session, read.claude, await this.ports.now())
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
