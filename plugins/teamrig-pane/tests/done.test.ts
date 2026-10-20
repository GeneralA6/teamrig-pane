import { describe, expect, test } from 'claude-code/testing'
import type { Snapshot, TaskRow } from '../types'
import { TimeZone, readRegister } from '../hooks/core/read/index'
import { doneWeek, HELD_DAYS, heldSince, heldWeek, heldWeeks, isHeldFinished, MAX_DONE_ROWS, weekSteps } from '../hooks/done'
import { doneBlocks, heldText, OLDER_DONE_COMMAND, weekWords } from '../hooks/done-rows'
import { rowOf } from '../hooks/log'
import type { Block } from '../hooks/rows'
import { HOUR, JERUSALEM, NOW, NO_TEAM, TEAM_SETTINGS, clockAt, createLine, statusLine } from './fixtures'

/** The rows teamrig's reader folds from event lines. */
function rowsOf(lines: readonly string[]): TaskRow[] {
  return [...readRegister(lines.join('\n')).state.tasks.values()].map(task => rowOf(task))
}

/** A task of `owner` made a day before `at` and closed `status` at `at`. */
function finished(id: string, owner: string, at: number, status: 'done' | 'dropped' = 'done'): string[] {
  return [createLine(id, { owner, by: owner, at: at - 24 * HOUR, title: `Task ${id}` }), statusLine(id, owner, at, status)]
}

// NOW is Tue 2026-10-13 14:00 UTC: its week is the one of Mon 10-12, and the pane holds back to Mon 10-05 14:00.
const MONDAY = Date.UTC(2026, 9, 12)
/** NOW on UTC's clock, and on Jerusalem's (17:00 IDT, summer time until 10-25). */
const AT_NOW = clockAt(NOW)
const IN_JERUSALEM = clockAt(NOW, JERUSALEM)
const TASKS = rowsOf([
  ...finished('T1', 'po', NOW - HOUR),
  ...finished('T2', 'po', MONDAY, 'dropped'),
  ...finished('T3', 'etl', MONDAY + 2 * HOUR),
  ...finished('T4', 'po', MONDAY - 60_000),
  ...finished('T5', 'po', MONDAY - 3 * 24 * HOUR),
  ...finished('T6', 'po', heldSince(NOW) - 60_000),
  createLine('T7', { owner: 'po', by: 'po', at: NOW - HOUR }),
])

/** The ids of a week's rows, day by day. */
function idsByDay(week: ReturnType<typeof doneWeek>): string[][] {
  return week.days.map(day => [day.words, ...day.tasks.map(task => task.id)])
}

describe('weeks', () => {
  test(`the pane holds finished tasks ${HELD_DAYS} days back: the newest week is now's, the oldest the one that reaches`, () => {
    expect(heldWeeks(AT_NOW)).toEqual({ newest: '2026-10-12', oldest: '2026-10-05' })
    expect(heldWeek('2026-09-28', AT_NOW)).toBe('2026-10-05')
    expect(heldWeek('2026-10-19', AT_NOW)).toBe('2026-10-12')
    expect(heldWeek('2026-10-05', AT_NOW)).toBe('2026-10-05')
    expect(weekSteps('2026-10-12', AT_NOW)).toEqual({ week: '2026-10-12', prev: '2026-10-05', next: null })
    expect(weekSteps('2026-09-28', AT_NOW)).toEqual({ week: '2026-10-05', prev: null, next: '2026-10-12' })
    // T6 closed a minute before the pane stops holding, T7 is open.
    expect(TASKS.filter(task => isHeldFinished(task, NOW)).map(task => task.id)).toEqual(['T1', 'T2', 'T3', 'T4', 'T5'])
  })
})

describe('doneWeek', () => {
  test("mine: the area's own, by day newest first, done and dropped counted", () => {
    const week = doneWeek(TASKS, 'po', '2026-10-12', AT_NOW)
    expect(idsByDay(week)).toEqual([['Tue 10-13', 'T1'], ['Mon 10-12', 'T2']])
    expect([week.done, week.dropped, week.more]).toEqual([1, 1, 0])
    expect([week.prev, week.next, week.heldFrom]).toEqual(['2026-10-05', null, null])
  })

  test("all: every owner's, newest first inside a day", () => {
    const week = doneWeek(TASKS, null, '2026-10-12', AT_NOW)
    expect(idsByDay(week)).toEqual([['Tue 10-13', 'T1'], ['Mon 10-12', 'T3', 'T2']])
    expect([week.done, week.dropped]).toEqual([2, 1])
  })

  test('the oldest week: Sunday 23:59 lands in it, no prev, and it says where the pane stops holding', () => {
    const week = doneWeek(TASKS, 'po', '2026-10-05', AT_NOW)
    // T6 closed a minute before the pane stops holding: not held, not listed.
    expect(idsByDay(week)).toEqual([['Sun 10-11', 'T4'], ['Fri 10-09', 'T5']])
    expect([week.prev, week.next, week.heldFrom]).toEqual([null, '2026-10-12', heldSince(NOW)])
  })

  test('a week outside the held ones reads as the nearest; an empty week has no days', () => {
    expect(doneWeek(TASKS, 'po', '2026-01-05', AT_NOW).week).toBe('2026-10-05')
    const empty = doneWeek(TASKS, 'web', '2026-10-12', AT_NOW)
    expect([empty.days, empty.done, empty.dropped, empty.more]).toEqual([[], 0, 0, 0])
  })

  test(`at most ${MAX_DONE_ROWS} rows, the rest counted`, () => {
    const many = rowsOf(Array.from({ length: MAX_DONE_ROWS + 3 }, (_, i) => finished(`T${i + 1}`, 'po', MONDAY + i * 60_000, i % 2 === 0 ? 'done' : 'dropped')).flat())
    const week = doneWeek(many, 'po', '2026-10-12', AT_NOW)
    expect(week.days.flatMap(day => day.tasks).length).toBe(MAX_DONE_ROWS)
    expect(week.days[0]?.tasks[0]?.id).toBe(`T${MAX_DONE_ROWS + 3}`)
    expect([week.done, week.dropped, week.more]).toEqual([27, 26, 3])
  })

  test("in Jerusalem's zone, a task closed Sunday 23:59 UTC is Monday's there, and the days are its days", () => {
    const week = doneWeek(TASKS, 'po', '2026-10-12', IN_JERUSALEM)
    expect(idsByDay(week)).toEqual([['Tue 10-13', 'T1'], ['Mon 10-12', 'T2', 'T4']])
    expect([week.done, week.dropped]).toEqual([2, 1])
    const oldest = doneWeek(TASKS, 'po', '2026-10-05', IN_JERUSALEM)
    expect(idsByDay(oldest)).toEqual([['Fri 10-09', 'T5']])
    expect([oldest.prev, oldest.next, oldest.heldFrom]).toEqual([null, '2026-10-12', heldSince(NOW)])
  })
})

/** Each row of `blocks` as its words, its end after a `|`, a block a task's page opens from marked `>` with its id. */
function linesOf(blocks: readonly Block[]): string[] {
  return blocks.flatMap(block =>
    block.rows.map(row => {
      const words = row.spans.map(span => span.text).join('')
      const end = row.end === undefined ? '' : ` | ${row.end.text}`
      return `${block.opens === undefined ? '' : `>${block.opens} `}${words}${end}`
    }),
  )
}

const SNAP: Snapshot = { tasks: TASKS, area: 'po', areaSource: null, unreadInbox: null, problem: null, ...NO_TEAM, ...TEAM_SETTINGS, now: NOW }

describe('doneBlocks', () => {
  test("mine: the area's head and counts, each day dim, each row opening its page with when it closed", () => {
    expect(linesOf(doneBlocks(SNAP, 'mine', '2026-10-12'))).toEqual([
      'Archive · po · 1 done · 1 dropped',
      'Tue 10-13',
      '>T1 ✓ T1  Task T1 | 13:00 UTC',
      'Mon 10-12',
      '>T2 ✗ T2  Task T2 | 00:00 UTC',
    ])
  })

  test('all: every owner, each row naming its owner', () => {
    expect(linesOf(doneBlocks(SNAP, 'all', '2026-10-12'))).toContain('>T3 ✓ T3  Task T3 | etl 02:00 UTC')
  })

  test("in the team's zone, each row's time and each day are on its clock", () => {
    expect(linesOf(doneBlocks({ ...SNAP, timeZone: JERUSALEM.name }, 'mine', '2026-10-12'))).toEqual([
      'Archive · po · 2 done · 1 dropped',
      'Tue 10-13',
      '>T1 ✓ T1  Task T1 | 16:00 IDT',
      'Mon 10-12',
      '>T2 ✗ T2  Task T2 | 03:00 IDT',
      '>T4 ✓ T4  Task T4 | 02:59 IDT',
    ])
  })

  test('the oldest week ends with where the pane stops holding and the command that lists older ones', () => {
    const lines = linesOf(doneBlocks(SNAP, 'mine', '2026-10-05'))
    expect(lines.at(-1)).toBe(heldText(heldSince(NOW), TimeZone.UTC))
    expect(heldText(heldSince(NOW), TimeZone.UTC)).toBe(`The pane holds tasks finished since Mon 10-05 14:00 UTC; ${OLDER_DONE_COMMAND} lists older ones.`)
    expect(heldText(heldSince(NOW), JERUSALEM)).toBe(`The pane holds tasks finished since Mon 10-05 17:00 IDT; ${OLDER_DONE_COMMAND} lists older ones.`)
  })

  test('an empty week says so; past the cap a dim line counts the rest', () => {
    expect(linesOf(doneBlocks({ ...SNAP, area: 'web' }, 'mine', '2026-10-12'))).toEqual(['Archive · web · 0 done · 0 dropped', 'Nothing finished this week.'])
    const many = rowsOf(Array.from({ length: MAX_DONE_ROWS + 2 }, (_, i) => finished(`T${i + 1}`, 'po', MONDAY + i * 60_000)).flat())
    expect(linesOf(doneBlocks({ ...SNAP, tasks: many }, 'mine', '2026-10-12')).at(-1)).toBe('2 more this week: search finds them')
  })

  test('a snapshot never read says it is being read; a problem leads the page', () => {
    expect(linesOf(doneBlocks({ ...SNAP, now: 0 }, 'mine', '2026-10-12'))).toEqual(['Reading the register…'])
    expect(linesOf(doneBlocks({ ...SNAP, problem: 'events.jsonl: locked' }, 'mine', '2026-10-12'))[0]).toBe('WARN events.jsonl: locked')
    expect(weekWords('2026-10-12')).toBe('Mon 10-12')
  })
})
