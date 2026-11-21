// What a terminal in raw mode sends, read as keys: named keys, typed characters, clicks and the wheel, and nothing
// for a sequence that is none of them.
import { describe, expect, test } from 'claude-code/testing'
import { keysOf, type Key, type KeyName } from '../ui/keys'

const ESC = '\u001b'

function key(name: KeyName): Key {
  return { kind: 'key', name }
}

function chars(text: string): Key[] {
  return [...text].map(char => ({ kind: 'char', char }))
}

describe('keys read from a terminal', () => {
  test('the keys that are one control character', () => {
    expect(keysOf('\t')).toEqual([key('tab')])
    expect(keysOf('\r')).toEqual([key('enter')])
    expect(keysOf('\n')).toEqual([key('enter')])
    expect(keysOf('\u007f')).toEqual([key('backspace')])
    expect(keysOf('\b')).toEqual([key('backspace')])
    expect(keysOf('\u0003')).toEqual([key('interrupt')])
  })

  test('any other control character is no key and types nothing', () => {
    expect(keysOf('\u0001\u0000\u001a')).toEqual([])
    expect(keysOf('a\u0007b')).toEqual(chars('ab'))
  })

  test('the arrows, Home and End, as a terminal sends them in either mode', () => {
    const names: [string, KeyName][] = [
      ['A', 'up'],
      ['B', 'down'],
      ['C', 'right'],
      ['D', 'left'],
      ['H', 'home'],
      ['F', 'end'],
    ]
    for (const [letter, name] of names) {
      expect(keysOf(`${ESC}[${letter}`)).toEqual([key(name)])
      expect(keysOf(`${ESC}O${letter}`)).toEqual([key(name)])
    }
  })

  test('Shift+Tab, and the keys that end in a tilde', () => {
    expect(keysOf(`${ESC}[Z`)).toEqual([key('back-tab')])
    const names: [string, KeyName][] = [
      ['1', 'home'],
      ['7', 'home'],
      ['4', 'end'],
      ['8', 'end'],
      ['3', 'delete'],
      ['5', 'page-up'],
      ['6', 'page-down'],
    ]
    for (const [number, name] of names) expect(keysOf(`${ESC}[${number}~`)).toEqual([key(name)])
  })

  test('a key with Shift or Ctrl held is the key alone', () => {
    expect(keysOf(`${ESC}[1;2A`)).toEqual([key('up')])
    expect(keysOf(`${ESC}[5;5~`)).toEqual([key('page-up')])
  })

  test('Escape alone is the key, twice when sent twice, and still the key before another sequence', () => {
    expect(keysOf(ESC)).toEqual([key('escape')])
    expect(keysOf(`${ESC}${ESC}`)).toEqual([key('escape'), key('escape')])
    expect(keysOf(`${ESC}${ESC}[A`)).toEqual([key('escape'), key('up')])
  })

  test('typed text is a character each grapheme, hotkeys among them', () => {
    expect(keysOf('q')).toEqual(chars('q'))
    expect(keysOf('/s?')).toEqual(chars('/s?'))
    expect(keysOf('éa')).toEqual([
      { kind: 'char', char: 'é' },
      { kind: 'char', char: 'a' },
    ])
    expect(keysOf('👍')).toEqual([{ kind: 'char', char: '👍' }])
  })

  test('one read holds keys of every kind, in order', () => {
    expect(keysOf(`ab\t${ESC}[B\rc`)).toEqual([...chars('ab'), key('tab'), key('down'), key('enter'), ...chars('c')])
  })

  test('a sequence that is none of ours is taken whole: none of it is typed', () => {
    expect(keysOf(`${ESC}[2~`)).toEqual([])
    expect(keysOf(`${ESC}[?1;2c`)).toEqual([])
    expect(keysOf(`${ESC}[15~x`)).toEqual(chars('x'))
    expect(keysOf(`${ESC}[I`)).toEqual([])
    expect(keysOf(`${ESC}OP`)).toEqual([])
    expect(keysOf(`${ESC}[~`)).toEqual([])
  })

  test('a control sequence the read cut short is dropped to the read’s end', () => {
    expect(keysOf(`a${ESC}[1;5`)).toEqual(chars('a'))
    expect(keysOf(`${ESC}[`)).toEqual([])
  })

  test('Alt held with a character is no key, and what follows is read on', () => {
    expect(keysOf(`${ESC}xq`)).toEqual(chars('q'))
    expect(keysOf(`${ESC}👍q`)).toEqual(chars('q'))
  })
})

describe('the mouse', () => {
  test('a left press is a click on its cell, counted from 0; letting go is nothing', () => {
    expect(keysOf(`${ESC}[<0;12;3M`)).toEqual([{ kind: 'click', column: 11, line: 2 }])
    expect(keysOf(`${ESC}[<0;12;3m`)).toEqual([])
    expect(keysOf(`${ESC}[<0;1;1M`)).toEqual([{ kind: 'click', column: 0, line: 0 }])
  })

  test('the wheel is a notch up or down over its cell', () => {
    expect(keysOf(`${ESC}[<64;5;9M`)).toEqual([{ kind: 'wheel', by: -1, column: 4, line: 8 }])
    expect(keysOf(`${ESC}[<65;5;9M`)).toEqual([{ kind: 'wheel', by: 1, column: 4, line: 8 }])
  })

  test('a key held with the mouse changes nothing', () => {
    expect(keysOf(`${ESC}[<4;2;2M`)).toEqual([{ kind: 'click', column: 1, line: 1 }])
    expect(keysOf(`${ESC}[<80;2;2M`)).toEqual([{ kind: 'wheel', by: -1, column: 1, line: 1 }])
  })

  test('another button, a move, or a report that is not three numbers from 1 is nothing', () => {
    expect(keysOf(`${ESC}[<1;2;2M`)).toEqual([])
    expect(keysOf(`${ESC}[<2;2;2M`)).toEqual([])
    expect(keysOf(`${ESC}[<32;2;2M`)).toEqual([])
    expect(keysOf(`${ESC}[<35;2;2M`)).toEqual([])
    expect(keysOf(`${ESC}[<0;2M`)).toEqual([])
    expect(keysOf(`${ESC}[<0;2;2;2M`)).toEqual([])
    expect(keysOf(`${ESC}[<0;0;2M`)).toEqual([])
    expect(keysOf(`${ESC}[<0;2;0M`)).toEqual([])
    expect(keysOf(`${ESC}[<;2;2M`)).toEqual([])
  })

  test('several reports in one read are each read', () => {
    expect(keysOf(`${ESC}[<65;3;4M${ESC}[<65;3;4M`)).toEqual([
      { kind: 'wheel', by: 1, column: 2, line: 3 },
      { kind: 'wheel', by: 1, column: 2, line: 3 },
    ])
  })
})
