// What a terminal in raw mode sends, read as keys: a named key, a typed character, a click or a turn of the wheel
// (SGR 1006 mouse reports, cells counted from 0 as the painter's hits are). What a key does is the app's to say: this
// only names it. A sequence it does not know is taken whole and dropped, so its bytes are never typed into a field.
import { graphemes } from '../hooks/width'

export type KeyName =
  | 'tab'
  | 'back-tab'
  | 'enter'
  | 'escape'
  | 'backspace'
  | 'delete'
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'page-up'
  | 'page-down'
  | 'home'
  | 'end'
  | 'interrupt'

export type Key =
  | { readonly kind: 'key'; readonly name: KeyName }
  /** One character as typed: a grapheme, so a letter and its accent are one. */
  | { readonly kind: 'char'; readonly char: string }
  /** The left button pressed on the cell `column` of the frame's line `line`. */
  | { readonly kind: 'click'; readonly column: number; readonly line: number }
  /** The wheel turned one notch over that cell: `by` 1 down the body, -1 up. */
  | { readonly kind: 'wheel'; readonly by: 1 | -1; readonly column: number; readonly line: number }

const ESC = '\u001b'
/** A control sequence whole: its parameters, then its final byte. */
const CSI = /^\u001b\[([<?]?[0-9;]*)([@-~])/
/** The same keys as a terminal in application mode sends them. */
const SS3 = /^\u001bO([A-Z])/
/** C0 and DEL: the characters that are keys or nothing, never typed. */
const CONTROL = /[\u0000-\u001f\u007f]/
const DIGITS = /^[0-9]+$/

const LETTER_KEYS: Readonly<Record<string, KeyName>> = { A: 'up', B: 'down', C: 'right', D: 'left', H: 'home', F: 'end', Z: 'back-tab' }
const TILDE_KEYS: Readonly<Record<string, KeyName>> = { '1': 'home', '7': 'home', '4': 'end', '8': 'end', '3': 'delete', '5': 'page-up', '6': 'page-down' }
const CONTROL_KEYS: Readonly<Record<string, KeyName>> = {
  '\t': 'tab',
  '\r': 'enter',
  '\n': 'enter',
  '\u007f': 'backspace',
  '\b': 'backspace',
  '\u0003': 'interrupt',
}

/** The mouse report's button bits that say a key was held (Shift, Alt, Ctrl), and that the pointer only moved. */
const HELD = 4 | 8 | 16
const MOVED = 32
const LEFT = 0
const WHEEL_UP = 64
const WHEEL_DOWN = 65

function named(name: KeyName | undefined): Key | null {
  return name === undefined ? null : { kind: 'key', name }
}

/** A mouse report `<button;column;line`, pressed (`M`) or let go (`m`): a click or a notch of the wheel, else nothing. */
function mouseKey(params: string, final: string): Key | null {
  const parts = params.slice(1).split(';')
  if (parts.length !== 3 || !parts.every(part => DIGITS.test(part))) return null
  const [button, x, y] = parts.map(Number)
  if (button === undefined || x === undefined || y === undefined) return null
  if (x < 1 || y < 1 || final !== 'M' || (button & MOVED) !== 0) return null
  const at = { column: x - 1, line: y - 1 }
  switch (button & ~HELD) {
    case LEFT:
      return { kind: 'click', ...at }
    case WHEEL_UP:
      return { kind: 'wheel', by: -1, ...at }
    case WHEEL_DOWN:
      return { kind: 'wheel', by: 1, ...at }
    default:
      return null
  }
}

/** The key a control sequence is, null for one that is none of ours. A held Shift or Ctrl (`1;2A`) is the key alone. */
function csiKey(params: string, final: string): Key | null {
  if (params.startsWith('<')) return mouseKey(params, final)
  if (params.startsWith('?')) return null
  if (final === '~') return named(TILDE_KEYS[params.split(';')[0] ?? ''])
  return named(LETTER_KEYS[final])
}

type Read = { readonly key: Key | null; readonly length: number }

/** The escape sequence at the start of `rest` (which starts with ESC), with the characters it takes. */
function sequence(rest: string): Read {
  const csi = CSI.exec(rest)
  if (csi !== null) return { key: csiKey(csi[1] ?? '', csi[2] ?? ''), length: csi[0].length }
  const ss3 = SS3.exec(rest)
  if (ss3 !== null) return { key: named(LETTER_KEYS[ss3[1] ?? '']), length: ss3[0].length }
  // A control sequence the read cut short has no end to find: the rest of the read is its, and is dropped.
  if (rest.startsWith(`${ESC}[`)) return { key: null, length: rest.length }
  const next = rest[1]
  // Escape alone, or before another sequence, is the key; before a character it is Alt held with it: no key of ours.
  if (next === undefined || next === ESC) return { key: { kind: 'key', name: 'escape' }, length: 1 }
  return { key: null, length: 1 + (graphemes(rest.slice(1))[0]?.length ?? 1) }
}

/** The keys in one read of the terminal's input, in order. */
export function keysOf(input: string): Key[] {
  const keys: Key[] = []
  let rest = input
  while (rest !== '') {
    const first = rest.charAt(0)
    if (first === ESC) {
      const read = sequence(rest)
      if (read.key !== null) keys.push(read.key)
      rest = rest.slice(read.length)
      continue
    }
    if (CONTROL.test(first)) {
      const key = named(CONTROL_KEYS[first])
      if (key !== null) keys.push(key)
      rest = rest.slice(1)
      continue
    }
    const end = rest.search(CONTROL)
    const typed = end === -1 ? rest : rest.slice(0, end)
    for (const char of graphemes(typed)) keys.push({ kind: 'char', char })
    rest = rest.slice(typed.length)
  }
  return keys
}
