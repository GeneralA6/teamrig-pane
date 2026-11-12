// The Bottlenecks section's numbers (T1866): teamrig's areas fold (core register/area-stats.ts) made slim for the
// view. Each cell keeps only a count of its tasks; the tasks themselves become list rows kept apart by the cell's key,
// for a press to list, so the view never carries the register's tasks, which are heavy. Whether an area stands out is
// teamrig's standingOut, never worked out again here, so the section and `teamrig stats` cannot disagree. Pure.
import type { StatsArea, StatsAreaCell, StatsAreaGroup, StatsAreaPick, StatsAreas, StatsListRow } from '../types'
import { standingOut, type AreaGroup, type AreaMeasure, type AreaStats, type RegisterAreas, type StatsTask } from './core/read/index'

/** Each area cell's tasks as list rows, by areaListKey. */
export type AreaLists = ReadonlyMap<string, readonly StatsListRow[]>

/** The areas as the view holds them, and each cell's tasks as rows. */
export type SlimAreas = { readonly areas: StatsAreas; readonly lists: AreaLists }

/** Tasks as a list's rows, in the list's order. */
export type RowsOf = (tasks: readonly StatsTask[]) => StatsListRow[]

/** A cell's key among the area lists: `<team>/<session>:<measure>`, the session empty for a whole team. */
export function areaListKey({ team, session, measure }: StatsAreaPick): string {
  return `${team}/${session ?? ''}:${measure}`
}

/** `area` slim, each cell's tasks set in `lists` as rows. */
function slimArea(area: AreaStats, standsOut: boolean, lists: Map<string, readonly StatsListRow[]>, rowsOf: RowsOf): StatsArea {
  const { team, session } = area
  const cell = (measure: AreaMeasure): StatsAreaCell => {
    const { tasks, ...numbers } = area.cells[measure]
    lists.set(areaListKey({ team, session, measure }), rowsOf(tasks))
    return { ...numbers, listed: tasks.length }
  }
  return {
    team,
    session,
    active: area.active,
    standsOut,
    cells: { bugs: cell('bugs'), p1: cell('p1'), p1Late: cell('p1Late'), low: cell('low'), waits: cell('waits') },
  }
}

function slimGroup(group: AreaGroup, lists: Map<string, readonly StatsListRow[]>, rowsOf: RowsOf): StatsAreaGroup {
  const out = new Set(standingOut(group))
  return { median: group.median, areas: group.areas.map(area => slimArea(area, out.has(area), lists, rowsOf)) }
}

/** teamrig's areas as the view holds them, each cell's tasks made rows by `rowsOf` and kept by the cell's key. */
export function slimAreas(areas: RegisterAreas, rowsOf: RowsOf): SlimAreas {
  const lists = new Map<string, readonly StatsListRow[]>()
  return { areas: { teams: slimGroup(areas.teams, lists, rowsOf), sessions: slimGroup(areas.sessions, lists, rowsOf) }, lists }
}
