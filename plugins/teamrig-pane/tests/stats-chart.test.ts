// The Stats tab's text charts (hooks/stats-chart.ts): the active-tasks line in box strokes, the burn-up whose gap is the
// backlog, the cumulative flow stacked by status, bars in eighths, and how a chart fits its days into the width it gets.
import { describe, expect, test } from 'claude-code/testing'
import type { ActiveCounts, StatsDay } from '../hooks/core/read/index'
import { activeChart, bar, burnUpChart, fitPoints, flowChart, type Chart, type ChartPoint } from '../hooks/stats-chart'
import { cells } from '../hooks/width'

const IDLE: ActiveCounts = { open: 0, 'in-progress': 0, verifying: 0, waiting: 0 }

/** Day `n` of October, its tasks active at its end, and its counts. */
function day(n: number, active: Partial<ActiveCounts>, counts: { opened?: number; done?: number; dropped?: number; atLimit?: boolean } = {}): StatsDay {
  return {
    day: `2026-10-${String(n).padStart(2, '0')}`,
    opened: counts.opened ?? 0,
    done: counts.done ?? 0,
    dropped: counts.dropped ?? 0,
    active: { ...IDLE, ...active },
    atLimit: counts.atLimit ?? false,
  }
}

/** One day a value, all open: the line chart's input. */
const openDays = (values: readonly number[]): StatsDay[] => values.map((open, index) => day(index + 1, { open }))
/** Each row as its axis and its cells, as drawn. */
const lines = <S extends string>(chart: Chart<S>): string[] => chart.rows.map(row => row.axis + row.runs.map(run => run.text).join(''))

describe('activeChart', () => {
  test('draws a rise and a fall in box strokes, a row a task under a top of 8', () => {
    const chart = activeChart(openDays([0, 1, 3, 3, 2]), 13)
    expect(lines(chart)).toEqual(['3 ┤    ╭───╮', '2 ┤    │   ╰─', '1 ┤  ╭─╯', '0 ┤──╯'])
    expect(chart.rows[0]?.runs).toEqual([
      { text: '    ', series: null },
      { text: '╭───╮', series: 'active' },
    ])
    expect(chart.days).toBe('   10-01')
    expect(chart.limits).toBeNull()
  })

  test('labels 8 even rows from the top to 0, right-aligned', () => {
    const chart = activeChart(openDays([170, 596]), 40)
    expect(chart.rows.map(row => row.axis)).toEqual(['596 ┤', '511 ┤', '426 ┤', '341 ┤', '255 ┤', '170 ┤', ' 85 ┤', '  0 ┤'])
  })

  test('widens each day up to 4 columns and spaces the day labels at least 6 cells apart', () => {
    const chart = activeChart(openDays([0, 1, 3, 3, 2]), 14)
    expect(lines(chart)).toEqual(['3 ┤    ╭───╮', '2 ┤    │   ╰─', '1 ┤  ╭─╯', '0 ┤──╯'])
    expect(chart.days).toBe('   10-01 10-04')
    expect(lines(activeChart(openDays([2]), 20))).toEqual(['2 ┤────', '1 ┤', '0 ┤'])
  })

  test('draws nothing to scale as a flat line on one 0 row, and no days as an empty axis', () => {
    expect(lines(activeChart(openDays([0, 0, 0]), 9))).toEqual(['0 ┤──────'])
    const empty = activeChart([], 10)
    expect(lines(empty)).toEqual(['0 ┤'])
    expect(empty.days).toBe('   ')
  })

  test('marks each day at the usage limit with a $ under its column', () => {
    const days = [day(1, { open: 1 }), day(2, { open: 2 }), day(3, { open: 1 }, { atLimit: true })]
    expect(activeChart(days, 9).limits).toBe('       $')
  })

  test('never draws past its width, however many days it gets', () => {
    const chart = activeChart(
      openDays(Array.from({ length: 100 }, (_, index) => (index * 7) % 23)),
      20,
    )
    for (const row of lines(chart)) expect(cells(row) <= 20).toBe(true)
    expect(cells(chart.days) <= 20).toBe(true)
  })
})

describe('fitPoints', () => {
  const points = (count: number, limitAt: number | null): ChartPoint<number>[] =>
    Array.from({ length: count }, (_, index) => ({ day: `2026-10-${String(index + 1).padStart(2, '0')}`, atLimit: index === limitAt, value: index }))

  test('gives each day its own point while each gets 2 columns, up to 4 columns each', () => {
    expect(fitPoints(points(3, null), 7)).toEqual({ points: points(3, null), per: 2 })
    expect(fitPoints(points(2, null), 40).per).toBe(4)
    expect(fitPoints(points(5, null), 10)).toEqual({ points: points(5, null), per: 2 })
    expect(fitPoints(points(5, null), 9).points).toHaveLength(4)
  })

  test('past the width, buckets the days evenly 2 columns each, each at its last day, at the limit if any of its days was', () => {
    const fit = fitPoints(points(10, 3), 8)
    expect(fit.per).toBe(2)
    expect(fit.points).toEqual([
      { day: '2026-10-02', atLimit: false, value: 1 },
      { day: '2026-10-05', atLimit: true, value: 4 },
      { day: '2026-10-07', atLimit: false, value: 6 },
      { day: '2026-10-10', atLimit: false, value: 9 },
    ])
  })

  test('gives a room of one column to one bucket of all the days', () => {
    expect(fitPoints(points(3, null), 1)).toEqual({ points: [{ day: '2026-10-03', atLimit: false, value: 2 }], per: 1 })
  })
})

describe('burnUpChart', () => {
  test('draws the closes so far under the created line, the gap the active tasks, and both in one cell as a block', () => {
    const days = [
      day(1, { open: 2 }, { done: 1 }),
      day(2, { open: 2, verifying: 1 }, { dropped: 1 }),
      day(3, { waiting: 1 }, { done: 2 }),
      day(4, {}, { done: 1 }),
    ]
    const chart = burnUpChart(days, 11)
    expect(lines(chart)).toEqual(['5 ┤  ▀ ▀ █', '4 ┤    ▄', '3 ┤▀', '2 ┤  ▄', '1 ┤▄', '0 ┤'])
    expect(chart.rows[0]?.runs).toEqual([
      { text: '  ', series: null },
      { text: '▀', series: 'created' },
      { text: ' ', series: null },
      { text: '▀', series: 'created' },
      { text: ' ', series: null },
      { text: '█', series: 'both' },
    ])
    expect(chart.rows[1]?.runs).toEqual([
      { text: '    ', series: null },
      { text: '▄', series: 'closed' },
    ])
  })
})

describe('flowChart', () => {
  test('stacks each day by status, verifying at the foot and open on top, a cell the band holding its row, a blank column between days', () => {
    const days = [day(1, { verifying: 1, open: 2 }), day(2, { 'in-progress': 1, waiting: 1, open: 1 }), day(3, { open: 1 })]
    const chart = flowChart(days, 9)
    expect(lines(chart)).toEqual(['3 ┤░ ░', '2 ┤░ ▒', '1 ┤█ ▓ ░'])
    expect(chart.rows[2]?.runs).toEqual([
      { text: '█', series: 'verifying' },
      { text: ' ', series: null },
      { text: '▓', series: 'in-progress' },
      { text: ' ', series: null },
      { text: '░', series: 'open' },
    ])
  })

  test('takes at most 10 rows, each a tenth of the top, and one empty row with nothing active', () => {
    const chart = flowChart([day(1, { open: 50, waiting: 50 })], 10)
    expect(chart.rows.map(row => row.axis)).toEqual(['100 ┤', ' 90 ┤', ' 80 ┤', ' 70 ┤', ' 60 ┤', ' 50 ┤', ' 40 ┤', ' 30 ┤', ' 20 ┤', ' 10 ┤'])
    expect(lines(chart).slice(4)).toEqual([' 60 ┤░░░', ' 50 ┤▒▒▒', ' 40 ┤▒▒▒', ' 30 ┤▒▒▒', ' 20 ┤▒▒▒', ' 10 ┤▒▒▒'])
    expect(lines(flowChart([day(1, {})], 10))).toEqual(['0 ┤'])
  })
})

describe('bar', () => {
  test('draws full blocks and a last cell in eighths, at least an eighth above zero, nothing at zero', () => {
    expect(bar(8, 8, 4)).toBe('████')
    expect(bar(5, 8, 4)).toBe('██▌')
    expect(bar(1, 8, 4)).toBe('▌')
    expect(bar(1, 1000, 4)).toBe('▏')
    expect(bar(0, 8, 4)).toBe('')
    expect(bar(3, 0, 4)).toBe('')
    expect(bar(12, 8, 4)).toBe('████')
  })
})
