// The Teams tab's [Meet] press (T1297): runs `teamrig meet <session>`, which wakes a running session with an inbox line
// asking it to bring the owner its cards, or opens it fresh in a new tab to do so, and refuses a session with no card
// waiting on the owner now. One run at a time: it tells that it asks, then what the CLI answered, its lines on
// success and its refusal verbatim, each stamped with when (the press, then the CLI's answer), as the session's row
// shows it (team-rows.ts, T2206). The CLI finds the team from the tab's folder, the team whose register the pane
// reads, as the Teams tab's cards are that team's alone. Runs the CLI only; no model calls.
import type { MeetAnswer } from '../types'
import { messageOf } from './errors'
import { cliArgv, failureLines, linesOf, type CliRun, type TeamrigCli } from './teamrig-cli'

/** A meet reads the register and the host's processes, then posts an inbox line or opens a tab: far under this. */
export const MEET_TIMEOUT_MS = 60_000

export type MeetPorts = {
  /** Runs `argv`, the teamrig CLI and its words (teamrig-cli.ts cliArgv); rejects when it cannot start or outlasts `timeoutMs`. */
  run: (argv: readonly string[], timeoutMs: number) => Promise<CliRun>
  /** Writes what the last press answered. */
  tell: (answer: MeetAnswer) => Promise<void>
  /** The time now, epoch ms: when the press asks, and when the CLI answers. */
  now: () => Promise<number>
}

/** What a meet run answered at `at`: asked, with the lines it printed; else refused, with why. */
export function meetOutcome(session: string, run: CliRun, at: number): MeetAnswer {
  if (run.exitCode !== 0) return { session, outcome: 'refused', lines: failureLines(run, `meet ${session}`), at }
  return { session, outcome: 'asked', lines: linesOf(run.stdout), at }
}

/** Meets the owner with a session on a press, one press at a time. */
export class OwnerMeet {
  private readonly cli: TeamrigCli
  private readonly ports: MeetPorts
  private isMeeting = false

  constructor(cli: TeamrigCli, ports: MeetPorts) {
    this.cli = cli
    this.ports = ports
  }

  /**
   * Meets `session`: tells it is asking, runs `teamrig meet`, tells what it answered. A press while a meet runs does
   * nothing: the first one's answer is still to come.
   */
  async meet(session: string): Promise<void> {
    if (this.isMeeting) return
    this.isMeeting = true
    try {
      await this.ports.tell({ session, outcome: 'asking', lines: [], at: await this.ports.now() })
      await this.ports.tell(await this.run(session))
    } catch {
      // A failed tell leaves the last answer drawn.
    } finally {
      this.isMeeting = false
    }
  }

  private async run(session: string): Promise<MeetAnswer> {
    const cli = this.cli
    if (cli.kind === 'missing') return { session, outcome: 'refused', lines: [cli.problem], at: await this.ports.now() }
    try {
      const run = await this.ports.run(cliArgv(cli.main, ['meet', session]), MEET_TIMEOUT_MS)
      return meetOutcome(session, run, await this.ports.now())
    } catch (error) {
      return { session, outcome: 'refused', lines: [`teamrig meet ${session} did not finish: ${messageOf(error)}`], at: await this.ports.now() }
    }
  }
}
