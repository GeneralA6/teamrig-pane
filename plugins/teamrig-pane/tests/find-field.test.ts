import { describe, expect, test } from 'claude-code/testing'
import type { FindField, Nav } from '../types'
import { FIND, FIRST_FIELD, fieldAfter, fieldKey, fieldText } from '../hooks/find-field'
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
