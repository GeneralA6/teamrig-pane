// The dedicated UI's front with the acts on it: what a press runs, and what the store is told.
import { describe, expect, test } from 'claude-code/testing'
import { ACT_TIMEOUT_MS } from '../hooks/owner-acts'
import { INITIAL_STATE } from '../hooks/pane-state'
import { MemoryStore } from '../hooks/pane-store'
import { MEET_TIMEOUT_MS } from '../hooks/session-acts'
import type { CliRun, TeamrigCli } from '../hooks/teamrig-cli'
import { withActs, type ActsDeps } from '../ui/acts-front'
import type { Front } from '../ui/app'
import { NO_TEAM_FRONT } from '../ui/program'

const CLI: TeamrigCli = { kind: 'found', main: '/plugin/bin/teamrig.js' }
const AT = 1_700_000_000_000

type Ran = { readonly argv: readonly string[]; readonly timeoutMs: number }

type Bench = {
  readonly front: (focus?: (key: string) => Promise<void>) => Front
  readonly store: MemoryStore
  readonly runs: Ran[]
  readonly focused: string[]
}

function bench(options: { readonly cli?: TeamrigCli; readonly answer?: CliRun; readonly under?: Front } = {}): Bench {
  const store = new MemoryStore(INITIAL_STATE)
  const runs: Ran[] = []
  const focused: string[] = []
  const deps: ActsDeps = {
    cli: options.cli ?? CLI,
    run: (argv, timeoutMs) => {
      runs.push({ argv, timeoutMs })
      return Promise.resolve(options.answer ?? { exitCode: 0, stdout: 'T61 noted\n', stderr: '', isStdoutTruncated: false })
    },
    store,
    now: () => AT,
  }
  const made = withActs(options.under ?? NO_TEAM_FRONT, deps)
  const focus = (key: string): Promise<void> => {
    focused.push(key)
    return Promise.resolve()
  }
  return { front: (given = focus) => made(given), store, runs, focused }
}

describe('a front with the acts', () => {
  test("a Note press opens the field in the store and moves the ring into it; sending runs teamrig's owner note", async () => {
    const { front, store, runs, focused } = bench()
    const { ports, noting } = front()
    await ports.acting?.press('note', 'T61')
    expect(await store.read('ownerAct')).toEqual({ kind: 'noting', task: 'T61', round: 1 })
    expect(focused).toEqual(['note:T61:1'])
    noting?.typed('look at the dates')
    await noting?.send('T61', 'look at the dates')
    expect(runs).toEqual([{ argv: ['node', CLI.main, 'owner', 'note', 'T61', '--text', 'look at the dates'], timeoutMs: ACT_TIMEOUT_MS }])
    expect(await store.read('ownerAct')).toEqual({ kind: 'told', task: 'T61', act: 'note', outcome: 'done', lines: ['T61 noted'] })
  })

  test("a session press runs teamrig's words for it and tells the store its answer, with when", async () => {
    const { front, store, runs } = bench({ answer: { exitCode: 0, stdout: 'meeting po\n', stderr: '', isStdoutTruncated: false } })
    await front().ports.pressing?.press({ act: 'meet', team: 'alpha', session: 'po' })
    expect(runs).toEqual([{ argv: ['node', CLI.main, 'meet', 'po'], timeoutMs: MEET_TIMEOUT_MS }])
    expect(await store.read('sessionAnswer')).toEqual({ act: 'meet', team: 'alpha', session: 'po', outcome: 'done', lines: ['meeting po'], at: AT })
  })

  test('the acts are made once: a Note opened at one drawing is sent at the next, the ring moved by the first focus', async () => {
    const { front, store, runs, focused } = bench()
    await front().ports.acting?.press('note', 'T61')
    const later = front(() => Promise.reject(new Error('a second focus is never used')))
    expect(later).toBe(front())
    later.noting?.typed('kept')
    await later.ports.acting?.press('send', 'T61')
    expect(runs.map(run => run.argv.slice(2))).toEqual([['owner', 'note', 'T61', '--text', 'kept']])
    expect(focused).toEqual(['note:T61:1', 'act:note:T61'])
    expect(await store.read('ownerAct')).toMatchObject({ kind: 'told', outcome: 'done' })
  })

  test('with no teamrig CLI found, an act runs nothing and the store is told why', async () => {
    const { front, store, runs } = bench({ cli: { kind: 'missing', problem: 'no teamrig CLI' } })
    await front().ports.pressing?.press({ act: 'wake', team: 'alpha', session: 'po' })
    expect(runs).toEqual([])
    expect(await store.read('sessionAnswer')).toMatchObject({ outcome: 'refused', lines: ['no teamrig CLI'] })
  })

  test('every other port is the front it was given', () => {
    const { front } = bench()
    const { acting, pressing, ...rest } = front().ports
    const { acting: _acting, pressing: _pressing, ...under } = NO_TEAM_FRONT.ports
    expect(rest).toEqual(under)
    expect([acting, pressing].every(port => port !== null)).toBe(true)
  })
})
