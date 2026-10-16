// The Find field (register.tsx), drawn under a key that names its round and holding, as drawn, the text the round
// started with. The engine drops what the person typed whenever the text drawn changes, so a field drawing each
// change back would lose the keys typed while a redraw lagged behind them. Typing never starts a round, so the drawn
// text stays put and every key stays in the field. A step that changes what the field should hold (back to a search,
// a page opened, clear, mine or all) starts one: a new key, which the engine draws as a fresh field holding the new
// text. Pure.
import type { FindField, Nav } from '../types'
import { currentPlace } from './nav'

/** The Find field's key in its first round; each later round's is `find:<round>`. */
export const FIND = 'find'
/** The field as the pane opens: the first round, empty. */
export const FIRST_FIELD: FindField = { round: 0, text: '' }

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
