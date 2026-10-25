// The Log view's search (T773): the conversations of its list (turn-log.ts) a query names, on the shared search
// (search.ts). A word matches the start of a word in a conversation's title as the list draws it (log-title.ts: the
// tasks its session worked, their ids and titles, else how it opened) or in its session's name. Every match is kept,
// in the list's order, the newest last line first: the hours teamrig keeps hold few enough conversations to show
// whole. A result opens its conversation's page, as the list's rows do. Pure.
import type { LogConversation, LogList, LogRead } from '../types'
import { titleOf, type Worked } from './log-title'
import type { Span } from './rows'
import { matchRows, type Hit, type SearchSpec } from './search'
import { resultKey } from './search-view'

/** The Log search's key: its results are keyed `log-search:<session>:<claude>`, its own lines `log-search-count` and the like. */
export const LOG_SEARCH_VIEW = 'log-search'

/** The fields a word can match the start of a word in. */
export const LOG_SEARCHED = ['title', 'session'] as const
export type LogSearchedField = (typeof LOG_SEARCHED)[number]

/** A conversation as searched: itself, and its title as the list draws it, null for one with no task and no prompt or reply. */
export type LogRow = { conversation: LogConversation; title: readonly Span[] | null }

/** A conversation is searched by its title's words, a task id among them, and its session's name. */
const LOG_SEARCH: SearchSpec<LogRow, LogSearchedField> = {
  fields: [
    { name: 'title', text: row => (row.title === null ? null : row.title.map(span => span.text).join('')) },
    { name: 'session', text: row => row.conversation.session },
  ],
}

/** A conversation the query names, with where its words matched. */
export type LogHit = Hit<LogRow, LogSearchedField>

/** The list's conversations that `query` names, in its order; none for a blank query or a list that holds none. */
export function searchLog(list: LogList, worked: Worked, query: string): LogHit[] {
  if (list.kind !== 'conversations') return []
  const rows = list.conversations.map((conversation): LogRow => ({ conversation, title: titleOf(conversation, worked) }))
  return matchRows(rows, query, LOG_SEARCH)
}

/** The key the result for `read`'s conversation is drawn under: the press that opens its page. */
export function logResultKey(read: LogRead): string {
  return resultKey(LOG_SEARCH_VIEW, `${read.session}:${read.claude}`)
}
