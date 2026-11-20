// The fields of a `teamrig read` record (hooks/document-fields.ts): a field of the type asked is answered as it is,
// any other is noted under its path with a stand-in in its place, an optional field reads null when null or left out,
// a moment reads as milliseconds, required or optional, a record inside a record notes under the outer field's path,
// every text and quoted word is answered as the pane may draw it, and the left-out line names the first few (T4742).
import { describe, expect, test } from 'claude-code/testing'
import { Fields, isList, isOneOf, leftOutLine } from '../hooks/document-fields'
import { CONTROL_SHOWN } from '../hooks/shown-text'

const COLOURS = { red: true, green: true } as const

describe('Fields', () => {
  test('answers each field of the type asked as it is, and notes nothing', () => {
    const fields = new Fields({ name: 'api', count: 3, zero: 0, on: false, tags: ['a', 'b'], none: [], colour: 'green' })
    expect(fields.text('name')).toBe('api')
    expect(fields.number('count')).toBe(3)
    expect(fields.number('zero')).toBe(0)
    expect(fields.flag('on')).toBe(false)
    expect(fields.texts('tags')).toEqual(['a', 'b'])
    expect(fields.texts('none')).toEqual([])
    expect(fields.oneOf('colour', COLOURS, 'red')).toBe('green')
    expect(fields.bad).toEqual([])
  })

  test('notes a required field that is missing, null or of another type, and answers its stand-in', () => {
    const fields = new Fields({ name: 4, count: '3', huge: Infinity, on: 'yes', tags: ['a', 2], list: 'a', gone: null })
    expect(fields.text('name')).toBe('')
    expect(fields.number('count')).toBe(0)
    expect(fields.number('huge')).toBe(0)
    expect(fields.flag('on')).toBe(false)
    expect(fields.texts('tags')).toEqual([])
    expect(fields.texts('list')).toEqual([])
    expect(fields.text('gone')).toBe('')
    expect(fields.text('absent')).toBe('')
    expect(fields.bad).toEqual(['name', 'count', 'huge', 'on', 'tags', 'list', 'gone', 'absent'])
  })

  test('an optional field reads null when null or left out, and is noted only for another type', () => {
    const fields = new Fields({ note: 'kept', size: 2.5, empty: null, wrong: 7, worded: '2' })
    expect(fields.textOrNull('note')).toBe('kept')
    expect(fields.numberOrNull('size')).toBe(2.5)
    expect(fields.textOrNull('empty')).toBeNull()
    expect(fields.textOrNull('absent')).toBeNull()
    expect(fields.numberOrNull('absent')).toBeNull()
    expect(fields.bad).toEqual([])
    expect(fields.textOrNull('wrong')).toBeNull()
    expect(fields.numberOrNull('worded')).toBeNull()
    expect(fields.bad).toEqual(['wrong', 'worded'])
  })

  test('reads an optional moment as milliseconds, to the second or the millisecond, and null when null or left out', () => {
    const fields = new Fields({ at: '2026-03-02T09:00:00.000Z', whole: '2026-03-02T09:00:05Z', none: null })
    expect(fields.momentOrNull('at')).toBe(Date.UTC(2026, 2, 2, 9, 0, 0))
    expect(fields.momentOrNull('whole')).toBe(Date.UTC(2026, 2, 2, 9, 0, 5))
    expect(fields.momentOrNull('none')).toBeNull()
    expect(fields.momentOrNull('absent')).toBeNull()
    expect(fields.bad).toEqual([])
  })

  test('notes a moment of another type, another shape or a day no calendar holds', () => {
    const fields = new Fields({ ms: 1_772_442_000_000, day: '2026-03-02', local: '2026-03-02T09:00:00', worded: 'March 2, 2026', never: '2026-13-45T09:00:00.000Z' })
    for (const name of ['ms', 'day', 'local', 'worded', 'never']) expect(fields.momentOrNull(name)).toBeNull()
    expect(fields.bad).toEqual(['ms', 'day', 'local', 'worded', 'never'])
  })

  test('reads a required moment as milliseconds, to the second or the millisecond, the first one of the calendar too', () => {
    const fields = new Fields({ at: '2026-03-02T09:00:00.000Z', whole: '2026-03-02T09:00:05Z', first: '1970-01-01T00:00:00Z' })
    expect(fields.moment('at')).toBe(Date.UTC(2026, 2, 2, 9, 0, 0))
    expect(fields.moment('whole')).toBe(Date.UTC(2026, 2, 2, 9, 0, 5))
    expect(fields.moment('first')).toBe(0)
    expect(fields.bad).toEqual([])
  })

  test('notes a required moment that is missing, null, of another type or shape, or a day no calendar holds', () => {
    const fields = new Fields({ none: null, ms: 1_772_442_000_000, day: '2026-03-02', never: '2026-13-45T09:00:00.000Z' })
    for (const name of ['none', 'absent', 'ms', 'day', 'never']) expect(fields.moment(name)).toBe(0)
    expect(fields.bad).toEqual(['none', 'absent', 'ms', 'day', 'never'])
  })

  test('a word outside its known set is noted with the word, and one that is no text by its path alone', () => {
    const fields = new Fields({ colour: 'blue', shade: 3, built: 'toString' })
    expect(fields.oneOf('colour', COLOURS, 'red')).toBe('red')
    expect(fields.oneOf('shade', COLOURS, 'red')).toBe('red')
    expect(fields.oneOf('built', COLOURS, 'green')).toBe('green')
    expect(fields.bad).toEqual(['colour "blue"', 'shade', 'built "toString"'])
  })

  test('answers every text with nothing in it a terminal would act on', () => {
    const fields = new Fields({
      title: '\u001b[2Jwiped',
      note: 'approved ‮denied',
      tags: ['a\u0007', 'b\tc'],
      body: { text: 'one\r\ntwo\u009b' },
    })
    expect(fields.text('title')).toBe(`${CONTROL_SHOWN}[2Jwiped`)
    expect(fields.textOrNull('note')).toBe('approved denied')
    expect(fields.texts('tags')).toEqual([`a${CONTROL_SHOWN}`, 'b c'])
    expect(fields.part('body').text('text')).toBe(`one\ntwo${CONTROL_SHOWN}`)
    expect(fields.bad).toEqual([])
  })

  test('quotes a word outside its known set with nothing in it a terminal would act on', () => {
    const fields = new Fields({ colour: 'bl\u009b31mue‮' })
    expect(fields.oneOf('colour', COLOURS, 'red')).toBe('red')
    expect(fields.bad).toEqual([`colour "bl${CONTROL_SHOWN}31mue"`])
  })

  test('reads a record inside a record, noting under the outer field', () => {
    const fields = new Fields({ answer: { by: 'lead', at: 5, inner: { word: 1 } } })
    const answer = fields.part('answer')
    expect(answer.text('by')).toBe('lead')
    expect(answer.text('at')).toBe('')
    expect(answer.part('inner').text('word')).toBe('')
    expect(fields.bad).toEqual(['answer.at', 'answer.inner.word'])
    expect(answer.bad).toEqual(fields.bad)
  })

  test('a missing record is noted, and so is each field asked of its stand-in', () => {
    const fields = new Fields({ title: 'plain' })
    expect(fields.part('title').text('text')).toBe('')
    expect(fields.part('absent').textOrNull('text')).toBeNull()
    expect(fields.bad).toEqual(['title', 'title.text', 'absent'])
  })

  test('an optional record reads null when null or left out, and is noted only for another type', () => {
    const fields = new Fields({ ref: { text: 'plan.md:4' }, none: null, wrong: ['x'] })
    expect(fields.partOrNull('ref')?.text('text')).toBe('plan.md:4')
    expect(fields.partOrNull('none')).toBeNull()
    expect(fields.partOrNull('absent')).toBeNull()
    expect(fields.bad).toEqual([])
    expect(fields.partOrNull('wrong')).toBeNull()
    expect(fields.bad).toEqual(['wrong'])
  })

  test('reads the records of a list in its order, leaving out and noting an entry that is no record', () => {
    const fields = new Fields({ waits: [{ kind: 'task' }, 'time', { kind: 4 }], none: [], wrong: {} })
    const waits = fields.parts('waits')
    expect(waits.map(wait => wait.text('kind'))).toEqual(['task', ''])
    expect(fields.parts('none')).toEqual([])
    expect(fields.parts('wrong')).toEqual([])
    expect(fields.parts('absent')).toEqual([])
    expect(fields.bad).toEqual(['waits[1]', 'waits[2].kind', 'wrong', 'absent'])
  })

  test('hands out a copy of what it noted', () => {
    const fields = new Fields({})
    const before = fields.bad
    fields.text('name')
    expect(before).toEqual([])
    expect(fields.bad).toEqual(['name'])
  })
})

describe('guards', () => {
  test('a list is an array, of anything', () => {
    expect(isList([])).toBe(true)
    expect(isList([1, 'a'])).toBe(true)
    expect(isList({ length: 0 })).toBe(false)
    expect(isList('ab')).toBe(false)
  })

  test('a known word is one of the own keys of its set', () => {
    expect(isOneOf(COLOURS, 'red')).toBe(true)
    expect(isOneOf(COLOURS, 'blue')).toBe(false)
    expect(isOneOf(COLOURS, 'constructor')).toBe(false)
  })
})

describe('leftOutLine', () => {
  test('names each record left out, and the pane as the side to update', () => {
    expect(leftOutLine('task', ['T4 (title)'])).toBe('teamrig served 1 task the pane cannot read, T4 (title): update teamrig-pane')
    expect(leftOutLine('line', ['a', 'b', 'c'])).toBe('teamrig served 3 lines the pane cannot read, a, b, c: update teamrig-pane')
  })

  test('names the first three and counts the rest', () => {
    expect(leftOutLine('task', ['a', 'b', 'c', 'd', 'e'])).toBe('teamrig served 5 tasks the pane cannot read, a, b, c and 2 more: update teamrig-pane')
  })
})
