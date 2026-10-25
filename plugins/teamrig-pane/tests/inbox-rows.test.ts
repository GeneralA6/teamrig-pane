// The Inbox view as blocks of rows (hooks/inbox-rows.ts): its lines the last written first under their count, each a
// head (the unread mark, the sender, the time on the team's clock) over its words; or the search's body.
import { describe, expect, test } from 'claude-code/testing'
import { inboxItems } from '../hooks/inbox'
import { INBOX_EMPTY, INBOX_NOTHING_FOUND, INBOX_SEARCH_HINT, countLine, inboxBlocks, type InboxSource } from '../hooks/inbox-rows'
import { searchInbox } from '../hooks/inbox-search'
import { NO_AREA, SEPARATOR, type Block } from '../hooks/rows'
import { HOUR, INBOX_LINES, INBOX_UNREAD_FROM, NOW } from './fixtures'

/** The inbox of INBOX_LINES at NOW, on a team whose clock is Israel's (`IDT`, three hours ahead of UTC). */
const SOURCE: InboxSource = { area: 'po', inbox: inboxItems(INBOX_LINES, INBOX_UNREAD_FROM, NOW), now: NOW, timeZone: 'Asia/Jerusalem' }
/** Each block as its key and its rows' words. */
const words = (blocks: Block[]): [string, string[]][] => blocks.map(block => [block.key, block.rows.map(row => row.spans.map(span => span.text).join(''))])

function blockOf(blocks: Block[], key: string): Block {
  const block = blocks.find(found => found.key === key)
  if (block === undefined) throw new Error(`no block ${key}`)
  return block
}

describe('inboxBlocks', () => {
  test('the count, then each line the last written first: ● on an unread one, its sender, its time on the team clock, its words', () => {
    const blocks = inboxBlocks(SOURCE)
    expect(words(blocks)).toEqual([
      ['inbox:count', [`2 unread${SEPARATOR.text}2 read in the last 24 hours`]],
      ['inbox:4', ['● lead · 16:00 IDT', '  ship T772: the Inbox view']],
      ['inbox:3', ['● qa · Mon 10-12 14:00 IDT', '  unread since yesterday']],
      ['inbox:2', ['  15:30 IDT', '  a note with no sender']],
      ['inbox:1', ['  docs · 13:00 IDT', '  read today']],
    ])
    const newest = blockOf(blocks, 'inbox:4')
    expect(newest.rows.map(row => row.key)).toEqual(['inbox:4', 'inbox-text:inbox:4'])
    expect(newest.rows[0]?.spans).toEqual([{ text: '● ', color: 'warning' }, { text: 'lead', bold: true }, SEPARATOR, { text: '16:00 IDT', dim: true }])
    expect(newest.rows.every(row => row.maxLines === undefined && row.hang?.text === '  ')).toBe(true)
    expect(blocks.some(block => block.opens !== undefined || block.toggle !== undefined || block.reads !== undefined)).toBe(false)
  })

  test('the count names only what it counts', () => {
    const [unread, read] = [SOURCE.inbox.filter(item => item.unread), SOURCE.inbox.filter(item => !item.unread)]
    expect(countLine(unread)).toBe('2 unread')
    expect(countLine(read)).toBe('2 read in the last 24 hours')
  })

  test('a dim line says why no line shows: no area for the session, or none of the last 24 hours and none unread', () => {
    expect(words(inboxBlocks({ ...SOURCE, area: null }))).toEqual([['inbox:no-area', [NO_AREA]]])
    expect(words(inboxBlocks({ ...SOURCE, inbox: [] }))).toEqual([['inbox:none', [INBOX_EMPTY]]])
    const read = inboxItems(INBOX_LINES, null, NOW)
    expect(words(inboxBlocks({ ...SOURCE, inbox: read, now: NOW + 48 * HOUR }))).toEqual([['inbox:none', [INBOX_EMPTY]]])
  })
})

describe('inboxBlocks with a search', () => {
  const searched = (query: string) => inboxBlocks(SOURCE, { query, hits: searchInbox(SOURCE.inbox, SOURCE.now, query) })

  test('the count, then each line it names keyed as its result, the matched words underlined', () => {
    const blocks = searched('lead inbox')
    expect(words(blocks)).toEqual([
      ['inbox-search-count', ['1 line matches']],
      ['inbox-search:inbox:4', ['● lead · 16:00 IDT', '  ship T772: the Inbox view']],
    ])
    const [head, text] = blockOf(blocks, 'inbox-search:inbox:4').rows
    expect(head?.spans.filter(span => span.underline === true)).toEqual([{ text: 'lead', bold: true, underline: true }])
    expect(text?.key).toBe('inbox-search-text:inbox:4')
    expect(text?.spans).toEqual([{ text: '  ' }, { text: 'ship T772: the ' }, { text: 'Inbox', underline: true }, { text: ' view' }])
  })

  test('every match shows, the last written first, counted', () => {
    expect(words(searched('read')).map(([key]) => key)).toEqual(['inbox-search-count', 'inbox-search:inbox:1'])
    expect(words(searched('no')).map(([key]) => key)).toEqual(['inbox-search-count', 'inbox-search:inbox:2'])
    const many = words(searched('t'))
    expect(many.map(([key]) => key)).toEqual(['inbox-search-count', 'inbox-search:inbox:4', 'inbox-search:inbox:1'])
    expect(many[0]).toEqual(['inbox-search-count', ['2 lines match']])
  })

  test('the hint for a query with no word, the nothing line when none matched', () => {
    expect(words(searched(' '))).toEqual([['inbox-search-hint', [INBOX_SEARCH_HINT]]])
    expect(words(searched('deploy'))).toEqual([['inbox-search-none', [INBOX_NOTHING_FOUND]]])
  })
})
