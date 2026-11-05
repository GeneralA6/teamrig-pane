import { describe, expect, test } from 'claude-code/testing'
import type { Snapshot, TaskRow } from '../types'
import { TimeZone, readRegister } from '../hooks/core/read/index'
import { doneWeek, HELD_DAYS, heldSince, heldWeek, heldWeeks, isHeldFinished, weekClockOf, weekSteps, type DoneScope, type WeekClock } from '../hooks/done'
import { dayKey, doneBlocks, GROUP_ROWS, groupKey, heldText, moreKey, OLDER_DONE_COMMAND, weekWords } from '../hooks/done-rows'
import { rowOf } from '../hooks/log'
import type { Block } from '../hooks/rows'
import { HOUR, JERUSALEM, NOW, NO_TEAM, SNAPSHOT_SETTINGS, clockAt, createLine, statusLine } from './fixtures'

/** The rows teamrig's reader folds from event lines. */
function rowsOf(lines: readonly string[]): TaskRow[] {
  return [...readRegister(lines.join('\n')).state.tasks.values()].map(task => rowOf(task))
}

/** A task of `owner` made a day before `at` and closed `status` at `at`, planned for no week: Monday weeks. */
function finished(id: string, owner: string, at: number, status: 'done' | 'dropped' = 'done'): string[] {
  return [createLine(id, { owner, by: owner, at: at - 24 * HOUR, title: `Task ${id}`, week: null }), statusLine(id, owner, at, status)]
}

// NOW is Tue 2026-10-13 14:00 UTC: its week is the one of Mon 10-12, and the pane holds back to Mon 10-05 14:00.
const MONDAY = Date.UTC(2026, 9, 12)
/** NOW on UTC's clock, and on Jerusalem's (17:00 IDT, summer time until 10-25), with no week plan: Monday weeks. */
const AT_NOW: WeekClock = { ...clockAt(NOW), plan: null }
const IN_JERUSALEM: WeekClock = { ...clockAt(NOW, JERUSALEM), plan: null }
/** NOW under a week plan started Wed 10-07: its weeks run Wednesday to Tuesday. */
const IN_PLAN: WeekClock = { ...AT_NOW, plan: '2026-10-07' }
const TASKS = rowsOf([
  ...finished('T1', 'po', NOW - HOUR),
  ...finished('T2', 'po', MONDAY, 'dropped'),
  ...finished('T3', 'etl', MONDAY + 2 * HOUR),
  ...finished('T4', 'po', MONDAY - 60_000),
  ...finished('T5', 'po', MONDAY - 3 * 24 * HOUR),
  ...finished('T6', 'po', heldSince(NOW) - 60_000),
  createLine('T7', { owner: 'po', by: 'po', at: NOW - HOUR, week: null }),
])

/** What the pages of po, and of every owner, list: the fixture's tasks come from the owner (`source: 'owner'`). */
const MINE: DoneScope = { owner: 'po', ownerMarker: 'owner' }
const ALL: DoneScope = { owner: null, ownerMarker: 'owner' }

/** The ids of a week's rows, day by day: each group's in order, then the dropped. */
function idsByDay(week: ReturnType<typeof doneWeek>): string[][] {
  return week.days.map(day => [day.words, ...day.groups.groups.flatMap(group => group.tasks.map(task => task.id)), ...day.groups.dropped.map(task => task.id)])
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

  test('under a week plan the weeks start on its weekday, and a Monday week reads as the plan week holding it', () => {
    expect(heldWeeks(IN_PLAN)).toEqual({ newest: '2026-10-07', oldest: '2026-09-30' })
    expect(heldWeek('2026-10-12', IN_PLAN)).toBe('2026-10-07')
    expect(weekSteps('2026-10-07', IN_PLAN)).toEqual({ week: '2026-10-07', prev: '2026-09-30', next: null })
    // Wed 10-07 to Tue 10-13 holds Friday's T5 and Sunday's T4 with this week's.
    expect(idsByDay(doneWeek(TASKS, MINE, '2026-10-07', IN_PLAN))).toEqual([['Tue 10-13', 'T1'], ['Mon 10-12', 'T2'], ['Sun 10-11', 'T4'], ['Fri 10-09', 'T5']])
  })

  test("the snapshot's week plan is the newest week tag started by now, on the team's clock; none with no tag", () => {
    // T1 once per week tag; 10-14's plan has not started at NOW.
    const tagged = (...weeks: (string | null)[]): TaskRow[] => weeks.flatMap(week => TASKS.slice(0, 1).map(task => ({ ...task, week })))
    const snap = { now: NOW, timeZone: 'UTC', tasks: tagged('2026-09-30', '2026-10-07', '2026-10-14', null) }
    expect(weekClockOf(snap).plan).toBe('2026-10-07')
    expect(weekClockOf({ ...snap, tasks: tagged(null) }).plan).toBe(null)
  })
})

describe('doneWeek', () => {
  test("mine: the area's own, by day newest first, done and dropped counted, now's day marked", () => {
    const week = doneWeek(TASKS, MINE, '2026-10-12', AT_NOW)
    expect(idsByDay(week)).toEqual([['Tue 10-13', 'T1'], ['Mon 10-12', 'T2']])
    expect(week.days.map(day => day.today)).toEqual([true, false])
    expect([week.done, week.dropped]).toEqual([1, 1])
    expect([week.prev, week.next, week.heldFrom]).toEqual(['2026-10-05', null, null])
  })

  test("all: every owner's, a day's done before its dropped", () => {
    const week = doneWeek(TASKS, ALL, '2026-10-12', AT_NOW)
    expect(idsByDay(week)).toEqual([['Tue 10-13', 'T1'], ['Mon 10-12', 'T3', 'T2']])
    expect([week.done, week.dropped]).toEqual([2, 1])
  })

  test('the oldest week: Sunday 23:59 lands in it, no prev, and it says where the pane stops holding', () => {
    const week = doneWeek(TASKS, MINE, '2026-10-05', AT_NOW)
    // T6 closed a minute before the pane stops holding: not held, not listed.
    expect(idsByDay(week)).toEqual([['Sun 10-11', 'T4'], ['Fri 10-09', 'T5']])
    expect([week.prev, week.next, week.heldFrom]).toEqual([null, '2026-10-12', heldSince(NOW)])
  })

  test('a week outside the held ones reads as the nearest; an empty week has no days', () => {
    expect(doneWeek(TASKS, MINE, '2026-01-05', AT_NOW).week).toBe('2026-10-05')
    const empty = doneWeek(TASKS, { owner: 'web', ownerMarker: 'owner' }, '2026-10-12', AT_NOW)
    expect([empty.days, empty.done, empty.dropped]).toEqual([[], 0, 0])
  })

  test("the owner marker is the scope's: under another one the fixture's tasks group by their goal", () => {
    const week = doneWeek(TASKS, { owner: 'po', ownerMarker: 'boss' }, '2026-10-12', AT_NOW)
    expect(week.days[0]?.groups.groups.map(group => group.kind)).toEqual(['goal'])
  })

  test("in Jerusalem's zone, a task closed Sunday 23:59 UTC is Monday's there, and the days are its days", () => {
    const week = doneWeek(TASKS, MINE, '2026-10-12', IN_JERUSALEM)
    expect(idsByDay(week)).toEqual([['Tue 10-13', 'T1'], ['Mon 10-12', 'T4', 'T2']])
    expect([week.done, week.dropped]).toEqual([2, 1])
    const oldest = doneWeek(TASKS, MINE, '2026-10-05', IN_JERUSALEM)
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

const SNAP: Snapshot = { tasks: TASKS, area: 'po', areaSource: null, unreadInbox: null, inbox: [], problem: null, ...NO_TEAM, ...SNAPSHOT_SETTINGS, now: NOW }

/** The fields that pick a task's done group. */
type GroupFields = { source?: string; goals?: string[]; priority?: number; week?: string | null }

/** A task of po closed an hour before NOW: a lead's, with no goal and no week, so Other work unless `fields` say more. */
function closedToday(id: string, fields: GroupFields = {}, status: 'done' | 'dropped' = 'done'): string[] {
  const at = NOW - HOUR
  return [createLine(id, { owner: 'po', by: 'po', at: at - 24 * HOUR, title: `Task ${id}`, source: 'lead', goals: [], week: null, ...fields }), statusLine(id, 'po', at, status)]
}

const TODAY = '2026-10-13'
/** One task of each done group, closed today, and one dropped. */
const GROUPED: Snapshot = {
  ...SNAP,
  tasks: rowsOf([
    ...closedToday('T1'),
    ...closedToday('T2', { goals: ['G10.2'] }),
    ...closedToday('T3', { priority: 1 }),
    ...closedToday('T4', { week: '2026-10-12' }),
    ...closedToday('T5', { source: 'owner' }),
    ...closedToday('T6', {}, 'dropped'),
  ]),
}
/** More owner-asked tasks than a group shows. */
const CROWDED: Snapshot = { ...SNAP, tasks: rowsOf(Array.from({ length: GROUP_ROWS + 2 }, (_, i) => closedToday(`T${i + 1}`, { source: 'owner' })).flat()) }

describe('doneBlocks', () => {
  test("mine: the area's head and counts, the newest day open by its groups, each row opening its page with when it closed", () => {
    expect(linesOf(doneBlocks(SNAP, 'mine', '2026-10-12', []))).toEqual([
      'Done · po · 1 done · 1 dropped',
      '▾ Today so far · Tue 10-13 · 1 done',
      '  Owner asked (1)',
      '>T1     ✓ T1  Task T1 | 13:00 UTC',
      '▸ Mon 10-12 · 0 done · 1 dropped',
    ])
  })

  test('all: every owner, each row naming its owner', () => {
    expect(linesOf(doneBlocks(SNAP, 'all', '2026-10-12', [dayKey('2026-10-12')]))).toContain('>T3     ✓ T3  Task T3 | etl 02:00 UTC')
  })

  test("in the team's zone, each row's time and each day are on its clock, and a closed day counts what it holds", () => {
    const zoned: Snapshot = { ...SNAP, timeZone: JERUSALEM.name }
    expect(linesOf(doneBlocks(zoned, 'mine', '2026-10-12', []))).toEqual([
      'Done · po · 2 done · 1 dropped',
      '▾ Today so far · Tue 10-13 · 1 done',
      '  Owner asked (1)',
      '>T1     ✓ T1  Task T1 | 16:00 IDT',
      '▸ Mon 10-12 · 1 done · 1 owner asked · 1 dropped',
    ])
    expect(linesOf(doneBlocks(zoned, 'mine', '2026-10-12', [dayKey('2026-10-12'), groupKey('2026-10-12', 'dropped')])).slice(4)).toEqual([
      '▾ Mon 10-12 · 1 done',
      '  Owner asked (1)',
      '>T4     ✓ T4  Task T4 | 02:59 IDT',
      '  Dropped (1)',
      '>T2     ✗ T2  Task T2 | 03:00 IDT',
    ])
  })

  test('the newest day of a past week opens with no Today so far', () => {
    expect(linesOf(doneBlocks(SNAP, 'mine', '2026-10-05', [])).slice(1, 5)).toEqual([
      '▾ Sun 10-11 · 1 done',
      '  Owner asked (1)',
      '>T4     ✓ T4  Task T4 | 23:59 UTC',
      '▸ Fri 10-09 · 1 done · 1 owner asked',
    ])
  })

  test("the groups in the rule's order, a goal by its tag; Other work and Dropped start closed", () => {
    expect(linesOf(doneBlocks(GROUPED, 'mine', '2026-10-12', []))).toEqual([
      'Done · po · 5 done · 1 dropped',
      '▾ Today so far · Tue 10-13 · 5 done',
      '  Owner asked (1)',
      '>T5     ✓ T5  Task T5 | 13:00 UTC',
      '  G10.2 (1)',
      '>T2     ✓ T2  Task T2 | 13:00 UTC',
      '  Urgent p1 (1)',
      '>T3     ✓ T3  Task T3 | 13:00 UTC',
      "  This week's plan (1)",
      '>T4     ✓ T4  Task T4 | 13:00 UTC',
      '  ▸ Other work (1)',
      '  ▸ Dropped (1)',
    ])
  })

  test('a toggled key flips its fold against its default: a day, an open group, a closed group', () => {
    expect(linesOf(doneBlocks(GROUPED, 'mine', '2026-10-12', [dayKey(TODAY)]))).toEqual([
      'Done · po · 5 done · 1 dropped',
      '▸ Today so far · Tue 10-13 · 5 done · 1 owner asked · 1 for a goal · 1 p1 · 1 dropped',
    ])
    const flipped = linesOf(doneBlocks(GROUPED, 'mine', '2026-10-12', [groupKey(TODAY, 'G10.2'), groupKey(TODAY, 'other'), groupKey(TODAY, 'dropped')]))
    expect(flipped.slice(4)).toEqual([
      '  ▸ G10.2 (1)',
      '  Urgent p1 (1)',
      '>T3     ✓ T3  Task T3 | 13:00 UTC',
      "  This week's plan (1)",
      '>T4     ✓ T4  Task T4 | 13:00 UTC',
      '  Other work (1)',
      '>T1     ✓ T1  Task T1 | 13:00 UTC',
      '  Dropped (1)',
      '>T6     ✗ T6  Task T6 | 13:00 UTC',
    ])
  })

  test('each heading folds by its own key, and a row opens its task', () => {
    const blocks = doneBlocks(GROUPED, 'mine', '2026-10-12', [])
    expect(blocks.flatMap(block => (block.folds === undefined ? [] : [block.folds]))).toEqual([
      dayKey(TODAY),
      groupKey(TODAY, 'owner'),
      groupKey(TODAY, 'G10.2'),
      groupKey(TODAY, 'urgent'),
      groupKey(TODAY, 'plan'),
      groupKey(TODAY, 'other'),
      groupKey(TODAY, 'dropped'),
    ])
    expect(blocks.flatMap(block => (block.opens === undefined ? [] : [block.opens]))).toEqual(['T5', 'T2', 'T3', 'T4'])
  })

  test(`a group shows ${GROUP_ROWS} rows, then n more, whose press opens the rest in place`, () => {
    expect(linesOf(doneBlocks(CROWDED, 'mine', '2026-10-12', [])).slice(2)).toEqual([
      `  Owner asked (${GROUP_ROWS + 2})`,
      '>T1     ✓ T1  Task T1 | 13:00 UTC',
      '>T2     ✓ T2  Task T2 | 13:00 UTC',
      '>T3     ✓ T3  Task T3 | 13:00 UTC',
      '>T4     ✓ T4  Task T4 | 13:00 UTC',
      '    ▸ 2 more',
    ])
    const more = moreKey(TODAY, 'owner')
    expect(doneBlocks(CROWDED, 'mine', '2026-10-12', []).at(-1)?.folds).toBe(more)
    expect(linesOf(doneBlocks(CROWDED, 'mine', '2026-10-12', [more])).slice(-2)).toEqual(['>T5     ✓ T5  Task T5 | 13:00 UTC', '>T6     ✓ T6  Task T6 | 13:00 UTC'])
  })

  test('the oldest week ends with where the pane stops holding and the command that lists older ones', () => {
    const lines = linesOf(doneBlocks(SNAP, 'mine', '2026-10-05', []))
    expect(lines.at(-1)).toBe(heldText(heldSince(NOW), TimeZone.UTC))
    expect(heldText(heldSince(NOW), TimeZone.UTC)).toBe(`The pane holds tasks finished since Mon 10-05 14:00 UTC; ${OLDER_DONE_COMMAND} lists older ones.`)
    expect(heldText(heldSince(NOW), JERUSALEM)).toBe(`The pane holds tasks finished since Mon 10-05 17:00 IDT; ${OLDER_DONE_COMMAND} lists older ones.`)
  })

  test('an empty week says so', () => {
    expect(linesOf(doneBlocks({ ...SNAP, area: 'web' }, 'mine', '2026-10-12', []))).toEqual(['Done · web · 0 done · 0 dropped', 'Nothing finished this week.'])
  })

  test('a snapshot never read says it is being read; a problem leads the page', () => {
    expect(linesOf(doneBlocks({ ...SNAP, now: 0 }, 'mine', '2026-10-12', []))).toEqual(['Reading the register…'])
    expect(linesOf(doneBlocks({ ...SNAP, problem: 'events.jsonl: locked' }, 'mine', '2026-10-12', []))[0]).toBe('WARN events.jsonl: locked')
    expect(weekWords('2026-10-12')).toBe('Mon 10-12')
  })
})
