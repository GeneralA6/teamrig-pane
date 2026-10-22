// The header's rows packed in code: a Button's cells as the engine draws it, and the flex wrap's rows.
import { describe, expect, test } from 'claude-code/testing'
import { buttonCells, packRows } from '../hooks/pack'

/** Packs plain widths, answering each row as its widths. */
function packed(widths: readonly number[], columns: number, gap: number): number[][] {
  return packRows(widths, width => width, columns, gap)
}

describe('pack', () => {
  test('a Button is its label in brackets, its hotkey not drawn', () => {
    expect(buttonCells({ label: 'Tasks', plain: false, hotkey: 't' })).toBe(9)
    expect(buttonCells({ label: 'Tasks', plain: false, hotkey: null })).toBe(9)
  })

  test('a plain Button is its text, after its key and a colon when it has one', () => {
    expect(buttonCells({ label: '2 done today', plain: true, hotkey: 'o' })).toBe(15)
    expect(buttonCells({ label: '2 done today', plain: true, hotkey: null })).toBe(12)
  })

  test('a label is counted in cells, a wide character as two', () => {
    expect(buttonCells({ label: '← back', plain: false, hotkey: 'b' })).toBe(10)
    expect(buttonCells({ label: '日本', plain: true, hotkey: null })).toBe(4)
  })

  test('items share a row while they fit with the gap between them', () => {
    expect(packed([3, 3, 3], 11, 1)).toEqual([[3, 3, 3]])
    expect(packed([3, 3, 3], 10, 1)).toEqual([[3, 3], [3]])
    expect(packed([4, 4, 4], 10, 2)).toEqual([[4, 4], [4]])
  })

  test('an item wider than the row takes one to itself, the next starting a new row', () => {
    expect(packed([2, 20, 2], 10, 1)).toEqual([[2], [20], [2]])
    expect(packed([20], 10, 1)).toEqual([[20]])
  })

  test('nothing packs to no rows, and a width under one cell packs one item a row', () => {
    expect(packed([], 10, 1)).toEqual([])
    expect(packed([1, 1], 0, 0)).toEqual([[1], [1]])
  })

  test('items keep their order and identity, measured by widthOf', () => {
    const buttons = [
      { key: 'tasks', label: 'Tasks', plain: false, hotkey: 't' },
      { key: 'changes', label: 'Changes', plain: false, hotkey: 'd' },
      { key: 'log', label: 'Log', plain: false, hotkey: 'g' },
    ]
    const rows = packRows(buttons, buttonCells, 22, 1)
    expect(rows.map(row => row.map(button => button.key))).toEqual([['tasks', 'changes'], ['log']])
    expect(rows[0]?.[0]).toBe(buttons[0])
  })
})
