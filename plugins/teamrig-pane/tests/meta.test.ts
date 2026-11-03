import { describe, expect, test } from 'claude-code/testing'
import type { TaskRow, WaitRow } from '../types'
import { TimeZone, readRegister } from '../hooks/core/read/index'
import { rowOf } from '../hooks/log'
import { ageWords, clockWords, dayWords, dueWords, flagsOf, metaParts, metaText, neededByLines, neededByWords, STATUS_WORDS, storedDayWords, storedDueWords, typeWords, waitingWords, whenWords } from '../hooks/meta'
import { HOUR, JERUSALEM, NOT_PICKED_UP_HOURS, NOW, clockAt, createLine, iso, statusLine, treeAt, waitingLine } from './fixtures'

const DAY = 24 * HOUR

/** NOW is Tuesday 2026-10-13 14:00 UTC. */
function tasksOf(...lines: string[]): TaskRow[] {
  return [...readRegister(lines.join('\n')).state.tasks.values()].map(row => rowOf(row))
}

function taskOf(...lines: string[]): TaskRow {
  const [task] = tasksOf(...lines)
  if (task === undefined) throw new Error('no task')
  return task
}

/** The clock at NOW over a snapshot of no tasks: every task reason reads ready. */
const AT_NOW = treeAt([], NOW)

/** The same clock in Jerusalem's zone, where NOW is 17:00 IDT (summer time until 10-25). */
const IN_JERUSALEM = treeAt([], NOW, NOT_PICKED_UP_HOURS, JERUSALEM.name)

/** The meta line's words at `now`, the snapshot holding `tasks`. */
const textOf = (task: TaskRow, viewer: string | null, now = NOW, tasks: readonly TaskRow[] = []) =>
  metaParts(task, treeAt(tasks, now), viewer).map(part => part.text)

describe('meta words', () => {
  test("a day is the zone's weekday and month-day; a time today is its zone-marked hour, an older one its day", async () => {
    expect(dayWords(NOW, TimeZone.UTC)).toBe('Tue 10-13')
    expect(dayWords(Date.UTC(2026, 9, 18, 23, 59), TimeZone.UTC)).toBe('Sun 10-18')
    expect(whenWords(iso(NOW - 2 * HOUR), clockAt(NOW))).toBe('12:00 UTC')
    expect(whenWords(iso(Date.UTC(2026, 9, 13, 0, 0)), clockAt(NOW))).toBe('00:00 UTC')
    expect(whenWords(iso(Date.UTC(2026, 9, 12, 23, 59)), clockAt(NOW))).toBe('Mon 10-12')
    expect(whenWords('not a time', clockAt(NOW))).toBe('not a time')
  })

  test("in Jerusalem's zone, a day turns over at its midnight, 21:00 UTC in summer time, and a time reads IDT", async () => {
    const late = Date.UTC(2026, 9, 12, 23, 59)
    expect(dayWords(late, JERUSALEM)).toBe('Tue 10-13')
    expect(dayWords(Date.UTC(2026, 9, 18, 23, 59), JERUSALEM)).toBe('Mon 10-19')
    expect(whenWords(iso(late), clockAt(NOW, JERUSALEM))).toBe('02:59 IDT')
    expect(whenWords(iso(Date.UTC(2026, 9, 12, 20, 59)), clockAt(NOW, JERUSALEM))).toBe('Mon 10-12')
    expect(clockWords(iso(NOW), JERUSALEM)).toBe('17:00 IDT')
    expect(clockWords(iso(NOW), TimeZone.UTC)).toBe('14:00 UTC')
    expect(clockWords('not a time', JERUSALEM)).toBe('not a time')
  })

  test('a stored day (a week tag) reads as the day written, in no zone; an unreadable one is null', async () => {
    expect(storedDayWords('2026-10-12')).toBe('Mon 10-12')
    expect(storedDayWords('2026-10-18')).toBe('Sun 10-18')
    expect(storedDayWords('not a day')).toBe(null)
  })

  test('a due reads today or its day, with its time only when it was written with one', async () => {
    const due = (value: string | null) => dueWords(taskOf(createLine('T1', { owner: 'po', by: 'po', at: NOW, due: value })), AT_NOW)
    expect(due(null)).toBe(null)
    expect(due('2026-10-13')).toBe('today')
    expect(due('2026-10-13 18:00')).toBe('today 18:00 UTC')
    expect(due('2026-10-16')).toBe('Fri 10-16')
    expect(due('2026-10-16 09:30')).toBe('Fri 10-16 09:30 UTC')
    // teamrig's reader skips a create whose due it cannot read; a row built past it says the due as written.
    const odd = { ...taskOf(createLine('T1', { owner: 'po', by: 'po', at: NOW })), due: '2026-13-45' }
    expect(dueWords(odd, AT_NOW)).toBe('13-45')
  })

  test("in Jerusalem's zone, a stored minute (UTC) reads on its clock and a bare day ends at its midnight", async () => {
    const due = (value: string) => dueWords(taskOf(createLine('T1', { owner: 'po', by: 'po', at: NOW, due: value })), IN_JERUSALEM)
    expect(due('2026-10-13 18:00')).toBe('today 21:00 IDT')
    expect(due('2026-10-13 22:00')).toBe('Wed 10-14 01:00 IDT')
    expect(due('2026-10-13')).toBe('today')
    expect(due('2026-10-16')).toBe('Fri 10-16')
  })

  test("a stored due with no tree reads on the clock: a bare day, a time in the clock's zone, an unreadable one as written less its year", async () => {
    expect(storedDueWords('2026-10-16', clockAt(NOW))).toBe('Fri 10-16')
    expect(storedDueWords('2026-10-13', clockAt(NOW))).toBe('today')
    expect(storedDueWords('2026-10-13 18:00', clockAt(NOW))).toBe('today 18:00 UTC')
    expect(storedDueWords('2026-10-13 18:00', clockAt(NOW, JERUSALEM))).toBe('today 21:00 IDT')
    expect(storedDueWords('2026-13-45', clockAt(NOW))).toBe('13-45')
  })

  test('an age is hours under a day, one at least, then whole days', async () => {
    expect(ageWords(20 * 60_000)).toBe('1h')
    expect(ageWords(3 * HOUR + 59 * 60_000)).toBe('3h')
    expect(ageWords(DAY - 1)).toBe('23h')
    expect(ageWords(2 * DAY + 5 * HOUR)).toBe('2d')
  })

  test('each status reads as plain words', async () => {
    expect(STATUS_WORDS['in-progress']).toBe('in progress')
    expect(Object.values(STATUS_WORDS).every(word => /^[a-z ]+$/.test(word))).toBe(true)
  })
})

describe('meta flags', () => {
  test('a date-only due is due at the end of that UTC day', async () => {
    const task = taskOf(createLine('T1', { owner: 'po', by: 'po', at: NOW, due: '2026-10-13' }))
    expect(flagsOf(task, treeAt([task], NOW))).toEqual([])
    expect(flagsOf(task, treeAt([task], Date.UTC(2026, 9, 13, 23, 59)))).toEqual([])
    expect(flagsOf(task, treeAt([task], Date.UTC(2026, 9, 14, 0, 1)))).toEqual(['overdue'])
  })

  test('an untouched task is new, then not picked up after a day; a finished one has no flags', async () => {
    const task = taskOf(createLine('T1', { owner: 'po', by: 'lead', at: NOW }))
    expect(flagsOf(task, treeAt([task], NOW + HOUR))).toEqual(['new'])
    expect(flagsOf(task, treeAt([task], NOW + NOT_PICKED_UP_HOURS * HOUR + HOUR))).toEqual(['unseen'])
    const done = taskOf(createLine('T1', { owner: 'po', by: 'lead', at: NOW, due: '2026-10-01' }), statusLine('T1', 'po', NOW, 'done'))
    expect(flagsOf(done, treeAt([done], NOW))).toEqual([])
  })

  test("a team config's hours move when an untouched task reads not picked up, as teamrig's register check reads them", async () => {
    const task = taskOf(createLine('T1', { owner: 'po', by: 'lead', at: NOW }))
    expect(flagsOf(task, treeAt([task], NOW + 25 * HOUR, 48))).toEqual(['new'])
    expect(flagsOf(task, treeAt([task], NOW + 49 * HOUR, 48))).toEqual(['unseen'])
    expect(flagsOf(task, treeAt([task], NOW + 2 * HOUR, 1))).toEqual(['unseen'])
  })
})

describe('meta effective due', () => {
  /** T1 dated Fri 10-16, and T2 of the same owner, dated Wed 10-14, planned after it: T1 works to T2's date. */
  const [first, needer] = tasksOf(
    createLine('T1', { owner: 'po', by: 'po', at: NOW - DAY, source: 'po', due: '2026-10-16' }),
    createLine('T2', { owner: 'po', by: 'po', at: NOW - DAY, source: 'po', due: '2026-10-14', taskKeys: { after: ['T1'] } }),
  )
  if (first === undefined || needer === undefined) throw new Error('no tasks')

  test("a date taken from a task that needs it reads that task's date and names it; lateness counts from it", async () => {
    expect(textOf(first, 'po', NOW, [first, needer])).toEqual(['p3', 'due Wed 10-14 (from T2)'])
    expect(textOf(first, 'po', NOW + 2 * DAY, [first, needer])).toEqual(['p3', 'due Wed 10-14 (from T2)', 'late 14h'])
    expect(flagsOf(first, treeAt([first, needer], NOW + 2 * DAY))).toEqual(['overdue'])
    // The task that needs it reads its own date.
    expect(dueWords(needer, treeAt([first, needer], NOW))).toBe('Wed 10-14')
  })

  test('a task alone in the snapshot, or one the tree lacks, works to its own date', async () => {
    expect(textOf(first, 'po', NOW + 2 * DAY, [first])).toEqual(['p3', 'due Fri 10-16'])
    expect(dueWords(first, AT_NOW)).toBe('Fri 10-16')
    expect(flagsOf(first, treeAt([needer], Date.UTC(2026, 9, 15, 12, 0)))).toEqual([])
  })

  test("a verifying task's verify-by date is the effective due too", async () => {
    const verifying = taskOf(
      createLine('T1', { owner: 'po', by: 'po', at: NOW - DAY, source: 'po', due: '2026-10-16' }),
      statusLine('T1', 'po', NOW - HOUR, 'verifying', 'one clean night'),
    )
    expect(textOf(verifying, 'po', NOW, [verifying, needer])).toEqual(['p3', 'verify by Wed 10-14 (from T2)', 'verifying since 13:00 UTC: one clean night'])
  })
})

describe('meta needed by', () => {
  /** po's own T4 plans after T1 too. */
  const ownNeeder = createLine('T4', { owner: 'po', by: 'po', at: NOW - DAY, source: 'po', due: '2026-10-13', taskKeys: { after: ['T1'] } })
  /** Who needs T1: T2 (etl, Fri 10-16) plans after it, T3 (web, Wed 10-14) waits on it; po's own T4, and T5, done. */
  const needers = [
    createLine('T2', { owner: 'etl', by: 'etl', at: NOW - DAY, source: 'etl', due: '2026-10-16', taskKeys: { after: ['T1'] } }),
    createLine('T3', { owner: 'web', by: 'web', at: NOW - DAY, source: 'web', due: '2026-10-14' }),
    waitingLine('T3', 'web', NOW - HOUR, [{ kind: 'task', id: 'T1' }]),
    ownNeeder,
    createLine('T5', { owner: 'web', by: 'web', at: NOW - DAY, source: 'web', due: '2026-10-13', taskKeys: { after: ['T1'] } }),
    statusLine('T5', 'web', NOW - HOUR, 'done'),
  ]
  const own = (due: string | null = null) => createLine('T1', { owner: 'po', by: 'po', at: NOW - DAY, source: 'po', due })
  /** The first task the lines write (T1), the snapshot they fold to, and the tree over it at NOW. */
  const read = (...lines: string[]) => ({ task: taskOf(...lines), tasks: tasksOf(...lines), tree: treeAt(tasksOf(...lines), NOW) })

  test('names the earliest-due task of another owner that needs it, its owner and due, then how many more', async () => {
    const { task, tasks } = read(own('2026-10-20'), ...needers)
    // po's own T4 gives T1 its date; the needed-by names T3, the other owners' earliest, with T3's due.
    expect(textOf(task, 'po', NOW, tasks)).toEqual(['p3', 'due today (from T4)', 'needed by T3 (web, due Wed 10-14) +1'])
  })

  test("leaves the due out when the task's due label already names where it comes from", async () => {
    const { task, tasks } = read(own(), ...needers.slice(0, 3))
    expect(textOf(task, 'po', NOW, tasks)).toEqual(['p3', 'due Wed 10-14 (from T3)', 'needed by T3 (web) +1'])
    // A needer with no date is named by its owner alone.
    const undated = read(own(), createLine('T2', { owner: 'etl', by: 'etl', at: NOW - DAY, source: 'etl', taskKeys: { after: ['T1'] } }))
    expect(neededByWords(undated.task, undated.tree)).toBe('needed by T2 (etl)')
  })

  test('the card lists each of them, the earliest due first, each with its owner and due', async () => {
    const { task, tree } = read(own(), ...needers)
    expect(neededByLines(task, tree)).toEqual(['T3 (web, due Wed 10-14)', 'T2 (etl, due Fri 10-16)'])
  })

  test('a finished task, or one only its owner needs, holds no one up', async () => {
    const done = read(own(), statusLine('T1', 'po', NOW, 'done'), ...needers)
    expect(neededByWords(done.task, done.tree)).toBe(null)
    const mine = read(own(), ownNeeder)
    expect(neededByLines(mine.task, mine.tree)).toEqual([])
  })

  test('it follows what holds the task: after its unfinished after, before the flags', async () => {
    const tasks = tasksOf(
      createLine('T1', { owner: 'po', by: 'po', at: NOW - DAY, source: 'po' }),
      createLine('T2', { owner: 'po', by: 'lead', at: NOW - HOUR, source: 'lead', taskKeys: { after: ['T1'] } }),
      createLine('T3', { owner: 'etl', by: 'etl', at: NOW - DAY, source: 'etl', taskKeys: { after: ['T2'] } }),
    )
    const task = tasks.find(each => each.id === 'T2')
    if (task === undefined) throw new Error('no T2')
    expect(textOf(task, 'po', NOW, tasks)).toEqual(['p3', 'after T1', 'needed by T3 (etl)', 'new', 'asked by lead'])
  })
})

describe('meta line', () => {
  test('in progress: its priority, its due, since when, and how late it is, the lateness red', async () => {
    const task = taskOf(
      createLine('T1', { owner: 'po', by: 'po', at: NOW - DAY, priority: 2, due: '2026-10-12' }),
      statusLine('T1', 'po', NOW - 2 * HOUR, 'in-progress', 'halfway'),
    )
    expect(textOf(task, 'po')).toEqual(['p2', 'due Mon 10-12', 'in progress since 12:00 UTC', 'late 14h'])
    expect(metaParts(task, AT_NOW, 'po').map(part => part.color)).toEqual([undefined, undefined, undefined, 'error'])
  })

  test('a bug says so after its priority, a critical one critical bug; a task, or one no one typed, says nothing', async () => {
    const bug = taskOf(createLine('T1', { owner: 'po', by: 'po', at: NOW - HOUR, source: 'po', taskKeys: { type: 'bug' } }))
    expect(textOf(bug, 'po')).toEqual(['p3', 'bug'])
    const critical = taskOf(createLine('T1', { owner: 'po', by: 'po', at: NOW - HOUR, source: 'po', due: '2026-10-15', taskKeys: { type: 'bug', critical: true } }))
    expect(textOf(critical, 'po')).toEqual(['p3', 'critical bug', 'due Thu 10-15'])
    const task = taskOf(createLine('T1', { owner: 'po', by: 'po', at: NOW - HOUR, source: 'po', taskKeys: { type: 'task' } }))
    expect(typeWords(task)).toBe(null)
    expect(textOf(task, 'po')).toEqual(['p3'])
    const untyped = taskOf(createLine('T1', { owner: 'po', by: 'po', at: NOW - HOUR, source: 'po' }))
    expect([untyped.type, typeWords(untyped)]).toEqual([null, null])
  })

  test("a line from before item types reads its kind as teamrig does: critical a critical bug, problem a bug", async () => {
    const critical = taskOf(createLine('T1', { owner: 'po', by: 'po', at: NOW - HOUR, source: 'po', taskKeys: { kind: 'critical' } }))
    expect(typeWords(critical)).toBe('critical bug')
    const problem = taskOf(createLine('T1', { owner: 'po', by: 'po', at: NOW - HOUR, source: 'po', taskKeys: { kind: 'problem' } }))
    expect(typeWords(problem)).toBe('bug')
  })

  test('waiting: since when and why, in red; one waiting since an earlier day names the day', async () => {
    const task = taskOf(createLine('T1', { owner: 'po', by: 'po', at: NOW - 2 * DAY }), statusLine('T1', 'po', NOW - DAY, 'waiting', 'waits on T58'))
    expect(textOf(task, 'po')).toEqual(['p3', 'waiting since Mon 10-12: waits on T58'])
    expect(metaParts(task, AT_NOW, 'po')[1]?.color).toBe('error')
    const bare = taskOf(createLine('T1', { owner: 'po', by: 'po', at: NOW - DAY }), statusLine('T1', 'po', NOW, 'waiting'))
    expect(textOf(bare, 'po')).toEqual(['p3', 'waiting since 14:00 UTC'])
  })

  test('waiting on reasons: each in teamrig\'s words between commas, a cleared one ready, then the note', async () => {
    const reasons: readonly WaitRow[] = [{ kind: 'decision', who: 'owner' }, { kind: 'task', id: 'T1' }, { kind: 'time', at: '2026-10-16 14:00' }]
    const [first, waiting] = tasksOf(
      createLine('T1', { owner: 'po', by: 'po', at: NOW - DAY, source: 'po' }),
      createLine('T2', { owner: 'po', by: 'po', at: NOW - DAY, source: 'po' }),
      waitingLine('T2', 'po', NOW, reasons, 'the copy first'),
    )
    if (first === undefined || waiting === undefined) throw new Error('no tasks')
    expect(textOf(waiting, 'po', NOW, [first, waiting])).toEqual(['p3', 'waiting since 14:00 UTC: decision owner, on T1, until Fri 10-16 14:00 UTC; the copy first'])
    // T1 finished over HELD_DAYS ago, so the snapshot lacks it, and the time has come: both read ready; a decision never does.
    const later = Date.UTC(2026, 9, 16, 14, 0)
    expect(textOf(waiting, 'po', later, [waiting])).toEqual([
      'p3',
      'waiting since Tue 10-13: decision owner, on T1 ready, until Fri 10-16 14:00 UTC ready; the copy first',
    ])
    const approval = taskOf(createLine('T3', { owner: 'po', by: 'po', at: NOW - DAY }), waitingLine('T3', 'po', NOW, [{ kind: 'approval', who: 'lead' }]))
    expect(waitingWords(approval, AT_NOW.context)).toBe('approval lead')
    const until = taskOf(createLine('T4', { owner: 'po', by: 'po', at: NOW - DAY }), waitingLine('T4', 'po', NOW, [{ kind: 'time', at: '2026-10-16 14:00' }]))
    expect(waitingWords(until, IN_JERUSALEM.context)).toBe('until Fri 10-16 17:00 IDT')
    expect(metaParts(until, IN_JERUSALEM, 'po').map(part => part.text)).toEqual(['p3', 'waiting since 17:00 IDT: until Fri 10-16 17:00 IDT'])
  })

  test('a task not yet started names the tasks it comes after that are unfinished; once started, none', async () => {
    const after = { owner: 'po', by: 'po', at: NOW - DAY, source: 'po', taskKeys: { after: ['T1', 'T2'] } }
    const [one, two, three] = tasksOf(
      createLine('T1', { owner: 'po', by: 'po', at: NOW - DAY, source: 'po' }),
      createLine('T2', { owner: 'po', by: 'po', at: NOW - DAY, source: 'po' }),
      createLine('T3', after),
    )
    if (one === undefined || two === undefined || three === undefined) throw new Error('no tasks')
    expect(textOf(three, 'po', NOW, [one, two, three])).toEqual(['p3', 'after T1, T2'])
    expect(textOf(three, 'po', NOW, [two, three])).toEqual(['p3', 'after T2'])
    expect(textOf(three, 'po', NOW, [three])).toEqual(['p3'])
    const started = taskOf(createLine('T3', after), statusLine('T3', 'po', NOW, 'in-progress'))
    expect(textOf(started, 'po', NOW, [one, two, started])).toEqual(['p3', 'in progress since 14:00 UTC'])
  })

  test('verifying: verify by its due, since when and what proves it', async () => {
    const task = taskOf(
      createLine('T1', { owner: 'po', by: 'po', at: NOW - DAY, due: '2026-10-15' }),
      statusLine('T1', 'po', NOW - HOUR, 'verifying', 'one clean night'),
    )
    expect(textOf(task, 'po')).toEqual(['p3', 'verify by Thu 10-15', 'verifying since 13:00 UTC: one clean night'])
  })

  test('an open task someone else asked for is new to its owner and names who asked, then reads not picked up', async () => {
    const task = taskOf(createLine('T1', { owner: 'po', by: 'lead', at: NOW - HOUR, source: 'lead' }))
    expect(textOf(task, 'po')).toEqual(['p3', 'new', 'asked by lead'])
    expect(metaParts(task, AT_NOW, 'po')[1]?.color).toBe('suggestion')
    expect(textOf(task, 'po', NOW + 2 * DAY)).toEqual(['p3', 'not picked up 2d', 'asked by lead'])
    const own = taskOf(createLine('T1', { owner: 'po', by: 'po', at: NOW - HOUR, source: 'po' }))
    expect(textOf(own, 'po')).toEqual(['p3'])
  })

  test('a task asked of another session names its owner first; it is not new to the asker, who is not named', async () => {
    const task = taskOf(createLine('T1', { owner: 'etl', by: 'po', at: NOW - HOUR, source: 'po' }))
    expect(textOf(task, 'po')).toEqual(["etl's", 'p3'])
    expect(textOf(task, 'po', NOW + 2 * DAY)).toEqual(["etl's", 'p3', 'not picked up 2d'])
    expect(textOf(task, null)).toEqual(['p3', 'new', 'asked by po'])
  })

  test('the words alone are the all view\'s, joined as the row draws them', async () => {
    const task = taskOf(createLine('T1', { owner: 'etl', by: 'po', at: NOW - HOUR, source: 'po', due: '2026-10-13 18:00' }))
    expect(metaText(task, AT_NOW)).toBe('p3 · due today 18:00 UTC · new · asked by po')
  })
})
