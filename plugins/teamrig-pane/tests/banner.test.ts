import { describe, expect, test } from 'claude-code/testing'
import type { LogConversation, Snapshot, TaskRow, ViewMode } from '../types'
import { BANNER_KEY, NOTHING_CURRENT, PREVIOUS_KEY, bannerBlock, currentRowKey, currentTask, previousBlock, type Current } from '../hooks/banner'
import { readRegister } from '../hooks/core/read/index'
import { rowOf } from '../hooks/log'
import { conversationWhen } from '../hooks/log-rows'
import { UNTITLED } from '../hooks/log-title'
import { treeOf } from '../hooks/meta'
import { SEPARATOR, paneBlocks, type Row } from '../hooks/rows'
import { clockOf } from '../hooks/zone'
import { HOUR, NOW, NO_TEAM, SNAPSHOT_SETTINGS, createLine, statusLine, treeAt } from './fixtures'

function rowsOf(lines: readonly string[]): TaskRow[] {
  return [...readRegister(lines.join('\n')).state.tasks.values()].map(task => rowOf(task))
}

function snapOf(lines: readonly string[], area: string | null = 'po'): Snapshot {
  return { tasks: rowsOf(lines), area, areaSource: area === null ? null : 'pinned', unreadInbox: 0, inbox: [], problem: null, ...NO_TEAM, ...SNAPSHOT_SETTINGS, now: NOW }
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

describe('currentRowKey', () => {
  function currentOf(snap: Snapshot): Current {
    const current = currentTask(snap, treeOf(snap))
    if (current === null) throw new Error('no current task')
    return current
  }
  const keysOf = (snap: Snapshot, mode: ViewMode) => paneBlocks(snap, mode).map(block => block.key)

  test("the key of the task's row on the pane's list: under Working on or Up next on the area's, under its owner on every owner's", () => {
    const working = snapOf(LINES)
    const next = snapOf([...LINES, statusLine('T3', 'po', NOW - 30 * 60_000, 'done', 'shipped'), statusLine('T4', 'po', NOW - 20 * 60_000, 'verifying', 'merged')])
    expect(currentRowKey(currentOf(working), 'mine')).toBe('working:T4')
    expect(currentRowKey(currentOf(next), 'mine')).toBe('next:T2')
    expect(currentRowKey(currentOf(next), 'all')).toBe('po:T2')
    // Each is a block the list draws, so a step back to it scrolls to the task.
    for (const snap of [working, next]) for (const mode of ['mine', 'all'] as const) expect(keysOf(snap, mode)).toContain(currentRowKey(currentOf(snap), mode))
  })
})

describe('bannerBlock', () => {
  const snap = snapOf(LINES)
  const tree = treeAt(snap.tasks, NOW)

  test('closed, one row cut at one line led by the name, then a dim label naming it: working on, or up next', () => {
    const now = bannerBlock(currentTask(snap, tree), false, tree, 'po')
    expect(now.key).toBe(BANNER_KEY)
    expect(now.rows.map(textOf)).toEqual(['po · working on · ◐ T4  Started last'])
    expect(now.rows[0]?.spans.slice(0, 4)).toEqual([{ text: 'po', bold: true }, SEPARATOR, { text: 'working on', dim: true }, SEPARATOR])
    expect(now.rows[0]?.maxLines).toBe(1)
    const next = bannerBlock({ kind: 'next', task: taskOf(snap.tasks, 'T2') }, false, tree, 'po')
    expect(next.rows.map(textOf)).toEqual(['po · up next · ○ T2  Open first'])
    expect(next.rows[0]?.spans[2]).toEqual({ text: 'up next', dim: true })
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

  test('a wrapped title lines up under the title, past the name and its label', () => {
    const indent = '○ T2  '.length
    const next = bannerBlock({ kind: 'next', task: taskOf(snap.tasks, 'T2') }, false, tree, 'acme-po')
    expect(next.rows[0]?.hang?.text.length).toBe('acme-po · up next · '.length + indent)
    const now = bannerBlock(currentTask(snap, tree), false, tree, 'acme-po')
    expect(now.rows[0]?.hang?.text.length).toBe('acme-po · working on · '.length + indent)
  })

  test('the name, then a dim line, when the area has no current task', () => {
    expect(bannerBlock(null, false, tree, 'po').rows).toEqual([
      { key: BANNER_KEY, spans: [{ text: 'po', bold: true }, SEPARATOR, { text: NOTHING_CURRENT, dim: true }] },
    ])
  })
})

describe('previousBlock', () => {
  /** po's conversation of the two hours before the last half hour, opened by the owner. */
  const before: LogConversation = {
    session: 'po',
    claude: 'c-1',
    firstAt: NOW - 2 * HOUR,
    lastAt: NOW - HOUR,
    nextAt: NOW - 30 * 60_000,
    lines: 4,
    opening: { by: 'owner', line: 'Plan the week' },
  }

  const clock = clockOf(snapOf(LINES))

  test('one row cut at one line, how the conversation opened, led by nothing: the frame head names it', () => {
    expect(previousBlock(before, snapOf(LINES), false, clock)).toEqual({
      key: PREVIOUS_KEY,
      rows: [{ key: PREVIOUS_KEY, spans: [{ text: 'Plan the week' }], maxLines: 1 }],
    })
  })

  test('the tasks its session worked while it ran in place of how it opened, never work after the next conversation began', () => {
    const work = [
      { session: 'po', task: 'T4', at: NOW - 90 * 60_000 },
      { session: 'po', task: 'T2', at: NOW - 10 * 60_000 },
    ]
    const block = previousBlock(before, { ...snapOf(LINES), work }, false, clock)
    expect(block.rows.map(textOf)).toEqual(['T4 Started last'])
    expect(block.rows[0]?.spans[0]).toEqual({ text: 'T4', bold: true })
  })

  test('open, it is cut at no line: how it opened, then when it ran and its count of lines, under the title', () => {
    const block = previousBlock(before, snapOf(LINES), true, clock)
    expect(block.rows.map(textOf)).toEqual(['Plan the week', conversationWhen(before, clock)])
    expect(conversationWhen(before, clock)).toMatch(/–.* · 4 lines$/)
    expect(block.rows.map(row => row.maxLines)).toEqual([undefined, undefined])
    expect(block.rows.map(row => row.hang)).toEqual([undefined, undefined])
    expect(block.rows[1]?.spans.at(-1)?.dim).toBe(true)
  })

  test('open, each task it worked a row with its whole title, then its times, then how it opened', () => {
    const long = 'A title far past the forty-eight characters a shared title keeps'
    const lines = [...LINES, createLine('T7', { owner: 'po', by: 'lead', at: NOW - 3 * HOUR, title: long })]
    const work = [
      { session: 'po', task: 'T4', at: NOW - 100 * 60_000 },
      { session: 'po', task: 'T7', at: NOW - 80 * 60_000 },
      { session: 'po', task: 'T9', at: NOW - 70 * 60_000 },
    ]
    const worked = { ...snapOf(lines), work }
    expect(textOf(previousBlock(before, worked, false, clock).rows[0] ?? { key: '', spans: [] })).not.toContain(long)
    const block = previousBlock(before, worked, true, clock)
    expect(block.rows.map(textOf)).toEqual([
      'T4 Started last',
      `T7 ${long}`,
      'T9',
      conversationWhen(before, clock),
      'opened · Plan the week',
    ])
    expect(block.rows.map(row => row.key)).toEqual([
      PREVIOUS_KEY,
      `${PREVIOUS_KEY}:task:1`,
      `${PREVIOUS_KEY}:task:2`,
      `${PREVIOUS_KEY}:when`,
      `${PREVIOUS_KEY}:opened`,
    ])
    expect(block.rows[1]?.spans[0]).toEqual({ text: 'T7', bold: true })
  })

  test('open, a conversation of harness notices alone has its dim title and its times, and no opened row', () => {
    const block = previousBlock({ ...before, opening: null }, snapOf(LINES), true, clock)
    expect(block.rows.map(textOf)).toEqual([UNTITLED.text, conversationWhen(before, clock)])
  })

  test("a Claude opening is dim in the open block's opened row as in its title", () => {
    const claudeOpened: LogConversation = { ...before, opening: { by: 'claude', line: 'Read the handover' } }
    const work = [{ session: 'po', task: 'T4', at: NOW - 90 * 60_000 }]
    const block = previousBlock(claudeOpened, { ...snapOf(LINES), work }, true, clock)
    expect(block.rows.at(-1)?.spans.at(-1)).toEqual({ text: 'Read the handover', dim: true })
  })
})
