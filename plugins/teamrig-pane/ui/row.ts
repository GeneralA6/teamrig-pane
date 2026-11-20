// A row of the dedicated UI before it is a line of the terminal: segments left to right, each its runs and, when it
// is a press, the stop a key or a click on it lands on. Laying a row out gives the line as drawn (padded at the left,
// cut to the columns it has) and where each stop stands in it, in cells: the painter's hit regions. Widths are the
// view model's own measure (../hooks/width), so a row packed or wrapped there takes the cells counted here.
import type { Press } from '../hooks/press'
import type { NoteField } from '../hooks/rows'
import { cells, graphemes } from '../hooks/width'
import { words, type Run } from './run'

/** What a stop does: a press of the view model (press.ts), or the Note field of a task's card, typed into. */
export type Target = { readonly kind: 'press'; readonly press: Press } | { readonly kind: 'note'; readonly field: NoteField }

/**
 * A place the focus ring stops at: its key (the one the Claude Code dock draws the same press under, so a ring
 * landing names one stop in both), the key that presses it from anywhere (null for none), and what it does.
 */
export type Stop = { readonly key: string; readonly hotkey: string | null; readonly target: Target }

/** Runs side by side that are one stop, or words alone (`stop` null). */
export type Seg = { readonly runs: readonly Run[]; readonly stop: Stop | null }

export type Row = readonly Seg[]

/** A stop as laid out in its line: the cells `from` to `to`, the last not counted. */
export type LaidStop = Stop & { readonly from: number; readonly to: number }

/** A row as drawn: its runs, the stops any cell of which shows, and the cells it takes from the line's start. */
export type Laid = { readonly runs: readonly Run[]; readonly stops: readonly LaidStop[]; readonly width: number }

/** Ends a row cut at its last column. */
export const ELLIPSIS = '…'

/** Words that are no stop. */
export function plain(runs: readonly Run[]): Seg {
  return { runs, stop: null }
}

/** `count` blank cells: a gap between two segments, or a row's padding. */
export function spaces(count: number): Seg {
  return plain(count > 0 ? [words(' '.repeat(count))] : [])
}

function rowCells(row: Row): number {
  return row.reduce((sum, seg) => sum + seg.runs.reduce((width, run) => width + cells(run.text), 0), 0)
}

/** The graphemes of `text`, from its first, that fit in `room` cells. */
function fitted(text: string, room: number): string {
  if (cells(text) <= room) return text
  let width = 0
  let kept = ''
  for (const grapheme of graphemes(text)) {
    width += cells(grapheme)
    if (width > room) break
    kept += grapheme
  }
  return kept
}

/**
 * `row` laid out in a line: `left` blank cells, then its segments in `columns` cells. A row wider than that is cut
 * at a grapheme and ends in an ellipsis in its last column, so it stays one line; a stop the cut leaves no cell of
 * is no stop of the line. The runs of the stop keyed `ring` are drawn inverse: the focus ring stands there.
 */
export function laid(row: Row, left: number, columns: number, ring: string | null): Laid {
  const isCut = rowCells(row) > columns
  let room = isCut ? Math.max(0, columns - 1) : columns
  let at = Math.max(0, left)
  const runs: Run[] = at > 0 ? [words(' '.repeat(at))] : []
  const stops: LaidStop[] = []
  for (const seg of row) {
    const from = at
    const isRing = seg.stop !== null && seg.stop.key === ring
    for (const run of seg.runs) {
      const text = fitted(run.text, room)
      // A run cut short ends the line: a narrower one after it must not fill the cells a wide grapheme left.
      room = text === run.text ? room - cells(text) : 0
      if (text === '') continue
      at += cells(text)
      runs.push({ ...run, text, inverse: run.inverse || isRing })
    }
    if (seg.stop !== null && at > from) stops.push({ ...seg.stop, from, to: at })
  }
  if (isCut && columns > 0) {
    runs.push(words(ELLIPSIS))
    at += cells(ELLIPSIS)
  }
  return { runs, stops, width: at }
}
