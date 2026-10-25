// The Log view's search (hooks/log-search.ts): the conversations of its list a query names by the start of a word in
// their title as the list draws it (the tasks worked, their ids and titles, else how it opened) or their session's name.
import { describe, expect, test } from 'claude-code/testing'
import type { LogConversation, LogList, TaskRow } from '../types'
import { readRegister } from '../hooks/core/read/index'
import { rowOf } from '../hooks/log'
import { LOG_SEARCH_VIEW, logResultKey, searchLog, type LogHit } from '../hooks/log-search'
import type { Worked } from '../hooks/log-title'
import { marksOf } from '../hooks/search'
import { isResultOf } from '../hooks/search-view'
import { createLine } from './fixtures'

const NOW = Date.parse('2026-10-19T20:30:00Z')
const DAY = 86_400_000
const at = (iso: string) => Date.parse(iso)
const TASKS: TaskRow[] = [...readRegister(createLine('T855', { owner: 'lead', by: 'lead', at: NOW - DAY, title: 'Pane: a readable Log view' })).state.tasks.values()].map(
  task => rowOf(task),
)

function conversation(session: string, claude: string, firstAt: string, more: Partial<LogConversation> = {}): LogConversation {
  return { session, claude, firstAt: at(firstAt), lastAt: at(firstAt), nextAt: null, lines: 2, opening: null, ...more }
}

/** lead's c-2 worked T855; api's c-9 opened with the owner's words; web's c-3 holds no prompt or reply. */
const LIST: LogList = {
  kind: 'conversations',
  hours: 24,
  conversations: [
    conversation('lead', 'c-2', '2026-10-19T20:10:00Z'),
    conversation('api', 'c-9', '2026-10-19T19:45:00Z', { opening: { by: 'owner', line: 'plan the readable week' } }),
    conversation('web', 'c-3', '2026-10-19T19:00:00Z'),
  ],
}
const WORKED: Worked = { tasks: TASKS, work: [{ session: 'lead', task: 'T855', at: at('2026-10-19T20:12:00Z') }] }
const idsOf = (hits: readonly LogHit[]) => hits.map(hit => `${hit.row.conversation.session}:${hit.row.conversation.claude}`)
const search = (query: string) => searchLog(LIST, WORKED, query)

describe('searchLog', () => {
  test("a word names a conversation by the start of a word in its title, a task's id among them, in the list's order", () => {
    const readable = search('readable')
    expect(idsOf(readable)).toEqual(['lead:c-2', 'api:c-9'])
    expect(readable.map(hit => marksOf(hit, 'title'))).toEqual([[{ start: 13, end: 21 }], [{ start: 9, end: 17 }]])
    // Every word must match.
    expect(idsOf(search('readable log'))).toEqual(['lead:c-2'])
    expect(idsOf(search('t855'))).toEqual(['lead:c-2'])
    // The middle of a word is no start.
    expect(search('eadable')).toEqual([])
  })

  test("a word names a conversation by its session's name, one with no title too", () => {
    const web = search('web')
    expect(idsOf(web)).toEqual(['web:c-3'])
    expect(web.map(hit => marksOf(hit, 'session'))).toEqual([[{ start: 0, end: 3 }]])
    expect(web.map(hit => hit.row.title)).toEqual([null])
    // The words that say a conversation has no prompt or reply are no title of it.
    expect(search('reply')).toEqual([])
  })

  test('none for a blank query or a list that holds no conversations', () => {
    expect(search('  ')).toEqual([])
    expect(searchLog({ kind: 'reading' }, WORKED, 'lead')).toEqual([])
  })

  test("a result is keyed by the Log search's view and its conversation", () => {
    const key = logResultKey({ session: 'lead', claude: 'c-2' })
    expect(key).toBe('log-search:lead:c-2')
    expect(isResultOf(LOG_SEARCH_VIEW, key)).toBe(true)
  })
})
