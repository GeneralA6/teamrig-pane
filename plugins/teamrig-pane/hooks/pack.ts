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
  return packGroups([items], widthOf, columns, gap, null)
}

/**
 * `groups` packed as packRows packs their items, the item `separator` makes for a group (by its index) between it
 * and the group before it where the two share a row: a group's items wrap as any do, and a row never starts or ends
 * on a separator, which goes with the group after it, so a group that does not fit beside it starts the next row
 * alone. A null `separator` puts none.
 */
export function packGroups<T>(
  groups: readonly (readonly T[])[],
  widthOf: (item: T) => number,
  columns: number,
  gap: number,
  separator: ((group: number) => T) | null,
): T[][] {
  const width = Math.max(1, columns)
  const rows: T[][] = []
  let row: T[] = []
  let used = 0
  const fits = (cellsOf: number) => row.length === 0 || used + gap + cellsOf <= width
  const add = (item: T, cellsOf: number) => {
    used += row.length > 0 ? gap + cellsOf : cellsOf
    row.push(item)
  }
  const wrap = () => {
    rows.push(row)
    row = []
    used = 0
  }
  groups.forEach((group, index) =>
    group.forEach((item, i) => {
      const cellsOf = widthOf(item)
      const mark = separator !== null && i === 0 && row.length > 0 ? separator(index) : null
      if (mark !== null) {
        const markCells = widthOf(mark)
        if (fits(markCells + gap + cellsOf)) {
          add(mark, markCells)
          add(item, cellsOf)
          return
        }
      }
      if (mark !== null || !fits(cellsOf)) wrap()
      add(item, cellsOf)
    }),
  )
  if (row.length > 0) rows.push(row)
  return rows
}
