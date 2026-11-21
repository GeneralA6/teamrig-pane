// The dedicated UI as a program, on fake streams and signals: the exit code of each way it ends, the terminal given
// back before anything is said, and the front and look of a program with no team behind it.
import { describe, expect, test } from 'claude-code/testing'
import { scrolledTo } from '../hooks/body-scroll'
import { readRegister } from '../hooks/core/read/index'
import { rowOf } from '../hooks/log'
import { INITIAL_STATE } from '../hooks/pane-state'
import { MemoryStore } from '../hooks/pane-store'
import type { AppDeps } from '../ui/app'
import { FAILED_CODE, NO_TEAM_FRONT, ownLook, QUIT_CODE, runProgram, SIGNAL_CODES, type Signal } from '../ui/program'
import { ENTER, LEAVE, type Input, type Output } from '../ui/terminal'
import { HOUR, NOW, createLine } from './fixtures'

const ESC = '\u001b'
/** How a frame starts (terminal.ts screenText): the cursor sent to the first cell. */
const FRAME = `${ESC}[H`

type Rig = {
  /** What happened outside the program, in order: `enter`, `frame`, `leave`, `pause`, `complain <text>`. */
  readonly log: string[]
  readonly store: MemoryStore
  readonly code: Promise<number>
  send(chunk: string): void
  signal(signal: Signal): void
  /** The signals still listened for. */
  heard(): Signal[]
}

type RigOptions = {
  /** What the output throws at each frame: a screen that went away. */
  readonly gone?: Error
  readonly front?: AppDeps['front']
}

function wrote(text: string): string {
  if (text === ENTER) return 'enter'
  if (text === LEAVE) return 'leave'
  return text.startsWith(FRAME) ? 'frame' : `other ${text}`
}

function rig(options: RigOptions = {}): Rig {
  const log: string[] = []
  const store = new MemoryStore(INITIAL_STATE)
  let onData: ((chunk: string) => void)[] = []
  let onSignal: { readonly signal: Signal; readonly listener: () => void }[] = []
  const input: Input = {
    setEncoding: () => undefined,
    resume: () => undefined,
    pause: () => {
      log.push('pause')
    },
    on: (_event, listener) => {
      onData = [...onData, listener]
    },
    off: (_event, listener) => {
      onData = onData.filter(each => each !== listener)
    },
  }
  const output: Output = {
    columns: 60,
    rows: 20,
    write: text => {
      const what = wrote(text)
      if (what === 'frame' && options.gone !== undefined) throw options.gone
      log.push(what)
    },
    on: () => undefined,
    off: () => undefined,
  }
  const code = runProgram({
    input,
    output,
    signals: {
      on: (signal, listener) => {
        onSignal = [...onSignal, { signal, listener }]
      },
      off: (signal, listener) => {
        onSignal = onSignal.filter(each => each.signal !== signal || each.listener !== listener)
      },
    },
    store,
    front: options.front ?? (() => NO_TEAM_FRONT),
    look: ownLook(),
    complain: text => {
      log.push(`complain ${text}`)
    },
  })
  return {
    log,
    store,
    code,
    send: chunk => {
      for (const listener of onData) listener(chunk)
    },
    signal: signal => {
      for (const each of onSignal) if (each.signal === signal) each.listener()
    },
    heard: () => onSignal.map(each => each.signal),
  }
}

const tick = () => new Promise<void>(resolve => setImmediate(resolve))

/** Long enough for a key to be answered and the drawing after it to run. */
async function settled(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await tick()
}

/** A rig after its first drawing. */
async function started(options: RigOptions = {}): Promise<Rig> {
  const program = rig(options)
  await settled()
  return program
}

const RUNNING = 'still running'

/** The exit code, or RUNNING while the program has not ended: a spec never waits on one that hangs. */
async function ending(program: Rig): Promise<number | typeof RUNNING> {
  await settled()
  return Promise.race([program.code, tick().then((): typeof RUNNING => RUNNING)])
}

/** The log without its frames. */
const outside = (program: Rig): string[] => program.log.filter(entry => entry !== 'frame')

describe('the program on a terminal', () => {
  test('takes the screen, draws, and runs until told to end', async () => {
    const program = await started()
    expect(program.log.slice(0, 2)).toEqual(['enter', 'frame'])
    expect(program.heard()).toEqual(['SIGHUP', 'SIGTERM'])
    expect(await ending(program)).toBe(RUNNING)
  })

  test("the person's quit gives the terminal back and exits 0", async () => {
    const program = await started()
    program.send('q')
    expect(await ending(program)).toBe(QUIT_CODE)
    expect(outside(program)).toEqual(['enter', 'leave', 'pause'])
    expect(program.heard()).toEqual([])
  })

  test('a signal gives the terminal back and exits with the code a shell expects of it', async () => {
    for (const signal of ['SIGHUP', 'SIGTERM'] as const) {
      const program = await started()
      program.signal(signal)
      expect(await ending(program)).toBe(SIGNAL_CODES[signal])
      expect(outside(program)).toEqual(['enter', 'leave', 'pause'])
      expect(program.heard()).toEqual([])
    }
    expect(SIGNAL_CODES).toEqual({ SIGHUP: 129, SIGTERM: 143 })
  })

  test('a drawing that throws exits 1, and says why only once the screen is given back', async () => {
    const program = await started({ gone: new Error('the screen went away') })
    expect(await ending(program)).toBe(FAILED_CODE)
    expect(program.log).toEqual(['enter', 'leave', 'pause', 'complain teamrig ui: the screen went away'])
    expect(program.heard()).toEqual([])
  })

  test('a thrown value that is no error is said as it reads', async () => {
    const program = await started({
      front: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- the case under test: code that throws a bare value
        throw 'no ports'
      },
    })
    expect(await ending(program)).toBe(FAILED_CODE)
    expect(program.log.at(-1)).toBe('complain teamrig ui: no ports')
  })

  test('a throw after the end says nothing: the exit code is the one the program ended with', async () => {
    let isBroken = false
    const program = await started({
      front: () => {
        if (isBroken) throw new Error('late')
        return NO_TEAM_FRONT
      },
    })
    program.signal('SIGTERM')
    isBroken = true
    await program.store.update('bodyScroll', current => scrolledTo(current, { kind: 'offset', offset: 1 }))
    expect(await ending(program)).toBe(SIGNAL_CODES.SIGTERM)
    expect(outside(program)).toEqual(['enter', 'leave', 'pause'])
  })
})

describe('a program with no team behind it', () => {
  test('opens a card over nothing and finds no reference file', async () => {
    const [task] = [...readRegister(createLine('T50', { owner: 'po', by: 'lead', at: NOW - HOUR, title: 'A task' })).state.tasks.values()].map(row => rowOf(row))
    if (task === undefined) throw new Error('the register line made no task')
    expect(await NO_TEAM_FRONT.ports.detailOf(task)).toEqual({ ref: task.ref, quotes: [], goals: [] })
    expect(await NO_TEAM_FRONT.ports.readFile('notes.md')).toEqual({ kind: 'missing', tried: [] })
    expect(NO_TEAM_FRONT.ports.acting).toBeNull()
    expect(NO_TEAM_FRONT.noting).toBeNull()
  })

  test('has no line for a host too old and no words for tying a tab, and a look of its own each time', () => {
    const look = ownLook()
    expect(look.hostOld({ major: 2, minor: 1, patch: 0 })).toBe('')
    expect(look.tieHint).toBeNull()
    expect(ownLook().wraps).not.toBe(look.wraps)
    expect(ownLook().noteHold).not.toBe(look.noteHold)
  })
})
