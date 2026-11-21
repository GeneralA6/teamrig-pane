// A slot of the body's window as rows: an element's head and open card drawn as the dock draws them, each press a
// stop under the key press-keys.ts gives it, in the rows frame.ts counts.
import { describe, expect, test } from 'claude-code/testing'
import { frameOf, placesOf, rowsOf, viewOf, type FrameSlot } from '../hooks/frame'
import type { CardPart, Drawn } from '../hooks/layout'
import { diffKey, noteKey, openKey, pieceKey, pressesOf } from '../hooks/press-keys'
import { linesOf, notePlaceholder, slotRows } from '../ui/paint-body'
import type { Row, Seg } from '../ui/row'

function slot(drawn: Drawn, head = true): FrameSlot {
  return { kind: 'drawn', drawn, head }
}

function textOf(seg: Seg): string {
  return seg.runs.map(run => run.text).join('')
}

function lineOf(row: Row): string {
  return row.map(textOf).join('')
}

function stopKeys(rows: readonly Row[]): string[] {
  return rows.flatMap(row => row.flatMap(seg => (seg.stop === null ? [] : [seg.stop.key])))
}

function segOf(rows: readonly Row[], key: string): Seg {
  const seg = rows.flat().find(found => found.stop !== null && found.stop.key === key)
  if (seg === undefined) throw new Error(`no stop keyed ${key}`)
  return seg
}

const idPiece = { kind: 'id', span: { text: 'T7', color: 'suggestion' }, task: 'T7' } as const
const foldPiece = { kind: 'toggle', span: { text: '▾', bold: true }, toggles: 'team:alpha' } as const

const card: CardPart[] = [
  { kind: 'text', key: 'notes', spans: [{ text: 'waits on ' }, { text: 'the lead', bold: true }, { text: '\nsince Friday' }] },
  { kind: 'line', key: 'refs', pieces: [{ kind: 'words', spans: [{ text: 'after ' }] }, idPiece, { kind: 'words', spans: [{ text: ' lands' }] }] },
  { kind: 'press', key: 'file:0', spans: [{ text: 'src/a.ts\n+3 -1' }], expands: 'src/a.ts' },
  { kind: 'field', key: 'field', field: { task: 'T1', round: 2 } },
]

const words: Drawn = { key: 'title', spans: [{ text: 'Today\n\n3 tasks', dim: true }], wrap: 'wrap', toggle: null }
const task: Drawn = { key: 'task:T1', spans: [{ text: 'T1 the pane' }, { text: '\n  p0, due Sunday', dim: true }], wrap: 'wrap', toggle: 'T1' }
const open: Drawn = { ...task, card }
const leader: Drawn = {
  key: 'node:alpha',
  spans: [{ text: '▾ alpha' }],
  wrap: 'wrap',
  toggle: null,
  folds: 'team:alpha',
  parts: [{ kind: 'line', key: 'head', pieces: [foldPiece, { kind: 'words', spans: [{ text: ' alpha' }] }] }],
  card: [{ kind: 'line', key: 'lead', pieces: [{ kind: 'words', spans: [{ text: 'lead ' }] }, idPiece] }],
}

describe('spans as lines', () => {
  test('a span is split at its line ends, each piece in the span’s style, a line with no text blank', () => {
    const lines = linesOf([{ text: 'a\n\nb', bold: true }, { text: 'c\n', color: 'error' }])
    expect(lines.map(line => line.map(run => run.text))).toEqual([['a'], [], ['b', 'c'], []])
    expect(lines[2]).toMatchObject([
      { bold: true, tone: null },
      { bold: false, tone: 'error' },
    ])
    expect(linesOf([])).toEqual([[]])
  })
})

describe('a slot as rows', () => {
  test('a gap is its blank rows', () => {
    expect(slotRows({ kind: 'gap', key: 'gap:a', rows: 2 }, null)).toEqual([[], []])
    expect(slotRows({ kind: 'gap', key: 'gap:a', rows: 0 }, null)).toEqual([])
  })

  test('words alone are a row a line and no stop', () => {
    const rows = slotRows(slot(words), null)
    expect(rows.map(lineOf)).toEqual(['Today', '', '3 tasks'])
    expect(stopKeys(rows)).toEqual([])
    expect(rows[0]?.[0]?.runs).toMatchObject([{ dim: true }])
  })

  test('a head the drawing names a press for is a stop on each of its lines, under the element’s key', () => {
    const rows = slotRows(slot(task), null)
    expect(rows.map(lineOf)).toEqual(['T1 the pane', '  p0, due Sunday'])
    expect(stopKeys(rows)).toEqual(['task:T1', 'task:T1'])
    expect(segOf(rows, 'task:T1').stop).toEqual({ key: 'task:T1', hotkey: null, target: { kind: 'press', press: { kind: 'card', task: 'T1' } } })
  })

  test('an open card stands under its head, its presses pressed in the open card', () => {
    const from = openKey('task:T1')
    const rows = slotRows(slot(open), null)
    expect(rows.map(lineOf)).toEqual([
      'T1 the pane',
      '  p0, due Sunday',
      'waits on the lead',
      'since Friday',
      'after T7 lands',
      'src/a.ts',
      '+3 -1',
      notePlaceholder('T1'),
    ])
    expect(rows).toHaveLength(rowsOf(open))
    const id = pieceKey(idPiece, from, 'refs', 1)
    const diff = diffKey(from, 'file:0')
    const note = noteKey('T1', 2)
    expect(stopKeys(rows)).toEqual(['task:T1', 'task:T1', id, diff, diff, note])
    expect(segOf(rows, id).stop).toMatchObject({ target: { kind: 'press', press: { kind: 'page', task: 'T7', from } } })
    expect(segOf(rows, id).runs).toMatchObject([{ text: 'T7', underline: true, tone: 'suggestion' }])
    expect(segOf(rows, diff).stop).toMatchObject({ target: { kind: 'press', press: { kind: 'diff', key: 'src/a.ts' } } })
    expect(segOf(rows, note).stop).toEqual({ key: note, hotkey: null, target: { kind: 'note', field: { task: 'T1', round: 2 } } })
    expect(segOf(rows, note).runs).toMatchObject([{ dim: true }])
  })

  test('the Note field the app types in shows what is typed and the cursor’s cell', () => {
    const note = noteKey('T1', 2)
    const typed = segOf(slotRows(slot(open), { key: note, text: 'ship it' }), note)
    expect(typed.runs).toMatchObject([
      { text: 'ship it', dim: false },
      { text: ' ', inverse: true },
    ])
    const other = segOf(slotRows(slot(open), { key: 'find', text: 'ship it' }), note)
    expect(textOf(other)).toBe(notePlaceholder('T1'))
  })

  test('a slot the cut left no head of draws its card alone', () => {
    const rows = slotRows(slot({ ...open, spans: [] }, false), null)
    expect(rows.map(lineOf)[0]).toBe('waits on the lead')
    expect(stopKeys(rows)).not.toContain('task:T1')
    expect(rows).toHaveLength(6)
  })

  test('an element drawn as parts draws them for its head, its presses pressed in the element; a fold mark keeps its style', () => {
    const rows = slotRows(slot(leader), null)
    expect(rows.map(lineOf)).toEqual(['▾ alpha', 'lead T7'])
    const fold = pieceKey(foldPiece, 'node:alpha', 'head', 0)
    const id = pieceKey(idPiece, 'node:alpha', 'lead', 1)
    expect(stopKeys(rows)).toEqual([fold, id])
    expect(segOf(rows, fold).runs).toMatchObject([{ text: '▾', bold: true, underline: false }])
    expect(segOf(rows, fold).stop).toMatchObject({ target: { kind: 'press', press: { kind: 'team-key', key: 'team:alpha' } } })
  })

  test('the stops of a whole body are the presses press-keys.ts names, in the ring’s order', () => {
    const places = placesOf([words, open, leader, task], 1)
    const view = viewOf(places, 0, 100)
    const drawnKeys = stopKeys(frameOf(places, view).flatMap(found => slotRows(found, null)))
    const distinct = drawnKeys.filter((key, i) => key !== drawnKeys[i - 1])
    expect(distinct).toEqual(places.flatMap(pressesOf).map(press => press.key))
  })

  test('a window’s slots take the rows the window has', () => {
    const places = placesOf([words, open, leader, task], 1)
    for (const offset of [0, 2, 5, 9]) {
      const view = viewOf(places, offset, 6)
      expect(frameOf(places, view).flatMap(found => slotRows(found, null))).toHaveLength(6)
    }
  })
})
