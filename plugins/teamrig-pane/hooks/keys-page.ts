// The Keys page: every key the pane answers, opened by `k: keys` at the end of the Tasks view's mode row
// (register.tsx) as the archive opens its page, back returning to where it was opened from. The keys come in groups,
// a block each (the views; the Tasks list's Find field, modes and pages; a page's steps), each entry `t  Tasks` in a
// column as wide as the widest entry of any group and as many columns to a row as the body's width holds (pack.ts),
// so the groups line up as one grid at any width; then the status bar's keys (status-bar.ts BAR_LOOK) on one line,
// and how the keys come to the pane and go back to Claude. Pure.
import { packRows } from './pack'
import type { Block, Row, Span } from './rows'
import { BAR_LOOK, BAR_STATUSES } from './status-bar'
import { cells } from './width'

/** The mode row's button to the Keys page and its key, drawn `k: keys`. */
export const KEYS_LABEL = 'keys'
export const KEYS_HOTKEY = 'k'

/** A key and what it does, drawn `t  Tasks`. */
export type KeyEntry = { readonly key: string; readonly what: string }

/** A group of keys, a block of the page, its name keying the block. */
export type KeyGroup = { readonly name: string; readonly entries: readonly KeyEntry[] }

/** The pane's keys but the status bar's: the views, the Tasks list's own, a page's steps. */
export const KEY_GROUPS: readonly KeyGroup[] = [
  {
    name: 'views',
    entries: [
      { key: 't', what: 'Tasks' },
      { key: 'd', what: 'Changes' },
      { key: 'g', what: 'Log' },
      { key: 'u', what: 'Inbox' },
      { key: 'e', what: 'Teams' },
      { key: 'j', what: 'Meetings' },
    ],
  },
  {
    name: 'list',
    entries: [
      { key: 's', what: 'Find' },
      { key: 'm', what: 'mine' },
      { key: 'a', what: 'all' },
      { key: 'h', what: 'archive' },
      { key: 'c', what: 'close cards' },
      { key: KEYS_HOTKEY, what: KEYS_LABEL },
    ],
  },
  {
    name: 'pages',
    entries: [
      { key: 'b', what: 'back' },
      { key: 'f', what: 'forward' },
      { key: 'p', what: 'week before' },
      { key: 'l', what: 'week after' },
    ],
  },
]

/** Between a key and its words. */
const KEY_GAP = '  '
/** Between two columns of entries. */
const COLUMN_GAP = 2

/** The status bar's keys, in its order: `o v w i n`. */
export function barKeys(): string {
  return BAR_STATUSES.map(status => BAR_LOOK[status].hotkey).join(' ')
}

function entryCells(entry: KeyEntry): number {
  return cells(`${entry.key}${KEY_GAP}${entry.what}`)
}

function entrySpans(entry: KeyEntry): Span[] {
  return [{ text: entry.key, bold: true }, { text: `${KEY_GAP}${entry.what}` }]
}

/** A group's entries in rows of `columns` cells, each but a row's last padded to `width` and the gap after it. */
function gridRows(group: KeyGroup, width: number, columns: number): Row[] {
  return packRows(group.entries, () => width, columns, COLUMN_GAP).map((row, i) => ({
    key: `keys:${group.name}:${i}`,
    spans: row.flatMap((entry, j) =>
      j === row.length - 1 ? entrySpans(entry) : [...entrySpans(entry), { text: ' '.repeat(width - entryCells(entry) + COLUMN_GAP) }],
    ),
  }))
}

/** A line naming keys, bold, then what they do. */
function keyLine(key: string, keys: string, words: string): Row {
  return { key, spans: [{ text: keys, bold: true }, { text: words }] }
}

/** The Keys page's blocks for a body of `columns` cells. */
export function keysBlocks(columns: number): Block[] {
  const width = Math.max(...KEY_GROUPS.flatMap(group => group.entries.map(entryCells)))
  const bar = barKeys()
  return [
    ...KEY_GROUPS.map((group): Block => ({ key: `keys:${group.name}`, rows: gridRows(group, width, columns) })),
    {
      key: 'keys:bar',
      rows: [{ ...keyLine('keys:bar', bar, `${KEY_GAP}only that status; again shows all`), hang: { text: ' '.repeat(cells(bar) + KEY_GAP.length) } }],
    },
    {
      key: 'keys:focus',
      rows: [
        keyLine('keys:focus:in', 'ctrl+x tab', ', or a click: keys to the pane'),
        keyLine('keys:focus:out', 'Esc', ': keys back to Claude'),
        keyLine('keys:focus:minimize', 'ctrl+x x', ', or ✕: minimize the pane'),
      ],
    },
  ]
}
