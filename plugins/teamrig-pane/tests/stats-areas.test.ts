// The Bottlenecks section's numbers (hooks/stats-areas.ts): teamrig's areas fold made slim. Each cell keeps a count
// of its tasks and loses the tasks; the tasks become rows kept apart by the cell's key; whether an area stands out is
// teamrig's standingOut.
import { describe, expect, test } from 'claude-code/testing'
import { readEvents, registerStats, standingOut, TimeZone, type RegisterAreas, type StatsTask } from '../hooks/core/read/index'
import { areaListKey, slimAreas } from '../hooks/stats-areas'
import type { StatsListRow } from '../types'
import { createLine, NOW } from './fixtures'

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** api holds two p1 bugs opened today, one past its due date, so it stands out; dev a p3 task, tools' ops one p2 task. */
const ACME = [
  createLine('T1', { at: NOW - HOUR, by: 'lead', owner: 'api', priority: 1, due: '2026-10-10', taskKeys: { type: 'bug' } }),
  createLine('T2', { at: NOW - HOUR, by: 'lead', owner: 'api', priority: 1, taskKeys: { type: 'bug' } }),
  createLine('T3', { at: NOW - DAY, by: 'lead', owner: 'dev', priority: 3 }),
]
const TOOLS = [createLine('T1', { at: NOW - DAY, by: 'lead', owner: 'ops', priority: 2 })]

const eventsOf = (lines: readonly string[]) => readEvents(lines.map(line => `${line}\n`).join('')).events

/** teamrig's areas over acme and tools now. */
const AREAS: RegisterAreas = registerStats({
  teams: [
    { team: 'acme', lead: 'lead', events: eventsOf(ACME) },
    { team: 'tools', lead: 'lead', events: eventsOf(TOOLS) },
  ],
  range: '7d',
  now: new Date(NOW),
  zone: TimeZone.UTC,
  ownerMarker: 'owner',
}).areas

/** A task as a bare row: enough to tell which tasks a list got, and in what order. */
const rowsOf = (tasks: readonly StatsTask[]): StatsListRow[] =>
  tasks.map(({ team, task }) => ({ team, id: task.id, title: task.title, owner: task.owner, status: task.status, priority: task.priority, due: task.due }))

const idsAt = (lists: ReadonlyMap<string, readonly StatsListRow[]>, key: string) => lists.get(key)?.map(row => `${row.team}/${row.id}`)

describe('slimAreas', () => {
  test("keeps each cell's numbers and counts its tasks, never the tasks themselves", () => {
    const { areas } = slimAreas(AREAS, rowsOf)
    const api = areas.sessions.areas.find(area => area.session === 'api')
    const bugs = AREAS.sessions.areas.find(area => area.session === 'api')?.cells.bugs
    expect(api?.cells.bugs).toEqual({ value: bugs?.value, usual: bugs?.usual, level: bugs?.level, listed: 2 })
    expect(JSON.stringify(areas)).not.toContain('"tasks"')
  })

  test("keeps teamrig's order and medians, the teams and the sessions apart", () => {
    const { areas } = slimAreas(AREAS, rowsOf)
    expect(areas.teams.areas.map(area => [area.team, area.session, area.active])).toEqual(AREAS.teams.areas.map(area => [area.team, area.session, area.active]))
    expect(areas.sessions.areas.map(area => area.session)).toEqual(AREAS.sessions.areas.map(area => area.session))
    expect([areas.teams.median, areas.sessions.median]).toEqual([AREAS.teams.median, AREAS.sessions.median])
  })

  test("sets each cell's tasks as rows by its key, a team's with an empty session", () => {
    const { lists } = slimAreas(AREAS, rowsOf)
    expect(idsAt(lists, areaListKey({ team: 'acme', session: 'api', measure: 'bugs' }))).toEqual(['acme/T1', 'acme/T2'])
    expect(idsAt(lists, areaListKey({ team: 'acme', session: 'api', measure: 'p1Late' }))).toEqual(['acme/T1'])
    expect(idsAt(lists, areaListKey({ team: 'acme', session: null, measure: 'low' }))).toEqual(['acme/T3'])
    expect(idsAt(lists, areaListKey({ team: 'tools', session: 'ops', measure: 'bugs' }))).toEqual([])
    expect(areaListKey({ team: 'acme', session: null, measure: 'low' })).toBe('acme/:low')
    expect(areaListKey({ team: 'acme', session: 'api', measure: 'p1Late' })).toBe('acme/api:p1Late')
  })

  test("marks the areas teamrig's standingOut names, and only those", () => {
    const { areas } = slimAreas(AREAS, rowsOf)
    const out = (group: RegisterAreas['sessions']) => standingOut(group).map(area => `${area.team}/${area.session ?? ''}`)
    const marked = (group: typeof areas.sessions) => group.areas.filter(area => area.standsOut).map(area => `${area.team}/${area.session ?? ''}`)
    expect(marked(areas.sessions)).toEqual(out(AREAS.sessions))
    expect(marked(areas.teams)).toEqual(out(AREAS.teams))
    expect(marked(areas.sessions)).toContain('acme/api')
  })
})
