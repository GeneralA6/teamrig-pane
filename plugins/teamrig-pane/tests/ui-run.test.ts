// The dedicated UI's text: a span as a run, a run as the escape codes a terminal reads, and no control character
// of the data let through.
import { describe, expect, test } from 'claude-code/testing'
import { TONES } from '../hooks/tone'
import { drawable, printed, printedLine, runOf, TONE_SGR, words } from '../ui/run'

const ESC = '\u001b'

describe('a run', () => {
  test('plain words print as they are, no code around them', () => {
    expect(printed(words('T12 Ship the tab'))).toBe('T12 Ship the tab')
  })

  test('no words print nothing, whatever the style', () => {
    expect(printed({ ...words(''), bold: true, href: 'https://example.com/' })).toBe('')
  })

  test("a span's style is set before its words and reset after: bold, dim, underline, then its tone", () => {
    expect(printed(runOf({ text: 'late', bold: true, dim: true, underline: true, color: 'error' }))).toBe(`${ESC}[1;2;4;31mlate${ESC}[0m`)
    expect(printed(runOf({ text: 'ok', color: 'success' }))).toBe(`${ESC}[32mok${ESC}[0m`)
    expect(printed(runOf({ text: 'plain', bold: false, color: undefined }))).toBe('plain')
  })

  test('the press the ring stands on prints inverse', () => {
    expect(printed({ ...words('[ Tasks ]'), inverse: true })).toBe(`${ESC}[7m[ Tasks ]${ESC}[0m`)
  })

  test('every tone has a foreground color of its own', () => {
    const codes = TONES.map(tone => TONE_SGR[tone])
    expect(new Set(codes).size).toBe(TONES.length)
    for (const code of codes) expect((code >= 30 && code <= 37) || (code >= 90 && code <= 97)).toBe(true)
  })

  test('a link wraps the styled words in OSC 8 and ends after them', () => {
    expect(printed(runOf({ text: '#12', href: 'https://example.com/12', underline: true }))).toBe(
      `${ESC}]8;;https://example.com/12${ESC}\\${ESC}[4m#12${ESC}[0m${ESC}]8;;${ESC}\\`,
    )
  })

  test('a link that holds a control character is no link: the words print alone', () => {
    expect(printed(runOf({ text: 'x', href: `https://example.com/${ESC}]0;owned\u0007` }))).toBe('x')
    expect(printed(runOf({ text: 'x', href: '' }))).toBe('x')
  })
})

describe('what the data may draw', () => {
  test('a tab is a space; an escape, a bell, a line end and a C1 code are gone', () => {
    expect(drawable('a\tb')).toBe('a b')
    expect(drawable(`a${ESC}[2Jb\u0007c\r\nd\u009be`)).toBe('a[2Jbcde')
  })

  test("a span's and plain words' text reach the terminal with no control character", () => {
    expect(runOf({ text: `Fix${ESC}[31m it` }).text).toBe('Fix[31m it')
    expect(words(`a\u0000b`).text).toBe('ab')
  })

  test('words past the Latin range are left as they are', () => {
    expect(drawable('שלום › ✓ 你好')).toBe('שלום › ✓ 你好')
  })
})

describe('a line', () => {
  test('prints its runs side by side, each with its own style', () => {
    expect(printedLine([words('T1 '), runOf({ text: 'waiting', color: 'warning' }), words('')])).toBe(`T1 ${ESC}[33mwaiting${ESC}[0m`)
  })
})
