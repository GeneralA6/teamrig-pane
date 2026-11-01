// The owner's Note and Next on a task card (hooks/owner-acts.ts): a Note field sent with `teamrig owner note`, Next's
// preview read into a confirm with the ring on Cancel, its confirm run with `teamrig owner next`, one run at a time,
// and what the CLI answered told verbatim.
import { describe, expect, test } from 'claude-code/testing'
import type { OwnerAct } from '../types'
import { ACT_TIMEOUT_MS, OwnerActs, actOutcome, nextArgs, noteArgs, type ActPorts } from '../hooks/owner-acts'
import { cliArgv, type CliRun, type TeamrigCli } from '../hooks/teamrig-cli'

const CLI: TeamrigCli = { kind: 'found', main: 'K/teamrig/dist/cli/main.js' }
const NOTED = 'NOTED T12 open, p2, owner api | Ship the import'
const WOKE = 'NOTE api has an inbox line that wakes its idle tab: owner\'s Note on T12: ship it today'
const PREVIEW = "PREVIEW owner next T12: goes to the top of api's list (the earlier pin on T9 moves down), api is woken; nothing written"
const NEXT = 'NEXT T12 open, p2, owner api | Ship the import'
const DONE_REFUSAL = 'T12 is done: the owner acts only on an open task'

function ok(stdout: string, stderr = ''): CliRun {
  return { exitCode: 0, stdout, stderr, isStdoutTruncated: false }
}

function failed(exitCode: number, stderr: string): CliRun {
  return { exitCode, stdout: '', stderr, isStdoutTruncated: false }
}

type Recorded = ActPorts & { runs: (readonly string[])[]; timeouts: number[]; told: (OwnerAct | null)[]; focused: string[] }

/** Ports recording each run, tell and focus; `answer` answers each run by its words. */
function portsOf(answer: (args: readonly string[]) => CliRun | Error): Recorded {
  const runs: (readonly string[])[] = []
  const timeouts: number[] = []
  const told: (OwnerAct | null)[] = []
  const focused: string[] = []
  return {
    runs,
    timeouts,
    told,
    focused,
    run: async (argv, timeoutMs) => {
      runs.push(argv.slice(2))
      timeouts.push(timeoutMs)
      const answered = answer(argv.slice(2))
      if (answered instanceof Error) throw answered
      return answered
    },
    tell: async act => {
      told.push(act)
    },
    focus: async key => {
      focused.push(key)
    },
  }
}

/** Answers a preview with PREVIEW and Next with NEXT, a Note with NOTED and the wake line. */
function answering(args: readonly string[]): CliRun {
  if (args[1] === 'note') return ok(`${NOTED}\n`, `${WOKE}\n`)
  return args.includes('--preview') ? ok(`${PREVIEW}\n`) : ok(`${NEXT}\n`)
}

describe('owner act words', () => {
  test('a Note carries its text as one word; Next its preview switch only for the confirm', () => {
    expect(noteArgs('T12', 'ship it; today "please"')).toEqual(['owner', 'note', 'T12', '--text', 'ship it; today "please"'])
    expect(nextArgs('T12', true)).toEqual(['owner', 'next', 'T12', '--preview'])
    expect(nextArgs('T12', false)).toEqual(['owner', 'next', 'T12'])
  })
})

describe('actOutcome', () => {
  test('a run that exits 0 is done, with its row then what it said on stderr', () => {
    expect(actOutcome('T12', 'note', ok(`${NOTED}\n\n`, `${WOKE}\n`))).toEqual({ kind: 'told', task: 'T12', act: 'note', outcome: 'done', lines: [NOTED, WOKE] })
  })

  test('a refusal is told verbatim; one with nothing on stderr by its exit code', () => {
    expect(actOutcome('T12', 'next', failed(2, `${DONE_REFUSAL}\n`))).toEqual({ kind: 'told', task: 'T12', act: 'next', outcome: 'refused', lines: [DONE_REFUSAL] })
    expect(actOutcome('T12', 'next', failed(1, ''))).toEqual({
      kind: 'told',
      task: 'T12',
      act: 'next',
      outcome: 'refused',
      lines: ['teamrig owner next T12 exited 1'],
    })
  })
})

describe('OwnerActs: Note', () => {
  test('Note opens a new field on the card, the ring in it; each opening is a new round', async () => {
    const ports = portsOf(answering)
    const acts = new OwnerActs(CLI, ports)
    await acts.openNote('T12')
    await acts.openNote('T12')
    expect(ports.told).toEqual([
      { kind: 'noting', task: 'T12', round: 1 },
      { kind: 'noting', task: 'T12', round: 2 },
    ])
    expect(ports.focused).toEqual(['note:T12:1', 'note:T12:2'])
    expect(ports.runs).toEqual([])
  })

  test('Send runs teamrig owner note with what was typed, trimmed, tells it sends, then what it answered, the ring back on Note', async () => {
    const ports = portsOf(answering)
    const acts = new OwnerActs(CLI, ports)
    await acts.openNote('T12')
    acts.typed('  ship it today ')
    await acts.sendNote('T12')
    expect(ports.runs).toEqual([noteArgs('T12', 'ship it today')])
    expect(ports.timeouts).toEqual([ACT_TIMEOUT_MS])
    expect(ports.told.slice(1)).toEqual([
      { kind: 'sending', task: 'T12', act: 'note' },
      { kind: 'told', task: 'T12', act: 'note', outcome: 'done', lines: [NOTED, WOKE] },
    ])
    expect(ports.focused.at(-1)).toBe('act:note:T12')
  })

  test('the CLI is run with node and no --session: it finds the team from the tab\'s folder', async () => {
    const argvs: (readonly string[])[] = []
    const ports = portsOf(answering)
    const acts = new OwnerActs(CLI, {
      ...ports,
      run: async (argv, timeoutMs) => {
        argvs.push(argv)
        return ports.run(argv, timeoutMs)
      },
    })
    await acts.openNote('T12')
    await acts.sendNote('T12', 'ship it')
    expect(argvs).toEqual([cliArgv(CLI.main, noteArgs('T12', 'ship it'))])
    expect(argvs[0]?.[0]).toBe('node')
  })

  test('Enter in the field sends the text it hands over', async () => {
    const ports = portsOf(answering)
    const acts = new OwnerActs(CLI, ports)
    await acts.openNote('T12')
    acts.typed('draft')
    await acts.sendNote('T12', 'final words')
    expect(ports.runs).toEqual([noteArgs('T12', 'final words')])
  })

  test('an empty Note leaves the field open and runs nothing', async () => {
    const ports = portsOf(answering)
    const acts = new OwnerActs(CLI, ports)
    await acts.openNote('T12')
    acts.typed('   ')
    await acts.sendNote('T12')
    expect(ports.runs).toEqual([])
    expect(ports.told).toEqual([{ kind: 'noting', task: 'T12', round: 1 }])
  })

  test('a new field starts empty: the last one\'s typing is not sent', async () => {
    const ports = portsOf(answering)
    const acts = new OwnerActs(CLI, ports)
    await acts.openNote('T12')
    acts.typed('first thought')
    await acts.openNote('T12')
    await acts.sendNote('T12')
    expect(ports.runs).toEqual([])
  })

  test('Send on a card whose field is not open does nothing, its typing kept for the open one', async () => {
    const ports = portsOf(answering)
    const acts = new OwnerActs(CLI, ports)
    await acts.sendNote('T12', 'no field')
    await acts.openNote('T12')
    acts.typed('kept')
    await acts.sendNote('T9', 'stale field')
    await acts.sendNote('T12')
    expect(ports.runs).toEqual([noteArgs('T12', 'kept')])
  })

  test('a refused Note is told verbatim', async () => {
    const ports = portsOf(() => failed(2, DONE_REFUSAL))
    const acts = new OwnerActs(CLI, ports)
    await acts.openNote('T12')
    await acts.sendNote('T12', 'too late')
    expect(ports.told.at(-1)).toEqual({ kind: 'told', task: 'T12', act: 'note', outcome: 'refused', lines: [DONE_REFUSAL] })
  })

  test('Cancel closes the field, the ring back on Note; a cancel on another card does nothing', async () => {
    const ports = portsOf(answering)
    const acts = new OwnerActs(CLI, ports)
    await acts.openNote('T12')
    await acts.cancel('T9')
    await acts.cancel('T12')
    expect(ports.told).toEqual([{ kind: 'noting', task: 'T12', round: 1 }, null])
    expect(ports.focused).toEqual(['note:T12:1', 'act:note:T12'])
  })
})

describe('OwnerActs: Next', () => {
  test('Next reads the preview into a confirm, the ring on its Cancel first', async () => {
    const ports = portsOf(answering)
    const acts = new OwnerActs(CLI, ports)
    await acts.askNext('T12')
    expect(ports.runs).toEqual([nextArgs('T12', true)])
    expect(ports.told).toEqual([
      { kind: 'previewing', task: 'T12' },
      { kind: 'confirming', task: 'T12', lines: [PREVIEW] },
    ])
    expect(ports.focused).toEqual(['act:cancel:T12'])
  })

  test('the confirm runs teamrig owner next, tells what it answered, the ring back on Next', async () => {
    const ports = portsOf(answering)
    const acts = new OwnerActs(CLI, ports)
    await acts.askNext('T12')
    await acts.confirmNext('T12')
    expect(ports.runs).toEqual([nextArgs('T12', true), nextArgs('T12', false)])
    expect(ports.told.slice(2)).toEqual([
      { kind: 'sending', task: 'T12', act: 'next' },
      { kind: 'told', task: 'T12', act: 'next', outcome: 'done', lines: [NEXT] },
    ])
    expect(ports.focused.at(-1)).toBe('act:next:T12')
  })

  test('a refused preview is told verbatim, with no confirm to press', async () => {
    const ports = portsOf(() => failed(2, 'T12 is in progress: Next is for a task not started'))
    const acts = new OwnerActs(CLI, ports)
    await acts.askNext('T12')
    await acts.confirmNext('T12')
    expect(ports.runs).toEqual([nextArgs('T12', true)])
    expect(ports.told.at(-1)).toEqual({
      kind: 'told',
      task: 'T12',
      act: 'next',
      outcome: 'refused',
      lines: ['T12 is in progress: Next is for a task not started'],
    })
    expect(ports.focused).toEqual([])
  })

  test('a confirm with no preview open, or on another card, runs nothing', async () => {
    const ports = portsOf(answering)
    const acts = new OwnerActs(CLI, ports)
    await acts.confirmNext('T12')
    await acts.askNext('T12')
    await acts.confirmNext('T9')
    expect(ports.runs).toEqual([nextArgs('T12', true)])
  })

  test('Cancel closes the confirm, the ring back on Next, and its confirm then runs nothing', async () => {
    const ports = portsOf(answering)
    const acts = new OwnerActs(CLI, ports)
    await acts.askNext('T12')
    await acts.cancel('T12')
    await acts.confirmNext('T12')
    expect(ports.told.at(-1)).toBeNull()
    expect(ports.focused).toEqual(['act:cancel:T12', 'act:next:T12'])
    expect(ports.runs).toEqual([nextArgs('T12', true)])
  })

  test('Note on a card with a confirm open closes the confirm', async () => {
    const ports = portsOf(answering)
    const acts = new OwnerActs(CLI, ports)
    await acts.askNext('T12')
    await acts.openNote('T12')
    await acts.confirmNext('T12')
    expect(ports.told.at(-1)).toEqual({ kind: 'noting', task: 'T12', round: 1 })
    expect(ports.runs).toEqual([nextArgs('T12', true)])
  })
})

describe('OwnerActs: runs', () => {
  test('with no teamrig CLI found, an act runs nothing and is refused with the problem', async () => {
    const ports = portsOf(answering)
    const acts = new OwnerActs({ kind: 'missing', problem: 'teamrig is not installed' }, ports)
    await acts.askNext('T12')
    expect(ports.runs).toEqual([])
    expect(ports.told.at(-1)).toEqual({ kind: 'told', task: 'T12', act: 'next', outcome: 'refused', lines: ['teamrig is not installed'] })
  })

  test('a run that does not finish is told as refused', async () => {
    const ports = portsOf(() => new Error('timed out'))
    const acts = new OwnerActs(CLI, ports)
    await acts.openNote('T12')
    await acts.sendNote('T12', 'hello')
    expect(ports.told.at(-1)).toEqual({
      kind: 'told',
      task: 'T12',
      act: 'note',
      outcome: 'refused',
      lines: ['teamrig owner note T12 did not finish: timed out'],
    })
  })

  test('a press while a run goes does nothing; one after it runs again', async () => {
    // The run waits on a gate made before it starts (the act reaches its run a few awaits after the press).
    let open = (): void => undefined
    const gate = new Promise<void>(resolve => {
      open = resolve
    })
    const ports = portsOf(answering)
    const acts = new OwnerActs(CLI, {
      ...ports,
      run: async (argv, timeoutMs) => {
        await gate
        return ports.run(argv, timeoutMs)
      },
    })
    const first = acts.askNext('T12')
    await acts.askNext('T9')
    await acts.openNote('T9')
    await acts.cancel('T12')
    open()
    await first
    expect(ports.told.map(act => act?.kind)).toEqual(['previewing', 'confirming'])
    await acts.askNext('T9')
    expect(ports.runs).toEqual([nextArgs('T12', true), nextArgs('T9', true)])
  })

  test('a tell that fails runs nothing and leaves the acts free for the next press', async () => {
    const ports = portsOf(answering)
    let tells = 0
    const acts = new OwnerActs(CLI, {
      ...ports,
      tell: async () => {
        tells += 1
        throw new Error('store closed')
      },
    })
    await acts.askNext('T12')
    await acts.askNext('T12')
    expect(tells).toBe(2)
    expect(ports.runs).toEqual([])
  })

  test('a field whose opening could not be told takes no Send', async () => {
    const ports = portsOf(answering)
    const acts = new OwnerActs(CLI, {
      ...ports,
      tell: async () => {
        throw new Error('store closed')
      },
    })
    await acts.openNote('T12')
    await acts.sendNote('T12', 'unseen')
    expect(ports.runs).toEqual([])
  })
})
