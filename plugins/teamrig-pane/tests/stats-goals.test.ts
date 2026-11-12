// The Stats tab's Goals section (hooks/stats-goals.ts): its header's forms, closed and open; a row a goal under a header
// row, each a press that opens its card; the timeline's cells on one axis for every goal, left out where the row has no
// room; each state's words and colour; a goal's card in the team's zone; the off-goal line; and its place as the tab's
// last section.
import { describe, expect, test } from 'claude-code/testing'
import { readEvents, registerStats, TimeZone, type RegisterHealth } from '../hooks/core/read/index'
import type { Block, Row, Span } from '../hooks/rows'
import { slimAreas } from '../hooks/stats-areas'
import { BOTH_DAYS_CELLS, GOALS_KEY, goalBlocks, MIN_TIMELINE_CELLS, OFF_GOAL_KEY, offGoalWords, timeline } from '../hooks/stats-goals'
import { statsBlocks } from '../hooks/stats-rows'
import { cells } from '../hooks/width'
import type { StatsGoal, StatsGoals, StatsListRow, StatsView } from '../types'
import { createLine, NOW } from './fixtures'

type Folded = Extract<StatsView, { kind: 'stats' }>

const WIDE = 80
const NARROW = 40
/** NOW's day. */
const TODAY = '2026-10-13'
const EVENTS = readEvents(`${createLine('T1', { at: NOW, by: 'lead', owner: 'api', title: 'Add the route' })}\n`).events
/** teamrig's fold of a one-task register less its tasks and goals: the fields the section does not read. */
const { tasks, goals, areas, ...TALLIES } = registerStats({ teams: [{ team: 'acme', lead: 'lead', events: EVENTS }], range: '7d', now: new Date(NOW), zone: TimeZone.UTC, ownerMarker: 'owner' })
const HEALTH: RegisterHealth = {
  closeOpen: { level: 'good', ratio: 1 },
  backlog: { level: 'good', net: 0, active: 1 },
  overdue: { level: 'good', count: 0, p1: 0 },
  ownerDecisions: { level: 'good', count: 0, oldestDays: null },
  backlogClears: { level: 'good', weeks: 1 },
}

function task(id: string, status: StatsListRow['status'], title: string): StatsListRow {
  return { team: 'acme', id, title, owner: 'api', status, priority: 2, due: null }
}

/** A goal planned over October with nothing done, unless `over` sets it. */
function goal(over: Partial<StatsGoal> & Pick<StatsGoal, 'tag'>): StatsGoal {
  return { title: `Goal ${over.tag}`, start: '2026-10-01', target: '2026-10-31', parent: null, slips: [], done: 0, open: 0, doneDays: [], pace: 0, forecast: null, state: 'on track', rows: [], ...over }
}

/** Past its target three days ago, its target moved once, a task done and one in progress. */
const LATE = goal({
  tag: 'G10.2',
  title: 'Ship the release',
  target: '2026-10-10',
  parent: 'A3',
  slips: [{ at: '2026-10-05T12:00:00.000Z', by: 'lead', from: '2026-10-08', to: '2026-10-10', note: 'scope grew' }],
  done: 1,
  open: 4,
  doneDays: [{ day: '2026-10-03', done: 1 }],
  pace: 1 / 14,
  forecast: '2026-11-22',
  state: 'late',
  rows: [task('T4', 'in-progress', 'Cut the branch'), task('T2', 'done', 'Write the notes')],
})
const ON_TRACK = goal({ tag: 'A2', title: 'Write the guide', done: 3, open: 2, doneDays: [{ day: '2026-10-05', done: 1 }, { day: '2026-10-08', done: 2 }], pace: 0.2, forecast: '2026-10-23' })
const AT_RISK = goal({ tag: 'A4', start: '2026-10-10', target: '2026-10-20', open: 3, state: 'at risk' })
const DONE = goal({ tag: 'O1', start: '2026-09-20', target: '2026-10-05', done: 2, doneDays: [{ day: '2026-09-25', done: 2 }], state: 'done' })
const GOALS = [LATE, ON_TRACK, AT_RISK, DONE]

function viewOf(over: Partial<StatsGoals> = {}): Folded {
  const stats = { ...TALLIES, goals: { today: TODAY, offGoal: 750, doneInRange: 774, goals: GOALS, ...over }, areas: slimAreas(areas, () => []).areas }
  return { kind: 'stats', scope: { kind: 'tree' }, range: '7d', teams: ['acme'], stats, health: HEALTH, list: null, week: null, failures: [] }
}

const lineOf = (row: Row): string => row.spans.map(span => span.text).join('')

/** The section `width` cells wide, the keys in `open` open, a slip's day read in `zone`. */
function sectionOf(view: Folded, open: readonly string[], width = WIDE, zone = TimeZone.UTC): Block[] {
  return goalBlocks(view, key => open.includes(key), width, zone)
}

function blockOf(blocks: readonly Block[], key: string): Block {
  const block = blocks.find(found => found.key === key)
  if (block === undefined) throw new Error(`no block ${key} in ${blocks.map(found => found.key).join(', ')}`)
  return block
}

function spanOf(row: Row | undefined, text: string): Span {
  const span = row?.spans.find(found => found.text.trim() === text)
  if (span === undefined) throw new Error(`no span ${JSON.stringify(text)}`)
  return span
}

describe('goalBlocks: the header', () => {
  test('closed, it names the goals at risk and late, else counts the goals, or says there are none', () => {
    const headOf = (over: Partial<StatsGoals>) => sectionOf(viewOf(over), []).map(block => block.rows.map(lineOf))
    expect(headOf({})).toEqual([['▸ Goals · 1 at risk · 1 late']])
    expect(headOf({ goals: [ON_TRACK, DONE] })).toEqual([['▸ Goals · 2 goals']])
    expect(headOf({ goals: [DONE] })).toEqual([['▸ Goals · 1 goal']])
    expect(headOf({ goals: [] })).toEqual([['▸ Goals · no goals']])
    const head = sectionOf(viewOf(), [])[0]
    expect([head?.key, head?.folds, head?.opensSection]).toEqual([GOALS_KEY, GOALS_KEY, true])
  })

  test('open, a dim header row over the columns, a row a goal joined under it, each a press that opens it, then the off-goal line', () => {
    const blocks = sectionOf(viewOf(), [GOALS_KEY])
    expect(blocks.map(block => block.key)).toEqual([GOALS_KEY, 'stats:goals:G10.2', 'stats:goals:A2', 'stats:goals:A4', 'stats:goals:O1', OFF_GOAL_KEY])
    expect(blocks.slice(1).every(block => block.joined === true)).toBe(true)
    expect(blocks.slice(1, -1).map(block => [block.folds, block.card])).toEqual(GOALS.map(each => [`stats:goals:${each.tag}`, undefined]))
    const head = blockOf(blocks, GOALS_KEY).card?.[0]
    expect(head?.spans.slice(2).every(span => span.dim === true)).toBe(true)
    expect(lineOf(blockOf(blocks, OFF_GOAL_KEY).rows[0] ?? { key: '', spans: [] })).toBe('  off goal: 750 of 774 done tasks (97%)')
  })

  test('open with no goals, it says how to set one over the off-goal line', () => {
    const blocks = sectionOf(viewOf({ goals: [] }), [GOALS_KEY])
    expect(blocks.map(block => block.key)).toEqual([GOALS_KEY, OFF_GOAL_KEY])
    expect(blockOf(blocks, GOALS_KEY).card?.map(lineOf)).toEqual(['  No goals: teamrig goal add sets one.'])
  })
})

describe('goalBlocks: a goal row', () => {
  test('draws its tag, timeline, done of all, forecast and state in columns, under the header row\'s words, inside the width', () => {
    const blocks = sectionOf(viewOf(), [GOALS_KEY])
    const rows = [blockOf(blocks, GOALS_KEY).card?.[0], ...blocks.slice(1, -1).map(block => block.rows[0])].flatMap(row => (row === undefined ? [] : [row]))
    // The axis runs from O1's start, 09-20, to G10.2's forecast, 11-22: 64 days in the 43 cells the other columns leave.
    const free = WIDE - 4 - 'G10.2'.length - 'done'.length - 'forecast'.length - 'on track'.length - 4 * 2
    expect(free).toBe(43)
    // The first five cells hold 09-20 to 09-26: O1's plan and its day done, before the others start.
    expect(rows.map(row => lineOf(row).slice(0, 16))).toEqual(['    goal   09-20', '  ▸ G10.2       ', '  ▸ A2          ', '  ▸ A4          ', '  ▸ O1     ░░░░█'])
    // Today, 10-13, is day 23 of the axis: cell 16 on every goal's row.
    expect(rows.slice(1).map(row => [lineOf(row).indexOf('│'), lineOf(row).lastIndexOf('│')])).toEqual(GOALS.map(() => [11 + 16, 11 + 16]))
    // From the timeline's last five cells, after every target: the axis' last day over them.
    expect(rows.map(row => lineOf(row).slice(11 + free - 5))).toEqual([
      '11-22  done  forecast  state',
      '       1/5   11-22     late 3 d',
      '       3/5   10-23     on track',
      '       0/3   —         at risk',
      '       2/2   —         done',
    ])
    expect(rows.every(row => cells(lineOf(row)) <= WIDE)).toBe(true)
  })

  test('colours its state: late red, at risk amber, on track green, done dim', () => {
    const blocks = sectionOf(viewOf(), [GOALS_KEY])
    const stateOf = (tag: string, words: string) => spanOf(blockOf(blocks, `stats:goals:${tag}`).rows[0], words)
    expect([stateOf('G10.2', 'late 3 d').color, stateOf('A4', 'at risk').color, stateOf('A2', 'on track').color, stateOf('O1', 'done').dim]).toEqual(['error', 'warning', 'success', true])
  })

  test('leaves the timeline and its gap out where fewer than its fewest cells are free', () => {
    const blocks = sectionOf(viewOf(), [GOALS_KEY], NARROW)
    expect(lineOf(blockOf(blocks, 'stats:goals:G10.2').rows[0] ?? { key: '', spans: [] })).toBe('  ▸ G10.2  1/5   11-22     late 3 d')
    expect(lineOf(blockOf(blocks, GOALS_KEY).card?.[0] ?? { key: '', spans: [] })).toBe('    goal   done  forecast  state')
    expect(MIN_TIMELINE_CELLS).toBe(8)
  })

  test('heads a timeline too narrow for both its days with its first alone', () => {
    const width = 4 + 'G10.2'.length + 'done'.length + 'forecast'.length + 'on track'.length + 4 * 2 + BOTH_DAYS_CELLS - 1
    const head = lineOf(blockOf(sectionOf(viewOf(), [GOALS_KEY], width), GOALS_KEY).card?.[0] ?? { key: '', spans: [] })
    expect(head).toBe(`    goal   09-20${' '.repeat(BOTH_DAYS_CELLS - 1 - 5 + 2)}done  forecast  state`)
  })
})

describe('timeline', () => {
  const axis = { first: '2026-10-01', days: 10, today: '2026-10-06' }
  const planned = { start: '2026-10-02', target: '2026-10-08', doneDays: [{ day: '2026-10-03', done: 1 }, { day: '2026-10-04', done: 2 }] }

  test('a cell a day: blank outside the plan, `░` inside it, `█` on a day a task was done, `│` today', () => {
    expect(timeline(planned, axis, 10)).toBe(' ░██░│░░  ')
  })

  test('two days a cell: today wins over a done day, a done day over the plan, any planned day over a blank', () => {
    expect(timeline(planned, axis, 5)).toBe('░█│░ ')
    expect(timeline({ ...planned, doneDays: [{ day: '2026-10-05', done: 1 }, { day: '2026-10-07', done: 1 }] }, axis, 5)).toBe('░░│█ ')
  })
})

describe('goalBlocks: a goal\'s card', () => {
  test('opens under its row: its title, days and parent, each move of its target on the team\'s day, its pace, then its tasks', () => {
    const zone = TimeZone.of('Pacific/Kiritimati')
    if (zone === undefined) throw new Error('the host knows no Pacific/Kiritimati')
    const block = blockOf(sectionOf(viewOf(), [GOALS_KEY, 'stats:goals:G10.2'], WIDE, zone), 'stats:goals:G10.2')
    expect(lineOf(block.rows[0] ?? { key: '', spans: [] }).startsWith('  ▾ G10.2')).toBe(true)
    expect(block.card?.map(lineOf)).toEqual([
      '    Ship the release',
      '    2026-10-01 → 2026-10-10 · parent A3',
      '    moved from 2026-10-08 to 2026-10-10 on 2026-10-06 by lead: scope grew',
      '    pace 0.1 a day over 14 d',
      '    ◐ T4  Cut the branch',
      '    ✓ T2  Write the notes',
    ])
    expect(block.card?.map(row => row.key).slice(-2)).toEqual(['stats:goals:G10.2:acme/T4', 'stats:goals:G10.2:acme/T2'])
  })

  test('a goal with no parent, no move and no tasks has its title, days and pace alone', () => {
    const block = blockOf(sectionOf(viewOf(), [GOALS_KEY, 'stats:goals:A4']), 'stats:goals:A4')
    expect(block.card?.map(lineOf)).toEqual(['    Goal A4', '    2026-10-10 → 2026-10-20', '    pace 0.0 a day over 14 d'])
  })
})

describe('offGoalWords', () => {
  test("the range's done tasks that served no goal, or that none was done", () => {
    expect(offGoalWords({ today: TODAY, goals: [], offGoal: 750, doneInRange: 774 })).toBe('off goal: 750 of 774 done tasks (97%)')
    expect(offGoalWords({ today: TODAY, goals: [], offGoal: 0, doneInRange: 0 })).toBe('off goal: no task done')
  })
})

describe('statsBlocks: the Goals section', () => {
  test('is the tab\'s last section, closed until a press opens it', () => {
    const own = { team: 'acme', held: new Set<string>(), clock: { now: NOW, zone: TimeZone.UTC } }
    expect(statsBlocks(viewOf(), [], WIDE, own).at(-1)?.key).toBe(GOALS_KEY)
    expect(statsBlocks(viewOf(), [GOALS_KEY], WIDE, own).slice(-6).map(block => block.key)).toEqual([GOALS_KEY, 'stats:goals:G10.2', 'stats:goals:A2', 'stats:goals:A4', 'stats:goals:O1', OFF_GOAL_KEY])
  })
})
