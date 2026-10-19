import { describe, expect, test } from 'claude-code/testing'
import type { Drawn } from '../hooks/layout'
import { rowsOf, windowed, type BodyWindow, type Slot } from '../hooks/window'

/** A body element of `lines` lines, keyed `key`. */
function element(key: string, lines: number): Drawn {
  return { key, spans: [{ text: Array.from({ length: lines }, (_, i) => `${key} line ${i}`).join('\n') }], wrap: 'wrap', toggle: key }
}

/** `count` elements of `lines` lines each, keyed e0, e1, … */
function body(count: number, lines: number): Drawn[] {
  return Array.from({ length: count }, (_, i) => element(`e${i}`, lines))
}

const NO_ANCHOR = () => false

/** A window at `offset` showing `bodyRows` rows, the root's gap one row. */
function at(offset: number, bodyRows: number, isAnchor: BodyWindow['isAnchor'] = NO_ANCHOR): BodyWindow {
  return { offset, bodyRows, gap: 1, isAnchor }
}

/** The tree's rows as the slots draw it: each slot's rows and a gap between each two. */
function treeRows(slots: readonly Slot[]): number {
  return slots.reduce((rows, slot) => rows + (slot.kind === 'drawn' ? rowsOf(slot.drawn) : slot.rows), 0) + Math.max(0, slots.length - 1)
}

function drawnKeys(slots: readonly Slot[]): string[] {
  return slots.flatMap(slot => (slot.kind === 'drawn' ? [slot.drawn.key] : []))
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

describe('windowed', () => {
  test('draws a body that fits around the window whole, with no spacer', () => {
    const slots = windowed(body(5, 4), at(0, 40))
    expect(drawnKeys(slots)).toEqual(['e0', 'e1', 'e2', 'e3', 'e4'])
    expect(slots.some(slot => slot.kind === 'spacer')).toBe(false)
  })

  test('draws the elements within two screenfuls of the window and keeps the rest as one spacer of their rows and gaps', () => {
    const all = body(2_000, 4)
    const slots = windowed(all, at(0, 40))
    // Each element is 4 rows and a gap: rows 0 to 80 meet elements e0 to e15.
    expect(drawnKeys(slots)).toEqual(Array.from({ length: 16 }, (_, i) => `e${i}`))
    expect(slots.at(-1)).toEqual({ kind: 'spacer', key: 'skip:e16', rows: 1_984 * 4 + 1_983 })
    expect(treeRows(slots)).toBe(treeRows(all.map(drawn => ({ kind: 'drawn', drawn }))))
  })

  test('scrolled to the middle, draws the elements around it between two spacers, the tree as tall as drawn whole', () => {
    const all = body(2_000, 4)
    const slots = windowed(all, at(5_000, 40))
    const keys = drawnKeys(slots)
    expect(keys[0]).toBe('e984')
    expect(keys.at(-1)).toBe('e1015')
    expect(slots[0]).toEqual({ kind: 'spacer', key: 'skip:e0', rows: 984 * 4 + 983 })
    expect(slots.at(-1)?.kind).toBe('spacer')
    expect(treeRows(slots)).toBe(2_000 * 4 + 1_999)
  })

  test('draws an anchored element far from the window with a screenful around it, so the keys and a scroll find it', () => {
    const slots = windowed(body(2_000, 4), at(0, 10, drawn => drawn.key === 'e1500'))
    const keys = drawnKeys(slots)
    expect(keys).toContain('e1500')
    expect(keys).toContain('e1498')
    expect(keys).toContain('e1502')
    expect(keys).not.toContain('e1497')
    expect(keys).not.toContain('e1504')
    expect(slots.filter(slot => slot.kind === 'spacer')).toHaveLength(2)
    expect(treeRows(slots)).toBe(2_000 * 4 + 1_999)
  })

  test('draws nothing for an empty body', () => {
    expect(windowed([], at(0, 40))).toEqual([])
  })
})
