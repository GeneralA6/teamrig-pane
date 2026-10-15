import { describe, expect, test } from 'claude-code/testing'
import type { BarStatus, Snapshot, TaskRow } from '../types'
import { readRegister } from '../hooks/core/read/index'
import { rowOf } from '../hooks/log'
import { BAR_STATUSES, barCells, barCounts, inlineBarRows, statusBar, utcDay, type BarCounts, type BarPiece } from '../hooks/status-bar'
import { cells } from '../hooks/width'
import { HOUR, NOW, createLine, statusLine } from './fixtures'

const DAY = 24 * HOUR
/** The start of NOW's UTC day. */
const MIDNIGHT = Date.UTC(2026, 9, 13)

function countsOf(partial: Partial<Record<BarStatus, number>>): BarCounts {
  return { 'done-today': 0, verifying: 0, working: 0, blocked: 0, 'not-started': 0, ...partial }
}

/** The cells of each status with any, in bar order. */
function widthsOf(partial: Partial<Record<BarStatus, number>>, width: number): [BarStatus, number][] {
  const out = barCells(countsOf(partial), width)
  return BAR_STATUSES.filter(status => out[status] > 0).map(status => [status, out[status]])
}

function rowsOf(...lines: string[]): TaskRow[] {
  return [...readRegister(lines.join('\n')).state.tasks.values()].map(task => rowOf(task, []))
}

const snapshotOf = (tasks: TaskRow[], area: string | null, now = NOW): Snapshot => ({
  tasks,
  area,
  areaSource: 'inbox-read',
  unreadInbox: 0,
  problem: null,
  now,
})

const textOf = (line: readonly BarPiece[] | undefined) => (line ?? []).map(piece => piece.text).join('')

describe('status bar cells', () => {
  test('one status fills the bar; even shares split it evenly', async () => {
    expect(widthsOf({ working: 3 }, 10)).toEqual([['working', 10]])
    expect(widthsOf({ 'done-today': 1, verifying: 1, working: 1, blocked: 1 }, 8)).toEqual([
      ['done-today', 2],
      ['verifying', 2],
      ['working', 2],
      ['blocked', 2],
    ])
  })

  test('the cells left after the whole shares go to the largest remainders, a tie to the earlier status', async () => {
    // 3/7/2/4/9 of 25 in 48 cells: whole shares 5/13/3/7/17 leave 3 cells, for remainders 19, 21 and 17 of 25.
    expect(widthsOf({ 'done-today': 3, verifying: 7, working: 2, blocked: 4, 'not-started': 9 }, 48)).toEqual([
      ['done-today', 6],
      ['verifying', 13],
      ['working', 4],
      ['blocked', 8],
      ['not-started', 17],
    ])
    expect(widthsOf({ verifying: 1, working: 1, blocked: 1 }, 4)).toEqual([
      ['verifying', 2],
      ['working', 1],
      ['blocked', 1],
    ])
  })

  test('a tiny share still gets a cell, taken from the widest segment', async () => {
    expect(widthsOf({ 'done-today': 1, 'not-started': 999 }, 10)).toEqual([
      ['done-today', 1],
      ['not-started', 9],
    ])
    expect(widthsOf({ 'done-today': 1, verifying: 1, 'not-started': 998 }, 3)).toEqual([
      ['done-today', 1],
      ['verifying', 1],
      ['not-started', 1],
    ])
  })

  test('a bar narrower than its statuses gives one cell each to the largest counts, a tie to the earlier; no width, no cells', async () => {
    const counts = { 'done-today': 1, verifying: 5, working: 2, blocked: 5, 'not-started': 1 }
    expect(widthsOf(counts, 3)).toEqual([
      ['verifying', 1],
      ['working', 1],
      ['blocked', 1],
    ])
    expect(widthsOf(counts, 1)).toEqual([['verifying', 1]])
    expect(widthsOf(counts, 0)).toEqual([])
    expect(widthsOf({}, 10)).toEqual([])
  })

  test('every mix fills the bar exactly and keeps a cell for each status with tasks', async () => {
    for (const width of [5, 7, 13, 48]) {
      for (const big of [1, 2, 9, 40, 997]) {
        for (const small of [0, 1, 3]) {
          const counts = countsOf({ 'done-today': small, verifying: big, working: small * 2, blocked: 1, 'not-started': big + small })
          const out = barCells(counts, width)
          expect(BAR_STATUSES.reduce((sum, status) => sum + out[status], 0)).toBe(width)
          expect(BAR_STATUSES.every(status => (counts[status] > 0) === (out[status] > 0))).toBe(true)
        }
      }
    }
  })
})

describe('status bar counts', () => {
  test('counts the area\'s own tasks by status, today\'s done ones only, never dropped ones or other owners\'', async () => {
    const tasks = rowsOf(
      createLine('T1', { owner: 'po', by: 'po', at: NOW - HOUR }),
      createLine('T2', { owner: 'po', by: 'po', at: NOW - HOUR }),
      statusLine('T2', 'po', NOW, 'in-progress'),
      createLine('T3', { owner: 'po', by: 'po', at: NOW - HOUR }),
      statusLine('T3', 'po', NOW, 'verifying', 'health check passes'),
      createLine('T4', { owner: 'po', by: 'po', at: NOW - HOUR }),
      statusLine('T4', 'po', NOW, 'blocked', 'waits on the owner'),
      createLine('T5', { owner: 'po', by: 'po', at: NOW - HOUR }),
      statusLine('T5', 'po', NOW, 'done'),
      createLine('T6', { owner: 'po', by: 'po', at: NOW - HOUR }),
      statusLine('T6', 'po', NOW, 'dropped', 'not needed'),
      createLine('T7', { owner: 'etl', by: 'po', at: NOW - HOUR }),
    )
    expect(barCounts(tasks, 'po', NOW)).toEqual(countsOf({ 'done-today': 1, verifying: 1, working: 1, blocked: 1, 'not-started': 1 }))
  })

  test('today is the UTC day of the clock: a task done a minute before midnight is not done today', async () => {
    const tasks = rowsOf(
      createLine('T1', { owner: 'po', by: 'po', at: MIDNIGHT - DAY }),
      statusLine('T1', 'po', MIDNIGHT - 60_000, 'done'),
      createLine('T2', { owner: 'po', by: 'po', at: MIDNIGHT - DAY }),
      statusLine('T2', 'po', MIDNIGHT + 60_000, 'done'),
    )
    expect(utcDay(MIDNIGHT + 60_000)).toBe('2026-10-13')
    expect(barCounts(tasks, 'po', MIDNIGHT + 30 * 60_000)['done-today']).toBe(1)
    expect(barCounts(tasks, 'po', MIDNIGHT - 30_000)['done-today']).toBe(1)
    expect(barCounts(tasks, 'po', MIDNIGHT + DAY)['done-today']).toBe(0)
  })
})

describe('status bar lines', () => {
  const tasks = rowsOf(
    createLine('T1', { owner: 'po', by: 'po', at: NOW - HOUR }),
    createLine('T2', { owner: 'po', by: 'po', at: NOW - HOUR }),
    statusLine('T2', 'po', NOW, 'verifying', 'health check passes'),
    createLine('T3', { owner: 'po', by: 'po', at: NOW - HOUR }),
    statusLine('T3', 'po', NOW, 'verifying', 'one clean roll'),
    createLine('T4', { owner: 'po', by: 'po', at: NOW - HOUR }),
    statusLine('T4', 'po', NOW, 'done'),
  )

  test('a line of blocks as wide as the body, then the counts skipping the statuses with none', async () => {
    const bar = statusBar(snapshotOf(tasks, 'po'), 12)
    expect(bar?.lines.length).toBe(4)
    expect(bar?.lines[0]).toEqual([
      { key: 'bar:done-today', text: '███', color: 'success', dim: false, status: 'done-today' },
      { key: 'bar:verifying', text: '▓▓▓▓▓▓', color: 'success', dim: false, status: 'verifying' },
      { key: 'bar:not-started', text: '░░░', color: undefined, dim: true, status: 'not-started' },
    ])
    expect(bar?.lines.slice(1).map(textOf)).toEqual(['1 done today', '2 verifying', '1 not started'])
    expect(statusBar(snapshotOf(tasks, 'po'), 48)?.lines.map(textOf)).toEqual([
      `${'█'.repeat(12)}${'▓'.repeat(24)}${'░'.repeat(12)}`,
      '1 done today · 2 verifying · 1 not started',
    ])
  })

  test('the counts wrap at the width, a dim separator only between two on a line, each line inside the bar\'s width', async () => {
    const bar = statusBar(snapshotOf(tasks, 'po'), 30)
    expect(bar?.lines.slice(1).map(textOf)).toEqual(['1 done today · 2 verifying', '1 not started'])
    expect(bar?.lines[1]?.[1]).toEqual({ key: 'sep:count:verifying', text: ' · ', dim: true, status: null })
    expect(bar?.lines.every(line => cells(textOf(line)) <= 30)).toBe(true)
    expect(cells(textOf(statusBar(snapshotOf(tasks, 'po'), 0)?.lines[0]))).toBe(1)
  })

  test('no bar with no area, before the first read, or with no task to show', async () => {
    expect(statusBar(snapshotOf(tasks, null), 40)).toBe(null)
    expect(statusBar(snapshotOf(tasks, 'po', 0), 40)).toBe(null)
    expect(statusBar(snapshotOf(tasks, 'etl'), 40)).toBe(null)
  })

  test('inline, the bar takes the rows past the three the list keeps, first lines first', async () => {
    const bar = statusBar(snapshotOf(tasks, 'po'), 48)
    expect([6, 5, 4, 3, 1].map(rows => inlineBarRows(bar, rows))).toEqual([2, 2, 1, 0, 0])
    expect(inlineBarRows(null, 6)).toBe(0)
  })
})
