import { describe, expect, test } from 'claude-code/testing'
import { readRegister } from '../hooks/core/read/index'
import { NO_TASK_COUNTS, taskCountsOf } from '../hooks/task-counts'
import { HOUR, NOW, createLine, statusLine, updateLine, verifyingLine } from './fixtures'

function countsOf(lines: readonly string[], archived = false) {
  return taskCountsOf(readRegister(lines.join('\n')).state.tasks.values(), archived)
}

describe('taskCountsOf', () => {
  test("counts each owner's done, verifying and total tasks, open, waiting and in progress ones in the total only", () => {
    const counts = countsOf([
      createLine('T1', { owner: 'api', by: 'lead', at: NOW - 5 * HOUR }),
      statusLine('T1', 'api', NOW - 4 * HOUR, 'done', 'shipped', 'abc1234', 'none'),
      createLine('T2', { owner: 'api', by: 'lead', at: NOW - 5 * HOUR }),
      verifyingLine('T2', 'api', NOW - 3 * HOUR, 'the night run'),
      createLine('T3', { owner: 'api', by: 'lead', at: NOW - 5 * HOUR }),
      statusLine('T3', 'api', NOW - 2 * HOUR, 'in-progress'),
      createLine('T4', { owner: 'api', by: 'lead', at: NOW - 5 * HOUR }),
      createLine('T5', { owner: 'web', by: 'lead', at: NOW - 5 * HOUR }),
    ])
    expect(counts).toEqual({
      bySession: { api: { done: 1, verifying: 1, total: 4 }, web: { done: 0, verifying: 0, total: 1 } },
      archived: false,
    })
  })

  test('a dropped task counts nowhere, so an owner of dropped ones only is absent', () => {
    const counts = countsOf([
      createLine('T1', { owner: 'api', by: 'lead', at: NOW - 5 * HOUR }),
      statusLine('T1', 'api', NOW - 4 * HOUR, 'dropped', 'not needed'),
      createLine('T2', { owner: 'web', by: 'lead', at: NOW - 5 * HOUR }),
      statusLine('T2', 'web', NOW - 4 * HOUR, 'dropped', 'not needed'),
      createLine('T3', { owner: 'web', by: 'lead', at: NOW - 5 * HOUR }),
    ])
    expect(counts.bySession).toEqual({ web: { done: 0, verifying: 0, total: 1 } })
  })

  test('a task moved to another owner counts for its owner now', () => {
    const counts = countsOf([
      createLine('T1', { owner: 'api', by: 'lead', at: NOW - 5 * HOUR }),
      updateLine('T1', 'lead', NOW - 4 * HOUR, { owner: 'web' }),
    ])
    expect(Object.keys(counts.bySession)).toEqual(['web'])
  })

  test('says when a compaction archived older tasks, and a register with none counts as no counts', () => {
    expect(countsOf([], true)).toEqual({ bySession: {}, archived: true })
    expect(countsOf([])).toEqual(NO_TASK_COUNTS)
  })
})
