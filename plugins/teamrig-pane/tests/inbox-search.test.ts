// The Inbox view's search (hooks/inbox-search.ts): the lines the view draws that a query names by the start of a word
// in their sender or their words, the last written first.
import { describe, expect, test } from 'claude-code/testing'
import { inboxItems } from '../hooks/inbox'
import { searchInbox, type InboxHit } from '../hooks/inbox-search'
import { marksOf } from '../hooks/search'
import { HOUR, INBOX_LINES, INBOX_UNREAD_FROM, NOW } from './fixtures'

const ITEMS = inboxItems(INBOX_LINES, INBOX_UNREAD_FROM, NOW)

/** Each hit's line key. */
function keysOf(hits: readonly InboxHit[]): string[] {
  return hits.map(hit => hit.row.key)
}

describe('searchInbox', () => {
  test('a line by its sender or its words, every word matching, marked where it matched', () => {
    const bySender = searchInbox(ITEMS, NOW, 'lead')
    expect(keysOf(bySender)).toEqual(['inbox:4'])
    expect(bySender.map(hit => marksOf(hit, 'from'))).toEqual([[{ start: 0, end: 4 }]])
    const both = searchInbox(ITEMS, NOW, 'qa yesterday')
    expect(keysOf(both)).toEqual(['inbox:3'])
    expect(both.map(hit => [marksOf(hit, 'from'), marksOf(hit, 'text')])).toEqual([[[{ start: 0, end: 2 }], [{ start: 13, end: 22 }]]])
    expect(keysOf(searchInbox(ITEMS, NOW, 'qa today'))).toEqual([])
  })

  test("a word matches the start of a word only: 'read' names the read line, not the unread ones", () => {
    expect(keysOf(searchInbox(ITEMS, NOW, 'read'))).toEqual(['inbox:1'])
  })

  test('only the lines the view draws are searched, at the drawing’s now, the last written first', () => {
    expect(keysOf(searchInbox(ITEMS, NOW, 'day'))).toEqual([])
    expect(keysOf(searchInbox(ITEMS, NOW + 24 * HOUR, 'today'))).toEqual([])
    const twice = inboxItems(['- 2026-10-13 12:00 lead: first', '- 2026-10-13 13:00 lead: second'], null, NOW)
    expect(keysOf(searchInbox(twice, NOW, 'lead'))).toEqual(['inbox:1', 'inbox:0'])
  })

  test('a blank query names no line', () => {
    expect(searchInbox(ITEMS, NOW, '  ')).toEqual([])
  })
})
