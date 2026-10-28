// The header's rows packed in code: a Button's cells as the engine draws it, and the flex wrap's rows.
import { describe, expect, test } from 'claude-code/testing'
import { buttonCells, packGroups, packRows } from '../hooks/pack'
import { cells } from '../hooks/width'

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

describe('pack groups', () => {
  /** Packs groups of words, a `·` between two groups on a row, answering each row as its words. */
  const grouped = (groups: readonly (readonly string[])[], columns: number) => packGroups(groups, cells, columns, 1, () => '·')

  test('two groups on one row have the separator between them, the gap on each side', () => {
    expect(grouped([['mine', 'all'], ['archive']], 20)).toEqual([['mine', 'all', '·', 'archive']])
  })

  test('a group that does not fit beside the separator starts the next row, with no separator at either end', () => {
    // `mine all · archive` is 18 cells.
    expect(grouped([['mine', 'all'], ['archive']], 17)).toEqual([['mine', 'all'], ['archive']])
    expect(grouped([['mine'], ['all'], ['archive']], 10)).toEqual([['mine', '·', 'all'], ['archive']])
  })

  test("a group's own items wrap as packRows wraps them, with no separator inside a group", () => {
    expect(grouped([['aaaa', 'bbbb', 'cccc'], ['dd']], 9)).toEqual([['aaaa', 'bbbb'], ['cccc', '·', 'dd']])
  })

  test('an empty group takes no separator, and a separator is made for the group it leads', () => {
    expect(grouped([['a'], [], ['b']], 20)).toEqual([['a', '·', 'b']])
    expect(grouped([[], ['a']], 20)).toEqual([['a']])
    const made: number[] = []
    packGroups([['a'], ['b'], ['c']], cells, 20, 1, group => {
      made.push(group)
      return '·'
    })
    expect(made).toEqual([1, 2])
  })

  test('a null separator packs the groups as one run of items', () => {
    expect(packGroups([['aaa'], ['bbb'], ['ccc']], cells, 7, 1, null)).toEqual([['aaa', 'bbb'], ['ccc']])
  })
})
