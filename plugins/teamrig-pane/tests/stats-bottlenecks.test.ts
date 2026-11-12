// The Stats tab's Bottlenecks section (hooks/stats-bottlenecks.ts): its header's count of the areas that stand out, the
// teams' and sessions' tables with their marks in their colours, each cell with tasks a press that lists them and each
// name a press that scopes the tab (but on its own scope), the median row, the line counting the rest, and the line an
// area a narrow pane draws.
import { describe, expect, test } from 'claude-code/testing'
import { readEvents, registerStats, TimeZone, type AreaMeasure, type HealthLevel, type RegisterHealth } from '../hooks/core/read/index'
import type { Row, Span } from '../hooks/rows'
import { slimAreas } from '../hooks/stats-areas'
import { BOTTLENECK_ROWS, BOTTLENECKS_KEY, bottlenecksHead, bottlenecksRows } from '../hooks/stats-bottlenecks'
import { goalsOf } from '../hooks/stats-source'
import { cells } from '../hooks/width'
import type { StatsArea, StatsAreaCell, StatsAreaGroup, StatsAreas, StatsChoice, StatsNumbers, StatsView } from '../types'
import { createLine, NOW } from './fixtures'

const WIDE = 100
const NARROW = 40

type Folded = Extract<StatsView, { kind: 'stats' }>

const EVENTS = readEvents(`${createLine('T1', { at: NOW, by: 'lead', owner: 'api', title: 'Add the route' })}\n`).events
const { tasks, goals, areas, ...TALLIES } = registerStats({ teams: [{ team: 'acme', lead: 'lead', events: EVENTS }], range: '7d', now: new Date(NOW), zone: TimeZone.UTC, ownerMarker: 'owner' })
const BASE: StatsNumbers = { ...TALLIES, goals: goalsOf(goals, TimeZone.UTC, TimeZone.UTC.day(new Date(NOW))), areas: slimAreas(areas, () => []).areas }
const HEALTH: RegisterHealth = {
  closeOpen: { level: 'good', ratio: 1 },
  backlog: { level: 'good', net: 0, active: 34 },
  overdue: { level: 'good', count: 0, p1: 0 },
  ownerDecisions: { level: 'good', count: 0, oldestDays: null },
  backlogClears: { level: 'good', weeks: 1 },
}

/** A cell of `value` at `level`, listing `listed` tasks (as many as its value unless set). */
function cell(value: number, level: HealthLevel = 'good', listed = value): StatsAreaCell {
  return { value, usual: value, level, listed }
}

const CALM: Readonly<Record<AreaMeasure, StatsAreaCell>> = { bugs: cell(0), p1: cell(0), p1Late: cell(0), low: cell(0), waits: cell(0) }

function area(team: string, session: string | null, active: number, over: Partial<Record<AreaMeasure, StatsAreaCell>> = {}, standsOut = false): StatsArea {
  return { team, session, active, standsOut, cells: { ...CALM, ...over } }
}

const MEDIAN = { active: 4, bugs: 0, p1: 0, p1Late: 0, low: 0, waits: 0 }

const TEAMS: StatsAreaGroup = { median: { ...MEDIAN, active: 17 }, areas: [area('acme', null, 30, { bugs: cell(6, 'bad') }, true), area('tools', null, 4)] }
/** Eight sessions, api standing out with red bugs and amber p1; cli's low share 50%, of 2 tasks. */
const SESSIONS: StatsAreaGroup = {
  median: MEDIAN,
  areas: [
    area('acme', 'api', 12, { bugs: cell(5, 'bad'), p1: cell(3, 'warn') }, true),
    area('acme', 'web', 8),
    area('tools', 'cli', 4, { low: cell(50, 'good', 2) }),
    area('acme', 'db', 4),
    area('acme', 'ops', 3),
    area('acme', 'qa', 2),
    area('tools', 'build', 1),
    area('acme', 'docs', 1),
  ],
}
const AREAS: StatsAreas = { teams: TEAMS, sessions: SESSIONS }
const NONE: StatsAreaGroup = { median: { ...MEDIAN, active: 0 }, areas: [] }

function viewOf(areas: StatsAreas = AREAS, scope: StatsChoice = { kind: 'tree' }): Folded {
  return { kind: 'stats', scope, range: '7d', teams: ['acme', 'tools'], stats: { ...BASE, areas }, health: HEALTH, list: null, week: null, failures: [] }
}

const lineOf = (row: Row): string => row.spans.map(span => span.text).join('')
const headOf = (view: Folded): string => bottlenecksHead(view).map(span => span.text).join(' | ')

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

/** A table line: the first column `first` cells wide, every other 9 (`p1 late` and the gap), the last unpadded. */
const tableLine = (first: number, name: string, values: readonly string[]): string => `  ${name.padEnd(first)}${values.map(value => value.padEnd(9)).join('').trimEnd()}`

describe('bottlenecksHead', () => {
  test('counts the areas that stand out in the groups drawn, teams and sessions alike', () => {
    expect(headOf(viewOf())).toBe('Bottlenecks | 2 areas stand out')
    expect(bottlenecksHead(viewOf())[0]?.bold).toBe(true)
  })

  test('leaves a lone team out, as it has no other team to stand against', () => {
    const one = { ...AREAS, teams: { ...TEAMS, areas: TEAMS.areas.slice(0, 1) } }
    expect(headOf(viewOf(one))).toBe('Bottlenecks | 1 area stands out')
  })

  test('says none stands out, and no active tasks with no area', () => {
    const calm = { teams: { ...TEAMS, areas: [area('acme', null, 30), area('tools', null, 4)] }, sessions: { ...SESSIONS, areas: [area('acme', 'api', 12)] } }
    expect(headOf(viewOf(calm))).toBe('Bottlenecks | none stands out')
    expect(headOf(viewOf({ teams: NONE, sessions: NONE }))).toBe('Bottlenecks | no active tasks')
  })
})

describe('bottlenecksRows: the tables', () => {
  const rows = bottlenecksRows(viewOf(), WIDE)
  const LABELS = ['active', 'bugs', 'p1', 'p1 late', 'low', 'waits']

  test('draw the teams, then the sessions, each under a dim header and over a dim median row', () => {
    expect(rows.map(row => row.key)).toEqual([
      `${BOTTLENECKS_KEY}:teams:head`,
      `${BOTTLENECKS_KEY}:teams:acme/`,
      `${BOTTLENECKS_KEY}:teams:tools/`,
      `${BOTTLENECKS_KEY}:teams:median`,
      `${BOTTLENECKS_KEY}:sessions:head`,
      ...['acme/api', 'acme/web', 'tools/cli', 'acme/db', 'acme/ops', 'acme/qa'].map(name => `${BOTTLENECKS_KEY}:sessions:${name}`),
      `${BOTTLENECKS_KEY}:sessions:median`,
      `${BOTTLENECKS_KEY}:sessions:more`,
    ])
    expect(lineOf(rowOf(rows, `${BOTTLENECKS_KEY}:teams:head`))).toBe(tableLine(8, 'teams', LABELS))
    expect(lineOf(rowOf(rows, `${BOTTLENECKS_KEY}:teams:acme/`))).toBe(tableLine(8, 'acme', ['30', '6▲', '0', '0', '0%', '0']))
    expect(lineOf(rowOf(rows, `${BOTTLENECKS_KEY}:sessions:head`))).toBe(tableLine(11, 'sessions', LABELS))
    expect(lineOf(rowOf(rows, `${BOTTLENECKS_KEY}:sessions:acme/api`))).toBe(tableLine(11, 'acme/api', ['12', '5▲', '3△', '0', '0%', '0']))
    expect(lineOf(rowOf(rows, `${BOTTLENECKS_KEY}:sessions:tools/cli`))).toBe(tableLine(11, 'tools/cli', ['4', '0', '0', '0', '50%', '0']))
    expect(lineOf(rowOf(rows, `${BOTTLENECKS_KEY}:sessions:median`))).toBe(tableLine(11, 'median', ['4', '0', '0', '0', '0%', '0']))
    expect(rowOf(rows, `${BOTTLENECKS_KEY}:sessions:median`).spans[1]?.dim).toBe(true)
    expect(rows.every(row => cells(lineOf(row)) <= WIDE)).toBe(true)
  })

  test('mark a red cell ▲ in the error colour and an amber one △ in the warning colour', () => {
    const api = rowOf(rows, `${BOTTLENECKS_KEY}:sessions:acme/api`)
    expect([spanOf(api, '▲').color, spanOf(api, '△').color]).toEqual(['error', 'warning'])
  })

  test('make a cell with tasks a press that lists them, and one with none plain', () => {
    const api = rowOf(rows, `${BOTTLENECKS_KEY}:sessions:acme/api`)
    expect(spanOf(api, '5').stats).toEqual({ kind: 'list', list: { team: 'acme', session: 'api', measure: 'bugs' } })
    expect(spanOf(rowOf(rows, `${BOTTLENECKS_KEY}:teams:acme/`), '6').stats).toEqual({ kind: 'list', list: { team: 'acme', session: null, measure: 'bugs' } })
    expect(spanOf(rowOf(rows, `${BOTTLENECKS_KEY}:sessions:tools/cli`), '50%').stats).toEqual({ kind: 'list', list: { team: 'tools', session: 'cli', measure: 'low' } })
    expect(spanOf(rowOf(rows, `${BOTTLENECKS_KEY}:sessions:acme/web`), '0').stats).toBe(undefined)
  })

  test("make each name a press that scopes the tab to it, but the tab's own scope", () => {
    expect(spanOf(rowOf(rows, `${BOTTLENECKS_KEY}:teams:acme/`), 'acme').stats).toEqual({ kind: 'scope', scope: { kind: 'team', team: 'acme' } })
    expect(spanOf(rowOf(rows, `${BOTTLENECKS_KEY}:sessions:acme/api`), 'acme/api').stats).toEqual({ kind: 'scope', scope: { kind: 'session', team: 'acme', session: 'api' } })
    const own = bottlenecksRows(viewOf(AREAS, { kind: 'session', team: 'acme', session: 'api' }), WIDE)
    expect(spanOf(rowOf(own, `${BOTTLENECKS_KEY}:sessions:acme/api`), 'acme/api').stats).toBe(undefined)
    const team = bottlenecksRows(viewOf(AREAS, { kind: 'team', team: 'acme' }), WIDE)
    expect(spanOf(rowOf(team, `${BOTTLENECKS_KEY}:teams:acme/`), 'acme').stats).toBe(undefined)
  })

  test(`draw BOTTLENECK_ROWS areas a group and count the rest`, () => {
    expect(BOTTLENECK_ROWS).toBe(6)
    expect(lineOf(rowOf(rows, `${BOTTLENECKS_KEY}:sessions:more`))).toBe('  2 more sessions')
    expect(rows.some(row => row.key === `${BOTTLENECKS_KEY}:teams:more`)).toBe(false)
  })

  test('leave out a lone team and name the sessions without their team', () => {
    const one = bottlenecksRows(viewOf({ ...AREAS, teams: { ...TEAMS, areas: TEAMS.areas.slice(0, 1) } }), WIDE)
    expect(one.some(row => row.key.startsWith(`${BOTTLENECKS_KEY}:teams:`))).toBe(false)
    expect(lineOf(rowOf(one, `${BOTTLENECKS_KEY}:sessions:acme/api`))).toBe(tableLine(10, 'api', ['12', '5▲', '3△', '0', '0%', '0']))
  })

  test('say so with no active task', () => {
    expect(bottlenecksRows(viewOf({ teams: NONE, sessions: NONE }), WIDE).map(lineOf)).toEqual(['  No task is active.'])
  })
})

describe('bottlenecksRows: a narrow pane', () => {
  test('draws a line an area, hanging its wraps, with its marks and presses, then the median', () => {
    const rows = bottlenecksRows(viewOf(), NARROW)
    const api = rowOf(rows, `${BOTTLENECKS_KEY}:sessions:acme/api`)
    expect(lineOf(api)).toBe('  acme/api  active 12 · bugs 5▲ · p1 3△ · p1 late 0 · low 0% · waits 0')
    expect(api.hang?.text).toBe('    ')
    expect(spanOf(api, '▲').color).toBe('error')
    expect(spanOf(api, '5').stats).toEqual({ kind: 'list', list: { team: 'acme', session: 'api', measure: 'bugs' } })
    expect(lineOf(rowOf(rows, `${BOTTLENECKS_KEY}:sessions:median`))).toBe('  median  active 4 · bugs 0 · p1 0 · p1 late 0 · low 0% · waits 0')
    expect(rows.some(row => row.key.endsWith(':head'))).toBe(false)
  })
})
