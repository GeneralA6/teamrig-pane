// A row of the dedicated UI laid out in a line: its padding, its cut at the columns it has, where each stop stands
// in cells, and the ring's stop drawn inverse.
import { describe, expect, test } from 'claude-code/testing'
import { ELLIPSIS, laid, plain, spaces, type Row, type Seg, type Stop } from '../ui/row'
import { words } from '../ui/run'

function stop(key: string, hotkey: string | null = null): Stop {
  return { key, hotkey, target: { kind: 'press', press: { kind: 'keys' } } }
}

function button(key: string, label: string): Seg {
  return { runs: [words(label)], stop: stop(key) }
}

function textOf(row: Row, left: number, columns: number): string {
  return laid(row, left, columns, null)
    .runs.map(run => run.text)
    .join('')
}

describe('a row laid out in a line', () => {
  test('its segments stand left to right after the padding, each stop at its cells', () => {
    const row: Row = [button('a', '[ Tasks ]'), spaces(2), plain([words('mine')]), spaces(1), button('b', 'all')]
    const line = laid(row, 1, 40, null)
    expect(line.runs.map(run => run.text).join('')).toBe(' [ Tasks ]  mine all')
    expect(line.stops.map(({ key, from, to }) => ({ key, from, to }))).toEqual([
      { key: 'a', from: 1, to: 10 },
      { key: 'b', from: 17, to: 20 },
    ])
    expect(line.width).toBe(20)
  })

  test('a stop keeps its hotkey and what it does', () => {
    const find: Stop = { key: 'find-key', hotkey: 's', target: { kind: 'press', press: { kind: 'find' } } }
    const [found] = laid([{ runs: [words('s: Find')], stop: find }], 0, 20, null).stops
    expect(found).toEqual({ ...find, from: 0, to: 7 })
  })

  test('a wide character takes two cells', () => {
    const line = laid([plain([words('日本')]), button('a', 'ok')], 0, 10, null)
    expect(line.stops.map(({ from, to }) => [from, to])).toEqual([[4, 6]])
    expect(line.width).toBe(6)
  })

  test('no segment and no padding is an empty line', () => {
    expect(laid([], 0, 10, null)).toEqual({ runs: [], stops: [], width: 0 })
    expect(laid([spaces(0)], 0, 10, null).runs).toEqual([])
    expect(laid([], -3, 10, null).width).toBe(0)
  })

  test('a row that fits its columns exactly is not cut', () => {
    expect(textOf([plain([words('abcde')])], 2, 5)).toBe('  abcde')
  })

  test('a wider row is cut and ends in an ellipsis in its last column', () => {
    const line = laid([plain([words('a long title')]), button('a', 'open')], 1, 8, null)
    expect(line.runs.map(run => run.text).join('')).toBe(` a long ${ELLIPSIS}`)
    expect(line.width).toBe(9)
    expect(line.stops).toEqual([])
  })

  test('a stop the cut leaves a part of ends where its cells do', () => {
    const line = laid([button('a', 'Conversations')], 0, 6, null)
    expect(line.runs.map(run => run.text)).toEqual(['Conve', ELLIPSIS])
    expect(line.stops.map(({ key, from, to }) => ({ key, from, to }))).toEqual([{ key: 'a', from: 0, to: 5 }])
  })

  test('a wide character that does not fit ends the line: nothing after it fills its cell', () => {
    const line = laid([plain([words('ab日'), words('c')])], 0, 4, null)
    expect(line.runs.map(run => run.text)).toEqual(['ab', ELLIPSIS])
    expect(line.width).toBe(3)
  })

  test('no column draws nothing but the padding', () => {
    expect(laid([button('a', 'open')], 1, 0, null)).toEqual({ runs: [words(' ')], stops: [], width: 1 })
  })

  test("the ring's stop is drawn inverse, every run of it, and no other", () => {
    const row: Row = [{ runs: [words('T12'), words(' Ship')], stop: stop('task-12') }, spaces(1), button('b', 'all'), plain([words('!')])]
    const line = laid(row, 0, 40, 'task-12')
    expect(line.runs.map(run => [run.text, run.inverse])).toEqual([
      ['T12', true],
      [' Ship', true],
      [' ', false],
      ['all', false],
      ['!', false],
    ])
    expect(laid(row, 0, 40, null).runs.some(run => run.inverse)).toBe(false)
  })

  test('a run drawn inverse already stays so off the ring', () => {
    const cursor = { ...words(' '), inverse: true }
    expect(laid([plain([cursor])], 0, 5, 'other').runs).toEqual([cursor])
  })
})
