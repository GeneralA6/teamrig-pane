// Lays the pane's blocks (rows.ts) out for where the pane sits. Docked, each block is one Text:
// its rows word-wrapped to the body's columns here, so a wrapped line starts under its row's
// `hang` (a task's title under its id, a detail under its guide) rather than at the pane's edge,
// and the root Box's gap spaces the blocks. Wrapping here instead of nesting a Box per row keeps a
// block one element, the cost rows.ts explains. A row can be cut at a few lines, ending in `…`, and
// can carry an `end` drawn at its first line's right edge. Inline, above the prompt, each row is one
// truncated screen row and the rows are capped. Widths are display cells (width.ts), so CJK and emoji
// sequences wrap where the terminal wraps them and a cut never lands inside one.
import type { Block, Row, Span } from './rows'
import { cells, graphemes } from './width'

/** One element of the body: a Text, inside the Button that expands its task when `toggle` names one. */
export type Drawn = { key: string; spans: Span[]; wrap: 'wrap' | 'truncate-end'; toggle: string | null }

const RULE = '─'
const BLANK_LINE: Span = { text: ' ' }
const ELLIPSIS = '…'
/** Between a row's text and its `end`. */
const END_GAP = '  '
/** A row draws its `end` at the right edge only when that leaves its text at least this many cells. */
const MIN_BESIDE_END = 8
const NEW_LINE: Span = { text: '\n' }

/** How many of `parts` (graphemes), from the first, fit in `room` cells: none when the first does not. */
function fitting(parts: readonly string[], room: number): number {
  let width = 0
  let count = 0
  for (const part of parts) {
    width += cells(part)
    if (width > room) break
    count++
  }
  return count
}

/** `hang` cut to `room` cells, so a wrapped line keeps the rest of its width for text. */
function hangWithin(hang: Span, room: number): Span {
  if (cells(hang.text) <= room) return hang
  const parts = graphemes(hang.text)
  return { ...hang, text: parts.slice(0, fitting(parts, room)).join('') }
}

function sameStyle(a: Span, b: Span): boolean {
  return a.color === b.color && a.bold === b.bold && a.dim === b.dim
}

/** Spans with each run of one style joined into one span, so a block draws as few elements as it can. */
export function merged(spans: readonly Span[]): Span[] {
  const out: Span[] = []
  for (const span of spans) {
    const last = out[out.length - 1]
    if (span.text === '') continue
    if (last !== undefined && sameStyle(last, span)) out[out.length - 1] = { ...last, text: last.text + span.text }
    else out.push(span)
  }
  return out
}

/**
 * A row's lines in `columns` cells: words filled greedily, each line after the first starting with
 * the row's hang (cut to half the line in a narrow pane), a word wider than a line cut. A rule row
 * fills its last line with a dim rule. A row with `maxLines` stops there, its last line ending in `…`;
 * a row with an `end` draws it at the right edge of its first line, the text wrapping in the room left
 * of it, or after the text when the line leaves under MIN_BESIDE_END cells for it.
 */
export function wrapRow(row: Row, columns: number): Span[][] {
  const end = row.end
  const reserve = end === undefined ? 0 : cells(end.text) + END_GAP.length
  const beside = end !== undefined && columns - reserve >= MIN_BESIDE_END
  const width = beside ? columns - reserve : columns
  const spans = end === undefined || beside ? row.spans : [...row.spans, { text: END_GAP }, end]
  const filled = fill(spans, row.hang, width, row.rule === true)
  const lines = row.maxLines !== undefined && filled.length > row.maxLines ? cut(filled, Math.max(1, row.maxLines), width) : filled.map(trimEnd)
  const first = lines[0]
  if (beside && first !== undefined) first.push({ text: ' '.repeat(columns - reserve - lineCells(first) + END_GAP.length) }, end)
  return lines.map(merged)
}

/** The lines `spans` fill in `columns` cells, each after the first led by `hang`; untrimmed. */
function fill(spans: readonly Span[], rowHang: Span | undefined, columns: number, rule: boolean): Span[][] {
  const hang = hangWithin(rowHang ?? { text: '' }, Math.floor(columns / 2))
  const start = cells(hang.text)
  const lines: Span[][] = [[]]
  let column = 0
  const put = (span: Span) => {
    lines[lines.length - 1]?.push(span)
    column += cells(span.text)
  }
  const breakLine = () => {
    lines.push([])
    column = 0
    put(hang)
  }
  for (const span of spans) {
    for (const token of span.text.split(/( +)/)) {
      if (token === '') continue
      const width = cells(token)
      if (column + width <= columns) {
        put({ ...span, text: token })
        continue
      }
      // Spaces that do not fit end the line; a word starts the next one.
      if (token.trim() === '') {
        breakLine()
        continue
      }
      // A word that fits a fresh line moves there; a wider one is cut, from here, to each line's room:
      // a character with no room left on its line starts the next, and one wider than a whole fresh
      // line (a pane a cell or two wide) is put there anyway, so the cut moves on.
      if (column > start && width <= columns - start) breakLine()
      let rest = graphemes(token)
      while (rest.length > 0 && cells(rest.join('')) > columns - column) {
        const take = fitting(rest, columns - column)
        if (take === 0 && column > start) {
          breakLine()
          continue
        }
        const cut = Math.max(1, take)
        put({ ...span, text: rest.slice(0, cut).join('') })
        rest = rest.slice(cut)
        if (rest.length > 0) breakLine()
      }
      if (rest.length > 0) put({ ...span, text: rest.join('') })
    }
  }
  if (rule) {
    const last = lines[lines.length - 1]
    const room = columns - column
    if (last !== undefined && room > 0) last.push({ text: `${room > 1 ? ' ' : ''}${RULE.repeat(Math.max(1, room - 1))}`, dim: true })
  }
  return lines
}

function lineCells(line: readonly Span[]): number {
  return line.reduce((sum, span) => sum + cells(span.text), 0)
}

/**
 * The first `max` of `lines`, trimmed, the last ending in `…` in its last span's style: graphemes dropped from its
 * end, then its trailing spaces, until the mark fits in `columns`.
 */
function cut(lines: readonly Span[][], max: number, columns: number): Span[][] {
  const kept = lines.slice(0, max).map(trimEnd)
  const last = kept[kept.length - 1] ?? [BLANK_LINE]
  const spans = [...last]
  let style: Span = spans[spans.length - 1] ?? BLANK_LINE
  while (spans.length > 0 && lineCells(spans) + cells(ELLIPSIS) > columns) {
    const tail = spans.pop()
    if (tail === undefined) break
    const parts = graphemes(tail.text)
    if (parts.length > 1) spans.push({ ...tail, text: parts.slice(0, -1).join('') })
  }
  const trimmed = spans.length > 0 ? trimEnd(spans) : []
  style = trimmed[trimmed.length - 1] ?? style
  const ended = [...trimmed.filter(span => span !== BLANK_LINE), { ...style, text: ELLIPSIS }]
  return [...kept.slice(0, -1), ended]
}

/** A line less its trailing spaces, which would only push the terminal to wrap it again. */
function trimEnd(line: readonly Span[]): Span[] {
  const out = [...line]
  for (let last = out[out.length - 1]; last !== undefined && last.text.trim() === ''; last = out[out.length - 1]) out.pop()
  const last = out[out.length - 1]
  if (last !== undefined) out[out.length - 1] = { ...last, text: last.text.trimEnd() }
  return out.length > 0 ? out : [BLANK_LINE]
}

/**
 * Each block one Text of its rows wrapped to the body's own width (one column at least, for a body
 * resized below the pane's padding), a block that opens a section led by a blank line.
 */
export function dockLayout(blocks: readonly Block[], bodyColumns: number): Drawn[] {
  const columns = Math.max(1, bodyColumns)
  return blocks.map(block => {
    const lines = block.rows.flatMap(row => wrapRow(row, columns))
    const all = block.opensSection === true ? [[BLANK_LINE], ...lines] : lines
    const spans = merged(all.flatMap((line, i) => (i === 0 ? line : [NEW_LINE, ...line])))
    return { key: block.key, spans, wrap: 'wrap', toggle: block.toggle ?? null }
  })
}

/** The body when building it threw: one line naming the error, so the pane is never left blank. */
export function failedDrawing(error: unknown): Drawn[] {
  const message = error instanceof Error ? error.message : String(error)
  return [{ key: 'error', spans: [{ text: `WARN the pane could not draw: ${message}`, color: 'error' }], wrap: 'wrap', toggle: null }]
}

/**
 * Each row one truncated screen row, at most `maxRows`, the last saying how many it left out and
 * where the whole list shows. A press on a task's first row still expands it.
 */
export function inlineLayout(blocks: readonly Block[], maxRows: number): Drawn[] {
  const rows = blocks.flatMap(block =>
    block.rows.map((row, i): Drawn => ({
      key: row.key,
      spans: merged(row.end === undefined ? row.spans : [...row.spans, { text: END_GAP }, row.end]),
      wrap: 'truncate-end',
      toggle: i === 0 ? (block.toggle ?? null) : null,
    })),
  )
  if (rows.length <= maxRows) return rows
  const kept = rows.slice(0, Math.max(0, maxRows - 1))
  const more: Drawn = {
    key: 'more',
    spans: [{ text: `… ${rows.length - kept.length} more lines in the side dock (fullscreen, 110+ columns)`, dim: true }],
    wrap: 'truncate-end',
    toggle: null,
  }
  return [...kept, more]
}
