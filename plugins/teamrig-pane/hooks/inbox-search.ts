// The Inbox view's search (T772): the lines of the session's inbox (inbox.ts) a query names, on the shared search
// (search.ts). A word matches the start of a word in a line's sender or in its words. The lines searched are those the
// view draws at the drawing's now (inboxDrawn), and every match is kept, the last written first as the view draws
// them: a day's inbox is small enough to show whole. A result has nothing to open, as a line shows whole. Pure.
import type { InboxItem } from '../types'
import { inboxDrawn } from './inbox'
import { matchRows, type Hit, type SearchSpec } from './search'

/** The Inbox search's key: its results are keyed `inbox-search:<line key>`, its own lines `inbox-search-count` and the like. */
export const INBOX_SEARCH_VIEW = 'inbox-search'

/** The fields a word can match the start of a word in. */
export const INBOX_SEARCHED = ['from', 'text'] as const
export type InboxSearchedField = (typeof INBOX_SEARCHED)[number]

/** A line is searched by its sender, none for a line with no sender, and its words. No id: a line has none to name. */
const INBOX_SEARCH: SearchSpec<InboxItem, InboxSearchedField> = {
  fields: [
    { name: 'from', text: item => item.from },
    { name: 'text', text: item => item.text },
  ],
}

/** A line the query names, with where its words matched. */
export type InboxHit = Hit<InboxItem, InboxSearchedField>

/** The lines the view draws at `now` that `query` names, the last written first; none for a blank query. */
export function searchInbox(items: readonly InboxItem[], now: number, query: string): InboxHit[] {
  return matchRows(inboxDrawn(items, now), query, INBOX_SEARCH)
}
