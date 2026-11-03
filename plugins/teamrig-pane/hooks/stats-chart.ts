// The Stats tab's charts in text cells, as the pane draws everything (stats-rows.ts lays them out and colours them):
// the active tasks at each day's end as a line of box-drawing strokes, a burn-up of the work created and closed whose
// gap is the backlog, the cumulative flow (the active work stacked by status), and a bar in eighths of a cell. Pure:
// days in, rows out, each row's cells in runs that name the series they draw so its rows can colour them. A chart fits
// its days into the width it gets: MIN_DAY_CELLS to MAX_DAY_CELLS columns a day while they fit, past that the days in
// even buckets of MIN_DAY_CELLS columns, each drawn at its last day's end. The burn-up and the flow leave each point's
// last column blank, so two days' bars never touch; the active line runs through it.
import { STATS_ACTIVE_STATUSES, type ActiveCounts, type ActiveStatus, type StatsDay } from './core/read/index'

/** A run of a chart row's cells in one series' look; `series` null for cells no series fills, drawn blank. */
export type ChartRun<S extends string> = { readonly text: string; readonly series: S | null }
/** One row of a chart: its value on the axis, right-aligned and ending in ` ┤`, then its plot's cells in runs, blank cells at its end left out. */
export type ChartRow<S extends string> = { readonly axis: string; readonly runs: readonly ChartRun<S>[] }
/**
 * A chart, its rows top to bottom; under them `days`, each `MM-DD` under its first column, at least LABEL_GAP cells
 * apart, and `limits`, a `$` under each day the week sat at its usage limit (null with none), both led by the axis's
 * width in spaces so they line up with the plot.
 */
export type Chart<S extends string> = { readonly rows: readonly ChartRow<S>[]; readonly days: string; readonly limits: string | null }
/** What a chart plots in one group of its columns: a day, or a bucket of days at its last one, and whether any sat at the limit. */
export type ChartPoint<V> = { readonly day: string; readonly atLimit: boolean; readonly value: V }
/** The points a chart draws and how many columns each takes. */
export type Fit<V> = { readonly points: readonly ChartPoint<V>[]; readonly per: number }

/** The series of the active-tasks line. */
export type LineSeries = 'active'
/** The series of the burn-up: the created line, the closed line, and a cell both lines share (no backlog that day). */
export type BurnSeries = 'created' | 'closed' | 'both'

/** The most rows a line or burn-up chart takes; fewer for a top under it, one row a task. */
export const LINE_HEIGHT = 8
/** The most rows the cumulative flow takes; fewer for a top under it, one row a task. */
export const FLOW_HEIGHT = 10
/** The most columns one day takes, so a short range does not stretch into wide steps. */
export const MAX_DAY_CELLS = 4
/** The fewest columns one point takes: its bar and the blank column after it. */
export const MIN_DAY_CELLS = 2
/** The fewest blank cells between two day labels. */
export const LABEL_GAP = 1
/** The burn-up's cell for each of its series. */
export const BURN_GLYPH: Readonly<Record<BurnSeries, string>> = { created: '▀', closed: '▄', both: '█' }
/** The cumulative flow's cell for each status's band. */
export const FLOW_GLYPH: Readonly<Record<ActiveStatus, string>> = { verifying: '█', 'in-progress': '▓', waiting: '▒', open: '░' }
/** The flow's bands bottom to top: the work nearest done at the foot, the open work, what grows, on top. */
export const FLOW_STACK: readonly ActiveStatus[] = ['verifying', 'in-progress', 'waiting', 'open']

/** Ends each axis label. */
const AXIS_END = ' ┤'
/** A bar's last partial cell, by eighths: one eighth to seven. */
const EIGHTHS = '▏▎▍▌▋▊▉'
const FULL = '█'

/** One plotted cell: its glyph and the series it draws. */
type Cell<S extends string> = { readonly glyph: string; readonly series: S }
/** One column's cells by level, 0 the bottom row; a level it lacks is blank. */
type Column<S extends string> = ReadonlyMap<number, Cell<S>>

/** The tasks active in any status. */
export function activeTotal(active: ActiveCounts): number {
  return STATS_ACTIVE_STATUSES.reduce((sum, status) => sum + active[status], 0)
}

/**
 * `value` as a bar `width` cells long at `max`, in full blocks and a last cell in eighths: a value above zero shows at
 * least one eighth, zero (or nothing to scale by) no bar.
 */
export function bar(value: number, max: number, width: number): string {
  if (value <= 0 || max <= 0 || width <= 0) return ''
  const eighths = Math.max(1, Math.round((Math.min(value, max) / max) * width * 8))
  return FULL.repeat(Math.floor(eighths / 8)) + EIGHTHS.charAt((eighths % 8) - 1)
}

/**
 * `daily` (one point a day, oldest first) fitted into `room` columns: each day its own point, as many columns each as
 * fit up to MAX_DAY_CELLS, while there are MIN_DAY_CELLS columns a day; past that, even buckets of days MIN_DAY_CELLS
 * columns each, each at its last day's value and day (a day's end, as every chart here plots), at the limit if any of
 * its days was. A room under MIN_DAY_CELLS gives its one column to each point.
 */
export function fitPoints<V>(daily: readonly ChartPoint<V>[], room: number): Fit<V> {
  const count = daily.length
  const slots = Math.max(1, Math.floor(room / MIN_DAY_CELLS))
  if (count <= slots) return { points: daily, per: Math.min(MAX_DAY_CELLS, Math.max(1, Math.floor(room / Math.max(count, 1)))) }
  const points = Array.from({ length: slots }, (_, index) => daily.slice(Math.floor((index * count) / slots), Math.floor(((index + 1) * count) / slots))).flatMap(
    (bucket): ChartPoint<V>[] => {
      const last = bucket[bucket.length - 1]
      return last === undefined ? [] : [{ day: last.day, atLimit: bucket.some(point => point.atLimit), value: last.value }]
    },
  )
  return { points, per: Math.max(1, Math.min(MIN_DAY_CELLS, room)) }
}

/**
 * The active tasks at each day's end as a line: a level a value (0 the bottom row, the range's top the top one), `─`
 * along a level, a step up `╯` at the old level, `╭` at the new and `│` between, a step down `╮`, `╰` and `│`.
 */
export function activeChart(days: readonly StatsDay[], width: number): Chart<LineSeries> {
  const values = days.map(day => activeTotal(day.active))
  const top = Math.max(0, ...values)
  const height = Math.min(LINE_HEIGHT, top + 1)
  return chartOf(days, values, levelLabels(top, height), width, false, columns => lineColumns(columns.map(value => levelOf(value, top, height))))
}

/**
 * The burn-up: the closed line, every close (done or dropped) from the range's first day, `▄`; the created line, the
 * closed line plus the tasks active at the day's end, `▀`, so the gap between them is the backlog; `█` where both
 * fall in one cell.
 */
export function burnUpChart(days: readonly StatsDay[], width: number): Chart<BurnSeries> {
  let closed = 0
  const values = days.map(day => {
    closed += day.done + day.dropped
    return { closed, created: closed + activeTotal(day.active) }
  })
  const top = Math.max(0, ...values.map(value => value.created))
  const height = Math.min(LINE_HEIGHT, top + 1)
  return chartOf(days, values, levelLabels(top, height), width, true, columns =>
    columns.map((value): Column<BurnSeries> => {
      const createdAt = levelOf(value.created, top, height)
      const closedAt = levelOf(value.closed, top, height)
      if (createdAt === closedAt) return new Map([[createdAt, burnCell('both')]])
      return new Map([
        [createdAt, burnCell('created')],
        [closedAt, burnCell('closed')],
      ])
    }),
  )
}

/**
 * The cumulative flow: the tasks active at each day's end stacked by status (FLOW_STACK), each row a band of the range's
 * top, each cell the status whose band holds its row's middle, blank above the day's total.
 */
export function flowChart(days: readonly StatsDay[], width: number): Chart<ActiveStatus> {
  const top = Math.max(0, ...days.map(day => activeTotal(day.active)))
  const height = Math.max(1, Math.min(FLOW_HEIGHT, top))
  const labels = Array.from({ length: height }, (_, row) => Math.round((top * (height - row)) / height))
  return chartOf(
    days,
    days.map(day => day.active),
    labels,
    width,
    true,
    columns => columns.map(active => flowColumn(active, top, height)),
  )
}

/** A day's cells in the flow: each row's middle in the band of the first status whose running total passes it. */
function flowColumn(active: ActiveCounts, top: number, height: number): Column<ActiveStatus> {
  const column = new Map<number, Cell<ActiveStatus>>()
  for (let level = 0; level < height; level++) {
    const middle = ((level + 0.5) * top) / height
    let below = 0
    const status = FLOW_STACK.find(band => {
      below += active[band]
      return middle < below
    })
    if (status !== undefined) column.set(level, { glyph: FLOW_GLYPH[status], series: status })
  }
  return column
}

const burnCell = (series: BurnSeries): Cell<BurnSeries> => ({ glyph: BURN_GLYPH[series], series })

/** A value's level in a chart of `height` rows from 0 to `top`: 0 with nothing to scale by. */
function levelOf(value: number, top: number, height: number): number {
  return top === 0 ? 0 : Math.round((value / top) * (height - 1))
}

/** The values a line chart's rows stand for, top to bottom: `top` down to 0 in even steps. */
function levelLabels(top: number, height: number): number[] {
  return Array.from({ length: height }, (_, row) => (height === 1 ? top : Math.round((top * (height - 1 - row)) / (height - 1))))
}

/** A line through `levels`, one a column: each column draws the step from the column before it. */
function lineColumns(levels: readonly number[]): Column<LineSeries>[] {
  return levels.map((level, index, all) => {
    const before = all[index - 1] ?? level
    const column = new Map<number, Cell<LineSeries>>()
    const put = (at: number, glyph: string) => column.set(at, { glyph, series: 'active' })
    if (level === before) put(level, '─')
    else {
      const up = level > before
      for (let at = Math.min(level, before) + 1; at < Math.max(level, before); at++) put(at, '│')
      put(before, up ? '╯' : '╮')
      put(level, up ? '╭' : '╰')
    }
    return column
  })
}

/**
 * A chart of `values` (one a day of `days`) in `width` cells: the axis of `labels` (top to bottom, one a row), the
 * points fitted into the room right of it, each point's value repeated over its columns for `draw` to turn into cells;
 * `gapped`, each point's last column left blank where a point has MIN_DAY_CELLS or more.
 */
function chartOf<V, S extends string>(
  days: readonly StatsDay[],
  values: readonly V[],
  labels: readonly number[],
  width: number,
  gapped: boolean,
  draw: (columns: readonly V[]) => Column<S>[],
): Chart<S> {
  const digits = Math.max(1, ...labels.map(label => String(label).length))
  const axisWidth = digits + AXIS_END.length
  const room = Math.max(1, width - axisWidth)
  const daily = days.flatMap((day, index): ChartPoint<V>[] => {
    const value = values[index]
    return value === undefined ? [] : [{ day: day.day, atLimit: day.atLimit, value }]
  })
  const { points, per } = fitPoints(daily, room)
  const drawn = draw(points.flatMap(point => Array.from({ length: per }, () => point.value)))
  const columns = gapped && per >= MIN_DAY_CELLS ? drawn.map((column, index) => (index % per === per - 1 ? new Map<number, Cell<S>>() : column)) : drawn
  const rows = labels.map((label, row): ChartRow<S> => {
    const level = labels.length - 1 - row
    return { axis: String(label).padStart(digits) + AXIS_END, runs: runsOf(columns.map(column => column.get(level) ?? null)) }
  })
  const lead = ' '.repeat(axisWidth)
  const limits = limitLine(points, per)
  return { rows, days: lead + dayLine(points, per, room), limits: limits === null ? null : lead + limits }
}

/** A row's cells merged into runs of one series each, blank cells at its end left out. */
function runsOf<S extends string>(cells: readonly (Cell<S> | null)[]): ChartRun<S>[] {
  const runs: { text: string; series: S | null }[] = []
  for (const cell of cells) {
    const series = cell === null ? null : cell.series
    const last = runs[runs.length - 1]
    if (last !== undefined && last.series === series) last.text += cell === null ? ' ' : cell.glyph
    else runs.push({ text: cell === null ? ' ' : cell.glyph, series })
  }
  if (runs[runs.length - 1]?.series === null) runs.pop()
  return runs
}

/** Each point's `MM-DD` under its first column, left to right, where it fits in `room` at least LABEL_GAP past the last. */
function dayLine(points: readonly ChartPoint<unknown>[], per: number, room: number): string {
  let line = ''
  points.forEach((point, index) => {
    const label = point.day.slice(5)
    const column = index * per
    if ((line === '' || column >= line.length + LABEL_GAP) && column + label.length <= room) line = line.padEnd(column) + label
  })
  return line
}

/** A `$` under the first column of each point at the week's usage limit; null with none. */
function limitLine(points: readonly ChartPoint<unknown>[], per: number): string | null {
  let line = ''
  points.forEach((point, index) => {
    if (point.atLimit) line = line.padEnd(index * per) + '$'
  })
  return line === '' ? null : line
}
