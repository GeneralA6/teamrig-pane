import { describe, expect, test } from 'claude-code/testing'
import type { OwnerAct, Snapshot, TaskDetail, TaskRow } from '../types'
import { ACT_TEXT, actRows, type CardActs } from '../hooks/act-rows'
import { readRegister } from '../hooks/core/read/index'
import { dockLayout, inlineLayout } from '../hooks/layout'
import { rowOf } from '../hooks/log'
import { pageBlocks } from '../hooks/page'
import { paneBlocks, type Block, type Row, type Span } from '../hooks/rows'
import { HOUR, NOW, NO_TEAM, SNAPSHOT_SETTINGS, createLine, statusLine } from './fixtures'

/** The rows teamrig's reader folds from event lines. */
function rowsOf(lines: readonly string[]): TaskRow[] {
  return [...readRegister(lines.join('\n')).state.tasks.values()].map(task => rowOf(task))
}

const TASKS = rowsOf([
  createLine('T1', { owner: 'po', by: 'lead', at: NOW - HOUR, title: 'Ship the pages' }),
  createLine('T2', { owner: 'po', by: 'lead', at: NOW - HOUR, title: 'Load the feed' }),
  statusLine('T2', 'po', NOW - HOUR, 'in-progress'),
  createLine('T3', { owner: 'po', by: 'lead', at: NOW - HOUR, title: 'Old work' }),
  statusLine('T3', 'po', NOW - HOUR, 'done', null, 'merged'),
  createLine('T4', { owner: 'po', by: 'lead', at: NOW - HOUR, title: 'Dropped work' }),
  statusLine('T4', 'po', NOW - HOUR, 'dropped'),
])
const SNAP: Snapshot = { tasks: TASKS, area: 'po', areaSource: 'inbox-read', unreadInbox: null, inbox: [], problem: null, ...NO_TEAM, ...SNAPSHOT_SETTINGS, now: NOW }
const UNREAD: TaskDetail = { ref: null, quotes: [], goals: [] }
const RESTING: CardActs = { act: null }
const GUIDE: Span = { text: '    │ ', dim: true }

function taskOf(id: string): TaskRow {
  const task = TASKS.find(each => each.id === id)
  if (task === undefined) throw new Error(`no ${id} in the fold`)
  return task
}

const textOf = (row: Row) => row.spans.map(span => span.text).join('')
/** Each row's key past the card's, and its words. */
const drawn = (rows: readonly Row[]) => rows.map(row => [row.key.replace(/^[^:]+:T\d+:/, ''), textOf(row)])
/** The presses on a row, each `press:task`. */
const pressesOf = (rows: readonly Row[]) => rows.flatMap(row => row.spans.flatMap(span => (span.acts === undefined ? [] : [`${span.acts.press}:${span.acts.task}`])))
const actsOf = (act: OwnerAct): CardActs => ({ act })
const cardOf = (blocks: readonly Block[], key: string) => blocks.find(block => block.key === key)?.card ?? []

describe('act rows', () => {
  test('a task not started takes [Note] and [Next] on one row after the guide; one in progress takes [Note] alone', async () => {
    const open = actRows('next', taskOf('T1'), RESTING, GUIDE)
    expect(drawn(open)).toEqual([['presses', '    │ [Note] [Next]']])
    expect(open[0]?.key).toBe('next-acts:T1:presses')
    expect(open[0]?.spans[1]).toEqual({ text: ACT_TEXT.note, color: 'suggestion', acts: { task: 'T1', press: 'note' } })
    expect(open[0]?.hang).toEqual(GUIDE)
    expect(pressesOf(open)).toEqual(['note:T1', 'next:T1'])
    expect(pressesOf(actRows('working', taskOf('T2'), RESTING, GUIDE))).toEqual(['note:T2'])
  })

  test('a done or dropped task takes no act, nor any task in a pane with no team', async () => {
    expect(actRows('done', taskOf('T3'), RESTING, GUIDE)).toEqual([])
    expect(actRows('done', taskOf('T4'), RESTING, GUIDE)).toEqual([])
    expect(actRows('next', taskOf('T1'), null, GUIDE)).toEqual([])
  })

  test('the Note field open draws a field row of its round, then [Send] and [Cancel]', async () => {
    const rows = actRows('next', taskOf('T1'), actsOf({ kind: 'noting', task: 'T1', round: 3 }), GUIDE)
    expect(rows.map(row => row.key)).toEqual(['next-acts:T1:field', 'next-acts:T1:presses'])
    expect(rows[0]?.field).toEqual({ task: 'T1', round: 3 })
    expect(pressesOf(rows)).toEqual(['send:T1', 'cancel:T1'])
  })

  test("Next's preview draws its lines as teamrig printed them, then [Confirm] and [Cancel]", async () => {
    const lines = ['PREVIEW po next T1: goes to the top of its list; nothing written']
    const rows = actRows('next', taskOf('T1'), actsOf({ kind: 'confirming', task: 'T1', lines }), GUIDE)
    expect(drawn(rows)).toEqual([
      ['said:0', `    │ ${lines[0]}`],
      ['presses', '    │ [Confirm] [Cancel]'],
    ])
    expect(rows[0]?.spans[1]).toEqual({ text: lines[0] })
    expect(pressesOf(rows)).toEqual(['confirm:T1', 'cancel:T1'])
  })

  test('while teamrig runs, a dim line says what it does above the resting presses', async () => {
    const running = (act: OwnerAct) => drawn(actRows('next', taskOf('T1'), actsOf(act), null))
    expect(running({ kind: 'previewing', task: 'T1' })).toEqual([
      ['running', 'Asking teamrig what Next on T1 would do…'],
      ['presses', '[Note] [Next]'],
    ])
    expect(running({ kind: 'sending', task: 'T1', act: 'note' })[0]).toEqual(['running', 'Sending the Note on T1…'])
    expect(running({ kind: 'sending', task: 'T1', act: 'next' })[0]).toEqual(['running', 'Putting T1 next…'])
    expect(actRows('next', taskOf('T1'), actsOf({ kind: 'previewing', task: 'T1' }), null)[0]?.spans).toEqual([{ text: 'Asking teamrig what Next on T1 would do…', dim: true }])
  })

  test("what the last act answered draws above the presses verbatim: a success's lines green, a refusal's red", async () => {
    const done = actRows('next', taskOf('T1'), actsOf({ kind: 'told', task: 'T1', act: 'note', outcome: 'done', lines: ['NOTED T1', 'NOTE po has an inbox line'] }), null)
    expect(drawn(done)).toEqual([
      ['said:0', 'NOTED T1'],
      ['said:1', 'NOTE po has an inbox line'],
      ['presses', '[Note] [Next]'],
    ])
    expect(done[1]?.spans).toEqual([{ color: 'success', text: 'NOTE po has an inbox line' }])
    const refused = actRows('next', taskOf('T1'), actsOf({ kind: 'told', task: 'T1', act: 'next', outcome: 'refused', lines: ['--text --x: not a value'] }), null)
    expect(refused[0]?.spans).toEqual([{ color: 'error', text: '--text --x: not a value' }])
  })

  test("an act open on another task leaves this task's card at rest", async () => {
    expect(drawn(actRows('next', taskOf('T1'), actsOf({ kind: 'noting', task: 'T2', round: 1 }), null))).toEqual([['presses', '[Note] [Next]']])
  })
})

describe('act rows on cards', () => {
  test("an open card in the list ends in the acts, on the guide; a closed card and a done task's card have none", async () => {
    const blocks = paneBlocks(SNAP, 'mine', { T1: UNREAD, T3: UNREAD }, null, [], RESTING)
    const card = cardOf(blocks, 'next:T1')
    expect(card.at(-1)?.key).toBe('next-acts:T1:presses')
    expect(textOf(card.at(-1) ?? { key: '', spans: [] })).toBe('    │ [Note] [Next]')
    expect(card.slice(0, -1).every(row => row.key.startsWith('next-card:T1:'))).toBe(true)
    expect(pressesOf(blocks.flatMap(block => block.card ?? []))).toEqual(['note:T1', 'next:T1'])
    expect(pressesOf(blocks.flatMap(block => block.rows))).toEqual([])
  })

  test('the all view and the bar filter end each open card in the acts too; with no acts given, none', async () => {
    expect(pressesOf(paneBlocks(SNAP, 'all', { T2: UNREAD }, null, [], RESTING).flatMap(block => block.card ?? []))).toEqual(['note:T2'])
    expect(pressesOf(paneBlocks(SNAP, 'mine', { T2: UNREAD }, 'working', [], RESTING).flatMap(block => block.card ?? []))).toEqual(['note:T2'])
    expect(pressesOf(paneBlocks(SNAP, 'mine', { T1: UNREAD }).flatMap(block => block.card ?? []))).toEqual([])
  })

  test("a task's page ends its card in the acts at the body's edge; with no acts given, none", async () => {
    const card = cardOf(pageBlocks(SNAP, 'T1', {}, RESTING), 'page:T1')
    expect(card.at(-1)?.key).toBe('page-acts:T1:presses')
    expect(textOf(card.at(-1) ?? { key: '', spans: [] })).toBe('[Note] [Next]')
    expect(pressesOf(cardOf(pageBlocks(SNAP, 'T1', {}), 'page:T1'))).toEqual([])
  })

  test('the dock draws the acts as presses and the Note field as a field; inline draws neither', async () => {
    const blocks = paneBlocks(SNAP, 'mine', { T1: UNREAD }, null, [], actsOf({ kind: 'noting', task: 'T1', round: 1 }))
    const parts = dockLayout(blocks, 60).flatMap(each => (each.card ?? []).flatMap((part): string[] => (part.kind === 'line' ? part.pieces.map(piece => piece.kind) : [part.kind])))
    expect(parts.filter(kind => kind === 'field' || kind === 'act')).toEqual(['field', 'act', 'act'])
    const inline = inlineLayout(blocks, 40).map(each => each.key)
    expect(inline).toContain('next-card:T1:status')
    expect(inline.some(key => key.includes('-acts:'))).toBe(false)
  })
})
