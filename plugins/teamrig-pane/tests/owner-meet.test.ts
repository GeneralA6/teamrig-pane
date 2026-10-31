// The Team tab's [Meet] press (hooks/owner-meet.ts): runs `teamrig meet <session>` from the tab's folder, one at a
// time, and tells that it asks, then what the CLI printed, or why it refused, verbatim.
import { describe, expect, test } from 'claude-code/testing'
import type { MeetAnswer } from '../types'
import { MEET_TIMEOUT_MS, OwnerMeet, meetOutcome, type MeetPorts } from '../hooks/owner-meet'
import { cliArgv, type CliRun, type TeamrigCli } from '../hooks/teamrig-cli'

const CLI: TeamrigCli = { kind: 'found', main: 'K/teamrig/dist/cli/main.js' }
const WOKE = 'WOKE acme-api (session api): 1 card(s) waiting on owner; an inbox line asks it to bring them now'
const NO_CARD = 'acme-api (session api) has no card waiting on owner now; put off: T1 until Mon 11-02'

function ok(stdout: string): CliRun {
  return { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false }
}

function failed(exitCode: number, stderr: string): CliRun {
  return { exitCode, stdout: '', stderr, isStdoutTruncated: false }
}

/** Ports recording each run and tell; `answer` answers every run. */
function portsOf(answer: CliRun | Error): MeetPorts & { runs: { args: readonly string[]; timeoutMs: number }[]; told: MeetAnswer[] } {
  const runs: { args: readonly string[]; timeoutMs: number }[] = []
  const told: MeetAnswer[] = []
  return {
    runs,
    told,
    run: async (args, timeoutMs) => {
      runs.push({ args, timeoutMs })
      if (answer instanceof Error) throw answer
      return answer
    },
    tell: async answer => {
      told.push(answer)
    },
  }
}

describe('meetOutcome', () => {
  test('a run that exits 0 asked the session, with the lines it printed', () => {
    expect(meetOutcome('api', ok(`${WOKE}\n\n`))).toEqual({ session: 'api', outcome: 'asked', lines: [WOKE] })
  })

  test('a refusal is told verbatim; one with nothing on stderr by its exit code', () => {
    expect(meetOutcome('api', failed(2, `${NO_CARD}\n`))).toEqual({ session: 'api', outcome: 'refused', lines: [NO_CARD] })
    expect(meetOutcome('api', failed(1, ''))).toEqual({ session: 'api', outcome: 'refused', lines: ['teamrig meet api exited 1'] })
  })
})

describe('OwnerMeet', () => {
  test('a meet tells it is asking, runs teamrig meet on the session with no --session, then tells what it answered', async () => {
    const ports = portsOf(ok(`${WOKE}\n`))
    await new OwnerMeet(CLI, ports).meet('api')
    expect(ports.runs).toEqual([{ args: cliArgv(CLI.main, ['meet', 'api']), timeoutMs: MEET_TIMEOUT_MS }])
    expect(ports.runs[0]?.args).toEqual(['node', CLI.main, 'meet', 'api'])
    expect(ports.told).toEqual([
      { session: 'api', outcome: 'asking', lines: [] },
      { session: 'api', outcome: 'asked', lines: [WOKE] },
    ])
  })

  test('a refused meet tells why', async () => {
    const ports = portsOf(failed(2, NO_CARD))
    await new OwnerMeet(CLI, ports).meet('api')
    expect(ports.told[1]).toEqual({ session: 'api', outcome: 'refused', lines: [NO_CARD] })
  })

  test('with no teamrig CLI found, a meet runs nothing and is refused with the problem', async () => {
    const ports = portsOf(ok(WOKE))
    await new OwnerMeet({ kind: 'missing', problem: 'teamrig is not installed' }, ports).meet('api')
    expect(ports.runs).toEqual([])
    expect(ports.told[1]).toEqual({ session: 'api', outcome: 'refused', lines: ['teamrig is not installed'] })
  })

  test('a run that does not finish is told as refused', async () => {
    const ports = portsOf(new Error('timed out'))
    await new OwnerMeet(CLI, ports).meet('web')
    expect(ports.told[1]).toEqual({ session: 'web', outcome: 'refused', lines: ['teamrig meet web did not finish: timed out'] })
  })

  test('a press while a meet runs does nothing; one after it runs again', async () => {
    // The run waits on a gate made before it starts (the meet reaches its run a few awaits after the press).
    let open = (): void => undefined
    const gate = new Promise<void>(resolve => {
      open = resolve
    })
    const ports = portsOf(ok(WOKE))
    const slow: MeetPorts = {
      ...ports,
      run: async (args, timeoutMs) => {
        await gate
        return ports.run(args, timeoutMs)
      },
    }
    const meet = new OwnerMeet(CLI, slow)
    const first = meet.meet('api')
    await meet.meet('web')
    open()
    await first
    expect(ports.told.map(answer => [answer.session, answer.outcome])).toEqual([
      ['api', 'asking'],
      ['api', 'asked'],
    ])
    await meet.meet('web')
    expect(ports.runs.map(run => run.args.at(-1))).toEqual(['api', 'web'])
  })

  test('a tell that fails leaves the meet free for the next press', async () => {
    const ports = portsOf(ok(WOKE))
    let tells = 0
    const failing: MeetPorts = {
      ...ports,
      tell: async () => {
        tells += 1
        throw new Error('store closed')
      },
    }
    const meet = new OwnerMeet(CLI, failing)
    await meet.meet('api')
    await meet.meet('api')
    expect(tells).toBe(2)
    expect(ports.runs).toEqual([])
  })
})
