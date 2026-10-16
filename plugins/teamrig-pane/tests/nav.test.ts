import { describe, expect, test } from 'claude-code/testing'
import type { Nav, Place } from '../types'
import {
  AT_LIST,
  back,
  canGoBack,
  canGoForward,
  currentPlace,
  doneAt,
  forward,
  landing,
  leavingList,
  leftSearch,
  NAV_PLACES,
  pagesKept,
  placeIds,
  placeLabel,
  pushed,
  reset,
  searched,
  searching,
  trail,
  TRAIL_PLACES,
  wentTo,
} from '../hooks/nav'

const page = (id: string): Place => ({ kind: 'task', id })
/** The list, then a page for each id, in order, the newest shown. */
const through = (...ids: string[]): Nav => ids.reduce((nav, id) => pushed(nav, page(id)), AT_LIST)
const search = (query: string): Place => ({ kind: 'search', query })
const done = (week: string): Place => ({ kind: 'done', week })
/** What a trail draws, as words: `…`, each crumb's id (`list`, `search`), the shown one in brackets, one ahead after a `+`. */
function trailWords(nav: Nav): string[] {
  const { crumbs, isCutBefore, isCutAfter } = trail(nav)
  const words = crumbs.map(({ place, isShown, isAhead }) => {
    const name = place.kind === 'task' ? place.id : place.kind
    return isShown ? `[${name}]` : isAhead ? `+${name}` : name
  })
  return [...(isCutBefore ? ['…'] : []), ...words, ...(isCutAfter ? ['…'] : [])]
}

describe('nav', () => {
  test('starts at the list, with nowhere to go back or forward to', async () => {
    expect(currentPlace(AT_LIST)).toEqual({ kind: 'list', row: null })
    expect([canGoBack(AT_LIST), canGoForward(AT_LIST)]).toEqual([false, false])
    expect(back(AT_LIST)).toBe(AT_LIST)
    expect(forward(AT_LIST)).toBe(AT_LIST)
  })

  test('each jump shows its page next; back and forward step along them and keep both sides', async () => {
    const nav = through('T52', 'T50', 'T58')
    expect(currentPlace(nav)).toEqual(page('T58'))
    const once = back(nav)
    expect(currentPlace(once)).toEqual(page('T50'))
    expect([canGoBack(once), canGoForward(once)]).toEqual([true, true])
    expect(once.places).toEqual(nav.places)
    expect(currentPlace(back(back(once)))).toEqual({ kind: 'list', row: null })
    expect(canGoBack(back(back(once)))).toBe(false)
    expect(forward(once)).toEqual(nav)
    expect(canGoForward(nav)).toBe(false)
  })

  test('a jump after back drops the places ahead', async () => {
    const nav = pushed(back(back(through('T52', 'T50', 'T58'))), page('T9'))
    expect(nav.places).toEqual([{ kind: 'list', row: null }, page('T52'), page('T9')])
    expect(nav.at).toBe(2)
    expect(canGoForward(nav)).toBe(false)
  })

  test('a jump to the page shown changes nothing, ahead kept', async () => {
    const nav = back(through('T52', 'T50'))
    expect(pushed(nav, page('T52'))).toBe(nav)
    expect(pushed(AT_LIST, { kind: 'list', row: 'x' })).toBe(AT_LIST)
  })

  test(`keeps the newest ${NAV_PLACES} places, the oldest dropped first`, async () => {
    const ids = Array.from({ length: NAV_PLACES + 3 }, (_, i) => `T${i + 1}`)
    const nav = through(...ids)
    expect(nav.places).toHaveLength(NAV_PLACES)
    expect(nav.places[0]).toEqual(page('T4'))
    expect(currentPlace(nav)).toEqual(page(`T${NAV_PLACES + 3}`))
    expect(nav.at).toBe(NAV_PLACES - 1)
  })

  test('a crumb goes straight to its place, both sides kept; an index with no place changes nothing', async () => {
    const nav = through('T52', 'T50', 'T58')
    expect(wentTo(nav, 1)).toEqual({ places: nav.places, at: 1 })
    expect(wentTo(nav, 0).at).toBe(0)
    expect(wentTo(nav, 4)).toBe(nav)
    expect(wentTo(nav, -1)).toBe(nav)
    expect(wentTo(nav, 1.5)).toBe(nav)
  })

  test('the list remembers the element a page was opened from; a page does not take one', async () => {
    const left = leavingList(AT_LIST, 'next:T52-open')
    expect(currentPlace(left)).toEqual({ kind: 'list', row: 'next:T52-open' })
    const nav = pushed(left, page('T52'))
    expect(leavingList(nav, 'other')).toBe(nav)
    expect(currentPlace(back(nav))).toEqual({ kind: 'list', row: 'next:T52-open' })
  })

  test('a reset shows the list alone, remembering the row it left only when asked to', async () => {
    const nav = pushed(pushed(leavingList(AT_LIST, 'next:T52-open'), page('T52')), page('T50'))
    expect(reset(nav, true)).toEqual({ places: [{ kind: 'list', row: 'next:T52-open' }], at: 0 })
    expect(reset(nav, false)).toBe(AT_LIST)
    // The newest list place at or before the one shown: a list left out of the kept places remembers none.
    const long = through(...Array.from({ length: NAV_PLACES }, (_, i) => `T${i + 1}`))
    expect(reset(long, true)).toBe(AT_LIST)
  })

  test('names the ids of the pages it holds', async () => {
    expect([...placeIds(through('T52', 'T50', 'T52'))].sort()).toEqual(['T50', 'T52'])
    expect(placeIds(AT_LIST).size).toBe(0)
  })

  test('keeps the details of the pages a place still names, and drops the rest', async () => {
    const nav = pushed(back(through('T52', 'T50')), page('T9'))
    expect(pagesKept({ T52: 1, T50: 2, T9: 3 }, nav)).toEqual({ T52: 1, T9: 3 })
    expect(pagesKept({ T52: 1 }, AT_LIST)).toEqual({})
  })

  test('a page opens at its top; a step from a page to the list lands on the element it was left from; no other step moves the window', async () => {
    const nav = pushed(leavingList(AT_LIST, 'next:T52-open'), page('T52'))
    expect(landing(nav, back(nav))).toEqual({ kind: 'row', key: 'next:T52-open' })
    expect(landing(nav, wentTo(nav, 0))).toEqual({ kind: 'row', key: 'next:T52-open' })
    expect(landing(back(nav), nav)).toEqual({ kind: 'top' })
    expect(landing(through('T52', 'T50'), back(through('T52', 'T50')))).toEqual({ kind: 'top' })
    expect(landing(through('T52'), back(through('T52')))).toBe(null)
    expect(landing(back(nav), reset(back(nav), true))).toBe(null)
  })

  test('a crumb names the list Tasks, a page by its task id, and a search by its query', async () => {
    expect([placeLabel({ kind: 'list', row: 'x' }), placeLabel(page('T58'))]).toEqual(['Tasks', 'T58'])
    expect([placeLabel(search('')), placeLabel(search('feed etl'))]).toEqual(['Search', 'Search "feed etl"'])
  })

  test('search shows a search with no query past the place shown; on a search it changes nothing', async () => {
    const nav = searching(through('T52'))
    expect(currentPlace(nav)).toEqual(search(''))
    expect(trailWords(nav)).toEqual(['list', 'T52', '[search]'])
    expect(searching(nav)).toBe(nav)
  })

  test('typing changes the query of the search shown, no new place; elsewhere it pushes a search', async () => {
    const typed = searched(searched(searching(AT_LIST), 'fe'), 'feed')
    expect(typed).toEqual({ places: [{ kind: 'list', row: null }, search('feed')], at: 1 })
    expect(searched(through('T52'), 'feed')).toEqual({ places: [{ kind: 'list', row: null }, page('T52'), search('feed')], at: 2 })
  })

  test('back from a result page returns to the search with its query; the same search pushed again changes nothing', async () => {
    const nav = pushed(searched(AT_LIST, 'feed'), page('T50'))
    const results = back(nav)
    expect(currentPlace(results)).toEqual(search('feed'))
    expect(pushed(results, search('feed'))).toBe(results)
    expect(pushed(results, search('load'))).toEqual({ places: [{ kind: 'list', row: null }, search('feed'), search('load')], at: 2 })
  })

  test('an empty query, or clear, closes the search: it and the places ahead dropped, the place before it shown', async () => {
    const nav = searched(through('T52'), 'feed')
    expect(searched(nav, '')).toEqual(through('T52'))
    expect(leftSearch(nav)).toEqual(through('T52'))
    expect(leftSearch(back(pushed(nav, page('T50'))))).toEqual(through('T52'))
    expect(leftSearch({ places: [search('feed')], at: 0 })).toBe(AT_LIST)
    expect(leftSearch(through('T52'))).toEqual(through('T52'))
    expect(searched(through('T52'), '')).toEqual(through('T52'))
  })

  test('a search opens at its top, a step back to it from a page too; typing in it, or closing it, keeps the window', async () => {
    const opened = searching(AT_LIST)
    expect(landing(AT_LIST, opened)).toEqual({ kind: 'top' })
    expect(landing(opened, searched(opened, 'feed'))).toBe(null)
    const onPage = pushed(searched(AT_LIST, 'feed'), page('T50'))
    expect(landing(onPage, back(onPage))).toEqual({ kind: 'top' })
    expect(landing(searched(AT_LIST, 'feed'), leftSearch(searched(AT_LIST, 'feed')))).toBe(null)
  })

  test('Older done pushes the Done page; a step to another week changes the week shown, so back returns to the list', async () => {
    const opened = doneAt(AT_LIST, '2026-10-12')
    expect(opened).toEqual({ places: [{ kind: 'list', row: null }, done('2026-10-12')], at: 1 })
    expect(landing(AT_LIST, opened)).toEqual({ kind: 'top' })
    const older = doneAt(opened, '2026-10-05')
    expect(older).toEqual({ places: [{ kind: 'list', row: null }, done('2026-10-05')], at: 1 })
    expect(landing(opened, older)).toEqual({ kind: 'top' })
    expect(currentPlace(back(older))).toEqual({ kind: 'list', row: null })
    // A finished task's page opens past it, and back returns to the week it was opened from.
    const onPage = pushed(older, page('T4'))
    expect(currentPlace(back(onPage))).toEqual(done('2026-10-05'))
    expect(pushed(older, done('2026-10-05'))).toBe(older)
    expect([placeLabel(done('2026-10-05')), ...trailWords(onPage)]).toEqual(['Done 10-05', 'list', 'done', '[T4]'])
    expect([...placeIds(onPage)]).toEqual(['T4'])
  })

  test('the search places name no page', async () => {
    expect([...placeIds(pushed(searched(AT_LIST, 'feed'), page('T50')))]).toEqual(['T50'])
  })

  test(`the trail draws at most ${TRAIL_PLACES} places, the newest, a cut marked`, async () => {
    expect(trailWords(AT_LIST)).toEqual(['[list]'])
    expect(trailWords(through('T52', 'T50', 'T58'))).toEqual(['list', 'T52', 'T50', '[T58]'])
    expect(trailWords(through('T52', 'T50', 'T58', 'T7'))).toEqual(['…', 'T52', 'T50', 'T58', '[T7]'])
  })

  test('after back the places ahead stay in the trail, marked ahead; far enough back the window follows the shown one', async () => {
    const nav = through('T52', 'T50', 'T58')
    expect(trailWords(back(nav))).toEqual(['list', 'T52', '[T50]', '+T58'])
    const long = through('T1', 'T2', 'T3', 'T4', 'T5')
    expect(trailWords(back(long))).toEqual(['…', 'T2', 'T3', '[T4]', '+T5'])
    expect(trailWords(wentTo(long, 2))).toEqual(['…', '[T2]', '+T3', '+T4', '+T5'])
    expect(trailWords(wentTo(long, 0))).toEqual(['[list]', '+T1', '+T2', '+T3', '…'])
    expect(trail(wentTo(long, 0)).crumbs.map(crumb => crumb.index)).toEqual([0, 1, 2, 3])
  })
})
