// The head of the dedicated UI as rows: each part of the view model's head (../hooks/head) drawn as the Claude Code
// dock draws it, a press a stop under the key the dock gives it. A part takes the rows headRows counts for it, so
// the body's window is given the rows the head leaves; a blank row stands between two parts, none inside a group.
import { pressOfBar, type FindRow, type Head, type HeadItem, type HeadPart, type HeadPiece } from '../hooks/head'
import type { Press } from '../hooks/press'
import type { BarPiece } from '../hooks/status-bar'
import { plain, spaces, type Row, type Seg } from './row'
import { runOf, words, type Run } from './run'

/** The field the app types in, by its stop's key, and what it holds so far. */
export type Typing = { readonly key: string; readonly text: string }

/** The key that moves the ring into the Find field, and the stop drawn as `s: Find`. */
export const FIND_HOTKEY = 's'
export const FIND_KEY = 'find-key'
export const FIND_LABEL = 'Find'
/** The stop that closes the search shown. */
export const FIND_CLEAR_KEY = 'find-clear'
export const FIND_CLEAR_LABEL = 'clear'
/** A rule's cell. */
export const RULE = '─'

const BLANK: Row = []

function styled(text: string, style: Partial<Omit<Run, 'text'>>): Run {
  return { ...words(text), ...style }
}

function pressed(key: string, hotkey: string | null, press: Press, runs: readonly Run[]): Seg {
  return { runs, stop: { key, hotkey, target: { kind: 'press', press } } }
}

/** `[ label ]`, as the dock frames a button. */
function framed(label: string): string {
  return `[ ${label} ]`
}

/**
 * What a field shows: while the app types in it, the typed text and the cursor's cell; else its text, or its
 * placeholder dim when it holds none.
 */
export function fieldRuns(text: string, placeholder: string, typed: string | null): Run[] {
  if (typed !== null) return [words(typed), styled(' ', { inverse: true })]
  return text === '' ? [styled(placeholder, { dim: true })] : [words(text)]
}

/** An item as drawn, in the cells itemCells counts for it. */
function itemSeg(item: HeadItem): Seg {
  switch (item.kind) {
    case 'words':
      return plain([styled(item.text, item.tone === 'bold' ? { bold: true } : { dim: true })])
    case 'crumb':
      return pressed(item.key, null, item.press, [styled(item.label, { underline: true, dim: item.isAhead })])
    case 'button': {
      if (item.look === 'plain') {
        const text = item.hotkey === null ? item.label : `${item.hotkey}: ${item.label}`
        return pressed(item.key, item.hotkey, item.press, [words(text)])
      }
      const run = item.look === 'primary' ? styled(framed(item.label), { bold: true, tone: 'accent' }) : words(framed(item.label))
      return pressed(item.key, item.hotkey, item.press, [run])
    }
  }
}

/** Items side by side, `gap` cells between two. */
function itemsRow(items: readonly HeadItem[], gap: number): Row {
  return items.flatMap((item, i) => (i === 0 ? [itemSeg(item)] : [spaces(gap), itemSeg(item)]))
}

/** `s: Find`, the field, then clear while a search shows: one row, a cell between two. */
function findRow(find: FindRow, typing: Typing | null): Row {
  const press: Press = { kind: 'find' }
  const typed = typing !== null && typing.key === find.key ? typing.text : null
  const row: Seg[] = [
    pressed(FIND_KEY, FIND_HOTKEY, press, [words(`${FIND_HOTKEY}: ${FIND_LABEL}`)]),
    spaces(1),
    pressed(find.key, null, press, fieldRuns(find.text, find.placeholder, typed)),
  ]
  if (!find.clears) return row
  return [...row, spaces(1), pressed(FIND_CLEAR_KEY, null, { kind: 'find-clear' }, [words(framed(FIND_CLEAR_LABEL))])]
}

/** A piece of the status bar as status-bar.ts drawnText counts it: its key, its mark in the mark's own style, its text. */
function barSeg(piece: BarPiece): Seg {
  const runs = [
    ...(piece.hotkey === null ? [] : [words(`${piece.hotkey}: `)]),
    ...(piece.mark === null ? [] : [runOf(piece.mark), words(' ')]),
    runOf(piece),
  ]
  const press = pressOfBar(piece)
  return press === null ? plain(runs) : pressed(piece.key, piece.hotkey, press, runs)
}

function pieceRows(piece: HeadPiece, typing: Typing | null): Row[] {
  switch (piece.kind) {
    case 'text':
      return [[plain(piece.spans.map(runOf))]]
    case 'packed':
      return piece.rows.map(items => itemsRow(items, piece.gap))
    case 'row':
      return [itemsRow(piece.items, piece.gap)]
    case 'item':
      return [[itemSeg(piece.item)]]
    case 'find':
      return [findRow(piece.find, typing)]
    case 'keys':
      return piece.lines.map(line => [plain([styled(line, piece.at === 'search' ? { bold: true } : { dim: true })])])
    case 'rule':
      return [[plain([styled(RULE.repeat(Math.max(0, piece.cells)), { dim: true })])]]
    case 'bar':
      return piece.lines.map(line => line.map(barSeg))
  }
}

function partRows(part: HeadPart, typing: Typing | null): Row[] {
  return part.kind === 'group' ? part.pieces.flatMap(piece => pieceRows(piece, typing)) : pieceRows(part, typing)
}

/**
 * The head's rows, top to bottom: each part's (as many as headRows counts), a blank row between two parts. `typing`
 * names the field the app types in, null when it types in none.
 */
export function headRowsOf(head: Head, typing: Typing | null): Row[] {
  return head.parts.flatMap((part, i) => (i === 0 ? partRows(part, typing) : [BLANK, ...partRows(part, typing)]))
}
