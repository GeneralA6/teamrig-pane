import { describe, expect, test } from 'claude-code/testing'
import { idSpans } from '../hooks/ids'
import type { Span } from '../hooks/rows'

/** Every id is a task the snapshot holds but T99. */
const known = (id: string) => id !== 'T99'
/** Each span as `[text]` for an id (its task checked to be its text), the words as they are. */
const words = (spans: readonly Span[]) =>
  spans.map(span => (span.task === undefined ? span.text : span.task === span.text ? `[${span.text}]` : `?${span.text}`)).join('|')

describe('ids', () => {
  test('each id the snapshot holds is a span of its own, marked with its task, the words between them kept', async () => {
    expect(words(idSpans({ text: 'T5 done, T6 open' }, known))).toBe('[T5]| done, |[T6]| open')
    expect(words(idSpans({ text: 'on T6 ready' }, known))).toBe('on |[T6]| ready')
    expect(words(idSpans({ text: 'T12' }, known))).toBe('[T12]')
  })

  test('an id the snapshot does not hold stays in the words; a span with no id comes back as it was', async () => {
    expect(words(idSpans({ text: 'after T99 and T6' }, known))).toBe('after T99 and |[T6]')
    const plain: Span = { text: 'decision owner', color: 'error' }
    expect(idSpans(plain, known)).toEqual([plain])
    expect(idSpans({ text: 'only T99 here' }, known)).toEqual([{ text: 'only T99 here' }])
  })

  test('an id is a word of its own: punctuation around it holds one, letters, digits or a leading zero do not', async () => {
    expect(words(idSpans({ text: '(T6), "T7"; T8. T6-T9: T10!' }, known))).toBe('(|[T6]|), "|[T7]|"; |[T8]|. |[T6]|-|[T9]|: |[T10]|!')
    expect(words(idSpans({ text: 'T06 T6a AT6 T6_x t6 T0 T' }, known))).toBe('T06 T6a AT6 T6_x t6 T0 T')
  })

  test('an id inside a web address stays in the address', async () => {
    expect(words(idSpans({ text: 'see https://example.com/T6/T7 for T7' }, known))).toBe('see https://example.com/T6/T7 for |[T7]')
  })

  test("each piece keeps the span's style", async () => {
    expect(idSpans({ text: 'on T6 ready', color: 'error', dim: true }, known)).toEqual([
      { text: 'on ', color: 'error', dim: true },
      { text: 'T6', color: 'error', dim: true, task: 'T6' },
      { text: ' ready', color: 'error', dim: true },
    ])
  })
})
