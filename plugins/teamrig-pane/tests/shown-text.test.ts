// A served text as the pane may draw it (hooks/shown-text.ts): a control character draws as `�`, a direction mark
// is dropped, a line break stays and a tab is one space, so no text a document holds can restyle the terminal, move
// its cursor or show its words in another order (T4742).
import { describe, expect, test } from 'claude-code/testing'
import { CONTROL_SHOWN, shownText } from '../hooks/shown-text'

describe('shownText', () => {
  test('answers a text with nothing to clean as it is, in any script', () => {
    expect(shownText('Draw the list: 3 rows, 100% read')).toBe('Draw the list: 3 rows, 100% read')
    expect(shownText('שלום עולם')).toBe('שלום עולם')
    expect(shownText('naïve café 東京 🙂')).toBe('naïve café 東京 🙂')
    expect(shownText('')).toBe('')
  })

  test('draws an escape sequence as its visible characters, the escape itself as the mark', () => {
    expect(shownText('\u001b[31mred\u001b[0m')).toBe(`${CONTROL_SHOWN}[31mred${CONTROL_SHOWN}[0m`)
    expect(shownText('\u001b]0;title\u0007')).toBe(`${CONTROL_SHOWN}]0;title${CONTROL_SHOWN}`)
  })

  test('draws every C0 control but the line break, DEL and every C1 control as the mark', () => {
    expect(shownText('a\u0000b\u0008c\u000bd\u001fe')).toBe(`a${CONTROL_SHOWN}b${CONTROL_SHOWN}c${CONTROL_SHOWN}d${CONTROL_SHOWN}e`)
    expect(shownText('a\u007fb')).toBe(`a${CONTROL_SHOWN}b`)
    expect(shownText('a\u0080b\u0085c\u009bd\u009fe')).toBe(`a${CONTROL_SHOWN}b${CONTROL_SHOWN}c${CONTROL_SHOWN}d${CONTROL_SHOWN}e`)
  })

  test('drops each mark that sets or overrides the direction of a run', () => {
    const marks = ['؜', '‎', '‏', '‪', '‫', '‬', '‭', '‮', '⁦', '⁧', '⁨', '⁩']
    for (const mark of marks) expect(shownText(`pay${mark}load`)).toBe('payload')
    expect(shownText('approved ‮denied‬')).toBe('approved denied')
  })

  test('keeps a line break, reads a Windows break as one, and draws a return alone as the mark', () => {
    expect(shownText('one\ntwo')).toBe('one\ntwo')
    expect(shownText('one\r\ntwo\r\n')).toBe('one\ntwo\n')
    expect(shownText('one\rtwo')).toBe(`one${CONTROL_SHOWN}two`)
  })

  test('draws a tab as one space', () => {
    expect(shownText('a\tb\t\tc')).toBe('a b  c')
  })

  test('keeps a joiner and a variation selector, which draw a letter or an emoji and move nothing', () => {
    expect(shownText('👩‍💻')).toBe('👩‍💻')
    expect(shownText('☺️')).toBe('☺️')
  })
})
