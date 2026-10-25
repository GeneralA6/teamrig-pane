// Markdown as rows' spans (hooks/markdown.ts): inline marks as styles, headings, items, quotes, fenced blocks,
// rules and tables drawn without their marks, paragraphs split as a file page's, each line keeping its number.
import { describe, expect, test } from 'claude-code/testing'
import { inlineSpans, markdownParagraphs, type MarkParagraph } from '../hooks/markdown'

/** Each paragraph as its first line's number and its lines' words. */
const words = (found: MarkParagraph[]): [number, string[]][] => found.map(paragraph => [paragraph.first, paragraph.lines.map(line => line.spans.map(span => span.text).join(''))])

describe('inlineSpans', () => {
  test('bold, code and a web link become styles; the words between them stay plain', () => {
    expect(inlineSpans('run **npm test** with `--watch`, see [the guide](https://example.com/g) now')).toEqual([
      { text: 'run ' },
      { text: 'npm test', bold: true },
      { text: ' with ' },
      { text: '--watch', color: 'suggestion' },
      { text: ', see ' },
      { text: 'the guide', href: 'https://example.com/g' },
      { text: ' now' },
    ])
  })

  test('a link to a path and a lone star stay as written', () => {
    expect(inlineSpans('[log](src/log.ts) a*b')).toEqual([{ text: '[log](src/log.ts) a*b' }])
    expect(inlineSpans('')).toEqual([])
  })
})

describe('markdownParagraphs', () => {
  test('a heading is bold, an item a bullet and a numbered item its number, each wrapping under its words', () => {
    const [first] = markdownParagraphs('## Plan **now**\n- one `a`\n  * two\n12. three')
    expect(first?.lines).toEqual([
      { at: 1, spans: [{ text: 'Plan ', bold: true }, { text: 'now', bold: true }], hang: undefined, rule: false },
      { at: 2, spans: [{ text: '• ' }, { text: 'one ' }, { text: 'a', color: 'suggestion' }], hang: { text: '  ' }, rule: false },
      { at: 3, spans: [{ text: '  • ' }, { text: 'two' }], hang: { text: '    ' }, rule: false },
      { at: 4, spans: [{ text: '12. ' }, { text: 'three' }], hang: { text: '    ' }, rule: false },
    ])
  })

  test('a quote is drawn behind a dim bar, a --- line is a rule, and a plain line keeps its indent', () => {
    const [first] = markdownParagraphs('> said **so**\n---\n   kept\n>=6 stays\n  > deep')
    expect(first?.lines).toEqual([
      { at: 1, spans: [{ text: '│ ', dim: true }, { text: 'said ' }, { text: 'so', bold: true }], hang: { text: '│ ', dim: true }, rule: false },
      { at: 2, spans: [], hang: undefined, rule: true },
      { at: 3, spans: [{ text: '   kept' }], hang: { text: '   ' }, rule: false },
      { at: 4, spans: [{ text: '>=6 stays' }], hang: undefined, rule: false },
      { at: 5, spans: [{ text: '  ' }, { text: '│ ', dim: true }, { text: 'deep' }], hang: { text: '  │ ', dim: true }, rule: false },
    ])
  })

  test("a fenced block's lines are drawn as written behind a dim bar, across its blank lines, its fences dropped", () => {
    const found = markdownParagraphs('Run:\n```sh\nnpm **test**\n\n  echo `x`\n```\nafter')
    expect(words(found)).toEqual([
      [1, ['Run:', '│ npm **test**']],
      [5, ['│   echo `x`', 'after']],
    ])
    expect(found[1]?.lines[0]?.hang).toEqual({ text: '│   ', dim: true })
    // A paragraph that is only a fence draws nothing.
    expect(words(markdownParagraphs('a\n\n```\n\nb\n\n```'))).toEqual([[1, ['a']], [5, ['│ b']]])
  })

  test("a table's cells are drawn between dim bars, its head bold, its rule line dropped, each line keeping its number", () => {
    const [first] = markdownParagraphs('| Skill | Use |\n| --- | :---: |\n| `dev-add` | a **new** command |')
    expect(words(first === undefined ? [] : [first])).toEqual([[1, ['Skill │ Use', 'dev-add │ a new command']]])
    expect(first?.lines.map(line => line.at)).toEqual([1, 3])
    expect(first?.lines[0]?.spans).toEqual([{ text: 'Skill', bold: true }, { text: ' │ ', dim: true }, { text: 'Use', bold: true }])
    expect(first?.lines[1]?.spans[0]).toEqual({ text: 'dev-add', color: 'suggestion' })
    // A table with no rule line has no head.
    expect(markdownParagraphs('| a | b |')[0]?.lines[0]?.spans).toEqual([{ text: 'a' }, { text: ' │ ', dim: true }, { text: 'b' }])
  })

  test('paragraphs split at blank lines, as a file page splits them, and an empty text has none', () => {
    expect(words(markdownParagraphs('one\n\n\ntwo\r\nthree'))).toEqual([[1, ['one']], [4, ['two', 'three']]])
    expect(markdownParagraphs('')).toEqual([])
  })
})
