// The Meetings view's source (T1359): the team's meeting schedule, read through the teamrig CLI (teamrig-cli.ts) and
// never from its file, whose format is teamrig's own. `teamrig meeting list --all --json` prints the scheduled and
// started meetings and those done or dropped in the last week, by time (the view shows the day's: meetings-rows.ts); this reads each with type guards, counting the ones it cannot read (a newer teamrig's), and writes
// the list only when it changed. It reads every TICK_MS (live.ts) and only while the view shows (a missed mark moves
// with the clock, and a meeting is added or moved from elsewhere), at once when the person switches to the view, and
// right after a press ran. A card's presses (T2778) run the CLI on its meeting, one run at a time, telling what it
// answered: [Start meeting] `meeting start <id>`; Move `meeting move <id> --at`, Postpone (a started one)
// `meeting postpone <id> --at`, an hour from the press or tomorrow at the meeting's time; Drop `meeting drop <id>
// --note <why>`; End `meeting end <id>`. Move, Postpone, Drop and End first ask a second line on the card, so one
// stray press never moves or ends a meeting. Each run passes `--session`, the caller the CLI asks for. Runs the CLI
// only; no model calls.
import type { Meeting, MeetingAnswer, MeetingAsked, MeetingPress, MeetingRun, MeetingStatus, MeetingTo, MeetingsView } from '../types'
import { messageOf } from './errors'
import { TICK_MS, type Timer } from './live'
import { cliArgv, failureLines, linesOf, type CliRun, type TeamrigCli } from './teamrig-cli'
import type { Clock } from './zone'

/** A list read takes no lock: far under this, unless the machine is swamped. */
export const LIST_TIMEOUT_MS = 30_000
/** A run waits for the schedule's lock; a start then brings the session's tab to the front or opens one. */
export const RUN_TIMEOUT_MS = 60_000
const STATUSES: readonly MeetingStatus[] = ['scheduled', 'started', 'done', 'dropped']
const HOUR_MS = 60 * 60 * 1000
const MINUTE_MS = 60 * 1000
/** The word each run prints first, before the meeting as `meeting list` shows it, which the view already draws. */
const FIRST_WORD: Readonly<Record<MeetingRun['verb'], string>> = { start: 'STARTED ', end: 'ENDED ', drop: 'DROPPED ', move: 'MOVED ', postpone: 'POSTPONED ' }

export type MeetingsPorts = {
  /** Runs `argv`, the teamrig CLI and its words (teamrig-cli.ts cliArgv); rejects when it cannot start or outlasts `timeoutMs`. */
  run: (argv: readonly string[], timeoutMs: number) => Promise<CliRun>
  /** The session the CLI runs as (its `--session`); null when the tab knows none, and the CLI asks its own variable. */
  caller: () => Promise<string | null>
  /** True while the pane shows the Meetings view, open (not minimized). */
  isShown: () => Promise<boolean>
  /** Now, in the team's zone: where a Move or Postpone press moves a meeting to. */
  clock: () => Promise<Clock>
  publish: (view: MeetingsView) => Promise<void>
  /** Writes what the last run press answered. */
  tell: (answer: MeetingAnswer) => Promise<void>
  /** Writes the second line a card shows; null closes it. */
  ask: (asked: MeetingAsked | null) => Promise<void>
}

type JsonRecord = Readonly<Record<string, unknown>>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStatus(value: unknown): value is MeetingStatus {
  return STATUSES.some(status => status === value)
}

function isTexts(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

/** A meeting as the CLI prints it; null for one missing a field or holding one of another type. */
export function parseMeeting(value: unknown): Meeting | null {
  if (!isRecord(value)) return null
  const { id, at, atText, minutes, session, tasks, about, brief, status, missed } = value
  const joining = value['with']
  const time = typeof at === 'string' ? Date.parse(at) : Number.NaN
  if (typeof id !== 'string' || Number.isNaN(time) || typeof atText !== 'string' || typeof minutes !== 'number') return null
  if (typeof session !== 'string' || !isTexts(joining) || !isTexts(tasks) || typeof about !== 'string') return null
  if ((brief !== null && typeof brief !== 'string') || !isStatus(status) || typeof missed !== 'boolean') return null
  return { id, at: time, atText, minutes, session, with: joining, tasks, about, brief, status, missed }
}

/** The meetings `meeting list --all --json` printed and how many of them it could not read; null for output that is no list. */
export function readMeetingList(stdout: string): { meetings: Meeting[]; unreadable: number } | null {
  let printed: unknown
  try {
    printed = JSON.parse(stdout)
  } catch {
    return null
  }
  const rows = isRecord(printed) ? printed['meetings'] : undefined
  if (!Array.isArray(rows)) return null
  const meetings = rows.map(parseMeeting).filter(meeting => meeting !== null)
  return { meetings, unreadable: rows.length - meetings.length }
}

/** The view a list run draws: its meetings, or why there are none to show. */
export function listView(run: CliRun): MeetingsView {
  if (run.exitCode !== 0) return { kind: 'failed', reason: failureLines(run, 'meeting list').join(' ') }
  const read = run.isStdoutTruncated ? null : readMeetingList(run.stdout)
  if (read === null) return { kind: 'failed', reason: 'teamrig printed no meeting list the pane can read: update teamrig' }
  return { kind: 'list', ...read }
}

/**
 * Where a Move or Postpone press moves a meeting, from `clock`'s now: an hour on, to the whole minute after; or
 * tomorrow, on the team's calendar, at the wall time the meeting has now (a clock change between keeps the wall time).
 */
export function movedAt(to: MeetingTo, { now, zone }: Clock): number {
  if (to.kind === 'in-1h') return Math.ceil((now + HOUR_MS) / MINUTE_MS) * MINUTE_MS
  const at = zone.wall(new Date(to.from))
  const today = zone.wall(new Date(now))
  const tomorrow = new Date(Date.UTC(today.year, today.month - 1, today.day + 1))
  return zone.instant({ year: tomorrow.getUTCFullYear(), month: tomorrow.getUTCMonth() + 1, day: tomorrow.getUTCDate(), hour: at.hour, minute: at.minute }).getTime()
}

/** The CLI's words for `run` on meeting `id`; a Move or Postpone at its time from `clock` (movedAt), as an ISO time. */
export function meetingWords(id: string, run: MeetingRun, clock: Clock): string[] {
  switch (run.verb) {
    case 'start':
    case 'end':
      return ['meeting', run.verb, id]
    case 'drop':
      return ['meeting', 'drop', id, '--note', run.why]
    case 'move':
    case 'postpone':
      return ['meeting', run.verb, id, '--at', new Date(movedAt(run.to, clock)).toISOString()]
  }
}

/** What a run answered: done, with the lines after its first (STARTED, MOVED, …); else refused, with why. */
export function runOutcome(id: string, verb: MeetingRun['verb'], run: CliRun): MeetingAnswer {
  if (run.exitCode !== 0) return { id, verb, outcome: 'refused', lines: failureLines(run, `meeting ${verb} ${id}`) }
  return { id, verb, outcome: 'done', lines: linesOf(run.stdout).filter(line => !line.startsWith(FIRST_WORD[verb])) }
}

/** Reads the meetings again while the view shows, writes them when they changed, and starts one on a press. */
export class LiveMeetings {
  private readonly cli: TeamrigCli
  private readonly ports: MeetingsPorts
  private timers: Timer[] = []
  private isReading = false
  /** Set when a read is asked for while one runs: that one may have read the schedule before a start changed it. */
  private isAskedAgain = false
  private isRunning = false
  /** The view last written, as JSON: a read that finds the same list writes nothing. */
  private shown: string | null = null

  constructor(cli: TeamrigCli, ports: MeetingsPorts) {
    this.cli = cli
    this.ports = ports
  }

  startTimers(every: (ms: number, fn: () => void) => Timer): void {
    this.stop()
    this.timers = [every(TICK_MS, () => void this.poll())]
  }

  stop(): void {
    for (const timer of this.timers) timer.cancel()
    this.timers = []
  }

  /** Reads the list again, when the view shows. */
  async poll(): Promise<void> {
    try {
      if (await this.ports.isShown()) await this.refresh()
    } catch {
      // The next poll asks again.
    }
  }

  /** Reads the list again and writes it when it changed; asked while a read runs, it reads once more after it. */
  async refresh(): Promise<void> {
    if (this.isReading) {
      this.isAskedAgain = true
      return
    }
    this.isReading = true
    try {
      do {
        this.isAskedAgain = false
        await this.write(await this.read())
      } while (this.isAskedAgain)
    } catch {
      // A failed write is written by the next read, which finds the view still unwritten.
    } finally {
      this.isReading = false
    }
  }

  /** A press on a card: an ask opens its second line, Back closes it, a run closes it and runs (run). */
  async press(press: MeetingPress): Promise<void> {
    try {
      switch (press.kind) {
        case 'ask':
          await this.ports.ask({ id: press.id, ask: press.ask })
          return
        case 'back':
          await this.ports.ask(null)
          return
        case 'run':
          await this.ports.ask(null)
          await this.run(press.id, press.run)
          return
      }
    } catch {
      // A failed write leaves the card as drawn; the person presses again.
    }
  }

  /**
   * Runs `run` on meeting `id`: tells it is running, runs the CLI, tells what it answered, then reads the list again.
   * A press while a run runs does nothing: the first one's answer is still to come.
   */
  async run(id: string, run: MeetingRun): Promise<void> {
    if (this.isRunning) return
    this.isRunning = true
    try {
      await this.ports.tell({ id, verb: run.verb, outcome: 'running', lines: [] })
      await this.ports.tell(await this.runCli(id, run))
      await this.refresh()
    } catch {
      // A failed tell leaves the last answer drawn; the next poll reads the list.
    } finally {
      this.isRunning = false
    }
  }

  private async runCli(id: string, run: MeetingRun): Promise<MeetingAnswer> {
    const cli = this.cli
    if (cli.kind === 'missing') return { id, verb: run.verb, outcome: 'refused', lines: [cli.problem] }
    try {
      const words = meetingWords(id, run, await this.ports.clock())
      return runOutcome(id, run.verb, await this.ports.run(cliArgv(cli.main, await this.args(words)), RUN_TIMEOUT_MS))
    } catch (error) {
      return { id, verb: run.verb, outcome: 'refused', lines: [`teamrig meeting ${run.verb} ${id} did not finish: ${messageOf(error)}`] }
    }
  }

  /** The list the CLI prints now, or why it could not be read. */
  private async read(): Promise<MeetingsView> {
    const cli = this.cli
    if (cli.kind === 'missing') return { kind: 'failed', reason: cli.problem }
    try {
      return listView(await this.ports.run(cliArgv(cli.main, await this.args(['meeting', 'list', '--all', '--json'])), LIST_TIMEOUT_MS))
    } catch (error) {
      return { kind: 'failed', reason: `teamrig meeting list did not finish: ${messageOf(error)}` }
    }
  }

  /** `words` with the caller's `--session` when the tab knows one. */
  private async args(words: readonly string[]): Promise<string[]> {
    const caller = await this.ports.caller()
    return caller === null ? [...words] : [...words, '--session', caller]
  }

  private async write(view: MeetingsView): Promise<void> {
    const json = JSON.stringify(view)
    if (json === this.shown) return
    await this.ports.publish(view)
    this.shown = json
  }
}
