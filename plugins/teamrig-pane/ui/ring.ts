// The focus ring over a frame, read from what the painter drew: the order Tab walks, the stop a key, a cell or a
// hotkey names, the way back Esc takes, and the Find row the head holds. Pure: the app keeps only the ring's key.
import type { FindRow, Head, HeadPiece } from '../hooks/head'
import type { Drawn } from '../hooks/layout'
import type { Press } from '../hooks/press'
import { noteKey, pressesOf } from '../hooks/press-keys'
import type { NoteField } from '../hooks/rows'
import type { Frame, Hit } from './paint'

/** The Note field keyed `key` on a card the body draws, in the window or out of it; null when `key` names none. */
export function noteFieldOf(body: readonly Drawn[], key: string): NoteField | null {
  for (const drawn of body) {
    for (const part of [...(drawn.card ?? []), ...(drawn.parts ?? [])]) {
      if (part.kind === 'field' && noteKey(part.field.task, part.field.round) === key) return part.field
    }
  }
  return null
}

/**
 * The keys Tab walks, in order: the head's stops as drawn, then every press of the body, those the window leaves out
 * too, so the ring's stops are the same wherever the window stands. A press of several lines is one stop.
 */
export function ringOrder(frame: Frame): string[] {
  const body = frame.places.flatMap(pressesOf).map(press => press.key)
  const inBody = new Set(body)
  const head = frame.hits.map(hit => hit.key).filter(key => !inBody.has(key))
  return [...new Set([...head, ...body])]
}

/** The key one step on from `current` in `order`, round its ends; from no stop of the order, its first or its last. */
export function stepped(order: readonly string[], current: string | null, by: 1 | -1): string | null {
  const at = current === null ? -1 : order.indexOf(current)
  if (at === -1) return (by === 1 ? order[0] : order.at(-1)) ?? null
  return order[(at + by + order.length) % order.length] ?? null
}

/** The stop keyed `key` where the frame draws it first; null when the window leaves it out. */
export function hitOf(frame: Frame, key: string | null): Hit | null {
  return frame.hits.find(hit => hit.key === key) ?? null
}

/** The stop drawn on the cell `column` of the line `line`. */
export function hitAt(frame: Frame, column: number, line: number): Hit | null {
  return frame.hits.find(hit => hit.line === line && column >= hit.from && column < hit.to) ?? null
}

/** The stop the frame draws under the hotkey `char`. */
export function hotkeyHit(frame: Frame, char: string): Hit | null {
  return frame.hits.find(hit => hit.hotkey === char) ?? null
}

/** The presses that lead back from where the pane is. */
const WAYS_BACK: ReadonlySet<Press['kind']> = new Set(['back', 'log-close', 'stats-list-close', 'stats-from-close'])

/** The way back the frame draws, its first: what Esc presses. */
export function backHit(frame: Frame): Hit | null {
  return frame.hits.find(hit => hit.target.kind === 'press' && WAYS_BACK.has(hit.target.press.kind)) ?? null
}

function findOf(piece: HeadPiece): FindRow | null {
  return piece.kind === 'find' ? piece.find : null
}

/** The Find row the head holds; null for a head with none (the strip, a project with no team, a Log page). */
export function findRowOf(head: Head): FindRow | null {
  for (const part of head.parts) {
    const pieces = part.kind === 'group' ? part.pieces : [part]
    for (const piece of pieces) {
      const find = findOf(piece)
      if (find !== null) return find
    }
  }
  return null
}
