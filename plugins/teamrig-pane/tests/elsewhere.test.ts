import { describe, expect, test } from 'claude-code/testing'
import type { Snapshot, TaskElsewhere, TaskRow } from '../types'
import { readRegister, type Task } from '../hooks/core/read/index'
import { neededElsewhere, NO_ELSEWHERE, type ElsewhereSource, type TasksElsewhere } from '../hooks/elsewhere'
import { rowOf } from '../hooks/log'
import { listedTasks, metaText } from '../hooks/meta'
import { NO_SPEND } from '../hooks/ranking'
import { TaskRegisterSource, type RegisterPaths } from '../hooks/source'
import { areaView, sameView } from '../hooks/view'
import { HOUR, MemoryFiles, NOW, NO_TEAM, NO_TREE_GOALS, S1, SNAPSHOT_SETTINGS, TEAM_SETTINGS, createLine, statusLine, treeAt, waitingLine } from './fixtures'

/** The tasks teamrig's reader folds from event lines. */
function tasksOf(lines: readonly string[]): Task[] {
  return [...readRegister(lines.join('\n')).state.tasks.values()]
}

/** The rows the pane draws of those tasks. */
function rowsOf(lines: readonly string[]): TaskRow[] {
  return tasksOf(lines).map(task => rowOf(task))
}

/** Another team's register, each task under its id with that team, as the tree's registers hold them. */
function heldBy(team: string, lines: readonly string[]): TasksElsewhere {
  return new Map(tasksOf(lines).map(task => [task.id, { team, task }]))
}

const ids = (tasks: readonly TaskElsewhere[]) => tasks.map(({ team, task }) => `${team}:${task.id}`)
const NONE_OWN: ReadonlySet<string> = new Set()
const AT = NOW - HOUR

describe('neededElsewhere', () => {
  test('keeps the tasks of another team that an own task is planned after or waits on, whatever their status', () => {
    const own = rowsOf([
      createLine('T1', { owner: 'api', by: 'lead', at: AT, taskKeys: { after: ['T20'] } }),
      createLine('T2', { owner: 'api', by: 'lead', at: AT }),
      waitingLine('T2', 'api', AT, [{ kind: 'task', id: 'T21' }]),
    ])
    const peer = heldBy('web', [
      createLine('T20', { owner: 'ui', by: 'lead', at: AT }),
      statusLine('T20', 'ui', AT, 'done'),
      createLine('T21', { owner: 'ui', by: 'lead', at: AT }),
      createLine('T22', { owner: 'ui', by: 'lead', at: AT }),
    ])
    expect(ids(neededElsewhere(own, NONE_OWN, peer))).toEqual(['web:T20', 'web:T21'])
  })

  test('keeps an active task of another team that needs an own task, and leaves out a finished one', () => {
    const own = rowsOf([createLine('T1', { owner: 'api', by: 'lead', at: AT })])
    const peer = heldBy('web', [
      createLine('T20', { owner: 'ui', by: 'lead', at: AT, taskKeys: { after: ['T1'] } }),
      createLine('T21', { owner: 'ui', by: 'lead', at: AT }),
      waitingLine('T21', 'ui', AT, [{ kind: 'task', id: 'T1' }]),
      createLine('T22', { owner: 'ui', by: 'lead', at: AT, taskKeys: { after: ['T1'] } }),
      statusLine('T22', 'ui', AT, 'dropped'),
    ])
    expect(ids(neededElsewhere(own, NONE_OWN, peer))).toEqual(['web:T20', 'web:T21'])
  })

  test('leaves out a task of another team under an id the own register holds, though the snapshot left it out', () => {
    const own = rowsOf([createLine('T1', { owner: 'api', by: 'lead', at: AT, taskKeys: { after: ['T5'] } })])
    const peer = heldBy('web', [createLine('T5', { owner: 'ui', by: 'lead', at: AT })])
    expect(neededElsewhere(own, new Set(['T1', 'T5']), peer)).toEqual([])
  })

  test('orders the tasks it keeps by number across teams, as one numbering runs across the tree', () => {
    const own = rowsOf([createLine('T1', { owner: 'api', by: 'lead', at: AT, taskKeys: { after: ['T100', 'T9', 'T30'] } })])
    const peers: TasksElsewhere = new Map([
      ...heldBy('web', [createLine('T100', { owner: 'ui', by: 'lead', at: AT }), createLine('T9', { owner: 'ui', by: 'lead', at: AT })]),
      ...heldBy('ops', [createLine('T30', { owner: 'db', by: 'lead', at: AT })]),
    ])
    expect(ids(neededElsewhere(own, NONE_OWN, peers))).toEqual(['web:T9', 'ops:T30', 'web:T100'])
  })

  test('keeps nothing when no own task touches another team', () => {
    const own = rowsOf([createLine('T1', { owner: 'api', by: 'lead', at: AT })])
    const peer = heldBy('web', [createLine('T20', { owner: 'ui', by: 'lead', at: AT, taskKeys: { after: ['T2'] } })])
    expect(neededElsewhere(own, NONE_OWN, peer)).toEqual([])
  })
})

const PATHS: RegisterPaths = { events: 'R/tasks/events.jsonl', marks: 'R/tasks/inbox-marks.jsonl', goals: 'R/tasks/goals.jsonl', inboxDir: 'R/inbox', tasksWeek: 'R/tasks/usage/tasks.week.json' }

/** The tree's other registers as a test sets them: a refresh says they moved once after each `set`. */
class SetElsewhere implements ElsewhereSource {
  current: TasksElsewhere = new Map()
  problem: string | null = null
  private moved = false

  set(current: TasksElsewhere, problem: string | null = null): void {
    this.current = current
    this.problem = problem
    this.moved = true
  }

  async refresh(): Promise<boolean> {
    const moved = this.moved
    this.moved = false
    return moved
  }
}

/** A register source over `own` event lines, reading the tree's other registers from `elsewhere`. */
function sourceOver(own: readonly string[], elsewhere: ElsewhereSource): { files: MemoryFiles; source: TaskRegisterSource } {
  const files = new MemoryFiles()
  files.write(PATHS.events, own.join('\n'))
  return { files, source: new TaskRegisterSource(files, PATHS, TEAM_SETTINGS, null, NO_TREE_GOALS, elsewhere) }
}

const poll = (source: TaskRegisterSource) => source.poll({ claudeSession: S1, pinned: null, now: NOW })
const OWN_AFTER_T20 = createLine('T1', { owner: 'api', by: 'lead', at: AT, taskKeys: { after: ['T20'] } })
const T20 = createLine('T20', { owner: 'ui', by: 'lead', at: AT })
const T22 = createLine('T22', { owner: 'ui', by: 'lead', at: AT })

describe("TaskRegisterSource with the tree's other registers", () => {
  test('a snapshot holds the tasks of another register its tasks are judged by, and no other', async () => {
    const elsewhere = new SetElsewhere()
    elsewhere.set(heldBy('web', [T20, T22]))
    const snap = await poll(sourceOver([OWN_AFTER_T20], elsewhere).source)
    expect(ids(snap?.elsewhere ?? [])).toEqual(['web:T20'])
  })

  test('a move of a task an own task needs makes a new snapshot; one of a task no own task touches makes none', async () => {
    const elsewhere = new SetElsewhere()
    elsewhere.set(heldBy('web', [T20, T22]))
    const { source } = sourceOver([OWN_AFTER_T20], elsewhere)
    await poll(source)
    elsewhere.set(heldBy('web', [T20, T22, statusLine('T22', 'ui', NOW, 'done')]))
    expect(await poll(source)).toBe(null)
    elsewhere.set(heldBy('web', [T20, statusLine('T20', 'ui', NOW, 'done'), T22]))
    const moved = await poll(source)
    expect(moved?.elsewhere.map(({ task }) => task.status)).toEqual(['done'])
  })

  test('picks again when an own task comes to need a task of another register, though that register did not move', async () => {
    const elsewhere = new SetElsewhere()
    elsewhere.set(heldBy('web', [T20, T22]))
    const { files, source } = sourceOver([OWN_AFTER_T20], elsewhere)
    await poll(source)
    files.write(PATHS.events, [OWN_AFTER_T20, createLine('T2', { owner: 'api', by: 'lead', at: NOW, taskKeys: { after: ['T22'] } })].join('\n'))
    expect(ids((await poll(source))?.elsewhere ?? [])).toEqual(['web:T20', 'web:T22'])
  })

  test("names the registers it could not read after the lines teamrig's reader skipped, and drops the name once read", async () => {
    const elsewhere = new SetElsewhere()
    elsewhere.set(heldBy('web', [T20]), "web's register: locked")
    const { source } = sourceOver([OWN_AFTER_T20, '{damaged'], elsewhere)
    expect((await poll(source))?.problem).toBe("events.jsonl: 1 unreadable line(s), 0 line(s) from a newer teamrig, 0 event(s) naming no task; web's register: locked")
    elsewhere.set(heldBy('web', [T20]))
    expect((await poll(source))?.problem).toBe('events.jsonl: 1 unreadable line(s), 0 line(s) from a newer teamrig, 0 event(s) naming no task')
  })
})

const DAY = 24 * HOUR

/** The tasks of another team's register a snapshot carries, as the source picks them (neededElsewhere). */
const awayOf = (team: string, lines: readonly string[]): TaskElsewhere[] => [...heldBy(team, lines).values()]

function rowIn(rows: readonly TaskRow[], id: string): TaskRow {
  const row = rows.find(task => task.id === id)
  if (row === undefined) throw new Error(`no ${id} in the rows`)
  return row
}

describe("the plan order, the park rule and the redraw with the tree's other registers", () => {
  const own = rowsOf([OWN_AFTER_T20, createLine('T2', { owner: 'api', by: 'lead', at: AT })])
  const treeWith = (rows: readonly TaskRow[], elsewhere: readonly TaskElsewhere[]) => treeAt(rows, NOW, undefined, undefined, null, {}, NO_SPEND, elsewhere)
  const upNext = (elsewhere: readonly TaskElsewhere[]) => areaView(own, 'api', treeWith(own, elsewhere)).upNext.map(task => task.id)

  test("an own task after another team's open task waits behind the own ones that can move, as `teamrig list` orders it", () => {
    const open = awayOf('web', [T20])
    expect(upNext(open)).toEqual(['T2', 'T1'])
    expect(metaText(rowIn(own, 'T1'), treeWith(own, open))).toContain('after T20')
  })

  test("once another team's task is done, or with no register holding it, the own task after it moves as any other", () => {
    const done = awayOf('web', [T20, statusLine('T20', 'ui', AT, 'done')])
    expect(upNext(done)).toEqual(['T1', 'T2'])
    expect(metaText(rowIn(own, 'T1'), treeWith(own, done))).not.toContain('after T20')
    expect(upNext([])).toEqual(['T1', 'T2'])
  })

  test("an own task another team's active task needs stays listed, though the park rule takes it out otherwise", () => {
    const quiet = rowsOf([createLine('T1', { owner: 'po', by: 'lead', at: NOW - 15 * DAY, source: 'lead', taskKeys: { workClass: 'Improvements' } })])
    const listed = (elsewhere: readonly TaskElsewhere[]) => listedTasks(quiet, treeWith(quiet, elsewhere)).map(task => task.id)
    expect(listed([])).toEqual([])
    expect(listed(awayOf('web', [createLine('T20', { owner: 'ui', by: 'lead', at: AT, taskKeys: { after: ['T1'] } })]))).toEqual(['T1'])
  })

  test('two snapshots draw differently when only the tasks of the other registers differ', () => {
    const base: Snapshot = { tasks: own, area: 'api', areaSource: 'pinned', unreadInbox: 0, inbox: [], problem: null, ...NO_TEAM, ...SNAPSHOT_SETTINGS, now: NOW }
    expect(sameView(base, { ...base, elsewhere: awayOf('web', [T20]) })).toBe(false)
    expect(sameView({ ...base, elsewhere: awayOf('web', [T20]) }, { ...base, elsewhere: awayOf('web', [T20]) })).toBe(true)
  })
})

describe('NO_ELSEWHERE', () => {
  test('holds nothing, names no problem and never moves', async () => {
    expect(await NO_ELSEWHERE.refresh()).toBe(false)
    expect([...NO_ELSEWHERE.current]).toEqual([])
    expect(NO_ELSEWHERE.problem).toBe(null)
  })
})
