// The Stats tab's rows (hooks/stats-rows.ts): the scope and range presses, the Health tiles in their levels' colours
// two a row where they fit, the Flow section's header and fold, its day rows, charts, limit and split marks, the WARN
// lines of unread team folders, and the notes when no numbers show.
import { describe, expect, test } from 'claude-code/testing'
import { readEvents, registerStats, TimeZone, type ActiveCounts, type RegisterHealth, type StatsDay } from '../hooks/core/read/index'
import type { Block, Row, Span } from '../hooks/rows'
import { activeChart, bar } from '../hooks/stats-chart'
import { DAY_ROWS, FLOW_KEY, dayLabel, isSectionOpen, rangeLabel, statsBlocks } from '../hooks/stats-rows'
import type { TeamWeek } from '../hooks/team'
import { cells } from '../hooks/width'
import type { StatsNumbers, StatsView } from '../types'
import { createLine, NOW, statusLine } from './fixtures'

const DAY = 24 * 3_600_000
const WIDE = 80
const NARROW = 40

const LINES = [createLine('T1', { at: NOW - 3 * DAY, by: 'lead', owner: 'api', title: 'Add the route' }), statusLine('T1', 'api', NOW - 2 * DAY, 'in-progress')]
const EVENTS = readEvents(LINES.map(line => `${line}\n`).join('')).events
/** teamrig's fold of one small register less its tasks, as the view holds it: the fields a test does not set. */
const { tasks, ...BASE } = registerStats({ teams: [{ team: 'acme', lead: 'lead', events: EVENTS }], range: '7d', now: new Date(NOW), zone: TimeZone.UTC, ownerMarker: 'owner' })
/** The design's Health of 10-31: four red, one amber. */
const HEALTH: RegisterHealth = {
  closeOpen: { level: 'bad', ratio: 0.79 },
  backlog: { level: 'bad', net: 112, active: 596 },
  overdue: { level: 'bad', count: 93, p1: 21 },
  ownerDecisions: { level: 'warn', count: 10, oldestDays: 6 },
  backlogClears: { level: 'bad', weeks: null },
}
const IDLE: ActiveCounts = { open: 0, 'in-progress': 0, verifying: 0, waiting: 0 }

type Folded = Extract<StatsView, { kind: 'stats' }>

/** The tab's numbers for the tree of acme and tools, the 7 days, no week and no failure, unless `over` sets them. */
function viewOf(over: Partial<Folded> = {}): Folded {
  return { kind: 'stats', scope: { kind: 'tree' }, range: '7d', teams: ['acme', 'tools'], stats: BASE, health: HEALTH, list: null, week: null, failures: [], ...over }
}

/** An October day: what opened and closed on it, five tasks open at its end. */
function day(n: number, opened: number, done: number, counts: { dropped?: number; atLimit?: boolean } = {}): StatsDay {
  return { day: `2026-10-${String(n).padStart(2, '0')}`, opened, done, dropped: counts.dropped ?? 0, active: { ...IDLE, open: 5 }, atLimit: counts.atLimit ?? false }
}

/** The design's week of days, 10-25 to 10-31; 10-27 sat at the usage limit. */
const WEEK_DAYS: readonly StatsDay[] = [day(25, 107, 66), day(26, 59, 106), day(27, 3, 14, { atLimit: true }), day(28, 94, 67), day(29, 101, 67), day(30, 116, 71), day(31, 60, 38)]

const lineOf = (row: Row): string => row.spans.map(span => span.text).join('')

function blockOf(blocks: readonly Block[], key: string): Block {
  const block = blocks.find(found => found.key === key)
  if (block === undefined) throw new Error(`no block ${key} in ${blocks.map(found => found.key).join(', ')}`)
  return block
}

function rowOf(rows: readonly Row[], key: string): Row {
  const row = rows.find(found => found.key === key)
  if (row === undefined) throw new Error(`no row ${key}`)
  return row
}

function spanOf(row: Row, text: string): Span {
  const span = row.spans.find(found => found.text === text)
  if (span === undefined) throw new Error(`no span ${JSON.stringify(text)} in ${JSON.stringify(lineOf(row))}`)
  return span
}

/** The Flow section's rows while open. */
function flowCard(view: Folded, width = WIDE): Row[] {
  const card = blockOf(statsBlocks(view, [], width), FLOW_KEY).card
  if (card === undefined) throw new Error('the Flow section is folded')
  return card
}

/** A Health tile's dot colour and value, found by its label. */
function tileOf(view: Folded, label: string): { color: Span['color']; value: string } {
  for (const row of blockOf(statsBlocks(view, [], WIDE), 'stats:health').rows) {
    const at = row.spans.findIndex(span => span.text === ` ${label}  `)
    if (at > 0) return { color: row.spans[at - 1]?.color, value: row.spans[at + 1]?.text ?? '' }
  }
  throw new Error(`no ${label} tile`)
}

describe('statsBlocks: no numbers', () => {
  test('says the registers are being read', () => {
    expect(statsBlocks({ kind: 'reading' }, [], WIDE).map(block => block.rows.map(lineOf))).toEqual([['Reading the registers…']])
  })

  test('says why no team is found', () => {
    expect(statsBlocks({ kind: 'no-team' }, [], WIDE).map(block => block.rows.map(lineOf))).toEqual([
      ["No team found: the Stats tab folds the registers of the tree of teams the session's team is in."],
    ])
  })

  test('says why the read failed, in amber', () => {
    const [block] = statsBlocks({ kind: 'failed', reason: 'EPERM: operation not permitted.' }, [], WIDE)
    expect(block?.rows[0]?.spans).toEqual([{ text: 'The registers could not be read: EPERM: operation not permitted.', color: 'warning' }])
  })
})

describe('statsBlocks: the pick rows', () => {
  test('bracket the tree and make each team a press that scopes the tab to it', () => {
    const [scope] = blockOf(statsBlocks(viewOf(), [], WIDE), 'stats:pick').rows
    if (scope === undefined) throw new Error('no scope row')
    expect(lineOf(scope)).toBe('Scope  [tree]  acme  tools')
    expect(spanOf(scope, '[tree]').stats).toBeUndefined()
    expect(spanOf(scope, 'tools').stats).toEqual({ kind: 'scope', scope: { kind: 'team', team: 'tools' } })
  })

  test('bold the label and draw each press in plain text, so a press does not read as a dim note', () => {
    const [scope, range] = blockOf(statsBlocks(viewOf(), [], WIDE), 'stats:pick').rows
    if (scope === undefined || range === undefined) throw new Error('no pick rows')
    expect(spanOf(scope, 'Scope')).toEqual({ text: 'Scope', bold: true })
    expect(spanOf(range, 'Range')).toEqual({ text: 'Range', bold: true })
    expect(spanOf(scope, 'acme')).toEqual({ text: 'acme', stats: { kind: 'scope', scope: { kind: 'team', team: 'acme' } } })
    expect(spanOf(range, 'all')).toEqual({ text: 'all', stats: { kind: 'range', range: 'all' } })
  })

  test("add a picked session, its press going back to the session's team", () => {
    const [scope] = blockOf(statsBlocks(viewOf({ scope: { kind: 'session', team: 'tools', session: 'dev' } }), [], WIDE), 'stats:pick').rows
    if (scope === undefined) throw new Error('no scope row')
    expect(lineOf(scope)).toBe('Scope  tree  acme  tools  [dev ×]')
    expect(spanOf(scope, '[dev ×]').stats).toEqual({ kind: 'scope', scope: { kind: 'team', team: 'tools' } })
    expect(spanOf(scope, 'tree').stats).toEqual({ kind: 'scope', scope: { kind: 'tree' } })
  })

  test('bracket the range and make each other range a press', () => {
    const range = blockOf(statsBlocks(viewOf({ scope: { kind: 'team', team: 'acme' }, range: '90d' }), [], WIDE), 'stats:pick').rows[1]
    if (range === undefined) throw new Error('no range row')
    expect(lineOf(range)).toBe('Range  7 d  30 d  [90 d]  180 d  1 y  all')
    expect(spanOf(range, '1 y').stats).toEqual({ kind: 'range', range: '1y' })
    expect(spanOf(range, 'all').stats).toEqual({ kind: 'range', range: 'all' })
    expect(spanOf(range, '[90 d]').stats).toBeUndefined()
  })

  test('rangeLabel reads days, a year as 1 y, and all as all', () => {
    expect([rangeLabel('7d'), rangeLabel('180d'), rangeLabel('1y'), rangeLabel('all')]).toEqual(['7 d', '180 d', '1 y', 'all'])
  })
})

describe('statsBlocks: Health', () => {
  test('opens a section under a bold heading, the tiles indented two a row in two columns where they fit, the dot in its level colour', () => {
    const block = blockOf(statsBlocks(viewOf(), [], WIDE), 'stats:health')
    expect(block.rows.map(lineOf)).toEqual([
      'Health',
      `  ${'● close/open  0.79'.padEnd(41)}● backlog  +112, 596 active`,
      `  ${'● overdue  93, p1 21'.padEnd(41)}● owner decisions  10, oldest 6.0 d`,
      '  ● backlog clears  never, at this rate',
    ])
    expect(block.opensSection).toBe(true)
    expect(block.rows[0]?.spans).toEqual([{ text: 'Health', bold: true }])
    expect(block.rows[1]?.spans[1]).toEqual({ text: '●', color: 'error' })
    expect(block.rows[1]?.hang).toEqual({ text: '    ' })
    expect(tileOf(viewOf(), 'owner decisions').color).toBe('warning')
  })

  test('shrinks the gap between two tiles to 2 cells before it draws a tile a row where two do not fit beside the indent', () => {
    expect(blockOf(statsBlocks(viewOf(), [], 78), 'stats:health').rows.map(lineOf)[1]).toBe(`  ${'● close/open  0.79'.padEnd(41)}● backlog  +112, 596 active`)
    expect(blockOf(statsBlocks(viewOf(), [], 76), 'stats:health').rows.map(lineOf)[1]).toBe(`  ${'● close/open  0.79'.padEnd(39)}● backlog  +112, 596 active`)
    expect(blockOf(statsBlocks(viewOf(), [], 75), 'stats:health').rows.length).toBe(6)
    expect(blockOf(statsBlocks(viewOf(), [], NARROW), 'stats:health').rows.map(lineOf)).toEqual([
      'Health',
      '  ● close/open  0.79',
      '  ● backlog  +112, 596 active',
      '  ● overdue  93, p1 21',
      '  ● owner decisions  10, oldest 6.0 d',
      '  ● backlog clears  never, at this rate',
    ])
  })

  test('words a ratio with nothing opened, an owner queue with no age and a backlog that clears', () => {
    const health: RegisterHealth = {
      ...HEALTH,
      closeOpen: { level: 'good', ratio: null },
      ownerDecisions: { level: 'good', count: 0, oldestDays: null },
      backlogClears: { level: 'good', weeks: 1 },
    }
    expect(tileOf(viewOf({ health }), 'close/open')).toEqual({ color: 'success', value: 'none opened' })
    expect(tileOf(viewOf({ health }), 'owner decisions').value).toBe('0')
    expect(tileOf(viewOf({ health }), 'backlog clears').value).toBe('in 1 week')
    expect(tileOf(viewOf({ health: { ...health, backlogClears: { level: 'warn', weeks: 6 } } }), 'backlog clears').value).toBe('in 6 weeks')
  })

  test('puts the week before the forecast: amber ahead of its pace, red past its plan, green behind', () => {
    const week = (usedPct: number, plannedPct: number): TeamWeek => ({ usedPct, plannedPct, elapsedPct: 77 })
    expect(tileOf(viewOf({ week: week(63, 70) }), 'week')).toEqual({ color: 'warning', value: '63%, pace 54% of 70%' })
    expect(tileOf(viewOf({ week: week(75, 70) }), 'week').color).toBe('error')
    expect(tileOf(viewOf({ week: week(30, 70) }), 'week').color).toBe('success')
    const rows = blockOf(statsBlocks(viewOf({ week: week(63, 70) }), [], WIDE), 'stats:health').rows.map(lineOf)
    expect(rows[3]?.startsWith('  ● week  63%')).toBe(true)
    expect(rows[3]?.endsWith('● backlog clears  never, at this rate')).toBe(true)
  })

  test('marks a week with no plan amber once any is used', () => {
    expect(tileOf(viewOf({ week: { usedPct: 5, plannedPct: 0, elapsedPct: 50 } }), 'week')).toEqual({ color: 'warning', value: '5%, no plan' })
    expect(tileOf(viewOf({ week: { usedPct: 0, plannedPct: 0, elapsedPct: 50 } }), 'week').color).toBe('success')
  })
})

describe('statsBlocks: Flow', () => {
  const stats: StatsNumbers = { ...BASE, days: WEEK_DAYS, opened: 540, closedTasks: 428, droppedTasks: 3, net: 112 }

  test('heads the section with its range and headline, open by default, a press on it folding it', () => {
    const block = blockOf(statsBlocks(viewOf({ stats }), [], WIDE), FLOW_KEY)
    expect(block.rows.map(lineOf)).toEqual(['▾ Flow · last 7 d · opened 540 · closed 428 (3 dropped) · net +112'])
    expect(block.folds).toBe(FLOW_KEY)
    expect(block.opensSection).toBe(true)
    expect(block.card === undefined).toBe(false)
  })

  test('folded, keeps the range and headline and draws none of its rows', () => {
    const block = blockOf(statsBlocks(viewOf({ stats: { ...stats, droppedTasks: 0, net: -2 } }), [FLOW_KEY], WIDE), FLOW_KEY)
    expect(block.rows.map(lineOf)).toEqual(['▸ Flow · last 7 d · opened 540 · closed 428 · net -2'])
    expect(block.card).toBeUndefined()
    expect(blockOf(statsBlocks(viewOf({ stats, range: 'all' }), [FLOW_KEY], WIDE), FLOW_KEY).rows.map(lineOf)).toEqual([
      '▸ Flow · all days · opened 540 · closed 428 (3 dropped) · net +112',
    ])
  })

  test('isSectionOpen flips a section from its default', () => {
    expect([isSectionOpen(FLOW_KEY, []), isSectionOpen(FLOW_KEY, [FLOW_KEY]), isSectionOpen('stats:speed', []), isSectionOpen('stats:speed', ['stats:speed'])]).toEqual([true, false, false, true])
  })

  test('draws the days newest first with bars on one scale, the net in its colour, and $ on a day at the limit', () => {
    const card = flowCard(viewOf({ stats }))
    const days = card.filter(row => /:day:2026-/.test(row.key))
    expect(days.map(row => row.key.slice(-5))).toEqual(['10-31', '10-30', '10-29', '10-28', '10-27', '10-26', '10-25'])
    const newest = days[0]
    if (newest === undefined) throw new Error('no day row')
    expect(lineOf(newest)).toBe(`  Sat 10-31     60 ${bar(60, 116, 20).padEnd(20)}   38 ${bar(38, 116, 20).padEnd(20)}  +22`)
    expect(spanOf(newest, '+22').color).toBe('warning')
    expect(spanOf(rowOf(card, `${FLOW_KEY}:day:2026-10-26`), '-47').color).toBe('success')
    expect(spanOf(rowOf(card, `${FLOW_KEY}:day:2026-10-27`), ' $').color).toBe('warning')
    expect(lineOf(rowOf(card, `${FLOW_KEY}:day:head`))).toBe(`  ${'day'.padEnd(13)}${'opened'.padEnd(26)}${'closed'.padEnd(26)}net`)
    expect(lineOf(rowOf(card, `${FLOW_KEY}:day:limit`))).toBe('  $ 10-27: the week sat at its usage limit, so a quiet day there is no slack')
  })

  test('shows the newest DAY_ROWS days and says how many older ones only the charts show', () => {
    const month = Array.from({ length: DAY_ROWS + 6 }, (_, index) => day(index + 1, index, 1))
    const card = flowCard(viewOf({ stats: { ...BASE, days: month } }))
    expect(card.filter(row => /:day:2026-/.test(row.key)).length).toBe(DAY_ROWS)
    expect(lineOf(rowOf(card, `${FLOW_KEY}:day:older`))).toBe('  6 older days show in the charts only')
    expect(card.some(row => row.key === `${FLOW_KEY}:day:limit`)).toBe(false)
  })

  test('draws the active line, the burn-up and the cumulative flow under their legends, each row inside the width', () => {
    const card = flowCard(viewOf({ stats }))
    const keys = card.map(row => row.key)
    expect(keys.filter(key => /^stats:flow:active:\d+$/.test(key)).length).toBe(activeChart(WEEK_DAYS, WIDE - 2).rows.length)
    expect(keys.indexOf(`${FLOW_KEY}:active:legend`) < keys.indexOf(`${FLOW_KEY}:day:head`)).toBe(true)
    expect(keys.indexOf(`${FLOW_KEY}:day:head`) < keys.indexOf(`${FLOW_KEY}:burn:legend`)).toBe(true)
    expect(keys.indexOf(`${FLOW_KEY}:burn:legend`) < keys.indexOf(`${FLOW_KEY}:cfd:legend`)).toBe(true)
    expect(lineOf(rowOf(card, `${FLOW_KEY}:active:legend`))).toBe("  Active tasks at each day's end")
    expect(lineOf(rowOf(card, `${FLOW_KEY}:burn:legend`))).toBe('  Burn-up  ▀ created, ▄ closed; the gap is the backlog')
    expect(lineOf(rowOf(card, `${FLOW_KEY}:cfd:legend`))).toBe('  Cumulative flow  ░ open, ▒ waiting, ▓ in progress, █ verifying')
    expect(spanOf(rowOf(card, `${FLOW_KEY}:cfd:legend`), 'Cumulative flow').bold).toBe(true)
    expect(spanOf(rowOf(card, `${FLOW_KEY}:burn:legend`), ' created, ').dim).toBe(true)
    expect(lineOf(rowOf(card, `${FLOW_KEY}:active:limits`)).trim()).toBe('$')
    const charted = card.filter(row => /:(active|burn|cfd):(\d+|days|limits)$/.test(row.key))
    expect(charted.every(row => cells(lineOf(row)) <= WIDE)).toBe(true)
    expect(rowOf(card, `${FLOW_KEY}:active:0`).spans[1]).toEqual({ text: '5 ┤', dim: true })
  })

  test('leads each part with a blank row: the active line, the day rows, the burn-up and the cumulative flow', () => {
    const keys = flowCard(viewOf({ stats })).map(row => row.key)
    const before = (part: string): string | undefined => keys[keys.indexOf(part) - 1]
    expect(keys[0]).toBe(`${FLOW_KEY}:active:gap`)
    expect(before(`${FLOW_KEY}:active:legend`)).toBe(`${FLOW_KEY}:active:gap`)
    expect(before(`${FLOW_KEY}:day:head`)).toBe(`${FLOW_KEY}:day:gap`)
    expect(before(`${FLOW_KEY}:burn:legend`)).toBe(`${FLOW_KEY}:burn:gap`)
    expect(before(`${FLOW_KEY}:cfd:legend`)).toBe(`${FLOW_KEY}:cfd:gap`)
    expect(flowCard(viewOf({ stats })).filter(row => row.key.endsWith(':gap')).map(row => row.spans)).toEqual([[], [], [], []])
  })

  test("marks a split in the range on a team's scope, never on the tree's or before the range", () => {
    const split = { day: '2026-10-28', from: 'acme', to: 'tools', tasks: 412 }
    const early = { day: '2026-10-01', from: 'acme', to: 'tools', tasks: 2 }
    const splits: StatsNumbers = { ...stats, splits: [early, split] }
    const card = flowCard(viewOf({ stats: splits, scope: { kind: 'team', team: 'tools' } }))
    expect(card.filter(row => row.key.includes(':split:')).map(lineOf)).toEqual(['  before 10-28: tree only, 412 tasks moved acme -> tools'])
    expect(card.slice(0, 2).map(row => row.key)).toEqual([`${FLOW_KEY}:split:0`, `${FLOW_KEY}:active:gap`])
    expect(flowCard(viewOf({ stats: splits })).some(row => row.key.includes(':split:'))).toBe(false)
  })

  test('dayLabel reads a day as its weekday and month-day', () => {
    expect([dayLabel('2026-10-31'), dayLabel('2026-11-02')]).toEqual(['Sat 10-31', 'Mon 11-02'])
  })
})

describe('statsBlocks: unread team folders', () => {
  test('draw a WARN line each under the pick rows, before the Health tiles', () => {
    const blocks = statsBlocks(viewOf({ failures: [{ team: 'tools', reason: 'EPERM.', isLastRead: true }] }), [], WIDE)
    expect(blocks.map(block => block.key)).toEqual(['stats:pick', 'stats:failure:tools', 'stats:health', FLOW_KEY])
    expect(blockOf(blocks, 'stats:failure:tools').rows.map(lineOf)).toEqual(['WARN team tools could not be read: EPERM; it shows as last read.'])
  })
})
