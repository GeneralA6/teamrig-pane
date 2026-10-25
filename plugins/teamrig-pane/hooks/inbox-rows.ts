// The Inbox view as blocks of rows (rows.ts) (T772): the lines of the session's own inbox the view shows (inbox.ts),
// the last written first, under a dim line counting the unread ones and the read ones of the last INBOX_WINDOW_HOURS.
// Each line is a head, `●` on an unread one, its sender bold and when it was posted on the team's clock (zone.ts
// momentWords), over its words, drawn whole: a line has nothing to open. While the Find field holds a query, the view
// draws its search (inbox-search.ts) on the shared search view (search-view.ts) instead: the count, then the lines it
// names, the words that matched underlined. Pure.
import type { InboxItem, Snapshot } from '../types'
import { INBOX_WINDOW_HOURS, inboxDrawn } from './inbox'
import { INBOX_SEARCH_VIEW, type InboxHit, type InboxSearchedField } from './inbox-search'
import { NO_AREA, SEPARATOR, single, type Block, type Span } from './rows'
import { marksOf, type Mark } from './search'
import { markedSpans, resultKey, searchViewBlocks, type Noun } from './search-view'
import { clockOf, momentWords, type Clock } from './zone'

const VIEW = 'inbox'
/** Where a line's head and words start, past the unread mark, so the senders line up. */
const LEAD: Span = { text: '  ' }
const UNREAD: Span = { text: '● ', color: 'warning' }
/** What an empty Find field shows on the Inbox view. */
export const INBOX_SEARCH_HINT = 'Type words to find a line by its sender or its words.'
/** What a query no line matches shows. */
export const INBOX_NOTHING_FOUND = `Nothing matches. The Inbox view searches its lines: the unread ones and those of the last ${INBOX_WINDOW_HOURS} hours.`
/** What the view shows with no line to show. */
export const INBOX_EMPTY = `No inbox lines in the last ${INBOX_WINDOW_HOURS} hours, and none unread.`
/** An Inbox search counts lines. */
const LINE_NOUN: Noun = { one: 'line', many: 'lines' }

/** The Find field's query on the Inbox view and the lines it names (inbox-search.ts searchInbox), the last written first. */
export type InboxSearch = { query: string; hits: readonly InboxHit[] }

/** What the view draws from: the session's area, its inbox lines and the clock they print on. */
export type InboxSource = Pick<Snapshot, 'area' | 'inbox' | 'now' | 'timeZone'>

/** Where a search's words matched in each of a line's fields. */
type Marks = (field: InboxSearchedField) => readonly Mark[]
/** Outside a search nothing is underlined. */
const NO_MARKS: Marks = () => []

function note(key: string, text: string): Block {
  return single(`${VIEW}:${key}`, [{ text, dim: true }])
}

/** `3 unread · 9 read in the last 24 hours`, each part only when it counts a line. */
export function countLine(items: readonly InboxItem[]): string {
  const unread = items.filter(item => item.unread).length
  const read = items.length - unread
  const parts = [unread === 0 ? null : `${unread} unread`, read === 0 ? null : `${read} read in the last ${INBOX_WINDOW_HOURS} hours`]
  return parts.filter(part => part !== null).join(SEPARATOR.text)
}

/**
 * A line's block, keyed `key` as its head is (the unread mark, its sender, its time), over its words keyed
 * `<view>-text:<line key>`; where `marks` says a search's words matched, underlined.
 */
function lineBlock(view: string, key: string, item: InboxItem, clock: Clock, marks: Marks): Block {
  const head: Span[] = [item.unread ? UNREAD : LEAD]
  if (item.from !== null) head.push(...markedSpans(item.from, marks('from'), { bold: true }), SEPARATOR)
  head.push({ text: momentWords(item.at, clock), dim: true })
  const words = [LEAD, ...markedSpans(item.text, marks('text'), {})]
  return { key, rows: [{ key, spans: head, hang: LEAD }, { key: `${view}-text:${item.key}`, spans: words, hang: LEAD }] }
}

/** The search's body: the hint, the line that says nothing matched, or the count and the lines it names. */
function foundBlocks(search: InboxSearch, clock: Clock): Block[] {
  const results = search.hits.map(hit =>
    lineBlock(INBOX_SEARCH_VIEW, resultKey(INBOX_SEARCH_VIEW, hit.row.key), hit.row, clock, field => marksOf(hit, field)),
  )
  const total = search.hits.length
  return searchViewBlocks({ key: INBOX_SEARCH_VIEW, query: search.query, hint: INBOX_SEARCH_HINT, nothing: INBOX_NOTHING_FOUND, noun: LINE_NOUN, results, shown: total, total })
}

/**
 * The Inbox view: the lines it shows at the snapshot's now, the last written first under their count, or why none
 * show; while `search` holds the Find field's query, the search's body instead.
 */
export function inboxBlocks(snap: InboxSource, search: InboxSearch | null = null): Block[] {
  if (snap.area === null) return [note('no-area', NO_AREA)]
  const clock = clockOf(snap)
  if (search !== null) return foundBlocks(search, clock)
  const items = inboxDrawn(snap.inbox, snap.now)
  if (items.length === 0) return [note('none', INBOX_EMPTY)]
  return [note('count', countLine(items)), ...items.map(item => lineBlock(VIEW, item.key, item, clock, NO_MARKS))]
}
