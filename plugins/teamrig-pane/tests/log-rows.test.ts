// The Log view as rows (hooks/log-rows.ts): the sessions list, each a press that opens its page, the notes for a
// list it cannot show, and a session's page: its head, a note for what it leaves out, and each line's blocks.
import { describe, expect, test } from 'claude-code/testing'
import type { LogPage, LogSession, TurnEntry } from '../types'
import { logListBlocks, logPageBlocks, sessionKey } from '../hooks/log-rows'
import type { Block } from '../hooks/rows'
import { clockOf } from '../hooks/zone'

const NOW = Date.parse('2026-10-19T20:30:00Z')
/** NOW on UTC's clock, and on Jerusalem's: Mon 10-19 23:30 IDT. */
const UTC = clockOf({ now: NOW, timeZone: 'UTC' })
const JERUSALEM = clockOf({ now: NOW, timeZone: 'Asia/Jerusalem' })
/** Each block as its key and its rows' words. */
const words = (blocks: Block[]): [string, string[]][] => blocks.map(block => [block.key, block.rows.map(row => row.spans.map(span => span.text).join(''))])

function entry(at: string, kind: TurnEntry['kind'], text: string, isCut = false): TurnEntry {
  return { at, kind, text, claude: 'c-1', isCut }
}

function page(entries: TurnEntry[], more: Partial<LogPage> = {}): LogPage {
  return { session: 'lead', hours: 24, entries, isCut: false, problem: null, ...more }
}

describe('logListBlocks', () => {
  test('each session is a press that opens its page: its id and when its log changed, over its newest prompt in two lines at most', () => {
    const blocks = logListBlocks(
      {
        kind: 'sessions',
        hours: 24,
        sessions: [
          { id: 'lead', changedAt: Date.parse('2026-10-19T20:05:00Z'), lastPrompt: 'plan the week' },
          { id: 'api', changedAt: Date.parse('2026-10-18T22:40:00Z'), lastPrompt: null },
        ],
      },
      UTC,
    )
    expect(words(blocks)).toEqual([
      ['log:intro', ["Each session's prompts and replies of the last 24 h, the newest change first."]],
      ['log:session:lead', ['lead · 20:05 UTC', 'plan the week']],
      ['log:session:api', ['api · Sun 10-18 22:40 UTC', 'no prompt in the last 24 h']],
    ])
    expect(blocks[1]?.reads).toBe('lead')
    expect(blocks[1]?.key).toBe(sessionKey('lead'))
    expect(blocks[1]?.rows[1]?.maxLines).toBe(2)
  })

  test('says why it lists none: reading, no team, a team with no config, no turn logs, a failed read, or no session in the window', () => {
    const note = (list: Parameters<typeof logListBlocks>[0]) => words(logListBlocks(list, UTC))
    expect(note({ kind: 'reading' })).toEqual([['log:note', ['Reading the turn logs…']]])
    expect(note({ kind: 'no-team' })[0]?.[1][0]).toMatch(/^No team found/)
    expect(note({ kind: 'no-config' })).toEqual([['log:note', ['No turn logs: the team has no config file, and teamrig writes turn logs only for a team with one.']]])
    expect(note({ kind: 'no-log' })[0]?.[1][0]).toMatch(/^No turn logs yet: a teamrig with the turn log writes/)
    expect(note({ kind: 'failed', reason: 'EPERM: denied.' })).toEqual([['log:note', ['The turn logs could not be read: EPERM: denied.']]])
    expect(logListBlocks({ kind: 'failed', reason: 'x' }, UTC)[0]?.rows[0]?.spans[0]?.color).toBe('warning')
    expect(note({ kind: 'sessions', hours: 24, sessions: [] })).toEqual([['log:note', ['No session wrote a prompt or a reply in the last 24 h.']]])
  })

  test("prints the hours teamrig keeps the team's turn log, the list's window", () => {
    const kept = (sessions: LogSession[]) => words(logListBlocks({ kind: 'sessions', hours: 2, sessions }, UTC))
    expect(kept([{ id: 'api', changedAt: Date.parse('2026-10-19T19:00:00Z'), lastPrompt: null }])).toEqual([
      ['log:intro', ["Each session's prompts and replies of the last 2 h, the newest change first."]],
      ['log:session:api', ['api · 19:00 UTC', 'no prompt in the last 2 h']],
    ])
    expect(kept([])).toEqual([['log:note', ['No session wrote a prompt or a reply in the last 2 h.']]])
  })
})

describe('logPageBlocks', () => {
  test("heads the page with the session and its count, then each prompt's and reply's speaker over its text, a paragraph a block", () => {
    const blocks = logPageBlocks(
      page([
        entry('2026-10-18T23:10:00Z', 'prompt', 'ship T587'),
        entry('2026-10-19T20:01:00Z', 'reply', 'Done:\n  - reader\n\nNext: tests', true),
        entry('2026-10-19T20:02:00Z', 'clear', 'context cleared (/clear)'),
      ]),
      UTC,
    )
    expect(words(blocks)).toEqual([
      ['log-page', ['lead', 'last 24 h · 3 lines, the newest last']],
      ['log-page:2026-10-18T23:10:00Z:prompt', ['owner · Sun 10-18 23:10 UTC', 'ship T587']],
      ['log-page:2026-10-19T20:01:00Z:reply', ['Claude · 20:01 UTC · cut, its end kept', 'Done:', '  • reader']],
      ['log-page:2026-10-19T20:01:00Z:reply:para:4', ['Next: tests']],
      ['log-page:2026-10-19T20:02:00Z:clear', ['── 20:02 UTC · context cleared (/clear) ──']],
    ])
    // An item's bullet is drawn and its wrapped lines start under its words; each line's key names its entry and its line.
    expect(blocks[2]?.rows[2]).toEqual({ key: 'log-page:2026-10-19T20:01:00Z:reply:line:2', spans: [{ text: '  • ' }, { text: 'reader' }], hang: { text: '    ' } })
    expect(blocks[1]?.rows[0]?.spans[0]).toEqual({ text: 'owner', bold: true, color: 'suggestion' })
    expect(blocks[2]?.rows[0]?.spans[0]).toEqual({ text: 'Claude', bold: true, color: 'claude' })
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
    const blocks = logPageBlocks(page([entry('2026-10-19T20:01:00Z', 'prompt', text, true)]), UTC)
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
    const blocks = logPageBlocks(
      page([entry('2026-10-19T20:01:00Z', 'reply', 'a'), entry('2026-10-19T20:01:00Z', 'reply', ''), entry('soon', 'prompt', 'b')]),
      UTC,
    )
    expect(words(blocks).slice(1)).toEqual([
      ['log-page:2026-10-19T20:01:00Z:reply', ['Claude · 20:01 UTC', 'a']],
      ['log-page:2026-10-19T20:01:00Z:reply:1', ['Claude · 20:01 UTC']],
      ['log-page:soon:prompt', ['owner · soon', 'b']],
    ])
  })

  test("prints each time on the team's clock, zone-marked, and today is the zone's day", () => {
    const blocks = logPageBlocks(
      page([entry('2026-10-18T20:00:00Z', 'prompt', 'a'), entry('2026-10-18T23:10:00Z', 'reply', 'b')]),
      JERUSALEM,
    )
    // 23:10 UTC on 10-18 is 02:10 IDT on 10-19, the zone's day of NOW, so it shows its time alone.
    expect(words(blocks).slice(1)).toEqual([
      ['log-page:2026-10-18T20:00:00Z:prompt', ['owner · Sun 10-18 23:00 IDT', 'a']],
      ['log-page:2026-10-18T23:10:00Z:reply', ['Claude · 02:10 IDT', 'b']],
    ])
    const list = logListBlocks({ kind: 'sessions', hours: 24, sessions: [{ id: 'lead', changedAt: Date.parse('2026-10-19T20:05:00Z'), lastPrompt: null }] }, JERUSALEM)
    expect(words(list)[1]?.[1][0]).toBe('lead · 23:05 IDT')
  })

  test("notes the lines its cap leaves out and a file it could not read; an empty page says so, in the team's kept hours", () => {
    const cut = logPageBlocks(page([entry('2026-10-19T20:01:00Z', 'prompt', 'a')], { isCut: true, problem: 'x.jsonl: EBUSY.' }), UTC)
    expect(words(cut).slice(0, 3)).toEqual([
      ['log-page', ['lead', 'last 24 h · 1 line, the newest last']],
      ['log-page:cut', ['Older lines left out: the page holds the newest 256 KiB of text.']],
      ['log-page:problem', ['Not all read: x.jsonl: EBUSY.']],
    ])
    expect(words(logPageBlocks(page([], { problem: 'gone' }), UTC))).toEqual([
      ['log-page', ['lead', 'last 24 h · 0 lines, the newest last']],
      ['log-page:problem', ['Not all read: gone.']],
      ['log-page:empty', ['Nothing in the last 24 h.']],
    ])
    expect(words(logPageBlocks(page([], { hours: 2 }), UTC))).toEqual([
      ['log-page', ['lead', 'last 2 h · 0 lines, the newest last']],
      ['log-page:empty', ['Nothing in the last 2 h.']],
    ])
  })
})
