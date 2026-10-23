// The docked body's rows, counted as dockLayout wrapped it: one row a line of a Text, one a line of presses.
import type { CardPart, Drawn } from './layout'
import type { Span } from './rows'

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
