// Two texts' line diff as git's unified patch draws it (T1362), for a file the pane diffs itself: one written outside
// git, against the copy kept before the session first wrote it. Pure: lineDiff gives the lines diff.ts draws, each
// hunk's `@@ -a,b +c,d @@` line (a count of 1 left out; a count of 0 starts at the line before) and its lines, CONTEXT
// unchanged lines around each change, two changes CONTEXT * 2 lines apart or nearer in one hunk. A last line with no
// newline differs from the same line with one and is followed by git's `\ No newline at end of file`. The lines both
// texts start and end with are matched first; the rest by Myers' shortest edit, which gives up past MAX_EDITS edits
// and draws that middle as all removed, then all added. A line keeps its `\r`: drawing it is diff.ts's job.
import type { DiffLine } from '../types'

/** The unchanged lines drawn on each side of a change, as git's default `-U3`. */
export const CONTEXT = 3
/** The most edits the shortest-edit search tries; past it the changed middle draws as all removed, then all added. */
export const MAX_EDITS = 1000
/** The note git writes after a last line with no newline. */
export const NO_NEWLINE = '\\ No newline at end of file'

/** One step of an edit script: a line both texts have, one only the first has (removed), one only the second (added). */
export type Edit = 'same' | 'del' | 'add'

type Line = { text: string; isEnded: boolean }

/** A text's lines: none for '', and a text ending in a newline has no empty line after it. */
function linesOf(text: string): Line[] {
  if (text === '') return []
  const parts = text.split('\n')
  const isEnded = parts.at(-1) === ''
  if (isEnded) parts.pop()
  return parts.map((part, index) => ({ text: part, isEnded: isEnded || index < parts.length - 1 }))
}

/** Each line as a number, the same for the same text and ending, so the search compares numbers, not strings. */
function idsOf(lines: readonly Line[], ids: Map<string, number>): number[] {
  return lines.map(line => {
    const key = line.isEnded ? `${line.text}\n` : line.text
    const known = ids.get(key)
    if (known !== undefined) return known
    ids.set(key, ids.size)
    return ids.size - 1
  })
}

/** `v[index]`, 0 outside it (no index read here is). */
function at(v: Int32Array, index: number): number {
  return v[index] ?? 0
}

/**
 * The fewest edits that turn `a` into `b` (Myers' greedy search, keeping each round's furthest points to walk back
 * along); null when they take more than `maxEdits`.
 */
export function shortestEdit<T>(a: readonly T[], b: readonly T[], maxEdits: number): Edit[] | null {
  const n = a.length
  const m = b.length
  const limit = Math.min(n + m, maxEdits)
  const offset = limit + 1
  const v = new Int32Array(2 * offset + 1)
  /** Round d's furthest points before it ran: diagonals -d-1..d+1, diagonal k at index k + d + 1. */
  const trace: Int32Array[] = []
  for (let d = 0; d <= limit; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2))
    for (let k = -d; k <= d; k += 2) {
      const isDown = k === -d || (k !== d && at(v, offset + k - 1) < at(v, offset + k + 1))
      let x = isDown ? at(v, offset + k + 1) : at(v, offset + k - 1) + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[offset + k] = x
      if (x >= n && y >= m) return walkedBack(trace, n, m)
    }
  }
  return null
}

/** The edits, first to last, from the end back along each round's furthest points. */
function walkedBack(trace: readonly Int32Array[], n: number, m: number): Edit[] {
  const edits: Edit[] = []
  let x = n
  let y = m
  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d] ?? new Int32Array(0)
    const k = x - y
    const isDown = k === -d || (k !== d && at(v, k - 1 + d + 1) < at(v, k + 1 + d + 1))
    const previousK = isDown ? k + 1 : k - 1
    const previousX = at(v, previousK + d + 1)
    const previousY = previousX - previousK
    while (x > previousX && y > previousY) {
      edits.push('same')
      x--
      y--
    }
    if (d > 0) edits.push(x === previousX ? 'add' : 'del')
    x = previousX
    y = previousY
  }
  return edits.reverse()
}

/** The edits that turn `a` into `b`: the lines both start and end with kept, the middle searched, or past MAX_EDITS all removed then all added. */
function editsOf(a: readonly number[], b: readonly number[]): Edit[] {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let end = 0
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++
  const middleA = a.slice(start, a.length - end)
  const middleB = b.slice(start, b.length - end)
  const middle: Edit[] = shortestEdit(middleA, middleB, MAX_EDITS) ?? [
    ...middleA.map((): Edit => 'del'),
    ...middleB.map((): Edit => 'add'),
  ]
  return [...Array<Edit>(start).fill('same'), ...middle, ...Array<Edit>(end).fill('same')]
}

/** One side of a hunk's `@@` line: a count of 1 left out, a count of 0 starting at the line before. */
function range(sign: '-' | '+', start: number, count: number): string {
  return `${sign}${count === 0 ? start : start + 1}${count === 1 ? '' : `,${count}`}`
}

/** `before` to `after` as the lines of git's unified patch: each hunk's `@@` line, then its lines. [] when no line changed. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const oldLines = linesOf(before)
  const newLines = linesOf(after)
  const ids = new Map<string, number>()
  const edits = editsOf(idsOf(oldLines, ids), idsOf(newLines, ids))
  /** Where each edit starts in each text. */
  const starts: { old: number; new: number }[] = []
  let oldAt = 0
  let newAt = 0
  for (const edit of edits) {
    starts.push({ old: oldAt, new: newAt })
    if (edit !== 'add') oldAt++
    if (edit !== 'del') newAt++
  }
  const changed = edits.flatMap((edit, index) => (edit === 'same' ? [] : [index]))
  const lines: DiffLine[] = []
  let first = 0
  while (first < changed.length) {
    let last = first
    while (last + 1 < changed.length && (changed[last + 1] ?? 0) - (changed[last] ?? 0) - 1 <= CONTEXT * 2) last++
    const from = Math.max(0, (changed[first] ?? 0) - CONTEXT)
    const to = Math.min(edits.length, (changed[last] ?? 0) + 1 + CONTEXT)
    const shown = edits.slice(from, to)
    const start = starts[from] ?? { old: 0, new: 0 }
    const oldCount = shown.filter(edit => edit !== 'add').length
    const newCount = shown.filter(edit => edit !== 'del').length
    lines.push({ kind: 'hunk', text: `@@ ${range('-', start.old, oldCount)} ${range('+', start.new, newCount)} @@` })
    for (const [offset, edit] of shown.entries()) {
      const place = starts[from + offset] ?? start
      const line = edit === 'add' ? newLines[place.new] : oldLines[place.old]
      if (line === undefined) continue
      lines.push({ kind: edit, text: line.text })
      if (!line.isEnded) lines.push({ kind: 'note', text: NO_NEWLINE })
    }
    first = last + 1
  }
  return lines
}
