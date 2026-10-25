import { describe, expect, test } from 'claude-code/testing'
import type { Snapshot, TaskRow, TaskStatus } from '../types'
import { LABEL_CELLS } from '../hooks/card'
import { COMMAND, inlineReason, parsePaneArgs, USAGE } from '../hooks/command'
import { LiveRegister, pinKey, type LivePorts, type Timer } from '../hooks/live'
import { indexMarks, readMarks, readRegister, TASK_STATUSES } from '../hooks/core/read/index'
import { rowOf, STATUS_CONTRACT_MATCHES } from '../hooks/log'
import { cardParts, dockLayout, failedDrawing, inlineLayout, merged, piecesOf, rowParts, wrapRow, type Drawn } from '../hooks/layout'
import { GLYPH, GLYPH_COLOR, NOTHING_EXPANDED, moreText, paneBlocks, type Block, type Row, type Span } from '../hooks/rows'
import { barCounts } from '../hooks/status-bar'
import { cells, graphemes } from '../hooks/width'
import { MAX_READ_BYTES, TaskRegisterSource, registerPaths, skippedText, unlessMissing, type RegisterPaths } from '../hooks/source'
import { areaView, MAX_FINISHED, ownerGroups, sameView } from '../hooks/view'
import { HELD_DAYS } from '../hooks/done'
import type { TeamFiles } from '../hooks/places'
import { HOUR, MemoryFiles, NOT_PICKED_UP_HOURS, NOW, NO_TEAM, S1, S2, S3, TEAM_SETTINGS, bigRegister, clockAt, createLine, iso, markLine, statusLine, treeAt, updateLine, waitingLine, verifyingLine } from './fixtures'

const DAY = 24 * HOUR

const PATHS: RegisterPaths = { events: 'R/tasks/events.jsonl', marks: 'R/tasks/inbox-marks.jsonl', inboxDir: 'R/inbox' }

/** The rows the pane draws from event lines, read by teamrig's reader, in the order the tasks were created. */
function rowsOf(lines: readonly string[]): TaskRow[] {
  return [...readRegister(lines.join('\n')).state.tasks.values()].map(task => rowOf(task))
}

function fold(...lines: string[]): TaskRow[] {
  return rowsOf(lines)
}

describe('log', () => {
  test('reads what teamrig reads and counts what it skips: torn lines, unknown types, newer lines, events naming no task', async () => {
    const lines = [
      createLine('T1', { owner: 'po', by: 'lead', at: NOW }),
      '{"v":2,"type":"create","id":"T2"',
      '',
      JSON.stringify({ v: 2, type: 'rename', id: 'T1', at: iso(NOW), by: 'po' }),
      createLine('T3', { owner: 'po', by: 'lead', at: NOW, lineKeys: { v: 3, trace: 'a1' } }),
      statusLine('T9', 'po', NOW, 'done'),
    ]
    const register = readRegister(lines.join('\n'))
    expect([...register.state.tasks.keys()]).toEqual(['T1'])
    expect([register.read.unreadable, register.read.newer, register.state.orphans]).toEqual([2, 1, 1])
    expect(skippedText(PATHS, register, readMarks(''))).toBe(
      'events.jsonl: 2 unreadable line(s), 1 line(s) from a newer teamrig, 1 event(s) naming no task',
    )
    expect(skippedText(PATHS, readRegister(lines[0] ?? ''), readMarks(''))).toBe(null)
  })

  test('counts the inbox marks teamrig skips apart from the events: one naming no Claude session, one from a newer teamrig', async () => {
    const marks = readMarks(
      [
        markLine('po', 1, S1, NOW, 'a'),
        markLine('po', 1, 'not-a-session', NOW),
        JSON.stringify({ v: 2, area: 'po', line: 1, at: iso(NOW), claudeSession: S1, lastLineHash: null }),
      ].join('\n'),
    )
    expect(marks.marks.length).toBe(1)
    expect(skippedText(PATHS, readRegister(''), marks)).toBe('inbox-marks.jsonl: 1 unreadable line(s), 1 line(s) from a newer teamrig')
    expect(skippedText(PATHS, readRegister('{'), marks)).toBe(
      'events.jsonl: 1 unreadable line(s), 0 line(s) from a newer teamrig, 0 event(s) naming no task; inbox-marks.jsonl: 1 unreadable line(s), 1 line(s) from a newer teamrig',
    )
  })

  test('a task created for another session is unseen until its owner writes an event', async () => {
    const [created] = fold(createLine('T1', { owner: 'po', by: 'lead', at: NOW }))
    expect(created?.ownerSeenAt).toBe(null)
    const [seen] = fold(createLine('T1', { owner: 'po', by: 'lead', at: NOW }), statusLine('T1', 'po', NOW + HOUR, 'in-progress'))
    expect(seen?.status).toBe('in-progress')
    expect(seen?.ownerSeenAt).toBe(new Date(NOW + HOUR).toISOString())
  })

  test('a handoff resets assignedAt and is seen only when the new owner made it', async () => {
    const base = [createLine('T1', { owner: 'po', by: 'po', at: NOW })]
    const [byLead] = fold(...base, updateLine('T1', 'lead', NOW + HOUR, { owner: 'etl' }))
    expect(byLead?.owner).toBe('etl')
    expect(byLead?.assignedAt).toBe(new Date(NOW + HOUR).toISOString())
    expect(byLead?.ownerSeenAt).toBe(null)
    const [byNewOwner] = fold(...base, updateLine('T1', 'etl', NOW + HOUR, { owner: 'etl' }))
    expect(byNewOwner?.ownerSeenAt).toBe(new Date(NOW + HOUR).toISOString())
  })

  test('keeps who asked, the ref and goals, and the newest evidence through later statuses', async () => {
    const [task] = fold(
      createLine('T1', { owner: 'po', by: 'lead', at: NOW, source: 'owner', ref: '~/team-notes/board/inbox/po.md:3', goals: ['G10.3e'] }),
      statusLine('T1', 'po', NOW + HOUR, 'done', 'shipped', 'abc1234'),
      statusLine('T1', 'po', NOW + 2 * HOUR, 'open', 'reopened'),
      updateLine('T1', 'lead', NOW + 3 * HOUR, { ref: 'docs/y.md:9', goals: ['G10.2a', 'G11'] }),
    )
    expect(task?.source).toBe('owner')
    expect(task?.createdBy).toBe('lead')
    expect(task?.note).toBe('reopened')
    expect(task?.evidence).toBe('abc1234')
    expect(task?.ref).toBe('docs/y.md:9')
    expect(task?.goals).toEqual(['G10.2a', 'G11'])
  })

  test('carries when the status and the priority last changed, who wrote the newest event, and the skill the status named', async () => {
    const [task] = fold(
      createLine('T1', { owner: 'po', by: 'lead', at: NOW, priority: 3 }),
      statusLine('T1', 'po', NOW + HOUR, 'in-progress'),
      statusLine('T1', 'po', NOW + 2 * HOUR, 'in-progress', 'halfway'),
      updateLine('T1', 'lead', NOW + 3 * HOUR, { priority: 1 }),
      updateLine('T1', 'po', NOW + 4 * HOUR, { due: '2026-10-20' }),
    )
    // A repeated status keeps when it was taken; an update that leaves the priority keeps when it was set.
    expect(task?.statusAt).toBe(iso(NOW + HOUR))
    expect(task?.priorityAt).toBe(iso(NOW + 3 * HOUR))
    expect(task?.updatedBy).toBe('po')
    expect(task?.skill).toBe(null)
    const [done] = fold(createLine('T1', { owner: 'po', by: 'lead', at: NOW }), statusLine('T1', 'po', NOW + HOUR, 'done', 'shipped', 'abc1234', 'teamrig-ship-change'))
    expect([done?.skill, done?.statusAt, done?.priorityAt, done?.updatedBy]).toEqual(['teamrig-ship-change', iso(NOW + HOUR), iso(NOW), 'po'])
  })

  test('a create whose goals are not all text is skipped and counted unreadable', async () => {
    const line = JSON.stringify({
      v: 2,
      type: 'create',
      id: 'T1',
      at: iso(NOW),
      by: 'po',
      task: { title: 't', owner: 'po', source: 'po', ref: 'r', priority: 2, due: null, goals: [1], week: null },
    })
    const register = readRegister(line)
    expect(register.state.tasks.size).toBe(0)
    expect(register.read.unreadable).toBe(1)
  })

  test('a repeated create and events for unknown ids change nothing, and both count as naming no task', async () => {
    const lines = [
      createLine('T1', { owner: 'po', by: 'po', at: NOW, title: 'first' }),
      createLine('T1', { owner: 'etl', by: 'etl', at: NOW, title: 'second' }),
      statusLine('T9', 'po', NOW, 'done'),
    ]
    const tasks = fold(...lines)
    expect(tasks.length).toBe(1)
    expect(tasks[0]?.title).toBe('first')
    expect(readRegister(lines.join('\n')).state.orphans).toBe(2)
  })

  test('a task with no ref and no week, a priority-only update and an old blocked status read as teamrig reads them: waiting, with no reasons', async () => {
    const [task] = fold(
      createLine('T1', { owner: 'po', by: 'lead', at: NOW, ref: null, week: null }),
      updateLine('T1', 'lead', NOW + HOUR, { priority: 1 }),
      statusLine('T1', 'po', NOW + 2 * HOUR, 'blocked', 'waits on the owner'),
    )
    expect(task?.ref).toBe(null)
    expect(task?.week).toBe(null)
    expect(task?.priority).toBe(1)
    expect(task?.status).toBe('waiting')
    expect(task?.note).toBe('waits on the owner')
    expect([task?.waits, task?.after]).toEqual([[], []])
  })

  test('a waiting task carries its reasons and an open one its plan dependency, and the row says what it waits for', async () => {
    const waits = [{ kind: 'decision', who: 'owner' }, { kind: 'task', id: 'T1' }, { kind: 'time', at: '2026-10-16 14:00' }]
    const tasks = fold(
      createLine('T1', { owner: 'po', by: 'po', at: NOW - HOUR }),
      statusLine('T1', 'po', NOW - HOUR, 'in-progress'),
      createLine('T2', { owner: 'po', by: 'po', at: NOW - HOUR }),
      statusLine('T2', 'po', NOW - HOUR, 'in-progress'),
      JSON.stringify({ ...JSON.parse(statusLine('T2', 'po', NOW, 'waiting', 'the copy first')), waits }),
      JSON.stringify({ ...JSON.parse(createLine('T3', { owner: 'po', by: 'po', at: NOW })), task: { ...JSON.parse(createLine('T3', { owner: 'po', by: 'po', at: NOW })).task, after: ['T1'] } }),
    )
    const [, waiting, open] = tasks
    expect(waiting?.waits).toEqual(waits)
    expect(open?.after).toEqual(['T1'])
  })

  test('the statuses the plugin contract spells out are teamrig\'s, and each draws a glyph', async () => {
    expect(STATUS_CONTRACT_MATCHES).toBe(true)
    const statuses: readonly TaskStatus[] = TASK_STATUSES
    expect(Object.keys(GLYPH).sort()).toEqual([...statuses].sort())
  })

  test('each status glyph is a one-cell text symbol, never an emoji, and verifying is the green half of working', async () => {
    for (const glyph of Object.values(GLYPH)) {
      expect(cells(glyph)).toBe(1)
      expect(/\p{Extended_Pictographic}/u.test(glyph)).toBe(false)
    }
    expect([GLYPH.verifying, GLYPH_COLOR.verifying]).toEqual(['◑', 'success'])
    expect([GLYPH['in-progress'], GLYPH_COLOR['in-progress']]).toEqual(['◐', 'warning'])
  })

  test('binds a session to the area of its newest inbox read, whose mark is the area\'s read position', async () => {
    const { byArea, areaBySession } = indexMarks(
      readMarks([markLine('po', 10, S1, NOW), markLine('lead', 4, S2, NOW), markLine('po', 24, S1, NOW + 1)].join('\n')).marks,
    )
    expect(areaBySession.get(S1)).toBe('po')
    expect(areaBySession.get(S3)).toBe(undefined)
    expect(byArea.get('po')?.line).toBe(24)
  })
})

describe('view', () => {
  test('lists each section in plan order: priority, then due (undated last), then id; what it asked of others waits', async () => {
    const tasks = fold(
      createLine('T1', { owner: 'po', by: 'po', at: NOW, priority: 3 }),
      createLine('T2', { owner: 'po', by: 'po', at: NOW, priority: 1 }),
      createLine('T3', { owner: 'po', by: 'po', at: NOW, priority: 3, due: '2026-10-14' }),
      createLine('T4', { owner: 'po', by: 'po', at: NOW, priority: 3, due: '2026-10-14 09:00' }),
      createLine('T5', { owner: 'etl', by: 'po', at: NOW }),
    )
    const view = areaView(tasks, 'po', treeAt(tasks, NOW))
    expect(view.upNext.map(t => t.id)).toEqual(['T2', 'T4', 'T3', 'T1'])
    expect(view.waiting.map(t => t.id)).toEqual(['T5'])
    expect([view.verifying, view.working, view.doneToday]).toEqual([[], [], []])
  })

  test('plan order reads the effective due: an undated task a dated one needs comes before a later-dated one', async () => {
    const tasks = fold(
      createLine('T1', { owner: 'po', by: 'po', at: NOW, due: '2026-10-20' }),
      createLine('T2', { owner: 'po', by: 'po', at: NOW }),
      createLine('T3', { owner: 'etl', by: 'etl', at: NOW, due: '2026-10-15', taskKeys: { after: ['T2'] } }),
    )
    const tree = treeAt(tasks, NOW)
    expect(areaView(tasks, 'po', tree).upNext.map(t => t.id)).toEqual(['T2', 'T1'])
    expect(ownerGroups(tasks, tree).map(g => g.active.map(t => t.id))).toEqual([['T3'], ['T2', 'T1']])
  })

  test('waiting holds its own waiting tasks first, then up to 8 it asked of others, counting them all', async () => {
    const asked = Array.from({ length: 10 }, (_, i) => createLine(`T${i + 10}`, { owner: 'etl', by: 'po', at: NOW }))
    const tasks = fold(createLine('T1', { owner: 'po', by: 'po', at: NOW, priority: 4 }), statusLine('T1', 'po', NOW, 'waiting', 'needs owner'), ...asked)
    const view = areaView(tasks, 'po', treeAt(tasks, NOW))
    expect(view.waiting.map(t => t.id)).toEqual(['T1', 'T10', 'T11', 'T12', 'T13', 'T14', 'T15', 'T16', 'T17'])
    expect(view.counts.waiting).toBe(11)
  })

  test('done today is its tasks done or dropped on the UTC day of the clock, newest first, the day the bar counts', async () => {
    const tasks = fold(
      createLine('T1', { owner: 'po', by: 'po', at: NOW - 48 * HOUR }),
      statusLine('T1', 'po', NOW - 2 * HOUR, 'done'),
      createLine('T2', { owner: 'po', by: 'po', at: NOW - 48 * HOUR }),
      statusLine('T2', 'po', NOW - 30 * HOUR, 'dropped'),
      createLine('T3', { owner: 'po', by: 'po', at: NOW - 48 * HOUR }),
      statusLine('T3', 'po', NOW - HOUR, 'dropped'),
      // Mon 23:59: within the last day, not today.
      createLine('T4', { owner: 'po', by: 'po', at: NOW - 48 * HOUR }),
      statusLine('T4', 'po', Date.UTC(2026, 9, 12, 23, 59), 'done'),
    )
    const view = areaView(tasks, 'po', treeAt(tasks, NOW))
    expect(view.doneToday.map(t => t.id)).toEqual(['T3', 'T1'])
    expect(view.counts['done-today']).toBe(2)
    expect(barCounts(tasks, 'po', clockAt(NOW))['done-today']).toBe(view.doneToday.length)
    expect(areaView(tasks, 'po', treeAt(tasks, Date.UTC(2026, 9, 14))).counts['done-today']).toBe(0)
  })

  test('two snapshots draw the same pane unless a field, a task or a time label differs', async () => {
    const tasks = fold(createLine('T1', { owner: 'po', by: 'lead', at: NOW, due: '2026-10-13 15:00' }))
    const base: Snapshot = { tasks, area: 'po', areaSource: 'pinned', unreadInbox: 0, problem: null, ...NO_TEAM, ...TEAM_SETTINGS, now: NOW }
    expect(sameView(base, { ...base, tasks: fold(createLine('T1', { owner: 'po', by: 'lead', at: NOW, due: '2026-10-13 15:00' })) })).toBe(true)
    expect(sameView(base, { ...base, now: NOW + HOUR / 2 })).toBe(true)
    expect(sameView(base, { ...base, now: NOW + 2 * HOUR })).toBe(false)
    expect(sameView(base, { ...base, unreadInbox: 1 })).toBe(false)
    expect(sameView(base, { ...base, notPickedUpAfterHours: NOT_PICKED_UP_HOURS * 2 })).toBe(false)
    expect(sameView(base, { ...base, timeZone: 'Asia/Jerusalem' })).toBe(false)
    const leads = { lead: 'lead', leaderOf: { po: 'lead' } }
    expect(sameView({ ...base, leads }, { ...base, leads: { lead: 'lead', leaderOf: { po: 'lead' } } })).toBe(true)
    expect(sameView(base, { ...base, leads })).toBe(false)
    const regoaled = fold(createLine('T1', { owner: 'po', by: 'lead', at: NOW, due: '2026-10-13 15:00', goals: ['G11'] }))
    expect(sameView(base, { ...base, tasks: regoaled })).toBe(false)
    expect(sameView(base, { ...base, tasks: fold(createLine('T1', { owner: 'po', by: 'lead', at: NOW, title: 'Renamed' })) })).toBe(false)
    const started = fold(createLine('T1', { owner: 'po', by: 'lead', at: NOW, due: '2026-10-13 15:00' }), statusLine('T1', 'po', NOW, 'open', null, null, 'none'))
    expect(sameView(base, { ...base, tasks: started })).toBe(false)
    // A reason the clock clears redraws: its row then reads ready.
    const waits = fold(createLine('T1', { owner: 'po', by: 'po', at: NOW - DAY }), waitingLine('T1', 'po', NOW - DAY, [{ kind: 'time', at: '2026-10-13 14:30' }]))
    const waiting: Snapshot = { ...base, tasks: waits }
    expect(sameView(waiting, { ...waiting, now: NOW + 60_000 })).toBe(true)
    expect(sameView(waiting, { ...waiting, now: NOW + HOUR })).toBe(false)
    // A finished task leaves the list, and the bar's done today, at the zone's midnight (UTC's here): a tick across it redraws.
    const done = fold(createLine('T1', { owner: 'po', by: 'po', at: NOW - HOUR }), statusLine('T1', 'po', NOW, 'done'))
    const late: Snapshot = { ...base, tasks: done, now: Date.UTC(2026, 9, 13, 23, 58) }
    expect(sameView(late, { ...late, now: Date.UTC(2026, 9, 13, 23, 59) })).toBe(true)
    expect(sameView(late, { ...late, now: Date.UTC(2026, 9, 14, 0, 1) })).toBe(false)
    // An open task's card says since when it is open, which its meta line leaves out: `14:00 UTC` that day, `Tue 10-13` from the zone's midnight on.
    const opened: Snapshot = { ...base, tasks: fold(createLine('T1', { owner: 'po', by: 'po', at: NOW })), now: Date.UTC(2026, 9, 13, 23, 58) }
    expect(sameView(opened, { ...opened, now: Date.UTC(2026, 9, 13, 23, 59) })).toBe(true)
    expect(sameView(opened, { ...opened, now: Date.UTC(2026, 9, 14, 0, 1) })).toBe(false)
  })

  test('groups every owner with active tasks and counts the waiting ones', async () => {
    const tasks = fold(
      createLine('T1', { owner: 'security', by: 'lead', at: NOW }),
      statusLine('T1', 'security', NOW, 'waiting', 'needs owner'),
      createLine('T2', { owner: 'etl', by: 'lead', at: NOW }),
      createLine('T3', { owner: 'etl', by: 'etl', at: NOW }),
      statusLine('T3', 'etl', NOW, 'done'),
    )
    expect(ownerGroups(tasks, treeAt(tasks, NOW)).map(g => [g.owner, g.active.length, g.waiting])).toEqual([
      ['etl', 1, 0],
      ['security', 1, 1],
    ])
  })

  test('keeps the verifying tasks apart, in plan order, and leads each owner group with them', async () => {
    const tasks = fold(
      createLine('T1', { owner: 'po', by: 'po', at: NOW - HOUR, priority: 1 }),
      createLine('T2', { owner: 'po', by: 'po', at: NOW - HOUR, priority: 3 }),
      statusLine('T2', 'po', NOW, 'verifying', 'health check passes'),
      createLine('T3', { owner: 'po', by: 'po', at: NOW - HOUR, priority: 2 }),
      statusLine('T3', 'po', NOW, 'verifying', 'one clean roll'),
    )
    const view = areaView(tasks, 'po', treeAt(tasks, NOW))
    expect(view.verifying.map(t => t.id)).toEqual(['T3', 'T2'])
    expect(view.upNext.map(t => t.id)).toEqual(['T1'])
    const [group] = ownerGroups(tasks, treeAt(tasks, NOW))
    expect(group?.active.map(t => t.id)).toEqual(['T3', 'T2', 'T1'])
    expect([group?.waiting, group?.verifying]).toEqual([0, 2])
  })
})

describe('rows', () => {
  const textOf = (row: Row) => row.spans.map(span => span.text).join('')
  const blockAt = (blocks: readonly Block[], key: string) => blocks.find(b => b.key === key)
  const rowAt = (blocks: readonly Block[], key: string) => blocks.flatMap(b => b.rows).find(r => r.key === key)
  const textAt = (blocks: readonly Block[], key: string) => {
    const row = rowAt(blocks, key)
    return row ? textOf(row) : undefined
  }
  /** Where a card value's further lines start: the guide, then blank up to the value column. */
  const CARD_UNDER = `    │ ${' '.repeat(LABEL_CELLS)}`
  /** A card row's first line in the list: the guide, the label padded to the value column, the value. */
  const cardLine = (label: string, value: string) => `    │ ${label.padEnd(LABEL_CELLS)}${value}`
  const cardText = (blocks: readonly Block[], key: string) => {
    const row = blocks.flatMap(b => b.card ?? []).find(r => r.key === key)
    return row ? textOf(row) : undefined
  }
  const snapshotOf = (tasks: TaskRow[], area: string | null): Snapshot => ({
    tasks,
    area,
    areaSource: 'inbox-read',
    unreadInbox: 2,
    problem: null,
    ...NO_TEAM,
    ...TEAM_SETTINGS,
    now: NOW,
  })

  test('a task is a block to press: its mark, bold id and title cut at two lines, then a dim meta line under the title', async () => {
    const tasks = fold(
      createLine('T1', { owner: 'po', by: 'lead', at: NOW - HOUR, source: 'lead', priority: 2, due: '2026-10-14', title: 'Ship it' }),
      createLine('T2', { owner: 'po', by: 'po', at: NOW - HOUR, source: 'po' }),
      statusLine('T2', 'po', NOW, 'waiting', 'needs owner'),
      createLine('T3', { owner: 'po', by: 'po', at: NOW - HOUR, source: 'po', title: 'Old work' }),
      statusLine('T3', 'po', NOW, 'done'),
    )
    const blocks = paneBlocks(snapshotOf(tasks, 'po'), 'mine')
    expect(blocks.map(b => b.key)).toEqual(['header', 'next', 'next:T1', 'waiting', 'waiting:T2', 'done', 'done:T3'])
    expect(textAt(blocks, 'header')).toBe('2 active · inbox 2 unread')
    expect(rowAt(blocks, 'header')?.rule).toBe(true)
    expect(rowAt(blocks, 'next:T1')?.spans).toEqual([{ text: '○' }, { text: ' T1', bold: true }, { text: '  Ship it' }])
    expect(rowAt(blocks, 'next:T1')?.hang).toEqual({ text: '      ' })
    expect(rowAt(blocks, 'next:T1')?.maxLines).toBe(2)
    expect(blockAt(blocks, 'next:T1')?.toggle).toBe('T1')
    expect(blockAt(blocks, 'next:T1')?.rows.map(r => r.key)).toEqual(['next:T1', 'next-meta:T1'])
    expect(textAt(blocks, 'next-meta:T1')).toBe('      p2 · due Wed 10-14 · new · asked by lead')
    expect(rowAt(blocks, 'next-meta:T1')?.spans.slice(1).map(span => span.dim ?? span.color)).toEqual([true, true, true, true, 'suggestion', true, true])
    expect(rowAt(blocks, 'next-meta:T1')?.hang).toEqual({ text: '      ' })
    expect(rowAt(blocks, 'next')?.spans).toEqual([{ text: 'Up next', bold: true }, { text: ' (1)', dim: true }])
    expect(blockAt(blocks, 'next')?.opensSection).toBe(true)
    expect(textAt(blocks, 'waiting')).toBe('Waiting (1)')
    expect(rowAt(blocks, 'waiting:T2')?.spans[0]).toEqual({ text: '■', color: 'error' })
    expect(textAt(blocks, 'waiting-meta:T2')).toBe('      p3 · waiting since 14:00 UTC: needs owner')
    expect(textAt(blocks, 'done')).toBe('Done today (1)')
    expect(rowAt(blocks, 'done:T3')).toEqual({
      key: 'done:T3',
      spans: [{ text: '✓', color: 'success' }, { text: ' T3  Old work', dim: true }],
      hang: { text: '      ' },
      end: { text: '14:00 UTC', dim: true },
      maxLines: 1,
    })
    expect(blockAt(blocks, 'done:T3')?.toggle).toBe('T3')
  })

  test('done today names its total and, past the cap, how many it cut and the key whose filter lists them all, dropped ones too', async () => {
    // Seven done, then two dropped earlier: the newest six show; the seventh done and both dropped are cut.
    const lines = Array.from({ length: 9 }, (_, i) => [
      createLine(`T${i + 1}`, { owner: 'po', by: 'po', at: NOW - 2 * HOUR }),
      statusLine(`T${i + 1}`, 'po', NOW - (i + 1) * 60_000, i < 7 ? 'done' : 'dropped'),
    ]).flat()
    const tasks = fold(...lines)
    const blocks = paneBlocks(snapshotOf(tasks, 'po'), 'mine')
    expect(MAX_FINISHED).toBe(6)
    expect(textAt(blocks, 'done')).toBe('Done today (9)')
    const shown = Array.from({ length: 6 }, (_, i) => `done:T${i + 1}`)
    expect(blocks.map(b => b.key).slice(-7)).toEqual([...shown, 'done-more'])
    expect(rowAt(blocks, 'done-more')?.spans).toEqual([{ text: '3 more: press o to list them all', dim: true }])
    // The status bar's done-today filter lists all nine, uncapped.
    const filtered = paneBlocks(snapshotOf(tasks, 'po'), 'mine', NOTHING_EXPANDED, 'done-today')
    expect(filtered.map(b => b.key)).toEqual(['header', ...shown, 'done:T7', 'done:T8', 'done:T9'])
    // Six finished draw no more line.
    expect(paneBlocks(snapshotOf(fold(...lines.slice(0, 12)), 'po'), 'mine').map(b => b.key)).not.toContain('done-more')
  })

  test('a waiting row names its reasons, then its note; an open one the unfinished tasks it comes after', async () => {
    const tasks = fold(
      createLine('T1', { owner: 'po', by: 'po', at: NOW - HOUR, source: 'po' }),
      createLine('T2', { owner: 'po', by: 'po', at: NOW - HOUR }),
      waitingLine('T2', 'po', NOW, [{ kind: 'decision', who: 'owner' }, { kind: 'task', id: 'T1' }], 'the copy first'),
      createLine('T4', { owner: 'po', by: 'po', at: NOW - HOUR }),
      waitingLine('T4', 'po', NOW, [{ kind: 'time', at: '2026-10-16 14:00' }]),
      createLine('T5', { owner: 'po', by: 'po', at: NOW - HOUR, source: 'po', taskKeys: { after: ['T1'] } }),
    )
    const blocks = paneBlocks(snapshotOf(tasks, 'po'), 'mine')
    expect(textAt(blocks, 'waiting-meta:T2')).toBe('      p3 · waiting since 14:00 UTC: decision owner, on T1; the copy first')
    expect(textAt(blocks, 'waiting-meta:T4')).toBe('      p3 · waiting since 14:00 UTC: until Fri 10-16 14:00 UTC')
    expect(textAt(blocks, 'next-meta:T5')).toBe('      p3 · after T1')
  })

  test('the header leaves the session\'s own area unnamed, its tab names it, and names a pinned one', async () => {
    const tasks = fold(createLine('T1', { owner: 'po', by: 'po', at: NOW - HOUR, source: 'po' }))
    expect(rowAt(paneBlocks(snapshotOf(tasks, 'po'), 'mine'), 'header')?.spans).toEqual([
      { text: '1 active', dim: true },
      { text: ' · ', dim: true },
      { text: 'inbox 2 unread', color: 'warning', inbox: 'po' },
    ])
    const pinned = paneBlocks({ ...snapshotOf(tasks, 'po'), areaSource: 'pinned' }, 'mine')
    expect(rowAt(pinned, 'header')?.spans.slice(0, 2)).toEqual([{ text: 'po', bold: true }, { text: ' (pinned) · ', dim: true }])
    expect(textAt(pinned, 'header')).toBe('po (pinned) · 1 active · inbox 2 unread')
  })

  test("docked, the header's inbox count is a press of its own, its line drawn as pieces; inline it is words, as a card's ids are", async () => {
    const tasks = fold(createLine('T1', { owner: 'po', by: 'po', at: NOW - HOUR, source: 'po' }))
    const blocks = paneBlocks(snapshotOf(tasks, 'po'), 'mine')
    const [header, task] = dockLayout(blocks, 40)
    const count: Span = { text: 'inbox 2 unread', color: 'warning', inbox: 'po' }
    expect(header?.parts).toEqual([
      {
        kind: 'line',
        key: 'card:0',
        pieces: [
          { kind: 'words', spans: [{ text: '1 active · ', dim: true }] },
          { kind: 'inbox', span: count, area: 'po' },
          { kind: 'words', spans: [{ text: ` ${'─'.repeat(14)}`, dim: true }] },
        ],
      },
    ])
    // The Text it replaces holds the same line, so the window counts the same rows.
    expect(header?.spans.map(span => span.text).join('')).toBe(`1 active · inbox 2 unread ${'─'.repeat(14)}`)
    // A block a press opens, a task's, keeps its one Text; so does a Log conversation's, which opens its page.
    expect(task?.parts).toBeUndefined()
    const conversation: Block = { key: 'log:conv:api:c-1', rows: [{ key: 'log:conv:api:c-1', spans: [count] }] }
    expect(dockLayout([conversation], 40)[0]?.parts).toBeDefined()
    expect(dockLayout([{ ...conversation, reads: { session: 'api', claude: 'c-1' } }], 40)[0]?.parts).toBeUndefined()
    expect(inlineLayout(blocks, 6)[0]).toEqual({ key: 'header', spans: [{ text: '1 active · ', dim: true }, count], wrap: 'truncate-end', toggle: null })
    expect(piecesOf([count, { ...count, inbox: 'etl' }])).toHaveLength(2)
    // With no count, the header holds no press and stays one Text.
    expect(dockLayout(paneBlocks({ ...snapshotOf(tasks, 'po'), unreadInbox: null }, 'mine'), 40)[0]?.parts).toBeUndefined()
  })

  test("the more line names how many the cap cut and the key of the status bar's filter that lists them all", async () => {
    expect(moreText('done-today', 3)).toBe('3 more: press o to list them all')
    expect(moreText('waiting', 2)).toBe('2 more asked of others: press i to list them all')
  })

  test('the sections run Verifying, Working on, Up next, Waiting and Done today; an empty one draws nothing', async () => {
    const tasks = fold(
      createLine('T1', { owner: 'po', by: 'po', at: NOW - HOUR, source: 'po', title: 'Next' }),
      createLine('T2', { owner: 'po', by: 'po', at: NOW - HOUR, source: 'po', title: 'Working' }),
      statusLine('T2', 'po', NOW, 'in-progress', 'halfway'),
      createLine('T3', { owner: 'po', by: 'po', at: NOW - HOUR, source: 'po', due: '2026-10-16', title: 'Shipped' }),
      statusLine('T3', 'po', NOW, 'verifying', 'health check passes'),
      createLine('T4', { owner: 'po', by: 'po', at: NOW - HOUR, source: 'po', title: 'Stuck' }),
      statusLine('T4', 'po', NOW, 'waiting'),
      createLine('T5', { owner: 'po', by: 'po', at: NOW - HOUR, source: 'po', title: 'Closed' }),
      statusLine('T5', 'po', NOW, 'done'),
      createLine('T6', { owner: 'etl', by: 'po', at: NOW - HOUR, source: 'po', title: 'Asked' }),
    )
    const blocks = paneBlocks(snapshotOf(tasks, 'po'), 'mine')
    expect(blocks.map(b => b.key)).toEqual([
      'header',
      'verifying',
      'verifying:T3',
      'working',
      'working:T2',
      'next',
      'next:T1',
      'waiting',
      'waiting:T4',
      'waiting:T6',
      'done',
      'done:T5',
    ])
    expect(textAt(blocks, 'header')).toBe('4 active · inbox 2 unread')
    expect(rowAt(blocks, 'verifying')?.spans).toEqual([{ text: 'Verifying', color: 'success', bold: true }, { text: ' (1)', dim: true }])
    expect(textAt(blocks, 'verifying:T3')).toBe('◑ T3  Shipped')
    expect(rowAt(blocks, 'verifying:T3')?.spans[0]).toEqual({ text: '◑', color: 'success' })
    expect(textAt(blocks, 'verifying-meta:T3')).toBe('      p3 · verify by Fri 10-16 · verifying since 14:00 UTC: health check passes')
    expect(textAt(blocks, 'working')).toBe('Working on (1)')
    expect(rowAt(blocks, 'working:T2')?.spans[0]).toEqual({ text: '◐', color: 'warning' })
    expect(textAt(blocks, 'working-meta:T2')).toBe('      p3 · in progress since 14:00 UTC')
    expect(textAt(blocks, 'next-meta:T1')).toBe('      p3')
    expect(textAt(blocks, 'waiting')).toBe('Waiting (2)')
    expect(textAt(blocks, 'waiting-meta:T4')).toBe('      p3 · waiting since 14:00 UTC')
    expect(textAt(blocks, 'waiting-meta:T6')).toBe('      on etl · p3')
    expect(blocks.filter(b => b.rows[0]?.key === b.key && !b.key.includes(':')).every(b => b.key === 'header' || b.opensSection === true)).toBe(true)
  })

  test('waiting and done today say how many they left out and where those show', async () => {
    const asked = Array.from({ length: 10 }, (_, i) => createLine(`T${i + 10}`, { owner: 'etl', by: 'po', at: NOW - HOUR, source: 'po' }))
    const done = Array.from({ length: 8 }, (_, i) => [
      createLine(`T${i + 30}`, { owner: 'po', by: 'po', at: NOW - 2 * HOUR, source: 'po' }),
      statusLine(`T${i + 30}`, 'po', NOW - i * 60_000, 'done'),
    ]).flat()
    const blocks = paneBlocks(snapshotOf(fold(...asked, ...done), 'po'), 'mine')
    expect(textAt(blocks, 'waiting')).toBe('Waiting (10)')
    expect(blocks.filter(b => b.key.startsWith('waiting:')).length).toBe(8)
    expect(textAt(blocks, 'waiting-more')).toBe('2 more asked of others: press i to list them all')
    expect(textAt(blocks, 'done')).toBe('Done today (8)')
    expect(blocks.filter(b => b.key.startsWith('done:')).map(b => b.key)).toEqual(['done:T30', 'done:T31', 'done:T32', 'done:T33', 'done:T34', 'done:T35'])
    expect(rowAt(blocks, 'done-more')?.spans).toEqual([{ text: '2 more: press o to list them all', dim: true }])
    expect(blocks.at(-1)?.key).toBe('done-more')
    // The waiting filter lists all ten asked of others, in plan order (on one priority and no due, by id).
    const filtered = paneBlocks(snapshotOf(fold(...asked, ...done), 'po'), 'mine', NOTHING_EXPANDED, 'waiting')
    expect(filtered.map(b => b.key)).toEqual(['header', ...Array.from({ length: 10 }, (_, i) => `waiting:T${i + 10}`)])
  })

  test('a snapshot never read says the register is being read, not that the session has no area; a failed first read shows why', () => {
    const unread = { ...snapshotOf([], null), now: 0 }
    expect(paneBlocks(unread, 'mine').map(b => b.key)).toEqual(['reading'])
    expect(textAt(paneBlocks(unread, 'all'), 'reading')).toBe('Reading the register…')
    expect(paneBlocks({ ...unread, problem: 'EACCES' }, 'mine')[0]?.key).toBe('problem')
  })

  test('the register\'s problem leads the body as a WARN line', async () => {
    const blocks = paneBlocks({ ...snapshotOf([], 'po'), problem: 'events.jsonl: 1 unreadable line(s)' }, 'mine')
    expect(blocks.map(b => b.key)).toEqual(['problem', 'header', 'none-active'])
    expect(rowAt(blocks, 'problem')?.spans).toEqual([{ text: 'WARN events.jsonl: 1 unreadable line(s)', color: 'warning' }])
  })

  test("an open task's card takes its meta line's place: its title whole, the card's rows keyed by its section, on a guide", async () => {
    const ref = '~/team-notes/board/inbox/po.md:4; docs/x.md:9'
    const tasks = fold(
      createLine('T1', { owner: 'po', by: 'lead', at: NOW - HOUR, source: 'owner', ref, goals: ['G10.2', 'G15'], title: 'Ship it' }),
      statusLine('T1', 'po', NOW, 'waiting', 'needs owner', 'abc123'),
      createLine('T2', { owner: 'po', by: 'po', at: NOW - HOUR, source: 'po', ref: 'quote' }),
    )
    const quotes = [{ ref: '~/team-notes/board/inbox/po.md:4', lines: ['2026-10-13 lead: ship the pane'] }]
    const blocks = paneBlocks(snapshotOf(tasks, 'po'), 'mine', { T1: { ref, quotes, goals: [] }, T2: { ref: 'quote', quotes: [], goals: [] } })
    expect(blocks.map(b => b.key)).toEqual(['header', 'next', 'next:T2', 'waiting', 'waiting:T1'])
    expect(blockAt(blocks, 'waiting:T1')?.rows.map(r => r.key)).toEqual(['waiting:T1'])
    expect(rowAt(blocks, 'waiting:T1')?.maxLines).toBe(undefined)
    expect(blockAt(blocks, 'waiting:T1')?.card?.map(r => r.key)).toEqual([
      'waiting-card:T1:description',
      'waiting-card:T1:status',
      'waiting-card:T1:note',
      'waiting-card:T1:owner',
      'waiting-card:T1:priority',
      'waiting-card:T1:planned',
      'waiting-card:T1:goal',
      'waiting-card:T1:goal:1',
      'waiting-card:T1:origin',
      'waiting-card:T1:reference',
      'waiting-card:T1:reference:1',
      'waiting-card:T1:evidence',
    ])
    expect(blockAt(blocks, 'waiting:T1')?.card?.map(textOf)).toEqual([
      cardLine('Description', '2026-10-13 lead: ship the pane'),
      cardLine('Status', 'waiting since 14:00 UTC by po'),
      cardLine('Note', 'needs owner'),
      cardLine('Owner', 'po'),
      cardLine('Priority', '3'),
      cardLine('Planned', 'this week'),
      cardLine('Goal', 'G10.2'),
      `${CARD_UNDER}G15`,
      cardLine('Origin', 'Asked by owner, added by lead 13:00 UTC'),
      cardLine('Reference', 'inbox/po.md'),
      `${CARD_UNDER}docs/x.md`,
      cardLine('Evidence', 'abc123'),
    ])
    expect(blockAt(blocks, 'next:T2')?.card?.map(textOf)).toEqual([
      cardLine('Status', 'not started since 13:00 UTC by po'),
      cardLine('Owner', 'po'),
      cardLine('Priority', '3'),
      cardLine('Planned', 'this week'),
      cardLine('Goal', 'G10.2'),
      cardLine('Origin', 'Asked and added by po 13:00 UTC'),
      cardLine('Reference', 'quote'),
    ])
    expect(blocks.flatMap(b => b.rows).some(r => r.key.includes('-meta:'))).toBe(false)
  })

  test('an open card shows its priority as a number, each fact only when set', async () => {
    const tasks = rowsOf([
      createLine('T1', { owner: 'po', by: 'lead', at: NOW - HOUR, priority: 2, ref: null, week: null, goals: [], title: 'Bare' }),
      createLine('T2', { owner: 'po', by: 'lead', at: NOW - HOUR, priority: 7, title: 'Named' }),
      statusLine('T2', 'po', NOW, 'in-progress', 'halfway'),
    ])
    const blocks = paneBlocks(snapshotOf(tasks, 'po'), 'mine', { T1: { ref: null, quotes: [], goals: [] }, T2: { ref: 'docs/x.md', quotes: [], goals: [] } })
    expect(blockAt(blocks, 'next:T1')?.card?.map(textOf)).toEqual([
      cardLine('Status', 'not started since 13:00 UTC by lead'),
      cardLine('Owner', 'po'),
      cardLine('Priority', '2'),
      cardLine('Planned', 'not in a week plan'),
      cardLine('Origin', 'Asked by owner, added by lead 13:00 UTC'),
    ])
    expect(blockAt(blocks, 'working:T2')?.card?.map(r => r.key)).toEqual([
      'working-card:T2:status',
      'working-card:T2:note',
      'working-card:T2:owner',
      'working-card:T2:priority',
      'working-card:T2:planned',
      'working-card:T2:goal',
      'working-card:T2:origin',
      'working-card:T2:reference',
    ])
    expect(cardText(blocks, 'working-card:T2:priority')).toBe(cardLine('Priority', '7'))
    expect(cardText(blocks, 'working-card:T2:note')).toBe(cardLine('Note', 'halfway'))
    const collapsed = paneBlocks(snapshotOf(tasks, 'po'), 'mine', {})
    expect(textAt(collapsed, 'next:T1')).toBe('○ T1  Bare')
    expect(textAt(collapsed, 'next-meta:T1')).toBe('      p2 · new · asked by owner')
    expect(textAt(collapsed, 'working-meta:T2')).toBe('      p7 · in progress since 14:00 UTC')
    expect(collapsed.every(b => b.card === undefined)).toBe(true)
  })

  test('quotes read for an older ref are not shown once the ref changes', async () => {
    const tasks = fold(
      createLine('T1', { owner: 'po', by: 'po', at: NOW - HOUR, source: 'po', ref: 'old' }),
      updateLine('T1', 'po', NOW, { ref: 'new' }),
    )
    const blocks = paneBlocks(snapshotOf(tasks, 'po'), 'mine', { T1: { ref: 'old', quotes: [{ ref: 'old', lines: ['the old ask'] }], goals: [] } })
    expect(blocks.flatMap(b => b.card ?? []).some(r => r.spans.some(span => span.text === 'the old ask'))).toBe(false)
    expect(cardText(blocks, 'next-card:T1:reference')).toBe(cardLine('Reference', 'new'))
  })

  test("a done-today row opens the same card, its title whole, in the list and in the bar's done filter", async () => {
    const tasks = fold(
      createLine('T4', { owner: 'po', by: 'po', at: NOW - HOUR, source: 'po', title: 'Shipped' }),
      statusLine('T4', 'po', NOW, 'done', 'merged', 'abc123'),
    )
    const open = { T4: { ref: null, quotes: [], goals: [] } }
    const blocks = paneBlocks(snapshotOf(tasks, 'po'), 'mine', open)
    expect(blockAt(blocks, 'done:T4')?.rows.map(r => [r.key, r.maxLines])).toEqual([['done:T4', undefined]])
    expect(blockAt(blocks, 'done:T4')?.card?.map(textOf)).toEqual([
      cardLine('Status', 'done since 14:00 UTC by po'),
      cardLine('Note', 'merged'),
      cardLine('Owner', 'po'),
      cardLine('Priority', '3'),
      cardLine('Planned', 'this week'),
      cardLine('Goal', 'G10.2'),
      cardLine('Origin', 'Asked and added by po 13:00 UTC'),
      cardLine('Reference', 'docs/x.md'),
      cardLine('Evidence', 'abc123'),
    ])
    expect(blockAt(paneBlocks(snapshotOf(tasks, 'po'), 'mine', open, 'done-today'), 'done:T4')?.card?.[0]?.key).toBe('done-card:T4:status')
    expect(blockAt(paneBlocks(snapshotOf(tasks, 'po'), 'mine'), 'done:T4')?.card).toBe(undefined)
  })

  test('the all view heads each owner with its name and counts, the session area marked, its rows naming no owner', async () => {
    const tasks = fold(
      createLine('T1', { owner: 'security', by: 'lead', at: NOW }),
      statusLine('T1', 'security', NOW, 'waiting', 'needs owner'),
      createLine('T2', { owner: 'etl', by: 'etl', at: NOW, source: 'etl' }),
    )
    const blocks = paneBlocks(snapshotOf(tasks, 'etl'), 'all')
    expect(blocks.map(b => b.key)).toEqual(['owner:etl', 'etl:T2', 'owner:security', 'security:T1'])
    expect(blockAt(blocks, 'security:T1')?.rows.map(r => r.key)).toEqual(['security:T1', 'security-meta:T1'])
    expect(textAt(blocks, 'security-meta:T1')).toBe('      p3 · waiting since 14:00 UTC: needs owner')
    expect(rowAt(blocks, 'owner:security')?.spans).toEqual([{ text: 'security', bold: true }, { text: ' · 1 active · 1 waiting', dim: true }])
    expect(rowAt(blocks, 'owner:etl')?.spans[0]?.color).toBe('claude')
    expect(blocks.filter(b => b.key.startsWith('owner:')).map(b => b.opensSection)).toEqual([false, true])
  })

  test('open, a verifying task\'s card draws its proof green', async () => {
    const tasks = fold(
      createLine('T1', { owner: 'po', by: 'po', at: NOW - HOUR, title: 'Shipped' }),
      verifyingLine('T1', 'po', NOW, 'health check passes', null, 'abc123'),
    )
    const blocks = paneBlocks(snapshotOf(tasks, 'po'), 'mine', { T1: { ref: null, quotes: [], goals: [] } })
    expect(blocks.map(b => b.key)).toEqual(['header', 'verifying', 'verifying:T1'])
    expect(blocks.flatMap(b => b.card ?? []).find(r => r.key === 'verifying-card:T1:proof')?.spans[2]).toEqual({ text: 'health check passes', color: 'success' })
  })

  test('the all view counts each owner\'s verifying tasks and lists them first, with what proves them', async () => {
    const tasks = fold(
      createLine('T1', { owner: 'etl', by: 'etl', at: NOW, priority: 1 }),
      createLine('T2', { owner: 'etl', by: 'etl', at: NOW, priority: 4 }),
      statusLine('T2', 'etl', NOW, 'verifying', 'one clean night'),
    )
    const blocks = paneBlocks(snapshotOf(tasks, 'po'), 'all')
    expect(blocks.map(b => b.key)).toEqual(['owner:etl', 'etl:T2', 'etl:T1'])
    expect(textAt(blocks, 'owner:etl')).toBe('etl · 2 active · 1 verifying')
    expect(textAt(blocks, 'etl-meta:T2')).toBe('      p4 · verifying since 14:00 UTC: one clean night')
  })
})

describe('layout', () => {
  const textOf = (drawn: Drawn) => drawn.spans.map(span => span.text).join('')
  const UNDER = { text: '    ' }

  test('wraps a row at word breaks, each wrapped line under its hang, trailing spaces dropped', async () => {
    const row: Row = { key: 'r', spans: [{ text: '▸ ○ ', dim: true }, { text: 'T1', bold: true }, { text: ' one two three four' }], hang: UNDER }
    expect(wrapRow(row, 13).map(line => line.map(span => span.text).join(''))).toEqual(['▸ ○ T1 one', '    two three', '    four'])
    expect(wrapRow(row, 13)[0]).toEqual([{ text: '▸ ○ ', dim: true }, { text: 'T1', bold: true }, { text: ' one' }])
  })

  test('cuts a word wider than a line from where it starts, and rules a heading to the edge', async () => {
    const long: Row = { key: 'r', spans: [{ text: 'ab abcdefghijkl' }], hang: UNDER }
    expect(wrapRow(long, 8).map(line => line.map(span => span.text).join(''))).toEqual(['ab abcde', '    fghi', '    jkl'])
    const heading: Row = { key: 'h', spans: [{ text: '── done' }], rule: true }
    expect(wrapRow(heading, 12)).toEqual([[{ text: '── done' }, { text: ' ────', dim: true }]])
    expect(cells(wrapRow(heading, 12).flat().map(span => span.text).join(''))).toBe(12)
  })

  test('counts a wide emoji as two cells and cuts by cells, so a marker never runs past the edge', async () => {
    expect(cells('⛔T1')).toBe(4)
    expect(cells('⏸P1')).toBe(3)
    expect(cells('🔍10-15')).toBe(7)
    const row: Row = { key: 'r', spans: [{ text: '⛔⛔⛔⛔⛔' }], hang: UNDER }
    const lines = wrapRow(row, 9).map(line => line.map(span => span.text).join(''))
    expect(lines).toEqual(['⛔⛔⛔⛔', '    ⛔'])
    expect(lines.every(line => cells(line) <= 9)).toBe(true)
  })

  test('wraps CJK and cuts emoji sequences by display cells, never inside a ZWJ sequence', async () => {
    const textsOf = (row: Row, columns: number) => wrapRow(row, columns).map(line => line.map(span => span.text).join(''))
    const cjk = textsOf({ key: 'r', spans: [{ text: '任务面板显示标题' }] }, 6)
    expect(cjk).toEqual(['任务面', '板显示', '标题'])
    const family = '👨‍👩‍👧'
    const families = textsOf({ key: 'r', spans: [{ text: family.repeat(5) }], hang: UNDER }, 9)
    expect(families).toEqual([family.repeat(4), `    ${family}`])
    const mixed = textsOf({ key: 'r', spans: [{ text: 'fix 修复 ❤️ 面板 🇮🇱 标题 👍🏽 done' }], hang: UNDER }, 9)
    expect(mixed.every(line => cells(line) <= 9)).toBe(true)
    expect(mixed.join('').replaceAll(' ', '')).toBe('fix修复❤️面板🇮🇱标题👍🏽done')
  })

  test('merges each run of one style into one span', async () => {
    expect(merged([{ text: 'a' }, { text: 'b' }, { text: '' }, { text: 'c', dim: true }, { text: 'd', dim: true }, { text: 'e' }])).toEqual([
      { text: 'ab' },
      { text: 'cd', dim: true },
      { text: 'e' },
    ])
  })

  test('keeps two links side by side as two spans, and a link apart from text in its style', async () => {
    const link = (href: string) => ({ text: href, href })
    expect(merged([link('https://a.example'), link('https://b.example'), { text: ' x' }])).toEqual([link('https://a.example'), link('https://b.example'), { text: ' x' }])
  })

  test('never splits a link: it starts a fresh line when it does not fit, and one wider than a line is shortened to it', async () => {
    const href = 'https://example.com/pr/7'
    const row: Row = { key: 'l', spans: [{ text: 'Links ' }, { text: href, href }], hang: UNDER }
    expect(wrapRow(row, 30)).toEqual([[{ text: `Links ` }, { text: href, href }]])
    expect(wrapRow(row, 28)).toEqual([[{ text: 'Links' }], [UNDER, { text: href, href }]])
    // At the hang already, there is no more room to win: the link is cut there, ending in a mark, and still opens its whole address.
    expect(wrapRow({ key: 'l', spans: [{ text: href, href }] }, 12)).toEqual([[{ text: 'https://exa…', href }]])
    expect(wrapRow({ key: 'l', spans: [{ text: 'Links ' }, { text: href, href }], hang: UNDER }, 16)).toEqual([[{ text: 'Links' }], [UNDER, { text: 'https://exa…', href }]])
  })

  test('docked, an open card is its own wrapped text under its task, drawn apart from the press', async () => {
    const block: Block = {
      key: 'next:T1',
      toggle: 'T1',
      rows: [{ key: 'next:T1', spans: [{ text: '○ T1  Ship it' }] }],
      card: [
        { key: 'next-card:T1:status', spans: [{ text: '  │ ', dim: true }, { text: 'open since 13:00' }], hang: UNDER },
        { key: 'next-card:T1:links', spans: [{ text: '  │ ', dim: true }, { text: 'https://a.example', href: 'https://a.example' }] },
      ],
    }
    const [drawn] = dockLayout([block], 24)
    expect([drawn?.key, drawn?.toggle, drawn === undefined ? '' : textOf(drawn)]).toEqual(['next:T1', 'T1', '○ T1  Ship it'])
    expect(drawn?.card).toEqual([
      {
        kind: 'text',
        key: 'card:0',
        spans: [
          { text: '  │ ', dim: true },
          { text: 'open since 13:00\n' },
          { text: '  │ ', dim: true },
          { text: 'https://a.example', href: 'https://a.example' },
        ],
      },
    ])
    expect(dockLayout([{ key: block.key, toggle: 'T1', rows: block.rows }], 24)[0]?.card).toBe(undefined)
  })

  test('docked, a card line that holds a task id is a part of its own, its pieces the words and each id; the lines around it stay Texts', async () => {
    const guide: Span = { text: '  │ ', dim: true }
    const block: Block = {
      key: 'next:T1',
      toggle: 'T1',
      rows: [{ key: 'next:T1', spans: [{ text: '○ T1  Ship it' }] }],
      card: [
        { key: 's', spans: [guide, { text: 'open since 13:00' }] },
        { key: 'a', spans: [guide, { text: 'After ' }, { text: 'T5', task: 'T5' }, { text: ' done, ' }, { text: 'T6', task: 'T6' }] },
        { key: 'w', spans: [guide, { text: 'asked by owner' }] },
        { key: 'x', spans: [guide, { text: 'G1' }] },
      ],
    }
    expect(dockLayout([block], 40)[0]?.card).toEqual([
      { kind: 'text', key: 'card:0', spans: [guide, { text: 'open since 13:00' }] },
      {
        kind: 'line',
        key: 'card:1',
        pieces: [
          { kind: 'words', spans: [guide, { text: 'After ' }] },
          { kind: 'id', span: { text: 'T5', task: 'T5' }, task: 'T5' },
          { kind: 'words', spans: [{ text: ' done, ' }] },
          { kind: 'id', span: { text: 'T6', task: 'T6' }, task: 'T6' },
        ],
      },
      { kind: 'text', key: 'card:2', spans: [guide, { text: 'asked by owner\n' }, guide, { text: 'G1' }] },
    ])
    expect(cardParts([])).toEqual([])
    expect(piecesOf([{ text: 'T5', task: 'T5' }, { text: 'T5', task: 'T5' }])).toHaveLength(2)
  })

  test("a Changes file's row is a press of its own in its repo's card, keyed as the row; the rows between are Text runs", async () => {
    const a: Row = { key: 'C:/r:a.ts', spans: [{ text: ' M a.ts' }], expands: 'C:/r:a.ts' }
    const b: Row = { key: 'C:/r:b.ts', spans: [{ text: '?? b.ts' }], expands: 'C:/r:b.ts' }
    const added: Row = { key: 'diff:C:/r:a.ts:0', spans: [{ text: '   ' }, { text: '+x', color: 'success' }] }
    const removed: Row = { key: 'diff:C:/r:a.ts:1', spans: [{ text: '   ' }, { text: '-y', color: 'error' }] }
    const block: Block = { key: 'repo:C:/r', rows: [{ key: 'repo:C:/r', spans: [{ text: 'r' }] }], card: [a, added, removed, b] }
    const card = dockLayout([block], 40)[0]?.card ?? []
    expect(card.map(part => [part.kind, part.key])).toEqual([
      ['press', 'C:/r:a.ts'],
      ['text', 'card:1'],
      ['press', 'C:/r:b.ts'],
    ])
    expect(card[0]).toEqual({ kind: 'press', key: 'C:/r:a.ts', spans: [{ text: ' M a.ts' }], expands: 'C:/r:a.ts' })
    // A press row that wraps keeps every line in its one press.
    const wrapped = rowParts([{ ...a, spans: [{ text: ' M a-long-name.ts' }], hang: { text: '   ' } }], row => wrapRow(row, 10))
    expect(wrapped).toHaveLength(1)
    expect(wrapped[0]?.kind === 'press' ? wrapped[0].spans.map(span => span.text).join('') : '').toContain('\n')
    expect(rowParts([], row => wrapRow(row, 10))).toEqual([])
    // Inline, each row is one, a file's row its press.
    expect(inlineLayout([block], 10).map(drawn => [drawn.key, drawn.expands ?? null])).toEqual([
      ['repo:C:/r', null],
      ['C:/r:a.ts', 'C:/r:a.ts'],
      ['diff:C:/r:a.ts:0', null],
      ['diff:C:/r:a.ts:1', null],
      ['C:/r:b.ts', 'C:/r:b.ts'],
    ])
  })

  test('a task id is never split or merged: it moves to a fresh line whole, two side by side stay two, words beside one stay apart', async () => {
    const id: Span = { text: 'T123', task: 'T123' }
    expect(wrapRow({ key: 'r', spans: [{ text: 'after ' }, id], hang: { text: '  ' } }, 8)).toEqual([[{ text: 'after' }], [{ text: '  ' }, id]])
    expect(merged([{ text: 'on ' }, id, { text: ' x' }])).toEqual([{ text: 'on ' }, id, { text: ' x' }])
    expect(merged([{ text: 'T1', task: 'T1' }, { text: 'T2', task: 'T2' }])).toHaveLength(2)
  })

  test('a reference file is a press as a task id is: a piece of its own, never split, two side by side stay two', async () => {
    const plan = { file: 'notes/api/plan.md', line: 4 }
    const file: Span = { text: 'api/plan.md', file: plan }
    expect(piecesOf([{ text: 'see ' }, file, { text: ' first' }])).toEqual([
      { kind: 'words', spans: [{ text: 'see ' }] },
      { kind: 'file', span: file, file: plan },
      { kind: 'words', spans: [{ text: ' first' }] },
    ])
    expect(cardParts([[{ text: 'see ' }, file]]).map(part => part.kind)).toEqual(['line'])
    expect(wrapRow({ key: 'r', spans: [{ text: 'see ' }, file], hang: { text: '  ' } }, 14)).toEqual([[{ text: 'see' }], [{ text: '  ' }, file]])
    expect(merged([file, { ...file, file: { file: 'docs/x.md', line: null } }])).toHaveLength(2)
  })

  test('docked, a block is one wrapped text that keeps its toggle, a section opening on a blank line', async () => {
    const blocks: Block[] = [
      { key: 'active:T1', toggle: 'T1', rows: [{ key: 'active:T1', spans: [{ text: '▸ ○ T1 ship the pane today' }], hang: UNDER }, { key: 'note', spans: [{ text: '    ↳ waits' }] }] },
      { key: 'finished', opensSection: true, rows: [{ key: 'finished', spans: [{ text: '── finished', dim: true }], rule: true }] },
    ]
    const drawn = dockLayout(blocks, 20)
    expect(drawn.map(d => [d.key, d.toggle, d.wrap])).toEqual([
      ['active:T1', 'T1', 'wrap'],
      ['finished', null, 'wrap'],
    ])
    expect(drawn.map(textOf)).toEqual(['▸ ○ T1 ship the pane\n    today\n    ↳ waits', ` \n── finished ${'─'.repeat(8)}`])
    expect(drawn[0]?.spans.length).toBe(1)
    expect(drawn[1]?.spans).toEqual([{ text: ' \n' }, { text: `── finished ${'─'.repeat(8)}`, dim: true }])
  })

  test('docked, a narrow body wraps at its own width, however narrow, never below one column', async () => {
    const block: Block = { key: 'b', rows: [{ key: 'b', spans: [{ text: 'x '.repeat(30).trim() }], hang: UNDER }] }
    const widest = (columns: number) => Math.max(...dockLayout([block], columns).flatMap(drawn => textOf(drawn).split('\n').map(cells)))
    expect(widest(10)).toBeGreaterThan(7)
    expect(widest(10)).toBeLessThanOrEqual(10)
    expect(widest(4)).toBeLessThanOrEqual(4)
    expect(widest(1)).toBe(1)
    expect(widest(0)).toBe(1)
    expect(widest(-3)).toBe(1)
  })

  test('cuts a hang to half the line, so a narrow line keeps room for its text', async () => {
    const branch: Row = { key: 'r', spans: [{ text: '    │ ' }, { text: 'one sub task of the pane' }], hang: { text: '    │     ' } }
    const lines = wrapRow(branch, 10).map(line => line.map(span => span.text).join(''))
    expect(lines.every(line => cells(line) <= 10)).toBe(true)
    expect(lines.slice(1).every(line => line.startsWith('    │') && !line.startsWith('    │ '))).toBe(true)
    expect(lines.join(' ').split(/[\s│]+/).filter(word => word !== '').join(' ')).toBe('one sub task of the pane')
  })

  test('a row with a line limit stops there, its last line ending in a mark that fits; one that fits draws whole', async () => {
    const lines = (row: Row, columns: number) => wrapRow(row, columns).map(line => line.map(span => span.text).join(''))
    const row: Row = { key: 'r', spans: [{ text: 'aaa bbb ccc ddd eee' }], hang: { text: '  ' }, maxLines: 2 }
    expect(lines(row, 9)).toEqual(['aaa bbb', '  ccc dd…'])
    expect(lines({ ...row, maxLines: 1 }, 20)).toEqual(['aaa bbb ccc ddd eee'])
    expect(lines({ ...row, maxLines: undefined }, 9)).toEqual(['aaa bbb', '  ccc ddd', '  eee'])
    // The mark takes the style of the text it ends.
    const styled: Row = { key: 's', spans: [{ text: 'one ' }, { text: 'two three', dim: true }], maxLines: 1 }
    expect(wrapRow(styled, 8)).toEqual([[{ text: 'one ' }, { text: 'two…', dim: true }]])
    expect(lines({ key: 'w', spans: [{ text: '⛔⛔⛔ x' }], maxLines: 1 }, 6)).toEqual(['⛔⛔…'])
  })

  test('a row with an end draws it at the first line\'s right edge, the text wrapping or cut in the room left of it', async () => {
    const lines = (row: Row, columns: number) => wrapRow(row, columns).map(line => line.map(span => span.text).join(''))
    const end = { text: '14:00', dim: true }
    const done: Row = { key: 'd', spans: [{ text: '✓ T3  Old work' }], end, maxLines: 1 }
    expect(lines(done, 30)).toEqual([`✓ T3  Old work${' '.repeat(11)}14:00`])
    expect(wrapRow(done, 30)[0]?.slice(-1)).toEqual([end])
    expect(lines({ ...done, spans: [{ text: '✓ T3  A long finished title' }] }, 20)).toEqual(['✓ T3  A long…  14:00'])
    const whole = lines({ ...done, spans: [{ text: '✓ T3  A long finished title' }], hang: { text: '      ' }, maxLines: undefined }, 24)
    expect(whole).toEqual([`✓ T3  A long${' '.repeat(7)}14:00`, '      finished', '      title'])
    // Too narrow to keep the end apart: it follows the text.
    const narrow = lines({ ...done, maxLines: undefined }, 12)
    expect(narrow.join(' ')).toContain('14:00')
    expect(narrow.every(line => cells(line) <= 12)).toBe(true)
  })

  test('a wide character with no room left on a line starts the next one', async () => {
    const lines = wrapRow({ key: 'r', spans: [{ text: 'ab ⛔⛔⛔' }] }, 4).map(line => line.map(span => span.text).join(''))
    expect(lines).toEqual(['ab', '⛔⛔', '⛔'])
  })

  test('inline, a row\'s end follows its text on its one screen row', async () => {
    const block: Block = { key: 'd', rows: [{ key: 'd', spans: [{ text: '✓ T3' }], end: { text: '14:00', dim: true } }] }
    expect(inlineLayout([block], 5)[0]?.spans).toEqual([{ text: '✓ T3  ' }, { text: '14:00', dim: true }])
  })

  test("inline, an open card's rows follow its task's, a press on the task's first row alone", async () => {
    const block: Block = {
      key: 'next:T1',
      toggle: 'T1',
      rows: [{ key: 'next:T1', spans: [{ text: '○ T1' }] }],
      card: [{ key: 'next-card:T1:status', spans: [{ text: 'open' }] }],
    }
    expect(inlineLayout([block], 6).map(d => [d.key, d.toggle])).toEqual([
      ['next:T1', 'T1'],
      ['next-card:T1:status', null],
    ])
  })

  test('inline, each row takes one truncated screen row, capped, the last saying how many it left out', async () => {
    const task = (id: string): Block => ({
      key: `active:${id}`,
      toggle: id,
      rows: [{ key: `active:${id}`, spans: [{ text: `▸ ○ ${id}` }] }, { key: `note:${id}`, spans: [{ text: '    ↳ waits' }] }],
    })
    const blocks = ['T1', 'T2', 'T3'].map(task)
    const fitted = inlineLayout(blocks, 4)
    expect(fitted.map(d => [d.key, d.toggle, d.wrap])).toEqual([
      ['active:T1', 'T1', 'truncate-end'],
      ['note:T1', null, 'truncate-end'],
      ['active:T2', 'T2', 'truncate-end'],
      ['more', null, 'truncate-end'],
    ])
    expect(fitted.map(textOf)[3]).toContain('3 more lines')
    expect(inlineLayout(blocks.slice(0, 1), 4).map(d => d.key)).toEqual(['active:T1', 'note:T1'])
  })

  test('a drawing that threw is one wrapped error line naming why', async () => {
    expect(failedDrawing(new TypeError("Cannot read properties of undefined (reading 'items')"))).toEqual([
      {
        key: 'error',
        spans: [{ text: "WARN the pane could not draw: Cannot read properties of undefined (reading 'items')", color: 'error' }],
        wrap: 'wrap',
        toggle: null,
      },
    ])
    expect(failedDrawing('state store unavailable').map(textOf)).toEqual(['WARN the pane could not draw: state store unavailable'])
  })
})

describe('width', () => {
  test('counts East Asian wide and fullwidth characters as two cells, halfwidth kana as one', async () => {
    expect(cells('任务面板')).toBe(8)
    expect(cells('한국어')).toBe(6)
    expect(cells('Ａ１')).toBe(4)
    expect(cells('、。')).toBe(4)
    expect(cells('ｱｲ')).toBe(2)
  })

  test('counts an emoji sequence as the one glyph the terminal draws', async () => {
    expect(cells('👨‍👩‍👧')).toBe(2)
    expect(cells('👍🏽')).toBe(2)
    expect(cells('🇮🇱🇺🇸')).toBe(4)
    expect(cells('1️⃣')).toBe(2)
    expect(cells('❤️')).toBe(2)
    expect(cells('❤')).toBe(1)
    expect(cells('⛔\u{fe0e}')).toBe(1)
  })

  test('gives marks and format characters no cells of their own', async () => {
    expect(cells('e\u{301}')).toBe(1)
    expect(cells('a\u{200b}b')).toBe(2)
    expect(cells('ascii only')).toBe(10)
  })

  test('splits graphemes the same way with or without Intl.Segmenter', async () => {
    const text = 'a👨‍👩‍👧👍🏽🇮🇱🇺🇸e\u{301}1️⃣任'
    const expected = ['a', '👨‍👩‍👧', '👍🏽', '🇮🇱', '🇺🇸', 'e\u{301}', '1️⃣', '任']
    expect(graphemes(text, null)).toEqual(expected)
    expect(graphemes(text)).toEqual(expected)
  })
})

describe('command', () => {
  test('is /teamrig-pane, leaving /teamrig to the teamrig plugin, and every message names it', async () => {
    expect(COMMAND).toBe('teamrig-pane')
    expect(USAGE).toBe('usage: /teamrig-pane [mine | all | auto | <session>]')
    expect(inlineReason({ isFullscreen: true, columns: 96 })).toContain('then /teamrig-pane again.')
  })

  test('parses every /teamrig-pane form', async () => {
    expect(parsePaneArgs('')).toEqual({ kind: 'open' })
    expect(parsePaneArgs(' All ')).toEqual({ kind: 'mode', mode: 'all' })
    expect(parsePaneArgs('auto')).toEqual({ kind: 'auto' })
    // Any other word names a session, by its id or its name (sessions.ts looks it up).
    expect(parsePaneArgs('po')).toEqual({ kind: 'pin', word: 'po' })
    expect(parsePaneArgs(' Web-API ')).toEqual({ kind: 'pin', word: 'web-api' })
    expect(parsePaneArgs('no such area!')).toEqual({ kind: 'pin', word: 'no such area!' })
  })

  test('says why the pane sits above the prompt instead of docking', async () => {
    expect(inlineReason({ isFullscreen: true, columns: 110 })).toBe(null)
    expect(inlineReason({ isFullscreen: true, columns: 96 })).toContain('96 columns wide')
    expect(inlineReason({ isFullscreen: false, columns: 200 })).toContain('main screen')
  })
})

describe('source', () => {
  test('the register files sit under its folders, named as teamrig names them, with slashes made forward and no trailing one', async () => {
    expect(registerPaths({ tasksDir: 'D:\\team\\state\\', inboxDir: 'D:/team/state/inbox/' })).toEqual({
      events: 'D:/team/state/events.jsonl',
      marks: 'D:/team/state/inbox-marks.jsonl',
      inboxDir: 'D:/team/state/inbox',
    })
  })

  test('a stat refused as locked or denied throws, even where exists cannot see the file; only a path not there is missing', async () => {
    const refused = (message: string) => async (): Promise<number> => {
      throw new Error(message)
    }
    const failureOf = (answer: Promise<number | null>) =>
      answer.then(
        () => null,
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      )
    const absent = async () => false
    expect(await unlessMissing(async () => 7, absent, null)).toBe(7)
    expect(await unlessMissing(refused('ENOENT: no such file or directory'), absent, null)).toBe(null)
    for (const message of ['EBUSY: resource busy or locked', 'EPERM: operation not permitted', 'EACCES: permission denied'])
      expect(await failureOf(unlessMissing(refused(`teamrig-pane: $.fs.stat: ${message}`), absent, null))).toBe(`teamrig-pane: $.fs.stat: ${message}`)
    expect(await failureOf(unlessMissing(refused('EIO: i/o error'), async () => true, null))).toBe('EIO: i/o error')
  })

  test('re-reads a file only when its stamp moves', async () => {
    const files = new MemoryFiles()
    files.write(PATHS.events, createLine('T1', { owner: 'po', by: 'po', at: NOW }))
    files.write(PATHS.marks, markLine('po', 2, S1, NOW, 'b'))
    files.write(`${PATHS.inboxDir}/po.md`, 'a\nb\n\nc\n')
    const source = new TaskRegisterSource(files, PATHS, TEAM_SETTINGS, null)

    const first = await source.poll({ claudeSession: S1, pinned: null, now: NOW })
    expect(first?.area).toBe('po')
    expect(first?.areaSource).toBe('inbox-read')
    expect(first?.unreadInbox).toBe(1)
    expect(files.reads.length).toBe(3)

    expect(await source.poll({ claudeSession: S1, pinned: null, now: NOW })).toBe(null)
    expect(files.reads.length).toBe(3)

    files.write(PATHS.events, [createLine('T1', { owner: 'po', by: 'po', at: NOW }), statusLine('T1', 'po', NOW, 'done')].join('\n'))
    const next = await source.poll({ claudeSession: S1, pinned: null, now: NOW })
    expect(next?.tasks[0]?.status).toBe('done')
    expect(files.reads.length).toBe(4)
  })

  test('counts unread inbox lines as teamrig does: past the last line read, found by its hash after a trim, all after a rewrite', async () => {
    const files = new MemoryFiles()
    const inbox = `${PATHS.inboxDir}/po.md`
    files.write(inbox, 'one\ntwo\nthree\n')
    files.write(PATHS.marks, markLine('po', 2, S1, NOW, 'two'))
    const source = new TaskRegisterSource(files, PATHS, TEAM_SETTINGS, null)
    const unread = async () => (await source.poll({ claudeSession: S1, pinned: null, now: NOW, force: true }))?.unreadInbox
    expect(await unread()).toBe(1)
    // Appended: the lines past the mark.
    files.write(inbox, 'one\ntwo\nthree\nfour\n')
    expect(await unread()).toBe(2)
    // Trimmed from the top: the last line read moved up, and only what follows it is unread.
    files.write(inbox, 'two\nthree\nfour\n')
    expect(await unread()).toBe(2)
    // Rewritten: the last line read is gone, so every line is unread.
    files.write(inbox, 'new one\nnew two\n')
    expect(await unread()).toBe(2)
    files.write(PATHS.marks, [markLine('po', 2, S1, NOW, 'two'), markLine('po', 2, S1, NOW + 1, 'new two')].join('\n'))
    expect(await unread()).toBe(0)
    // A mark that knows only a count (teamrig before line hashes) trusts it unless the inbox shrank below it.
    files.write(PATHS.marks, markLine('po', 1, S1, NOW))
    expect(await unread()).toBe(1)
  })

  test('a snapshot holds only the tasks a drawing can show: active, or finished within HELD_DAYS of now', async () => {
    const files = new MemoryFiles()
    files.write(PATHS.events, [
      createLine('T1', { owner: 'po', by: 'po', at: NOW - 3 * DAY }),
      createLine('T2', { owner: 'po', by: 'po', at: NOW - 3 * DAY }),
      statusLine('T2', 'po', NOW - 2 * DAY, 'done'),
      createLine('T3', { owner: 'po', by: 'po', at: NOW - 3 * DAY }),
      statusLine('T3', 'po', NOW - HOUR, 'dropped'),
      createLine('T4', { owner: 'etl', by: 'po', at: NOW - 3 * DAY }),
      statusLine('T4', 'etl', NOW - 2 * DAY, 'waiting', 'waits on T1'),
      createLine('T5', { owner: 'po', by: 'po', at: NOW - 3 * DAY }),
      createLine('T6', { owner: 'po', by: 'po', at: NOW - 3 * DAY }),
      statusLine('T6', 'po', Date.UTC(2026, 9, 13) - 60_000, 'done'),
      createLine('T7', { owner: 'po', by: 'po', at: NOW - 10 * DAY }),
      statusLine('T7', 'po', NOW - HELD_DAYS * DAY - 60_000, 'done'),
    ].join('\n'))
    const snap = await new TaskRegisterSource(files, PATHS, TEAM_SETTINGS, null).poll({ claudeSession: S1, pinned: 'po', now: NOW })
    // T2 and T6 finished days ago, within HELD_DAYS: the Archive page and search show them. T7 finished a minute before.
    expect(snap?.tasks.map(task => task.id)).toEqual(['T1', 'T2', 'T3', 'T4', 'T5', 'T6'])

    const big = new MemoryFiles()
    big.write(PATHS.events, bigRegister(20_000).join('\n'))
    const all = await new TaskRegisterSource(big, PATHS, TEAM_SETTINGS, null).poll({ claudeSession: S1, pinned: 'po', now: NOW })
    // po's 408 and the last task, its done line past the 20,000th; none of the 3,673 finished a month ago.
    expect(all?.tasks.length).toBe(409)
    expect(all?.problem).toBe(null)
  })

  test('lines teamrig skips show as the problem with its counts, and a read that skips none clears it', async () => {
    const files = new MemoryFiles()
    const good = createLine('T1', { owner: 'po', by: 'lead', at: NOW })
    files.write(PATHS.events, [good, '{"v":2', createLine('T2', { owner: 'po', by: 'lead', at: NOW, lineKeys: { v: 3 } }), statusLine('T9', 'po', NOW, 'done')].join('\n'))
    const source = new TaskRegisterSource(files, PATHS, TEAM_SETTINGS, null)
    const first = await source.poll({ claudeSession: S1, pinned: 'po', now: NOW })
    expect(first?.tasks.map(task => task.id)).toEqual(['T1'])
    expect(first?.problem).toBe('events.jsonl: 1 unreadable line(s), 1 line(s) from a newer teamrig, 1 event(s) naming no task')
    files.write(PATHS.events, good)
    expect((await source.poll({ claudeSession: S1, pinned: 'po', now: NOW }))?.problem).toBe(null)
  })

  test('a pin wins over the inbox read, and missing files read as an empty register with no unread count', async () => {
    const source = new TaskRegisterSource(new MemoryFiles(), PATHS, TEAM_SETTINGS, null)
    const snap = await source.poll({ claudeSession: S1, pinned: 'etl', now: NOW })
    expect(snap).toEqual({ tasks: [], area: 'etl', areaSource: 'pinned', unreadInbox: null, problem: null, ...NO_TEAM, ...TEAM_SETTINGS, now: NOW })
  })

  test("each snapshot carries the team config's settings the source was made with: its NOT PICKED UP hours and zone", async () => {
    const settings = { notPickedUpAfterHours: 48, timeZone: 'Asia/Jerusalem' }
    const source = new TaskRegisterSource(new MemoryFiles(), PATHS, settings, null)
    const settingsOf = (snap: Snapshot | null) => (snap === null ? null : { notPickedUpAfterHours: snap.notPickedUpAfterHours, timeZone: snap.timeZone })
    expect(settingsOf(await source.poll({ claudeSession: S1, pinned: 'etl', now: NOW }))).toEqual(settings)
    expect(settingsOf(await source.poll({ claudeSession: S1, pinned: 'etl', now: NOW + HOUR, force: true }))).toEqual(settings)
  })

  /** Team web, whose config calls api web-backend and gives ui the team's default name. */
  const WEB: TeamFiles = { team: 'web', dir: 'K/teams/web', config: 'K/teams/web/config.json', renames: 'R/tasks/renames.jsonl', turnLog: null }
  const WEB_TEAM = { sessions: ['lead', 'api', 'ui'], roles: { lead: 'lead' }, names: { api: 'web-backend' } }
  const WEB_CONFIG = JSON.stringify(WEB_TEAM)
  const namesOf = (snap: Snapshot | null) => (snap === null ? null : { team: snap.team, areaName: snap.areaName })

  test("names the area as teamrig's commands do, from the team's config and rename log, a rename on the next poll", async () => {
    const files = new MemoryFiles()
    files.write(WEB.config, WEB_CONFIG)
    const source = new TaskRegisterSource(files, PATHS, TEAM_SETTINGS, WEB)
    expect(namesOf(await source.poll({ claudeSession: S1, pinned: 'api', now: NOW }))).toEqual({ team: 'web', areaName: 'web-backend' })
    expect(await source.poll({ claudeSession: S1, pinned: 'api', now: NOW })).toBe(null)

    files.write(WEB.renames, `${JSON.stringify({ v: 1, id: 'api', from: 'web-backend', to: 'web-api', at: iso(NOW), by: 'api' })}\n`)
    expect(namesOf(await source.poll({ claudeSession: S1, pinned: 'api', now: NOW }))).toEqual({ team: 'web', areaName: 'web-api' })
    expect(namesOf(await source.poll({ claudeSession: S1, pinned: 'ui', now: NOW }))).toEqual({ team: 'web', areaName: 'web-ui' })
    // An area the config does not list is not on the team, so it has no name there.
    expect(namesOf(await source.poll({ claudeSession: S1, pinned: 'ops', now: NOW }))).toEqual({ team: 'web', areaName: null })
  })

  test('a team with no config file names no session, and with no team found neither the team nor a name shows', async () => {
    const noConfig = new TaskRegisterSource(new MemoryFiles(), PATHS, TEAM_SETTINGS, WEB)
    expect(namesOf(await noConfig.poll({ claudeSession: S1, pinned: 'api', now: NOW }))).toEqual({ team: 'web', areaName: null })
    const noTeam = new TaskRegisterSource(new MemoryFiles(), PATHS, TEAM_SETTINGS, null)
    expect(namesOf(await noTeam.poll({ claudeSession: S1, pinned: 'api', now: NOW }))).toEqual({ team: null, areaName: null })
  })

  test("carries who leads whom from the team's config, a promotion on the next poll, and none with no config file", async () => {
    const files = new MemoryFiles()
    files.write(WEB.config, WEB_CONFIG)
    const source = new TaskRegisterSource(files, PATHS, TEAM_SETTINGS, WEB)
    const leadsOf = async () => (await source.poll({ claudeSession: S1, pinned: 'api', now: NOW }))?.leads
    expect(await leadsOf()).toEqual({ lead: 'lead', leaderOf: { api: 'lead', ui: 'lead' } })

    files.write(WEB.config, JSON.stringify({ ...WEB_TEAM, leads: { api: ['ui'] } }))
    expect(await leadsOf()).toEqual({ lead: 'lead', leaderOf: { api: 'lead', ui: 'api' } })

    const noConfig = new TaskRegisterSource(new MemoryFiles(), PATHS, TEAM_SETTINGS, WEB)
    expect((await noConfig.poll({ claudeSession: S1, pinned: 'api', now: NOW }))?.leads).toBe(null)
  })

  test("carries each session's work on its own tasks over the turn log's kept hours, and none with no turn log", async () => {
    const files = new MemoryFiles()
    files.write(PATHS.events, [
      createLine('T1', { owner: 'api', by: 'lead', at: NOW - 30 * HOUR }),
      statusLine('T1', 'api', NOW - 25 * HOUR, 'in-progress'),
      statusLine('T1', 'api', NOW - 2 * HOUR, 'waiting'),
      statusLine('T1', 'lead', NOW - HOUR, 'in-progress'),
    ].join('\n'))
    const logged: TeamFiles = { ...WEB, turnLog: { dir: 'K/teams/web/state/turn-log', keepHours: 24 } }
    const source = new TaskRegisterSource(files, PATHS, TEAM_SETTINGS, logged)
    expect((await source.poll({ claudeSession: S1, pinned: 'api', now: NOW }))?.work).toEqual([{ session: 'api', task: 'T1', at: NOW - 2 * HOUR }])

    const unlogged = new TaskRegisterSource(files, PATHS, TEAM_SETTINGS, WEB)
    expect((await unlogged.poll({ claudeSession: S1, pinned: 'api', now: NOW }))?.work).toEqual([])
  })
})


/** Ports over a MemoryFiles register, recording what the class publishes and pins; `clock.now` moves its time. */
function livePorts(files: MemoryFiles, ids: string[]) {
  let current: Snapshot = { tasks: [], area: null, areaSource: null, unreadInbox: null, problem: null, ...NO_TEAM, ...TEAM_SETTINGS, now: 0 }
  let writes = 0
  const clock = { now: NOW }
  const pins = new Map<string, string>()
  const ports: LivePorts = {
    source: new TaskRegisterSource(files, PATHS, TEAM_SETTINGS, null),
    sessionId: async () => ids[0] ?? 'none',
    now: async () => clock.now,
    publish: async change => {
      writes++
      current = change(current)
    },
    loadPin: async id => pins.get(id),
    savePin: async (id, area) => {
      if (area === null) pins.delete(id)
      else pins.set(id, area)
    },
  }
  return { ports, pins, clock, snapshot: () => current, writes: () => writes }
}

describe('live', () => {
  test('shows a failed read and recovers on the next poll though no file moved', async () => {
    const files = new MemoryFiles()
    files.write(PATHS.events, createLine('T1', { owner: 'po', by: 'po', at: NOW }))
    files.failNextRead = 'EBUSY: events.jsonl'
    const { ports, snapshot } = livePorts(files, [S1])
    const live = new LiveRegister(ports)

    await live.refresh()
    expect(snapshot().problem).toBe('EBUSY: events.jsonl')
    await live.refresh()
    expect(snapshot().problem).toBe(null)
    expect(snapshot().tasks.length).toBe(1)
  })

  test('a file over the 4 MiB one read allows is named with its size and never read; the last good tasks stay until it shrinks', async () => {
    const files = new MemoryFiles()
    const first = createLine('T1', { owner: 'po', by: 'po', at: NOW })
    files.write(PATHS.events, first)
    const { ports, snapshot, writes } = livePorts(files, [S1])
    const live = new LiveRegister(ports)
    await live.refresh()
    expect(snapshot().tasks.length).toBe(1)

    files.write(PATHS.events, [first, ' '.repeat(5 * 2 ** 20)].join('\n'))
    expect(5 * 2 ** 20).toBeGreaterThan(MAX_READ_BYTES)
    const reads = files.reads.length
    await live.refresh()
    const shown = writes()
    await live.refresh()
    expect(snapshot().problem).toBe('events.jsonl is 5.00 MiB, over the 4 MiB a pane can read at once: it needs rotating')
    expect(snapshot().tasks.length).toBe(1)
    expect(files.reads.length).toBe(reads)
    expect(writes()).toBe(shown)

    files.write(PATHS.events, [first, createLine('T2', { owner: 'po', by: 'po', at: NOW })].join('\n'))
    await live.refresh()
    expect(snapshot().problem).toBe(null)
    expect(snapshot().tasks.length).toBe(2)
  })

  test('says what to set when nothing names where the register is', async () => {
    const { ports, snapshot } = livePorts(new MemoryFiles(), [S1])
    await new LiveRegister({ ...ports, source: { missing: 'no register: set its folders' } }).refresh()
    expect(snapshot().problem).toBe('no register: set its folders')
  })

  test('a pin is saved under the session and follows a /clear to the new session id', async () => {
    const ids = [S1]
    const { ports, pins, snapshot } = livePorts(new MemoryFiles(), ids)
    const live = new LiveRegister(ports)
    await live.pin('etl')
    expect(pins.get(S1)).toBe('etl')
    expect(snapshot().area).toBe('etl')

    ids[0] = S2
    await live.refresh()
    expect(snapshot().area).toBe(null)

    await live.pin(null)
    expect(pins.size).toBe(1)
  })

  test('writes only what changes the drawing: not a file move, nor a tick that moves no label', async () => {
    const files = new MemoryFiles()
    files.write(PATHS.events, createLine('T1', { owner: 'po', by: 'lead', at: NOW, due: '2026-10-13 15:00' }))
    const { ports, clock, snapshot, writes } = livePorts(files, [S1])
    const live = new LiveRegister(ports)
    await live.pin('po')
    expect(writes()).toBe(1)

    files.write(PATHS.marks, markLine('etl', 0, S2, NOW))
    await live.refresh()
    clock.now = NOW + HOUR / 2
    await live.tick()
    expect(writes()).toBe(1)

    clock.now = NOW + 2 * HOUR
    await live.tick()
    expect(writes()).toBe(2)
    expect(snapshot().now).toBe(NOW + 2 * HOUR)
  })

  test('a tick whose clock read fails shows the problem, and the next poll draws the tasks again', async () => {
    const files = new MemoryFiles()
    files.write(PATHS.events, createLine('T1', { owner: 'po', by: 'po', at: NOW }))
    const { ports, snapshot } = livePorts(files, [S1])
    let isClockDown = false
    const live = new LiveRegister({
      ...ports,
      now: async () => {
        if (isClockDown) throw new Error('clock unavailable')
        return NOW
      },
    })
    await live.pin('po')

    isClockDown = true
    await live.tick()
    expect(snapshot().problem).toBe('clock unavailable')
    expect(snapshot().tasks.length).toBe(1)

    isClockDown = false
    await live.refresh()
    expect(snapshot().problem).toBe(null)
  })

  test('a write that fails never rejects a poll or a tick, and the next poll writes again', async () => {
    const files = new MemoryFiles()
    files.write(PATHS.events, createLine('T1', { owner: 'po', by: 'po', at: NOW }))
    const { ports, snapshot, clock } = livePorts(files, [S1])
    let failures = 0
    let isStoreDown = true
    const live = new LiveRegister({
      ...ports,
      publish: async change => {
        if (!isStoreDown) return ports.publish(change)
        failures++
        throw new Error('state store unavailable')
      },
    })

    await live.refresh()
    clock.now = NOW + 2 * HOUR
    await live.tick()
    expect(failures).toBe(4)
    expect(snapshot().tasks.length).toBe(0)

    isStoreDown = false
    await live.refresh()
    expect(snapshot().tasks.length).toBe(1)
    expect(snapshot().problem).toBe(null)
  })

  test('starts the poll and the tick, and stop cancels both', async () => {
    const { ports } = livePorts(new MemoryFiles(), [S1])
    const started: number[] = []
    let cancelled = 0
    const live = new LiveRegister(ports)
    live.startTimers((ms): Timer => {
      started.push(ms)
      return { cancel: () => void cancelled++ }
    })
    expect(started).toEqual([3_000, 60_000])
    live.stop()
    expect(cancelled).toBe(2)
  })

  test('the poll reads the session and the register; the tick reads the clock', async () => {
    const { ports } = livePorts(new MemoryFiles(), [S1])
    const asked: string[] = []
    const fired: (() => void)[] = []
    // Each timer asks its first port before its first await, so what it asked shows at once.
    const live = new LiveRegister({
      ...ports,
      sessionId: async () => {
        asked.push('session')
        return S1
      },
      now: async () => {
        asked.push('now')
        return NOW
      },
    })
    live.startTimers((_ms, fn): Timer => {
      fired.push(fn)
      return { cancel: () => undefined }
    })
    const [poll, tick] = fired
    poll?.()
    expect(asked).toEqual(['session'])
    tick?.()
    expect(asked).toEqual(['session', 'now'])
  })

  test('keeps a session’s pin under a store key of its own', () => {
    expect(pinKey(S1)).toBe(`pin:${S1}`)
    expect(pinKey(S2)).not.toBe(pinKey(S1))
  })
})
