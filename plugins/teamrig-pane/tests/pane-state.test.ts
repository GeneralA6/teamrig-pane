// What a pane starts with, before anything is read: the state every surface's store begins from.
import { describe, expect, test } from 'claude-code/testing'
import { INITIAL_STATE } from '../hooks/pane-state'

describe('pane-state', () => {
  test('a pane starts on its own tasks, open, at the list, with nothing read yet', () => {
    expect(INITIAL_STATE.view).toBe('tasks')
    expect(INITIAL_STATE.mode).toBe('mine')
    expect(INITIAL_STATE.size).toBe('open')
    expect(INITIAL_STATE.filter).toBeNull()
    expect(INITIAL_STATE.snapshot.tasks).toEqual([])
    expect(INITIAL_STATE.logList).toEqual({ kind: 'reading' })
    expect(INITIAL_STATE.teamTree).toEqual({ kind: 'reading' })
    expect(INITIAL_STATE.meetings).toEqual({ kind: 'reading' })
    expect(INITIAL_STATE.stats).toEqual({ kind: 'reading' })
    expect(INITIAL_STATE.statsScope).toEqual({ kind: 'tree' })
    expect(INITIAL_STATE.statsRange).toBe('7d')
  })
})
