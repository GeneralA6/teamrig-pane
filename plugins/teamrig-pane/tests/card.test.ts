import { describe, expect, test } from 'claude-code/testing'
import type { TaskDetail, TaskRow } from '../types'
import { cardRows, LABEL_CELLS } from '../hooks/card'
import { readRegister, type PriorityConfig } from '../hooks/core/read/index'
import { wrapRow } from '../hooks/layout'
import { rowOf } from '../hooks/log'
import { contextOf } from '../hooks/meta'
import type { Row } from '../hooks/rows'
import { HOUR, NOW, createLine, statusLine, updateLine, waitingLine } from './fixtures'

const DAY = 24 * HOUR
const PRIORITIES: readonly PriorityConfig[] = [{ id: 2, name: 'correctness' }]
/** Nothing read beyond the register: no quote, no goal item. */
const UNREAD: TaskDetail = { ref: null, quotes: [], goals: [] }
const GUIDE = '    │ '
/** Where a value's further lines start: under the value column. */
const UNDER = `${GUIDE}${' '.repeat(LABEL_CELLS)}`

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

describe('card', () => {
  test("a waiting task's card: each fact on its labelled row, in order, the status's reasons and note under it, every line on the guide", async () => {
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
      'status',
      'status:1',
      'plan',
      'what',
      'what:1',
      'who',
      'after',
      'goal',
      'goal:1',
      'evidence',
      'links',
    ])
    expect(rows.map(textOf)).toEqual([
      `${GUIDE}Status    waiting since 14:00 by po`,
      `${UNDER}decision owner, on T6; see https://example.com/pr/7.`,
      `${GUIDE}Plan      p2 correctness · due today 12:00 · late 2h · week 10-13`,
      `${GUIDE}What      2026-10-13 lead: ship the pane`,
      `${UNDER}see docs/x.md`,
      `${GUIDE}Who       asked by owner · added by lead · 10-13 12:00`,
      `${GUIDE}After     T5 done, T6 open`,
      `${GUIDE}Goal      G10.2 The pane in fullscreen`,
      `${UNDER}G15`,
      `${GUIDE}Evidence  abc123`,
      `${GUIDE}Links     https://example.com/pr/7`,
    ])
    expect(rows.every(row => row.hang?.text === UNDER && row.hang.dim === true)).toBe(true)
    expect(rows.every(row => row.spans[0]?.dim === true)).toBe(true)
    expect(rows.find(row => row.key.endsWith(':status'))?.spans[1]).toEqual({ text: 'Status    ', dim: true })
    expect(rows.find(row => row.key.endsWith(':status:1'))?.spans[1]?.color).toBe('error')
    expect(rows.find(row => row.key.endsWith(':plan'))?.spans.find(span => span.text === 'late 2h')?.color).toBe('error')
    expect(rows.find(row => row.key.endsWith(':what:1'))?.spans[1]?.dim).toBe(true)
    expect(rows.find(row => row.key.endsWith(':links'))?.spans[2]).toEqual({ text: 'https://example.com/pr/7', href: 'https://example.com/pr/7' })
  })

  test('a row with no value is left out: a fresh task with no ref, goal, plan dependency or evidence has its status, plan and who alone', async () => {
    const tasks = rowsOf([createLine('T2', { owner: 'po', by: 'po', at: NOW - HOUR, source: 'po', ref: null, goals: [], week: null })])
    expect(cardOf(tasks, 'T2').map(textOf)).toEqual([`${GUIDE}Status    open since 13:00 by po`, `${GUIDE}Plan      p3`, `${GUIDE}Who       asked by po · 10-13 13:00`])
  })

  test('says who set the status only while that is the newest event; a status note follows it, green while verifying, in the text color in progress', async () => {
    const tasks = rowsOf([
      createLine('T1', { owner: 'po', by: 'po', at: NOW - DAY, source: 'po', ref: null, goals: [] }),
      statusLine('T1', 'po', NOW - HOUR, 'in-progress', 'halfway'),
      updateLine('T1', 'lead', NOW, { priority: 1 }),
      createLine('T2', { owner: 'po', by: 'po', at: NOW - DAY, source: 'po', ref: null, goals: [], due: '2026-10-13 18:00' }),
      statusLine('T2', 'po', NOW, 'verifying', 'health check passes', 'abc123'),
    ])
    const working = cardOf(tasks, 'T1')
    expect(working.slice(0, 3).map(textOf)).toEqual([`${GUIDE}Status    in progress since 13:00`, `${UNDER}halfway`, `${GUIDE}Plan      p1 · week 10-13`])
    expect(working[1]?.spans[1]?.color).toBe(undefined)
    const verifying = cardOf(tasks, 'T2')
    expect(verifying.slice(0, 3).map(textOf)).toEqual([
      `${GUIDE}Status    verifying since 14:00 by po`,
      `${UNDER}health check passes`,
      `${GUIDE}Plan      p3 · verify by today 18:00 · week 10-13`,
    ])
    expect(verifying[1]?.spans[1]?.color).toBe('success')
    // A task finished earlier on its day: when it closed, and its note.
    const done = rowsOf([createLine('T3', { owner: 'po', by: 'po', at: NOW - DAY, source: 'po' }), statusLine('T3', 'po', NOW - HOUR, 'done', 'merged', 'def456')])
    expect(cardRows('done', taskOf(done, 'T3'), UNREAD, contextOf(done, NOW), 'po').slice(0, 2).map(textOf)).toEqual([
      `${GUIDE}Status    done since 13:00 by po`,
      `${UNDER}merged`,
    ])
  })

  test("Who names the owner in another area's list, not in the owner's own list nor in the all view", async () => {
    const tasks = rowsOf([createLine('T1', { owner: 'po', by: 'lead', at: NOW - HOUR, source: 'lead' })])
    const who = (viewer: string | null) => textOf(cardOf(tasks, 'T1', UNREAD, viewer).find(row => row.key.endsWith(':who')) ?? { key: '', spans: [] })
    expect(who('etl')).toBe(`${GUIDE}Who       asked by lead · 10-13 13:00 · owner po`)
    expect(who('po')).toBe(`${GUIDE}Who       asked by lead · 10-13 13:00`)
    expect(who(null)).toBe(`${GUIDE}Who       asked by lead · 10-13 13:00`)
  })

  test('What keeps quotes only for the ref they were read for; a goal no item was read for shows its id', async () => {
    const tasks = rowsOf([createLine('T1', { owner: 'po', by: 'po', at: NOW - HOUR, source: 'po', ref: 'old' }), updateLine('T1', 'po', NOW, { ref: 'new' })])
    const stale: TaskDetail = { ref: 'old', quotes: [{ ref: 'old', lines: ['the old ask'] }], goals: [] }
    const rows = cardOf(tasks, 'T1', stale)
    expect(rows.some(row => row.spans.some(span => span.text === 'the old ask'))).toBe(false)
    expect(rows.filter(row => /:(what|goal)/.test(row.key)).map(textOf)).toEqual([`${GUIDE}What      see new`, `${GUIDE}Goal      G10.2`])
  })

  test("a task a GitHub issue opened links to its issue first; each link on its own line under the value column", async () => {
    const tasks = rowsOf([
      createLine('T1', { owner: 'po', by: 'github', at: NOW - HOUR, source: 'github', ref: 'gh:acme/app#12', goals: [] }),
      statusLine('T1', 'po', NOW, 'verifying', 'review https://example.com/pr/7', 'https://ci.example/run/9'),
    ])
    const links = cardOf(tasks, 'T1').filter(row => row.key.includes(':links'))
    expect(links.map(textOf)).toEqual([
      `${GUIDE}Links     https://github.com/acme/app/issues/12`,
      `${UNDER}https://example.com/pr/7`,
      `${UNDER}https://ci.example/run/9`,
    ])
    expect(links.map(row => row.spans.at(-1)?.href)).toEqual(['https://github.com/acme/app/issues/12', 'https://example.com/pr/7', 'https://ci.example/run/9'])
    expect(textOf(cardOf(tasks, 'T1').find(row => row.key.endsWith(':what')) ?? { key: '', spans: [] })).toBe(`${GUIDE}What      see gh:acme/app#12`)
  })

  test('each id the snapshot holds, in a reason, a note, the After row or the ask, is a span marked with its task; others stay words', async () => {
    const tasks = rowsOf([
      createLine('T6', { owner: 'etl', by: 'etl', at: NOW - DAY, source: 'etl' }),
      createLine('T1', { owner: 'po', by: 'po', at: NOW - HOUR, source: 'po', ref: 'docs/x.md:3', goals: [], taskKeys: { after: ['T6', 'T99'] } }),
      waitingLine('T1', 'po', NOW, [{ kind: 'task', id: 'T6' }], 'T99 gone, see https://example.com/T6'),
    ])
    const detail: TaskDetail = { ref: 'docs/x.md:3', quotes: [{ ref: 'docs/x.md:3', lines: ['ship T6 first'] }], goals: [] }
    const rows = cardOf(tasks, 'T1', detail)
    const ids = (row: string) => rows.find(each => each.key.endsWith(`:${row}`))?.spans.filter(span => span.task !== undefined)
    expect(ids('status:1')).toEqual([{ text: 'T6', color: 'error', task: 'T6' }])
    expect(ids('after')).toEqual([{ text: 'T6', task: 'T6' }])
    expect(ids('what')).toEqual([{ text: 'T6', task: 'T6' }])
    expect(textOf(rows.find(each => each.key.endsWith(':status:1')) ?? { key: '', spans: [] })).toBe(`${UNDER}on T6; T99 gone, see https://example.com/T6`)
    expect(textOf(rows.find(each => each.key.endsWith(':after')) ?? { key: '', spans: [] })).toBe(`${GUIDE}After     T6 open, T99`)
    // The card's own labels never hold one.
    expect(rows.every(row => row.spans[0]?.task === undefined && row.spans[1]?.task === undefined)).toBe(true)
  })

  test('a value wraps under the value column in a narrow pane, never past its width', async () => {
    const detail: TaskDetail = { ref: 'docs/x.md:9', quotes: [{ ref: 'docs/x.md:9', lines: ['the pane draws a card under the task title'] }], goals: [] }
    const tasks = rowsOf([createLine('T1', { owner: 'po', by: 'po', at: NOW - HOUR, source: 'po', ref: 'docs/x.md:9', goals: [] })])
    const what = cardOf(tasks, 'T1', detail).find(row => row.key.endsWith(':what'))
    if (what === undefined) throw new Error('no What row')
    const lines = wrapRow(what, 34).map(line => line.map(span => span.text).join(''))
    expect(lines).toEqual([`${GUIDE}What      the pane draws a`, `${UNDER}card under the`, `${UNDER}task title`])
    expect(lines.every(line => line.length <= 34)).toBe(true)
  })
})
