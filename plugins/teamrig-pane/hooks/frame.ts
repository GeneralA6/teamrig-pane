// The docked body cut to the rows its window shows. The dock's header stays fixed above the body, and the body
// scrolls under it in a window the pane keeps itself (T860): the engine scrolls a pane's whole tree, so the pane's
// tree stays as tall as the engine's window and holds only the body rows that meet the pane's own. Rows are counted
// as dockLayout wrapped them, one a line: an element's head (its Text's lines, or its parts when drawn as parts, the
// same lines), then its open card's parts, a Text or a press cut by lines and a line of presses kept whole or left out. The rows
// between two elements are slots of their own, so the window may start or end on one. Here too are what reads the
// window: a reveal's offset, the scroll bar, and a scroll move's offset.
import type { UiScrollInput } from 'claude-code'
import type { RevealBlock } from '../types'
import type { CardPart, Drawn } from './layout'
import type { Span } from './rows'

/** Rows a wheel tick or a scroll arrow moves the window. */
const WHEEL_ROWS = 3
const NEW_LINE: Span = { text: '\n' }
/** A line left empty by a cut, drawn so it keeps its row. */
const BLANK: Span = { text: ' ' }

/** A run of the body's rows: its first, and how many. */
export type Place = { readonly top: number; readonly rows: number }

/** A body element where it stands in the body, with its head's rows and each part's place: its own when drawn as parts, then its card's. */
export type Placed = Place & {
  readonly drawn: Drawn
  /** The head's rows: its Text's lines, its parts' when drawn as parts. */
  readonly headRows: number
  readonly parts: readonly (Place & { readonly part: CardPart })[]
}

/**
 * What the window holds: an element cut to its rows in view (`head` false when the cut leaves none of its head's
 * lines, so it draws its card alone), or the rows of a gap between two elements.
 */
export type FrameSlot =
  | { readonly kind: 'drawn'; readonly drawn: Drawn; readonly head: boolean }
  | { readonly kind: 'gap'; readonly key: string; readonly rows: number }

/** Where the window stands over the body. */
export type View = {
  /** The body's first row the window shows, 0 to `maxOffset`. */
  readonly offset: number
  /** The rows the window shows. */
  readonly visibleRows: number
  /** The body's rows, gaps counted. */
  readonly contentRows: number
  /** The last offset that fills the window: the body's rows less the window's, 0 when the body fits. */
  readonly maxOffset: number
}

/** The scroll bar's thumb: its first row in the bar's track, and its rows. */
export type Thumb = { readonly top: number; readonly size: number }

function within(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** Lines in spans joined into one Text: one, and one more for each new line. */
function linesOf(spans: readonly Span[]): number {
  return spans.reduce((lines, span) => lines + span.text.split('\n').length - 1, 1)
}

/** Rows a card part takes: a Text or a press its lines, a line with a task id one row. */
function partRows(part: CardPart): number {
  return part.kind === 'line' ? 1 : linesOf(part.spans)
}

/** Rows a body element takes, as dockLayout wrapped it: its Text's lines (its parts', when drawn as parts, are the same) and its open card's. */
export function rowsOf(drawn: Drawn): number {
  return linesOf(drawn.spans) + (drawn.card ?? []).reduce((rows, part) => rows + partRows(part), 0)
}

/**
 * Lines `skip` to `skip + take` of spans drawn as one Text, as spans: each keeps its look, a new line falls only
 * between two kept lines, and a kept line with no text is a blank, so each still takes its row.
 */
export function cutSpans(spans: readonly Span[], skip: number, take: number): Span[] {
  let line: Span[] = []
  const lines: Span[][] = [line]
  for (const span of spans)
    for (const [i, text] of span.text.split('\n').entries()) {
      if (i > 0) {
        line = []
        lines.push(line)
      }
      if (text !== '') line.push({ ...span, text })
    }
  return lines.slice(Math.max(0, skip), Math.max(0, skip + take)).flatMap((kept, i) => [...(i > 0 ? [NEW_LINE] : []), ...(kept.length > 0 ? kept : [BLANK])])
}

/** A card part's rows `skip` to `skip + take`: a Text or a press its lines, a line whole. */
function cutPart(part: CardPart, skip: number, take: number): CardPart {
  return part.kind === 'line' ? part : { ...part, spans: cutSpans(part.spans, skip, take) }
}

/** The parts whose rows, from `top` on, meet the body rows `from` to `to`, each cut to them. */
function cutParts(parts: readonly CardPart[], top: number, from: number, to: number): CardPart[] {
  const kept: CardPart[] = []
  let partTop = top
  for (const part of parts) {
    const rows = partRows(part)
    const first = Math.max(from, partTop)
    const last = Math.min(to, partTop + rows)
    if (first < last) kept.push(cutPart(part, first - partTop, last - first))
    partTop += rows
  }
  return kept
}

/**
 * A body element's rows `skip` to `skip + take`, as a slot draws it: `head` false when the cut leaves none of its
 * head's lines, so the slot draws its card alone. Every key stays (the element's, its parts'), and a line of presses
 * is never cut, so a press's key names the same press wherever the window stands. An element the cut leaves whole is
 * itself.
 */
export function cutDrawn(drawn: Drawn, skip: number, take: number): { readonly drawn: Drawn; readonly head: boolean } {
  if (skip <= 0 && skip + take >= rowsOf(drawn)) return { drawn, head: true }
  const end = skip + take
  const headRows = linesOf(drawn.spans)
  const head = skip < headRows
  const spans = head ? cutSpans(drawn.spans, skip, Math.min(end, headRows) - skip) : []
  return {
    drawn: {
      ...drawn,
      spans,
      ...(drawn.parts === undefined ? {} : { parts: cutParts(drawn.parts, 0, skip, end) }),
      ...(drawn.card === undefined ? {} : { card: cutParts(drawn.card, headRows, skip, end) }),
    },
    head,
  }
}

/** Each body element's place, `gap` rows between two, with its head's rows and its parts' places. */
export function placesOf(body: readonly Drawn[], gap: number): Placed[] {
  let top = 0
  return body.map(drawn => {
    const rows = rowsOf(drawn)
    const headRows = linesOf(drawn.spans)
    let partTop = drawn.parts === undefined ? top + headRows : top
    const parts = [...(drawn.parts ?? []), ...(drawn.card ?? [])].map(part => {
      const place = { part, top: partTop, rows: partRows(part) }
      partTop += place.rows
      return place
    })
    const placed = { drawn, top, rows, headRows, parts }
    top += rows + gap
    return placed
  })
}

/** The window of `visibleRows` rows at `offset` over the placed body, the offset held to 0 to the body's last. */
export function viewOf(places: readonly Placed[], offset: number, visibleRows: number): View {
  const last = places.at(-1)
  const contentRows = last === undefined ? 0 : last.top + last.rows
  const rows = Math.max(0, visibleRows)
  const maxOffset = Math.max(0, contentRows - rows)
  return { offset: within(offset, 0, maxOffset), visibleRows: rows, contentRows, maxOffset }
}

/**
 * What the window `view` (viewOf) holds of the placed body, in order: each element and gap whose rows meet it, cut
 * to them, a gap the rows from an element's last to the next's first.
 */
export function frameOf(places: readonly Placed[], view: View): FrameSlot[] {
  const end = view.offset + view.visibleRows
  const slots: FrameSlot[] = []
  for (const [i, placed] of places.entries()) {
    if (placed.top >= end) break
    const first = Math.max(view.offset, placed.top)
    const lastRow = Math.min(end, placed.top + placed.rows)
    if (first < lastRow) slots.push({ kind: 'drawn', ...cutDrawn(placed.drawn, first - placed.top, lastRow - first) })
    const next = places[i + 1]
    if (next === undefined) break
    const gapRows = Math.min(end, next.top) - Math.max(view.offset, placed.top + placed.rows)
    if (gapRows > 0) slots.push({ kind: 'gap', key: `gap:${placed.drawn.key}`, rows: gapRows })
  }
  return slots
}

/**
 * The offset that shows `target` where `block` asks: its first row at the window's top (`start`), its last at the
 * bottom (`end`), its middle at the middle (`center`), or, `nearest`, the least move that shows it whole (none
 * when it shows whole, or fills the window, already). A target taller than the window lands at its start; the
 * offset stays 0 to the view's last.
 */
export function revealed(target: Place, view: View, block: RevealBlock): number {
  const bottom = target.top + target.rows
  const fits = target.rows <= view.visibleRows
  const wanted = (): number => {
    if (block === 'nearest') {
      const shown = target.top >= view.offset && bottom <= view.offset + view.visibleRows
      const fills = target.top <= view.offset && bottom >= view.offset + view.visibleRows
      if (shown || fills) return view.offset
      return fits && target.top > view.offset ? bottom - view.visibleRows : target.top
    }
    if (!fits || block === 'start') return target.top
    return block === 'end' ? bottom - view.visibleRows : target.top - Math.floor((view.visibleRows - target.rows) / 2)
  }
  return within(wanted(), 0, view.maxOffset)
}

/**
 * The scroll bar's thumb in a track of `track` rows: as long against the track as the window against the body, one
 * row at least, at the top at offset 0 and the bottom at the last. None when the body fits the window.
 */
export function thumbOf(view: View, track: number): Thumb | null {
  if (view.contentRows <= view.visibleRows || track < 1) return null
  const size = within(Math.round((track * view.visibleRows) / view.contentRows), 1, track)
  return { top: Math.round(((track - size) * view.offset) / view.maxOffset), size }
}

/** `rows` empty lines as one Text's spans: a gap's rows in the window, each a blank so it keeps its row. */
export function blankSpans(rows: number): Span[] {
  return Array.from({ length: Math.max(0, rows) }, (_, i) => (i === 0 ? [BLANK] : [NEW_LINE, BLANK])).flat()
}

/**
 * The scroll bar beside the window as one Text's spans, a row a line: its thumb (thumbOf) `┃`, the rest of its track
 * a dim `│`. None when the body fits the window.
 */
export function barSpans(view: View): Span[] {
  const thumb = thumbOf(view, view.visibleRows)
  if (thumb === null) return []
  return Array.from({ length: view.visibleRows }, (_, row): Span[] => {
    const mark: Span = row >= thumb.top && row < thumb.top + thumb.size ? { text: '┃' } : { text: '│', dim: true }
    return row === 0 ? [mark] : [NEW_LINE, mark]
  }).flat()
}

/**
 * The offset after one of the person's scrolls: a wheel tick or an arrow WHEEL_ROWS rows, a page key the window,
 * a move the engine sizes as the whole of a tree taller than its window an end. Told apart by the rows the move
 * asks for against the engine's window and tree, as it sizes each; held to 0 to the view's last.
 */
export function scrolledBy(view: View, scroll: Pick<UiScrollInput, 'by' | 'bodyRows' | 'contentRows'>): number {
  const size = Math.abs(scroll.by)
  const isEnd = size >= scroll.contentRows && scroll.contentRows > scroll.bodyRows
  const step = isEnd ? view.maxOffset : size >= scroll.bodyRows ? Math.max(1, view.visibleRows) : size * WHEEL_ROWS
  return within(view.offset + Math.sign(scroll.by) * step, 0, view.maxOffset)
}
