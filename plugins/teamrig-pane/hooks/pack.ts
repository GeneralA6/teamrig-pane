// How the header's rows wrap, counted in code. The dock's header (switch, mode buttons, a page's trail,
// the Archive week's steps) keeps its rows fixed above the body's window, so the window's height is the
// pane's rows less the header's: the header draws each row pre-packed here (one row Box a row, no
// flexWrap), and the rows it draws are the rows it counts. Packing follows the engine's flex wrap: items
// left to right, `gap` cells between two on a row, a new row when the next would run past the width; one
// wider than the width takes a row to itself, drawn cut so it stays one row.
import { cells } from './width'

/** A Button as the engine draws it (ButtonProps): what its cells are counted from. */
export type ButtonLook = {
  /** The text it shows: its label, or a plain Button's Text. */
  label: string
  /** Drawn bare, with no brackets. */
  plain: boolean
  /** Its key; drawn before a plain Button's text only. */
  hotkey: string | null
}

/**
 * A Button's cells as drawn: `[ label ]` with its hotkey not shown, a plain one with a hotkey `k: label`
 * (as status-bar.ts drawnText), a plain one alone its text.
 */
export function buttonCells(button: ButtonLook): number {
  if (!button.plain) return cells(`[ ${button.label} ]`)
  return button.hotkey === null ? cells(button.label) : cells(`${button.hotkey}: ${button.label}`)
}

/**
 * `items` in rows of `columns` cells (one at least), `gap` cells between two on a row, each item `widthOf`
 * cells wide; in order, none dropped, and no row empty.
 */
export function packRows<T>(items: readonly T[], widthOf: (item: T) => number, columns: number, gap: number): T[][] {
  const width = Math.max(1, columns)
  const rows: T[][] = []
  let row: T[] = []
  let used = 0
  for (const item of items) {
    const cellsOf = widthOf(item)
    if (row.length > 0 && used + gap + cellsOf > width) {
      rows.push(row)
      row = []
      used = 0
    }
    used += row.length > 0 ? gap + cellsOf : cellsOf
    row.push(item)
  }
  if (row.length > 0) rows.push(row)
  return rows
}
