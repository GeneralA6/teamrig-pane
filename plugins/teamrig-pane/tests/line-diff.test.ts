// Two texts' line diff (hooks/line-diff.ts): git's hunk lines and counts, the no-newline note, hunks merged and
// split by the context between them, and the shortest-edit search with its give-up.
import { describe, expect, test } from 'claude-code/testing'
import type { DiffLine } from '../types'
import { CONTEXT, MAX_EDITS, NO_NEWLINE, lineDiff, shortestEdit, type Edit } from '../hooks/line-diff'

const MARKS: Readonly<Record<DiffLine['kind'], string>> = { hunk: '', note: '', add: '+', del: '-', same: ' ' }

/** The lines as a patch writes them, so each case reads as git's output. */
function drawn(lines: readonly DiffLine[]): string[] {
  return lines.map(line => `${MARKS[line.kind]}${line.text}`)
}

/** `count` lines `1\n` … `count\n`, with `changes` swapped in by line number. */
function numbered(count: number, changes: Readonly<Record<number, string>> = {}): string {
  return Array.from({ length: count }, (_, index) => `${changes[index + 1] ?? index + 1}\n`).join('')
}

/** The two sequences an edit script walks: its kept and removed items, and its kept and added ones; throws when a kept pair differs. */
function walked<T>(a: readonly T[], b: readonly T[], edits: readonly Edit[]): { old: T[]; new: T[] } {
  const old: T[] = []
  const added: T[] = []
  let i = 0
  let j = 0
  for (const edit of edits) {
    const fromA = a[i]
    const fromB = b[j]
    if (edit === 'same' && fromA !== fromB) throw new Error(`kept ${String(fromA)} against ${String(fromB)}`)
    if (edit !== 'add') {
      if (fromA !== undefined) old.push(fromA)
      i++
    }
    if (edit !== 'del') {
      if (fromB !== undefined) added.push(fromB)
      j++
    }
  }
  return { old, new: added }
}

describe('line diff', () => {
  test('two equal texts have no lines', () => {
    expect(lineDiff('', '')).toEqual([])
    expect(lineDiff('a\nb\n', 'a\nb\n')).toEqual([])
    expect(lineDiff('a\nb', 'a\nb')).toEqual([])
  })

  test('one changed line in the middle of ten draws with its three lines of context on each side', () => {
    expect(drawn(lineDiff(numbered(10), numbered(10, { 5: 'five' })))).toEqual([
      '@@ -2,7 +2,7 @@',
      ' 2',
      ' 3',
      ' 4',
      '-5',
      '+five',
      ' 6',
      ' 7',
      ' 8',
    ])
  })

  test('a new file starts at line 0 with a count of 0; an emptied one leaves the count of 1 out', () => {
    expect(drawn(lineDiff('', 'a\nb\n'))).toEqual(['@@ -0,0 +1,2 @@', '+a', '+b'])
    expect(drawn(lineDiff('a\n', ''))).toEqual(['@@ -1 +0,0 @@', '-a'])
  })

  test('a last line with no newline is followed by the note, on each side', () => {
    expect(drawn(lineDiff('a\nb', 'a\nc'))).toEqual(['@@ -1,2 +1,2 @@', ' a', '-b', NO_NEWLINE, '+c', NO_NEWLINE])
    expect(drawn(lineDiff('x\na', 'y\na'))).toEqual(['@@ -1,2 +1,2 @@', '-x', '+y', ' a', NO_NEWLINE])
  })

  test('adding the newline a last line lacked changes that line', () => {
    expect(drawn(lineDiff('a', 'a\n'))).toEqual(['@@ -1 +1 @@', '-a', NO_NEWLINE, '+a'])
    expect(drawn(lineDiff('a\n', 'a'))).toEqual(['@@ -1 +1 @@', '-a', '+a', NO_NEWLINE])
  })

  test(`two changes ${CONTEXT * 2} unchanged lines apart share a hunk; ${CONTEXT * 2 + 1} apart, each has its own`, () => {
    const hunks = (after: string): string[] =>
      lineDiff(numbered(20), after).flatMap(line => (line.kind === 'hunk' ? [line.text] : []))
    expect(hunks(numbered(20, { 3: 'x', 10: 'y' }))).toEqual(['@@ -1,13 +1,13 @@'])
    expect(hunks(numbered(20, { 3: 'x', 11: 'y' }))).toEqual(['@@ -1,6 +1,6 @@', '@@ -8,7 +8,7 @@'])
  })

  test('an added line counts on the new side only, and the next hunk starts where each side is', () => {
    const after = numbered(20, { 2: '2\nnew' }).concat('21\n')
    expect(drawn(lineDiff(numbered(20), after))).toEqual([
      '@@ -1,5 +1,6 @@',
      ' 1',
      ' 2',
      '+new',
      ' 3',
      ' 4',
      ' 5',
      '@@ -18,3 +19,4 @@',
      ' 18',
      ' 19',
      ' 20',
      '+21',
    ])
  })

  test('a CRLF line keeps its \\r: drawing it is the drawer\'s job', () => {
    expect(drawn(lineDiff('a\r\nb\r\n', 'a\r\nc\r\n'))).toEqual(['@@ -1,2 +1,2 @@', ' a\r', '-b\r', '+c\r'])
  })

  test(`past ${MAX_EDITS} edits the changed middle draws as all removed, then all added`, () => {
    const removed = Array.from({ length: 600 }, (_, index) => `old ${index}\n`).join('')
    const added = Array.from({ length: 600 }, (_, index) => `new ${index}\n`).join('')
    const lines = lineDiff(`kept\n${removed}`, `${added}kept\n`)
    expect(lines[0]).toEqual({ kind: 'hunk', text: '@@ -1,601 +1,601 @@' })
    const kinds = lines.slice(1).map(line => line.kind)
    expect(kinds).toEqual([...Array<DiffLine['kind']>(601).fill('del'), ...Array<DiffLine['kind']>(601).fill('add')])
  })
})

describe('shortest edit', () => {
  const a = [...'ABCABBA']
  const b = [...'CBABAC']

  test('finds the fewest edits, 5 for ABCABBA to CBABAC, and they turn one into the other', () => {
    const edits = shortestEdit(a, b, MAX_EDITS)
    expect(edits?.filter(edit => edit !== 'same')).toHaveLength(5)
    expect(walked(a, b, edits ?? [])).toEqual({ old: a, new: b })
  })

  test('gives up past maxEdits', () => {
    expect(shortestEdit(a, b, 4)).toBe(null)
    expect(shortestEdit(a, b, 5)?.filter(edit => edit !== 'same')).toHaveLength(5)
  })

  test('an empty side is all added or all removed', () => {
    expect(shortestEdit([], ['x', 'y'], MAX_EDITS)).toEqual(['add', 'add'])
    expect(shortestEdit(['x'], [], MAX_EDITS)).toEqual(['del'])
    expect(shortestEdit([], [], MAX_EDITS)).toEqual([])
  })
})
