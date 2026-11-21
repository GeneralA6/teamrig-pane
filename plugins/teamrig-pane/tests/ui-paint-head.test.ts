// The head of the dedicated UI as rows: each part drawn in the cells the view model counts for it, its presses
// stops under the dock's keys, and as many rows a part as headRows gives it.
import { describe, expect, test } from 'claude-code/testing'
import { headRows, itemCells, type FindRow, type Head, type HeadItem, type HeadPart } from '../hooks/head'
import { drawnText, type BarPiece } from '../hooks/status-bar'
import { cells } from '../hooks/width'
import { FIND_CLEAR_KEY, FIND_KEY, fieldRuns, headRowsOf, type Typing } from '../ui/paint-head'
import type { Row, Seg } from '../ui/row'

function headOf(...parts: HeadPart[]): Head {
  return { strip: false, parts }
}

function textOf(seg: Seg): string {
  return seg.runs.map(run => run.text).join('')
}

function lineOf(row: Row): string {
  return row.map(textOf).join('')
}

function linesOf(head: Head, typing: Typing | null = null): string[] {
  return headRowsOf(head, typing).map(lineOf)
}

function stopKeys(row: Row): string[] {
  return row.flatMap(seg => (seg.stop === null ? [] : [seg.stop.key]))
}

function only(rows: readonly Row[]): Row {
  const [row] = rows
  if (row === undefined || rows.length !== 1) throw new Error(`expected one row, got ${rows.length}`)
  return row
}

function segOf(row: Row, key: string): Seg {
  const seg = row.find(found => found.stop !== null && found.stop.key === key)
  if (seg === undefined) throw new Error(`no stop keyed ${key}`)
  return seg
}

const tasks: HeadItem = { kind: 'button', key: 'view:tasks', label: 'Tasks', hotkey: 't', look: 'primary', press: { kind: 'keys' } }
const inbox: HeadItem = { kind: 'button', key: 'view:inbox', label: 'Inbox', hotkey: 'i', look: 'secondary', press: { kind: 'back' } }
const keys: HeadItem = { kind: 'button', key: 'keys', label: 'Keys', hotkey: '?', look: 'plain', press: { kind: 'keys' } }
const bare: HeadItem = { kind: 'button', key: 'bare', label: 'all', hotkey: null, look: 'plain', press: { kind: 'forward' } }
const crumb: HeadItem = { kind: 'crumb', key: 'crumb:0', label: 'T12', isAhead: false, press: { kind: 'crumb', index: 0 } }
const ahead: HeadItem = { kind: 'crumb', key: 'crumb:1', label: 'T13', isAhead: true, press: { kind: 'crumb', index: 1 } }
const boldWords: HeadItem = { kind: 'words', key: 'title', text: 'teamrig', tone: 'bold', cut: false }
const dimWords: HeadItem = { kind: 'words', key: 'hint', text: 'mine', tone: 'dim', cut: true }

function find(over: Partial<FindRow> = {}): FindRow {
  return { key: 'find', placeholder: 'words, a task id', text: '', submitLabel: 'search', submits: null, clears: false, ...over }
}

function bar(over: Partial<BarPiece> & { text: string; key: string }): BarPiece {
  return { status: null, hotkey: null, mark: null, ...over }
}

describe('the head as rows', () => {
  test('a blank row stands between two parts, none inside a group, and a part takes the rows headRows counts', () => {
    const group: HeadPart = {
      kind: 'group',
      key: 'find-block',
      pieces: [
        { kind: 'find', find: find() },
        { kind: 'keys', at: 'pane', lines: ['keys go to the pane', 'Esc gives them back'] },
      ],
    }
    const parts: HeadPart[] = [{ kind: 'item', item: boldWords }, group, { kind: 'rule', cells: 4 }]
    expect(linesOf(headOf(...parts))).toEqual([
      'teamrig',
      '',
      's: Find words, a task id',
      'keys go to the pane',
      'Esc gives them back',
      '',
      '────',
    ])
    for (const part of parts) expect(headRowsOf(headOf(part), null).length).toBe(headRows(part))
  })

  test('a head of no part is no row, and the minimized strip is its one part', () => {
    expect(headRowsOf(headOf(), null)).toEqual([])
    const strip: Head = { strip: true, parts: [{ kind: 'row', gap: 1, items: [tasks, inbox] }] }
    expect(linesOf(strip)).toEqual(['[ Tasks ] [ Inbox ]'])
  })

  test('an item is drawn in the cells itemCells counts for it', () => {
    for (const item of [tasks, inbox, keys, bare, crumb, ahead, boldWords, dimWords]) {
      const row = only(headRowsOf(headOf({ kind: 'item', item }), null))
      expect(cells(lineOf(row))).toBe(itemCells(item))
    }
  })

  test('a framed button hides its key and the one that is on is bold in the accent; a plain one shows its key', () => {
    const row = only(headRowsOf(headOf({ kind: 'row', gap: 2, items: [tasks, inbox, keys, bare] }), null))
    expect(lineOf(row)).toBe('[ Tasks ]  [ Inbox ]  ?: Keys  all')
    expect(stopKeys(row)).toEqual(['view:tasks', 'view:inbox', 'keys', 'bare'])
    expect(segOf(row, 'view:tasks').runs).toMatchObject([{ bold: true, tone: 'accent' }])
    expect(segOf(row, 'view:inbox').runs).toMatchObject([{ bold: false, tone: null }])
    expect(segOf(row, 'view:tasks').stop).toEqual({ key: 'view:tasks', hotkey: 't', target: { kind: 'press', press: { kind: 'keys' } } })
    expect(segOf(row, 'bare').stop).toMatchObject({ hotkey: null, target: { kind: 'press', press: { kind: 'forward' } } })
  })

  test('a crumb is an underlined stop, dim when it lies ahead; words are no stop, bold or dim', () => {
    const row = only(headRowsOf(headOf({ kind: 'row', gap: 1, items: [crumb, ahead, boldWords, dimWords] }), null))
    expect(lineOf(row)).toBe('T12 T13 teamrig mine')
    expect(stopKeys(row)).toEqual(['crumb:0', 'crumb:1'])
    expect(segOf(row, 'crumb:0').runs).toMatchObject([{ underline: true, dim: false }])
    expect(segOf(row, 'crumb:1').runs).toMatchObject([{ underline: true, dim: true }])
    expect(segOf(row, 'crumb:1').stop).toMatchObject({ target: { kind: 'press', press: { kind: 'crumb', index: 1 } } })
    const [, , , , title, , hint] = row
    expect(title?.runs).toMatchObject([{ text: 'teamrig', bold: true, dim: false }])
    expect(hint?.runs).toMatchObject([{ text: 'mine', bold: false, dim: true }])
  })

  test('packed items take a row each of their rows, the gap between two on a row', () => {
    const part: HeadPart = { kind: 'packed', key: 'views', gap: 3, rows: [[tasks, inbox], [keys]] }
    expect(linesOf(headOf(part))).toEqual(['[ Tasks ]   [ Inbox ]', '?: Keys'])
  })

  test('a line of text is its spans in their styles, a line end in it no second row', () => {
    const part: HeadPart = { kind: 'text', key: 'title', spans: [{ text: 'team\nrig', bold: true }, { text: ' 3 tasks', color: 'subtle' }] }
    const row = only(headRowsOf(headOf(part), null))
    expect(lineOf(row)).toBe('teamrig 3 tasks')
    expect(stopKeys(row)).toEqual([])
    expect(row[0]?.runs).toMatchObject([{ bold: true, tone: null }, { bold: false, tone: 'subtle' }])
  })
})

describe('the Find row', () => {
  test('its key and its field are stops that move the ring into the field, the placeholder dim', () => {
    const row = only(headRowsOf(headOf({ kind: 'find', find: find() }), null))
    expect(lineOf(row)).toBe('s: Find words, a task id')
    expect(stopKeys(row)).toEqual([FIND_KEY, 'find'])
    expect(segOf(row, FIND_KEY).stop).toEqual({ key: FIND_KEY, hotkey: 's', target: { kind: 'press', press: { kind: 'find' } } })
    expect(segOf(row, 'find').stop).toEqual({ key: 'find', hotkey: null, target: { kind: 'press', press: { kind: 'find' } } })
    expect(segOf(row, 'find').runs).toMatchObject([{ text: 'words, a task id', dim: true }])
  })

  test('a search shown is the field’s text, with clear after it', () => {
    const row = only(headRowsOf(headOf({ kind: 'find', find: find({ key: 'find:2', text: 'budget', clears: true }) }), null))
    expect(lineOf(row)).toBe('s: Find budget [ clear ]')
    expect(stopKeys(row)).toEqual([FIND_KEY, 'find:2', FIND_CLEAR_KEY])
    expect(segOf(row, 'find:2').runs).toMatchObject([{ text: 'budget', dim: false }])
    expect(segOf(row, FIND_CLEAR_KEY).stop).toMatchObject({ hotkey: null, target: { kind: 'press', press: { kind: 'find-clear' } } })
  })

  test('the field the app types in shows what is typed and the cursor’s cell, another field its own text', () => {
    const head = headOf({ kind: 'find', find: find({ text: 'budget' }) })
    const typed = segOf(only(headRowsOf(head, { key: 'find', text: 'bud' })), 'find')
    expect(typed.runs).toMatchObject([
      { text: 'bud', inverse: false },
      { text: ' ', inverse: true },
    ])
    const other = segOf(only(headRowsOf(head, { key: 'note:T1:0', text: 'hello' })), 'find')
    expect(textOf(other)).toBe('budget')
  })

  test('a field typed empty is its cursor alone, not its placeholder', () => {
    expect(fieldRuns('', 'words', '')).toMatchObject([{ text: '' }, { text: ' ', inverse: true }])
    expect(fieldRuns('', 'words', null)).toMatchObject([{ text: 'words', dim: true }])
    expect(fieldRuns('kept', 'words', null)).toMatchObject([{ text: 'kept', dim: false }])
  })
})

describe('the keys line, the rule and the status bar', () => {
  test('the keys line is bold while typing searches, else dim', () => {
    const searching = only(headRowsOf(headOf({ kind: 'keys', at: 'search', lines: ['typing searches'] }), null))
    expect(searching[0]?.runs).toMatchObject([{ text: 'typing searches', bold: true, dim: false }])
    const held = only(headRowsOf(headOf({ kind: 'keys', at: 'away', lines: ['keys are elsewhere'] }), null))
    expect(held[0]?.runs).toMatchObject([{ text: 'keys are elsewhere', bold: false, dim: true }])
  })

  test('a rule is dim, its cells the part’s, none when it has none', () => {
    const row = only(headRowsOf(headOf({ kind: 'rule', cells: 6 }), null))
    expect(row[0]?.runs).toMatchObject([{ text: '──────', dim: true }])
    expect(linesOf(headOf({ kind: 'rule', cells: -1 }))).toEqual([''])
  })

  test('a count is a stop behind its key, its mark in the mark’s own style; words between are no stop', () => {
    const done = bar({ key: 'bar:done-today', text: '2 done today', status: 'done-today', hotkey: 'o', mark: { text: '✓', color: 'success' } })
    const separator = bar({ key: 'bar:sep', text: ' · ', dim: true })
    const working = bar({ key: 'bar:working', text: '1 working', status: 'working', color: 'warning' })
    const hint = bar({ key: 'bar:hint', text: 'click a count to show only those', dim: true })
    const rows = headRowsOf(headOf({ kind: 'bar', lines: [[done, separator, working], [hint]] }), null)
    expect(rows.map(lineOf)).toEqual(['o: ✓ 2 done today · 1 working', 'click a count to show only those'])
    const [counts, hints] = rows
    if (counts === undefined || hints === undefined) throw new Error('the bar has two lines')
    expect(stopKeys(counts)).toEqual(['bar:done-today', 'bar:working'])
    expect(stopKeys(hints)).toEqual([])
    expect(textOf(segOf(counts, 'bar:done-today'))).toBe(drawnText(done))
    expect(segOf(counts, 'bar:done-today').stop).toEqual({
      key: 'bar:done-today',
      hotkey: 'o',
      target: { kind: 'press', press: { kind: 'filter', status: 'done-today' } },
    })
    expect(segOf(counts, 'bar:done-today').runs).toMatchObject([
      { text: 'o: ', tone: null },
      { text: '✓', tone: 'success' },
      { text: ' ', tone: null },
      { text: '2 done today' },
    ])
    expect(segOf(counts, 'bar:working').runs).toMatchObject([{ text: '1 working', tone: 'warning' }])
    expect(segOf(counts, 'bar:working').stop).toMatchObject({ hotkey: null })
  })
})
