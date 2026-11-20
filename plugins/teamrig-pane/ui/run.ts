// The dedicated UI's text: a run is words in one style, and a line of runs prints as the escape codes a terminal
// reads. The one place the rows' tones (../hooks/tone) meet a terminal's colors, as theme.ts is for the Claude Code
// dock. What a run prints comes from the register, the inbox and files on disk, so no control character of it ever
// reaches the terminal: a title that held an escape code would otherwise draw, move or retitle as it liked.
import type { Span } from '../hooks/rows'
import type { Tone } from '../hooks/tone'

/** Words in one style. `href` makes them a link (OSC 8); `inverse` marks the press the ring stands on. */
export type Run = {
  readonly text: string
  readonly tone: Tone | null
  readonly bold: boolean
  readonly dim: boolean
  readonly underline: boolean
  readonly inverse: boolean
  readonly href: string | null
}

/**
 * Each tone's foreground code, from the terminal's own sixteen colors so the user's theme decides the shade; a
 * Record, so a tone added with no color fails the typecheck.
 */
export const TONE_SGR: Readonly<Record<Tone, number>> = {
  warning: 33,
  error: 31,
  success: 32,
  suggestion: 34,
  subtle: 90,
  accent: 36,
}

const BOLD = 1
const DIM = 2
const UNDERLINE = 4
const INVERSE = 7
const ESC = '\u001b'
const RESET = `${ESC}[0m`
/** OSC 8's end (ST), and the link that ends one. */
const ST = `${ESC}\\`
const LINK_END = `${ESC}]8;;${ST}`
/** C0, DEL and C1: every character a terminal acts on rather than draws. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g
const TAB = /\t/g

/** `text` as a terminal only draws it: a tab is a space, every other control character is gone. */
export function drawable(text: string): string {
  return text.replace(TAB, ' ').replace(CONTROL, '')
}

/** A link a terminal may be handed: one with no control character in it, else none. */
function safeHref(href: string | undefined): string | null {
  if (href === undefined || href === '') return null
  return drawable(href) === href ? href : null
}

/** Words in no style. */
export function words(text: string): Run {
  return { text: drawable(text), tone: null, bold: false, dim: false, underline: false, inverse: false, href: null }
}

/** A span of the view model as a run. The painter splits a span at its line ends first: a run holds none. */
export function runOf(span: Span): Run {
  return {
    text: drawable(span.text),
    tone: span.color ?? null,
    bold: span.bold === true,
    dim: span.dim === true,
    underline: span.underline === true,
    inverse: false,
    href: safeHref(span.href),
  }
}

/** The codes a run's style sets, in a fixed order; none for plain words. */
function codesOf(run: Run): number[] {
  return [
    ...(run.bold ? [BOLD] : []),
    ...(run.dim ? [DIM] : []),
    ...(run.underline ? [UNDERLINE] : []),
    ...(run.inverse ? [INVERSE] : []),
    ...(run.tone === null ? [] : [TONE_SGR[run.tone]]),
  ]
}

/** A run as a terminal reads it: its style set before its words and reset after, a link around both. */
export function printed(run: Run): string {
  if (run.text === '') return ''
  const codes = codesOf(run)
  const styled = codes.length === 0 ? run.text : `${ESC}[${codes.join(';')}m${run.text}${RESET}`
  return run.href === null ? styled : `${ESC}]8;;${run.href}${ST}${styled}${LINK_END}`
}

/** A line of runs as a terminal reads it. */
export function printedLine(runs: readonly Run[]): string {
  return runs.map(printed).join('')
}
