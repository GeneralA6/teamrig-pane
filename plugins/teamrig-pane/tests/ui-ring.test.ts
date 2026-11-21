// The focus ring read from a painted frame: the order Tab walks, the stop a key, a cell or a hotkey names, the way
// back, and the Find row a head holds.
import { describe, expect, test } from 'claude-code/testing'
import type { FindRow, Head, HeadPart } from '../hooks/head'
import type { Drawn } from '../hooks/layout'
import { paint, type Frame } from '../ui/paint'
import { FIND_CLEAR_KEY, FIND_HOTKEY, FIND_KEY } from '../ui/paint-head'
import { noteKey } from '../hooks/press-keys'
import { backHit, findRowOf, hitAt, hitOf, hotkeyHit, noteFieldOf, ringOrder, stepped } from '../ui/ring'

const FIND: FindRow = { key: 'find:1', placeholder: 'words', text: '', submitLabel: 'search', submits: 'tasks', clears: false }
const TITLE: HeadPart = { kind: 'item', item: { kind: 'words', key: 'title', text: 'teamrig', tone: 'bold', cut: false } }
const BACK: HeadPart = { kind: 'item', item: { kind: 'button', key: 'back', label: 'back', hotkey: null, look: 'plain', press: { kind: 'back' } } }
const FOUND: HeadPart = { kind: 'find', find: FIND }

const head = (...parts: HeadPart[]): Head => ({ strip: false, parts })

const first: Drawn = { key: 'a', spans: [{ text: 'T1 first' }], wrap: 'wrap', toggle: 'T1' }
const second: Drawn = { key: 'b', spans: [{ text: 'T2 second\nmore' }], wrap: 'wrap', toggle: 'T2' }
const plain: Drawn = { key: 'c', spans: [{ text: 'plain' }], wrap: 'wrap', toggle: null }
const last: Drawn = { key: 'd', spans: [{ text: 'T4 last' }], wrap: 'wrap', toggle: 'T4' }
const body = [first, second, plain, last]

function frame(of: Head, rows: number, offset = 0): Frame {
  return paint(of, body, { size: { columns: 30, rows }, offset, ring: null, typing: null })
}

describe('ringOrder', () => {
  test('the head’s stops as drawn, then the body’s presses, one of two lines once', () => {
    expect(ringOrder(frame(head(TITLE, BACK, FOUND), 20))).toEqual(['back', FIND_KEY, FIND.key, 'a', 'b', 'd'])
  })

  test('the same wherever the window stands: a press it leaves out keeps its place', () => {
    const tall = frame(head(TITLE, BACK, FOUND), 20)
    for (const offset of [0, 2, 99]) {
      const short = frame(head(TITLE, BACK, FOUND), 7, offset)
      expect(short.hits.length).toBeLessThan(tall.hits.length)
      expect(ringOrder(short)).toEqual(ringOrder(tall))
    }
  })

  test('clear is a stop while a search shows', () => {
    const searching: HeadPart = { kind: 'find', find: { ...FIND, clears: true } }
    expect(ringOrder(frame(head(searching), 20)).slice(0, 3)).toEqual([FIND_KEY, FIND.key, FIND_CLEAR_KEY])
  })
})

describe('stepped', () => {
  const order = ['x', 'y', 'z']

  test('one step on, round the ends', () => {
    expect(stepped(order, 'x', 1)).toBe('y')
    expect(stepped(order, 'z', 1)).toBe('x')
    expect(stepped(order, 'x', -1)).toBe('z')
    expect(stepped(order, 'y', -1)).toBe('x')
  })

  test('from no stop, or one the order lacks, its first forward and its last back', () => {
    expect(stepped(order, null, 1)).toBe('x')
    expect(stepped(order, null, -1)).toBe('z')
    expect(stepped(order, 'gone', 1)).toBe('x')
    expect(stepped(order, 'gone', -1)).toBe('z')
  })

  test('an order of no stop steps nowhere', () => {
    expect(stepped([], null, 1)).toBeNull()
    expect(stepped([], 'x', -1)).toBeNull()
  })
})

describe('the stop a key, a cell or a hotkey names', () => {
  const drawn = frame(head(TITLE, BACK, FOUND), 20)

  test('hitOf: where the key is drawn first; null for none, and for a press the window leaves out', () => {
    const lines = drawn.hits.filter(hit => hit.key === 'b').map(hit => hit.line)
    expect(lines).toHaveLength(2)
    expect(hitOf(drawn, 'b')?.line).toBe(Math.min(...lines))
    expect(hitOf(drawn, null)).toBeNull()
    expect(hitOf(drawn, 'nowhere')).toBeNull()
    expect(hitOf(frame(head(TITLE, BACK, FOUND), 7), 'd')).toBeNull()
  })

  test('hitAt: a stop’s cells from its first to before its `to`, on its line alone', () => {
    const hit = hitOf(drawn, 'a')
    if (hit === null) throw new Error('no stop a')
    expect(hitAt(drawn, hit.from, hit.line)?.key).toBe('a')
    expect(hitAt(drawn, hit.to - 1, hit.line)?.key).toBe('a')
    expect(hitAt(drawn, hit.to, hit.line)).toBeNull()
    expect(hitAt(drawn, hit.from - 1, hit.line)).toBeNull()
    expect(hitAt(drawn, hit.from, hit.line + 1)).toBeNull()
  })

  test('hotkeyHit: the stop drawn under the key; null for a key no stop takes', () => {
    expect(hotkeyHit(drawn, FIND_HOTKEY)?.key).toBe(FIND_KEY)
    expect(hotkeyHit(drawn, 'z')).toBeNull()
  })
})

describe('backHit', () => {
  test('the way back the frame draws', () => {
    expect(backHit(frame(head(TITLE, BACK, FOUND), 20))?.key).toBe('back')
  })

  test('a Log page’s close is a way back', () => {
    const close: HeadPart = { kind: 'item', item: { kind: 'button', key: 'close', label: 'close', hotkey: null, look: 'plain', press: { kind: 'log-close' } } }
    expect(backHit(frame(head(TITLE, close), 20))?.key).toBe('close')
  })

  test('null for a frame with none: a card’s press is no way back', () => {
    expect(backHit(frame(head(TITLE, FOUND), 20))).toBeNull()
  })
})

describe('noteFieldOf', () => {
  const field = { task: 'T1', round: 2 }
  const carded: Drawn = { ...first, card: [{ kind: 'text', key: 'a:why', spans: [{ text: 'why' }] }, { kind: 'field', key: 'a:note', field }] }

  test('the Note field of an open card, by the key the ring lands on', () => {
    expect(noteFieldOf([plain, carded], noteKey('T1', 2))).toBe(field)
  })

  test('null for another round’s key, a press’s key, and a body with no field', () => {
    expect(noteFieldOf([plain, carded], noteKey('T1', 1))).toBeNull()
    expect(noteFieldOf([plain, carded], 'a')).toBeNull()
    expect(noteFieldOf(body, noteKey('T1', 2))).toBeNull()
  })
})

describe('findRowOf', () => {
  test('the Find row a head holds, alone or in a group', () => {
    expect(findRowOf(head(TITLE, FOUND))).toBe(FIND)
    expect(findRowOf(head(TITLE, { kind: 'group', key: 'top', pieces: [{ kind: 'rule', cells: 4 }, { kind: 'find', find: FIND }] }))).toBe(FIND)
  })

  test('null for a head with none', () => {
    expect(findRowOf(head(TITLE, BACK))).toBeNull()
  })
})
