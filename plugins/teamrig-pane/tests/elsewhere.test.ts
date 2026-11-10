import { describe, expect, test } from 'claude-code/testing'
import type { TaskElsewhere, TaskRow } from '../types'
import { readRegister, type Task } from '../hooks/core/read/index'
import { neededElsewhere, NO_ELSEWHERE, type TasksElsewhere } from '../hooks/elsewhere'
import { rowOf } from '../hooks/log'
import { HOUR, NOW, createLine, statusLine, waitingLine } from './fixtures'

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

describe('NO_ELSEWHERE', () => {
  test('holds nothing, names no problem and never moves', async () => {
    expect(await NO_ELSEWHERE.refresh()).toBe(false)
    expect([...NO_ELSEWHERE.current]).toEqual([])
    expect(NO_ELSEWHERE.problem).toBe(null)
  })
})
