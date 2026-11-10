// The Teams tab's presses on a session's row that run the teamrig CLI on that session (T2298), each act its words:
// [Meet] (T1297) runs `teamrig meet <session>`, which wakes a running session with an inbox line asking it to bring the
// owner its cards, or opens it fresh in a new tab to do so, and refuses a session with no card waiting on the owner now.
// One run at a time, of any act: it tells that it runs, then what the CLI answered, its lines on success and its
// refusal verbatim, each stamped with when (the press, then the CLI's answer), as the session's row shows it
// (team-rows.ts, T2206). The CLI finds the team from the tab's folder, the team whose register the pane reads, as the
// Teams tab's cards are that team's alone. Runs the CLI only; no model calls.
import type { SessionAct, SessionAnswer, SessionPress } from '../types'
import { messageOf } from './errors'
import { cliArgv, failureLines, linesOf, type CliRun, type TeamrigCli } from './teamrig-cli'

/** A meet reads the register and the host's processes, then posts an inbox line or opens a tab: far under this. */
export const MEET_TIMEOUT_MS = 60_000

/** How an act runs: the CLI's words for the session it acts on, and how long a run may take. */
type ActRun = { readonly words: (press: SessionPress) => readonly string[]; readonly timeoutMs: number }

/** Each act's run: [Meet] names the session alone, as `teamrig meet` finds its team from the tab's folder. */
const ACT_RUNS: { readonly [act in SessionAct]: ActRun } = {
  meet: { words: ({ session }) => ['meet', session], timeoutMs: MEET_TIMEOUT_MS },
}

/** The CLI's words for `press`: `meet <session>`. */
export function actWords(press: SessionPress): readonly string[] {
  return ACT_RUNS[press.act].words(press)
}

export type SessionActPorts = {
  /** Runs `argv`, the teamrig CLI and its words (teamrig-cli.ts cliArgv); rejects when it cannot start or outlasts `timeoutMs`. */
  run: (argv: readonly string[], timeoutMs: number) => Promise<CliRun>
  /** Writes what the last press answered. */
  tell: (answer: SessionAnswer) => Promise<void>
  /** The time now, epoch ms: when the press runs, and when the CLI answers. */
  now: () => Promise<number>
}

/** What a run of `press` answered at `at`: done, with the lines it printed; else refused, with why. */
export function actOutcome(press: SessionPress, run: CliRun, at: number): SessionAnswer {
  if (run.exitCode !== 0) return { ...press, outcome: 'refused', lines: failureLines(run, actWords(press).join(' ')), at }
  return { ...press, outcome: 'done', lines: linesOf(run.stdout), at }
}

/** Runs a session act on a press, one press at a time. */
export class SessionActs {
  private readonly cli: TeamrigCli
  private readonly ports: SessionActPorts
  private isRunning = false

  constructor(cli: TeamrigCli, ports: SessionActPorts) {
    this.cli = cli
    this.ports = ports
  }

  /**
   * Runs `press`: tells it runs, runs its teamrig words, tells what it answered. A press while one runs does nothing:
   * the first one's answer is still to come.
   */
  async press(press: SessionPress): Promise<void> {
    if (this.isRunning) return
    this.isRunning = true
    try {
      await this.ports.tell({ ...press, outcome: 'running', lines: [], at: await this.ports.now() })
      await this.ports.tell(await this.run(press))
    } catch {
      // A failed tell leaves the last answer drawn.
    } finally {
      this.isRunning = false
    }
  }

  private async run(press: SessionPress): Promise<SessionAnswer> {
    const cli = this.cli
    if (cli.kind === 'missing') return { ...press, outcome: 'refused', lines: [cli.problem], at: await this.ports.now() }
    const words = actWords(press)
    try {
      const run = await this.ports.run(cliArgv(cli.main, words), ACT_RUNS[press.act].timeoutMs)
      return actOutcome(press, run, await this.ports.now())
    } catch (error) {
      return { ...press, outcome: 'refused', lines: [`teamrig ${words.join(' ')} did not finish: ${messageOf(error)}`], at: await this.ports.now() }
    }
  }
}
