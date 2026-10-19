// Which of the docked body's elements a drawing draws. The engine lays out the whole tree a hook draws, and asks for
// it again on each scroll move, so a list drawn whole costs every move all its elements: thousands for a register of
// a thousand tasks. Windowed, a drawing holds the elements whose rows meet the window the person sees, with at least
// a screenful around it, and each element an anchor keeps (the one the keys are on, the one a step back to the list
// lands on), with a screenful around it too, so the keys and the engine's scroll to an element always find what they move to.
// The body's first and last elements are kept the same way, so Tab past the end and Shift+Tab past the top wrap to the
// list's true ends, not to the ends of what is drawn. A run of the others is one empty Box as tall as their rows, so the
// tree keeps its height and the window its place.
import type { CardPart, Drawn } from './layout'
import type { Span } from './rows'

/** A body element drawn, or a run of them left out as one empty Box of their rows. */
export type Slot = { readonly kind: 'drawn'; readonly drawn: Drawn } | { readonly kind: 'spacer'; readonly key: string; readonly rows: number }

/** Where the pane's window stands (the engine's SiteScroll), and what a drawing keeps wherever it stands. */
export type BodyWindow = {
  /** The first row of the pane's tree the window shows. */
  readonly offset: number
  /** The rows the window shows at once. */
  readonly bodyRows: number
  /** Rows between two body elements: the root Box's gap. */
  readonly gap: number
  /** True for an element a drawing holds wherever the window stands. */
  readonly isAnchor: (drawn: Drawn) => boolean
}

/** Lines in spans joined into one Text: one, and one more for each new line. */
function linesOf(spans: readonly Span[]): number {
  return spans.reduce((lines, span) => lines + span.text.split('\n').length - 1, 1)
}

/** Rows a card part takes: a Text or a press its lines, a line with a task id one row. */
function partRows(part: CardPart): number {
  return part.kind === 'line' ? 1 : linesOf(part.spans)
}

/** Rows a body element takes, as dockLayout wrapped it: its Text's lines (its parts', when drawn as parts, are the same) and its open card's. */
export function rowsOf(drawn: Drawn): number {
  return linesOf(drawn.spans) + (drawn.card ?? []).reduce((rows, part) => rows + partRows(part), 0)
}

/**
 * The body as a drawing draws it: each element whose rows meet a kept range, and each run of the others as one
 * spacer of their rows and the gaps between them. The window's offset counts the pane's rows above the body (the
 * buttons, the Find field, the status bar), always under a screenful, so the range drawn around it runs from two
 * screenfuls above the offset to two below: what is seen, and at least a screenful each way, for the engine's own
 * scrolls that ask for no new drawing (a held element kept in view). An anchor, and the body's first and last
 * elements, are kept with a screenful around each.
 */
export function windowed(body: readonly Drawn[], window: BodyWindow): Slot[] {
  const screen = Math.max(1, window.bodyRows)
  const ranges: { from: number; to: number }[] = [{ from: window.offset - 2 * screen, to: window.offset + 2 * screen }]
  const placed: { drawn: Drawn; top: number; rows: number }[] = []
  const last = body.length - 1
  let top = 0
  for (const [i, drawn] of body.entries()) {
    const rows = rowsOf(drawn)
    placed.push({ drawn, top, rows })
    if (i === 0 || i === last || window.isAnchor(drawn)) ranges.push({ from: top - screen, to: top + rows + screen })
    top += rows + window.gap
  }
  const slots: Slot[] = []
  let run: { key: string; rows: number } | null = null
  for (const { drawn, top, rows } of placed) {
    if (ranges.some(range => top < range.to && top + rows > range.from)) {
      if (run !== null) slots.push({ kind: 'spacer', ...run })
      run = null
      slots.push({ kind: 'drawn', drawn })
    } else {
      run = run === null ? { key: `skip:${drawn.key}`, rows } : { key: run.key, rows: run.rows + window.gap + rows }
    }
  }
  if (run !== null) slots.push({ kind: 'spacer', ...run })
  return slots
}
