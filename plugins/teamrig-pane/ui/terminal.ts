// The terminal behind a port, so the app draws frames and reads keys without naming a stream: the real one takes the
// whole screen (the alternate screen, so the user's scrollback is as it was once the program ends), reads raw input
// with the mouse reported (SGR 1006), and `close` gives all of it back; the app closes it on its way out, a thrown
// error included. A frame is written over the last one from the screen's first cell, each line cleared to its end,
// with no screen clear between two frames: a clear is what flickers.
import { keysOf, type Key } from './keys'
import type { Size } from './paint'
import { printedLine, type Run } from './run'

/** What the app draws on and reads keys from. */
export interface Terminal {
  /** Draws `lines` from the screen's first row down, over what was drawn before. */
  draw(lines: readonly (readonly Run[])[]): void
  /** The screen's cells now. */
  size(): Size
  /** Tells `listener` of each key, click and wheel turn, in the order read. */
  onKey(listener: (key: Key) => void): void
  /** Tells `listener` of the screen's cells each time they change. */
  onResize(listener: (size: Size) => void): void
  /** Gives the screen and the input back as they were; a second call does nothing. */
  close(): void
}

/** What the terminal reads keys from: a process's stdin is one. */
export type Input = {
  /** Absent when the input is no terminal (a pipe): it is then read as it comes. */
  setRawMode?(raw: boolean): unknown
  setEncoding(encoding: 'utf8'): unknown
  resume(): unknown
  pause(): unknown
  on(event: 'data', listener: (chunk: string) => void): unknown
  off(event: 'data', listener: (chunk: string) => void): unknown
}

/** What the terminal writes to: a process's stdout is one. */
export type Output = {
  write(text: string): unknown
  /** Absent when the output is no terminal. */
  readonly columns?: number
  readonly rows?: number
  on(event: 'resize', listener: () => void): unknown
  off(event: 'resize', listener: () => void): unknown
}

const ESC = '\u001b'

/** Taking the screen: the alternate screen, the cursor hidden, clicks and the wheel reported as SGR 1006. */
export const ENTER = `${ESC}[?1049h${ESC}[?25l${ESC}[?1000h${ESC}[?1006h`

/** Giving it back, each step of ENTER undone in reverse. */
export const LEAVE = `${ESC}[?1006l${ESC}[?1000l${ESC}[?25h${ESC}[?1049l`

/** The cells an output that is no terminal is taken to have. */
export const FALLBACK: Size = { columns: 80, rows: 24 }

const HOME = `${ESC}[H`
const CLEAR_LINE = `${ESC}[K`
const CLEAR_BELOW = `${ESC}[J`

/**
 * A frame as a terminal reads it. No line break follows the last line: a frame has as many lines as the screen has
 * rows, and a break after the last would scroll the first one off.
 */
export function screenText(lines: readonly (readonly Run[])[]): string {
  return `${HOME}${lines.map(line => `${printedLine(line)}${CLEAR_LINE}`).join('\r\n')}${CLEAR_BELOW}`
}

/** The terminal over `input` and `output`, taken at once and held until `close`. */
export function openTerminal(input: Input, output: Output): Terminal {
  const keyListeners: ((key: Key) => void)[] = []
  const sizeListeners: ((size: Size) => void)[] = []
  let isOpen = true
  const size = (): Size => ({ columns: output.columns ?? FALLBACK.columns, rows: output.rows ?? FALLBACK.rows })
  const onData = (chunk: string): void => {
    for (const key of keysOf(chunk)) for (const listener of keyListeners) listener(key)
  }
  const onResized = (): void => {
    const now = size()
    for (const listener of sizeListeners) listener(now)
  }
  input.setRawMode?.(true)
  input.setEncoding('utf8')
  input.on('data', onData)
  input.resume()
  output.on('resize', onResized)
  output.write(ENTER)
  return {
    draw(lines) {
      if (isOpen) output.write(screenText(lines))
    },
    size,
    onKey(listener) {
      keyListeners.push(listener)
    },
    onResize(listener) {
      sizeListeners.push(listener)
    },
    close() {
      if (!isOpen) return
      isOpen = false
      output.write(LEAVE)
      output.off('resize', onResized)
      input.off('data', onData)
      input.setRawMode?.(false)
      input.pause()
    },
  }
}
