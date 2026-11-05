// The docked body cut to its window's rows, and what reads the window: a reveal, the scroll bar, a scroll move.
import { describe, expect, test } from 'claude-code/testing'
import { barSpans, blankSpans, cutDrawn, cutSpans, frameOf, placesOf, revealed, rowsOf, scrolledBy, thumbOf, viewOf, type FrameSlot, type View } from '../hooks/frame'
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
    { kind: 'line', key: 'd.l', pieces: [{ kind: 'words', spans: [{ text: 'd1 ' }] }, { kind: 'inbox', inbox: { area: 'po', unread: 1 }, span: { text: 'in' } }] },
  ],
}

/** A Teams tab leader drawn as parts, its fold mark and its id presses, its card open under them: a line, then a two-line Text. */
const LED: Drawn = {
  key: 'f',
  spans: [{ text: '▾ f' }],
  wrap: 'wrap',
  toggle: null,
  parts: [
    {
      kind: 'line',
      key: 'f.l',
      pieces: [
        { kind: 'toggle', toggles: 'f', span: { text: '▾ ' } },
        { kind: 'toggle', toggles: 'card:f', span: { text: 'f' } },
      ],
    },
  ],
  card: [{ kind: 'text', key: 'f.t', spans: [{ text: 'ft0\nft1' }] }],
}

/** One of each: a line, three lines, a card, parts, two lines whose spans change look across a new line, and parts with a card. */
const BODY: readonly Drawn[] = [
  { key: 'a', spans: [{ text: 'a0' }], wrap: 'wrap', toggle: 'a' },
  { key: 'b', spans: [{ text: 'b0\nb1\nb2' }], wrap: 'wrap', toggle: 'b' },
  CARDED,
  PARTED,
  { key: 'e', spans: [{ text: 'e0\n', bold: true }, { text: 'e1', dim: true }], wrap: 'wrap', toggle: 'e' },
  LED,
]
/** BODY's rows with a gap of one between two elements: 1 + 3 + 7 + 2 + 2 + 3, and 5 gaps. */
const BODY_ROWS = 23

function textLines(spans: readonly Span[]): string[] {
  return spans.map(span => span.text).join('').split('\n')
}

function pieceText(piece: Piece): string {
  return piece.kind === 'words' ? piece.spans.map(span => span.text).join('') : piece.span.text
}

function partLines(part: CardPart): string[] {
  if (part.kind === 'field') return [`[${part.key}]`]
  return part.kind === 'line' ? [part.pieces.map(pieceText).join('')] : textLines(part.spans)
}

/** The lines an element draws, row by row: its parts when drawn as parts, else its head's (when drawn), then its card's. */
function drawnLines(drawn: Drawn, head: boolean): string[] {
  const card = (drawn.card ?? []).flatMap(partLines)
  if (drawn.parts !== undefined) return [...drawn.parts.flatMap(partLines), ...card]
  return [...(head ? textLines(drawn.spans) : []), ...card]
}

/** The body's rows as text, a gap row as ''. */
function bodyLines(body: readonly Drawn[], gap: number): string[] {
  return body.flatMap((drawn, i) => [...(i > 0 && drawn.joined !== true ? Array.from({ length: gap }, () => '') : []), ...drawnLines(drawn, true)])
}

/** A body whose second and fourth elements sit right under the one before. */
const JOINED_BODY: readonly Drawn[] = [element('a', 1), { ...element('b', 2), joined: true }, element('c', 1), { ...element('d', 1), joined: true }]

/** The rows a frame's slots draw as text, a gap row as ''. */
function frameLines(slots: readonly FrameSlot[]): string[] {
  return slots.flatMap(slot => (slot.kind === 'gap' ? Array.from({ length: slot.rows }, () => '') : drawnLines(slot.drawn, slot.head)))
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
    expect(rowsOf(LED)).toBe(3)
  })

  test('counts a Note field one row, and a cut through its card keeps it whole', () => {
    const field: CardPart = { kind: 'field', key: 'T1:field', field: { task: 'T1', round: 1 } }
    const noted: Drawn = { ...element('a', 2), card: [{ kind: 'text', key: 't', spans: [{ text: 't0' }] }, field] }
    expect(rowsOf(noted)).toBe(4)
    expect(cutDrawn(noted, 3, 1).drawn.card).toEqual([field])
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

  test('an element drawn as parts with its card open is cut by both, its card alone once the cut passes its head', () => {
    const card = cutDrawn(LED, 1, 1)
    expect(card.head).toBe(false)
    expect(card.drawn.parts).toEqual([])
    expect(drawnLines(card.drawn, card.head)).toEqual(['ft0'])
    const both = cutDrawn(LED, 0, 2)
    expect(both.head).toBe(true)
    expect(both.drawn.parts?.[0]).toBe(LED.parts?.[0])
    expect(drawnLines(both.drawn, both.head)).toEqual(['▾ f', 'ft0'])
  })
})

describe('placesOf', () => {
  test('places each element a gap after the last, its parts after its head, an element drawn as parts from its top, its card after them', () => {
    const places = placesOf(BODY, 1)
    expect(places.map(({ drawn, top, rows, headRows }) => ({ key: drawn.key, top, rows, headRows }))).toEqual([
      { key: 'a', top: 0, rows: 1, headRows: 1 },
      { key: 'b', top: 2, rows: 3, headRows: 3 },
      { key: 'c', top: 6, rows: 7, headRows: 2 },
      { key: 'd', top: 14, rows: 2, headRows: 2 },
      { key: 'e', top: 17, rows: 2, headRows: 2 },
      { key: 'f', top: 20, rows: 3, headRows: 1 },
    ])
    const partPlaces = (i: number) => places[i]?.parts.map(({ part, top, rows }) => ({ key: part.key, top, rows }))
    expect(partPlaces(2)).toEqual([
      { key: 'c.t', top: 8, rows: 2 },
      { key: 'c.l', top: 10, rows: 1 },
      { key: 'c.p', top: 11, rows: 2 },
    ])
    expect(partPlaces(3)).toEqual([
      { key: 'd.t', top: 14, rows: 1 },
      { key: 'd.l', top: 15, rows: 1 },
    ])
    expect(partPlaces(5)).toEqual([
      { key: 'f.l', top: 20, rows: 1 },
      { key: 'f.t', top: 21, rows: 2 },
    ])
    expect(places[2]?.parts[1]?.part).toBe(CARDED.card?.[1])
  })
})

describe('viewOf', () => {
  test("holds the offset to 0 to the body's last, and counts the body's rows, gaps too", () => {
    const places = placesOf(BODY, 1)
    expect(viewOf(places, 30, 4)).toEqual({ offset: 19, visibleRows: 4, contentRows: BODY_ROWS, maxOffset: 19 })
    expect(viewOf(places, -2, 4).offset).toBe(0)
    expect(viewOf(places, 3, 40)).toEqual({ offset: 0, visibleRows: 40, contentRows: BODY_ROWS, maxOffset: 0 })
  })

  test('an empty body has no rows, and a window no fewer than none', () => {
    expect(viewOf([], 5, 4)).toEqual({ offset: 0, visibleRows: 4, contentRows: 0, maxOffset: 0 })
    expect(viewOf(placesOf(BODY, 1), 3, -1)).toEqual({ offset: 3, visibleRows: 0, contentRows: BODY_ROWS, maxOffset: BODY_ROWS })
  })
})

describe('frameOf', () => {
  test('shows exactly the window of the body rows, wherever it stands, whatever its height and gap', () => {
    expect(bodyLines(BODY, 1)).toHaveLength(BODY_ROWS)
    for (const gap of [0, 1, 2]) {
      const lines = bodyLines(BODY, gap)
      const places = placesOf(BODY, gap)
      for (const visibleRows of [1, 4, lines.length, 30])
        for (let offset = -2; offset <= lines.length + 2; offset++) {
          const view = viewOf(places, offset, visibleRows)
          expect(view.offset).toBe(Math.max(0, Math.min(lines.length - visibleRows, offset)))
          expect(frameLines(frameOf(places, view))).toEqual(lines.slice(view.offset, view.offset + visibleRows))
        }
    }
  })

  test('places a joined element right under the one before, and draws no gap slot there', () => {
    const places = placesOf(JOINED_BODY, 1)
    expect(places.map(({ drawn, top }) => [drawn.key, top])).toEqual([['a', 0], ['b', 1], ['c', 4], ['d', 5]])
    const slots = frameOf(places, viewOf(places, 0, 40))
    expect(slots.map(slot => (slot.kind === 'gap' ? slot.key : slot.drawn.key))).toEqual(['a', 'b', 'gap:b', 'c', 'd'])
  })

  test('a joined body shows exactly the window of its rows, wherever it stands', () => {
    const lines = bodyLines(JOINED_BODY, 1)
    const places = placesOf(JOINED_BODY, 1)
    for (const visibleRows of [1, 2, lines.length])
      for (let offset = 0; offset <= lines.length; offset++) {
        const view = viewOf(places, offset, visibleRows)
        expect(frameLines(frameOf(places, view))).toEqual(lines.slice(view.offset, view.offset + visibleRows))
      }
  })

  test('a window of no end draws the whole body', () => {
    const places = placesOf(JOINED_BODY, 1)
    expect(frameLines(frameOf(places, viewOf(places, 0, Number.POSITIVE_INFINITY)))).toEqual(bodyLines(JOINED_BODY, 1))
  })

  test('a window that starts on a gap starts with it', () => {
    const places = placesOf(BODY, 1)
    const slots = frameOf(places, viewOf(places, 1, 2))
    expect(slots[0]).toEqual({ kind: 'gap', key: 'gap:a', rows: 1 })
    expect(slots.map(slot => (slot.kind === 'gap' ? slot.key : slot.drawn.key))).toEqual(['gap:a', 'b'])
  })

  test('a body that fits draws each element itself, and no gap slot when there are no gap rows', () => {
    const places = placesOf(BODY, 0)
    const slots = frameOf(places, viewOf(places, 3, 40))
    expect(slots).toHaveLength(BODY.length)
    expect(slots.every((slot, i) => slot.kind === 'drawn' && slot.drawn === BODY[i])).toBe(true)
  })

  test('an empty body, or a window of no rows, holds nothing', () => {
    expect(frameOf([], viewOf([], 5, 4))).toEqual([])
    const places = placesOf(BODY, 1)
    expect(frameOf(places, viewOf(places, 3, 0))).toEqual([])
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

describe('blankSpans', () => {
  test('a blank a row, a new line between two, none for no rows', () => {
    expect(blankSpans(3).map(span => span.text).join('')).toBe(' \n \n ')
    expect(blankSpans(0)).toEqual([])
  })
})

describe('barSpans', () => {
  test("a row a line beside the window: the thumb's rows bold marks, the track's dim", () => {
    const spans = barSpans({ offset: 15, visibleRows: 10, contentRows: 40, maxOffset: 30 })
    expect(spans.map(span => span.text).join('')).toBe('│\n│\n│\n│\n┃\n┃\n┃\n│\n│\n│')
    expect(spans.filter(span => span.text !== '\n').map(span => span.dim === true)).toEqual([true, true, true, true, false, false, false, true, true, true])
  })

  test('no bar when the body fits the window', () => {
    expect(barSpans({ offset: 0, visibleRows: 10, contentRows: 10, maxOffset: 0 })).toEqual([])
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
