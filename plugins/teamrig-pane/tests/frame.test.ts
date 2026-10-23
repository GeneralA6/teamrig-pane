// The docked body cut to its window's rows, and what reads the window: a reveal, the scroll bar, a scroll move.
import { describe, expect, test } from 'claude-code/testing'
import { cutDrawn, cutSpans, frameOf, placesOf, revealed, rowsOf, scrolledBy, thumbOf, type Frame, type View } from '../hooks/frame'
import type { CardPart, Drawn, Piece } from '../hooks/layout'
import type { Span } from '../hooks/rows'

/** A body element of `lines` lines, keyed `key`. */
function element(key: string, lines: number): Drawn {
  return { key, spans: [{ text: Array.from({ length: lines }, (_, i) => `${key} line ${i}`).join('\n') }], wrap: 'wrap', toggle: key }
}

/** An element with an open card: a two-line head, a two-line Text, a line of words and an id, a two-line press. */
const CARDED: Drawn = {
  key: 'c',
  spans: [{ text: 'c0\nc1' }],
  wrap: 'wrap',
  toggle: 'T1',
  card: [
    { kind: 'text', key: 'c.t', spans: [{ text: 'ct0\nct1' }] },
    { kind: 'line', key: 'c.l', pieces: [{ kind: 'words', spans: [{ text: 'cl ' }] }, { kind: 'id', task: 'T2', span: { text: 'T2' } }] },
    { kind: 'press', key: 'c.p', spans: [{ text: 'cp0\n' }, { text: 'cp1' }], expands: 'c.p' },
  ],
}

/** An element drawn as parts: a line of words, then a line whose inbox count is a press. */
const PARTED: Drawn = {
  key: 'd',
  spans: [{ text: 'd0\nd1 in' }],
  wrap: 'wrap',
  toggle: null,
  parts: [
    { kind: 'text', key: 'd.t', spans: [{ text: 'd0' }] },
    { kind: 'line', key: 'd.l', pieces: [{ kind: 'words', spans: [{ text: 'd1 ' }] }, { kind: 'inbox', area: 'po', span: { text: 'in' } }] },
  ],
}

/** One of each: a line, three lines, a card, parts, and two lines whose spans change look across a new line. */
const BODY: readonly Drawn[] = [
  { key: 'a', spans: [{ text: 'a0' }], wrap: 'wrap', toggle: 'a' },
  { key: 'b', spans: [{ text: 'b0\nb1\nb2' }], wrap: 'wrap', toggle: 'b' },
  CARDED,
  PARTED,
  { key: 'e', spans: [{ text: 'e0\n', bold: true }, { text: 'e1', dim: true }], wrap: 'wrap', toggle: 'e' },
]
/** BODY's rows with a gap of one between two elements: 1 + 3 + 7 + 2 + 2, and 4 gaps. */
const BODY_ROWS = 19

function textLines(spans: readonly Span[]): string[] {
  return spans.map(span => span.text).join('').split('\n')
}

function pieceText(piece: Piece): string {
  return piece.kind === 'words' ? piece.spans.map(span => span.text).join('') : piece.span.text
}

function partLines(part: CardPart): string[] {
  return part.kind === 'line' ? [part.pieces.map(pieceText).join('')] : textLines(part.spans)
}

/** The lines an element draws, row by row: its parts when drawn as parts, else its head's (when drawn) and its card's. */
function drawnLines(drawn: Drawn, head: boolean): string[] {
  if (drawn.parts !== undefined) return drawn.parts.flatMap(partLines)
  return [...(head ? textLines(drawn.spans) : []), ...(drawn.card ?? []).flatMap(partLines)]
}

/** The body's rows as text, a gap row as ''. */
function bodyLines(body: readonly Drawn[], gap: number): string[] {
  return body.flatMap((drawn, i) => [...(i > 0 ? Array.from({ length: gap }, () => '') : []), ...drawnLines(drawn, true)])
}

/** The rows a frame draws as text, a gap row as ''. */
function frameLines(frame: Frame): string[] {
  return frame.slots.flatMap(slot => (slot.kind === 'gap' ? Array.from({ length: slot.rows }, () => '') : drawnLines(slot.drawn, slot.head)))
}

describe('rowsOf', () => {
  test('counts an element its lines and its open card its parts, a line with a task id one row, a press row its lines', () => {
    expect(rowsOf(element('a', 1))).toBe(1)
    expect(rowsOf({ ...element('a', 2), spans: [{ text: 'one\n' }, { text: 'two\nthree' }] })).toBe(3)
    const card: Drawn['card'] = [
      { kind: 'text', key: 'c0', spans: [{ text: 'a\nb' }] },
      { kind: 'line', key: 'c1', pieces: [{ kind: 'id', task: 'T2', span: { text: 'T2' } }] },
    ]
    expect(rowsOf({ ...element('a', 2), card })).toBe(5)
    const pressed: Drawn['card'] = [{ kind: 'press', key: 'C:/r:a.ts', spans: [{ text: ' M a-long\n' }, { text: '   name.ts' }], expands: 'C:/r:a.ts' }]
    expect(rowsOf({ ...element('a', 1), card: pressed })).toBe(3)
  })
})

describe('cutSpans', () => {
  test('keeps the lines asked for, each span its look, a new line only between two kept', () => {
    const spans: Span[] = [{ text: 'a\nb', bold: true }, { text: 'c\nd', dim: true }]
    expect(cutSpans(spans, 1, 2)).toEqual([{ text: 'b', bold: true }, { text: 'c', dim: true }, { text: '\n' }, { text: 'd', dim: true }])
    expect(cutSpans(spans, 0, 1)).toEqual([{ text: 'a', bold: true }])
  })

  test('keeps a line left empty as a blank, so it keeps its row', () => {
    expect(cutSpans([{ text: 'a\n\nb' }], 1, 1)).toEqual([{ text: ' ' }])
    expect(cutSpans([], 0, 1)).toEqual([{ text: ' ' }])
  })

  test('keeps only the lines there are', () => {
    expect(cutSpans([{ text: 'a\nb' }], 1, 5)).toEqual([{ text: 'b' }])
  })
})

describe('cutDrawn', () => {
  test('an element the cut leaves whole is itself, its head drawn', () => {
    const cut = cutDrawn(CARDED, 0, 7)
    expect(cut.drawn).toBe(CARDED)
    expect(cut.head).toBe(true)
  })

  test('a cut past the head draws the card alone, its keys kept and a line of presses whole', () => {
    const cut = cutDrawn(CARDED, 2, 3)
    expect(cut.head).toBe(false)
    expect(cut.drawn.key).toBe('c')
    expect(cut.drawn.card?.map(part => part.key)).toEqual(['c.t', 'c.l'])
    expect(cut.drawn.card?.[1]).toBe(CARDED.card?.[1])
    expect(drawnLines(cut.drawn, cut.head)).toEqual(['ct0', 'ct1', 'cl T2'])
  })

  test('a cut through the head keeps its last lines and the card under them', () => {
    const cut = cutDrawn(CARDED, 1, 2)
    expect(cut.head).toBe(true)
    expect(drawnLines(cut.drawn, cut.head)).toEqual(['c1', 'ct0'])
  })

  test('an element drawn as parts is cut by its parts, its Text the same', () => {
    const cut = cutDrawn(PARTED, 1, 1)
    expect(cut.head).toBe(true)
    expect(cut.drawn.parts?.map(part => part.key)).toEqual(['d.l'])
    expect(cut.drawn.spans).toEqual([{ text: 'd1 in' }])
  })
})

describe('placesOf', () => {
  test('places each element a gap after the last, its parts after its head, an element drawn as parts from its top', () => {
    const places = placesOf(BODY, 1)
    expect(places.map(({ drawn, top, rows, headRows }) => ({ key: drawn.key, top, rows, headRows }))).toEqual([
      { key: 'a', top: 0, rows: 1, headRows: 1 },
      { key: 'b', top: 2, rows: 3, headRows: 3 },
      { key: 'c', top: 6, rows: 7, headRows: 2 },
      { key: 'd', top: 14, rows: 2, headRows: 2 },
      { key: 'e', top: 17, rows: 2, headRows: 2 },
    ])
    expect(places[2]?.parts).toEqual([
      { key: 'c.t', top: 8, rows: 2 },
      { key: 'c.l', top: 10, rows: 1 },
      { key: 'c.p', top: 11, rows: 2 },
    ])
    expect(places[3]?.parts).toEqual([
      { key: 'd.t', top: 14, rows: 1 },
      { key: 'd.l', top: 15, rows: 1 },
    ])
  })
})

describe('frameOf', () => {
  test('shows exactly the window of the body rows, wherever it stands and whatever its height', () => {
    const lines = bodyLines(BODY, 1)
    expect(lines).toHaveLength(BODY_ROWS)
    for (const visibleRows of [1, 4, BODY_ROWS, 30])
      for (let offset = -2; offset <= BODY_ROWS + 2; offset++) {
        const frame = frameOf(BODY, { offset, visibleRows, gap: 1 })
        const maxOffset = Math.max(0, BODY_ROWS - visibleRows)
        const held = Math.max(0, Math.min(maxOffset, offset))
        expect({ offset: frame.offset, maxOffset: frame.maxOffset, contentRows: frame.contentRows }).toEqual({ offset: held, maxOffset, contentRows: BODY_ROWS })
        expect(frameLines(frame)).toEqual(lines.slice(held, held + visibleRows))
      }
  })

  test('a window that starts on a gap starts with it', () => {
    const frame = frameOf(BODY, { offset: 1, visibleRows: 2, gap: 1 })
    expect(frame.slots[0]).toEqual({ kind: 'gap', key: 'gap:a', rows: 1 })
    expect(frame.slots.map(slot => (slot.kind === 'gap' ? slot.key : slot.drawn.key))).toEqual(['gap:a', 'b'])
  })

  test('a body that fits draws each element itself, and no gap slot when there are no gap rows', () => {
    const frame = frameOf(BODY, { offset: 3, visibleRows: 40, gap: 0 })
    expect(frame.offset).toBe(0)
    expect(frame.slots).toHaveLength(BODY.length)
    expect(frame.slots.every((slot, i) => slot.kind === 'drawn' && slot.drawn === BODY[i])).toBe(true)
  })

  test('an empty body, or a window of no rows, holds nothing', () => {
    expect(frameOf([], { offset: 5, visibleRows: 4, gap: 1 })).toEqual({ slots: [], offset: 0, visibleRows: 4, contentRows: 0, maxOffset: 0 })
    expect(frameOf(BODY, { offset: 3, visibleRows: 0, gap: 1 }).slots).toEqual([])
  })
})

describe('revealed', () => {
  const view: View = { offset: 10, visibleRows: 5, contentRows: 40, maxOffset: 35 }

  test('lands the target at the start, the end or the centre', () => {
    expect(revealed({ top: 20, rows: 2 }, view, 'start')).toBe(20)
    expect(revealed({ top: 20, rows: 2 }, view, 'end')).toBe(17)
    expect(revealed({ top: 20, rows: 1 }, view, 'center')).toBe(18)
  })

  test('nearest moves the least that shows the target whole, and not at all when it shows or fills the window', () => {
    expect(revealed({ top: 11, rows: 2 }, view, 'nearest')).toBe(10)
    expect(revealed({ top: 8, rows: 10 }, view, 'nearest')).toBe(10)
    expect(revealed({ top: 4, rows: 2 }, view, 'nearest')).toBe(4)
    expect(revealed({ top: 20, rows: 2 }, view, 'nearest')).toBe(17)
  })

  test('a target taller than the window lands at its start', () => {
    expect(revealed({ top: 20, rows: 8 }, view, 'nearest')).toBe(20)
    expect(revealed({ top: 20, rows: 8 }, view, 'end')).toBe(20)
    expect(revealed({ top: 20, rows: 8 }, view, 'center')).toBe(20)
  })

  test('the offset stays inside the body', () => {
    expect(revealed({ top: 38, rows: 2 }, view, 'start')).toBe(35)
    expect(revealed({ top: 0, rows: 1 }, view, 'center')).toBe(0)
  })
})

describe('thumbOf', () => {
  const view: View = { offset: 0, visibleRows: 10, contentRows: 40, maxOffset: 30 }

  test('no thumb when the body fits, or there is no track', () => {
    expect(thumbOf({ offset: 0, visibleRows: 10, contentRows: 10, maxOffset: 0 }, 10)).toBeNull()
    expect(thumbOf(view, 0)).toBeNull()
  })

  test('as long against the track as the window against the body, at the top first and the bottom last', () => {
    expect(thumbOf(view, 10)).toEqual({ top: 0, size: 3 })
    expect(thumbOf({ ...view, offset: 15 }, 10)).toEqual({ top: 4, size: 3 })
    expect(thumbOf({ ...view, offset: 30 }, 10)).toEqual({ top: 7, size: 3 })
  })

  test('one row at least', () => {
    expect(thumbOf({ offset: 990, visibleRows: 10, contentRows: 1000, maxOffset: 990 }, 10)).toEqual({ top: 9, size: 1 })
  })
})

describe('scrolledBy', () => {
  const view: View = { offset: 10, visibleRows: 8, contentRows: 50, maxOffset: 42 }
  /** The engine's window and tree as the pane draws them: the tree exactly the window's rows. */
  const tree = { bodyRows: 12, contentRows: 12 }

  test('a wheel tick or an arrow moves three rows a tick, either way', () => {
    expect(scrolledBy(view, { ...tree, by: 1 })).toBe(13)
    expect(scrolledBy(view, { ...tree, by: -2 })).toBe(4)
  })

  test('a page key moves the window, and so do Home and End over a tree the window holds', () => {
    expect(scrolledBy(view, { ...tree, by: 12 })).toBe(18)
    expect(scrolledBy(view, { ...tree, by: -12 })).toBe(2)
    expect(scrolledBy(view, { ...tree, by: -100 })).toBe(2)
  })

  test('a move the size of a tree taller than its window goes to an end', () => {
    expect(scrolledBy(view, { bodyRows: 12, contentRows: 30, by: 30 })).toBe(42)
    expect(scrolledBy(view, { bodyRows: 12, contentRows: 30, by: -30 })).toBe(0)
  })

  test('the offset stays inside the body', () => {
    expect(scrolledBy({ ...view, offset: 40 }, { ...tree, by: 12 })).toBe(42)
    expect(scrolledBy({ ...view, offset: 1 }, { ...tree, by: -1 })).toBe(0)
  })
})
