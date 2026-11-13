// The Meetings view as rows (hooks/meetings-rows.ts): a header counting the meetings and the missed ones, what the last
// start press answered, each meeting a row marked by where it stands with a dim about line under it, a press on the
// row opening its card (about, with, tasks, brief and a scheduled one's [Start meeting] press), and the notes for a
// list it cannot show. A done or dropped meeting shows on the team's day only (T2455).
import { describe, expect, test } from 'claude-code/testing'
import type { Meeting, MeetingsView } from '../types'
import { TimeZone } from '../hooks/core/read/index'
import { dockLayout } from '../hooks/layout'
import { MEETING_MARK, NO_MEETINGS, START_TEXT, meetingKey, meetingsBlocks } from '../hooks/meetings-rows'
import type { Block, Row } from '../hooks/rows'
import { cells } from '../hooks/width'
import { zoneNamed, type Clock } from '../hooks/zone'
import { HOUR, NOW, createLine } from './fixtures'
import { tasksOf } from './team-fixtures'

/** Each block as its key and its rows' words. */
const words = (blocks: Block[]): [string, string[]][] => blocks.map(block => [block.key, block.rows.map(textOf)])
const textOf = (row: Row): string => row.spans.map(span => span.text).join('')
const TASKS = tasksOf(createLine('T7', { owner: 'api', by: 'lead', at: NOW - HOUR, title: 'Ship the meetings view' }))

function meeting(id: string, at: number, atText: string, extra: Partial<Meeting> = {}): Meeting {
  return { id, at, atText, minutes: 30, session: 'api', with: ['lead'], tasks: [], about: `About ${id}`, brief: null, status: 'scheduled', missed: false, ...extra }
}

const STARTED = meeting('M1', NOW - HOUR, 'Tue 10-13 13:00', { status: 'started', tasks: ['T7'] })
const MISSED = meeting('M2', NOW - HOUR / 2, 'Tue 10-13 13:30', { missed: true, with: [] })
const NEXT = meeting('M3', NOW + HOUR, 'Tue 10-13 15:00', { with: ['lead', 'po'], tasks: ['T7', 'T99'], about: 'Review the pane\nand its keys', brief: 'briefs/M3.md' })
const LATER = meeting('M4', NOW + 3 * HOUR, 'Tue 10-13 17:00', { minutes: 15 })
const LIST: MeetingsView = { kind: 'list', meetings: [STARTED, MISSED, NEXT, LATER], unreadable: 0 }
/** Tue 10-13 14:00 UTC, the team's clock in UTC. */
const CLOCK: Clock = { now: NOW, zone: TimeZone.UTC }
/** Held this morning (10-13 09:00 UTC), with three sessions. */
const HELD = meeting('M5', NOW - 5 * HOUR, 'Tue 10-13 09:00', { status: 'done', with: ['lead', 'po', 'ui'], tasks: ['T7'] })
/** Dropped at noon today. */
const DROPPED = meeting('M6', NOW - 2 * HOUR, 'Tue 10-13 12:00', { status: 'dropped', minutes: 10 })
/** Held yesterday, 10-12 23:00 UTC: 10-13 08:00 on a UTC+9 clock. */
const YESTERDAY = meeting('M7', NOW - 15 * HOUR, 'Mon 10-12 23:00', { status: 'done' })
const DAY: MeetingsView = { kind: 'list', meetings: [YESTERDAY, HELD, DROPPED, STARTED, NEXT], unreadable: 0 }

function blockOf(blocks: Block[], key: string): Block {
  const block = blocks.find(found => found.key === key)
  if (block === undefined) throw new Error(`no block ${key}`)
  return block
}

describe('meetingsBlocks', () => {
  test('a header counting the meetings and the missed, then a row each by time, its standing marked, a dim about line under it', () => {
    expect(words(meetingsBlocks(LIST, [], null, TASKS, CLOCK))).toEqual([
      ['meetings:header', ['4 meetings · 1 missed']],
      ['meeting:M1', ['◐ M1  Tue 10-13 13:00 · 30 min · api with lead · started', '      About M1 · T7']],
      ['meeting:M2', ['! M2  Tue 10-13 13:30 · 30 min · api · missed', '      About M2']],
      ['meeting:M3', ['› M3  Tue 10-13 15:00 · 30 min · api with lead, po · next', '      Review the pane and its keys · T7, T99']],
      ['meeting:M4', ['○ M4  Tue 10-13 17:00 · 15 min · api with lead', '      About M4']],
    ])
  })

  test('the header is ruled, its missed count red; each row a press that opens its card', () => {
    const blocks = meetingsBlocks(LIST, [], null, TASKS, CLOCK)
    const header = blockOf(blocks, 'meetings:header').rows[0]
    expect(header?.rule).toBe(true)
    expect(header?.spans.at(-1)).toEqual({ text: '1 missed', color: 'error' })
    expect(blocks.slice(1).map(block => block.folds)).toEqual(['meeting:M1', 'meeting:M2', 'meeting:M3', 'meeting:M4'])
    expect(blockOf(blocks, 'meeting:M3').rows[0]?.spans[0]).toEqual({ text: MEETING_MARK.next, color: 'claude' })
    expect(blockOf(blocks, 'meeting:M2').rows[0]?.spans.at(-1)).toEqual({ text: 'missed', color: 'error' })
  })

  test('the next meeting says now once its time came; with no missed one the header counts the meetings alone', () => {
    const shown = meetingsBlocks({ kind: 'list', meetings: [NEXT, LATER], unreadable: 0 }, [], null, TASKS, { now: NEXT.at, zone: TimeZone.UTC })
    expect(words(shown).map(([, rows]) => rows[0])).toEqual([
      '2 meetings',
      '› M3  Tue 10-13 15:00 · 30 min · api with lead, po · now',
      '○ M4  Tue 10-13 17:00 · 15 min · api with lead',
    ])
  })

  test("an open meeting's card: what it is about, who joins, each task with its title and status, its brief and a scheduled one's start press", () => {
    const block = blockOf(meetingsBlocks(LIST, [meetingKey('M3')], null, TASKS, CLOCK), 'meeting:M3')
    expect(block.rows.map(textOf)).toEqual(['› M3  Tue 10-13 15:00 · 30 min · api with lead, po · next'])
    const hang = `    │ ${' '.repeat(13)}`
    expect(block.card?.map(textOf)).toEqual([
      '    │ About        Review the pane',
      `${hang}and its keys`,
      '    │ With         lead, po',
      '    │ Tasks        T7 Ship the meetings view · not started',
      `${hang}T99 not in the register the pane reads`,
      '    │ Brief        briefs/M3.md',
      `    │ ${START_TEXT}`,
    ])
    const spans = block.card?.flatMap(row => row.spans) ?? []
    expect(spans.filter(span => span.task !== undefined).map(span => span.task)).toEqual(['T7'])
    expect(spans.filter(span => span.file !== undefined).map(span => span.file)).toEqual([{ file: 'briefs/M3.md', line: null }])
    expect(spans.filter(span => span.starts !== undefined)).toEqual([{ text: START_TEXT, color: 'claude', starts: 'M3' }])
  })

  test('a started meeting has no start press; a meeting with no one joining, no tasks and no brief shows its about alone', () => {
    const blocks = meetingsBlocks(LIST, [meetingKey('M1'), meetingKey('M2')], null, TASKS, CLOCK)
    expect(blockOf(blocks, 'meeting:M1').card?.map(textOf)).toEqual([
      '    │ About        About M1',
      '    │ With         lead',
      '    │ Tasks        T7 Ship the meetings view · not started',
    ])
    expect(blockOf(blocks, 'meeting:M2').card?.map(textOf)).toEqual(['    │ About        About M2', `    │ ${START_TEXT}`])
  })

  test('docked, the start press is a piece of its own, and the head folds the card', () => {
    const [drawn] = dockLayout([blockOf(meetingsBlocks(LIST, [meetingKey('M3')], null, TASKS, CLOCK), 'meeting:M3')], 50)
    expect(drawn?.folds).toBe('meeting:M3')
    const pieces = drawn?.card?.flatMap(part => (part.kind === 'line' ? part.pieces : [])) ?? []
    expect(pieces.filter(piece => piece.kind === 'start')).toEqual([{ kind: 'start', span: { text: START_TEXT, color: 'claude', starts: 'M3' }, starts: 'M3' }])
  })

  test("what the last start press answered leads the list, under the header: starting, started with teamrig's lines, or why it refused", () => {
    const told = (start: Parameters<typeof meetingsBlocks>[2]) => words(meetingsBlocks(LIST, [], start, TASKS, CLOCK))[1]
    expect(told({ id: 'M3', outcome: 'starting', lines: [] })).toEqual(['meetings:start', ['Starting M3…']])
    expect(told({ id: 'M3', outcome: 'started', lines: ['TOLD lead, po'] })).toEqual(['meetings:start', ['Started M3.', '  TOLD lead, po']])
    expect(told({ id: 'M3', outcome: 'refused', lines: ['meeting M3 is started, not scheduled'] })).toEqual([
      'meetings:start',
      ['M3 did not start:', '  meeting M3 is started, not scheduled'],
    ])
    const refused = blockOf(meetingsBlocks(LIST, [], { id: 'M3', outcome: 'refused', lines: ['no'] }, TASKS, CLOCK), 'meetings:start')
    expect(refused.rows.map(row => row.spans[0]?.color)).toEqual(['warning', 'warning'])
  })

  test('an empty schedule says how to book one; meetings in a newer format are counted in a warning', () => {
    expect(words(meetingsBlocks({ kind: 'list', meetings: [], unreadable: 0 }, [], null, TASKS, CLOCK))).toEqual([
      ['meetings:header', ['0 meetings']],
      ['meetings:note', [NO_MEETINGS]],
    ])
    expect(words(meetingsBlocks({ kind: 'list', meetings: [LATER], unreadable: 2 }, [], null, TASKS, CLOCK)).slice(0, 2)).toEqual([
      ['meetings:header', ['1 meeting']],
      ['meetings:unreadable', ['WARN 2 meetings teamrig printed are in a newer format: update the pane.']],
    ])
  })

  test('a list it cannot show says why: still reading, no team, or what failed', () => {
    expect(words(meetingsBlocks({ kind: 'reading' }, [], null, TASKS, CLOCK))).toEqual([['meetings:note', ['Reading the meetings…']]])
    expect(words(meetingsBlocks({ kind: 'no-team' }, [], null, TASKS, CLOCK))).toEqual([
      ['meetings:note', ["No team found: the Meetings view lists the meetings of the session's team."]],
    ])
    expect(words(meetingsBlocks({ kind: 'failed', reason: 'teamrig meeting list exited 2.' }, [], null, TASKS, CLOCK))).toEqual([
      ['meetings:note', ['The meetings could not be read: teamrig meeting list exited 2.']],
    ])
  })

  test("the day's whole schedule: today's done and dropped meetings by time among those to come, dim, an earlier day's left out", () => {
    const blocks = meetingsBlocks(DAY, [], null, TASKS, CLOCK)
    expect(words(blocks)).toEqual([
      ['meetings:header', ['4 meetings']],
      ['meeting:M5', ['● M5  Tue 10-13 09:00 · 30 min · api with lead, po, ui · done', '      About M5 · T7']],
      ['meeting:M6', ['× M6  Tue 10-13 12:00 · 10 min · api with lead · dropped', '      About M6']],
      ['meeting:M1', ['◐ M1  Tue 10-13 13:00 · 30 min · api with lead · started', '      About M1 · T7']],
      ['meeting:M3', ['› M3  Tue 10-13 15:00 · 30 min · api with lead, po · next', '      Review the pane and its keys · T7, T99']],
    ])
    const head = blockOf(blocks, 'meeting:M5').rows[0]
    expect([head?.spans[0], head?.spans.at(-1)]).toEqual([{ text: MEETING_MARK.done, dim: true }, { text: 'done', dim: true }])
    expect(blockOf(blocks, 'meeting:M6').rows[0]?.spans.at(-1)).toEqual({ text: 'dropped', dim: true })
  })

  test("the day is the team's: on a UTC+9 clock yesterday's 23:00 UTC meeting was held this morning", () => {
    const tokyo = meetingsBlocks(DAY, [], null, TASKS, { now: NOW, zone: zoneNamed('Asia/Tokyo') })
    expect(words(tokyo).map(([key]) => key)).toEqual(['meetings:header', 'meeting:M7', 'meeting:M5', 'meeting:M6', 'meeting:M1', 'meeting:M3'])
  })

  test("a done or dropped meeting's card has no start press; a day with only an earlier day's meetings says how to book one", () => {
    const blocks = meetingsBlocks(DAY, [meetingKey('M5'), meetingKey('M6')], null, TASKS, CLOCK)
    expect(blockOf(blocks, 'meeting:M5').card?.map(textOf)).toEqual([
      '    │ About        About M5',
      '    │ With         lead, po, ui',
      '    │ Tasks        T7 Ship the meetings view · not started',
    ])
    expect(blockOf(blocks, 'meeting:M6').card?.map(textOf)).toEqual(['    │ About        About M6', '    │ With         lead'])
    expect(words(meetingsBlocks({ kind: 'list', meetings: [YESTERDAY], unreadable: 0 }, [], null, TASKS, CLOCK))).toEqual([
      ['meetings:header', ['0 meetings']],
      ['meetings:note', [NO_MEETINGS]],
    ])
  })

  test('each mark is one cell of plain text, never an emoji', () => {
    for (const mark of Object.values(MEETING_MARK)) {
      expect(cells(mark)).toBe(1)
      expect(/\p{Extended_Pictographic}/u.test(mark)).toBe(false)
    }
  })
})
