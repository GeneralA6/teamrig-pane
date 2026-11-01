// What the pane draws while the owner types a Note (hooks/note-hold.ts): the snapshot as it stood when the field
// opened, the newest again once it closes, and the newest one at each new opening.
import { describe, expect, test } from 'claude-code/testing'
import type { OwnerAct } from '../types'
import { NoteHold } from '../hooks/note-hold'

const noting = (round: number): OwnerAct => ({ kind: 'noting', task: 'T1', round })

describe('note hold', () => {
  test('with no Note field open, the newest value draws', async () => {
    const hold = new NoteHold<string>()
    expect(hold.drawn('a', null)).toBe('a')
    expect(hold.drawn('b', { kind: 'previewing', task: 'T1' })).toBe('b')
    expect(hold.drawn('c', { kind: 'confirming', task: 'T1', lines: [] })).toBe('c')
  })

  test('while the field is open, the value of its opening draws; once it closes, the newest again', async () => {
    const hold = new NoteHold<string>()
    expect(hold.drawn('at opening', noting(1))).toBe('at opening')
    expect(hold.drawn('a task added', noting(1))).toBe('at opening')
    expect(hold.drawn('sent', { kind: 'sending', task: 'T1', act: 'note' })).toBe('sent')
    expect(hold.drawn('told', { kind: 'told', task: 'T1', act: 'note', outcome: 'done', lines: [] })).toBe('told')
  })

  test('a new opening takes the newest value, whether or not the last field closed in between', async () => {
    const hold = new NoteHold<string>()
    hold.drawn('first', noting(1))
    expect(hold.drawn('second', noting(2))).toBe('second')
    expect(hold.drawn('later', noting(2))).toBe('second')
    hold.drawn('closed', null)
    expect(hold.drawn('third', noting(3))).toBe('third')
  })
})
