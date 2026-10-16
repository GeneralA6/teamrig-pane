import { describe, expect, test } from 'claude-code/testing'
import type { FindField, Nav, RingLandings } from '../types'
import { FIND, FIRST_FIELD, FIRST_MEMO, NO_LANDINGS, drawnWith, fieldAfter, fieldKey, fieldText, isFieldKey, keysAt, keysHint, landedOn } from '../hooks/find-field'
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

  test("each landing counts, on the field or off it; one of the engine's own stops is off it", () => {
    const onField = landedOn(NO_LANDINGS, 'find:3')
    expect(onField).toEqual({ count: 1, onField: true })
    expect(landedOn(onField, 'mine')).toEqual({ count: 2, onField: false })
    expect(landedOn(onField, undefined)).toEqual({ count: 2, onField: false })
  })

  test('the memo records the landings only as the keys go, never again while they stay away', () => {
    const lost = drawnWith(FIRST_MEMO, false, { count: 2, onField: true })
    expect(lost).toEqual({ wasHeld: false, lostAt: 2 })
    // A landing while still drawn without the keys (the click that hands them back) is not counted as let go.
    expect(drawnWith(lost, false, { count: 3, onField: true })).toBe(lost)
    const back = drawnWith(lost, true, { count: 3, onField: true })
    expect(back).toEqual({ wasHeld: true, lostAt: 2 })
    expect(drawnWith(back, true, { count: 4, onField: false })).toBe(back)
  })

  test("Claude's without the keys; the field's after a landing on it since they came; else the pane's", () => {
    const memo = { wasHeld: true, lostAt: 2 }
    const onField: RingLandings = { count: 3, onField: true }
    expect(keysAt(false, onField, memo)).toBe('claude')
    expect(keysAt(true, onField, memo)).toBe('search')
    // The ring was on the field as the keys went; given back, the ring is clear.
    expect(keysAt(true, { count: 2, onField: true }, memo)).toBe('pane')
    expect(keysAt(true, { count: 3, onField: false }, memo)).toBe('pane')
  })

  test('the line names where the keys go and the key or click that moves them', () => {
    expect(keysHint('search')).toBe('Typing searches · Enter: open · Esc: to Claude')
    expect(keysHint('pane')).toBe('Keys on the pane · s: search · Esc: to Claude')
    expect(keysHint('claude')).toBe('Keys go to Claude · click the field to search')
  })
})
