import { describe, expect, test } from 'claude-code/testing'
import type { ShownStatus, Snapshot, TaskRow } from '../types'
import { inlineReason, parseTaskListArgs } from '../hooks/command'
import { LiveRegister, type LivePorts, type Timer } from '../hooks/live'
import { parseEvent } from '../hooks/core/events'
import { STATUSES } from '../hooks/core/model'
import { parseAlias } from '../hooks/core/names'
import { parsePauseRecord } from '../hooks/core/pauses'
import { parseUsageRun, type UsageRun } from '../hooks/core/rates'
import { areaOfSession, CHILDREN_SHOWN, NOTES_SHOWN, parseJsonl, parseMark, readTasks, readTo, unreadLines } from '../hooks/log'
import { dockLayout, failedDrawing, inlineLayout, merged, wrapRow, type Drawn } from '../hooks/layout'
import { GLYPH, paneBlocks, type Block, type Row } from '../hooks/rows'
import { cells, graphemes } from '../hooks/width'
import { MAX_READ_BYTES, TaskRegisterSource, registerPaths, unlessMissing, type RegisterPaths } from '../hooks/source'
import { USAGE_LIST_MS, UsageRuns } from '../hooks/usage'
import { areaView, dueInstant, flagsOf, ownerGroups, sameView } from '../hooks/view'
import {
  HOUR,
  MemoryFiles,
  bigRegister,
  NOW,
  aliasLine,
  createLine,
  linkLine,
  markLine,
  noteLine,
  pauseLine,
  statusLine,
  updateLine,
  usageRunJson,
  waitLine,
} from './fixtures'

const DAY = 24 * HOUR

/** The register as the pane reads it, from event lines and optional rename and pause lines. */
function readLines(events: string[], aliases: string[] = [], pauses: string[] = [], usage: UsageRun | null = null) {
  return readTasks({
    events: parseJsonl(events.join('\n'), parseEvent).records,
    aliases: parseJsonl(aliases.join('\n'), parseAlias).records,
    pauses: parseJsonl(pauses.join('\n'), parsePauseRecord).records,
    usage,
  }, NOW)
}

function fold(...lines: string[]) {
  return readLines(lines)
}

describe('log', () => {
  test('skips torn and unknown lines, counting them, and ignores blank ones', async () => {
    const parsed = parseJsonl(
      [createLine('T1', { owner: 'po', by: 'lead', at: NOW }), '{"type":"create","id":"T2"', '', '{"type":"rename","id":"T1","at":"x","by":"y"}'].join('\n'),
      parseEvent,
    )
    expect(parsed.records.length).toBe(1)
    expect(parsed.skipped).toBe(2)
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

  test('a create whose goals are not all strings is skipped', async () => {
    const line = JSON.stringify({
      type: 'create',
      id: 'T1',
      at: new Date(NOW).toISOString(),
      by: 'po',
      task: { title: 't', owner: 'po', source: 'po', ref: 'r', tier: 2, due: null, goals: [1] },
    })
    expect(parseJsonl(line, parseEvent)).toEqual({ records: [], skipped: 1 })
  })

  test('a repeated create and events for unknown ids change nothing', async () => {
    const tasks = fold(
      createLine('T1', { owner: 'po', by: 'po', at: NOW, title: 'first' }),
      createLine('T1', { owner: 'etl', by: 'etl', at: NOW, title: 'second' }),
      statusLine('T9', 'po', NOW, 'done'),
    )
    expect(tasks.length).toBe(1)
    expect(tasks[0]?.title).toBe('first')
  })

  test('reads the register\'s v2 lines: a blocked-by link shows blocked with its marker and holder, its notes read newest first', async () => {
    const lines = [
      createLine('T1', { owner: 'po', by: 'lead', at: NOW }),
      createLine('T2', { owner: 'po', by: 'lead', at: NOW }),
      linkLine('T2', 'po', NOW + HOUR, 'blocked-by', 'T1'),
      noteLine('T2', 'po', NOW + HOUR, 'first'),
      noteLine('T2', 'po', NOW + 2 * HOUR, 'second'),
    ]
    expect(parseJsonl(lines.join('\n'), parseEvent).skipped).toBe(0)
    const [blocker, held] = fold(...lines)
    expect(blocker?.shown).toBe('open')
    expect(blocker?.markers).toEqual([])
    expect(held?.status).toBe('open')
    expect(held?.shown).toBe('blocked')
    expect(held?.markers).toEqual(['⛔T1'])
    expect(held?.holds).toEqual(['T1'])
    expect(held?.notes).toEqual({ items: [{ at: new Date(NOW + 2 * HOUR).toISOString(), by: 'po', text: 'second' }, { at: new Date(NOW + HOUR).toISOString(), by: 'po', text: 'first' }], more: 0 })
  })

  test('an update carrying only an eta or an estimate reads, and keeps the task (register v2 fields)', async () => {
    const lines = [
      createLine('T1', { owner: 'po', by: 'lead', at: NOW }),
      updateLine('T1', 'po', NOW + HOUR, { eta: '2026-10-19' }),
      updateLine('T1', 'po', NOW + 2 * HOUR, { est: { value: 1.5, unit: 'd' } }),
    ]
    expect(parseJsonl(lines.join('\n'), parseEvent).skipped).toBe(0)
    const [task] = fold(...lines)
    expect(task?.id).toBe('T1')
    expect(task?.updatedAt).toBe(new Date(NOW + 2 * HOUR).toISOString())
  })

  test('a blocker that is done no longer holds, and a wait holds as its kind', async () => {
    const [, released] = fold(
      createLine('T1', { owner: 'po', by: 'lead', at: NOW }),
      createLine('T2', { owner: 'po', by: 'lead', at: NOW }),
      linkLine('T2', 'po', NOW, 'blocked-by', 'T1'),
      statusLine('T1', 'po', NOW + HOUR, 'done'),
    )
    expect(released?.shown).toBe('open')
    expect(released?.holds).toEqual([])
    const [waiting] = fold(createLine('T1', { owner: 'po', by: 'lead', at: NOW }), waitLine('T1', 'po', NOW, 'owner', 'pick the formula'))
    expect(waiting?.shown).toBe('blocked')
    expect(waiting?.markers).toEqual(['⏳owner'])
    expect(waiting?.holds).toEqual(['owner: pick the formula'])
  })

  test('a stored verifying status reads as verifying, never hidden by a pause', async () => {
    const [task] = readLines(
      [createLine('T1', { owner: 'po', by: 'po', at: NOW, tier: 4 }), statusLine('T1', 'po', NOW, 'verifying', 'proof tonight')],
      [],
      [pauseLine('P1', NOW, [4], 'budget')],
    )
    expect(task?.status).toBe('verifying')
    expect(task?.shown).toBe('verifying')
    expect(task?.pause).toBe(null)
  })

  test('a pause over its tier shows the task paused, with its marker and why', async () => {
    const [paused, kept] = readLines(
      [createLine('T1', { owner: 'po', by: 'po', at: NOW, tier: 4 }), createLine('T2', { owner: 'po', by: 'po', at: NOW, tier: 1 })],
      [],
      [pauseLine('P1', NOW, [4], 'budget cut')],
    )
    expect(paused?.shown).toBe('paused')
    expect(paused?.markers).toEqual(['⏸P1'])
    expect(paused?.pause).toBe('P1: budget cut')
    expect(kept?.shown).toBe('open')
    expect(kept?.pause).toBe(null)
  })

  test('a renamed session owns its tasks under its new name', async () => {
    const [task] = readLines([createLine('T1', { owner: 'toolchain', by: 'lead', at: NOW })], [aliasLine('toolchain', 'teamrig', NOW + HOUR)])
    expect(task?.owner).toBe('teamrig')
  })

  test('binds a session to the area of its newest inbox read and counts unread lines past the mark', async () => {
    const marks = parseJsonl(
      [markLine('po', 10, 's1', NOW), markLine('lead', 4, 's2', NOW), markLine('po', 24, 's1', NOW + 1)].join('\n'),
      parseMark,
    ).records
    expect(areaOfSession(marks, 's1')).toBe('po')
    expect(areaOfSession(marks, 's3')).toBe(null)
    expect(readTo(marks, 'po')).toBe(24)
    expect(unreadLines(30, 24)).toBe(6)
    expect(unreadLines(5, 24)).toBe(5)
    expect(unreadLines(30, undefined)).toBe(null)
  })
})

describe('view', () => {
  test('lists the area in plan order: tier, then due (undated last), then id', async () => {
    const tasks = fold(
      createLine('T1', { owner: 'po', by: 'po', at: NOW, tier: 3 }),
      createLine('T2', { owner: 'po', by: 'po', at: NOW, tier: 1 }),
      createLine('T3', { owner: 'po', by: 'po', at: NOW, tier: 3, due: '2026-10-14' }),
      createLine('T4', { owner: 'po', by: 'po', at: NOW, tier: 3, due: '2026-10-14 09:00' }),
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
    expect(dueInstant('2026-10-13')).toBe(Date.UTC(2026, 9, 14) - 1)
    expect(flagsOf(task, NOW)).toEqual([])
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
    const detailed = fold(createLine('T1', { owner: 'po', by: 'lead', at: NOW, due: '2026-10-13 15:00', detail: 'the steps' }))
    expect(sameView(base, { ...base, tasks: detailed })).toBe(false)
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
      createLine('T1', { owner: 'po', by: 'lead', at: NOW - HOUR, tier: 2, due: '2026-10-14', title: 'Ship it' }),
      createLine('T2', { owner: 'po', by: 'po', at: NOW - HOUR }),
      statusLine('T2', 'po', NOW, 'blocked', 'needs owner'),
      createLine('T3', { owner: 'po', by: 'po', at: NOW - HOUR, title: 'Old work' }),
      statusLine('T3', 'po', NOW, 'done'),
    )
    const blocks = paneBlocks(snapshotOf(tasks, 'po'), 'mine')
    expect(blocks.map(b => b.key)).toEqual(['header', 'active:T1', 'active:T2', 'finished', 'finished:T3'])
    expect(textAt(blocks, 'header')).toBe('po · 2 active · inbox 2 unread')
    expect(rowAt(blocks, 'header')?.rule).toBe(true)
    expect(textAt(blocks, 'active:T1')).toBe('▸ ○ T1 t2 10-14 NEW Ship it')
    expect(rowAt(blocks, 'active:T1')?.hang).toEqual({ text: '    ' })
    expect(blockAt(blocks, 'active:T1')?.toggle).toBe('T1')
    expect(blockAt(blocks, 'active:T2')?.rows.map(r => r.key)).toEqual(['active:T2', 'active-note:T2'])
    expect(textAt(blocks, 'active-note:T2')).toBe('    ↳ needs owner')
    expect(textAt(blocks, 'finished')).toBe('── finished today')
    expect(blockAt(blocks, 'finished')?.opensSection).toBe(true)
    expect(rowAt(blocks, 'finished:T3')?.spans).toEqual([{ text: '▸ ✓ T3 Old work', dim: true }])
    expect(blockAt(blocks, 'finished:T3')?.toggle).toBe('T3')
  })

  test('a snapshot never read says the register is being read, not that the session has no area; a failed first read shows why', () => {
    const unread = { ...snapshotOf([], null), now: 0 }
    expect(paneBlocks(unread, 'mine').map(b => b.key)).toEqual(['reading'])
    expect(textAt(paneBlocks(unread, 'all'), 'reading')).toBe('Reading the register…')
    expect(paneBlocks({ ...unread, problem: 'EACCES' }, 'mine')[0]?.key).toBe('problem')
  })

  test('draws a glyph for every status the register has, and for no other (the contract the types spell out)', async () => {
    const shownStatuses: readonly ShownStatus[] = [...STATUSES, 'paused']
    expect(Object.keys(GLYPH).sort()).toEqual([...shownStatuses].sort())
  })

  test('a task held by a link or wait draws blocked with its markers and what holds it; a verifying one draws ◇', async () => {
    const tasks = fold(
      createLine('T1', { owner: 'po', by: 'po', at: NOW - HOUR, title: 'First' }),
      createLine('T2', { owner: 'po', by: 'po', at: NOW - HOUR, title: 'Second' }),
      linkLine('T2', 'po', NOW - HOUR, 'blocked-by', 'T1'),
      waitLine('T2', 'po', NOW - HOUR, 'owner', 'pick one'),
      createLine('T3', { owner: 'po', by: 'po', at: NOW - HOUR, title: 'Third' }),
      statusLine('T3', 'po', NOW, 'verifying'),
    )
    const blocks = paneBlocks(snapshotOf(tasks, 'po'), 'mine')
    expect(textAt(blocks, 'active:T2')).toBe('▸ ■ T2 t3 ⛔T1 ⏳owner Second')
    expect(textAt(blocks, 'active-note:T2')).toBe('    ↳ waits on T1 · owner: pick one')
    expect(textAt(blocks, 'active:T3')).toBe('▸ ◇ T3 t3 Third')
    expect(textAt(blocks, 'header')).toBe('po · 3 active · inbox 2 unread')
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
    expect(textAt(blocks, 'active-detail:T1:asked')).toBe('    │ asked by owner · added by lead · 10-13 13:00 · G10.2 · G15')
    expect(textAt(blocks, 'active-detail:T1:note')).toBe('    │ blocked: needs owner · evidence abc123')
    expect(textAt(blocks, 'active-detail:T1:see')).toBe('    │ see docs/x.md')
    expect(textAt(blocks, 'active-detail:T2:see')).toBe('    │ see quote')
    expect(textAt(blocks, 'active-detail:T2:asked')).toBe('    │ asked by po · 10-13 13:00 · G10.2')
    const details = blocks.flatMap(b => b.rows).filter(r => r.key.includes('-detail:'))
    expect(details.every(r => r.hang?.text === '    │ ' && r.spans[0]?.text === '    │ ')).toBe(true)
  })

  test('an expanded task shows its register v2 facts, each only when set, while a collapsed one stays one line', async () => {
    const tasks = fold(
      createLine('T1', { owner: 'po', by: 'lead', at: NOW - 3 * HOUR, title: 'Pane v2' }),
      createLine('T2', { owner: 'po', by: 'lead', at: NOW - 3 * HOUR, title: 'Show the fields', due: '2026-10-14' }),
      createLine('T3', { owner: 'po', by: 'lead', at: NOW - 3 * HOUR, title: 'Harden it' }),
      createLine('T4', { owner: 'po', by: 'lead', at: NOW - 3 * HOUR, title: 'Vendor the core' }),
      linkLine('T2', 'po', NOW - 2 * HOUR, 'parent', 'T1'),
      linkLine('T3', 'po', NOW - 2 * HOUR, 'parent', 'T1'),
      linkLine('T2', 'po', NOW - 2 * HOUR, 'blocked-by', 'T4'),
      statusLine('T4', 'po', NOW - 2 * HOUR, 'done'),
      updateLine('T2', 'po', NOW - 2 * HOUR, { kind: 'code', labels: ['token-saving', 'ui'], start: '2026-10-13', eta: '2026-10-15', est: { value: 1.5, unit: 'd' } }),
      updateLine('T2', 'po', NOW - HOUR, { eta: '2026-10-16', due: '2026-10-15' }),
      statusLine('T2', 'po', NOW - HOUR, 'in-progress'),
      statusLine('T2', 'po', NOW - HOUR / 2, 'verifying', 'shipped', 'abc123', { evidenceDue: '2026-10-15 06:00' }),
      waitLine('T2', 'po', NOW - HOUR / 2, 'owner', 'approve the CSP'),
      noteLine('T2', 'po', NOW - 40 * 60_000, 'n1'),
      noteLine('T2', 'po', NOW - 30 * 60_000, 'n2'),
      noteLine('T2', 'po', NOW - 20 * 60_000, 'n3'),
      noteLine('T2', 'po', NOW - 10 * 60_000, 'n4'),
    )
    const t2 = tasks.find(t => t.id === 'T2')
    expect(t2?.notes.items.map(n => n.text)).toEqual(['n4', 'n3', 'n2'])
    expect(t2?.notes.more).toBe(4 - NOTES_SHOWN)
    const quiet = { ref: 'docs/x.md', quotes: [] }
    const blocks = paneBlocks(snapshotOf(tasks, 'po'), 'mine', { T1: quiet, T2: quiet })
    expect(blockAt(blocks, 'active:T2')?.rows.map(r => r.key)).toEqual([
      'active:T2',
      'active-detail:T2:gap:facts',
      'active-detail:T2:asked',
      'active-detail:T2:kind',
      'active-detail:T2:dates',
      'active-detail:T2:estimate',
      'active-detail:T2:note',
      'active-detail:T2:evidence-due',
      'active-detail:T2:parent',
      'active-detail:T2:blocked-by',
      'active-detail:T2:blocked-by:0',
      'active-detail:T2:wait:0',
      'active-detail:T2:notes',
      'active-detail:T2:notes:0',
      'active-detail:T2:notes:1',
      'active-detail:T2:notes:2',
      'active-detail:T2:notes:3',
      'active-detail:T2:see',
    ])
    expect(textAt(blocks, 'active-detail:T2:kind')).toBe('    │ kind code · labels token-saving,ui')
    expect(textAt(blocks, 'active-detail:T2:dates')).toBe('    │ start 10-13 · started 10-13 13:00 · eta 10-16 (moved 1×) · due moved 1×')
    expect(textAt(blocks, 'active-detail:T2:estimate')).toBe('    │ est 1.5d')
    expect(textAt(blocks, 'active-detail:T2:note')).toBe('    │ verifying: shipped · evidence abc123')
    expect(textAt(blocks, 'active-detail:T2:evidence-due')).toBe('    │ evidence due 10-15 06:00')
    expect(textAt(blocks, 'active-detail:T2:parent')).toBe(`    │ part of ${GLYPH.open} T1 Pane v2`)
    expect(textAt(blocks, 'active-detail:T2:blocked-by:0')).toBe(`    │   └ ${GLYPH.done} T4 Vendor the core`)
    expect(textAt(blocks, 'active-detail:T2:wait:0')).toBe('    │ waits on owner: approve the CSP')
    expect(textAt(blocks, 'active-detail:T2:notes:0')).toBe('    │   ├ 10-13 13:50 po: n4')
    expect(textAt(blocks, 'active-detail:T2:notes:3')).toBe("    │   └ +1 older (the register's show has them)")
    // The parent shows its sub-tasks as a small tree and nothing it has no value for.
    expect(blockAt(blocks, 'active:T1')?.rows.map(r => r.key)).toEqual([
      'active:T1',
      'active-detail:T1:gap:facts',
      'active-detail:T1:asked',
      'active-detail:T1:estimate',
      'active-detail:T1:children',
      'active-detail:T1:children:0',
      'active-detail:T1:children:1',
      'active-detail:T1:see',
    ])
    // A parent's size is its sub-tasks', as the register's show sums it.
    expect(textAt(blocks, 'active-detail:T1:estimate')).toBe('    │ est 1.5d (sub-tasks)')
    expect(textAt(blocks, 'active-detail:T1:children:0')).toBe(`    │   ├ ${GLYPH[t2?.shown ?? 'open']} T2 Show the fields`)
    expect(textAt(blocks, 'active-detail:T1:children:1')).toBe(`    │   └ ${GLYPH.open} T3 Harden it`)
    // A collapsed task with v2 facts is still the one line the list draws.
    expect(blockAt(blocks, 'active:T3')?.rows.map(r => r.key)).toEqual(['active:T3'])
    const collapsed = paneBlocks(snapshotOf(tasks, 'po'), 'mine', {})
    expect(collapsed.flatMap(b => b.rows).filter(r => r.key.includes('-detail:'))).toEqual([])
  })

  test('an expanded parent names its first sub-tasks by number and says how many more it has', async () => {
    const children = Array.from({ length: CHILDREN_SHOWN + 2 }, (_, i) => `T${i + 2}`)
    const tasks = fold(
      createLine('T1', { owner: 'po', by: 'lead', at: NOW, title: 'Parent' }),
      ...children.flatMap(id => [createLine(id, { owner: 'po', by: 'lead', at: NOW }), linkLine(id, 'po', NOW, 'parent', 'T1')]),
    )
    const parent = tasks.find(t => t.id === 'T1')
    expect(parent?.children.items.map(c => c.id)).toEqual(children.slice(0, CHILDREN_SHOWN))
    expect(parent?.children.more).toBe(2)
    const blocks = paneBlocks(snapshotOf(tasks, 'po'), 'mine', { T1: { ref: 'docs/x.md', quotes: [] } })
    const tree = blockAt(blocks, 'active:T1')?.rows.filter(r => r.key.startsWith('active-detail:T1:children')) ?? []
    expect(tree.length).toBe(1 + CHILDREN_SHOWN + 1)
    expect(textOf(tree[CHILDREN_SHOWN] ?? { key: '', spans: [] })).toBe(`    │   ├ ${GLYPH.open} T9 task T9`)
    expect(textOf(tree[CHILDREN_SHOWN + 1] ?? { key: '', spans: [] })).toBe('    │   └ +2 more')
  })

  test("an estimate adds its share of a fleet week only from a fresh usage run, else it reads in its own unit", async () => {
    const lines = [createLine('T1', { owner: 'po', by: 'lead', at: NOW }), updateLine('T1', 'po', NOW, { est: { value: 1.5, unit: 'd' } })]
    const day = { cr: 100_000_000, msgs: 1000 }
    const run = (date: string) => parseUsageRun(date, JSON.parse(usageRunJson({ '2026-10-12': day, '2026-10-13': day })))
    expect(readLines(lines)[0]?.estimate).toBe('est 1.5d')
    expect(readLines(lines, [], [], run('2026-10-01'))[0]?.estimate).toBe('est 1.5d')
    // 1.5 days at 1000 messages a day of 100k tokens each, over a fleet week of 2 × 100M × 7/2.
    expect(readLines(lines, [], [], run('2026-10-13'))[0]?.estimate).toBe('est 1.5d ≈ 0.15B = 21.4% of a fleet week')
    expect(readLines([createLine('T1', { owner: 'po', by: 'lead', at: NOW })], [], [], run('2026-10-13'))[0]?.estimate).toBe(null)
  })

  test("an expanded task's detail comes first, before its quotes", async () => {
    const tasks = fold(createLine('T1', { owner: 'po', by: 'lead', at: NOW - HOUR, source: 'owner', ref: 'docs/x.md:9', detail: 'ship it; done = merged' }))
    const quotes = [{ ref: 'docs/x.md:9', lines: ['the roadmap line'] }]
    const blocks = paneBlocks(snapshotOf(tasks, 'po'), 'mine', { T1: { ref: 'docs/x.md:9', quotes } })
    expect(blockAt(blocks, 'active:T1')?.rows.map(r => r.key).slice(0, 5)).toEqual([
      'active:T1',
      'active-detail:T1:gap:detail',
      'active-detail:T1:detail',
      'active-detail:T1:gap:0',
      'active-detail:T1:quote:0:0',
    ])
    expect(textAt(blocks, 'active-detail:T1:detail')).toBe('    │ ship it; done = merged')
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
        spans: [{ text: "⚠ the pane could not draw: Cannot read properties of undefined (reading 'items')", color: 'error' }],
        wrap: 'wrap',
        toggle: null,
      },
    ])
    expect(failedDrawing('state store unavailable').map(textOf)).toEqual(['⚠ the pane could not draw: state store unavailable'])
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
  test('parses every /tasklist form', async () => {
    expect(parseTaskListArgs('')).toEqual({ kind: 'open' })
    expect(parseTaskListArgs(' All ')).toEqual({ kind: 'mode', mode: 'all' })
    expect(parseTaskListArgs('auto')).toEqual({ kind: 'auto' })
    expect(parseTaskListArgs('po')).toEqual({ kind: 'pin', area: 'po' })
    expect(parseTaskListArgs('no such area!')).toEqual({ kind: 'usage' })
  })

  test('says why the pane sits above the prompt instead of docking', async () => {
    expect(inlineReason({ isFullscreen: true, columns: 110 })).toBe(null)
    expect(inlineReason({ isFullscreen: true, columns: 96 })).toContain('96 columns wide')
    expect(inlineReason({ isFullscreen: false, columns: 200 })).toContain('main screen')
  })
})

const PATHS: RegisterPaths = {
  events: 'R/tasks/events.jsonl',
  aliases: 'R/tasks/aliases.jsonl',
  pauses: 'R/tasks/pauses.jsonl',
  marks: 'R/tasks/inbox-marks.jsonl',
  inboxDir: 'R/inbox',
  usageDir: 'R/usage',
}

describe('source', () => {
  test('the register files sit under its folders, with slashes made forward and no trailing one', async () => {
    expect(registerPaths({ tasksDir: 'D:\\team\\state\\', inboxDir: 'D:/team/state/inbox/', usageDir: 'D:\\u' })).toEqual({
      events: 'D:/team/state/events.jsonl',
      aliases: 'D:/team/state/aliases.jsonl',
      pauses: 'D:/team/state/pauses.jsonl',
      marks: 'D:/team/state/inbox-marks.jsonl',
      inboxDir: 'D:/team/state/inbox',
      usageDir: 'D:/u',
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
    files.write(PATHS.marks, markLine('po', 1, 's1', NOW))
    files.write(`${PATHS.inboxDir}/po.md`, 'a\nb\n\nc\n')
    const source = new TaskRegisterSource(files, PATHS)

    const first = await source.poll({ claudeSession: 's1', pinned: null, now: NOW })
    expect(first?.area).toBe('po')
    expect(first?.areaSource).toBe('inbox-read')
    expect(first?.unreadInbox).toBe(2)
    expect(files.reads.length).toBe(3)

    expect(await source.poll({ claudeSession: 's1', pinned: null, now: NOW })).toBe(null)
    expect(files.reads.length).toBe(3)

    files.write(PATHS.events, [createLine('T1', { owner: 'po', by: 'po', at: NOW }), statusLine('T1', 'po', NOW, 'done')].join('\n'))
    const next = await source.poll({ claudeSession: 's1', pinned: null, now: NOW })
    expect(next?.tasks[0]?.status).toBe('done')
    expect(files.reads.length).toBe(4)
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
      linkLine('T5', 'po', NOW - 3 * DAY, 'parent', 'T2'),
    ].join('\n'))
    const snap = await new TaskRegisterSource(files, PATHS).poll({ claudeSession: 's1', pinned: 'po', now: NOW })
    expect(snap?.tasks.map(task => task.id)).toEqual(['T1', 'T3', 'T4', 'T5'])
    expect(snap?.tasks.find(task => task.id === 'T5')?.parent).toEqual({ id: 'T2', shown: 'done', title: 'task T2' })

    const big = new MemoryFiles()
    big.write(PATHS.events, bigRegister(20_000).join('\n'))
    const all = await new TaskRegisterSource(big, PATHS).poll({ claudeSession: 's1', pinned: 'po', now: NOW })
    // po's 408 and the last task, its done line past the 20,000th; none of the 3,673 finished a month ago.
    expect(all?.tasks.length).toBe(409)
  })

  test('v2 lines, renames and pauses read with no problem, and a moved rename or pause file refolds the tasks', async () => {
    const files = new MemoryFiles()
    files.write(
      PATHS.events,
      [createLine('T1', { owner: 'toolchain', by: 'lead', at: NOW, tier: 4 }), noteLine('T1', 'toolchain', NOW, 'started')].join('\n'),
    )
    const source = new TaskRegisterSource(files, PATHS)
    const first = await source.poll({ claudeSession: 's1', pinned: 'teamrig', now: NOW })
    expect(first?.problem).toBe(null)
    expect(first?.tasks[0]?.owner).toBe('toolchain')

    files.write(PATHS.aliases, aliasLine('toolchain', 'teamrig', NOW))
    const renamed = await source.poll({ claudeSession: 's1', pinned: 'teamrig', now: NOW })
    expect(renamed?.tasks[0]?.owner).toBe('teamrig')

    files.write(PATHS.pauses, [pauseLine('P1', NOW, [4], 'budget'), '{"type":"pause"'].join('\n'))
    const paused = await source.poll({ claudeSession: 's1', pinned: 'teamrig', now: NOW })
    expect(paused?.tasks[0]?.shown).toBe('paused')
    expect(paused?.problem).toBe('1 register line(s) this pane cannot read')
  })

  test('a pin wins over the inbox read, and missing files read as an empty register', async () => {
    const source = new TaskRegisterSource(new MemoryFiles(), PATHS)
    const snap = await source.poll({ claudeSession: 's1', pinned: 'etl', now: NOW })
    expect(snap).toEqual({ tasks: [], area: 'etl', areaSource: 'pinned', unreadInbox: null, problem: null, now: NOW })
  })
})

describe('usage', () => {
  const day = { cr: 100_000_000, msgs: 1000 }

  test('reads the newest run by the date in its name, lists at most once a minute, and keeps the last run when a read fails', async () => {
    const files = new MemoryFiles()
    files.write('U/usage-2026-10-13.json', usageRunJson({ '2026-10-13': day }))
    files.write('U/usage-2026-10-11.json', usageRunJson({ '2026-10-11': day }))
    files.write('U/notes.txt', 'not a run')
    files.write('U/live/usage-2026-10-14.json', usageRunJson({ '2026-10-14': day }))
    const runs = new UsageRuns(files, 'U')
    expect(await runs.refresh(NOW)).toBe(true)
    expect(runs.current?.date).toBe('2026-10-13')
    expect(files.reads).toEqual(['U/usage-2026-10-13.json'])

    files.write('U/usage-2026-10-14.json', usageRunJson({ '2026-10-14': day }))
    expect(await runs.refresh(NOW + USAGE_LIST_MS - 1)).toBe(false)
    expect(files.lists).toEqual(['U'])

    files.failNextRead = 'EBUSY: resource busy or locked'
    expect(await runs.refresh(NOW + USAGE_LIST_MS)).toBe(false)
    expect(runs.current?.date).toBe('2026-10-13')
    expect(await runs.refresh(NOW + 2 * USAGE_LIST_MS)).toBe(true)
    expect(runs.current?.date).toBe('2026-10-14')
    expect(await runs.refresh(NOW + 3 * USAGE_LIST_MS)).toBe(false)
    expect(files.reads.length).toBe(3)

    files.write('U/usage-2026-10-15.json', 'not json')
    expect(await runs.refresh(NOW + 4 * USAGE_LIST_MS)).toBe(true)
    expect(runs.current).toBe(null)
  })

  test('a new usage run refolds the tasks, so an estimate gains its share of a fleet week', async () => {
    const files = new MemoryFiles()
    files.write(PATHS.events, [createLine('T1', { owner: 'po', by: 'po', at: NOW }), updateLine('T1', 'po', NOW, { est: { value: 1, unit: 'd' } })].join('\n'))
    const source = new TaskRegisterSource(files, PATHS)
    const first = await source.poll({ claudeSession: 's1', pinned: 'po', now: NOW })
    expect(first?.tasks[0]?.estimate).toBe('est 1d')
    expect(first?.problem).toBe(null)

    files.write(`${PATHS.usageDir}/usage-2026-10-13.json`, usageRunJson({ '2026-10-12': day, '2026-10-13': day }))
    expect(await source.poll({ claudeSession: 's1', pinned: 'po', now: NOW + USAGE_LIST_MS - 1 })).toBe(null)
    const next = await source.poll({ claudeSession: 's1', pinned: 'po', now: NOW + USAGE_LIST_MS })
    expect(next?.tasks[0]?.estimate).toMatch(/^est 1d ≈ .* of a fleet week$/)
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
    const { ports, snapshot } = livePorts(files, ['s1'])
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
    const { ports, snapshot, writes } = livePorts(files, ['s1'])
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
    const { ports, snapshot } = livePorts(new MemoryFiles(), ['s1'])
    await new LiveRegister({ ...ports, source: { missing: 'no register: set its folders' } }).refresh()
    expect(snapshot().problem).toBe('no register: set its folders')
  })

  test('a pin is saved under the session and follows a /clear to the new session id', async () => {
    const ids = ['s1']
    const { ports, pins, snapshot } = livePorts(new MemoryFiles(), ids)
    const live = new LiveRegister(ports)
    await live.pin('etl')
    expect(pins.get('s1')).toBe('etl')
    expect(snapshot().area).toBe('etl')

    ids[0] = 's2'
    await live.refresh()
    expect(snapshot().area).toBe(null)

    await live.pin(null)
    expect(pins.size).toBe(1)
  })

  test('writes only what changes the drawing: not a file move, nor a tick that moves no label', async () => {
    const files = new MemoryFiles()
    files.write(PATHS.events, createLine('T1', { owner: 'po', by: 'lead', at: NOW, due: '2026-10-13 15:00' }))
    const { ports, clock, snapshot, writes } = livePorts(files, ['s1'])
    const live = new LiveRegister(ports)
    await live.pin('po')
    expect(writes()).toBe(1)

    files.write(PATHS.marks, markLine('etl', 0, 'another-session', NOW))
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
    const { ports, snapshot } = livePorts(files, ['s1'])
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
    const { ports, snapshot, clock } = livePorts(files, ['s1'])
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
    const { ports } = livePorts(new MemoryFiles(), ['s1'])
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
})
