import { describe, expect, test } from 'claude-code/testing'
import type { Snapshot, TaskRow } from '../types'
import { BANNER_KEY, NOTHING_CURRENT, bannerBlock, currentTask } from '../hooks/banner'
import { readRegister } from '../hooks/core/read/index'
import { rowOf } from '../hooks/log'
import { treeOf } from '../hooks/meta'
import type { Row } from '../hooks/rows'
import { HOUR, NOW, NO_TEAM, TEAM_SETTINGS, createLine, statusLine, treeAt } from './fixtures'

function rowsOf(lines: readonly string[]): TaskRow[] {
  return [...readRegister(lines.join('\n')).state.tasks.values()].map(task => rowOf(task))
}

function snapOf(lines: readonly string[], area: string | null = 'po'): Snapshot {
  return { tasks: rowsOf(lines), area, areaSource: area === null ? null : 'pinned', unreadInbox: 0, problem: null, ...NO_TEAM, ...TEAM_SETTINGS, now: NOW }
}

/** The task the banner of `snap` shows, as `kind id`, or null. */
function picked(snap: Snapshot): string | null {
  const current = currentTask(snap, treeOf(snap))
  return current === null ? null : `${current.kind} ${current.task.id}`
}

function taskOf(tasks: readonly TaskRow[], id: string): TaskRow {
  const task = tasks.find(each => each.id === id)
  if (task === undefined) throw new Error(`no ${id} in the fold`)
  return task
}

const textOf = (row: Row) => row.spans.map(span => span.text).join('')

const LINES = [
  createLine('T1', { owner: 'po', by: 'lead', at: NOW - 9 * HOUR, priority: 3, title: 'Open later' }),
  createLine('T2', { owner: 'po', by: 'lead', at: NOW - 8 * HOUR, priority: 1, title: 'Open first', description: 'What and why' }),
  createLine('T3', { owner: 'po', by: 'lead', at: NOW - 7 * HOUR, title: 'Started early' }),
  createLine('T4', { owner: 'po', by: 'lead', at: NOW - 6 * HOUR, title: 'Started last' }),
  createLine('T5', { owner: 'etl', by: 'lead', at: NOW - 5 * HOUR, title: 'Not ours' }),
  createLine('T6', { owner: 'po', by: 'lead', at: NOW - 4 * HOUR, priority: 1, title: 'Waits' }),
  statusLine('T3', 'po', NOW - 3 * HOUR, 'in-progress'),
  statusLine('T4', 'po', NOW - 2 * HOUR, 'in-progress', 'halfway'),
  statusLine('T5', 'etl', NOW - HOUR, 'in-progress'),
  statusLine('T6', 'po', NOW - HOUR, 'waiting', 'on lead'),
]

describe('currentTask', () => {
  test("the area's own task in progress that took its status last, never another owner's", () => {
    expect(picked(snapOf(LINES))).toBe('now T4')
  })

  test('with none in progress, the first open task in plan order, never a waiting one', () => {
    const lines = [...LINES, statusLine('T3', 'po', NOW - 30 * 60_000, 'done', 'shipped'), statusLine('T4', 'po', NOW - 20 * 60_000, 'verifying', 'merged')]
    expect(picked(snapOf(lines))).toBe('next T2')
  })

  test('none with no open task either, or no area', () => {
    expect(picked(snapOf(LINES.slice(4, 5)))).toBeNull()
    expect(picked(snapOf(LINES, null))).toBeNull()
  })
})

describe('bannerBlock', () => {
  const snap = snapOf(LINES)
  const tree = treeAt(snap.tasks, NOW)

  test('closed, one row cut at one line: the task in progress, or the next one after a dim next', () => {
    const now = bannerBlock(currentTask(snap, tree), false, tree, 'po')
    expect(now.key).toBe(BANNER_KEY)
    expect(now.rows.map(textOf)).toEqual(['◐ T4  Started last'])
    expect(now.rows[0]?.maxLines).toBe(1)
    const next = bannerBlock({ kind: 'next', task: taskOf(snap.tasks, 'T2') }, false, tree, 'po')
    expect(next.rows.map(textOf)).toEqual(['next ○ T2  Open first'])
    expect(next.rows[0]?.spans[0]).toEqual({ text: 'next ', dim: true })
  })

  test('open, the title whole and the facts the person reads first, each on its labelled row at the edge', () => {
    const open = bannerBlock({ kind: 'next', task: taskOf(snap.tasks, 'T2') }, true, tree, 'po')
    expect(open.rows[0]?.maxLines).toBeUndefined()
    expect(open.rows.slice(1).map(row => row.key)).toEqual([
      `${BANNER_KEY}-card:T2:description`,
      `${BANNER_KEY}-card:T2:status`,
      `${BANNER_KEY}-card:T2:priority`,
    ])
    expect(open.rows.map(textOf)[1]).toBe('Description  What and why')
    const working = bannerBlock(currentTask(snap, tree), true, tree, 'po')
    expect(working.rows.map(row => row.key.split(':').at(-1))).toEqual([BANNER_KEY, 'status', 'note', 'priority'])
  })

  test('a dim line when the area has no current task', () => {
    expect(bannerBlock(null, false, tree, 'po').rows).toEqual([{ key: BANNER_KEY, spans: [{ text: NOTHING_CURRENT, dim: true }] }])
  })
})
