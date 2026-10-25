import { describe, expect, test } from 'claude-code/testing'
import type { BarStatus, Snapshot, TaskRow } from '../types'
import { TimeZone, readRegister } from '../hooks/core/read/index'
import { rowOf } from '../hooks/log'
import { NOTHING_EXPANDED, paneBlocks, type Block } from '../hooks/rows'
import { BAR_LOOK, BAR_STATUSES, barCells, barCounts, drawnText, filterText, inlineBarRows, statusBar, type BarCounts, type BarPiece } from '../hooks/status-bar'
import { statusLines } from '../hooks/view'
import { cells } from '../hooks/width'
import { dayOf } from '../hooks/zone'
import { HOUR, JERUSALEM, NOW, NO_TEAM, TEAM_SETTINGS, clockAt, createLine, statusLine, treeAt, updateLine } from './fixtures'

const DAY = 24 * HOUR
/** The start of NOW's UTC day. */
const MIDNIGHT = Date.UTC(2026, 9, 13)

function countsOf(partial: Partial<Record<BarStatus, number>>): BarCounts {
  return { 'done-today': 0, verifying: 0, working: 0, waiting: 0, 'not-started': 0, ...partial }
}

/** The cells of each status with any, in bar order. */
function widthsOf(partial: Partial<Record<BarStatus, number>>, width: number): [BarStatus, number][] {
  const out = barCells(countsOf(partial), width)
  return BAR_STATUSES.filter(status => out[status] > 0).map(status => [status, out[status]])
}

function rowsOf(...lines: string[]): TaskRow[] {
  return [...readRegister(lines.join('\n')).state.tasks.values()].map(task => rowOf(task))
}

const snapshotOf = (tasks: TaskRow[], area: string | null, now = NOW): Snapshot => ({
  tasks,
  area,
  areaSource: 'inbox-read',
  unreadInbox: 0,
  inbox: [],
  problem: null,
  ...NO_TEAM,
  ...TEAM_SETTINGS,
  now,
})

const textOf = (line: readonly BarPiece[] | undefined) => (line ?? []).map(piece => piece.text).join('')
/** A line as the terminal draws it: each count behind its key. */
const drawnOf = (line: readonly BarPiece[] | undefined) => (line ?? []).map(drawnText).join('')

describe('status bar cells', () => {
  test('one status fills the bar; even shares split it evenly', async () => {
    expect(widthsOf({ working: 3 }, 10)).toEqual([['working', 10]])
    expect(widthsOf({ 'done-today': 1, verifying: 1, working: 1, waiting: 1 }, 8)).toEqual([
      ['done-today', 2],
      ['verifying', 2],
      ['working', 2],
      ['waiting', 2],
    ])
  })

  test('the cells left after the whole shares go to the largest remainders, a tie to the earlier status', async () => {
    // 3/7/2/4/9 of 25 in 48 cells: whole shares 5/13/3/7/17 leave 3 cells, for remainders 19, 21 and 17 of 25.
    expect(widthsOf({ 'done-today': 3, verifying: 7, working: 2, waiting: 4, 'not-started': 9 }, 48)).toEqual([
      ['done-today', 6],
      ['verifying', 13],
      ['working', 4],
      ['waiting', 8],
      ['not-started', 17],
    ])
    expect(widthsOf({ verifying: 1, working: 1, waiting: 1 }, 4)).toEqual([
      ['verifying', 2],
      ['working', 1],
      ['waiting', 1],
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
    const counts = { 'done-today': 1, verifying: 5, working: 2, waiting: 5, 'not-started': 1 }
    expect(widthsOf(counts, 3)).toEqual([
      ['verifying', 1],
      ['working', 1],
      ['waiting', 1],
    ])
    expect(widthsOf(counts, 1)).toEqual([['verifying', 1]])
    expect(widthsOf(counts, 0)).toEqual([])
    expect(widthsOf({}, 10)).toEqual([])
  })

  test('every mix fills the bar exactly and keeps a cell for each status with tasks', async () => {
    for (const width of [5, 7, 13, 48]) {
      for (const big of [1, 2, 9, 40, 997]) {
        for (const small of [0, 1, 3]) {
          const counts = countsOf({ 'done-today': small, verifying: big, working: small * 2, waiting: 1, 'not-started': big + small })
          const out = barCells(counts, width)
          expect(BAR_STATUSES.reduce((sum, status) => sum + out[status], 0)).toBe(width)
          expect(BAR_STATUSES.every(status => (counts[status] > 0) === (out[status] > 0))).toBe(true)
        }
      }
    }
  })
})

describe('status bar counts', () => {
  test("counts each section of the area's list: its own tasks by status, those done or dropped today, and what it asked of others as waiting", async () => {
    const tasks = rowsOf(
      createLine('T1', { owner: 'po', by: 'po', at: NOW - HOUR }),
      createLine('T2', { owner: 'po', by: 'po', at: NOW - HOUR }),
      statusLine('T2', 'po', NOW, 'in-progress'),
      createLine('T3', { owner: 'po', by: 'po', at: NOW - HOUR }),
      statusLine('T3', 'po', NOW, 'verifying', 'health check passes'),
      createLine('T4', { owner: 'po', by: 'po', at: NOW - HOUR }),
      statusLine('T4', 'po', NOW, 'waiting', 'waits on the owner'),
      createLine('T5', { owner: 'po', by: 'po', at: NOW - HOUR }),
      statusLine('T5', 'po', NOW, 'done'),
      createLine('T6', { owner: 'po', by: 'po', at: NOW - HOUR }),
      statusLine('T6', 'po', NOW, 'dropped', 'not needed'),
      createLine('T7', { owner: 'etl', by: 'po', at: NOW - HOUR }),
      // Another owner's task po did not ask for, and one it asked for that is done: neither is on po's list.
      createLine('T8', { owner: 'etl', by: 'etl', at: NOW - HOUR }),
      createLine('T9', { owner: 'etl', by: 'po', at: NOW - HOUR }),
      statusLine('T9', 'etl', NOW, 'done'),
    )
    expect(barCounts(tasks, 'po', clockAt(NOW))).toEqual(countsOf({ 'done-today': 2, verifying: 1, working: 1, waiting: 2, 'not-started': 1 }))
  })

  test("in UTC, today is the clock's UTC day: a task done a minute before midnight is not done today", async () => {
    const tasks = rowsOf(
      createLine('T1', { owner: 'po', by: 'po', at: MIDNIGHT - DAY }),
      statusLine('T1', 'po', MIDNIGHT - 60_000, 'done'),
      createLine('T2', { owner: 'po', by: 'po', at: MIDNIGHT - DAY }),
      statusLine('T2', 'po', MIDNIGHT + 60_000, 'done'),
    )
    expect(dayOf(MIDNIGHT + 60_000, TimeZone.UTC)).toBe('2026-10-13')
    expect(barCounts(tasks, 'po', clockAt(MIDNIGHT + 30 * 60_000))['done-today']).toBe(1)
    expect(barCounts(tasks, 'po', clockAt(MIDNIGHT - 30_000))['done-today']).toBe(1)
    expect(barCounts(tasks, 'po', clockAt(MIDNIGHT + DAY))['done-today']).toBe(0)
  })

  test("in Jerusalem's zone, today turns over at its midnight, 21:00 UTC in summer time", async () => {
    const jerusalemMidnight = MIDNIGHT - 3 * HOUR
    const tasks = rowsOf(
      createLine('T1', { owner: 'po', by: 'po', at: MIDNIGHT - DAY }),
      statusLine('T1', 'po', jerusalemMidnight - 60_000, 'done'),
      createLine('T2', { owner: 'po', by: 'po', at: MIDNIGHT - DAY }),
      statusLine('T2', 'po', jerusalemMidnight + 60_000, 'done'),
      createLine('T3', { owner: 'po', by: 'po', at: MIDNIGHT - DAY }),
      statusLine('T3', 'po', MIDNIGHT + 60_000, 'done'),
    )
    expect(dayOf(jerusalemMidnight + 60_000, JERUSALEM)).toBe('2026-10-13')
    expect(dayOf(jerusalemMidnight - 60_000, JERUSALEM)).toBe('2026-10-12')
    // 00:30 UTC is 03:30 IDT: T2 and T3 are done today there, T3 alone in UTC.
    expect(barCounts(tasks, 'po', clockAt(MIDNIGHT + 30 * 60_000, JERUSALEM))['done-today']).toBe(2)
    expect(barCounts(tasks, 'po', clockAt(MIDNIGHT + 30 * 60_000))['done-today']).toBe(1)
    // 20:59:30 UTC is 23:59:30 IDT, still Monday there: T1 alone.
    expect(barCounts(tasks, 'po', clockAt(jerusalemMidnight - 30_000, JERUSALEM))['done-today']).toBe(1)
    const bar = statusBar({ ...snapshotOf(tasks, 'po', MIDNIGHT + 30 * 60_000), timeZone: JERUSALEM.name }, null, 20)
    expect(textOf(bar?.lines[1])).toBe('2 done today')
  })

  test('a task is done today by when it was done: a later update to one done yesterday leaves it out', async () => {
    const tasks = rowsOf(
      createLine('T1', { owner: 'po', by: 'po', at: MIDNIGHT - DAY }),
      statusLine('T1', 'po', MIDNIGHT - HOUR, 'done', 'shipped', 'abc1234', 'none'),
      updateLine('T1', 'lead', NOW, { priority: 1 }, 'reprioritized after the fact'),
    )
    expect(tasks[0]?.updatedAt).not.toBe(tasks[0]?.statusAt)
    expect(barCounts(tasks, 'po', clockAt(NOW))['done-today']).toBe(0)
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
    const bar = statusBar(snapshotOf(tasks, 'po'), null, 12)
    expect(bar?.lines.length).toBe(4)
    expect(bar?.lines[0]).toEqual([
      { key: 'bar:done-today', text: '███', color: 'success', dim: false, bold: false, status: 'done-today', hotkey: null },
      { key: 'bar:verifying', text: '▓▓▓▓▓▓', color: 'success', dim: false, bold: false, status: 'verifying', hotkey: null },
      { key: 'bar:not-started', text: '░░░', color: undefined, dim: true, bold: false, status: 'not-started', hotkey: null },
    ])
    expect(bar?.lines.slice(1).map(textOf)).toEqual(['1 done today', '2 verifying', '1 not started'])
    expect(statusBar(snapshotOf(tasks, 'po'), null, 48)?.lines.map(textOf)).toEqual([
      `${'█'.repeat(12)}${'▓'.repeat(24)}${'░'.repeat(12)}`,
      '1 done today · 2 verifying',
      '1 not started',
    ])
  })

  test('the counts wrap at the width, a dim separator only between two on a line, each line inside the bar\'s width', async () => {
    const bar = statusBar(snapshotOf(tasks, 'po'), null, 34)
    expect(bar?.lines.slice(1).map(drawnOf)).toEqual(['o: 1 done today · v: 2 verifying', 'n: 1 not started'])
    expect(bar?.lines[1]?.[1]).toEqual({ key: 'sep:count:verifying', text: ' · ', dim: true, status: null, hotkey: null })
    expect(bar?.lines.every(line => cells(drawnOf(line)) <= 34)).toBe(true)
    expect(cells(textOf(statusBar(snapshotOf(tasks, 'po'), null, 0)?.lines[0]))).toBe(1)
  })

  test("the counts wrap by their drawn width, each count's key included, so no line runs past the bar", async () => {
    // The text alone is 42 cells, drawn 51: a line counted by its text overflowed in 42 to 50 columns, and the row
    // squeezed its separators to one cell each, their dots wrapping onto a line of their own.
    expect(cells(textOf(statusBar(snapshotOf(tasks, 'po'), null, 80)?.lines[1]))).toBe(42)
    expect(statusBar(snapshotOf(tasks, 'po'), null, 51)?.lines.slice(1).map(drawnOf)).toEqual(['o: 1 done today · v: 2 verifying · n: 1 not started'])
    expect(statusBar(snapshotOf(tasks, 'po'), null, 50)?.lines.slice(1).map(drawnOf)).toEqual(['o: 1 done today · v: 2 verifying', 'n: 1 not started'])
    // From 16, the widest count's own cells (`n: 1 not started`): a narrower line holds it alone, as wide as it is.
    for (let width = 16; width <= 60; width++) {
      const lines = statusBar(snapshotOf(tasks, 'po'), null, width)?.lines ?? []
      expect(lines.every(line => cells(drawnOf(line)) <= width)).toBe(true)
    }
  })

  test("a count draws behind its key, a colon and a space; a segment, a separator or the filter's line as its text", async () => {
    const bar = statusBar(snapshotOf(tasks, 'po'), 'verifying', 80)
    expect(bar?.lines[1]?.map(drawnText)).toEqual(['o: 1 done today', ' · ', 'v: 2 verifying', ' · ', 'n: 1 not started'])
    expect(bar?.lines[0]?.map(drawnText)).toEqual(bar?.lines[0]?.map(piece => piece.text))
    expect(bar?.lines[2]?.map(drawnText)).toEqual([filterText('verifying')])
  })

  test('no bar with no area, before the first read, or with no task to show', async () => {
    expect(statusBar(snapshotOf(tasks, null), null, 40)).toBe(null)
    expect(statusBar(snapshotOf(tasks, 'po', 0), null, 40)).toBe(null)
    expect(statusBar(snapshotOf(tasks, 'etl'), null, 40)).toBe(null)
  })

  test('inline, the bar takes the rows past the four the list keeps, first lines first', async () => {
    const bar = statusBar(snapshotOf(tasks, 'po'), null, 48)
    expect(bar?.lines.length).toBe(3)
    expect([7, 6, 5, 4, 3, 1].map(rows => inlineBarRows(bar, rows))).toEqual([3, 2, 1, 0, 0, 0])
    expect(inlineBarRows(null, 6)).toBe(0)
  })
})

describe('status bar filter', () => {
  const tasks = rowsOf(
    createLine('T1', { owner: 'po', by: 'po', at: NOW - HOUR, title: 'Not started yet' }),
    createLine('T2', { owner: 'po', by: 'po', at: NOW - HOUR, priority: 2, title: 'Check the roll' }),
    statusLine('T2', 'po', NOW - HOUR / 2, 'verifying', 'health check passes'),
    createLine('T3', { owner: 'po', by: 'po', at: NOW - HOUR, priority: 1, title: 'Check the dashboard' }),
    statusLine('T3', 'po', NOW - HOUR / 2, 'verifying', 'one clean roll'),
    createLine('T4', { owner: 'po', by: 'po', at: NOW - 2 * HOUR, title: 'Closed this morning' }),
    statusLine('T4', 'po', NOW - HOUR, 'done'),
    createLine('T5', { owner: 'po', by: 'po', at: NOW - 2 * HOUR, title: 'Closed just now' }),
    statusLine('T5', 'po', NOW, 'done'),
    createLine('T6', { owner: 'po', by: 'po', at: NOW - 72 * HOUR, title: 'Closed days ago' }),
    statusLine('T6', 'po', NOW - 48 * HOUR, 'done'),
  )
  const snap = snapshotOf(tasks, 'po')
  const keysOf = (blocks: readonly { key: string }[]) => blocks.map(block => block.key)

  test('each count carries its own key, none of them one the pane already uses', async () => {
    expect(BAR_STATUSES.map(status => BAR_LOOK[status].hotkey)).toEqual(['o', 'v', 'w', 'i', 'n'])
    const counts = statusBar(snap, null, 80)?.lines[1]?.filter(piece => piece.status !== null)
    expect(counts?.map(piece => [piece.key, piece.hotkey])).toEqual([
      ['count:done-today', 'o'],
      ['count:verifying', 'v'],
      ['count:not-started', 'n'],
    ])
  })

  test('the filtered segment and count draw bold, the count no longer dim, and a dim line says what the list shows', async () => {
    const bar = statusBar(snap, 'verifying', 80)
    expect(bar?.filter).toBe('verifying')
    expect(bar?.lines[0]?.map(piece => [piece.key, piece.bold])).toEqual([
      ['bar:done-today', false],
      ['bar:verifying', true],
      ['bar:not-started', false],
    ])
    expect(bar?.lines[1]?.find(piece => piece.key === 'count:verifying')).toMatchObject({ bold: true, dim: false })
    expect(bar?.lines[1]?.find(piece => piece.key === 'count:done-today')).toMatchObject({ bold: false, dim: true })
    expect(bar?.lines[2]).toEqual([{ key: 'filter', text: filterText('verifying'), dim: true, status: null, hotkey: null }])
    expect(filterText('verifying')).toBe('showing verifying only, click again for all')
  })

  test('a filter whose status has no task left keeps its count, at 0, so a press can clear it; with no bar, none holds', async () => {
    const bar = statusBar(snap, 'waiting', 80)
    expect(bar?.lines[0]?.map(piece => piece.key)).toEqual(['bar:done-today', 'bar:verifying', 'bar:not-started'])
    expect(textOf(bar?.lines[1])).toBe('2 done today · 2 verifying · 0 waiting · 1 not started')
    expect(bar?.filter).toBe('waiting')
    expect(statusBar(snapshotOf(tasks, 'etl'), 'waiting', 80)).toBe(null)
  })

  test('filtered, the mine view lists the header and that status alone: done today newest first, the rest in plan order', async () => {
    expect(keysOf(paneBlocks(snap, 'mine', NOTHING_EXPANDED, 'done-today'))).toEqual(['header', 'done:T5', 'done:T4'])
    expect(keysOf(paneBlocks(snap, 'mine', NOTHING_EXPANDED, 'verifying'))).toEqual(['header', 'verifying:T3', 'verifying:T2'])
    expect(keysOf(paneBlocks(snap, 'mine', NOTHING_EXPANDED, 'not-started'))).toEqual(['header', 'next:T1'])
    const none = paneBlocks(snap, 'mine', NOTHING_EXPANDED, 'working')
    expect(keysOf(none)).toEqual(['header', 'none-filtered'])
    expect(none[1]?.rows[0]?.spans).toEqual([{ text: 'Nothing in progress.', dim: true }])
    expect(statusLines(tasks, 'po', treeAt(tasks, NOW), 'done-today').map(task => task.id)).toEqual(['T5', 'T4'])
  })

  test('the all view takes no filter', async () => {
    expect(keysOf(paneBlocks(snap, 'all', NOTHING_EXPANDED, 'verifying'))).toEqual(keysOf(paneBlocks(snap, 'all')))
  })
})

describe('status bar and sections', () => {
  // Past both caps: ten tasks asked of others after po's own waiting one (8 of them listed), and nine closed today,
  // two of them dropped (6 listed); a task asked of others and done, one done days ago and another owner's never count.
  const tasks = rowsOf(
    createLine('T1', { owner: 'po', by: 'po', at: NOW - HOUR }),
    createLine('T2', { owner: 'po', by: 'po', at: NOW - HOUR }),
    statusLine('T2', 'po', NOW, 'in-progress'),
    createLine('T3', { owner: 'po', by: 'po', at: NOW - HOUR }),
    statusLine('T3', 'po', NOW, 'verifying', 'health check passes'),
    createLine('T4', { owner: 'po', by: 'po', at: NOW - HOUR }),
    statusLine('T4', 'po', NOW, 'waiting', 'waits on the owner'),
    ...Array.from({ length: 10 }, (_, i) => createLine(`T${i + 10}`, { owner: 'etl', by: 'po', at: NOW - HOUR })),
    createLine('T20', { owner: 'etl', by: 'po', at: NOW - HOUR }),
    statusLine('T20', 'etl', NOW, 'done'),
    ...Array.from({ length: 9 }, (_, i) => [
      createLine(`T${i + 30}`, { owner: 'po', by: 'po', at: NOW - 2 * HOUR }),
      statusLine(`T${i + 30}`, 'po', NOW - (i + 1) * 60_000, i < 7 ? 'done' : 'dropped'),
    ]).flat(),
    createLine('T40', { owner: 'po', by: 'po', at: NOW - 72 * HOUR }),
    statusLine('T40', 'po', NOW - 48 * HOUR, 'done'),
    createLine('T41', { owner: 'etl', by: 'etl', at: NOW - HOUR }),
  )
  const snap = snapshotOf(tasks, 'po')
  const counts = barCounts(tasks, 'po', clockAt(NOW))
  /** The key of each status's section heading in the mine view. */
  const HEADING: Readonly<Record<BarStatus, string>> = { 'done-today': 'done', verifying: 'verifying', working: 'working', waiting: 'waiting', 'not-started': 'next' }

  /** The count a section's heading names, 11 for `Waiting (11)`; null with no heading under `key`. */
  function headingCount(blocks: readonly Block[], key: string): number | null {
    const text = blocks.find(block => block.key === key)?.rows[0]?.spans.map(span => span.text).join('')
    const count = text === undefined ? undefined : /\((\d+)\)$/.exec(text)?.[1]
    return count === undefined ? null : Number(count)
  }

  test("each section's heading names the count the bar shows for its status, the tasks past a cap included", async () => {
    expect(counts).toEqual(countsOf({ 'done-today': 9, verifying: 1, working: 1, waiting: 11, 'not-started': 1 }))
    expect(textOf(statusBar(snap, null, 200)?.lines[1])).toBe('9 done today · 1 verifying · 1 working · 11 waiting · 1 not started')
    const blocks = paneBlocks(snap, 'mine')
    expect(BAR_STATUSES.map(status => headingCount(blocks, HEADING[status]))).toEqual(BAR_STATUSES.map(status => counts[status]))
  })

  test("each status's filter lists every task its count names", async () => {
    for (const status of BAR_STATUSES) {
      const listed = paneBlocks(snap, 'mine', NOTHING_EXPANDED, status).filter(block => block.key !== 'header')
      expect({ status, listed: listed.length }).toEqual({ status, listed: counts[status] })
    }
  })
})
