// Where the tasks view is, and the way back to where it was: the places the person went through, kept as a
// browser keeps its history. The list comes first; a press on a task id in a card (card.ts) opens that task's
// page, back and forward step along the places, and a crumb of the trail goes straight to its own. A jump from
// anywhere but the newest place drops the places ahead of it; a page opens at its top, and a return from a page to
// the list scrolls back to the element the page was opened from. A search (search.ts) is a place too, holding its
// query: typing changes the query of the search shown, never adds a place, so back from a result's page returns to
// the results, and emptying the field (or clear) closes the search. The Archive page (done-rows.ts) is a place holding
// its week: a step to an older or newer week changes the week of the page shown, never adds a place, so back
// returns to where the page was opened from. A press on a file a card's Reference row names (ref-file.ts) opens that
// file's page (file-page.ts), a place holding the file as the ref writes it and the line it points at: it opens at
// that line, or its top for none. The Keys page (keys-page.ts) is one place, whatever it was opened from. Ids,
// queries, weeks and file names only, at most NAV_PLACES places, the oldest
// dropped first: what a page shows is read from the snapshot each time it draws (page.ts), and only the pages a place
// names keep the details, and the files, read for them. Pure: register.tsx keeps it in $.state and draws it.
import type { Nav, Place } from '../types'

/** Most places kept; past it the oldest go first. */
export const NAV_PLACES = 20
/** Most places the trail draws; those left out before or after them draw as `…`. */
export const TRAIL_PLACES = 4

const LIST: Place = { kind: 'list', row: null }
/** The list alone: where the tasks view starts. */
export const AT_LIST: Nav = { places: [LIST], at: 0 }

/** The Keys page: every key the pane answers. */
export const KEYS_PAGE: Place = { kind: 'keys' }

/** The place shown: the list when `nav` points at none. */
export function currentPlace(nav: Nav): Place {
  return nav.places[nav.at] ?? LIST
}

/** One place: the list whichever row it remembers, a task's page by its id, a search by its query, the Archive page by its week, a file's page by its file and line, the Keys page. */
function samePlace(a: Place, b: Place): boolean {
  switch (a.kind) {
    case 'list':
      return b.kind === 'list'
    case 'task':
      return b.kind === 'task' && a.id === b.id
    case 'search':
      return b.kind === 'search' && a.query === b.query
    case 'done':
      return b.kind === 'done' && a.week === b.week
    case 'file':
      return b.kind === 'file' && a.file === b.file && a.line === b.line
    case 'keys':
      return b.kind === 'keys'
  }
}

/** Whether `place` is a page, drawn under back, forward and the trail: a task's, the Archive's, a file's or the Keys page. */
export function isPage(place: Place): boolean {
  return place.kind === 'task' || place.kind === 'done' || place.kind === 'file' || place.kind === 'keys'
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

/**
 * `nav` showing the search for `query`, as the person types it: the search shown takes the query in its place, no new
 * place, and anywhere else a search is pushed. An empty query closes the search (leftSearch).
 */
export function searched(nav: Nav, query: string): Nav {
  if (query === '') return leftSearch(nav)
  if (currentPlace(nav).kind !== 'search') return pushed(nav, { kind: 'search', query })
  return { ...nav, places: nav.places.map((place, i): Place => (i === nav.at ? { kind: 'search', query } : place)) }
}

/** `nav` showing the Archive page for `week`: the Archive page shown takes the week in its place, no new place; anywhere else it is pushed. */
export function doneAt(nav: Nav, week: string): Nav {
  if (currentPlace(nav).kind !== 'done') return pushed(nav, { kind: 'done', week })
  return { ...nav, places: nav.places.map((place, i): Place => (i === nav.at ? { kind: 'done', week } : place)) }
}

/** `nav` with the search shown closed: it and the places ahead of it dropped, the place before it shown (the list when none). */
export function leftSearch(nav: Nav): Nav {
  if (currentPlace(nav).kind !== 'search') return nav
  const places = nav.places.slice(0, nav.at)
  return places.length === 0 ? AT_LIST : { places, at: places.length - 1 }
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

/**
 * `place` over the list remembering `row`, and nothing else: what a press outside the pane opens (the band above the
 * prompt, banner.ts), so back shows the list scrolled to `row`, whatever the trail held before.
 */
export function fromList(row: string, place: Place): Nav {
  return pushed({ places: [{ kind: 'list', row }], at: 0 }, place)
}

/** The task ids the places name: the pages whose details are worth keeping. */
export function placeIds(nav: Nav): Set<string> {
  return new Set(nav.places.flatMap(place => (place.kind === 'task' ? [place.id] : [])))
}

/** The files the places name: the file pages whose reads are worth keeping. */
export function placeFiles(nav: Nav): Set<string> {
  return new Set(nav.places.flatMap(place => (place.kind === 'file' ? [place.file] : [])))
}

/** `byName` less the entries `names` does not hold. */
function kept<T>(byName: Readonly<Record<string, T>>, names: ReadonlySet<string>): Record<string, T> {
  return Object.fromEntries(Object.entries(byName).filter(([name]) => names.has(name)))
}

/** What each page read for its task, `byId`, less the pages no place of `nav` names any more. */
export function pagesKept<T>(byId: Readonly<Record<string, T>>, nav: Nav): Record<string, T> {
  return kept(byId, placeIds(nav))
}

/** What each file page read, `byFile`, less the files no place of `nav` names any more. */
export function filesKept<T>(byFile: Readonly<Record<string, T>>, nav: Nav): Record<string, T> {
  return kept(byFile, placeFiles(nav))
}

/** Where the pane's window goes after a step: a page's top, the element of the list keyed `key`, or line `line` of a file's page. */
export type Landing = { kind: 'top' } | { kind: 'row'; key: string } | { kind: 'line'; file: string; line: number }

/**
 * Where a step from `before` to `next` leaves the window: a page opens at its top, the Archive page at each week, a
 * file's page at the line its ref points at (its top for none), a search at its top too (its field and first results)
 * unless it was shown already, and a step from a task's or a file's page back to the list lands on the element the
 * list remembers it was left from. Null for any other step, typing in a search among them, and when the list
 * remembers none: the window stays where it is.
 */
export function landing(before: Nav, next: Nav): Landing | null {
  const to = currentPlace(next)
  const from = currentPlace(before)
  switch (to.kind) {
    case 'task':
    case 'done':
    case 'keys':
      return { kind: 'top' }
    case 'file':
      return to.line === null ? { kind: 'top' } : { kind: 'line', file: to.file, line: to.line }
    case 'search':
      return from.kind === 'search' ? null : { kind: 'top' }
    case 'list':
      return (from.kind === 'task' || from.kind === 'file') && to.row !== null ? { kind: 'row', key: to.row } : null
  }
}

/**
 * A crumb's words: `Tasks` for the list, a page's task id, `Search` with its query in quotes, `Archive 10-12` with its
 * week's Monday, a file's name, `Keys`.
 */
export function placeLabel(place: Place): string {
  switch (place.kind) {
    case 'list':
      return 'Tasks'
    case 'task':
      return place.id
    case 'search':
      return place.query === '' ? 'Search' : `Search "${place.query}"`
    case 'done':
      return `Archive ${place.week.slice(5)}`
    case 'file':
      return place.file.split(/[\\/]/).at(-1) ?? place.file
    case 'keys':
      return 'Keys'
  }
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
