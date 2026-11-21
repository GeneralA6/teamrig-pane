// The dedicated UI's loop on a fake terminal and a store kept in memory: what it draws, and what each key does.
import { describe, expect, test } from 'claude-code/testing'
import type { PaneState, Snapshot, TaskRow } from '../types'
import { readRegister } from '../hooks/core/read/index'
import { WHEEL_ROWS } from '../hooks/frame'
import { WrapCache } from '../hooks/layout'
import { rowOf } from '../hooks/log'
import { NoteHold } from '../hooks/note-hold'
import { OwnerActs } from '../hooks/owner-acts'
import { INITIAL_STATE } from '../hooks/pane-state'
import { MemoryStore } from '../hooks/pane-store'
import type { ViewLives } from '../hooks/steps'
import type { TeamrigCli } from '../hooks/teamrig-cli'
import { runApp, type AppDeps, type Ports } from '../ui/app'
import type { Key, KeyName } from '../ui/keys'
import type { Size } from '../ui/paint'
import type { Run } from '../ui/run'
import type { Terminal } from '../ui/terminal'
import { HOUR, NOW, NO_TEAM, SNAPSHOT_SETTINGS, createLine } from './fixtures'

const TASKS: TaskRow[] = [
  ...readRegister(
    Array.from({ length: 12 }, (_, i) => createLine(`T${50 + i}`, { owner: 'po', by: 'lead', at: NOW - HOUR, title: `Task number ${i}` })).join('\n'),
  ).state.tasks.values(),
].map(task => rowOf(task))
const SNAP: Snapshot = { tasks: TASKS, area: 'po', areaSource: 'pinned', unreadInbox: null, inbox: [], problem: null, ...NO_TEAM, ...SNAPSHOT_SETTINGS, now: NOW }
const STATE: PaneState = { ...INITIAL_STATE, snapshot: SNAP }
const NO_READERS: ViewLives = { sizer: null, tracked: null, logging: null, teaming: null, scheduling: null, tallying: null }
const CLI: TeamrigCli = { kind: 'found', main: 'K/teamrig/dist/cli/main.js' }

const PORTS: Ports = {
  detailOf: task => Promise.resolve({ ref: task.ref, quotes: [], goals: [] }),
  readFile: file => Promise.resolve({ kind: 'read', path: `C:/kit/${file}`, text: 'one' }),
  lives: NO_READERS,
  logging: null,
  diffing: null,
  pinning: null,
  scheduling: null,
  pressing: null,
  acting: null,
}

type RigOptions = {
  readonly store?: MemoryStore
  /** What the terminal throws at each drawing: a screen that went away. */
  readonly gone?: Error
  /** The front of a rig, given its store; every port null when left out. */
  readonly front?: (store: MemoryStore) => AppDeps['front']
}

type Rig = {
  readonly store: MemoryStore
  /** Each drawing's lines as text. */
  readonly drawn: string[][]
  readonly closes: () => number
  readonly over: Promise<void>
  /** Sends keys one after the other, then waits until no drawing is asked for. */
  keys(...keys: Key[]): Promise<void>
  resize(size: Size): Promise<void>
  idle(): Promise<void>
}

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0))

function rig(size: Size, options: RigOptions = {}): Rig {
  const store = options.store ?? new MemoryStore(STATE)
  const drawn: string[][] = []
  const pending: (() => void)[] = []
  let now = size
  let closed = 0
  let onKey: (key: Key) => void = () => {}
  let onResize: (size: Size) => void = () => {}
  const terminal: Terminal = {
    draw: (lines: readonly (readonly Run[])[]) => {
      if (options.gone !== undefined) throw options.gone
      drawn.push(lines.map(line => line.map(run => run.text).join('').trimEnd()))
    },
    size: () => now,
    onKey: listener => {
      onKey = listener
    },
    onResize: listener => {
      onResize = listener
    },
    close: () => {
      closed += 1
    },
  }
  const idle = async (): Promise<void> => {
    let quiet = 0
    while (quiet < 2) {
      await tick()
      const steps = pending.splice(0)
      quiet = steps.length === 0 ? quiet + 1 : 0
      for (const step of steps) step()
    }
  }
  const over = runApp({
    store,
    terminal,
    front: options.front?.(store) ?? (() => ({ ports: PORTS, noting: null })),
    look: { noteHold: new NoteHold<Snapshot>(), wraps: new WrapCache(), hostOld: () => 'host too old', tieHint: null },
    defer: step => {
      pending.push(step)
    },
  })
  // Held from the start: an app that ends on a throw while keys are sent has no one waiting on it yet.
  over.catch(() => undefined)
  return {
    store,
    drawn,
    closes: () => closed,
    over,
    idle,
    keys: async (...keys) => {
      for (const key of keys) onKey(key)
      await idle()
    },
    resize: async next => {
      now = next
      onResize(next)
      await idle()
    },
  }
}

/** A rig after its first drawing. */
async function started(size: Size, options: RigOptions = {}): Promise<Rig> {
  const app = rig(size, options)
  await app.idle()
  return app
}

const named = (name: KeyName): Key => ({ kind: 'key', name })
const char = (text: string): Key => ({ kind: 'char', char: text })
const typed = (text: string): Key[] => [...text].map(char)
const last = (app: Rig): string[] => app.drawn.at(-1) ?? []
const shown = (app: Rig): string => last(app).join('\n')

/** A click on the first cell of `words` in the last drawing. */
function click(app: Rig, words: string): Key {
  const lines = last(app)
  const line = lines.findIndex(text => text.includes(words))
  if (line < 0) throw new Error(`no "${words}" drawn in:\n${lines.join('\n')}`)
  return { kind: 'click', column: (lines[line] ?? '').indexOf(words) + 1, line }
}

const RUNNING = 'still running'

/** How the app ended: null for the person's quit, else what it threw; RUNNING when it has not. */
async function ending(app: Rig): Promise<unknown> {
  await app.idle()
  return Promise.race([
    app.over.then(
      () => null,
      (error: unknown) => error,
    ),
    tick().then(() => RUNNING),
  ])
}

const WIDE = 60
const SHORT: Size = { columns: WIDE, rows: 30 }
const TALL: Size = { columns: WIDE, rows: 200 }
/** The row the body starts on, under the Tasks view's head. */
const bodyTop = (app: Rig): number => (app.drawn[0] ?? []).findIndex(line => line.includes('12 active'))
/** A body's rows less the scroll bar's column. */
const bodyOf = (lines: readonly string[], top: number): string[] => lines.slice(top).map(line => line.slice(0, WIDE - 1).trimEnd())

describe('the first drawing', () => {
  test('fills the terminal once, the head over the body', async () => {
    const app = await started(SHORT)
    expect(app.drawn.length).toBe(1)
    expect(last(app).length).toBe(SHORT.rows)
    expect((last(app)[0] ?? '').trim()).toBe('po (pinned)')
    expect(shown(app)).toContain('[ Tasks ] [ Changes ] [ Conversations ] [ Inbox ]')
    expect(shown(app)).toContain('○ T50  Task number 0')
    await app.idle()
    expect(app.drawn.length).toBe(1)
  })

  test('is drawn again at a new size', async () => {
    const app = await started(SHORT)
    await app.resize({ columns: 80, rows: 20 })
    expect(app.drawn.length).toBe(2)
    expect(last(app).length).toBe(20)
    expect(shown(app)).toContain('[ Tasks ] [ Changes ] [ Conversations ] [ Inbox ] [ Teams ]')
  })
})

describe('the ring', () => {
  test('Tab steps it, and Enter presses its stop, each key on its own drawing', async () => {
    const app = await started(SHORT)
    await app.keys(...Array.from({ length: 6 }, () => named('tab')), named('enter'))
    expect(shown(app)).toContain('Reading the meetings…')
    expect(app.drawn.length).toBe(8)
    expect((await app.store.read('ring')).count).toBe(7)
  })

  test('Shift+Tab from no stop lands on the last, shown by moving the window, and Tab goes round to the first', async () => {
    const app = await started(SHORT)
    expect(shown(app)).not.toContain('T61')
    await app.keys(named('back-tab'))
    expect(shown(app)).toContain('○ T61  Task number 11')
    await app.keys(named('enter'))
    expect(shown(app)).toContain('Status       not started')
    await app.keys(named('back-tab'), named('tab'), named('tab'), named('enter'))
    expect(await app.store.read('view')).toBe('tasks')
    expect((await app.store.read('ring')).count).toBe(6)
  })

  test('a click presses the stop under it', async () => {
    const app = await started(SHORT)
    await app.keys(click(app, '[ Meetings ]'))
    expect(shown(app)).toContain('Reading the meetings…')
    expect((await app.store.read('ring')).count).toBe(1)
    const before = app.drawn.length
    await app.keys({ kind: 'click', column: WIDE - 1, line: 0 })
    expect((await app.store.read('ring')).count).toBe(1)
    expect(app.drawn.length).toBe(before + 1)
  })

  test('Esc presses the way back', async () => {
    const app = await started(SHORT)
    await app.keys(char('k'))
    expect(shown(app)).toContain('Tasks › Keys')
    expect(shown(app)).not.toContain('12 not started')
    await app.keys(named('escape'))
    expect(shown(app)).toContain('12 not started')
  })
})

describe('the window', () => {
  test('moves by the arrows, the page keys, Home, End and the wheel', async () => {
    const tall = await started(TALL)
    const app = await started(SHORT)
    const top = bodyTop(app)
    const rows = SHORT.rows - top
    const full = bodyOf(tall.drawn[0] ?? [], top)
    const from = (offset: number): string[] => full.slice(offset, offset + rows)
    const end = full.findLastIndex(line => line !== '') + 1 - rows
    const wheel = (by: 1 | -1): Key => ({ kind: 'wheel', by, column: 5, line: top + 2 })
    const after = async (...keys: Key[]): Promise<string[]> => {
      await app.keys(...keys)
      return bodyOf(last(app), top)
    }
    expect(bodyOf(last(app), top)).toEqual(from(0))
    expect(await after(named('down'), named('down'))).toEqual(from(2))
    expect(await after(named('up'))).toEqual(from(1))
    expect(await after(named('page-down'))).toEqual(from(1 + rows))
    expect(await after(named('page-up'), named('page-up'))).toEqual(from(0))
    expect(await after(named('end'))).toEqual(from(end))
    expect(await after(named('down'))).toEqual(from(end))
    expect(await after(named('home'))).toEqual(from(0))
    expect(await after(wheel(1))).toEqual(from(WHEEL_ROWS))
    expect(await after(wheel(-1))).toEqual(from(0))
  })

  test('keys with no part in a list do nothing', async () => {
    const app = await started(SHORT)
    const first = last(app)
    await app.keys(named('left'), named('right'), named('delete'), named('backspace'), named('enter'), named('escape'), char('z'))
    expect(last(app)).toEqual(first)
  })
})

describe('the Find field', () => {
  test('takes what is typed once the ring is on it, q too, and Esc gives the keys back', async () => {
    const app = await started(SHORT)
    await app.keys(char('s'))
    await app.keys(...typed('number 3'))
    expect(shown(app)).toContain('Find number 3')
    expect(shown(app)).toContain('1 task matches')
    await app.keys(char('q'))
    expect(shown(app)).toContain('Find number 3q')
    expect(shown(app)).toContain('Nothing matches.')
    await app.keys(named('backspace'))
    expect(shown(app)).toContain('1 task matches')
    expect(app.closes()).toBe(0)
    await app.keys(named('escape'), char('q'))
    expect(await ending(app)).toBeNull()
    expect(app.closes()).toBe(1)
  })

  test('opens by / as well, and Enter opens the one match', async () => {
    const app = await started(SHORT)
    await app.keys(char('/'), ...typed('number 3'), named('enter'))
    expect(shown(app)).toContain('Tasks › Search "number 3" › T53')
    expect(shown(app)).toContain('Find id, title, owner, note…')
  })

  test('leaves Tab to the ring', async () => {
    const app = await started(SHORT)
    await app.keys(char('s'), char('a'), named('tab'), char('q'))
    expect(await ending(app)).toBeNull()
  })
})

describe('a Note field', () => {
  const acted =
    (runs: string[][]) =>
    (store: MemoryStore): AppDeps['front'] => {
      let held: OwnerActs | null = null
      return focus => {
        held ??= new OwnerActs(CLI, {
          run: argv => {
            runs.push(argv.slice(2))
            return Promise.resolve({ exitCode: 0, stdout: 'T61 noted\n', stderr: '', isStdoutTruncated: false })
          },
          tell: async act => {
            await store.update('ownerAct', () => act)
          },
          focus,
        })
        const acts = held
        return { ports: { ...PORTS, acting: acts }, noting: { typed: text => acts.typed(text), send: (task, text) => acts.sendNote(task, text) } }
      }
    }

  test('takes the ring when its press opens it, and Enter sends what was typed', async () => {
    const runs: string[][] = []
    const app = await started(TALL, { front: acted(runs) })
    await app.keys(named('back-tab'), named('enter'))
    await app.keys(click(app, '[Note]'))
    expect(await app.store.read('ownerAct')).toEqual({ kind: 'noting', task: 'T61', round: 1 })
    expect(shown(app)).toContain('[Send] [Cancel]')
    await app.keys(...typed('quick, q'))
    expect(shown(app)).toContain('quick, q')
    expect(app.closes()).toBe(0)
    await app.keys(named('backspace'), named('enter'))
    expect(runs).toEqual([['owner', 'note', 'T61', '--text', 'quick,']])
    expect(shown(app)).toContain('T61 noted')
  })

  test('is closed by Esc, nothing sent, and a new one starts empty', async () => {
    const runs: string[][] = []
    const app = await started(TALL, { front: acted(runs) })
    await app.keys(named('back-tab'), named('enter'))
    await app.keys(click(app, '[Note]'))
    await app.keys(...typed('draft'), named('escape'))
    expect(await app.store.read('ownerAct')).toBeNull()
    expect(shown(app)).not.toContain('draft')
    await app.keys(named('enter'))
    expect(await app.store.read('ownerAct')).toEqual({ kind: 'noting', task: 'T61', round: 2 })
    expect(shown(app)).not.toContain('draft')
    await app.keys(named('escape'), char('q'))
    expect(await ending(app)).toBeNull()
    expect(runs).toEqual([])
  })

  test('with no one to take a note, typing and Enter change nothing', async () => {
    const app = await started(TALL, {
      store: new MemoryStore({ ...STATE, ownerAct: { kind: 'noting', task: 'T61', round: 1 } }),
      front: () => focus => ({ ports: { ...PORTS, acting: { press: () => focus('gone') } }, noting: null }),
    })
    await app.keys(named('back-tab'), named('enter'))
    await app.keys(click(app, "a Note to T61's session"))
    await app.keys(char('a'), named('enter'))
    expect(await app.store.read('ownerAct')).toEqual({ kind: 'noting', task: 'T61', round: 1 })
    expect(app.closes()).toBe(0)
  })
})

describe('the end', () => {
  test('q gives the terminal back once, and later keys are dropped', async () => {
    const app = await started(SHORT)
    await app.keys(char('q'))
    expect(await ending(app)).toBeNull()
    const drawings = app.drawn.length
    await app.keys(named('tab'), char('q'))
    await app.resize({ columns: 80, rows: 20 })
    expect(app.closes()).toBe(1)
    expect(app.drawn.length).toBe(drawings)
  })

  test('Ctrl+C ends it from a field too', async () => {
    const app = await started(SHORT)
    await app.keys(char('s'), named('interrupt'))
    expect(await ending(app)).toBeNull()
    expect(app.closes()).toBe(1)
  })

  test('a drawing that throws ends it with what was thrown, the terminal given back', async () => {
    const app = await started(SHORT, { gone: new Error('no screen') })
    expect(await ending(app)).toEqual(new Error('no screen'))
    expect(app.closes()).toBe(1)
  })

  test('a press that throws ends it the same way', async () => {
    const app = await started(SHORT, {
      front: () => () => ({ ports: { ...PORTS, detailOf: () => Promise.reject(new Error('no detail')) }, noting: null }),
    })
    await app.keys(char('s'), ...typed('number 3'), named('enter'))
    expect(await ending(app)).toEqual(new Error('no detail'))
    expect(app.closes()).toBe(1)
  })
})
