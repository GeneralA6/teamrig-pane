// The keys of the body's presses, one source for the presses register.tsx draws and for the order the focus ring
// meets them in (T860): the docked body draws only the rows its window shows, and holds each press out of the window
// as a hidden stand-in under the same key, so the ring's stops stay the same wherever the window stands.
import type { CardPart, Drawn, Piece } from './layout'

/** A piece of a card's line that is a press: a task id, a reference file, an inbox count. */
export type PressPiece = Exclude<Piece, { kind: 'words' }>

/** The key of an open card's element: `from` for the presses on the task ids in it. */
export function openKey(key: string): string {
  return `${key}-open`
}

/** Where the presses in an element's parts or card say they are drawn: the element when drawn as parts, else its open card. */
export function pressesFrom(drawn: Drawn): string {
  return drawn.parts === undefined ? openKey(drawn.key) : drawn.key
}

/** A Changes file's row, a press that opens or closes its diff: `diff:`, then where it is drawn and the row. */
export function diffKey(from: string, partKey: string): string {
  return `diff:${from}:${partKey}`
}

/**
 * A press in a card's line: a task id `goto:<id>:`, a reference file `goto:file:`, an inbox count `goto:inbox:`, then
 * where it is drawn, the line, and the piece's place in it.
 */
export function pieceKey(piece: PressPiece, from: string, partKey: string, i: number): string {
  const at = `${from}:${partKey}:${i}`
  switch (piece.kind) {
    case 'id':
      return `goto:${piece.task}:${at}`
    case 'file':
      return `goto:file:${at}`
    case 'inbox':
      return `goto:inbox:${at}`
  }
}

/** True when an element's head is a press: one that opens its task's card or page, a session's Log page, or a file's diff. */
export function headPresses(drawn: Drawn): boolean {
  return drawn.toggle !== null || drawn.opens !== undefined || drawn.reads !== undefined || drawn.expands !== undefined
}

/** A card part's presses' keys, in the order drawn: a row press's own, a line's pieces' but its words. */
function partKeys(part: CardPart, from: string): string[] {
  if (part.kind === 'text') return []
  if (part.kind === 'press') return [diffKey(from, part.key)]
  return part.pieces.flatMap((piece, i) => (piece.kind === 'words' ? [] : [pieceKey(piece, from, part.key, i)]))
}

/**
 * The keys of an element's presses in the order the focus ring meets them: its head's, when the head is drawn
 * (`head`) and is a press, then each press in its parts or its open card.
 */
export function focusKeysOf(drawn: Drawn, head: boolean): string[] {
  const from = pressesFrom(drawn)
  const own = head && drawn.parts === undefined && headPresses(drawn) ? [drawn.key] : []
  return [...own, ...(drawn.parts ?? drawn.card ?? []).flatMap(part => partKeys(part, from))]
}
