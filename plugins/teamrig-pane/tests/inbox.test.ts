import { describe, expect, test } from 'claude-code/testing'
import { INBOX_WINDOW_HOURS, inboxDrawn, inboxItemOf, inboxItems, inboxKey, inboxShown } from '../hooks/inbox'
import { INBOX_LINES, INBOX_UNREAD_FROM, NOW } from './fixtures'

const HOUR = 3_600_000

describe('inbox', () => {
  test("a stamped line reads as its UTC time, its sender up to the first ': ' and its words", () => {
    expect(inboxItemOf('- 2026-10-13 13:05 lead: ship T772: the Inbox view', 4, true)).toEqual({
      key: 'inbox:4',
      at: Date.UTC(2026, 9, 13, 13, 5),
      from: 'lead',
      text: 'ship T772: the Inbox view',
      unread: true,
    })
    expect(inboxKey(4)).toBe('inbox:4')
  })

  test('a line with no sender keeps its words whole; one with no stamp, or a stamp no day has, is left out', () => {
    expect(inboxItemOf('- 2026-10-13 13:05 a note with no sender', 0, false)).toEqual({
      key: 'inbox:0',
      at: Date.UTC(2026, 9, 13, 13, 5),
      from: null,
      text: 'a note with no sender',
      unread: false,
    })
    expect(inboxItemOf('- 2026-10-13 13:05 : no name', 0, false)?.from).toBe(null)
    expect(inboxItemOf('line one', 0, true)).toBe(null)
    expect(inboxItemOf('- 2026-13-45 13:05 lead: no such day', 0, true)).toBe(null)
  })

  test('shows the lines of the last 24 hours, read ones too, and every unread line whatever its age, in the file order', () => {
    const lines = [
      '- 2026-10-11 09:00 lead: read two days ago',
      `- 2026-10-12 14:00 lead: read ${INBOX_WINDOW_HOURS} hours ago`,
      'undated',
      '- 2026-10-11 10:00 qa: unread for two days',
      '- 2026-10-13 13:30 docs: new',
    ]
    expect(inboxItems(lines, 3, NOW).map(item => [item.key, item.unread])).toEqual([
      ['inbox:1', false],
      ['inbox:3', true],
      ['inbox:4', true],
    ])
  })

  test('with no read mark no line shows as unread, and only the last 24 hours show', () => {
    const lines = ['- 2026-10-11 10:00 qa: two days old', '- 2026-10-13 13:30 docs: new']
    expect(inboxItems(lines, null, NOW).map(item => [item.key, item.unread])).toEqual([['inbox:1', false]])
  })

  test('a read line leaves the view as the clock moves past its 24 hours; an unread one stays', () => {
    const items = inboxItems(['- 2026-10-13 09:00 lead: read', '- 2026-10-13 09:30 qa: unread'], 1, NOW)
    expect(inboxShown(items, NOW).length).toBe(2)
    expect(inboxShown(items, Date.UTC(2026, 9, 14, 9, 0)).length).toBe(2)
    expect(inboxShown(items, Date.UTC(2026, 9, 14, 9, 0) + HOUR).map(item => item.key)).toEqual(['inbox:1'])
  })

  test('the view draws the lines still shown the last written first, and leaves the items it was given as they were', () => {
    const items = inboxItems(INBOX_LINES, INBOX_UNREAD_FROM, NOW)
    expect(inboxDrawn(items, NOW).map(item => item.key)).toEqual(['inbox:4', 'inbox:3', 'inbox:2', 'inbox:1'])
    expect(inboxDrawn(items, NOW + 24 * HOUR).map(item => item.key)).toEqual(['inbox:4', 'inbox:3'])
    expect(items.map(item => item.key)).toEqual(['inbox:1', 'inbox:2', 'inbox:3', 'inbox:4'])
  })
})
