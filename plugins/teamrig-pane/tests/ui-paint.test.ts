// One drawing of the dedicated UI: the head, a blank row and the body's window on a screen, exactly the screen's
// rows, each stop at its line and cells, the scroll bar beside a body that does not fit.
import { describe, expect, test } from 'claude-code/testing'
import type { Head } from '../hooks/head'
import type { Drawn } from '../hooks/layout'
import { noteKey } from '../hooks/press-keys'
import { cells } from '../hooks/width'
import { bodyColumns, paint, THUMB, TRACK, windowRows, type Frame, type Look } from '../ui/paint'

const head: Head = { strip: false, parts: [{ kind: 'item', item: { kind: 'words', key: 'title', text: 'teamrig', tone: 'bold', cut: false } }] }
const first: Drawn = { key: 'a', spans: [{ text: 'T1 first' }], wrap: 'wrap', toggle: 'T1' }
const second: Drawn = { key: 'b', spans: [{ text: 'T2 second\nmore' }], wrap: 'wrap', toggle: 'T2' }
const last: Drawn = { key: 'c', spans: [{ text: 'plain' }], wrap: 'wrap', toggle: null }
const body = [first, second, last]

function look(columns: number, rows: number, over: Partial<Look> = {}): Look {
  return { size: { columns, rows }, offset: 0, ring: null, typing: null, ...over }
}

function raw(frame: Frame): string[] {
  return frame.lines.map(line => line.map(run => run.text).join(''))
}

function text(frame: Frame): string[] {
  return raw(frame).map(line => line.trimEnd())
}

function hitsOf(frame: Frame): { key: string; line: number; from: number; to: number }[] {
  return frame.hits.map(({ key, line, from, to }) => ({ key, line, from, to }))
}

describe('the columns and rows a screen leaves', () => {
  test('a column of padding each side, and the window under the head and a blank row', () => {
    expect(bodyColumns({ columns: 80, rows: 24 })).toBe(78)
    expect(bodyColumns({ columns: 1, rows: 24 })).toBe(0)
    expect(windowRows({ columns: 80, rows: 24 }, 5)).toBe(18)
    expect(windowRows({ columns: 80, rows: 3 }, 5)).toBe(0)
  })
})

describe('a frame', () => {
  test('the head, a blank row, then the body a gap between two elements, in exactly the screen’s rows', () => {
    const frame = paint(head, body, look(20, 10))
    expect(text(frame)).toEqual([' teamrig', '', ' T1 first', '', ' T2 second', ' more', '', ' plain', '', ''])
    expect(frame.view).toEqual({ offset: 0, visibleRows: 8, contentRows: 6, maxOffset: 0 })
    expect(frame.places.map(({ top, rows }) => ({ top, rows }))).toEqual([
      { top: 0, rows: 1 },
      { top: 2, rows: 2 },
      { top: 5, rows: 1 },
    ])
  })

  test('a stop is hit at its line and its cells, a press of two lines on both', () => {
    const frame = paint(head, body, look(20, 10))
    expect(hitsOf(frame)).toEqual([
      { key: 'a', line: 2, from: 1, to: 9 },
      { key: 'b', line: 4, from: 1, to: 10 },
      { key: 'b', line: 5, from: 1, to: 5 },
    ])
    expect(frame.hits[0]?.target).toEqual({ kind: 'press', press: { kind: 'card', task: 'T1' } })
  })

  test('a body that fits draws no scroll bar', () => {
    const lines = raw(paint(head, body, look(20, 10))).join('')
    expect(lines).not.toContain(THUMB)
    expect(lines).not.toContain(TRACK)
  })

  test('a body taller than the window is shown from the offset, the scroll bar in the last column', () => {
    const frame = paint(head, body, look(20, 6, { offset: 1 }))
    expect(frame.view).toEqual({ offset: 1, visibleRows: 4, contentRows: 6, maxOffset: 2 })
    const lines = raw(frame)
    expect(lines.map(line => line.slice(0, -1).trimEnd())).toEqual([' teamri', '', '', ' T2 second', ' more', ''])
    expect(lines.slice(2).map(line => line.at(-1))).toEqual([TRACK, THUMB, THUMB, THUMB])
    for (const line of lines.slice(2)) expect(cells(line)).toBe(20)
    expect(hitsOf(frame)).toEqual([
      { key: 'b', line: 3, from: 1, to: 10 },
      { key: 'b', line: 4, from: 1, to: 5 },
    ])
    expect(frame.lines[2]?.at(-1)).toMatchObject({ dim: true })
    expect(frame.lines[3]?.at(-1)).toMatchObject({ dim: false })
  })

  test('an offset past the body’s last is held to it', () => {
    const frame = paint(head, body, look(20, 6, { offset: 99 }))
    expect(frame.view?.offset).toBe(2)
    expect(text(frame).slice(2).map(line => line.slice(0, -1).trimEnd())).toEqual([' T2 second', ' more', '', ' plain'])
  })

  test('the ring’s stop is drawn inverse on every line of it, no other', () => {
    const frame = paint(head, body, look(20, 10, { ring: 'b' }))
    const inverse = frame.lines.map(line => line.some(run => run.inverse))
    expect(inverse).toEqual([false, false, false, false, true, true, false, false, false, false])
  })

  test('a line wider than the screen is cut inside the padding', () => {
    const frame = paint(head, body, look(8, 10))
    expect(text(frame)[2]).toBe(' T1 fi…')
    expect(hitsOf(frame)[0]).toEqual({ key: 'a', line: 2, from: 1, to: 6 })
  })

  test('the minimized strip is its head alone: no body, no window', () => {
    const strip: Head = {
      strip: true,
      parts: [{ kind: 'row', gap: 1, items: [{ kind: 'button', key: 'view:tasks', label: 'Tasks', hotkey: 't', look: 'secondary', press: { kind: 'keys' } }] }],
    }
    const frame = paint(strip, body, look(20, 3))
    expect(text(frame)).toEqual([' [ Tasks ]', '', ''])
    expect(frame.view).toBeNull()
    expect(frame.places).toEqual([])
    expect(hitsOf(frame)).toEqual([{ key: 'view:tasks', line: 0, from: 1, to: 10 }])
  })

  test('a head taller than the screen is cut at its last row, with no window and no stop below it', () => {
    const tall: Head = {
      strip: false,
      parts: [
        { kind: 'item', item: { kind: 'button', key: 'one', label: 'one', hotkey: null, look: 'plain', press: { kind: 'keys' } } },
        { kind: 'item', item: { kind: 'button', key: 'two', label: 'two', hotkey: null, look: 'plain', press: { kind: 'back' } } },
      ],
    }
    const frame = paint(tall, body, look(20, 2))
    expect(text(frame)).toEqual([' one', ''])
    expect(hitsOf(frame)).toEqual([{ key: 'one', line: 0, from: 1, to: 4 }])
    expect(frame.view).toMatchObject({ visibleRows: 0 })
  })

  test('a screen of no rows or one column still paints its rows', () => {
    expect(paint(head, body, look(20, 0)).lines).toEqual([])
    const narrow = paint(head, body, look(1, 4))
    expect(narrow.lines).toHaveLength(4)
    expect(narrow.hits).toEqual([])
  })

  test('the field typed in is drawn with what is typed, in the head or in a card', () => {
    const finding: Head = {
      strip: false,
      parts: [{ kind: 'find', find: { key: 'find', placeholder: 'words', text: '', submitLabel: 'search', submits: null, clears: false } }],
    }
    expect(text(paint(finding, body, look(30, 4, { typing: { key: 'find', text: 'bud' } })))[0]).toBe(' s: Find bud')
    const open: Drawn = { ...first, card: [{ kind: 'field', key: 'field', field: { task: 'T1', round: 0 } }] }
    const frame = paint(head, [open], look(30, 6, { typing: { key: noteKey('T1', 0), text: 'ship it' } }))
    expect(text(frame)[3]).toBe(' ship it')
    expect(frame.hits.at(-1)).toMatchObject({ key: noteKey('T1', 0), line: 3, from: 1, to: 9, target: { kind: 'note' } })
  })
})
