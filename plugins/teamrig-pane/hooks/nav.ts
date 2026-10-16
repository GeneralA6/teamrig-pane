// Where the tasks view is, and the way back to where it was: the places the person went through, kept as a
// browser keeps its history. The list comes first; a press on a task id in a card (card.ts) opens that task's
// page, back and forward step along the places, and a crumb of the trail goes straight to its own. A jump from
// anywhere but the newest place drops the places ahead of it; a page opens at its top, and a return from a page to
// the list scrolls back to the element the page was opened from. Ids only, at most NAV_PLACES places, the oldest dropped first: what a page
// shows is read from the snapshot each time it draws (page.ts), and only the pages a place names keep the details
// read for them. Pure: register.tsx keeps it in $.state and draws it.
import type { Nav, Place } from '../types'

/** Most places kept; past it the oldest go first. */
export const NAV_PLACES = 20
/** Most places the trail draws; those left out before or after them draw as `…`. */
export const TRAIL_PLACES = 4

const LIST: Place = { kind: 'list', row: null }
/** The list alone: where the tasks view starts. */
export const AT_LIST: Nav = { places: [LIST], at: 0 }

/** The place shown: the list when `nav` points at none. */
export function currentPlace(nav: Nav): Place {
  return nav.places[nav.at] ?? LIST
}

/** One place: the list whichever row it remembers, a task's page by its id. */
function samePlace(a: Place, b: Place): boolean {
  if (a.kind === 'list' || b.kind === 'list') return a.kind === b.kind
  return a.id === b.id
}

/** `nav` showing `place` next, past the one shown: the places ahead dropped, the oldest past NAV_PLACES too. The place shown already changes nothing. */
export function pushed(nav: Nav, place: Place): Nav {
  if (samePlace(currentPlace(nav), place)) return nav
  const places = [...nav.places.slice(0, nav.at + 1), place].slice(-NAV_PLACES)
  return { places, at: places.length - 1 }
}

/**
 * `nav` with the list it shows remembering `row`, the key of the element a page is opened from, so a return to the
 * list scrolls back to it. On a page it changes nothing.
 */
export function leavingList(nav: Nav, row: string): Nav {
  if (currentPlace(nav).kind !== 'list') return nav
  return { ...nav, places: nav.places.map((place, i): Place => (i === nav.at ? { kind: 'list', row } : place)) }
}

export function canGoBack(nav: Nav): boolean {
  return nav.at > 0
}

export function canGoForward(nav: Nav): boolean {
  return nav.at < nav.places.length - 1
}

/** `nav` showing the place at `index`, the places on both sides kept; an index it has no place at changes nothing. */
export function wentTo(nav: Nav, index: number): Nav {
  return Number.isInteger(index) && index >= 0 && index < nav.places.length ? { ...nav, at: index } : nav
}

export function back(nav: Nav): Nav {
  return wentTo(nav, nav.at - 1)
}

export function forward(nav: Nav): Nav {
  return wentTo(nav, nav.at + 1)
}

/**
 * The list alone, as a switch of view or of mine and all leaves it. With `keepRow` the list remembers the row the
 * newest list place up to the shown one did, so a return from a page still scrolls to it; else none.
 */
export function reset(nav: Nav, keepRow: boolean): Nav {
  if (!keepRow) return AT_LIST
  const list = nav.places.slice(0, nav.at + 1).findLast(place => place.kind === 'list')
  return list === undefined ? AT_LIST : { places: [list], at: 0 }
}

/** The task ids the places name: the pages whose details are worth keeping. */
export function placeIds(nav: Nav): Set<string> {
  return new Set(nav.places.flatMap(place => (place.kind === 'task' ? [place.id] : [])))
}

/** What each page read for its task, `byId`, less the pages no place of `nav` names any more. */
export function pagesKept<T>(byId: Readonly<Record<string, T>>, nav: Nav): Record<string, T> {
  const ids = placeIds(nav)
  return Object.fromEntries(Object.entries(byId).filter(([id]) => ids.has(id)))
}

/** Where the pane's window goes after a step: a page's top, or the element of the list keyed `key`. */
export type Landing = { kind: 'top' } | { kind: 'row'; key: string }

/**
 * Where a step from `before` to `next` leaves the window: a page opens at its top, and a step from a page back to the
 * list lands on the element the list remembers it was left from. Null for any other step, and when the list
 * remembers none: the window stays where it is.
 */
export function landing(before: Nav, next: Nav): Landing | null {
  const to = currentPlace(next)
  if (to.kind === 'task') return { kind: 'top' }
  return currentPlace(before).kind === 'task' && to.row !== null ? { kind: 'row', key: to.row } : null
}

/** A crumb's words: `Tasks` for the list, a page's task id. */
export function placeLabel(place: Place): string {
  return place.kind === 'list' ? 'Tasks' : place.id
}

/** A crumb of the trail: its place, the index a press goes to, and whether it is the place shown or one ahead of it. */
export type Crumb = { place: Place; index: number; isShown: boolean; isAhead: boolean }
/** The crumbs the trail draws, and whether places were left out before or after them. */
export type Trail = { crumbs: Crumb[]; isCutBefore: boolean; isCutAfter: boolean }

/**
 * At most TRAIL_PLACES crumbs: the newest places, or, after enough steps back, the window that starts at the place
 * shown, so it is always among them.
 */
export function trail(nav: Nav): Trail {
  const start = Math.max(0, Math.min(nav.at, nav.places.length - TRAIL_PLACES))
  const end = Math.min(nav.places.length, start + TRAIL_PLACES)
  const crumbs = nav.places
    .slice(start, end)
    .map((place, i): Crumb => ({ place, index: start + i, isShown: start + i === nav.at, isAhead: start + i > nav.at }))
  return { crumbs, isCutBefore: start > 0, isCutAfter: end < nav.places.length }
}
