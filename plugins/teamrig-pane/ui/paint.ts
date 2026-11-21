// One drawing of the dedicated UI: the head, a blank row, then the body's window with its scroll bar, as the lines a
// terminal is written and the cells each stop takes in them. Pure: the same head, body and look paint the same
// frame, so the app only keeps the look (the terminal's size, the scroll offset, the ring, the field typed in) and
// asks again when one of them or the store changes. A terminal has no scroller of its own, so the window is the only
// way the body is shown: a head taller than the screen is cut at the screen's last row.
import { frameOf, placesOf, thumbOf, viewOf, type Placed, type View } from '../hooks/frame'
import type { Head } from '../hooks/head'
import type { Drawn } from '../hooks/layout'
import { slotRows } from './paint-body'
import { headRowsOf, type Typing } from './paint-head'
import { laid, type LaidStop, type Row } from './row'
import { words, type Run } from './run'

/** The terminal's cells. */
export type Size = { readonly columns: number; readonly rows: number }

/** What the app alone knows of a drawing: the screen, where the window stands, the ring's stop, the field typed in. */
export type Look = {
  readonly size: Size
  /** The body's first row the window is asked to show; held to the body's own (frame.ts viewOf). */
  readonly offset: number
  /** The key of the stop the focus ring stands on, null when it stands on none. */
  readonly ring: string | null
  readonly typing: Typing | null
}

/** A stop where it is drawn: its line of the frame, and its cells in it. */
export type Hit = LaidStop & { readonly line: number }

/**
 * A drawing: exactly as many lines as the screen has rows, the stops drawn in them, and the body's places with the
 * window over them (`view` null for the minimized strip, which draws no body), so the app scrolls and reveals a
 * stop without laying the body out again.
 */
export type Frame = {
  readonly lines: readonly (readonly Run[])[]
  readonly hits: readonly Hit[]
  readonly view: View | null
  readonly places: readonly Placed[]
}

/** The blank cells at each side of every line; the right one holds the scroll bar. */
export const PADDING = 1
/** The rows between two elements of the body, and between the head and the body. */
export const GAP = 1
/** The scroll bar: its thumb, and the track it moves in. */
export const THUMB = '┃'
export const TRACK = '│'

/** The columns the head and the body are laid out in: what the app gives the screen as its look's columns. */
export function bodyColumns(size: Size): number {
  return Math.max(0, size.columns - 2 * PADDING)
}

/** The rows the body's window takes under a head of `headRows` rows. */
export function windowRows(size: Size, headRows: number): number {
  return Math.max(0, size.rows - headRows - GAP)
}

type Line = { readonly runs: readonly Run[]; readonly stops: readonly LaidStop[] }

const EMPTY: Line = { runs: [], stops: [] }

/** The scroll bar's cell beside the window's row `row`: none when the body fits the window. */
function barRun(view: View, row: number): Run | null {
  const thumb = thumbOf(view, view.visibleRows)
  if (thumb === null) return null
  return row >= thumb.top && row < thumb.top + thumb.size ? words(THUMB) : { ...words(TRACK), dim: true }
}

/** The window's lines: its rows laid out, each padded to the bar's column when the body scrolls. */
function windowLines(rows: readonly Row[], view: View, look: Look): Line[] {
  const columns = bodyColumns(look.size)
  return Array.from({ length: view.visibleRows }, (_, i): Line => {
    const line = laid(rows[i] ?? [], PADDING, columns, look.ring)
    const bar = look.size.columns >= 2 * PADDING ? barRun(view, i) : null
    if (bar === null) return line
    const fill = PADDING + columns - line.width
    return { runs: [...line.runs, ...(fill > 0 ? [words(' '.repeat(fill))] : []), bar], stops: line.stops }
  })
}

/**
 * The frame of `head` over `body` on a screen of `look.size`: the head's rows, a blank row, then the body's window
 * at `look.offset`, the stop keyed `look.ring` drawn inverse. The minimized strip is its head alone.
 */
export function paint(head: Head, body: readonly Drawn[], look: Look): Frame {
  const columns = bodyColumns(look.size)
  const headLines: Line[] = headRowsOf(head, look.typing).map(row => laid(row, PADDING, columns, look.ring))
  const places = head.strip ? [] : placesOf(body, GAP)
  const view = head.strip ? null : viewOf(places, look.offset, windowRows(look.size, headLines.length))
  const under = view === null ? [] : [EMPTY, ...windowLines(frameOf(places, view).flatMap(slot => slotRows(slot, look.typing)), view, look)]
  const drawn = [...headLines, ...under].slice(0, Math.max(0, look.size.rows))
  const blank = Array.from({ length: Math.max(0, look.size.rows) - drawn.length }, () => EMPTY)
  const lines = [...drawn, ...blank]
  return {
    lines: lines.map(line => line.runs),
    hits: lines.flatMap((line, i) => line.stops.map(stop => ({ ...stop, line: i }))),
    view,
    places,
  }
}
