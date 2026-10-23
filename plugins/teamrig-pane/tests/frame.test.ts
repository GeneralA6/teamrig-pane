// The docked body's rows, counted as dockLayout wrapped it.
import { describe, expect, test } from 'claude-code/testing'
import { rowsOf } from '../hooks/frame'
import type { Drawn } from '../hooks/layout'

/** A body element of `lines` lines, keyed `key`. */
function element(key: string, lines: number): Drawn {
  return { key, spans: [{ text: Array.from({ length: lines }, (_, i) => `${key} line ${i}`).join('\n') }], wrap: 'wrap', toggle: key }
}

describe('rowsOf', () => {
  test('counts an element its lines and its open card its parts, a line with a task id one row, a press row its lines', () => {
    expect(rowsOf(element('a', 1))).toBe(1)
    expect(rowsOf({ ...element('a', 2), spans: [{ text: 'one\n' }, { text: 'two\nthree' }] })).toBe(3)
    const card: Drawn['card'] = [
      { kind: 'text', key: 'c0', spans: [{ text: 'a\nb' }] },
      { kind: 'line', key: 'c1', pieces: [{ kind: 'id', task: 'T2', span: { text: 'T2' } }] },
    ]
    expect(rowsOf({ ...element('a', 2), card })).toBe(5)
    const pressed: Drawn['card'] = [{ kind: 'press', key: 'C:/r:a.ts', spans: [{ text: ' M a-long\n' }, { text: '   name.ts' }], expands: 'C:/r:a.ts' }]
    expect(rowsOf({ ...element('a', 1), card: pressed })).toBe(3)
  })
})
