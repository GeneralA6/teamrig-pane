// Lays the pane's blocks (rows.ts) out for where the pane sits. Docked, each block is one Text:
// its rows word-wrapped to the body's columns here, so a wrapped line starts under its row's
// `hang` (a task's title under its id, a detail under its guide) rather than at the pane's edge,
// and the root Box's gap spaces the blocks. Wrapping here instead of nesting a Box per row keeps a
// block one element, the cost rows.ts explains. Inline, above the prompt, each row is one
// truncated screen row and the rows are capped. Widths are display cells (width.ts), so CJK and emoji
// sequences wrap where the terminal wraps them and a cut never lands inside one.
import type { Block, Row, Span } from './rows'
import { cells, graphemes } from './width'

/** One element of the body: a Text, inside the Button that expands its task when `toggle` names one. */
export type Drawn = { key: string; spans: Span[]; wrap: 'wrap' | 'truncate-end'; toggle: string | null }

const RULE = '─'
const BLANK_LINE: Span = { text: ' ' }
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
 * fills its last line with a dim rule.
 */
export function wrapRow(row: Row, columns: number): Span[][] {
  const hang = hangWithin(row.hang ?? { text: '' }, Math.floor(columns / 2))
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
  for (const span of row.spans) {
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
  if (row.rule === true) {
    const last = lines[lines.length - 1]
    const fill = columns - column
    if (last !== undefined && fill > 0) last.push({ text: `${fill > 1 ? ' ' : ''}${RULE.repeat(Math.max(1, fill - 1))}`, dim: true })
  }
  return lines.map(line => merged(trimEnd(line)))
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
  return [{ key: 'error', spans: [{ text: `⚠ the pane could not draw: ${message}`, color: 'error' }], wrap: 'wrap', toggle: null }]
}

/**
 * Each row one truncated screen row, at most `maxRows`, the last saying how many it left out and
 * where the whole list shows. A press on a task's first row still expands it.
 */
export function inlineLayout(blocks: readonly Block[], maxRows: number): Drawn[] {
  const rows = blocks.flatMap(block =>
    block.rows.map((row, i): Drawn => ({ key: row.key, spans: merged(row.spans), wrap: 'truncate-end', toggle: i === 0 ? (block.toggle ?? null) : null })),
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
