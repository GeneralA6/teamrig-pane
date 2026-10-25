import { describe, expect, test } from 'claude-code/testing'
import { readEvents } from '../hooks/core/read/index'
import { workMarks } from '../hooks/work'
import { HOUR, NOW, createLine, statusLine, updateLine } from './fixtures'

/** The marks teamrig's reader finds in `lines` from `since` on. */
function marksOf(lines: readonly string[], since = 0) {
  return workMarks(readEvents(lines.join('\n')).events, since)
}

describe('workMarks', () => {
  test('a create marks nothing, not even for the session that made the task its own', () => {
    expect(marksOf([createLine('T1', { owner: 'api', by: 'api', at: NOW })])).toEqual([])
  })

  test("the owner's status changes and updates mark; another session's events on the task do not", () => {
    const lines = [
      createLine('T1', { owner: 'api', by: 'lead', at: NOW }),
      statusLine('T1', 'api', NOW + HOUR, 'in-progress'),
      statusLine('T1', 'lead', NOW + 2 * HOUR, 'waiting'),
      updateLine('T1', 'lead', NOW + 3 * HOUR, { priority: 1 }),
      updateLine('T1', 'api', NOW + 4 * HOUR, { due: '2026-10-20' }),
    ]
    expect(marksOf(lines)).toEqual([
      { session: 'api', task: 'T1', at: NOW + HOUR },
      { session: 'api', task: 'T1', at: NOW + 4 * HOUR },
    ])
  })

  test('a handoff marks for the owner who wrote it, then only the new owner marks', () => {
    const lines = [
      createLine('T1', { owner: 'api', by: 'lead', at: NOW }),
      updateLine('T1', 'api', NOW + HOUR, { owner: 'ui' }),
      statusLine('T1', 'api', NOW + 2 * HOUR, 'in-progress'),
      statusLine('T1', 'ui', NOW + 3 * HOUR, 'in-progress'),
    ]
    expect(marksOf(lines)).toEqual([
      { session: 'api', task: 'T1', at: NOW + HOUR },
      { session: 'ui', task: 'T1', at: NOW + 3 * HOUR },
    ])
  })

  test('events before `since` mark nothing; one at `since` marks', () => {
    const lines = [
      createLine('T1', { owner: 'api', by: 'lead', at: NOW }),
      statusLine('T1', 'api', NOW + HOUR, 'in-progress'),
      statusLine('T1', 'api', NOW + 2 * HOUR, 'waiting'),
    ]
    expect(marksOf(lines, NOW + 2 * HOUR)).toEqual([{ session: 'api', task: 'T1', at: NOW + 2 * HOUR }])
  })

  test('the marks come oldest first though the register keeps the events in another order', () => {
    const lines = [
      createLine('T1', { owner: 'api', by: 'lead', at: NOW }),
      createLine('T2', { owner: 'ui', by: 'lead', at: NOW }),
      statusLine('T1', 'api', NOW + 3 * HOUR, 'in-progress'),
      statusLine('T2', 'ui', NOW + HOUR, 'in-progress'),
    ]
    expect(marksOf(lines)).toEqual([
      { session: 'ui', task: 'T2', at: NOW + HOUR },
      { session: 'api', task: 'T1', at: NOW + 3 * HOUR },
    ])
  })

  test('an event on a task whose create was never read marks nothing', () => {
    expect(marksOf([statusLine('T9', 'api', NOW, 'in-progress')])).toEqual([])
  })
})
