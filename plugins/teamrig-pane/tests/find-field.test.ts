import { describe, expect, test } from 'claude-code/testing'
import type { FindField, Nav, RingLandings } from '../types'
import { FIND, FIRST_FIELD, FIRST_MEMO, NO_LANDINGS, drawnWith, fieldAfter, fieldKey, fieldText, isFieldKey, keysAt, keysHint, landedOn, submitWords } from '../hooks/find-field'
import { AT_LIST, pushed, searched } from '../hooks/nav'

const page = (nav: Nav, id: string): Nav => pushed(nav, { kind: 'task', id })

describe('find field', () => {
  test('holds the query of the search shown, else nothing', () => {
    expect(fieldText(AT_LIST)).toBe('')
    expect(fieldText(searched(AT_LIST, 'etl the'))).toBe('etl the')
    expect(fieldText(page(searched(AT_LIST, 'etl'), 'T50'))).toBe('')
  })

  test('a step that changes what the field holds starts a round holding the new text', () => {
    const search = searched(AT_LIST, 'etl the')
    const onPage = page(search, 'T50')
    // Enter on a search opens a page: a fresh, empty field.
    const opened = fieldAfter(FIRST_FIELD, search, onPage)
    expect(opened).toEqual({ round: 1, text: '' })
    // Back to the search: a fresh field holding its words.
    expect(fieldAfter(opened, onPage, search)).toEqual({ round: 2, text: 'etl the' })
    // clear, or mine and all, from a search: a fresh, empty field.
    const typed: FindField = { round: 4, text: '' }
    expect(fieldAfter(typed, search, AT_LIST)).toEqual({ round: 5, text: '' })
  })

  test('a step that leaves what the field holds keeps the round, the same value', () => {
    const field: FindField = { round: 3, text: 'etl' }
    const search = searched(AT_LIST, 'etl')
    expect(fieldAfter(field, search, search)).toBe(field)
    // The list to the Archive page: empty both.
    expect(fieldAfter(field, AT_LIST, pushed(AT_LIST, { kind: 'done', week: '2026-10-12' }))).toBe(field)
  })

  test('the first round draws under find, each later one under its own key', () => {
    expect(fieldKey(FIRST_FIELD)).toBe(FIND)
    expect(fieldKey({ round: 1, text: '' })).toBe('find:1')
    expect(fieldKey({ round: 12, text: 'etl' })).toBe('find:12')
  })
})

describe('where the keys go', () => {
  test("the field's key in any round is the field's; the Find label's and every other key are not", () => {
    expect([FIND, 'find:1', 'find:12'].map(isFieldKey)).toEqual([true, true, true])
    expect(['find-key', 'finder', 'mine', ''].map(isFieldKey)).toEqual([false, false, false, false])
  })

  test('each landing counts with what it was on: the field, a result of the search, else another element', () => {
    const onField = landedOn(NO_LANDINGS, 'find:3')
    expect(onField).toEqual({ count: 1, on: 'field' })
    expect(landedOn(onField, 'search:T50')).toEqual({ count: 2, on: 'result' })
    expect(landedOn(onField, 'search-count')).toEqual({ count: 2, on: 'other' })
    expect(landedOn(onField, 'mine')).toEqual({ count: 2, on: 'other' })
    // One of the engine's own stops.
    expect(landedOn(onField, undefined)).toEqual({ count: 2, on: 'other' })
  })

  test('the memo records the landings only as the keys go, never again while they stay away', () => {
    const lost = drawnWith(FIRST_MEMO, false, { count: 2, on: 'field' })
    expect(lost).toEqual({ wasHeld: false, lostAt: 2 })
    // A landing while still drawn without the keys (the click that hands them back) is not counted as let go.
    expect(drawnWith(lost, false, { count: 3, on: 'field' })).toBe(lost)
    const back = drawnWith(lost, true, { count: 3, on: 'field' })
    expect(back).toEqual({ wasHeld: true, lostAt: 2 })
    expect(drawnWith(back, true, { count: 4, on: 'other' })).toBe(back)
  })

  test("Claude's without the keys; the field's or a result's after a landing on it since they came; else the pane's", () => {
    const memo = { wasHeld: true, lostAt: 2 }
    const onField: RingLandings = { count: 3, on: 'field' }
    const onResult: RingLandings = { count: 3, on: 'result' }
    expect(keysAt(false, onField, memo, true)).toBe('claude')
    expect(keysAt(true, onField, memo, true)).toBe('search')
    expect(keysAt(true, onResult, memo, true)).toBe('result')
    // The search closed under the ring: what was a result is another element now.
    expect(keysAt(true, onResult, memo, false)).toBe('pane')
    // The ring was on the field or a result as the keys went; given back, the ring is clear.
    expect(keysAt(true, { count: 2, on: 'field' }, memo, true)).toBe('pane')
    expect(keysAt(true, { count: 2, on: 'result' }, memo, true)).toBe('pane')
    expect(keysAt(true, { count: 3, on: 'other' }, memo, true)).toBe('pane')
  })

  test('Enter in the field opens the one match, else moves to the results', () => {
    expect([0, 1, 2, 30].map(submitWords)).toEqual(['open', 'open', 'to the results', 'to the results'])
  })

  test('the line names where the keys go and the key or click that moves them', () => {
    expect(keysHint('search', 1)).toBe('Typing searches · Enter: open · Esc: to Claude')
    expect(keysHint('search', 2)).toBe('Typing searches · Enter: to the results · Esc: to Claude')
    expect(keysHint('result', 2)).toBe('On a result · Enter: open · ↑↓: move · s: search · Esc: to Claude')
    expect(keysHint('pane', 0)).toBe('Keys on the pane · s: search · Esc: to Claude')
    expect(keysHint('claude', 0)).toBe('Keys go to Claude · click the field to search')
  })
})
