// The body's press keys: one source for the presses drawn and the focus ring's stops over them.
import { describe, expect, test } from 'claude-code/testing'
import { placesOf, viewOf } from '../hooks/frame'
import type { CardPart, Drawn } from '../hooks/layout'
import { actKey, diffKey, headPresses, noteKey, openKey, pieceKey, placeOf, pressesFrom, pressesOf, standInsOf } from '../hooks/press-keys'

/** A body element of one line, its head no press unless `extra` makes it one. */
function drawn(key: string, extra: Partial<Drawn> = {}): Drawn {
  return { key, spans: [{ text: key }], wrap: 'wrap', toggle: null, ...extra }
}

/** A card's line holding a task id, a reference file and an inbox count, words between them. */
const LINKS: CardPart = {
  kind: 'line',
  key: 'p1',
  pieces: [
    { kind: 'words', spans: [{ text: 'after ' }] },
    { kind: 'id', span: { text: 'T7' }, task: 'T7' },
    { kind: 'file', span: { text: 'notes/a.md' }, file: { file: 'notes/a.md', line: null } },
    { kind: 'inbox', span: { text: '2 unread' }, inbox: { area: 'api', unread: 2 } },
  ],
}
const WORDS: CardPart = { kind: 'text', key: 'p0', spans: [{ text: 'what and why' }] }
const DIFF: CardPart = { kind: 'press', key: 'f1', spans: [{ text: 'src/a.ts +3 -1' }], expands: 'src/a.ts' }

// A task with its card open (its head on row 0, WORDS on 1, LINKS on 2, DIFF on 3), a line of words on row 5, a task
// on row 7: a row between two.
const PLACES = placesOf([drawn('T5', { toggle: 'T5', card: [WORDS, LINKS, DIFF] }), drawn('line'), drawn('T6', { toggle: 'T6' })], 1)
const LINK_KEYS = ['goto:T7:T5-open:p1:1', 'goto:file:T5-open:p1:2', 'goto:inbox:T5-open:p1:3']

describe('press-keys', () => {
  test('an open card is keyed after its element, and its presses say they are drawn there', () => {
    expect(openKey('T5')).toBe('T5-open')
    expect(pressesFrom(drawn('T5', { toggle: 'T5', card: [WORDS] }))).toBe('T5-open')
  })

  test("an owner act's press is keyed by the press and its task alone, a Note field by its task and round", () => {
    expect(actKey('cancel', 'T12')).toBe('act:cancel:T12')
    expect(actKey('note', 'T12')).toBe('act:note:T12')
    expect(noteKey('T12', 3)).toBe('note:T12:3')
    expect(noteKey('T12', 4)).not.toBe(noteKey('T12', 3))
  })

  test('an element drawn as parts holds its presses itself', () => {
    expect(pressesFrom(drawn('header', { parts: [LINKS] }))).toBe('header')
  })

  test('each press piece is keyed by its kind, then where it is drawn, its line and its place', () => {
    expect(pieceKey({ kind: 'id', span: { text: 'T7' }, task: 'T7' }, 'T5-open', 'p1', 1)).toBe('goto:T7:T5-open:p1:1')
    expect(pieceKey({ kind: 'file', span: { text: 'a' }, file: { file: 'a', line: 3 } }, 'T5-open', 'p1', 2)).toBe('goto:file:T5-open:p1:2')
    expect(pieceKey({ kind: 'inbox', span: { text: '2' }, inbox: { area: 'api', unread: 2 } }, 'header', 'p0', 0)).toBe('goto:inbox:header:p0:0')
    expect(pieceKey({ kind: 'toggle', span: { text: 'web' }, toggles: 'card:web' }, 'team:web', 'card:0', 2)).toBe('team:card:web:team:web:card:0:2')
    expect(pieceKey({ kind: 'pin', span: { text: 'api' }, pins: 'api' }, 'no-area', 'card:1', 2)).toBe('pin:api:no-area:card:1:2')
    expect(pieceKey({ kind: 'start', span: { text: '[Start meeting]' }, starts: 'M3' }, 'meeting:M3', 'meeting:M3:card:start', 1)).toBe(
      'start:M3:meeting:M3:meeting:M3:card:start:1',
    )
    const meetsApi = { act: 'meet', team: 'acme', session: 'api' } as const
    expect(pieceKey({ kind: 'session-act', span: { text: '[Meet]' }, sessionAct: meetsApi }, 'session:acme/api', 'row', 9)).toBe('meet:acme/api:session:acme/api:row:9')
    // Its [Wake] on the same row is a press of its own.
    const wakesApi = { act: 'wake', team: 'acme', session: 'api' } as const
    expect(pieceKey({ kind: 'session-act', span: { text: '[Wake]' }, sessionAct: wakesApi }, 'session:acme/api', 'row', 9)).toBe('wake:acme/api:session:acme/api:row:9')
    expect(pieceKey({ kind: 'stats', span: { text: '30 d' }, stats: { kind: 'range', range: '30d' } }, 'stats:pick', 'card:1', 2)).toBe(
      'stats:range:30d:stats:pick:card:1:2',
    )
    const opensTeam = { kind: 'open', scope: { kind: 'team', team: 'acme' }, row: 'team:acme' } as const
    expect(pieceKey({ kind: 'stats', span: { text: '[Stats]' }, stats: opensTeam }, 'team:acme', 'card:0', 7)).toBe('stats:open:team:acme:team:acme:card:0:7')
    const opensSession = { kind: 'open', scope: { kind: 'session', team: 'acme', session: 'api' }, row: 'session:acme/api' } as const
    expect(pieceKey({ kind: 'stats', span: { text: '[Stats]' }, stats: opensSession }, 'session:acme/api', 'card:0', 7)).toBe(
      'stats:open:session:acme/api:session:acme/api:card:0:7',
    )
    expect(diffKey('C1-open', 'f1')).toBe('diff:C1-open:f1')
    expect(pieceKey({ kind: 'act', span: { text: '[Next]' }, acts: { task: 'T5', press: 'next' } }, 'T5-open', 'card:3', 2)).toBe(actKey('next', 'T5'))
  })

  test("a task card's Note field and act presses are ring stops keyed by their task alone, each on its row", () => {
    const field: CardPart = { kind: 'field', key: 'T5:field', field: { task: 'T5', round: 2 } }
    const acts: CardPart = {
      kind: 'line',
      key: 'card:2',
      pieces: [
        { kind: 'act', span: { text: '[Send]' }, acts: { task: 'T5', press: 'send' } },
        { kind: 'words', spans: [{ text: ' ' }] },
        { kind: 'act', span: { text: '[Cancel]' }, acts: { task: 'T5', press: 'cancel' } },
      ],
    }
    const places = placesOf([drawn('T5', { toggle: 'T5', card: [WORDS, field, acts] })], 1)
    expect(places.flatMap(pressesOf)).toEqual([
      { key: 'T5', top: 0, rows: 1 },
      { key: noteKey('T5', 2), top: 2, rows: 1 },
      { key: actKey('send', 'T5'), top: 3, rows: 1 },
      { key: actKey('cancel', 'T5'), top: 3, rows: 1 },
    ])
    expect(placeOf(places, noteKey('T5', 2))).toEqual({ top: 2, rows: 1 })
  })

  test('a head is a press when it opens a card, a page, a Log page or a diff', () => {
    expect(headPresses(drawn('a'))).toBe(false)
    expect(headPresses(drawn('a', { toggle: 'T1' }))).toBe(true)
    expect(headPresses(drawn('a', { opens: 'T1' }))).toBe(true)
    expect(headPresses(drawn('a', { reads: { session: 'api', claude: 'c-1' } }))).toBe(true)
    expect(headPresses(drawn('a', { expands: 'src/a.ts' }))).toBe(true)
  })

  test('the ring meets each head press, then its open card presses, each on its row; words and Texts hold none', () => {
    expect(PLACES.flatMap(pressesOf)).toEqual([
      { key: 'T5', top: 0, rows: 1 },
      ...LINK_KEYS.map(key => ({ key, top: 2, rows: 1 })),
      { key: 'diff:T5-open:f1', top: 3, rows: 1 },
      { key: 'T6', top: 7, rows: 1 },
    ])
  })

  test('an element drawn as parts has presses only in them', () => {
    const header = placesOf([drawn('header', { spans: [{ text: 'what and why\nafter T7' }], parts: [WORDS, LINKS] })], 1)
    expect(header.flatMap(pressesOf).map(press => press.key)).toEqual(['goto:T7:header:p1:1', 'goto:file:header:p1:2', 'goto:inbox:header:p1:3'])
    expect(header.flatMap(pressesOf).every(press => press.top === 1)).toBe(true)
  })

  test("an element drawn as parts with its card open has its parts' presses, then its card's, all drawn from it", () => {
    const marks: CardPart = {
      kind: 'line',
      key: 'card:0',
      pieces: [
        { kind: 'toggle', span: { text: '▾ ' }, toggles: 'web' },
        { kind: 'words', spans: [{ text: '● ' }] },
        { kind: 'toggle', span: { text: 'web' }, toggles: 'card:web' },
      ],
    }
    const leader = drawn('team:web', { spans: [{ text: '▾ ● web' }], parts: [marks], card: [WORDS, LINKS] })
    const places = placesOf([leader], 1)
    expect(pressesFrom(leader)).toBe('team:web')
    expect(places.flatMap(pressesOf)).toEqual([
      { key: 'team:web:team:web:card:0:0', top: 0, rows: 1 },
      { key: 'team:card:web:team:web:card:0:2', top: 0, rows: 1 },
      ...['goto:T7:team:web:p1:1', 'goto:file:team:web:p1:2', 'goto:inbox:team:web:p1:3'].map(key => ({ key, top: 2, rows: 1 })),
    ])
    expect(placeOf(places, 'team:web')).toEqual({ top: 0, rows: 1 })
    expect(placeOf(places, openKey('team:web'))).toEqual({ top: 0, rows: 3 })
  })

  test('the presses a window leaves out stand in above it and below it, in the order the ring meets them', () => {
    expect(standInsOf(PLACES, viewOf(PLACES, 2, 3))).toEqual({ above: ['T5'], below: ['T6'] })
    expect(standInsOf(PLACES, viewOf(PLACES, 0, 8))).toEqual({ above: [], below: [] })
    expect(standInsOf(PLACES, viewOf(PLACES, 5, 3))).toEqual({ above: ['T5', ...LINK_KEYS, 'diff:T5-open:f1'], below: [] })
  })

  test('a window of no rows leaves every press out, each on its side of where it stands', () => {
    expect(standInsOf(PLACES, viewOf(PLACES, 2, 0))).toEqual({ above: ['T5'], below: [...LINK_KEYS, 'diff:T5-open:f1', 'T6'] })
  })

  test("an element's key names its head, its open card's the element whole, a press's its row", () => {
    expect(placeOf(PLACES, 'T5')).toEqual({ top: 0, rows: 1 })
    expect(placeOf(PLACES, 'T5-open')).toEqual({ top: 0, rows: 4 })
    expect(placeOf(PLACES, 'diff:T5-open:f1')).toEqual({ top: 3, rows: 1 })
    expect(placeOf(PLACES, 'line')).toEqual({ top: 5, rows: 1 })
    expect(placeOf(PLACES, 'T9')).toBeNull()
  })
})
