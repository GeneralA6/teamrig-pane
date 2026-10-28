// The status bar atop the Tasks view (mine): one line of colored blocks as wide as the body, each status
// of the area's list a segment sized by its share, and under it the counts, dim, each behind its
// key and the glyph its section's rows wear (so the counts are the glyphs' legend), wrapped to the bar's width as
// drawn (drawnText). The statuses are done today, verifying,
// working, waiting and not started, one per section of the list, each counting the tasks its section holds
// (barStatusOf), so a section's heading and its count name one number. "Today" is the
// team zone's day of the snapshot's clock, as every day the pane draws is the zone's (zone.ts). A press on a segment or
// its count, or the count's key, filters the list to that status (rows.ts) and a second press clears
// it; the filtered segment and count draw bold, a dim line under the counts says so. Pure data:
// register.tsx draws the pieces and keeps the filter.
import type { ThemeKey } from 'claude-code'
import type { BarStatus, Snapshot, TaskRow } from '../types'
import { ACTIVE_STATUSES, type TimeZone } from './core/read/index'
import type { Span } from './rows'
import { cells } from './width'
import { clockOf, dayOf, type Clock } from './zone'

/** The bar's statuses in the order they draw: what closed today, what is verifying, then what is left. */
export const BAR_STATUSES: readonly BarStatus[] = ['done-today', 'verifying', 'working', 'waiting', 'not-started']

type BarLook = {
  /** How the counts line names it. */
  word: string
  /** The glyph the rows of its section wear (rows.ts GLYPH), drawn before its count. */
  glyph: string
  /** The block its segment is drawn with. */
  block: string
  /** Its segment's color and its glyph's, the rows' (rows.ts GLYPH_COLOR); none draws them dim. */
  color: ThemeKey | undefined
  /** The key that filters to it, one free of the pane's others (t, d, m, a, c). */
  hotkey: string
  /** What the list says when it is filtered to the status and none is left. */
  none: string
}

export const BAR_LOOK: Readonly<Record<BarStatus, BarLook>> = {
  'done-today': { word: 'done today', glyph: '✓', block: '█', color: 'success', hotkey: 'o', none: 'Nothing done today.' },
  verifying: { word: 'verifying', glyph: '◑', block: '▓', color: 'success', hotkey: 'v', none: 'Nothing to verify.' },
  working: { word: 'working', glyph: '◐', block: '█', color: 'warning', hotkey: 'w', none: 'Nothing in progress.' },
  waiting: { word: 'waiting', glyph: '■', block: '█', color: 'error', hotkey: 'i', none: 'Nothing waiting.' },
  'not-started': { word: 'not started', glyph: '○', block: '░', color: undefined, hotkey: 'n', none: 'Nothing left to start.' },
}

export type BarCounts = Readonly<Record<BarStatus, number>>

/**
 * A run of the bar's text: `status` names the status a press on it filters to, null for a separator or the
 * filter's line; `hotkey` the key that does the same, and `mark` the glyph drawn before its text in its own color,
 * a count's only.
 */
export type BarPiece = Span & { key: string; status: BarStatus | null; hotkey: string | null; mark: Span | null }

/**
 * The bar's lines: its segments, the counts wrapped to its width, then the filter's line while one is on.
 * `filter` is the status the list is filtered to, null when it shows all.
 */
export type StatusBar = { lines: BarPiece[][]; filter: BarStatus | null }

const SEPARATOR = ' · '

function noCounts(): Record<BarStatus, number> {
  return { 'done-today': 0, verifying: 0, working: 0, waiting: 0, 'not-started': 0 }
}

/**
 * Done or dropped on `today`, a day of `zone` (zone.ts dayOf), by when it took that status (a later note or priority
 * change does not finish it again): the one day the bar counts as done today and the list shows as finished today
 * (view.ts), so the two agree and both turn over at the zone's midnight.
 */
export function isFinishedOn(task: TaskRow, today: string, zone: TimeZone): boolean {
  return (task.status === 'done' || task.status === 'dropped') && dayOf(Date.parse(task.statusAt), zone) === today
}

/**
 * Where a task sits on `area`'s list, `today` a day of `zone`: its section, the bar's status that counts it and the
 * filter that lists it, one answer for all three. The area's own tasks sit by their status, those done or dropped
 * today under done today; an active task it asked of another session waits with its own waiting ones. Null for a
 * task the list leaves out: one finished on an earlier day, or another owner's it did not ask for.
 */
export function barStatusOf(task: TaskRow, area: string, today: string, zone: TimeZone): BarStatus | null {
  if (task.owner !== area) return task.createdBy === area && ACTIVE_STATUSES.includes(task.status) ? 'waiting' : null
  switch (task.status) {
    case 'done':
    case 'dropped':
      return isFinishedOn(task, today, zone) ? 'done-today' : null
    case 'verifying':
      return 'verifying'
    case 'in-progress':
      return 'working'
    case 'waiting':
      return 'waiting'
    case 'open':
      return 'not-started'
  }
}

/**
 * How many tasks of the area's list sit at each status of the bar (barStatusOf), today being the zone's day of the
 * clock's `now`: the number each count and each section's heading (view.ts areaView) names.
 */
export function barCounts(tasks: readonly TaskRow[], area: string, { now, zone }: Clock): BarCounts {
  const today = dayOf(now, zone)
  const counts = noCounts()
  for (const task of tasks) {
    const status = barStatusOf(task, area, today, zone)
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
 * (the key, a colon and a space), then its glyph and a space: `o: ✓ 2 done today`; any other piece as its text alone.
 */
export function drawnText(piece: BarPiece): string {
  const text = piece.mark === null ? piece.text : `${piece.mark.text} ${piece.text}`
  return piece.hotkey === null ? text : `${piece.hotkey}: ${text}`
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
    const separator: BarPiece = { key: `sep:${word.key}`, text: SEPARATOR, dim: true, status: null, hotkey: null, mark: null }
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
  const counts = barCounts(snap.tasks, snap.area, clockOf(snap))
  if (totalOf(counts) === 0) return null
  const columns = Math.max(1, width)
  const widths = barCells(counts, columns)
  const segments = BAR_STATUSES.filter(status => widths[status] > 0).map((status): BarPiece => {
    const look = BAR_LOOK[status]
    const text = look.block.repeat(widths[status])
    return { key: `bar:${status}`, text, color: look.color, dim: look.color === undefined, bold: status === filter, status, hotkey: null, mark: null }
  })
  // A count wears its glyph where the whole count, key and glyph included, fits on a line; in a dock narrower, it goes
  // without, its words still naming the status.
  const words = BAR_STATUSES.filter(status => counts[status] > 0 || status === filter).map((status): BarPiece => {
    const look = BAR_LOOK[status]
    const isFiltered = status === filter
    const mark: Span = look.color === undefined ? { text: look.glyph, dim: true } : { text: look.glyph, color: look.color }
    const count: BarPiece = { key: `count:${status}`, text: `${counts[status]} ${look.word}`, dim: !isFiltered, bold: isFiltered, status, hotkey: look.hotkey, mark }
    return drawnCells(count) <= columns ? count : { ...count, mark: null }
  })
  const lines = [segments, ...wrapCounts(words, columns)]
  if (filter !== null) lines.push([{ key: 'filter', text: filterText(filter), dim: true, status: null, hotkey: null, mark: null }])
  return { lines, filter }
}

/**
 * Inline, the rows the list keeps before the bar takes any: its header, the first section's heading and first task,
 * and the line saying what it left out.
 */
export const INLINE_LIST_ROWS = 4

/** Inline, how many of the body's `maxRows` rows the bar takes: its lines, first to last, past the list's INLINE_LIST_ROWS. */
export function inlineBarRows(bar: StatusBar | null, maxRows: number): number {
  return bar === null ? 0 : Math.min(bar.lines.length, Math.max(0, maxRows - INLINE_LIST_ROWS))
}
