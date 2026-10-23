// The body's press keys: one source for the presses drawn and the focus ring's stops over them.
import { describe, expect, test } from 'claude-code/testing'
import type { CardPart, Drawn } from '../hooks/layout'
import { diffKey, focusKeysOf, headPresses, openKey, pieceKey, pressesFrom } from '../hooks/press-keys'

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
    { kind: 'inbox', span: { text: '2 unread' }, area: 'api' },
  ],
}
const WORDS: CardPart = { kind: 'text', key: 'p0', spans: [{ text: 'what and why' }] }
const DIFF: CardPart = { kind: 'press', key: 'f1', spans: [{ text: 'src/a.ts +3 -1' }], expands: 'src/a.ts' }

describe('press-keys', () => {
  test('an open card is keyed after its element, and its presses say they are drawn there', () => {
    expect(openKey('T5')).toBe('T5-open')
    expect(pressesFrom(drawn('T5', { toggle: 'T5', card: [WORDS] }))).toBe('T5-open')
  })

  test('an element drawn as parts holds its presses itself', () => {
    expect(pressesFrom(drawn('header', { parts: [LINKS] }))).toBe('header')
  })

  test('each press piece is keyed by its kind, then where it is drawn, its line and its place', () => {
    expect(pieceKey({ kind: 'id', span: { text: 'T7' }, task: 'T7' }, 'T5-open', 'p1', 1)).toBe('goto:T7:T5-open:p1:1')
    expect(pieceKey({ kind: 'file', span: { text: 'a' }, file: { file: 'a', line: 3 } }, 'T5-open', 'p1', 2)).toBe('goto:file:T5-open:p1:2')
    expect(pieceKey({ kind: 'inbox', span: { text: '2' }, area: 'api' }, 'header', 'p0', 0)).toBe('goto:inbox:header:p0:0')
    expect(diffKey('C1-open', 'f1')).toBe('diff:C1-open:f1')
  })

  test('a head is a press when it opens a card, a page, a Log page or a diff', () => {
    expect(headPresses(drawn('a'))).toBe(false)
    expect(headPresses(drawn('a', { toggle: 'T1' }))).toBe(true)
    expect(headPresses(drawn('a', { opens: 'T1' }))).toBe(true)
    expect(headPresses(drawn('a', { reads: 'api' }))).toBe(true)
    expect(headPresses(drawn('a', { expands: 'src/a.ts' }))).toBe(true)
  })

  test('the ring meets a head press, then the open card presses in order, words and Texts left out', () => {
    const open = drawn('T5', { toggle: 'T5', card: [WORDS, LINKS, DIFF] })
    expect(focusKeysOf(open, true)).toEqual(['T5', 'goto:T7:T5-open:p1:1', 'goto:file:T5-open:p1:2', 'goto:inbox:T5-open:p1:3', 'diff:T5-open:f1'])
  })

  test('a head the window leaves out, or one that is no press, holds no stop', () => {
    expect(focusKeysOf(drawn('T5', { toggle: 'T5', card: [DIFF] }), false)).toEqual(['diff:T5-open:f1'])
    expect(focusKeysOf(drawn('line'), true)).toEqual([])
  })

  test('an element drawn as parts has stops only for the presses in them', () => {
    expect(focusKeysOf(drawn('header', { parts: [WORDS, LINKS] }), true)).toEqual(['goto:T7:header:p1:1', 'goto:file:header:p1:2', 'goto:inbox:header:p1:3'])
  })
})
