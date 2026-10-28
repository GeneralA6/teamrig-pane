// The Log view as rows (hooks/log-rows.ts): the conversations list, each a press that opens its page, titled by the
// tasks its session worked during it else by how it opened, the notes for a list it cannot show, and a
// conversation's page: its head, a note for what it leaves out, and each line's blocks.
import { describe, expect, test } from 'claude-code/testing'
import type { LogConversation, LogList, LogPage, TaskRow, TurnEntry } from '../types'
import { readRegister } from '../hooks/core/read/index'
import { rowOf } from '../hooks/log'
import { conversationKey, LOG_SEARCH_HINT, logListBlocks, logPageBlocks, logPageTitle } from '../hooks/log-rows'
import { searchLog } from '../hooks/log-search'
import type { Worked } from '../hooks/log-title'
import type { Block } from '../hooks/rows'
import { clockOf } from '../hooks/zone'
import { createLine } from './fixtures'

const NOW = Date.parse('2026-10-19T20:30:00Z')
const DAY = 86_400_000
/** NOW on UTC's clock, and on Jerusalem's: Mon 10-19 23:30 IDT. */
const UTC = clockOf({ now: NOW, timeZone: 'UTC' })
const JERUSALEM = clockOf({ now: NOW, timeZone: 'Asia/Jerusalem' })
/** Each block as its key and its rows' words. */
const words = (blocks: Block[]): [string, string[]][] => blocks.map(block => [block.key, block.rows.map(row => row.spans.map(span => span.text).join(''))])
const at = (iso: string) => Date.parse(iso)

function rowsOf(lines: readonly string[]): TaskRow[] {
  return [...readRegister(lines.join('\n')).state.tasks.values()].map(task => rowOf(task))
}

/** The tasks the snapshot holds: T855's title fits a shared title, T780's is cut in one. */
const TASKS = rowsOf([
  createLine('T855', { owner: 'lead', by: 'lead', at: NOW - DAY, title: 'Pane: a readable Log view' }),
  createLine('T780', { owner: 'lead', by: 'lead', at: NOW - DAY, title: 'Pane: a Team tab showing the team tree: teams, sessions, roles and leads' }),
])
/** No work marks: every conversation is titled by how it opened. */
const IDLE: Worked = { work: [], tasks: TASKS }

function conversation(session: string, claude: string, firstAt: string, lastAt: string, more: Partial<LogConversation> = {}): LogConversation {
  return { session, claude, firstAt: at(firstAt), lastAt: at(lastAt), nextAt: null, lines: 2, opening: null, ...more }
}

function entry(when: string, kind: TurnEntry['kind'], text: string, isCut = false): TurnEntry {
  return { at: when, kind, text, claude: 'c-1', isCut }
}

function page(entries: TurnEntry[], more: Partial<LogPage> = {}): LogPage {
  return { session: 'lead', claude: 'c-1', hours: 24, entries, isCut: false, problem: null, ...more }
}

/** A page's blocks under a list that does not hold its conversation: its head is the session's name. */
const pageOf = (shown: LogPage, clock = UTC) => logPageBlocks(shown, clock, { kind: 'reading' }, IDLE)

describe('logListBlocks', () => {
  test('each conversation is a press that opens its page: the tasks its session worked during it, over its session, times and lines', () => {
    const list: LogList = {
      kind: 'conversations',
      hours: 24,
      conversations: [
        conversation('lead', 'c-2', '2026-10-19T20:10:00Z', '2026-10-19T20:20:00Z'),
        conversation('api', 'c-9', '2026-10-19T19:45:00Z', '2026-10-19T19:55:00Z'),
        conversation('lead', 'c-1', '2026-10-19T19:00:00Z', '2026-10-19T20:05:00Z', { nextAt: at('2026-10-19T20:10:00Z'), lines: 4 }),
      ],
    }
    const worked: Worked = {
      tasks: TASKS,
      work: [
        // Before lead's first conversation began: no conversation's work.
        { session: 'lead', task: 'T780', at: at('2026-10-19T18:00:00Z') },
        { session: 'lead', task: 'T855', at: at('2026-10-19T19:30:00Z') },
        // As c-2 begins: c-2's, never c-1's.
        { session: 'lead', task: 'T780', at: at('2026-10-19T20:10:00Z') },
        { session: 'lead', task: 'T855', at: at('2026-10-19T20:12:00Z') },
        { session: 'lead', task: 'T780', at: at('2026-10-19T20:15:00Z') },
        // A task the snapshot does not hold shows its id alone; another session's work never titles lead's.
        { session: 'api', task: 'T999', at: at('2026-10-19T19:50:00Z') },
      ],
    }
    const blocks = logListBlocks(list, UTC, worked)
    expect(words(blocks)).toEqual([
      ['log:intro', ['Each conversation of the last 24 h, titled by the task it worked, the newest first.']],
      ['log:conv:lead:c-2', ['T780 Pane: a Team tab showing the team tree: teams,… · T855 Pane: a readable Log view', 'lead · 20:10 UTC–20:20 UTC · 2 lines']],
      ['log:conv:api:c-9', ['T999', 'api · 19:45 UTC–19:55 UTC · 2 lines']],
      ['log:conv:lead:c-1', ['T855 Pane: a readable Log view', 'lead · 19:00 UTC–20:05 UTC · 4 lines']],
    ])
    expect(blocks[1]?.reads).toEqual({ session: 'lead', claude: 'c-2' })
    expect(blocks[1]?.key).toBe(conversationKey({ session: 'lead', claude: 'c-2' }))
    expect(blocks[1]?.rows[0]?.maxLines).toBe(2)
    expect(blocks[1]?.rows[0]?.spans[0]).toEqual({ text: 'T780', bold: true })
    expect(blocks[1]?.rows[1]?.key).toBe('log:conv:lead:c-2:what')
    expect(blocks[1]?.rows[1]?.spans[0]?.dim).toBe(true)
  })

  test("a conversation with no work is titled by how it opened: the owner's words plain, Claude's dim, else says it holds neither", () => {
    const blocks = logListBlocks(
      {
        kind: 'conversations',
        hours: 24,
        conversations: [
          conversation('lead', 'c-1', '2026-10-19T20:05:00Z', '2026-10-19T20:05:00Z', { lines: 1, opening: { by: 'owner', line: 'plan the week' } }),
          conversation('api', 'c-2', '2026-10-18T22:40:00Z', '2026-10-19T19:00:00Z', { opening: { by: 'claude', line: 'done' } }),
          conversation('web', 'c-3', '2026-10-19T19:00:00Z', '2026-10-19T19:01:00Z'),
        ],
      },
      UTC,
      IDLE,
    )
    // One time when the first and last lines share it; a day before today's shows its day.
    expect(words(blocks).slice(1)).toEqual([
      ['log:conv:lead:c-1', ['plan the week', 'lead · 20:05 UTC · 1 line']],
      ['log:conv:api:c-2', ['done', 'api · Sun 10-18 22:40 UTC–19:00 UTC · 2 lines']],
      ['log:conv:web:c-3', ['no prompt or reply', 'web · 19:00 UTC–19:01 UTC · 2 lines']],
    ])
    expect(blocks[1]?.rows[0]?.spans).toEqual([{ text: 'plan the week' }])
    expect(blocks[2]?.rows[0]?.spans).toEqual([{ text: 'done', dim: true }])
    expect(blocks[3]?.rows[0]?.spans).toEqual([{ text: 'no prompt or reply', dim: true }])
  })

  test('says why it lists none: reading, no team, a team with no config, no turn logs, a failed read, or no conversation in the window', () => {
    const note = (list: LogList) => words(logListBlocks(list, UTC, IDLE))
    expect(note({ kind: 'reading' })).toEqual([['log:note', ['Reading the turn logs…']]])
    expect(note({ kind: 'no-team' })[0]?.[1][0]).toMatch(/^No team found/)
    expect(note({ kind: 'no-config' })).toEqual([['log:note', ['No turn logs: the team has no config file, and teamrig writes turn logs only for a team with one.']]])
    expect(note({ kind: 'no-log' })[0]?.[1][0]).toMatch(/^No turn logs yet: a teamrig with the turn log writes/)
    expect(note({ kind: 'failed', reason: 'EPERM: denied.' })).toEqual([['log:note', ['The turn logs could not be read: EPERM: denied.']]])
    expect(logListBlocks({ kind: 'failed', reason: 'x' }, UTC, IDLE)[0]?.rows[0]?.spans[0]?.color).toBe('warning')
    expect(note({ kind: 'conversations', hours: 24, conversations: [] })).toEqual([['log:note', ['No session wrote a prompt or a reply in the last 24 h.']]])
  })

  test("prints the hours teamrig keeps the team's turn log, the list's window", () => {
    const kept = (conversations: LogConversation[]) => words(logListBlocks({ kind: 'conversations', hours: 2, conversations }, UTC, IDLE))
    expect(kept([conversation('api', 'c-1', '2026-10-19T19:00:00Z', '2026-10-19T19:00:00Z', { lines: 1 })])).toEqual([
      ['log:intro', ['Each conversation of the last 2 h, titled by the task it worked, the newest first.']],
      ['log:conv:api:c-1', ['no prompt or reply', 'api · 19:00 UTC · 1 line']],
    ])
    expect(kept([])).toEqual([['log:note', ['No session wrote a prompt or a reply in the last 2 h.']]])
  })

  test('while the Find field holds a query, the list draws the search: the hint, nothing found, or the count and the conversations it names', () => {
    const list: LogList = {
      kind: 'conversations',
      hours: 24,
      conversations: [
        conversation('lead', 'c-1', '2026-10-19T20:05:00Z', '2026-10-19T20:05:00Z', { lines: 1, opening: { by: 'owner', line: 'plan the week' } }),
        conversation('api', 'c-2', '2026-10-19T19:00:00Z', '2026-10-19T19:01:00Z'),
      ],
    }
    const searched = (query: string) => logListBlocks(list, UTC, IDLE, { query, hits: searchLog(list, IDLE, query) })
    expect(words(searched(' '))).toEqual([['log-search-hint', [LOG_SEARCH_HINT]]])
    expect(words(searched('nothing'))).toEqual([['log-search-none', ['Nothing matches. The Log view searches its conversations of the last 24 h.']]])
    const week = searched('week')
    expect(words(week)).toEqual([
      ['log-search-count', ['1 conversation matches']],
      ['log-search:lead:c-1', ['plan the week', 'lead · 20:05 UTC · 1 line']],
    ])
    // A result opens its conversation's page, as the list's row does, the words that matched underlined.
    expect(week[1]?.reads).toEqual({ session: 'lead', claude: 'c-1' })
    expect(week[1]?.rows[0]?.spans).toEqual([{ text: 'plan the ' }, { text: 'week', underline: true }])
    // A session's name matches on the line under the title, which keeps its dim style.
    const api = searched('api')
    expect(words(api).slice(1)).toEqual([['log-search:api:c-2', ['no prompt or reply', 'api · 19:00 UTC–19:01 UTC · 2 lines']]])
    expect(api[1]?.rows[1]?.key).toBe('log-search:api:c-2:what')
    expect(api[1]?.rows[1]?.spans).toEqual([
      { text: 'api', dim: true, underline: true },
      { text: ' · 19:00 UTC–19:01 UTC · 2 lines', dim: true },
    ])
  })
})

describe('logPageBlocks', () => {
  test("heads the page with the session and its count, then each prompt's and reply's speaker over its text, a paragraph a block", () => {
    const blocks = pageOf(
      page([
        entry('2026-10-18T23:10:00Z', 'prompt', 'ship T587'),
        entry('2026-10-19T20:01:00Z', 'reply', 'Done:\n  - reader\n\nNext: tests', true),
        entry('2026-10-19T20:02:00Z', 'clear', 'context compacted'),
      ]),
    )
    expect(words(blocks)).toEqual([
      ['log-page', ['lead', 'last 24 h · 3 lines, the newest last']],
      ['log-page:2026-10-18T23:10:00Z:prompt', ['owner · Sun 10-18 23:10 UTC', 'ship T587']],
      ['log-page:2026-10-19T20:01:00Z:reply', ['Claude · 20:01 UTC · cut, its end kept', 'Done:', '  • reader']],
      ['log-page:2026-10-19T20:01:00Z:reply:para:4', ['Next: tests']],
      ['log-page:2026-10-19T20:02:00Z:clear', ['── 20:02 UTC · context compacted ──']],
    ])
    // An item's bullet is drawn and its wrapped lines start under its words; each line's key names its entry and its line.
    expect(blocks[2]?.rows[2]).toEqual({ key: 'log-page:2026-10-19T20:01:00Z:reply:line:2', spans: [{ text: '  • ' }, { text: 'reader' }], hang: { text: '    ' } })
    expect(blocks[1]?.rows[0]?.spans[0]).toEqual({ text: 'owner', bold: true, color: 'suggestion' })
    expect(blocks[2]?.rows[0]?.spans[0]).toEqual({ text: 'Claude', bold: true, color: 'claude' })
  })

  test('a conversation the list holds heads its page with its title as the list draws it, over its session and count', () => {
    const list: LogList = { kind: 'conversations', hours: 24, conversations: [conversation('lead', 'c-1', '2026-10-19T20:00:00Z', '2026-10-19T20:01:00Z')] }
    const worked: Worked = { tasks: TASKS, work: [{ session: 'lead', task: 'T855', at: at('2026-10-19T20:00:30Z') }] }
    const shown = page([entry('2026-10-19T20:01:00Z', 'prompt', 'a')])
    expect(words(logPageBlocks(shown, UTC, list, worked))[0]).toEqual(['log-page', ['T855 Pane: a readable Log view', 'lead · last 24 h · 1 line, the newest last']])
    // Another conversation of the session is not this page's.
    expect(words(logPageBlocks({ ...shown, claude: 'c-2' }, UTC, list, worked))[0]).toEqual(['log-page', ['lead', 'last 24 h · 1 line, the newest last']])
  })

  test("logPageTitle is the page's title as its head draws it, for the trail over the page: the list's, else the session's name bold", () => {
    const list: LogList = { kind: 'conversations', hours: 24, conversations: [conversation('lead', 'c-1', '2026-10-19T20:00:00Z', '2026-10-19T20:01:00Z')] }
    const worked: Worked = { tasks: TASKS, work: [{ session: 'lead', task: 'T855', at: at('2026-10-19T20:00:30Z') }] }
    const shown = page([entry('2026-10-19T20:01:00Z', 'prompt', 'a')])
    expect(logPageTitle(shown, list, worked)).toEqual([{ text: 'T855', bold: true }, { text: ' Pane: a readable Log view' }])
    expect(logPageTitle({ ...shown, claude: 'c-2' }, list, worked)).toEqual([{ text: 'lead', bold: true }])
    expect(logPageTitle(shown, { kind: 'reading' }, worked)).toEqual([{ text: 'lead', bold: true }])
  })

  test("splits a prompt by who spoke: a harness notice is dim lines led by its time, each other voice a head over its words, the cut mark on the first part", () => {
    const text = [
      '<task-notification>',
      '<task-id>b1</task-id>',
      '<summary>Background command "tests" completed</summary>',
      '</task-notification>',
      'ship it',
      '<cross-session-message from="s-9" from-name="teamrig">merge T855 now</cross-session-message>',
      '<system-reminder>Stop hook blocking error from command "SessionStart:clear": read your handover',
      '',
      'then carry on</system-reminder>',
      '<agent-message>',
      '[Subagent hand-back] the report',
      '  found 2',
      '</agent-message>',
    ].join('\n')
    const blocks = pageOf(page([entry('2026-10-19T20:01:00Z', 'prompt', text, true)]))
    const key = 'log-page:2026-10-19T20:01:00Z:prompt'
    expect(words(blocks).slice(1)).toEqual([
      [key, ['20:01 UTC · cut, its end kept · Background command "tests" completed']],
      [`${key}:part:1`, ['owner · 20:01 UTC', 'ship it']],
      [`${key}:part:2`, ['message from teamrig · 20:01 UTC', 'merge T855 now']],
      [`${key}:part:3`, ['20:01 UTC · Stop hook "SessionStart:clear": read your handover']],
      [`${key}:part:3:para:3`, ['then carry on']],
      [`${key}:part:4`, ['subagent report · 20:01 UTC', 'found 2']],
    ])
    expect(blocks[1]?.rows[0]?.spans.at(0)).toEqual({ text: '20:01 UTC', dim: true })
    expect(blocks[1]?.rows[0]?.spans.at(-1)).toEqual({ text: 'Background command "tests" completed', dim: true })
    expect(blocks[5]?.rows[0]).toEqual({ key: `${key}:part:3:line:3`, spans: [{ text: 'then carry on', dim: true }] })
    expect(blocks[3]?.rows[0]?.spans[0]).toEqual({ text: 'message from teamrig', bold: true, color: 'warning' })
    expect(blocks[6]?.rows[0]?.spans[0]).toEqual({ text: 'subagent report', bold: true, color: 'subtle' })
  })

  test('two lines of one time and kind keep keys of their own; an empty text is its head alone; an unreadable time shows as written', () => {
    const blocks = pageOf(page([entry('2026-10-19T20:01:00Z', 'reply', 'a'), entry('2026-10-19T20:01:00Z', 'reply', ''), entry('soon', 'prompt', 'b')]))
    expect(words(blocks).slice(1)).toEqual([
      ['log-page:2026-10-19T20:01:00Z:reply', ['Claude · 20:01 UTC', 'a']],
      ['log-page:2026-10-19T20:01:00Z:reply:1', ['Claude · 20:01 UTC']],
      ['log-page:soon:prompt', ['owner · soon', 'b']],
    ])
  })

  test("prints each time on the team's clock, zone-marked, and today is the zone's day", () => {
    const blocks = pageOf(page([entry('2026-10-18T20:00:00Z', 'prompt', 'a'), entry('2026-10-18T23:10:00Z', 'reply', 'b')]), JERUSALEM)
    // 23:10 UTC on 10-18 is 02:10 IDT on 10-19, the zone's day of NOW, so it shows its time alone.
    expect(words(blocks).slice(1)).toEqual([
      ['log-page:2026-10-18T20:00:00Z:prompt', ['owner · Sun 10-18 23:00 IDT', 'a']],
      ['log-page:2026-10-18T23:10:00Z:reply', ['Claude · 02:10 IDT', 'b']],
    ])
    const list = logListBlocks({ kind: 'conversations', hours: 24, conversations: [conversation('lead', 'c-1', '2026-10-19T20:05:00Z', '2026-10-19T20:05:00Z', { lines: 1 })] }, JERUSALEM, IDLE)
    expect(words(list)[1]?.[1][1]).toBe('lead · 23:05 IDT · 1 line')
  })

  test("notes the lines its cap leaves out and a file it could not read; an empty page says so, in the team's kept hours", () => {
    const cut = pageOf(page([entry('2026-10-19T20:01:00Z', 'prompt', 'a')], { isCut: true, problem: 'x.jsonl: EBUSY.' }))
    expect(words(cut).slice(0, 3)).toEqual([
      ['log-page', ['lead', 'last 24 h · 1 line, the newest last']],
      ['log-page:cut', ['Older lines left out: the page holds the newest 256 KiB of text.']],
      ['log-page:problem', ['Not all read: x.jsonl: EBUSY.']],
    ])
    expect(words(pageOf(page([], { problem: 'gone' })))).toEqual([
      ['log-page', ['lead', 'last 24 h · 0 lines, the newest last']],
      ['log-page:problem', ['Not all read: gone.']],
      ['log-page:empty', ['Nothing in the last 24 h.']],
    ])
    expect(words(pageOf(page([], { hours: 2 })))).toEqual([
      ['log-page', ['lead', 'last 2 h · 0 lines, the newest last']],
      ['log-page:empty', ['Nothing in the last 2 h.']],
    ])
  })
})
