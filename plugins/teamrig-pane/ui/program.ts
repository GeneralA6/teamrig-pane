// The dedicated UI as a program: it takes a process's streams as the terminal, runs the loop on it (app.ts) and
// answers the exit code. The process itself stays outside (main.ts hands its streams in), so all of this runs in a
// spec on fake streams. However it ends, the person's quit, a throw or a signal, the terminal is given back first:
// a program that leaves the alternate screen or the mouse reporting on has broken the person's shell.
import type { Snapshot } from '../types'
import { WrapCache } from '../hooks/layout'
import { NoteHold } from '../hooks/note-hold'
import type { PaneStore } from '../hooks/pane-store'
import { runApp, type AppDeps, type Front, type FrontLook } from './app'
import { openTerminal, type Input, type Output, type Terminal } from './terminal'

/** The signals that end the program: the terminal's window closed (SIGHUP), the process asked to stop (SIGTERM). */
export type Signal = 'SIGHUP' | 'SIGTERM'

/** Who tells of a signal: a process is one. */
export type Signals = {
  on(signal: Signal, listener: () => void): unknown
  off(signal: Signal, listener: () => void): unknown
}

/** The exit code of a quit by the person. */
export const QUIT_CODE = 0
/** The exit code of a drawing or a press that threw. */
export const FAILED_CODE = 1
/** The exit code a shell expects of a program a signal ended: 128 and the signal's number. */
export const SIGNAL_CODES: Readonly<Record<Signal, number>> = { SIGHUP: 129, SIGTERM: 143 }

export type ProgramDeps = {
  readonly input: Input
  readonly output: Output
  readonly signals: Signals
  readonly store: PaneStore
  readonly front: AppDeps['front']
  readonly look: FrontLook
  /**
   * Where the program says why it failed, a line of its own: a process's stderr is one. It is written only once the
   * screen is the person's again: said earlier, it is wiped with the frame.
   */
  readonly errors: { write(text: string): unknown }
}

/** Says why the program failed. */
function complain(deps: ProgramDeps, reason: string): void {
  deps.errors.write(`teamrig ui: ${reason}\n`)
}

/** What a thrown value says. */
function said(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The terminal over the program's streams, or what taking it threw. */
function taken(deps: ProgramDeps): { readonly terminal: Terminal } | { readonly failed: string } {
  try {
    return { terminal: openTerminal(deps.input, deps.output) }
  } catch (error) {
    return { failed: said(error) }
  }
}

/**
 * Runs the UI on the streams until the person quits, the loop throws or a signal comes; resolves the exit code and
 * never rejects. A terminal that cannot be taken is a failure said at once: nothing was drawn over it.
 */
export function runProgram(deps: ProgramDeps): Promise<number> {
  const opened = taken(deps)
  if ('failed' in opened) {
    complain(deps, opened.failed)
    return Promise.resolve(FAILED_CODE)
  }
  const { terminal } = opened
  return new Promise<number>(resolve => {
    let isOver = false
    const stops = (['SIGHUP', 'SIGTERM'] as const).map(signal => ({ signal, stop: () => over(SIGNAL_CODES[signal], null) }))
    const over = (code: number, reason: string | null): void => {
      if (isOver) return
      isOver = true
      for (const { signal, stop } of stops) deps.signals.off(signal, stop)
      terminal.close()
      if (reason !== null) complain(deps, reason)
      resolve(code)
    }
    for (const { signal, stop } of stops) deps.signals.on(signal, stop)
    runApp({ store: deps.store, terminal, front: deps.front, look: deps.look, defer: setImmediate }).then(
      () => over(QUIT_CODE, null),
      (error: unknown) => over(FAILED_CODE, said(error)),
    )
  })
}

/**
 * The front of a program with no team to read or act through: every reader and actor absent, a card opened over
 * nothing, a reference file found nowhere.
 */
export const NO_TEAM_FRONT: Front = {
  ports: {
    detailOf: task => Promise.resolve({ ref: task.ref, quotes: [], goals: [] }),
    readFile: () => Promise.resolve({ kind: 'missing', tried: [] }),
    lives: { sizer: null, tracked: null, logging: null, teaming: null, scheduling: null, tallying: null },
    logging: null,
    diffing: null,
    pinning: null,
    scheduling: null,
    pressing: null,
    acting: null,
  },
  noting: null,
}

/**
 * The look of a program in a terminal of its own: no engine hosts it, so the too-old-host line has nothing to say,
 * and it has no words of its own for tying a tab to a session.
 */
export function ownLook(): FrontLook {
  return { noteHold: new NoteHold<Snapshot>(), wraps: new WrapCache(), hostOld: () => '', tieHint: null }
}
