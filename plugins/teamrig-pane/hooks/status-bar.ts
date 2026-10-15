// The status bar atop the Tasks view (mine): one line of colored blocks as wide as the body, each status
// of the area's own tasks a segment sized by its share, and under it the counts, dim, each behind its
// key and wrapped to the bar's width as drawn (drawnText). The statuses are done today, verifying,
// working, waiting and not started; a task done on an earlier day and a dropped one are left out. "Today" is the UTC day of the snapshot's clock, as every
// date the pane draws is UTC (a bare due date means the end of its UTC day). A press on a segment or
// its count, or the count's key, filters the list to that status (rows.ts) and a second press clears
// it; the filtered segment and count draw bold, a dim line under the counts says so. Pure data:
// register.tsx draws the pieces and keeps the filter.
import type { ThemeKey } from 'claude-code'
import type { BarStatus, Snapshot, TaskRow } from '../types'
import type { Span } from './rows'
import { cells } from './width'

/** The bar's statuses in the order they draw: what closed today, what waits for its proof, then what is left. */
export const BAR_STATUSES: readonly BarStatus[] = ['done-today', 'verifying', 'working', 'waiting', 'not-started']

type BarLook = {
  /** How the counts line names it. */
  word: string
  /** The block its segment is drawn with. */
  block: string
  /** Its segment's color; none draws it dim. */
  color: ThemeKey | undefined
  /** The key that filters to it, one free of the pane's others (t, d, m, a, c). */
  hotkey: string
  /** What the list says when it is filtered to the status and none is left. */
  none: string
}

export const BAR_LOOK: Readonly<Record<BarStatus, BarLook>> = {
  'done-today': { word: 'done today', block: '█', color: 'success', hotkey: 'o', none: 'Nothing done today.' },
  verifying: { word: 'verifying', block: '▓', color: 'success', hotkey: 'v', none: 'Nothing to verify.' },
  working: { word: 'working', block: '█', color: 'warning', hotkey: 'w', none: 'Nothing in progress.' },
  waiting: { word: 'waiting', block: '█', color: 'error', hotkey: 'i', none: 'Nothing waiting.' },
  'not-started': { word: 'not started', block: '░', color: undefined, hotkey: 'n', none: 'Nothing left to start.' },
}

export type BarCounts = Readonly<Record<BarStatus, number>>

/**
 * A run of the bar's text: `status` names the status a press on it filters to, null for a separator or the
 * filter's line; `hotkey` the key that does the same, a count's only.
 */
export type BarPiece = Span & { key: string; status: BarStatus | null; hotkey: string | null }

/**
 * The bar's lines: its segments, the counts wrapped to its width, then the filter's line while one is on.
 * `filter` is the status the list is filtered to, null when it shows all.
 */
export type StatusBar = { lines: BarPiece[][]; filter: BarStatus | null }

const SEPARATOR = ' · '

function noCounts(): Record<BarStatus, number> {
  return { 'done-today': 0, verifying: 0, working: 0, waiting: 0, 'not-started': 0 }
}

/** `2026-10-15`: the UTC day of an instant, the day the pane's due and time labels are in. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** Where a task sits on the bar, `today` a UTC day; null for one done on an earlier day or dropped, which the bar leaves out. */
export function barStatusOf(task: TaskRow, today: string): BarStatus | null {
  switch (task.status) {
    case 'done':
      return utcDay(Date.parse(task.updatedAt)) === today ? 'done-today' : null
    case 'verifying':
      return 'verifying'
    case 'in-progress':
      return 'working'
    case 'waiting':
      return 'waiting'
    case 'open':
      return 'not-started'
    case 'dropped':
      return null
  }
}

/** How many of the area's own tasks sit in each status of the bar, today being the UTC day of `now`. */
export function barCounts(tasks: readonly TaskRow[], area: string, now: number): BarCounts {
  const today = utcDay(now)
  const counts = noCounts()
  for (const task of tasks) {
    const status = task.owner === area ? barStatusOf(task, today) : null
    if (status !== null) counts[status]++
  }
  return counts
}

function totalOf(counts: BarCounts): number {
  return BAR_STATUSES.reduce((sum, status) => sum + counts[status], 0)
}

/**
 * Each status's cells in a bar `width` cells wide, rounded by largest remainder so the segments fill it
 * exactly: each takes the whole cells of its share, the cells left over go to the largest remainders (a
 * tie to the earlier status), then a status with tasks but no cell takes one from the widest segment (a
 * tie to the earlier), so none with tasks vanishes. A bar narrower than the statuses it has gives one cell
 * each to the largest counts (a tie to the earlier). Integer math, so no share is lost to rounding.
 */
export function barCells(counts: BarCounts, width: number): Record<BarStatus, number> {
  const out = noCounts()
  const total = totalOf(counts)
  const shown = BAR_STATUSES.filter(status => counts[status] > 0)
  if (total === 0 || width <= 0) return out
  const rank = (status: BarStatus) => BAR_STATUSES.indexOf(status)
  if (width < shown.length) {
    const largest = [...shown].sort((a, b) => counts[b] - counts[a] || rank(a) - rank(b)).slice(0, width)
    for (const status of largest) out[status] = 1
    return out
  }
  for (const status of shown) out[status] = Math.floor((counts[status] * width) / total)
  const left = width - shown.reduce((sum, status) => sum + out[status], 0)
  const remainder = (status: BarStatus) => (counts[status] * width) % total
  const byRemainder = [...shown].sort((a, b) => remainder(b) - remainder(a) || rank(a) - rank(b))
  for (const status of byRemainder.slice(0, left)) out[status]++
  for (const status of shown) {
    if (out[status] > 0) continue
    // Width at least the shown statuses and one of them at 0 leaves another at 2 or more to give.
    const widest = shown.reduce((a, b) => (out[b] > out[a] ? b : a))
    out[widest]--
    out[status]++
  }
  return out
}

/**
 * A piece as the terminal draws it: a count behind its key, as the engine draws a plain Button with a hotkey
 * (the key, a colon and a space: `o: 2 done today`), any other piece as its text alone.
 */
export function drawnText(piece: BarPiece): string {
  return piece.hotkey === null ? piece.text : `${piece.hotkey}: ${piece.text}`
}

/** The cells a piece takes as drawn (drawnText): what every width the bar lays out is counted in. */
function drawnCells(piece: BarPiece): number {
  return cells(drawnText(piece))
}

/**
 * The counts in lines of `columns` cells as drawn, each count's key included, a dim ` · ` between two on a line;
 * a count wider than a line has one to itself. Measured by the text alone, a line of keyed counts ran past the
 * bar's width, and the row squeezed its separators to one cell, their dots wrapping onto a line of their own.
 */
function wrapCounts(words: readonly BarPiece[], columns: number): BarPiece[][] {
  const lines: BarPiece[][] = []
  let line: BarPiece[] = []
  let used = 0
  for (const word of words) {
    const separator: BarPiece = { key: `sep:${word.key}`, text: SEPARATOR, dim: true, status: null, hotkey: null }
    const width = drawnCells(word)
    if (line.length > 0 && used + drawnCells(separator) + width > columns) {
      lines.push(line)
      line = []
      used = 0
    }
    if (line.length > 0) {
      line.push(separator)
      used += drawnCells(separator)
    }
    line.push(word)
    used += width
  }
  if (line.length > 0) lines.push(line)
  return lines
}

/** The dim line under the counts while the list is filtered to `status`. */
export function filterText(status: BarStatus): string {
  return `showing ${BAR_LOOK[status].word} only, click again for all`
}

/**
 * The bar over the area's tasks, `width` cells wide (one at least), its counts line skipping the statuses
 * with none but the one `filter` names, which stays, at 0 too, so a press can clear it. The filtered
 * segment and count draw bold, the count not dim. Null with no area, a snapshot not yet read, or no task to
 * show: then no filter holds either.
 */
export function statusBar(snap: Snapshot, filter: BarStatus | null, width: number): StatusBar | null {
  if (snap.area === null || snap.now === 0) return null
  const counts = barCounts(snap.tasks, snap.area, snap.now)
  if (totalOf(counts) === 0) return null
  const columns = Math.max(1, width)
  const widths = barCells(counts, columns)
  const segments = BAR_STATUSES.filter(status => widths[status] > 0).map((status): BarPiece => {
    const look = BAR_LOOK[status]
    const text = look.block.repeat(widths[status])
    return { key: `bar:${status}`, text, color: look.color, dim: look.color === undefined, bold: status === filter, status, hotkey: null }
  })
  const words = BAR_STATUSES.filter(status => counts[status] > 0 || status === filter).map((status): BarPiece => {
    const look = BAR_LOOK[status]
    const isFiltered = status === filter
    return { key: `count:${status}`, text: `${counts[status]} ${look.word}`, dim: !isFiltered, bold: isFiltered, status, hotkey: look.hotkey }
  })
  const lines = [segments, ...wrapCounts(words, columns)]
  if (filter !== null) lines.push([{ key: 'filter', text: filterText(filter), dim: true, status: null, hotkey: null }])
  return { lines, filter }
}

/** Inline, the rows the list keeps before the bar takes any: its header, its first task and the line saying what it left out. */
export const INLINE_LIST_ROWS = 3

/** Inline, how many of the body's `maxRows` rows the bar takes: its lines, first to last, past the list's INLINE_LIST_ROWS. */
export function inlineBarRows(bar: StatusBar | null, maxRows: number): number {
  return bar === null ? 0 : Math.min(bar.lines.length, Math.max(0, maxRows - INLINE_LIST_ROWS))
}
