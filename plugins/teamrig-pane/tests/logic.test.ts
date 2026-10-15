import { describe, expect, test } from 'claude-code/testing'
import type { Snapshot, TaskRow, TaskStatus } from '../types'
import { COMMAND, inlineReason, parsePaneArgs, USAGE } from '../hooks/command'
import { LiveRegister, pinKey, type LivePorts, type Timer } from '../hooks/live'
import { indexMarks, readMarks, readRegister, TASK_STATUSES, type PriorityConfig } from '../hooks/core/read/index'
import { rowOf, STATUS_CONTRACT_MATCHES } from '../hooks/log'
import { dockLayout, failedDrawing, inlineLayout, merged, wrapRow, type Drawn } from '../hooks/layout'
import { GLYPH, GLYPH_COLOR, paneBlocks, type Block, type Row } from '../hooks/rows'
import { cells, graphemes } from '../hooks/width'
import { MAX_READ_BYTES, TaskRegisterSource, registerPaths, skippedText, unlessMissing, type RegisterPaths } from '../hooks/source'
import { areaView, flagsOf, ownerGroups, sameView } from '../hooks/view'
import { HOUR, MemoryFiles, NOW, S1, S2, S3, bigRegister, createLine, iso, markLine, statusLine, updateLine } from './fixtures'

const DAY = 24 * HOUR

const PATHS: RegisterPaths = { events: 'R/tasks/events.jsonl', marks: 'R/tasks/inbox-marks.jsonl', inboxDir: 'R/inbox' }

/** A team config's priority names, as `register.priorities` lists them: it names some levels, not all. */
const PRIORITIES: readonly PriorityConfig[] = [
  { id: 2, name: 'correctness' },
  { id: 7, name: 'polish' },
]

/** The rows the pane draws from event lines, read by teamrig's reader, in the order the tasks were created. */
function rowsOf(lines: readonly string[], priorities: readonly PriorityConfig[] = []): TaskRow[] {
  return [...readRegister(lines.join('\n')).state.tasks.values()].map(task => rowOf(task, priorities))
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

  test('names each priority as the team config does; a level it does not name, or no config, leaves the number bare', async () => {
    const lines = [
      createLine('T1', { owner: 'po', by: 'po', at: NOW, priority: 2 }),
      createLine('T2', { owner: 'po', by: 'po', at: NOW, priority: 7 }),
      createLine('T3', { owner: 'po', by: 'po', at: NOW, priority: 4 }),
    ]
    expect(rowsOf(lines, PRIORITIES).map(task => [task.priority, task.priorityName])).toEqual([
      [2, 'correctness'],
      [7, 'polish'],
      [4, null],
    ])
    expect(rowsOf(lines).map(task => task.priorityName)).toEqual([null, null, null])
  })

  test('a task with no ref and no week, a priority-only update and a blocked status read as teamrig writes them', async () => {
    const [task] = fold(
      createLine('T1', { owner: 'po', by: 'lead', at: NOW, ref: null, week: null }),
      updateLine('T1', 'lead', NOW + HOUR, { priority: 1 }),
      statusLine('T1', 'po', NOW + 2 * HOUR, 'blocked', 'waits on the owner'),
    )
    expect(task?.ref).toBe(null)
    expect(task?.week).toBe(null)
    expect(task?.priority).toBe(1)
    expect(task?.status).toBe('blocked')
    expect(task?.note).toBe('waits on the owner')
  })

  test('the statuses the plugin contract spells out are teamrig\'s, and each draws a glyph', async () => {
    expect(STATUS_CONTRACT_MATCHES).toBe(true)
    const statuses: readonly TaskStatus[] = TASK_STATUSES
    expect(Object.keys(GLYPH).sort()).toEqual([...statuses].sort())
  })

  test('each status glyph is a one-cell text symbol, never an emoji, and waiting for proof is the green half of working', async () => {
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
  test('lists the area in plan order: priority, then due (undated last), then id', async () => {
    const tasks = fold(
      createLine('T1', { owner: 'po', by: 'po', at: NOW, priority: 3 }),
      createLine('T2', { owner: 'po', by: 'po', at: NOW, priority: 1 }),
      createLine('T3', { owner: 'po', by: 'po', at: NOW, priority: 3, due: '2026-10-14' }),
      createLine('T4', { owner: 'po', by: 'po', at: NOW, priority: 3, due: '2026-10-14 09:00' }),
      createLine('T5', { owner: 'etl', by: 'po', at: NOW }),
    )
    const view = areaView(tasks, 'po', NOW)
    expect(view.active.map(l => l.task.id)).toEqual(['T2', 'T4', 'T3', 'T1'])
    expect(view.asked.map(l => l.task.id)).toEqual(['T5'])
  })

  test('keeps finished tasks for a day only', async () => {
    const tasks = fold(
      createLine('T1', { owner: 'po', by: 'po', at: NOW - 48 * HOUR }),
      statusLine('T1', 'po', NOW - 2 * HOUR, 'done'),
      createLine('T2', { owner: 'po', by: 'po', at: NOW - 48 * HOUR }),
      statusLine('T2', 'po', NOW - 30 * HOUR, 'dropped'),
    )
    expect(areaView(tasks, 'po', NOW).finished.map(t => t.id)).toEqual(['T1'])
  })

  test('a date-only due is due at the end of that UTC day', async () => {
    const [task] = fold(createLine('T1', { owner: 'po', by: 'po', at: NOW, due: '2026-10-13' }))
    if (!task) throw new Error('no task')
    expect(flagsOf(task, NOW)).toEqual([])
    expect(flagsOf(task, Date.UTC(2026, 9, 13, 23, 59))).toEqual([])
    expect(flagsOf(task, Date.UTC(2026, 9, 14, 0, 1))).toEqual(['overdue'])
  })

  test('an untouched task reads NEW, then NOT PICKED UP after a day', async () => {
    const [task] = fold(createLine('T1', { owner: 'po', by: 'lead', at: NOW }))
    if (!task) throw new Error('no task')
    expect(flagsOf(task, NOW + HOUR)).toEqual(['new'])
    expect(flagsOf(task, NOW + 25 * HOUR)).toEqual(['unseen'])
  })

  test('two snapshots draw the same pane unless a field, a task or a time label differs', async () => {
    const tasks = fold(createLine('T1', { owner: 'po', by: 'lead', at: NOW, due: '2026-10-13 15:00' }))
    const base: Snapshot = { tasks, area: 'po', areaSource: 'pinned', unreadInbox: 0, problem: null, now: NOW }
    expect(sameView(base, { ...base, tasks: fold(createLine('T1', { owner: 'po', by: 'lead', at: NOW, due: '2026-10-13 15:00' })) })).toBe(true)
    expect(sameView(base, { ...base, now: NOW + HOUR / 2 })).toBe(true)
    expect(sameView(base, { ...base, now: NOW + 2 * HOUR })).toBe(false)
    expect(sameView(base, { ...base, unreadInbox: 1 })).toBe(false)
    const regoaled = fold(createLine('T1', { owner: 'po', by: 'lead', at: NOW, due: '2026-10-13 15:00', goals: ['G11'] }))
    expect(sameView(base, { ...base, tasks: regoaled })).toBe(false)
    expect(sameView(base, { ...base, tasks: fold(createLine('T1', { owner: 'po', by: 'lead', at: NOW, title: 'Renamed' })) })).toBe(false)
    const named = rowsOf([createLine('T1', { owner: 'po', by: 'lead', at: NOW, due: '2026-10-13 15:00', priority: 7 })], PRIORITIES)
    const bare = rowsOf([createLine('T1', { owner: 'po', by: 'lead', at: NOW, due: '2026-10-13 15:00', priority: 7 })])
    expect(sameView({ ...base, tasks: bare }, { ...base, tasks: named })).toBe(false)
    const started = fold(createLine('T1', { owner: 'po', by: 'lead', at: NOW, due: '2026-10-13 15:00' }), statusLine('T1', 'po', NOW, 'open', null, null, 'none'))
    expect(sameView(base, { ...base, tasks: started })).toBe(false)
  })

  test('groups every owner with active tasks and counts the blocked ones', async () => {
    const tasks = fold(
      createLine('T1', { owner: 'security', by: 'lead', at: NOW }),
      statusLine('T1', 'security', NOW, 'blocked', 'needs owner'),
      createLine('T2', { owner: 'etl', by: 'lead', at: NOW }),
      createLine('T3', { owner: 'etl', by: 'etl', at: NOW }),
      statusLine('T3', 'etl', NOW, 'done'),
    )
    expect(ownerGroups(tasks, NOW).map(g => [g.owner, g.active.length, g.blocked])).toEqual([
      ['etl', 1, 0],
      ['security', 1, 1],
    ])
  })

  test('keeps the tasks waiting for proof apart, in plan order, and leads each owner group with them', async () => {
    const tasks = fold(
      createLine('T1', { owner: 'po', by: 'po', at: NOW - HOUR, priority: 1 }),
      createLine('T2', { owner: 'po', by: 'po', at: NOW - HOUR, priority: 3 }),
      statusLine('T2', 'po', NOW, 'verifying', 'health check passes'),
      createLine('T3', { owner: 'po', by: 'po', at: NOW - HOUR, priority: 2 }),
      statusLine('T3', 'po', NOW, 'verifying', 'one clean roll'),
    )
    const view = areaView(tasks, 'po', NOW)
    expect(view.verifying.map(l => l.task.id)).toEqual(['T3', 'T2'])
    expect(view.active.map(l => l.task.id)).toEqual(['T1'])
    const [group] = ownerGroups(tasks, NOW)
    expect(group?.active.map(l => l.task.id)).toEqual(['T3', 'T2', 'T1'])
    expect([group?.blocked, group?.verifying]).toEqual([0, 2])
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
  const snapshotOf = (tasks: TaskRow[], area: string | null): Snapshot => ({
    tasks,
    area,
    areaSource: 'inbox-read',
    unreadInbox: 2,
    problem: null,
    now: NOW,
  })

  test('a task is one block to press, its title wrapping under its id, a blocked one with its note, finished ones dim', async () => {
    const tasks = fold(
      createLine('T1', { owner: 'po', by: 'lead', at: NOW - HOUR, priority: 2, due: '2026-10-14', title: 'Ship it' }),
      createLine('T2', { owner: 'po', by: 'po', at: NOW - HOUR }),
      statusLine('T2', 'po', NOW, 'blocked', 'needs owner'),
      createLine('T3', { owner: 'po', by: 'po', at: NOW - HOUR, title: 'Old work' }),
      statusLine('T3', 'po', NOW, 'done'),
    )
    const blocks = paneBlocks(snapshotOf(tasks, 'po'), 'mine')
    expect(blocks.map(b => b.key)).toEqual(['header', 'active:T1', 'active:T2', 'finished', 'finished:T3'])
    expect(textAt(blocks, 'header')).toBe('po · 2 active · inbox 2 unread')
    expect(rowAt(blocks, 'header')?.rule).toBe(true)
    expect(textAt(blocks, 'active:T1')).toBe('▸ ○ T1 p2 10-14 NEW Ship it')
    expect(rowAt(blocks, 'active:T1')?.hang).toEqual({ text: '    ' })
    expect(blockAt(blocks, 'active:T1')?.toggle).toBe('T1')
    expect(blockAt(blocks, 'active:T2')?.rows.map(r => r.key)).toEqual(['active:T2', 'active-note:T2'])
    expect(textAt(blocks, 'active-note:T2')).toBe('    ↳ needs owner')
    expect(textAt(blocks, 'finished')).toBe('── finished today')
    expect(blockAt(blocks, 'finished')?.opensSection).toBe(true)
    expect(rowAt(blocks, 'finished:T3')?.spans).toEqual([{ text: '▸ ✓ T3 Old work', dim: true }])
    expect(blockAt(blocks, 'finished:T3')?.toggle).toBe('T3')
  })

  test('the tasks an area asked of others follow its own, newest first, each naming its owner', async () => {
    const tasks = fold(
      createLine('T1', { owner: 'po', by: 'po', at: NOW - HOUR, title: 'Mine' }),
      createLine('T2', { owner: 'etl', by: 'po', at: NOW - 2 * HOUR, title: 'Older ask' }),
      createLine('T3', { owner: 'web', by: 'po', at: NOW - HOUR, title: 'Newer ask' }),
    )
    const blocks = paneBlocks(snapshotOf(tasks, 'po'), 'mine')
    expect(blocks.map(b => b.key)).toEqual(['header', 'active:T1', 'asked', 'asked:T3', 'asked:T2'])
    expect(textAt(blocks, 'asked')).toBe('── asked of others (2)')
    expect(rowAt(blocks, 'asked:T3')?.spans[2]).toEqual({ text: ' →web', color: 'suggestion' })
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

  test('an in-progress task draws ◐ and a blocked one ■, a blocked one with nothing to say drawing no note; both count active', async () => {
    const tasks = fold(
      createLine('T1', { owner: 'po', by: 'po', at: NOW - HOUR, title: 'First' }),
      statusLine('T1', 'po', NOW, 'in-progress'),
      createLine('T2', { owner: 'po', by: 'po', at: NOW - HOUR, title: 'Second' }),
      statusLine('T2', 'po', NOW, 'blocked'),
    )
    const blocks = paneBlocks(snapshotOf(tasks, 'po'), 'mine')
    expect(textAt(blocks, 'active:T1')).toBe('▸ ◐ T1 p3 First')
    expect(textAt(blocks, 'active:T2')).toBe('▸ ■ T2 p3 Second')
    expect(blockAt(blocks, 'active:T2')?.rows.map(r => r.key)).toEqual(['active:T2'])
    expect(textAt(blocks, 'header')).toBe('po · 2 active · inbox 2 unread')
  })

  test('an expanded task shows its quoted ask, who asked, its status note and the files nothing was quoted from, on a guide', async () => {
    const ref = '~/team-notes/board/inbox/po.md:4; docs/x.md:9'
    const tasks = fold(
      createLine('T1', { owner: 'po', by: 'lead', at: NOW - HOUR, source: 'owner', ref, goals: ['G10.2', 'G15'], title: 'Ship it' }),
      statusLine('T1', 'po', NOW, 'blocked', 'needs owner', 'abc123'),
      createLine('T2', { owner: 'po', by: 'po', at: NOW - HOUR, source: 'po', ref: 'quote' }),
    )
    const quotes = [{ ref: '~/team-notes/board/inbox/po.md:4', lines: ['2026-10-13 lead: ship the pane'] }]
    const blocks = paneBlocks(snapshotOf(tasks, 'po'), 'mine', { T1: { ref, quotes }, T2: { ref: 'quote', quotes: [] } })
    expect(blocks.map(b => b.key)).toEqual(['header', 'active:T1', 'active:T2'])
    expect(blockAt(blocks, 'active:T1')?.rows.map(r => r.key)).toEqual([
      'active:T1',
      'active-detail:T1:gap:0',
      'active-detail:T1:quote:0:0',
      'active-detail:T1:gap:facts',
      'active-detail:T1:asked',
      'active-detail:T1:note',
      'active-detail:T1:see',
    ])
    expect(blockAt(blocks, 'active:T2')?.rows.map(r => r.key)).toEqual([
      'active:T2',
      'active-detail:T2:gap:facts',
      'active-detail:T2:asked',
      'active-detail:T2:see',
    ])
    expect(textAt(blocks, 'active:T1')).toMatch(/^▾ ■ T1 /)
    expect(textAt(blocks, 'active-detail:T1:gap:0')).toBe('    │ ')
    expect(textAt(blocks, 'active-detail:T1:quote:0:0')).toBe('    │ 2026-10-13 lead: ship the pane')
    expect(textAt(blocks, 'active-detail:T1:asked')).toBe('    │ asked by owner · added by lead · 10-13 13:00 · p3 · week 10-13 · G10.2 · G15')
    expect(textAt(blocks, 'active-detail:T1:note')).toBe('    │ blocked: needs owner · evidence abc123')
    expect(textAt(blocks, 'active-detail:T1:see')).toBe('    │ see docs/x.md')
    expect(textAt(blocks, 'active-detail:T2:see')).toBe('    │ see quote')
    expect(textAt(blocks, 'active-detail:T2:asked')).toBe('    │ asked by po · 10-13 13:00 · p3 · week 10-13 · G10.2')
    const details = blocks.flatMap(b => b.rows).filter(r => r.key.includes('-detail:'))
    expect(details.every(r => r.hang?.text === '    │ ' && r.spans[0]?.text === '    │ ')).toBe(true)
  })

  test('an expanded task names its priority as the team config does, each fact only when set; the row keeps the bare number', async () => {
    const tasks = rowsOf(
      [
        createLine('T1', { owner: 'po', by: 'lead', at: NOW - HOUR, priority: 2, ref: null, week: null, goals: [], title: 'Bare' }),
        createLine('T2', { owner: 'po', by: 'lead', at: NOW - HOUR, priority: 7, title: 'Named' }),
        statusLine('T2', 'po', NOW, 'in-progress', 'halfway'),
      ],
      PRIORITIES,
    )
    const blocks = paneBlocks(snapshotOf(tasks, 'po'), 'mine', { T1: { ref: null, quotes: [] }, T2: { ref: 'docs/x.md', quotes: [] } })
    expect(blockAt(blocks, 'active:T1')?.rows.map(r => r.key)).toEqual(['active:T1', 'active-detail:T1:gap:facts', 'active-detail:T1:asked'])
    expect(textAt(blocks, 'active-detail:T1:asked')).toBe('    │ asked by owner · added by lead · 10-13 13:00 · p2 correctness')
    expect(blockAt(blocks, 'active:T2')?.rows.map(r => r.key)).toEqual([
      'active:T2',
      'active-detail:T2:gap:facts',
      'active-detail:T2:asked',
      'active-detail:T2:note',
      'active-detail:T2:see',
    ])
    expect(textAt(blocks, 'active-detail:T2:asked')).toBe('    │ asked by owner · added by lead · 10-13 13:00 · p7 polish · week 10-13 · G10.2')
    expect(textAt(blocks, 'active-detail:T2:note')).toBe('    │ in-progress: halfway')
    const collapsed = paneBlocks(snapshotOf(tasks, 'po'), 'mine', {})
    expect(textAt(collapsed, 'active:T1')).toBe('▸ ○ T1 p2 NEW Bare')
    expect(textAt(collapsed, 'active:T2')).toBe('▸ ◐ T2 p7 Named')
    expect(collapsed.flatMap(b => b.rows).filter(r => r.key.includes('-detail:'))).toEqual([])
  })

  test('quotes read for an older ref are not shown once the ref changes', async () => {
    const tasks = fold(
      createLine('T1', { owner: 'po', by: 'po', at: NOW - HOUR, source: 'po', ref: 'old' }),
      updateLine('T1', 'po', NOW, { ref: 'new' }),
    )
    const blocks = paneBlocks(snapshotOf(tasks, 'po'), 'mine', { T1: { ref: 'old', quotes: [{ ref: 'old', lines: ['the old ask'] }] } })
    expect(blocks.flatMap(b => b.rows).some(r => r.spans.some(span => span.text === 'the old ask'))).toBe(false)
    expect(textAt(blocks, 'active-detail:T1:see')).toBe('    │ see new')
  })

  test('the all view heads each owner with a ruled heading and its counts, the session area marked', async () => {
    const tasks = fold(
      createLine('T1', { owner: 'security', by: 'lead', at: NOW }),
      statusLine('T1', 'security', NOW, 'blocked', 'needs owner'),
      createLine('T2', { owner: 'etl', by: 'etl', at: NOW }),
    )
    const blocks = paneBlocks(snapshotOf(tasks, 'etl'), 'all')
    expect(blocks.map(b => b.key)).toEqual(['owner:etl', 'etl:T2', 'owner:security', 'security:T1'])
    expect(blockAt(blocks, 'security:T1')?.rows.map(r => r.key)).toEqual(['security:T1', 'security-note:T1'])
    expect(rowAt(blocks, 'owner:security')?.spans.map(s => s.text)).toEqual(['── ', 'security', ' · 1 active · 1 blocked'])
    expect(rowAt(blocks, 'owner:security')?.rule).toBe(true)
    expect(rowAt(blocks, 'owner:etl')?.spans[1]?.color).toBe('claude')
    expect(blocks.filter(b => b.key.startsWith('owner:')).map(b => b.opensSection)).toEqual([false, true])
  })

  test('work waiting for proof leads under its own heading, each with its due and what proves it; the rest follows under its own', async () => {
    const tasks = fold(
      createLine('T1', { owner: 'po', by: 'po', at: NOW - HOUR, title: 'Working' }),
      statusLine('T1', 'po', NOW, 'in-progress'),
      createLine('T2', { owner: 'po', by: 'po', at: NOW - HOUR, due: '2026-10-16', title: 'Shipped' }),
      statusLine('T2', 'po', NOW, 'verifying', 'health check passes'),
      createLine('T3', { owner: 'po', by: 'po', at: NOW - HOUR, title: 'No proof named' }),
      statusLine('T3', 'po', NOW, 'verifying'),
    )
    const blocks = paneBlocks(snapshotOf(tasks, 'po'), 'mine')
    expect(blocks.map(b => b.key)).toEqual(['header', 'proof', 'proof:T2', 'proof:T3', 'active', 'active:T1'])
    expect(textAt(blocks, 'header')).toBe('po · 3 active · inbox 2 unread')
    expect(textAt(blocks, 'proof')).toBe('── waiting for proof (2)')
    expect(rowAt(blocks, 'proof')?.spans[1]).toEqual({ text: 'waiting for proof (2)', color: 'success' })
    expect(blockAt(blocks, 'proof')?.opensSection).toBe(true)
    expect(textAt(blocks, 'proof:T2')).toBe('▸ ◑ T2 p3 10-16 Shipped')
    expect(rowAt(blocks, 'proof:T2')?.spans[1]).toEqual({ text: '◑ T2', color: 'success', bold: true })
    expect(blockAt(blocks, 'proof:T2')?.toggle).toBe('T2')
    expect(rowAt(blocks, 'proof-note:T2')).toEqual({
      key: 'proof-note:T2',
      spans: [{ text: '    ↳ proof: health check passes', color: 'success', dim: true }],
      hang: { text: '      ' },
    })
    expect(blockAt(blocks, 'proof:T3')?.rows.map(r => r.key)).toEqual(['proof:T3'])
    expect(textAt(blocks, 'active')).toBe('── other active (1)')
  })

  test('with only work waiting for proof there is no second heading; expanded, its proof note is green', async () => {
    const tasks = fold(
      createLine('T1', { owner: 'po', by: 'po', at: NOW - HOUR, title: 'Shipped' }),
      statusLine('T1', 'po', NOW, 'verifying', 'health check passes', 'abc123'),
    )
    const blocks = paneBlocks(snapshotOf(tasks, 'po'), 'mine', { T1: { ref: null, quotes: [] } })
    expect(blocks.map(b => b.key)).toEqual(['header', 'proof', 'proof:T1'])
    expect(rowAt(blocks, 'proof-detail:T1:note')?.spans[1]).toEqual({
      text: 'verifying: health check passes · evidence abc123',
      color: 'success',
      dim: true,
    })
  })

  test('the all view counts each owner\'s work waiting for proof and lists it first, with what proves it', async () => {
    const tasks = fold(
      createLine('T1', { owner: 'etl', by: 'etl', at: NOW, priority: 1 }),
      createLine('T2', { owner: 'etl', by: 'etl', at: NOW, priority: 4 }),
      statusLine('T2', 'etl', NOW, 'verifying', 'one clean night'),
    )
    const blocks = paneBlocks(snapshotOf(tasks, 'po'), 'all')
    expect(blocks.map(b => b.key)).toEqual(['owner:etl', 'etl:T2', 'etl:T1'])
    expect(rowAt(blocks, 'owner:etl')?.spans.map(s => s.text)).toEqual(['── ', 'etl', ' · 2 active · 1 waiting for proof'])
    expect(textAt(blocks, 'etl-note:T2')).toBe('    ↳ proof: one clean night')
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

  test('a wide character with no room left on a line starts the next one', async () => {
    const lines = wrapRow({ key: 'r', spans: [{ text: 'ab ⛔⛔⛔' }] }, 4).map(line => line.map(span => span.text).join(''))
    expect(lines).toEqual(['ab', '⛔⛔', '⛔'])
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
    const source = new TaskRegisterSource(files, PATHS)

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
    const source = new TaskRegisterSource(files, PATHS)
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

  test('a snapshot holds only the tasks a drawing can show: active, or finished within a day', async () => {
    const files = new MemoryFiles()
    files.write(PATHS.events, [
      createLine('T1', { owner: 'po', by: 'po', at: NOW - 3 * DAY }),
      createLine('T2', { owner: 'po', by: 'po', at: NOW - 3 * DAY }),
      statusLine('T2', 'po', NOW - 2 * DAY, 'done'),
      createLine('T3', { owner: 'po', by: 'po', at: NOW - 3 * DAY }),
      statusLine('T3', 'po', NOW - HOUR, 'dropped'),
      createLine('T4', { owner: 'etl', by: 'po', at: NOW - 3 * DAY }),
      statusLine('T4', 'etl', NOW - 2 * DAY, 'blocked', 'waits on T1'),
      createLine('T5', { owner: 'po', by: 'po', at: NOW - 3 * DAY }),
    ].join('\n'))
    const snap = await new TaskRegisterSource(files, PATHS).poll({ claudeSession: S1, pinned: 'po', now: NOW })
    expect(snap?.tasks.map(task => task.id)).toEqual(['T1', 'T3', 'T4', 'T5'])

    const big = new MemoryFiles()
    big.write(PATHS.events, bigRegister(20_000).join('\n'))
    const all = await new TaskRegisterSource(big, PATHS).poll({ claudeSession: S1, pinned: 'po', now: NOW })
    // po's 408 and the last task, its done line past the 20,000th; none of the 3,673 finished a month ago.
    expect(all?.tasks.length).toBe(409)
    expect(all?.problem).toBe(null)
  })

  test('lines teamrig skips show as the problem with its counts, and a read that skips none clears it', async () => {
    const files = new MemoryFiles()
    const good = createLine('T1', { owner: 'po', by: 'lead', at: NOW })
    files.write(PATHS.events, [good, '{"v":2', createLine('T2', { owner: 'po', by: 'lead', at: NOW, lineKeys: { v: 3 } }), statusLine('T9', 'po', NOW, 'done')].join('\n'))
    const source = new TaskRegisterSource(files, PATHS)
    const first = await source.poll({ claudeSession: S1, pinned: 'po', now: NOW })
    expect(first?.tasks.map(task => task.id)).toEqual(['T1'])
    expect(first?.problem).toBe('events.jsonl: 1 unreadable line(s), 1 line(s) from a newer teamrig, 1 event(s) naming no task')
    files.write(PATHS.events, good)
    expect((await source.poll({ claudeSession: S1, pinned: 'po', now: NOW }))?.problem).toBe(null)
  })

  test('names each task\'s priority from the team config it was given', async () => {
    const files = new MemoryFiles()
    files.write(PATHS.events, createLine('T1', { owner: 'po', by: 'po', at: NOW, priority: 2 }))
    const named = await new TaskRegisterSource(files, PATHS, PRIORITIES).poll({ claudeSession: S1, pinned: 'po', now: NOW })
    expect(named?.tasks[0]?.priorityName).toBe('correctness')
    const bare = await new TaskRegisterSource(files, PATHS).poll({ claudeSession: S1, pinned: 'po', now: NOW })
    expect(bare?.tasks[0]?.priorityName).toBe(null)
  })

  test('a pin wins over the inbox read, and missing files read as an empty register with no unread count', async () => {
    const source = new TaskRegisterSource(new MemoryFiles(), PATHS)
    const snap = await source.poll({ claudeSession: S1, pinned: 'etl', now: NOW })
    expect(snap).toEqual({ tasks: [], area: 'etl', areaSource: 'pinned', unreadInbox: null, problem: null, now: NOW })
  })
})


/** Ports over a MemoryFiles register, recording what the class publishes and pins; `clock.now` moves its time. */
function livePorts(files: MemoryFiles, ids: string[]) {
  let current: Snapshot = { tasks: [], area: null, areaSource: null, unreadInbox: null, problem: null, now: 0 }
  let writes = 0
  const clock = { now: NOW }
  const pins = new Map<string, string>()
  const ports: LivePorts = {
    source: new TaskRegisterSource(files, PATHS),
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
