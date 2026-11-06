// The keys of the body's presses, one source for the presses register.tsx draws and for the order the focus ring
// meets them in (T860): the docked body draws only the rows its window shows, and holds each press out of the window
// as a hidden stand-in under the same key, so the ring's stops stay the same wherever the window stands.
import type { OwnerActPress } from '../types'
import type { Place, Placed, View } from './frame'
import type { CardPart, Drawn, Piece } from './layout'
import { statsPressKey } from './rows'

/**
 * A piece of a card's line that is a press: a task id, a reference file, an inbox count, a Teams tab key, a session to
 * tie the tab to, a meeting to start, a session to meet the owner with, an owner act on a task, a Stats tab scope or
 * range.
 */
export type PressPiece = Exclude<Piece, { kind: 'words' }>

/** A press, by its key, and the body rows it stands in. */
export type PlacedPress = Place & { readonly key: string }

/** The key of an open card's element: `from` for the presses on the task ids in it. */
export function openKey(key: string): string {
  return `${key}-open`
}

/** Where the presses in an element's parts or card say they are drawn: the element when drawn as parts, else its open card. */
export function pressesFrom(drawn: Drawn): string {
  return drawn.parts === undefined ? openKey(drawn.key) : drawn.key
}

/**
 * An owner act's press on a task's card (owner-acts.ts): `act:<press>:<task>`. A drawing holds one card per task, so
 * the key names it without where it is drawn, and the acts can move the ring onto it.
 */
export function actKey(press: OwnerActPress, task: string): string {
  return `act:${press}:${task}`
}

/** The Note field on a task's card: `note:<task>:<round>`, a new field, empty, each time it opens. */
export function noteKey(task: string, round: number): string {
  return `note:${task}:${round}`
}

/** A Changes file's row, a press that opens or closes its diff: `diff:`, then where it is drawn and the row. */
export function diffKey(from: string, partKey: string): string {
  return `diff:${from}:${partKey}`
}

/**
 * A press in a card's line: a task id `goto:<id>:`, a reference file `goto:file:`, an inbox count `goto:inbox:`, a
 * Teams tab key `team:<key>:`, a session to tie the tab to `pin:<id>:`, a meeting to start `start:<id>:`, a session to
 * meet the owner with `meet:<id>:`, a Stats tab press `stats:<what it picks>:` (rows.ts statsPressKey), then
 * where it is drawn, the line, and the piece's place in it; an owner act on a task its actKey alone, wherever it is drawn.
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
    case 'toggle':
      return `team:${piece.toggles}:${at}`
    case 'pin':
      return `pin:${piece.pins}:${at}`
    case 'start':
      return `start:${piece.starts}:${at}`
    case 'meet':
      return `meet:${piece.meets}:${at}`
    case 'act':
      return actKey(piece.acts.press, piece.acts.task)
    case 'stats':
      return `stats:${statsPressKey(piece.stats)}:${at}`
  }
}

/**
 * True when an element's head is a press: one that opens its task's card or page, a session's Log page, a file's diff,
 * or opens or closes a Teams tab node.
 */
export function headPresses(drawn: Drawn): boolean {
  return drawn.toggle !== null || drawn.opens !== undefined || drawn.reads !== undefined || drawn.folds !== undefined || drawn.expands !== undefined
}

/** A card part's presses' keys, in the order drawn: a row press's own, a Note field's, a line's pieces' but its words. */
function partKeys(part: CardPart, from: string): string[] {
  if (part.kind === 'text') return []
  if (part.kind === 'press') return [diffKey(from, part.key)]
  if (part.kind === 'field') return [noteKey(part.field.task, part.field.round)]
  return part.pieces.flatMap((piece, i) => (piece.kind === 'words' ? [] : [pieceKey(piece, from, part.key, i)]))
}

/**
 * An element's presses in the order the focus ring meets them, each with the rows it stands in: its head's, when the
 * head is a press, then each press in its parts or its open card, a line's presses all on the line's row.
 */
export function pressesOf(placed: Placed): PlacedPress[] {
  const { drawn } = placed
  const from = pressesFrom(drawn)
  const head = drawn.parts === undefined && headPresses(drawn) ? [{ key: drawn.key, top: placed.top, rows: placed.headRows }] : []
  return [...head, ...placed.parts.flatMap(({ part, top, rows }) => partKeys(part, from).map(key => ({ key, top, rows })))]
}

/**
 * The presses a window leaves out, in the order the ring meets them: those above it, then those below. A press any
 * of whose rows the window shows is drawn (frame.ts cuts a Text or a row press by lines and keeps a line of presses
 * whole), so the pane draws these as hidden stand-ins and the ring's stops stay the same wherever the window stands.
 */
export function standInsOf(places: readonly Placed[], view: View): { readonly above: string[]; readonly below: string[] } {
  const end = view.offset + view.visibleRows
  const out = places.flatMap(pressesOf).filter(press => press.top >= end || press.top + press.rows <= view.offset)
  return {
    above: out.filter(press => press.top < view.offset).map(press => press.key),
    below: out.filter(press => press.top >= view.offset).map(press => press.key),
  }
}

/**
 * Where the element keyed `key` stands, as `$.ui.scroll` found it: an element's key names its head (a task's Button,
 * the whole of words alone or of an element drawn as parts), its open card's key the element whole, a press's its
 * rows. Null when the body holds none.
 */
export function placeOf(places: readonly Placed[], key: string): Place | null {
  for (const placed of places) {
    if (key === placed.drawn.key) return { top: placed.top, rows: placed.headRows }
    if (key === openKey(placed.drawn.key)) return { top: placed.top, rows: placed.rows }
    const press = pressesOf(placed).find(found => found.key === key)
    if (press !== undefined) return { top: press.top, rows: press.rows }
  }
  return null
}
