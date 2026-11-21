// A slot of the body's window (../hooks/frame frameOf) as rows of the dedicated UI, drawn as the Claude Code dock
// draws it: an element's head a stop on each of its lines when the drawing names a press for it, its open card's
// parts under it, a gap its blank rows. Every stop takes the key the dock gives the same press
// (../hooks/press-keys), so a ring landing and the body's places name one stop in both.
import type { FrameSlot } from '../hooks/frame'
import type { CardPart, Drawn } from '../hooks/layout'
import { pressOfDrawn, pressOfPart, pressOfPiece, type Press } from '../hooks/press'
import { diffKey, noteKey, pieceKey, pressesFrom } from '../hooks/press-keys'
import type { NoteField, Span } from '../hooks/rows'
import { fieldRuns, type Typing } from './paint-head'
import { plain, type Row, type Seg } from './row'
import { runOf, type Run } from './run'

const BLANK: Row = []

/** What a task's Note field shows until it is typed in. */
export function notePlaceholder(task: string): string {
  return `a Note to ${task}'s session`
}

/** Spans drawn as one text, a line each of its lines: a span is split at its line ends, a line with no text is blank. */
export function linesOf(spans: readonly Span[]): Run[][] {
  let line: Run[] = []
  const lines: Run[][] = [line]
  for (const span of spans)
    for (const [i, text] of span.text.split('\n').entries()) {
      if (i > 0) {
        line = []
        lines.push(line)
      }
      if (text !== '') line.push(runOf({ ...span, text }))
    }
  return lines
}

function pressed(key: string, press: Press, runs: readonly Run[]): Seg {
  return { runs, stop: { key, hotkey: null, target: { kind: 'press', press } } }
}

/** Lines of words alone, or, with a press, each line a stop under the press's one key. */
function textRows(spans: readonly Span[], stop: { readonly key: string; readonly press: Press } | null): Row[] {
  return linesOf(spans).map(runs => [stop === null ? plain(runs) : pressed(stop.key, stop.press, runs)])
}

/** The Note field's row: a stop typed into, not pressed. */
function noteRow(field: NoteField, typing: Typing | null): Row {
  const key = noteKey(field.task, field.round)
  const typed = typing !== null && typing.key === key ? typing.text : null
  return [{ runs: fieldRuns('', notePlaceholder(field.task), typed), stop: { key, hotkey: null, target: { kind: 'note', field } } }]
}

/** A line's pieces side by side: words as they are, a press a stop, underlined unless it is a fold mark. */
function lineRow(part: Extract<CardPart, { kind: 'line' }>, from: string): Row {
  return part.pieces.map((piece, i) => {
    if (piece.kind === 'words') return plain(piece.spans.map(runOf))
    const run = runOf(piece.span)
    return pressed(pieceKey(piece, from, part.key, i), pressOfPiece(piece, from), [piece.kind === 'toggle' ? run : { ...run, underline: true }])
  })
}

/** A card's part as rows, its presses pressed in the element keyed `from`. */
function partRows(part: CardPart, from: string, typing: Typing | null): Row[] {
  switch (part.kind) {
    case 'text':
      return textRows(part.spans, null)
    case 'press':
      return textRows(part.spans, { key: diffKey(from, part.key), press: pressOfPart(part) })
    case 'field':
      return [noteRow(part.field, typing)]
    case 'line':
      return [lineRow(part, from)]
  }
}

/** An element's head: its parts when it is drawn as parts, else its text, a stop when the drawing names its press. */
function headRows(drawn: Drawn, from: string, typing: Typing | null): Row[] {
  if (drawn.parts !== undefined) return drawn.parts.flatMap(part => partRows(part, from, typing))
  const press = pressOfDrawn(drawn)
  return textRows(drawn.spans, press === null ? null : { key: drawn.key, press })
}

/**
 * A slot's rows, top to bottom: a gap's blank rows, or an element's head (none when the window's cut left none of
 * it) and its open card under it. `typing` names the field the app types in, null when it types in none.
 */
export function slotRows(slot: FrameSlot, typing: Typing | null): Row[] {
  if (slot.kind === 'gap') return Array.from({ length: Math.max(0, slot.rows) }, () => BLANK)
  const { drawn } = slot
  const from = pressesFrom(drawn)
  const card = (drawn.card ?? []).flatMap(part => partRows(part, from, typing))
  return slot.head ? [...headRows(drawn, from, typing), ...card] : card
}
