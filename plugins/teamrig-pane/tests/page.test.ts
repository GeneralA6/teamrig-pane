import { describe, expect, test } from 'claude-code/testing'
import type { Snapshot, TaskDetail, TaskRow } from '../types'
import { LABEL_CELLS } from '../hooks/card'
import { readRegister } from '../hooks/core/read/index'
import { rowOf } from '../hooks/log'
import { pageBlocks } from '../hooks/page'
import type { Block, Row } from '../hooks/rows'
import { HOUR, NOW, createLine } from './fixtures'

/** The rows teamrig's reader folds from event lines. */
function rowsOf(lines: readonly string[]): TaskRow[] {
  return [...readRegister(lines.join('\n')).state.tasks.values()].map(task => rowOf(task))
}

const TASKS = rowsOf([
  createLine('T58', { owner: 'etl', by: 'lead', at: NOW - HOUR, title: 'Load the feed' }),
  createLine('T50', { owner: 'po', by: 'lead', at: NOW - HOUR, title: 'Ship the pages', ref: 'docs/x.md:3', taskKeys: { after: ['T58'] } }),
])
const SNAP: Snapshot = { tasks: TASKS, area: 'po', areaSource: 'pinned', unreadInbox: null, problem: null, now: NOW }
const textOf = (row: Row) => row.spans.map(span => span.text).join('')
/** A card row's first line on a page: the label padded to the value column, then the value. */
const labelled = (label: string, value: string) => `${label.padEnd(LABEL_CELLS)}${value}`
const rowsIn = (blocks: readonly Block[]) => blocks.flatMap(block => [...block.rows, ...(block.card ?? [])])

describe('page', () => {
  test("a task's page is its title whole, then its card at the body's edge: no guide, values under the label column", async () => {
    const [block, ...rest] = pageBlocks(SNAP, 'mine', 'T50', {})
    expect(rest).toEqual([])
    expect(block?.key).toBe('page:T50')
    expect(block?.toggle).toBe(undefined)
    expect(block?.rows.map(textOf)).toEqual(['○ T50  Ship the pages'])
    expect(block?.rows[0]?.maxLines).toBe(undefined)
    const card = block?.card ?? []
    expect(card.map(row => row.key.replace('page-card:T50:', ''))).toEqual(['status', 'priority', 'week', 'after', 'goal', 'from', 'added', 'reference'])
    expect(card.map(textOf)).toEqual([
      labelled('Status', 'not started since 13:00 by lead'),
      labelled('Priority', '3'),
      labelled('Week', 'Tue 10-13'),
      labelled('After', 'T58 (not started)'),
      labelled('Goal', 'G10.2'),
      labelled('From', 'owner'),
      labelled('Added', '13:00 by lead'),
      labelled('Reference', 'docs/x.md'),
    ])
    expect(card.every(row => row.hang?.text === ' '.repeat(LABEL_CELLS))).toBe(true)
    expect(card.find(row => row.key.endsWith(':after'))?.spans.find(span => span.task !== undefined)).toEqual({ text: 'T58', task: 'T58' })
  })

  test('what the page read for its task quotes the ask; in the mine view another area’s task names its owner, in the all view none does', async () => {
    const detail: TaskDetail = { ref: 'docs/x.md', quotes: [{ ref: 'docs/x.md', lines: ['load it nightly'] }], goals: [] }
    const mine = rowsIn(pageBlocks(SNAP, 'mine', 'T58', { T58: detail })).map(textOf)
    expect(mine).toContain(labelled('Description', 'load it nightly'))
    expect(mine).toContain(labelled('Owner', 'etl'))
    expect(rowsIn(pageBlocks(SNAP, 'all', 'T58', { T58: detail })).map(textOf).some(text => text.startsWith('Owner'))).toBe(false)
  })

  test('a task the snapshot no longer holds says it closed over 8 days ago, one dim line', async () => {
    expect(pageBlocks(SNAP, 'mine', 'T9', {})).toEqual([
      { key: 'page:T9', rows: [{ key: 'page:T9', spans: [{ text: "T9 left the pane's tasks: it closed over 8 days ago.", dim: true }], hang: undefined }] },
    ])
  })

  test('the register’s problem leads the page; a snapshot never read says it is being read, as the list does', async () => {
    const failed = pageBlocks({ ...SNAP, problem: 'events.jsonl: locked' }, 'mine', 'T50', {})
    expect(failed.map(block => block.key)).toEqual(['problem', 'page:T50'])
    expect(pageBlocks({ ...SNAP, problem: 'events.jsonl: locked' }, 'mine', 'T9', {}).map(block => block.key)).toEqual(['problem', 'page:T9'])
    expect(pageBlocks({ ...SNAP, now: 0 }, 'mine', 'T50', {}).map(block => rowsIn([block]).map(textOf))).toEqual([['Reading the register…']])
  })
})
