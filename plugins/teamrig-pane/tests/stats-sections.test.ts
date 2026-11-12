// The Stats tab's sections after Flow (hooks/stats-sections.ts): their order and fold, each header alone and with
// nothing to count, each section's rows (the share bars and their legends, the speed table and its narrow lines, the
// presses that list overdue tasks and owner decisions, the People rows and their scope presses), every bar inside the
// pane's width, and the largest-remainder share of a bar's cells.
import { describe, expect, test } from 'claude-code/testing'
import { readEvents, registerStats, TimeZone, type RegisterHealth, type TeamPart, type TeamStats } from '../hooks/core/read/index'
import type { Block, Row, Span } from '../hooks/rows'
import { bar } from '../hooks/stats-chart'
import { slimAreas } from '../hooks/stats-areas'
import { goalsOf } from '../hooks/stats-source'
import { BOTTLENECKS_KEY } from '../hooks/stats-bottlenecks'
import { BUGS_KEY, DELAYS_KEY, NEW_KEY, PEOPLE_KEY, PEOPLE_ROWS, SECTION_KEYS, SPEED_KEY, WAITS_KEY, sectionBlocks, shareCells } from '../hooks/stats-sections'
import { cells } from '../hooks/width'
import type { StatsNumbers, StatsView } from '../types'
import { createLine, NOW } from './fixtures'

const WIDE = 80
const NARROW = 40

type Folded = Extract<StatsView, { kind: 'stats' }>

const EVENTS = readEvents(`${createLine('T1', { at: NOW, by: 'lead', owner: 'api', title: 'Add the route' })}\n`).events
/** teamrig's fold of a one-task register less its tasks: the fields a test does not set. */
const { tasks, goals, areas, ...TALLIES } = registerStats({ teams: [{ team: 'acme', lead: 'lead', events: EVENTS }], range: '7d', now: new Date(NOW), zone: TimeZone.UTC, ownerMarker: 'owner' })
const BASE: StatsNumbers = { ...TALLIES, goals: goalsOf(goals, TimeZone.UTC, TimeZone.UTC.day(new Date(NOW))), areas: slimAreas(areas, () => []).areas }
/** The Health tiles' levels, which no section reads. */
const HEALTH: RegisterHealth = {
  closeOpen: { level: 'good', ratio: 1 },
  backlog: { level: 'good', net: 0, active: 34 },
  overdue: { level: 'bad', count: 6, p1: 2 },
  ownerDecisions: { level: 'warn', count: 3, oldestDays: 4.5 },
  backlogClears: { level: 'good', weeks: 1 },
}

/** A team's numbers as the whole scope's: the same, less its name. */
function partOf(team: TeamStats, active: number): TeamPart {
  return { active, leadTime: team.leadTime, cycleTime: team.cycleTime, overdue: team.overdue, due: team.due }
}

const ACME: TeamStats = {
  team: 'acme',
  active: 30,
  leadTime: { count: 40, median: 0.9, p85: 6 },
  cycleTime: { count: 30, median: 1, p85: 5 },
  overdue: { count: 6, p1: 2 },
  due: { total: 20, onTime: 15 },
}
/** A team with three tasks done, none of them ever started, and none overdue or due. */
const TOOLS: TeamStats = {
  team: 'tools',
  active: 4,
  leadTime: { count: 3, median: 1.2, p85: 1.2 },
  cycleTime: { count: 0, median: null, p85: null },
  overdue: { count: 0, p1: 0 },
  due: { total: 0, onTime: 0 },
}
/** Ten sessions, two of them `lead`, one in each team. */
const PEOPLE = [
  { team: 'acme', session: 'api', done: 9 },
  { team: 'acme', session: 'lead', done: 6 },
  { team: 'tools', session: 'lead', done: 5 },
  { team: 'acme', session: 'web', done: 4 },
  { team: 'acme', session: 'db', done: 3 },
  { team: 'tools', session: 'cli', done: 3 },
  { team: 'acme', session: 'ops', done: 2 },
  { team: 'acme', session: 'qa', done: 2 },
  { team: 'acme', session: 'docs', done: 1 },
  { team: 'tools', session: 'build', done: 1 },
]

/** A week of the tree of acme and tools with something in every section. */
const STATS: StatsNumbers = {
  ...BASE,
  closedTasks: 40,
  droppedTasks: 2,
  all: partOf(ACME, 34),
  teams: [ACME, TOOLS],
  newWork: { total: 20, bySource: { self: 5, owner: 4, lead: 2, github: 1, session: 8 }, bugs: 5, byPriority: [{ priority: 1, count: 6 }, { priority: 2, count: 10 }, { priority: 3, count: 4 }], byGoal: [], noGoal: 18 },
  activeByAge: [{ label: '<2 d', count: 3 }, { label: '2-7 d', count: 10 }, { label: '7-14 d', count: 12 }, { label: '14+ d', count: 9 }],
  neverStarted: 4,
  lateDays: [{ label: '1 d', count: 2 }, { label: '2-3 d', count: 2 }, { label: '4+ d', count: 1 }],
  dueMoved: 3,
  waits: { waiting: 9, byKind: { decision: 2, approval: 1, task: 5, time: 2 }, ownerDecisions: { count: 3, oldestDays: 4.5 } },
  bugs: { active: 7, opened: 5, fixed: 3 },
  people: PEOPLE,
}

/** No area with an active task. */
const NO_AREAS = { median: { active: 0, bugs: 0, p1: 0, p1Late: 0, low: 0, waits: 0 }, areas: [] }
const NONE_DONE: TeamStats = { ...TOOLS, leadTime: { count: 0, median: null, p85: null } }
/** The same tree with its active tasks but nothing created, done, overdue or waiting in the range. */
const EMPTY: StatsNumbers = {
  ...STATS,
  closedTasks: 0,
  droppedTasks: 0,
  all: partOf(NONE_DONE, 34),
  teams: [{ ...NONE_DONE, team: 'acme' }, NONE_DONE],
  newWork: { total: 0, bySource: { self: 0, owner: 0, lead: 0, github: 0, session: 0 }, bugs: 0, byPriority: [], byGoal: [], noGoal: 0 },
  neverStarted: 0,
  lateDays: [{ label: '1 d', count: 0 }, { label: '2-3 d', count: 0 }, { label: '4+ d', count: 0 }],
  dueMoved: 0,
  waits: { waiting: 0, byKind: { decision: 0, approval: 0, task: 0, time: 0 }, ownerDecisions: { count: 0, oldestDays: null } },
  bugs: { active: 0, opened: 0, fixed: 0 },
  people: [],
  areas: { teams: NO_AREAS, sessions: NO_AREAS },
}

/** The numbers of the tree of acme and tools over the 7 days, unless `over` sets them. */
function viewOf(over: Partial<Folded> = {}): Folded {
  return { kind: 'stats', scope: { kind: 'tree' }, range: '7d', teams: ['acme', 'tools'], stats: STATS, health: HEALTH, list: null, week: null, failures: [], ...over }
}

const lineOf = (row: Row): string => row.spans.map(span => span.text).join('')

/** The sections `width` cells wide, those in `open` open. */
function sectionsOf(view: Folded, width = WIDE, open: readonly string[] = SECTION_KEYS): Block[] {
  return sectionBlocks(view, key => open.includes(key), width)
}

/** The rows of the section under `key`, open. */
function cardOf(view: Folded, key: string, width = WIDE): Row[] {
  const block = sectionsOf(view, width).find(found => found.key === key)
  if (block?.card === undefined) throw new Error(`no open section ${key}`)
  return block.card
}

const headsOf = (view: Folded): string[][] => sectionsOf(view, WIDE, []).map(block => block.rows.map(lineOf))

function rowOf(rows: readonly Row[], key: string): Row {
  const row = rows.find(found => found.key === key)
  if (row === undefined) throw new Error(`no row ${key} in ${rows.map(found => found.key).join(', ')}`)
  return row
}

function spanOf(row: Row, text: string): Span {
  const span = row.spans.find(found => found.text === text)
  if (span === undefined) throw new Error(`no span ${JSON.stringify(text)} in ${JSON.stringify(lineOf(row))}`)
  return span
}

describe('sectionBlocks: the headers', () => {
  test('draw the seven sections closed in order, each header a press that opens it, alone answering the glance', () => {
    const blocks = sectionsOf(viewOf(), WIDE, [])
    expect(blocks.map(block => block.key)).toEqual([BOTTLENECKS_KEY, NEW_KEY, SPEED_KEY, DELAYS_KEY, WAITS_KEY, BUGS_KEY, PEOPLE_KEY])
    expect(SECTION_KEYS).toEqual(['stats:bottlenecks', 'stats:new', 'stats:speed', 'stats:delays', 'stats:waits', 'stats:bugs', 'stats:people'])
    expect(headsOf(viewOf())).toEqual([
      ['▸ Bottlenecks · 1 area stands out'],
      ['▸ New work · 20 in 7 d · 18 with no goal'],
      ['▸ Speed · lead time median 0.9-1.2 d · 4 never started'],
      ['▸ Delays · 6 overdue · p1 2'],
      ['▸ Waits · 9 waiting · owner decisions 3, oldest 4.5 d'],
      ['▸ Bugs · 7 active · opened 5, fixed 3 in 7 d'],
      ['▸ People · done in 7 d · 10 sessions'],
    ])
    expect(blocks.map(block => [block.folds, block.opensSection, block.card])).toEqual(SECTION_KEYS.map(key => [key, true, undefined]))
    const head = blocks[1]?.rows[0]
    if (head === undefined) throw new Error('no New work header')
    expect(spanOf(head, 'New work').bold).toBe(true)
  })

  test('open, draw the open mark and the rows under the header', () => {
    const blocks = sectionsOf(viewOf())
    expect(blocks.map(block => block.rows[0]?.spans[0]?.text)).toEqual(SECTION_KEYS.map(() => '▾ '))
    expect(blocks.every(block => (block.card ?? []).length > 0)).toBe(true)
  })

  test('name the range as all days, and one median and one session alone', () => {
    const one = viewOf({ range: 'all', stats: { ...STATS, teams: [ACME], people: PEOPLE.slice(0, 1) } })
    expect(headsOf(one)).toEqual([
      ['▸ Bottlenecks · 1 area stands out'],
      ['▸ New work · 20 in all days · 18 with no goal'],
      ['▸ Speed · lead time median 0.9 d · 4 never started'],
      ['▸ Delays · 6 overdue · p1 2'],
      ['▸ Waits · 9 waiting · owner decisions 3, oldest 4.5 d'],
      ['▸ Bugs · 7 active · opened 5, fixed 3 in all days'],
      ['▸ People · done in all days · 1 session'],
    ])
  })

  test('with nothing to count, say so in each header', () => {
    expect(headsOf(viewOf({ stats: EMPTY }))).toEqual([
      ['▸ Bottlenecks · no active tasks'],
      ['▸ New work · 0 in 7 d'],
      ['▸ Speed · none done in 7 d'],
      ['▸ Delays · 0 overdue'],
      ['▸ Waits · 0 waiting · owner decisions 0'],
      ['▸ Bugs · 0 active · opened 0, fixed 0 in 7 d'],
      ['▸ People · none done in 7 d'],
    ])
  })
})

describe('sectionBlocks: New work', () => {
  test('draws where the new tasks came from as a share bar over its legend, most first, then type, priority and goal', () => {
    const card = cardOf(viewOf(), NEW_KEY)
    expect(card.map(lineOf)).toEqual([
      `  source    ${'▒'.repeat(16)}${'▓'.repeat(10)}${'█'.repeat(8)}${'░'.repeat(4)}${'▞'.repeat(2)}`,
      '            ▒ another session 8 · ▓ self-made 5 · █ owner 4 · ░ lead 2 · ▞ GitHub 1',
      '  type      bug 5 (25%) · other 15',
      '  priority  p1 6 (30%) · p2 10 · p3 4',
      '  no goal   18 of 20',
    ])
    expect(spanOf(rowOf(card, `${NEW_KEY}:legend`), ' another session 8').dim).toBe(true)
  })

  test('leaves a source with no task out of the bar and its legend', () => {
    const bySource = { self: 3, owner: 1, lead: 0, github: 0, session: 0 }
    const card = cardOf(viewOf({ stats: { ...STATS, newWork: { ...STATS.newWork, total: 4, bySource } } }), NEW_KEY)
    expect(lineOf(rowOf(card, `${NEW_KEY}:source`))).toBe(`  source    ${'▓'.repeat(30)}${'█'.repeat(10)}`)
    expect(lineOf(rowOf(card, `${NEW_KEY}:legend`))).toBe('            ▓ self-made 3 · █ owner 1')
  })

  test('fits the source bar inside a narrow pane', () => {
    expect(cells(lineOf(rowOf(cardOf(viewOf(), NEW_KEY, NARROW), `${NEW_KEY}:source`)))).toBe(NARROW)
  })

  test('says so when no task was created', () => {
    expect(cardOf(viewOf({ stats: EMPTY }), NEW_KEY).map(lineOf)).toEqual(['  No task was created in 7 d.'])
    expect(cardOf(viewOf({ stats: EMPTY, range: 'all' }), NEW_KEY).map(lineOf)).toEqual(['  No task was created in all days.'])
  })
})

describe('sectionBlocks: Speed', () => {
  test("draws each team's lead and cycle time as a table, median then p85, a dash with nothing to measure", () => {
    expect(cardOf(viewOf(), SPEED_KEY).map(lineOf)).toEqual([
      '         lead time       cycle time',
      '         median  p85     median  p85',
      '  acme   0.9 d   6.0 d   1.0 d   5.0 d',
      '  tools  1.2 d   1.2 d   -       -',
      '  active by age  <2 d 3 · 2-7 d 10 · 7-14 d 12 · 14+ d 9',
    ])
  })

  test('draws the table while it fits to the cell, else a line a team', () => {
    const fits = cardOf(viewOf(), SPEED_KEY, 39)
    expect(fits.filter(row => row.key.startsWith(`${SPEED_KEY}:table:`)).every(row => cells(lineOf(row)) <= 39)).toBe(true)
    expect(cardOf(viewOf(), SPEED_KEY, 38).map(lineOf)).toEqual([
      '  acme   lead time 0.9 d, p85 6.0 d · cycle time 1.0 d, p85 5.0 d',
      '  tools  lead time 1.2 d, p85 1.2 d · cycle time -',
      '  active by age  <2 d 3 · 2-7 d 10 · 7-14 d 12 · 14+ d 9',
    ])
  })

  test('says so when no task was done, still showing the active tasks by age', () => {
    expect(cardOf(viewOf({ stats: EMPTY }), SPEED_KEY).map(lineOf)).toEqual(['  No task was done in 7 d.', '  active by age  <2 d 3 · 2-7 d 10 · 7-14 d 12 · 14+ d 9'])
  })
})

describe('sectionBlocks: Delays', () => {
  test("draws the overdue counts as presses that list them, each team's, the share done by its due date, the days late and the moved dues", () => {
    const card = cardOf(viewOf(), DELAYS_KEY)
    expect(card.map(lineOf)).toEqual([
      '  overdue    6 · p1 2',
      '             acme 6 (p1 2) · tools 0',
      '  done by its due date, of those done in 7 d',
      `    acme  ${'█'.repeat(15)}${'░'.repeat(5)}   75%  15 of 20`,
      '  days late  1 d 2 · 2-3 d 2 · 4+ d 1',
      '  due moved  3 tasks in 7 d',
    ])
    const overdue = rowOf(card, `${DELAYS_KEY}:overdue`)
    expect([spanOf(overdue, '6').stats, spanOf(overdue, 'p1 2').stats]).toEqual([
      { kind: 'list', list: 'overdue' },
      { kind: 'list', list: 'overdueP1' },
    ])
    const due = rowOf(card, `${DELAYS_KEY}:due:acme`)
    expect([spanOf(due, '█'.repeat(15)).color, spanOf(due, '░'.repeat(5)).dim]).toEqual(['success', true])
  })

  test("draws no team row for one team, and a count of none as plain words, no press", () => {
    const one = viewOf({ scope: { kind: 'team', team: 'acme' }, stats: { ...STATS, all: { ...ACME, overdue: { count: 6, p1: 0 } }, teams: [ACME] } })
    const card = cardOf(one, DELAYS_KEY)
    expect(card.some(row => row.key === `${DELAYS_KEY}:teams`)).toBe(false)
    const overdue = rowOf(card, `${DELAYS_KEY}:overdue`)
    expect([spanOf(overdue, '6').stats, spanOf(overdue, 'p1 0').stats]).toEqual([{ kind: 'list', list: 'overdue' }, undefined])
  })

  test('fits the due bar inside a narrow pane', () => {
    expect(cells(lineOf(rowOf(cardOf(viewOf(), DELAYS_KEY, NARROW), `${DELAYS_KEY}:due:acme`)))).toBe(NARROW)
  })

  test('says so when no task done had a due date', () => {
    expect(cardOf(viewOf({ stats: EMPTY }), DELAYS_KEY).map(lineOf)).toEqual([
      '  overdue    0 · p1 0',
      '             acme 0 · tools 0',
      '  No task done in 7 d had a due date.',
      '  days late  1 d 0 · 2-3 d 0 · 4+ d 0',
      '  due moved  0 tasks in 7 d',
    ])
  })
})

describe('sectionBlocks: Waits', () => {
  test("draws what the waiting tasks wait on as a share bar over its legend, a note when the kinds add past them, and the owner's decisions as a press", () => {
    const card = cardOf(viewOf(), WAITS_KEY)
    expect(card.map(lineOf)).toEqual([
      `  ${'▒'.repeat(20)}${'▓'.repeat(8)}${'░'.repeat(8)}${'█'.repeat(4)}`,
      '  ▒ another task 5 · ▓ a decision 2 · ░ a time 2 · █ an approval 1',
      '  A task can wait on more than one thing, so these add up to 10.',
      "  3 wait on the owner's decision or approval, the oldest 4.5 d",
    ])
    expect(spanOf(rowOf(card, `${WAITS_KEY}:owner`), '3').stats).toEqual({ kind: 'list', list: 'ownerDecisions' })
  })

  test('drops the note when each task waits on one kind, and the oldest with no age', () => {
    const waits = { waiting: 10, byKind: STATS.waits.byKind, ownerDecisions: { count: 1, oldestDays: null } }
    expect(cardOf(viewOf({ stats: { ...STATS, waits } }), WAITS_KEY).map(lineOf).slice(2)).toEqual(["  1 waits on the owner's decision or approval"])
  })

  test('fits the bar inside a narrow pane', () => {
    expect(cells(lineOf(rowOf(cardOf(viewOf(), WAITS_KEY, NARROW), `${WAITS_KEY}:bar`)))).toBe(NARROW)
  })

  test('says so when no task is waiting', () => {
    expect(cardOf(viewOf({ stats: EMPTY }), WAITS_KEY).map(lineOf)).toEqual(['  No task is waiting.'])
  })
})

describe('sectionBlocks: Bugs', () => {
  test('draws the bugs opened and fixed as bars on one scale, their share of new work and the dropped share of the closes', () => {
    const card = cardOf(viewOf(), BUGS_KEY)
    expect(card.map(lineOf)).toEqual([`  opened  ${'█'.repeat(20)} 5`, `  fixed   ${'█'.repeat(12)} 3`, '  share of new work 25% · dropped 2 of 40 closed in 7 d (5%)'])
    expect([spanOf(rowOf(card, `${BUGS_KEY}:opened`), '█'.repeat(20)).color, spanOf(rowOf(card, `${BUGS_KEY}:fixed`), '█'.repeat(12)).color]).toEqual(['warning', 'success'])
  })

  test('draws the counts alone with none, and no shares with nothing created or closed', () => {
    expect(cardOf(viewOf({ stats: EMPTY }), BUGS_KEY).map(lineOf)).toEqual(['  opened  0', '  fixed   0'])
  })
})

describe('sectionBlocks: People', () => {
  test('draws the PEOPLE_ROWS sessions with the most done as bars, a shared name with its team, then a line for the rest', () => {
    const card = cardOf(viewOf(), PEOPLE_KEY)
    const shown = PEOPLE.slice(0, PEOPLE_ROWS)
    const names = ['api', 'lead (acme)', 'lead (tools)', 'web', 'db', 'cli', 'ops', 'qa']
    expect(card.map(lineOf)).toEqual([...shown.map((person, index) => `  ${(names[index] ?? '').padEnd(14)}${bar(person.done, 9, 20)} ${person.done}`), '  2 more sessions, 2 done'])
  })

  test("makes each name a press that scopes the tab to its session, but the scoped session's own", () => {
    const card = cardOf(viewOf(), PEOPLE_KEY)
    expect(spanOf(rowOf(card, `${PEOPLE_KEY}:tools/lead`), 'lead (tools)').stats).toEqual({ kind: 'scope', scope: { kind: 'session', team: 'tools', session: 'lead' } })
    const scoped = cardOf(viewOf({ scope: { kind: 'session', team: 'acme', session: 'api' } }), PEOPLE_KEY)
    expect(spanOf(rowOf(scoped, `${PEOPLE_KEY}:acme/api`), 'api').stats).toBeUndefined()
    expect(spanOf(rowOf(scoped, `${PEOPLE_KEY}:acme/web`), 'web').stats).toEqual({ kind: 'scope', scope: { kind: 'session', team: 'acme', session: 'web' } })
  })

  test('fits each bar inside a narrow pane', () => {
    const rows = cardOf(viewOf(), PEOPLE_KEY, NARROW).filter(row => row.key !== `${PEOPLE_KEY}:more`)
    expect(rows.every(row => cells(lineOf(row)) <= NARROW)).toBe(true)
  })

  test('says so when no session closed a task done', () => {
    expect(cardOf(viewOf({ stats: EMPTY }), PEOPLE_KEY).map(lineOf)).toEqual(['  No session closed a task done in 7 d.'])
  })
})

describe('shareCells', () => {
  test('shares the cells by the largest remainder, adding up to the width', () => {
    expect(shareCells([8, 5, 4, 2, 1], 40)).toEqual([16, 10, 8, 4, 2])
    expect(shareCells([8, 5, 4, 2, 1], 28)).toEqual([11, 7, 6, 3, 1])
  })

  test('gives a tie to the earlier count, and a part too small for a cell none', () => {
    expect(shareCells([1, 1, 1], 10)).toEqual([4, 3, 3])
    expect(shareCells([1, 99], 10)).toEqual([0, 10])
  })

  test('draws none with nothing to share or no room', () => {
    expect([shareCells([0, 0], 5), shareCells([3], 0)]).toEqual([
      [0, 0],
      [0],
    ])
  })
})
