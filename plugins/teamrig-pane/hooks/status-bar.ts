// The status bar atop the Tasks view (mine): one line of colored blocks as wide as the body, each status
// of the area's own tasks a segment sized by its share, and under it a dim line of the counts. The
// statuses are done today, waiting for proof, working, blocked and not started; a task done on an
// earlier day and a dropped one are left out. "Today" is the UTC day of the snapshot's clock, as every
// date the pane draws is UTC (a bare due date means the end of its UTC day). Pure data: register.tsx
// draws the pieces.
import type { ThemeKey } from 'claude-code'
import type { BarStatus, Snapshot, TaskRow } from '../types'
import type { Span } from './rows'
import { cells } from './width'

/** The bar's statuses in the order they draw: what closed today, what waits for its proof, then what is left. */
export const BAR_STATUSES: readonly BarStatus[] = ['done-today', 'verifying', 'working', 'blocked', 'not-started']

type BarLook = {
  /** How the counts line names it. */
  word: string
  /** The block its segment is drawn with. */
  block: string
  /** Its segment's color; none draws it dim. */
  color: ThemeKey | undefined
}

export const BAR_LOOK: Readonly<Record<BarStatus, BarLook>> = {
  'done-today': { word: 'done today', block: '█', color: 'success' },
  verifying: { word: 'verifying', block: '▓', color: 'success' },
  working: { word: 'working', block: '█', color: 'warning' },
  blocked: { word: 'blocked', block: '█', color: 'error' },
  'not-started': { word: 'not started', block: '░', color: undefined },
}

export type BarCounts = Readonly<Record<BarStatus, number>>

/** A run of the bar's text; `status` names the status it stands for, null for a separator. */
export type BarPiece = Span & { key: string; status: BarStatus | null }

/** The bar's lines: its segments, then the counts wrapped to its width. */
export type StatusBar = { lines: BarPiece[][] }

const SEPARATOR = ' · '

function noCounts(): Record<BarStatus, number> {
  return { 'done-today': 0, verifying: 0, working: 0, blocked: 0, 'not-started': 0 }
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
    case 'blocked':
      return 'blocked'
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

/** The counts in lines of `columns` cells, a dim ` · ` between two on a line; a count wider than a line has one to itself. */
function wrapCounts(words: readonly BarPiece[], columns: number): BarPiece[][] {
  const lines: BarPiece[][] = []
  let line: BarPiece[] = []
  let used = 0
  for (const word of words) {
    const width = cells(word.text)
    if (line.length > 0 && used + SEPARATOR.length + width > columns) {
      lines.push(line)
      line = []
      used = 0
    }
    if (line.length > 0) {
      line.push({ key: `sep:${word.key}`, text: SEPARATOR, dim: true, status: null })
      used += SEPARATOR.length
    }
    line.push(word)
    used += width
  }
  if (line.length > 0) lines.push(line)
  return lines
}

/**
 * The bar over the area's tasks, `width` cells wide (one at least), its counts line skipping the statuses
 * with none; null with no area, a snapshot not yet read, or no task to show.
 */
export function statusBar(snap: Snapshot, width: number): StatusBar | null {
  if (snap.area === null || snap.now === 0) return null
  const counts = barCounts(snap.tasks, snap.area, snap.now)
  if (totalOf(counts) === 0) return null
  const columns = Math.max(1, width)
  const widths = barCells(counts, columns)
  const segments = BAR_STATUSES.filter(status => widths[status] > 0).map(
    (status): BarPiece => {
      const look = BAR_LOOK[status]
      return { key: `bar:${status}`, text: look.block.repeat(widths[status]), color: look.color, dim: look.color === undefined, status }
    },
  )
  const words = BAR_STATUSES.filter(status => counts[status] > 0).map(
    (status): BarPiece => ({ key: `count:${status}`, text: `${counts[status]} ${BAR_LOOK[status].word}`, dim: true, status }),
  )
  return { lines: [segments, ...wrapCounts(words, columns)] }
}

/** Inline, the rows the list keeps before the bar takes any: its header, its first task and the line saying what it left out. */
export const INLINE_LIST_ROWS = 3

/** Inline, how many of the body's `maxRows` rows the bar takes: its lines, first to last, past the list's INLINE_LIST_ROWS. */
export function inlineBarRows(bar: StatusBar | null, maxRows: number): number {
  return bar === null ? 0 : Math.min(bar.lines.length, Math.max(0, maxRows - INLINE_LIST_ROWS))
}
