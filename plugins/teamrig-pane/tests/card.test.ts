import { describe, expect, test } from 'claude-code/testing'
import type { TaskDetail, TaskRow } from '../types'
import { cardRows, LABEL_CELLS } from '../hooks/card'
import { readRegister, type PriorityConfig } from '../hooks/core/read/index'
import { wrapRow } from '../hooks/layout'
import { rowOf } from '../hooks/log'
import { contextOf } from '../hooks/meta'
import type { Row } from '../hooks/rows'
import { HOUR, NOW, createLine, statusLine, updateLine, verifyingLine, waitingLine } from './fixtures'

const DAY = 24 * HOUR
const PRIORITIES: readonly PriorityConfig[] = [{ id: 2, name: 'correctness' }]
/** Nothing read beyond the register: no quote, no goal item. */
const UNREAD: TaskDetail = { ref: null, quotes: [], goals: [] }
const GUIDE = '    │ '
/** Where a value's further lines start: under the value column. */
const UNDER = `${GUIDE}${' '.repeat(LABEL_CELLS)}`
const NO_ROW: Row = { key: '', spans: [] }

/** A row's first line as drawn in the list: the guide, the label padded to the value column, the value. */
const labelled = (label: string, value: string) => `${GUIDE}${label.padEnd(LABEL_CELLS)}${value}`

/** The rows teamrig's reader folds from event lines, in the order the tasks were created. */
function rowsOf(lines: readonly string[]): TaskRow[] {
  return [...readRegister(lines.join('\n')).state.tasks.values()].map(task => rowOf(task, PRIORITIES))
}

function taskOf(tasks: readonly TaskRow[], id: string): TaskRow {
  const task = tasks.find(each => each.id === id)
  if (task === undefined) throw new Error(`no ${id} in the fold`)
  return task
}

const textOf = (row: Row) => row.spans.map(span => span.text).join('')

/** The card of `id` among `tasks`, in the `po` list's waiting section unless said otherwise. */
function cardOf(tasks: readonly TaskRow[], id: string, detail: TaskDetail = UNREAD, viewer: string | null = 'po', now = NOW): Row[] {
  return cardRows('waiting', taskOf(tasks, id), detail, contextOf(tasks, now), viewer)
}

/** The first line of the row keyed `row` in a card, or an empty row when the card has none. */
const rowNamed = (rows: readonly Row[], row: string) => rows.find(each => each.key.endsWith(`:${row}`)) ?? NO_ROW

describe('card', () => {
  test("a waiting task's card: each fact on its labelled row, in order, the ask first, every line on the guide", async () => {
    const ref = '~/team-notes/board/inbox/po.md:4; docs/x.md:9'
    const tasks = rowsOf([
      createLine('T6', { owner: 'etl', by: 'etl', at: NOW - DAY, source: 'etl' }),
      createLine('T5', { owner: 'etl', by: 'etl', at: NOW - DAY, source: 'etl' }),
      createLine('T1', {
        owner: 'po',
        by: 'lead',
        at: NOW - 2 * HOUR,
        ref,
        priority: 2,
        due: '2026-10-13 12:00',
        goals: ['G10.2', 'G15'],
        title: 'Ship it',
        taskKeys: { after: ['T5', 'T6'] },
      }),
      statusLine('T5', 'etl', NOW - HOUR, 'done', 'shipped', 'sha1'),
      statusLine('T1', 'po', NOW - HOUR, 'in-progress', null, 'abc123'),
      waitingLine('T1', 'po', NOW, [{ kind: 'decision', who: 'owner' }, { kind: 'task', id: 'T6' }], 'see https://example.com/pr/7.'),
    ])
    const detail: TaskDetail = {
      ref,
      quotes: [{ ref: '~/team-notes/board/inbox/po.md:4', lines: ['2026-10-13 lead: ship the pane'] }],
      goals: [{ goal: 'G10.2', text: 'G10.2 The pane in fullscreen' }],
    }
    const rows = cardOf(tasks, 'T1', detail)
    expect(rows.map(row => row.key.replace('waiting-card:T1:', ''))).toEqual([
      'description',
      'status',
      'status:1',
      'note',
      'priority',
      'due',
      'week',
      'after',
      'goal',
      'goal:1',
      'from',
      'added',
      'reference',
      'reference:1',
      'evidence',
      'links',
    ])
    expect(rows.map(textOf)).toEqual([
      labelled('Description', '2026-10-13 lead: ship the pane'),
      labelled('Status', 'waiting since 14:00 by po'),
      `${UNDER}decision owner, on T6`,
      labelled('Note', 'see https://example.com/pr/7.'),
      labelled('Priority', '2'),
      labelled('Due', 'today 12:00 · late 2h'),
      labelled('Week', 'Tue 10-13'),
      labelled('After', 'T5 (done), T6 (not started)'),
      labelled('Goal', 'G10.2 The pane in fullscreen'),
      `${UNDER}G15`,
      labelled('From', 'owner'),
      labelled('Added', '12:00 by lead'),
      labelled('Reference', 'inbox/po.md'),
      `${UNDER}docs/x.md`,
      labelled('Evidence', 'abc123'),
      labelled('Links', 'https://example.com/pr/7'),
    ])
    expect(rows.every(row => row.hang?.text === UNDER && row.hang.dim === true)).toBe(true)
    expect(rows.every(row => row.spans[0]?.dim === true)).toBe(true)
    expect(rowNamed(rows, 'status').spans[1]).toEqual({ text: 'Status       ', dim: true })
    expect(rowNamed(rows, 'status:1').spans[1]?.color).toBe('error')
    expect(rowNamed(rows, 'note').spans[2]?.color).toBe(undefined)
    expect(rowNamed(rows, 'due').spans.find(span => span.text === 'late 2h')?.color).toBe('error')
    expect(rowNamed(rows, 'links').spans[2]).toEqual({ text: 'https://example.com/pr/7', href: 'https://example.com/pr/7' })
  })

  test('a row with no value is left out: a fresh task with no description, ref, goal, week or plan dependency shows its status, priority, who asked and when it was added', async () => {
    const tasks = rowsOf([createLine('T2', { owner: 'po', by: 'po', at: NOW - HOUR, source: 'po', ref: null, goals: [], week: null })])
    expect(cardOf(tasks, 'T2').map(textOf)).toEqual([
      labelled('Status', 'not started since 13:00 by po'),
      labelled('Priority', '3'),
      labelled('From', 'po'),
      labelled('Added', '13:00 by po'),
    ])
  })

  test('the description as written, a line a row, in place of any quote; a task with none quotes its ref only while the quotes were read for it', async () => {
    const tasks = rowsOf([
      createLine('T1', { owner: 'po', by: 'po', at: NOW - HOUR, source: 'po', ref: 'docs/x.md:9', goals: [], description: 'Ship the card.\n\nIt reads like a tracker.' }),
      createLine('T2', { owner: 'po', by: 'po', at: NOW - HOUR, source: 'po', ref: 'old' }),
      updateLine('T2', 'po', NOW, { ref: 'new' }),
    ])
    const quoted: TaskDetail = { ref: 'docs/x.md:9', quotes: [{ ref: 'docs/x.md:9', lines: ['the quoted ask'] }], goals: [] }
    const written = cardOf(tasks, 'T1', quoted)
    expect(written.filter(row => row.key.includes(':description')).map(textOf)).toEqual([labelled('Description', 'Ship the card.'), `${UNDER}It reads like a tracker.`])
    expect(written.some(row => row.spans.some(span => span.text === 'the quoted ask'))).toBe(false)
    expect(textOf(rowNamed(written, 'reference'))).toBe(labelled('Reference', 'docs/x.md'))
    // Quotes read for the ref T2 had before: no ask to show, its new ref named, a goal no item was read for by its id.
    const stale = cardOf(tasks, 'T2', { ref: 'old', quotes: [{ ref: 'old', lines: ['the old ask'] }], goals: [] })
    expect(stale.some(row => row.key.includes(':description'))).toBe(false)
    expect([rowNamed(stale, 'goal'), rowNamed(stale, 'reference')].map(textOf)).toEqual([labelled('Goal', 'G10.2'), labelled('Reference', 'new')])
  })

  test('says who set the status only while that is the newest event; the note in the text color, the proof in green under a Verify by due', async () => {
    const tasks = rowsOf([
      createLine('T1', { owner: 'po', by: 'po', at: NOW - DAY, source: 'po', ref: null, goals: [] }),
      statusLine('T1', 'po', NOW - HOUR, 'in-progress', 'halfway'),
      updateLine('T1', 'lead', NOW, { priority: 1 }),
      createLine('T2', { owner: 'po', by: 'po', at: NOW - DAY, source: 'po', ref: null, goals: [], due: '2026-10-13 18:00' }),
      verifyingLine('T2', 'po', NOW, 'GET /health answers 200', 'deployed', 'abc123'),
    ])
    const working = cardOf(tasks, 'T1')
    expect(working.slice(0, 3).map(textOf)).toEqual([labelled('Status', 'in progress since 13:00'), labelled('Note', 'halfway'), labelled('Priority', '1')])
    const verifying = cardOf(tasks, 'T2')
    expect(verifying.slice(0, 5).map(textOf)).toEqual([
      labelled('Status', 'verifying since 14:00 by po'),
      labelled('Note', 'deployed'),
      labelled('Proof', 'GET /health answers 200'),
      labelled('Priority', '3'),
      labelled('Verify by', 'today 18:00'),
    ])
    expect(rowNamed(verifying, 'proof').spans[2]?.color).toBe('success')
    // A task finished earlier on its day: when it closed, and its note.
    const done = rowsOf([createLine('T3', { owner: 'po', by: 'po', at: NOW - DAY, source: 'po' }), statusLine('T3', 'po', NOW - HOUR, 'done', 'merged', 'def456')])
    expect(cardRows('done', taskOf(done, 'T3'), UNREAD, contextOf(done, NOW), 'po').slice(0, 2).map(textOf)).toEqual([
      labelled('Status', 'done since 13:00 by po'),
      labelled('Note', 'merged'),
    ])
  })

  test("From says who asked, Added when and by whom it was written; Owner only in another area's list", async () => {
    const tasks = rowsOf([
      createLine('T1', { owner: 'po', by: 'lead', at: NOW - HOUR, source: 'lead' }),
      createLine('T2', { owner: 'po', by: 'lead', at: NOW - DAY, source: 'owner' }),
      statusLine('T2', 'po', NOW, 'in-progress', null),
    ])
    const rows = (id: string, viewer: string | null) => cardOf(tasks, id, UNREAD, viewer).filter(row => /:(from|added|owner)$/.test(row.key)).map(textOf)
    expect(rows('T1', 'etl')).toEqual([labelled('From', 'lead'), labelled('Added', '13:00 by lead'), labelled('Owner', 'po')])
    expect(rows('T1', 'po')).toEqual([labelled('From', 'lead'), labelled('Added', '13:00 by lead')])
    expect(rows('T1', null)).toEqual([labelled('From', 'lead'), labelled('Added', '13:00 by lead')])
    expect(rows('T2', 'po')).toEqual([labelled('From', 'owner'), labelled('Added', 'Mon 10-12 by lead')])
  })

  test('a task a GitHub issue opened says so in From and links to its issue first, each link on its own line; its ref is no Reference', async () => {
    const tasks = rowsOf([
      createLine('T1', { owner: 'po', by: 'github', at: NOW - HOUR, source: 'github', ref: 'gh:acme/app#12', goals: [] }),
      statusLine('T1', 'po', NOW, 'in-progress', 'review https://example.com/pr/7', 'https://ci.example/run/9'),
    ])
    const card = cardOf(tasks, 'T1')
    const links = card.filter(row => row.key.includes(':links'))
    expect(links.map(textOf)).toEqual([
      labelled('Links', 'https://github.com/acme/app/issues/12'),
      `${UNDER}https://example.com/pr/7`,
      `${UNDER}https://ci.example/run/9`,
    ])
    expect(links.map(row => row.spans.at(-1)?.href)).toEqual(['https://github.com/acme/app/issues/12', 'https://example.com/pr/7', 'https://ci.example/run/9'])
    expect(textOf(rowNamed(card, 'from'))).toBe(labelled('From', 'GitHub issue #12'))
    expect(card.some(row => row.key.includes(':reference'))).toBe(false)
  })

  test('each id the snapshot holds, in a reason, a note, the After row or the ask, is a span marked with its task; others stay words', async () => {
    const tasks = rowsOf([
      createLine('T6', { owner: 'etl', by: 'etl', at: NOW - DAY, source: 'etl' }),
      createLine('T1', { owner: 'po', by: 'po', at: NOW - HOUR, source: 'po', ref: 'docs/x.md:3', goals: [], taskKeys: { after: ['T6', 'T99'] } }),
      waitingLine('T1', 'po', NOW, [{ kind: 'task', id: 'T6' }], 'T99 gone, T6 first, see https://example.com/T6'),
    ])
    const detail: TaskDetail = { ref: 'docs/x.md:3', quotes: [{ ref: 'docs/x.md:3', lines: ['ship T6 first'] }], goals: [] }
    const rows = cardOf(tasks, 'T1', detail)
    const ids = (row: string) => rowNamed(rows, row).spans.filter(span => span.task !== undefined)
    expect(ids('status:1')).toEqual([{ text: 'T6', color: 'error', task: 'T6' }])
    expect(ids('note')).toEqual([{ text: 'T6', task: 'T6' }])
    expect(ids('after')).toEqual([{ text: 'T6', task: 'T6' }])
    expect(ids('description')).toEqual([{ text: 'T6', task: 'T6' }])
    expect(textOf(rowNamed(rows, 'status:1'))).toBe(`${UNDER}on T6`)
    expect(textOf(rowNamed(rows, 'after'))).toBe(labelled('After', 'T6 (not started), T99'))
    // The card's own labels never hold one.
    expect(rows.every(row => row.spans[0]?.task === undefined && row.spans[1]?.task === undefined)).toBe(true)
  })

  test('a value wraps under the value column in a narrow pane, never past its width', async () => {
    const detail: TaskDetail = { ref: 'docs/x.md:9', quotes: [{ ref: 'docs/x.md:9', lines: ['the pane draws a card under the task title'] }], goals: [] }
    const tasks = rowsOf([createLine('T1', { owner: 'po', by: 'po', at: NOW - HOUR, source: 'po', ref: 'docs/x.md:9', goals: [] })])
    const lines = wrapRow(rowNamed(cardOf(tasks, 'T1', detail), 'description'), 38).map(line => line.map(span => span.text).join(''))
    expect(lines).toEqual([labelled('Description', 'the pane draws a'), `${UNDER}card under the task`, `${UNDER}title`])
    expect(lines.every(line => line.length <= 38)).toBe(true)
  })
})
