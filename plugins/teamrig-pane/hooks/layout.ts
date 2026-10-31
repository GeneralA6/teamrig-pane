// Lays the pane's blocks (rows.ts) out for where the pane sits. Docked, each block is one Text:
// its rows word-wrapped to the body's columns here, so a wrapped line starts under its row's
// `hang` (a task's title under its id, a card's value under its value column) rather than at the
// pane's edge, and the root Box's gap spaces the blocks. Wrapping here instead of nesting a Box per row
// keeps a block one element, the cost rows.ts explains; an open card is one more Text, but for each line that
// holds a press (a task id, a reference file), drawn as a row of its pieces so the press can be one of its own, as a
// block's own line is when no press opens the block (a Team tab leader's fold mark and id). A
// row can be cut at a few lines, ending in `…`, and can carry an `end` drawn at its first line's right edge. A link
// or a press is never split: it starts a fresh line when that gives it more room, and one wider still is
// shortened to its line, ending in `…`. Inline, above the prompt, each row is one truncated screen row and the rows
// are capped. Widths are display cells (width.ts), so CJK and emoji sequences wrap where the terminal
// wraps them and a cut never lands inside one.
import type { LogRead, RefFile } from '../types'
import type { Block, InboxPress, Row, Span } from './rows'
import { cells, graphemes } from './width'

/**
 * A piece of a line that holds a press: a task id and the task it names, a reference file and the file it names, an
 * unread count and the inbox it opens, a Team tab key, a session a press ties the tab to, a meeting a press starts,
 * a session a press meets the owner with, or the words between them.
 */
export type Piece =
  | { kind: 'id'; span: Span; task: string }
  | { kind: 'file'; span: Span; file: RefFile }
  | { kind: 'inbox'; span: Span; inbox: InboxPress }
  | { kind: 'toggle'; span: Span; toggles: string }
  | { kind: 'pin'; span: Span; pins: string }
  | { kind: 'start'; span: Span; starts: string }
  | { kind: 'meet'; span: Span; meets: string }
  | { kind: 'words'; spans: Span[] }
/**
 * A run of a card's lines: a Text of the lines that hold no press (`text`), one line that holds one (`line`), its
 * pieces drawn side by side, or a row that is a press of its own (`press`, a Changes file opening its diff), its
 * lines one Text keyed by the row.
 */
export type CardPart =
  | { kind: 'text'; key: string; spans: Span[] }
  | { kind: 'line'; key: string; pieces: Piece[] }
  | { kind: 'press'; key: string; spans: Span[]; expands: string }
/**
 * One element of the body: a Text, inside the Button that opens its task's card when `toggle` names one, its
 * page when `opens` does (a search result), a conversation's Log page when `reads` does (docked only), the Team tab's
 * key or the meeting's card it opens or closes when `folds` does, or a Changes file's diff when `expands` does (inline a file's row, docked
 * a Changes search result). `card`, set while that card is open, is the card's own parts, drawn under the Button and
 * outside it. `parts`, set docked when no press but a Team tab key's opens the element and a line of its holds a press
 * (a leader's fold mark and id), is its lines as parts, drawn in place of its Text and its
 * `folds` press, its open card under them.
 */
export type Drawn = {
  key: string
  spans: Span[]
  wrap: 'wrap' | 'truncate-end'
  toggle: string | null
  opens?: string
  reads?: LogRead
  folds?: string
  expands?: string
  card?: CardPart[]
  parts?: CardPart[]
}

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

/** `text` in `room` cells: whole when it fits, else cut between graphemes and ending in `…`. */
function shortened(text: string, room: number): string {
  if (cells(text) <= room) return text
  const parts = graphemes(text)
  return `${parts.slice(0, fitting(parts, Math.max(0, room - cells(ELLIPSIS)))).join('')}${ELLIPSIS}`
}

/** One style, one link and one press: two links, two ids or two files side by side stay two. */
function sameStyle(a: Span, b: Span): boolean {
  return (
    a.color === b.color &&
    a.bold === b.bold &&
    a.dim === b.dim &&
    a.underline === b.underline &&
    a.href === b.href &&
    a.task === b.task &&
    a.file === b.file &&
    a.inbox?.area === b.inbox?.area &&
    a.inbox?.unread === b.inbox?.unread &&
    a.toggles === b.toggles &&
    a.pins === b.pins &&
    a.starts === b.starts &&
    a.meets === b.meets
  )
}

/**
 * Whether `span` is a press drawn as a piece of its line: a task id or a reference file in a card, an inbox count, a
 * Team tab key, a session to tie the tab to, a meeting to start, a session to meet.
 */
function isPress(span: Span): boolean {
  return (
    span.task !== undefined ||
    span.file !== undefined ||
    span.inbox !== undefined ||
    span.toggles !== undefined ||
    span.pins !== undefined ||
    span.starts !== undefined ||
    span.meets !== undefined
  )
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
    // A link or a press stays whole, so a press on any of it opens the one address or page: on a fresh line when that has more room, shortened when even that is too narrow.
    if (span.href !== undefined || isPress(span)) {
      if (column > start && cells(span.text) > columns - column) breakLine()
      put({ ...span, text: shortened(span.text, columns - column) })
      continue
    }
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

/** Wrapped lines, shared between layouts: read, never changed. */
export type Lines = readonly (readonly Span[])[]

/**
 * Each row's lines from the layout before when nothing wrapRow reads changed (its spans, hang, rule, maxLines and end,
 * and the columns; never its key), so a redraw re-wraps only the rows that did: the engine asks for the tree again on
 * each scroll move, and a register write redraws a list whose rows mostly stayed. It keeps only the rows the last
 * layout used, so it never outgrows the list drawn.
 */
export class WrapCache {
  /** The last layout's rows. */
  private kept = new Map<string, Lines>()
  /** The rows this layout used so far. */
  private used = new Map<string, Lines>()

  /** `row` in `columns` cells, as wrapRow wraps it. */
  wrap(row: Row, columns: number): Lines {
    const key = JSON.stringify([columns, row.spans, row.hang ?? null, row.rule === true, row.maxLines ?? null, row.end ?? null])
    const lines = this.used.get(key) ?? this.kept.get(key) ?? wrapRow(row, columns)
    this.used.set(key, lines)
    return lines
  }

  /** Ends a layout: the rows it used are kept for the next one, and any it did not are dropped. */
  settle(): void {
    this.kept = this.used
    this.used = new Map()
  }
}

/** Lines as one Text's spans, a new line between each two. */
function joinedLines(lines: Lines): Span[] {
  return merged(lines.flatMap((line, i) => (i === 0 ? line : [NEW_LINE, ...line])))
}

/**
 * A line's spans as pieces: each task id, reference file, inbox count, Team tab key, session to tie the tab to,
 * meeting to start and session to meet its own, each run of words between them one.
 */
export function piecesOf(line: readonly Span[]): Piece[] {
  const pieces: Piece[] = []
  for (const span of line) {
    const last = pieces[pieces.length - 1]
    if (span.task !== undefined) pieces.push({ kind: 'id', span, task: span.task })
    else if (span.file !== undefined) pieces.push({ kind: 'file', span, file: span.file })
    else if (span.inbox !== undefined) pieces.push({ kind: 'inbox', span, inbox: span.inbox })
    else if (span.toggles !== undefined) pieces.push({ kind: 'toggle', span, toggles: span.toggles })
    else if (span.pins !== undefined) pieces.push({ kind: 'pin', span, pins: span.pins })
    else if (span.starts !== undefined) pieces.push({ kind: 'start', span, starts: span.starts })
    else if (span.meets !== undefined) pieces.push({ kind: 'meet', span, meets: span.meets })
    else if (last?.kind === 'words') last.spans.push(span)
    else pieces.push({ kind: 'words', spans: [span] })
  }
  return pieces
}

/** Wrapped card lines as parts: each run of lines with no press one Text, each line with one a row of its pieces; keyed from `first` on. */
export function cardParts(lines: Lines, first = 0): CardPart[] {
  const parts: CardPart[] = []
  let run: (readonly Span[])[] = []
  const key = () => `card:${first + parts.length}`
  const endRun = () => {
    if (run.length > 0) parts.push({ kind: 'text', key: key(), spans: joinedLines(run) })
    run = []
  }
  for (const line of lines) {
    if (!line.some(isPress)) {
      run.push(line)
      continue
    }
    endRun()
    parts.push({ kind: 'line', key: key(), pieces: piecesOf(line) })
  }
  endRun()
  return parts
}

/**
 * A card's rows as parts: each row with `expands` a press of its own, its lines one Text; each run of the others as
 * cardParts makes it, keyed from `first` on (past the parts of a head drawn as parts).
 */
export function rowParts(rows: readonly Row[], wrap: (row: Row) => Lines, first = 0): CardPart[] {
  const parts: CardPart[] = []
  let run: Row[] = []
  const endRun = () => {
    parts.push(...cardParts(run.flatMap(wrap), first + parts.length))
    run = []
  }
  for (const row of rows) {
    if (row.expands === undefined) {
      run.push(row)
      continue
    }
    endRun()
    parts.push({ kind: 'press', key: row.key, spans: joinedLines(wrap(row)), expands: row.expands })
  }
  endRun()
  return parts
}

/**
 * Each block one Text of its rows wrapped to the body's own width (one column at least, for a body
 * resized below the pane's padding), a block that opens a section led by a blank line; an open card's
 * rows wrapped the same way into its parts, and a block's own lines too when they hold a press and no press but a
 * Team tab key's opens it (Drawn's `parts`). `wraps` carries the rows wrapped by the layout before (WrapCache); by default none are.
 */
export function dockLayout(blocks: readonly Block[], bodyColumns: number, wraps: WrapCache = new WrapCache()): Drawn[] {
  const columns = Math.max(1, bodyColumns)
  const wrapped = (rows: readonly Row[]): Lines => rows.flatMap(row => wraps.wrap(row, columns))
  const body = blocks.map(block => {
    const wrappedRows = wrapped(block.rows)
    const lines = block.opensSection === true ? [[BLANK_LINE], ...wrappedRows] : wrappedRows
    const drawn: Drawn = {
      key: block.key,
      spans: joinedLines(lines),
      wrap: 'wrap',
      toggle: block.toggle ?? null,
      ...(block.opens === undefined ? {} : { opens: block.opens }),
      ...(block.reads === undefined ? {} : { reads: block.reads }),
      ...(block.expands === undefined ? {} : { expands: block.expands }),
    }
    const pressed =
      block.toggle === undefined && block.opens === undefined && block.reads === undefined && block.expands === undefined && lines.some(line => line.some(isPress))
    const parts = pressed ? cardParts(lines) : null
    return {
      ...drawn,
      ...(parts === null ? {} : { parts }),
      ...(parts !== null || block.folds === undefined ? {} : { folds: block.folds }),
      ...(block.card === undefined ? {} : { card: rowParts(block.card, row => wraps.wrap(row, columns), parts?.length ?? 0) }),
    }
  })
  wraps.settle()
  return body
}

/** The body when building it threw: one line naming the error, so the pane is never left blank. */
export function failedDrawing(error: unknown): Drawn[] {
  const message = error instanceof Error ? error.message : String(error)
  return [{ key: 'error', spans: [{ text: `WARN the pane could not draw: ${message}`, color: 'error' }], wrap: 'wrap', toggle: null }]
}

/**
 * Each row one truncated screen row, at most `maxRows`, the last saying how many it left out and
 * where the whole list shows. A press on a task's first row still opens or closes its card, whose rows follow,
 * their task ids drawn as the words they are: a page opens from the dock. A press on a Changes file opens its diff.
 */
export function inlineLayout(blocks: readonly Block[], maxRows: number): Drawn[] {
  const rows = blocks.flatMap(block =>
    [...block.rows, ...(block.card ?? [])].map((row, i): Drawn => ({
      key: row.key,
      spans: merged(row.end === undefined ? row.spans : [...row.spans, { text: END_GAP }, row.end]),
      wrap: 'truncate-end',
      toggle: i === 0 ? (block.toggle ?? null) : null,
      ...(i === 0 && block.folds !== undefined ? { folds: block.folds } : {}),
      ...(row.expands === undefined ? {} : { expands: row.expands }),
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
