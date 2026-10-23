// Where the docked body's window stands (T860). The pane keeps its own window over the body, as the engine scrolls a
// pane's whole tree (frame.ts), and a step writes where it wants it: at an offset (the person's scrolls), at the
// body's end (a Log page, which stays there as its lines come in), or where an element shows (a reveal: a step back
// to the list, into a file's page). Each drawing settles that on the body it draws.
import type { BodyScroll, ScrollTarget } from '../types'
import { revealed, type Placed, type View } from './frame'
import { placeOf } from './press-keys'

/** The window at the body's top, before any step. */
export const AT_TOP: BodyScroll = { seq: 0, to: { kind: 'offset', offset: 0 } }

/** The window after a step to `to`. */
export function scrolledTo(current: BodyScroll, to: ScrollTarget): BodyScroll {
  return { seq: current.seq + 1, to }
}

/** A reveal as a drawing settled it: its step, and the offset it landed on. */
export type Settled = { readonly seq: number; readonly offset: number }

/**
 * The offset the window takes over `places`, `last` where it stood as last drawn: an offset as asked, the end the
 * body's last, a reveal where `revealed` lands its target. A reveal is settled once: later drawings keep its offset
 * while no new step comes, so the window holds still as the body changes around it. A reveal of a key the body does
 * not hold lands at the top. The view clamps the offset to the body.
 */
export function settle(
  scroll: BodyScroll,
  settled: Settled | null,
  places: readonly Placed[],
  last: View,
): { readonly offset: number; readonly settled: Settled | null } {
  const to = scroll.to
  switch (to.kind) {
    case 'offset':
      return { offset: to.offset, settled: null }
    case 'end':
      return { offset: last.maxOffset, settled: null }
    case 'reveal': {
      if (settled !== null && settled.seq === scroll.seq) return { offset: settled.offset, settled }
      const place = placeOf(places, to.key)
      const offset = place === null ? 0 : revealed(place, last, to.block)
      return { offset, settled: { seq: scroll.seq, offset } }
    }
  }
}
