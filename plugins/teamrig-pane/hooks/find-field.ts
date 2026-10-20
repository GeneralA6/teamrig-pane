// The Find field (register.tsx), drawn under a key that names its round and holding, as drawn, the text the round
// started with. The engine drops what the person typed whenever the text drawn changes, so a field drawing each
// change back would lose the keys typed while a redraw lagged behind them. Typing never starts a round, so the drawn
// text stays put and every key stays in the field. A step that changes what the field should hold (back to a search,
// a page opened, clear, mine or all) starts one: a new key, which the engine draws as a fresh field holding the new
// text. The line under the field says where the person's keys go: the engine raises an event as the pane's focus ring
// lands on an element (ui.focus), none as it clears the ring when the pane lets the keys go, so the landings are
// counted with what each was on (the field, a result of the search, another element), and a drawing without the keys
// after one with them remembers the count they were let go at. Pure.
import type { FindField, Nav, RingLandings, RingStop } from '../types'
import { currentPlace } from './nav'
import { SEARCH_VIEW } from './search-rows'
import { isResultOf } from './search-view'

/** The Find field's key in its first round; each later round's is `find:<round>`. */
export const FIND = 'find'
/** The field as the pane opens: the first round, empty. */
export const FIRST_FIELD: FindField = { round: 0, text: '' }
/** No landing yet. */
export const NO_LANDINGS: RingLandings = { count: 0, on: 'other' }

/** What the field should hold where `nav` is: the query of the search shown, else nothing. */
export function fieldText(nav: Nav): string {
  const place = currentPlace(nav)
  return place.kind === 'search' ? place.query : ''
}

/**
 * The field after a step from `before` to `next` that was not typing: a new round holding what the field should hold
 * at `next` when that differs from what it held at `before`, else the same round, whose text is still what it shows.
 */
export function fieldAfter(field: FindField, before: Nav, next: Nav): FindField {
  const text = fieldText(next)
  return text === fieldText(before) ? field : { round: field.round + 1, text }
}

/** The key the field is drawn under in its round. */
export function fieldKey(field: FindField): string {
  return field.round === 0 ? FIND : `${FIND}:${field.round}`
}

/** True for a key the field is drawn under in some round. */
export function isFieldKey(key: string): boolean {
  return key === FIND || key.startsWith(`${FIND}:`)
}

/** What the element keyed `element` is to the ring; absent, one of the engine's own stops, it is another element. */
function stopOf(element: string | undefined): RingStop {
  if (element === undefined) return 'other'
  if (isFieldKey(element)) return 'field'
  return isResultOf(SEARCH_VIEW, element) ? 'result' : 'other'
}

/** The landings once the ring landed on the element keyed `element`; absent for one of the engine's own stops. */
export function landedOn(ring: RingLandings, element: string | undefined): RingLandings {
  return { count: ring.count + 1, on: stopOf(element) }
}

/**
 * What the pane remembers between drawings of where the keys went: whether the last drawing held them, and the
 * landings counted when the pane last let them go (-1 before it ever did).
 */
export type KeysMemo = { readonly wasHeld: boolean; readonly lostAt: number }

/**
 * Before the first drawing. It counts as held, so a pane first drawn without the keys (after a reload among them)
 * records the landings it finds as let go: the ring is clear by then.
 */
export const FIRST_MEMO: KeysMemo = { wasHeld: true, lostAt: -1 }

/**
 * The memo after a drawing with `isHeld`, the pane's `isFocused`: a drawing without the keys after one with them
 * records the landings so far. Only that change records, so a drawing still without the keys that already sees a
 * landing (the click that hands the pane the keys lands the ring as it does) never counts it as let go.
 */
export function drawnWith(memo: KeysMemo, isHeld: boolean, ring: RingLandings): KeysMemo {
  if (isHeld) return memo.wasHeld ? memo : { ...memo, wasHeld: true }
  return memo.wasHeld ? { wasHeld: false, lostAt: ring.count } : memo
}

/** Where the person's keys go: into the Find field, to a result of the search, to the pane's own keys, or to Claude's prompt. */
export type KeysAt = 'search' | 'result' | 'pane' | 'claude'

/**
 * Where the keys go: Claude's while the pane does not hold them; while it does and the ring last landed after the pane
 * last let them go, the field's when it landed on the field, and a result's when it landed on one while `isSearching`
 * (once the search closed, the ring left where a result was sits on another element); else the pane's, where its
 * hotkeys answer.
 */
export function keysAt(isHeld: boolean, ring: RingLandings, memo: KeysMemo, isSearching: boolean): KeysAt {
  if (!isHeld) return 'claude'
  if (ring.count <= memo.lostAt) return 'pane'
  if (ring.on === 'field') return 'search'
  return ring.on === 'result' && isSearching ? 'result' : 'pane'
}

/** What Enter in the field does with `matches` tasks matched: opens the one, else moves the ring to the results. */
export function submitWords(matches: number): string {
  return matches > 1 ? 'to the results' : 'open'
}

/** The line under the Find field: where the keys go and how to move them, Enter's step by the `matches` of the search shown. */
export function keysHint(at: KeysAt, matches: number): string {
  switch (at) {
    case 'search':
      return `Typing searches · Enter: ${submitWords(matches)} · Esc: to Claude`
    case 'result':
      return 'On a result · Enter: open · ↑↓: move · s: search · Esc: to Claude'
    case 'pane':
      return 'Keys on the pane · s: search · Esc: to Claude'
    case 'claude':
      return 'Keys go to Claude · click the field to search'
  }
}
