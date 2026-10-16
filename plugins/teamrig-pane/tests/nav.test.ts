import { describe, expect, test } from 'claude-code/testing'
import type { Nav, Place } from '../types'
import {
  AT_LIST,
  back,
  canGoBack,
  canGoForward,
  currentPlace,
  forward,
  leavingList,
  NAV_PLACES,
  placeIds,
  pushed,
  reset,
  trail,
  TRAIL_PLACES,
  wentTo,
} from '../hooks/nav'

const page = (id: string): Place => ({ kind: 'task', id })
/** The list, then a page for each id, in order, the newest shown. */
const through = (...ids: string[]): Nav => ids.reduce((nav, id) => pushed(nav, page(id)), AT_LIST)
/** What a trail draws, as words: `…`, each crumb's id (`list`), the shown one in brackets, one ahead after a `+`. */
function trailWords(nav: Nav): string[] {
  const { crumbs, isCutBefore, isCutAfter } = trail(nav)
  const words = crumbs.map(({ place, isShown, isAhead }) => {
    const name = place.kind === 'list' ? 'list' : place.id
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
