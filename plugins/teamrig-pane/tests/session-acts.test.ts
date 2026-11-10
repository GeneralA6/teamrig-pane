// The Teams tab's presses on a session's row (hooks/session-acts.ts): [Meet] runs `teamrig meet <session>` from the
// tab's folder, one press at a time of any act, and tells that it runs, then what the CLI printed, or why it refused,
// verbatim; each with its time, the press's while running, the CLI's answer's after.
import { describe, expect, test } from 'claude-code/testing'
import type { SessionAnswer, SessionPress } from '../types'
import { MEET_TIMEOUT_MS, SessionActs, actOutcome, actWords, type SessionActPorts } from '../hooks/session-acts'
import { cliArgv, type CliRun, type TeamrigCli } from '../hooks/teamrig-cli'
import { NOW } from './fixtures'

const CLI: TeamrigCli = { kind: 'found', main: 'K/teamrig/dist/cli/main.js' }
const WOKE = 'WOKE acme-api (session api): 1 card(s) waiting on owner; an inbox line asks it to bring them now'
const NO_CARD = 'acme-api (session api) has no card waiting on owner now; put off: T1 until Mon 11-02'
/** How long each run takes on the ports' clock, which stands at NOW when the act is pressed. */
const RUN_MS = 90_000
/** When a run answers. */
const ANSWERED = NOW + RUN_MS
const MEET_API: SessionPress = { act: 'meet', team: 'acme', session: 'api' }
const MEET_WEB: SessionPress = { act: 'meet', team: 'acme', session: 'web' }

function ok(stdout: string): CliRun {
  return { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false }
}

function failed(exitCode: number, stderr: string): CliRun {
  return { exitCode, stdout: '', stderr, isStdoutTruncated: false }
}

/** Ports recording each run and tell; `answer` answers every run, RUN_MS after it starts on the ports' clock. */
function portsOf(answer: CliRun | Error): SessionActPorts & { runs: { args: readonly string[]; timeoutMs: number }[]; told: SessionAnswer[] } {
  const runs: { args: readonly string[]; timeoutMs: number }[] = []
  const told: SessionAnswer[] = []
  let now = NOW
  return {
    runs,
    told,
    run: async (args, timeoutMs) => {
      runs.push({ args, timeoutMs })
      now += RUN_MS
      if (answer instanceof Error) throw answer
      return answer
    },
    tell: async answer => {
      told.push(answer)
    },
    now: async () => now,
  }
}

describe('actWords', () => {
  test('a meet names the session alone, as teamrig meet finds its team from the tab folder', () => {
    expect(actWords(MEET_API)).toEqual(['meet', 'api'])
  })
})

describe('actOutcome', () => {
  test('a run that exits 0 is done, with the lines it printed and when', () => {
    expect(actOutcome(MEET_API, ok(`${WOKE}\n\n`), ANSWERED)).toEqual({ ...MEET_API, outcome: 'done', lines: [WOKE], at: ANSWERED })
  })

  test('a refusal is told verbatim; one with nothing on stderr by its exit code', () => {
    expect(actOutcome(MEET_API, failed(2, `${NO_CARD}\n`), ANSWERED)).toEqual({ ...MEET_API, outcome: 'refused', lines: [NO_CARD], at: ANSWERED })
    expect(actOutcome(MEET_API, failed(1, ''), ANSWERED)).toEqual({ ...MEET_API, outcome: 'refused', lines: ['teamrig meet api exited 1'], at: ANSWERED })
  })
})

describe('SessionActs', () => {
  test('a meet tells it runs at the press, runs teamrig meet on the session with no --session, then tells what it answered when it did', async () => {
    const ports = portsOf(ok(`${WOKE}\n`))
    await new SessionActs(CLI, ports).press(MEET_API)
    expect(ports.runs).toEqual([{ args: cliArgv(CLI.main, ['meet', 'api']), timeoutMs: MEET_TIMEOUT_MS }])
    expect(ports.runs[0]?.args).toEqual(['node', CLI.main, 'meet', 'api'])
    expect(ports.told).toEqual([
      { ...MEET_API, outcome: 'running', lines: [], at: NOW },
      { ...MEET_API, outcome: 'done', lines: [WOKE], at: ANSWERED },
    ])
  })

  test('a refused meet tells why, and when the CLI answered', async () => {
    const ports = portsOf(failed(2, NO_CARD))
    await new SessionActs(CLI, ports).press(MEET_API)
    expect(ports.told[1]).toEqual({ ...MEET_API, outcome: 'refused', lines: [NO_CARD], at: ANSWERED })
  })

  test('with no teamrig CLI found, a press runs nothing and is refused with the problem at once', async () => {
    const ports = portsOf(ok(WOKE))
    await new SessionActs({ kind: 'missing', problem: 'teamrig is not installed' }, ports).press(MEET_API)
    expect(ports.runs).toEqual([])
    expect(ports.told[1]).toEqual({ ...MEET_API, outcome: 'refused', lines: ['teamrig is not installed'], at: NOW })
  })

  test('a run that does not finish is told as refused, when it gave up', async () => {
    const ports = portsOf(new Error('timed out'))
    await new SessionActs(CLI, ports).press(MEET_WEB)
    expect(ports.told[1]).toEqual({ ...MEET_WEB, outcome: 'refused', lines: ['teamrig meet web did not finish: timed out'], at: ANSWERED })
  })

  test('a press while an act runs does nothing; one after it runs again', async () => {
    // The run waits on a gate made before it starts (the act reaches its run a few awaits after the press).
    let open = (): void => undefined
    const gate = new Promise<void>(resolve => {
      open = resolve
    })
    const ports = portsOf(ok(WOKE))
    const slow: SessionActPorts = {
      ...ports,
      run: async (args, timeoutMs) => {
        await gate
        return ports.run(args, timeoutMs)
      },
    }
    const acts = new SessionActs(CLI, slow)
    const first = acts.press(MEET_API)
    await acts.press(MEET_WEB)
    open()
    await first
    expect(ports.told.map(answer => [answer.session, answer.outcome])).toEqual([
      ['api', 'running'],
      ['api', 'done'],
    ])
    await acts.press(MEET_WEB)
    expect(ports.runs.map(run => run.args.at(-1))).toEqual(['api', 'web'])
  })

  test('a tell that fails leaves the acts free for the next press', async () => {
    const ports = portsOf(ok(WOKE))
    let tells = 0
    const failing: SessionActPorts = {
      ...ports,
      tell: async () => {
        tells += 1
        throw new Error('store closed')
      },
    }
    const acts = new SessionActs(CLI, failing)
    await acts.press(MEET_API)
    await acts.press(MEET_API)
    expect(tells).toBe(2)
    expect(ports.runs).toEqual([])
  })
})
