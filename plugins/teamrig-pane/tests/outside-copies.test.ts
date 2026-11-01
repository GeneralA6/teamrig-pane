// The copies a file written outside git is diffed against (hooks/outside-copies.ts): kept ahead of the session's
// first write, dropped for a write that never landed or a file the Changes view no longer lists, and the file now
// diffed against its copy, over a fake disk.
import { describe, expect, test } from 'claude-code/testing'
import type { DiffLine, FileDiff, OutsideCopies } from '../types'
import { DIFF_KEPT } from '../hooks/diff'
import { COPY_MAX_BYTES, LiveCopies, NO_COPIES, NO_COPY, UNCHANGED, type CopyPorts } from '../hooks/outside-copies'
import { MemoryFiles } from './fixtures'

const REPO = 'C:/work/repo'
const NOTE = 'C:/notes/a.md'
const OTHER = 'C:/notes/b.md'
const THIRD = 'C:/notes/c.md'
const FRESH_START = { copies: NO_COPIES, outside: [] }
const MARKS: Readonly<Record<DiffLine['kind'], string>> = { hunk: '', note: '', add: '+', del: '-', same: ' ' }

/** A diff as a patch writes it, or `failed: <problem>`. */
function drawn(diff: FileDiff): string[] {
  if (diff.kind === 'reading') return ['reading']
  if (diff.kind === 'failed') return [`failed: ${diff.problem}`]
  return diff.lines.map(line => `${MARKS[line.kind]}${line.text}`)
}

/** A disk, a git where only REPO is a repo, and the copies written, in order; `failPublishes(n)` makes the next n writes reject. */
function fakeCopies() {
  const files = new MemoryFiles()
  const published: OutsideCopies[] = []
  const asked: string[] = []
  let failures = 0
  const ports: CopyPorts = {
    files,
    isOutsideGit: async path => {
      asked.push(path)
      return !path.startsWith(`${REPO}/`)
    },
    publish: async next => {
      if (failures > 0) {
        failures--
        throw new Error('store busy')
      }
      published.push(next)
    },
  }
  const failPublishes = (count: number) => {
    failures = count
  }
  return { asked, failPublishes, files, ports, published }
}

/** A tool call that writes `text` to `path` between the hooks' `before` and `after`. */
async function write(copies: LiveCopies, files: MemoryFiles, path: string, text: string): Promise<void> {
  await copies.before(path)
  files.write(path, text)
  await copies.after(path, true)
}

/** The paths the copies last written keep. */
function keptPaths(published: readonly OutsideCopies[]): string[] {
  return Object.keys(published.at(-1) ?? NO_COPIES).sort()
}

/** Lets every queued promise step run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

describe('outside copies', () => {
  test("a first write outside git keeps the file as it was, so its diff is the session's changes; a new file diffs as all added", async () => {
    const { files, ports, published } = fakeCopies()
    const copies = new LiveCopies(ports, FRESH_START)
    files.write(NOTE, 'one\ntwo\n')
    await write(copies, files, NOTE, 'one\nthree\n')
    await write(copies, files, OTHER, 'x\n')

    expect(published.at(-1)).toEqual({ [NOTE]: { kind: 'text', text: 'one\ntwo\n' }, [OTHER]: { kind: 'none' } })
    expect(drawn(await copies.diff(NOTE))).toEqual(['@@ -1,2 +1,2 @@', ' one', '-two', '+three'])
    expect(drawn(await copies.diff(OTHER))).toEqual(['@@ -0,0 +1 @@', '+x'])
  })

  test('a second write keeps the first copy: the diff is against the file before the first write', async () => {
    const { files, ports, published } = fakeCopies()
    const copies = new LiveCopies(ports, FRESH_START)
    files.write(NOTE, 'one\n')
    await write(copies, files, NOTE, 'two\n')
    await write(copies, files, NOTE, 'three\n')

    expect(published).toHaveLength(1)
    expect(drawn(await copies.diff(NOTE))).toEqual(['@@ -1 +1 @@', '-one', '+three'])
  })

  test('a file in a repo keeps no copy: git keeps its earlier version', async () => {
    const { asked, files, ports, published } = fakeCopies()
    const copies = new LiveCopies(ports, FRESH_START)
    await write(copies, files, `${REPO}/a.ts`, 'x\n')

    expect(asked).toEqual([`${REPO}/a.ts`])
    expect(published).toEqual([])
    expect(drawn(await copies.diff(`${REPO}/a.ts`))).toEqual([NO_COPY])
  })

  test('after a hot reload the copies kept before are diffed against; a file listed without a copy gets none, so earlier writes never hide', async () => {
    const { asked, files, ports, published } = fakeCopies()
    const copies = new LiveCopies(ports, { copies: { [NOTE]: { kind: 'text', text: 'one\n' } }, outside: [NOTE, OTHER] })
    files.write(OTHER, 'already written\n')
    await write(copies, files, NOTE, 'two\n')
    await write(copies, files, OTHER, 'written again\n')

    expect(asked).toEqual([])
    expect(published).toEqual([])
    expect(drawn(await copies.diff(NOTE))).toEqual(['@@ -1 +1 @@', '-one', '+two'])
    expect(drawn(await copies.diff(OTHER))).toEqual([NO_COPY])
  })

  test('a write that never landed (denied, failed) drops the copy it took; a copy kept for an earlier write stays', async () => {
    const { files, ports, published } = fakeCopies()
    const copies = new LiveCopies(ports, FRESH_START)
    files.write(NOTE, 'one\n')
    await copies.before(NOTE)
    await copies.after(NOTE, false)
    expect(published).toEqual([{ [NOTE]: { kind: 'text', text: 'one\n' } }, {}])
    expect(drawn(await copies.diff(NOTE))).toEqual([NO_COPY])

    await write(copies, files, NOTE, 'two\n')
    await copies.before(NOTE)
    await copies.after(NOTE, false)
    expect(keptPaths(published)).toEqual([NOTE])
    expect(drawn(await copies.diff(NOTE))).toEqual(['@@ -1 +1 @@', '-one', '+two'])
  })

  test("two calls on a path at once: the second waits on the first's read, and one of them written keeps the copy", async () => {
    const { files, ports } = fakeCopies()
    let release: (isOutside: boolean) => void = () => undefined
    const held = new Promise<boolean>(resolve => {
      release = resolve
    })
    let asks = 0
    const copies = new LiveCopies(
      {
        ...ports,
        isOutsideGit: () => {
          asks++
          return held
        },
      },
      FRESH_START,
    )
    files.write(NOTE, 'one\n')
    let isSecondDone = false
    const first = copies.before(NOTE)
    const second = copies.before(NOTE).then(() => {
      isSecondDone = true
    })
    await settle()
    expect(isSecondDone).toBe(false)

    release(true)
    await Promise.all([first, second])
    expect(asks).toBe(1)
    files.write(NOTE, 'two\n')
    await copies.after(NOTE, false)
    await copies.after(NOTE, true)
    expect(drawn(await copies.diff(NOTE))).toEqual(['@@ -1 +1 @@', '-one', '+two'])
  })

  test('each read of the changes drops the copies of files it no longer lists, sparing a write under way and, once, one just landed', async () => {
    const { files, ports, published } = fakeCopies()
    const copies = new LiveCopies(ports, FRESH_START)
    await write(copies, files, NOTE, 'a\n')
    await copies.before(OTHER)
    await write(copies, files, THIRD, 'c\n')

    await copies.keep([THIRD])
    expect(keptPaths(published)).toEqual([NOTE, OTHER, THIRD])
    await copies.keep([THIRD])
    expect(keptPaths(published)).toEqual([OTHER, THIRD])

    files.write(OTHER, 'b\n')
    await copies.after(OTHER, true)
    await copies.keep([THIRD])
    expect(keptPaths(published)).toEqual([OTHER, THIRD])
    await copies.keep([THIRD])
    expect(keptPaths(published)).toEqual([THIRD])
  })

  test('a file too big, not text, or unreadable before its first write diffs as a note that says so, never read past the cap', async () => {
    const { files, ports } = fakeCopies()
    const copies = new LiveCopies(ports, FRESH_START)
    files.write(NOTE, 'x'.repeat(COPY_MAX_BYTES + 1))
    await write(copies, files, NOTE, 'small\n')
    files.write(OTHER, 'a\u0000b')
    await write(copies, files, OTHER, 'text\n')
    files.write(THIRD, 'locked\n')
    files.failNextRead = 'EBUSY: resource busy or locked'
    await write(copies, files, THIRD, 'free\n')

    expect(files.reads.filter(path => path === NOTE)).toEqual([])
    expect(drawn(await copies.diff(NOTE))).toEqual(['65 KiB before the session first wrote it, over the 64 KiB a diff reads'])
    expect(drawn(await copies.diff(OTHER))).toEqual(['Not text before the session first wrote it: no diff'])
    expect(drawn(await copies.diff(THIRD))).toEqual(['Could not read it before the session first wrote it: EBUSY: resource busy or locked'])
  })

  test('the file now: too big or not text is a note, unreadable fails the diff, gone is every line removed, the same text says so', async () => {
    const { files, ports } = fakeCopies()
    const copies = new LiveCopies(ports, FRESH_START)
    const large = 'C:/notes/large.md'
    const binary = 'C:/notes/binary.md'
    const locked = 'C:/notes/locked.md'
    const gone = 'C:/notes/gone.md'
    const same = 'C:/notes/same.md'
    for (const path of [large, binary, locked, gone, same]) {
      files.write(path, 'a\nb\n')
      await write(copies, files, path, 'a\nb\n')
    }
    files.write(large, 'x'.repeat(COPY_MAX_BYTES + 1))
    files.write(binary, 'a\u0000b')
    files.remove(gone)

    expect(drawn(await copies.diff(large))).toEqual(['65 KiB now, over the 64 KiB a diff reads'])
    expect(drawn(await copies.diff(binary))).toEqual(['Not text now: no diff'])
    files.failNextRead = 'EBUSY: resource busy or locked'
    expect(await copies.diff(locked)).toEqual({ kind: 'failed', problem: 'EBUSY: resource busy or locked' })
    expect(drawn(await copies.diff(gone))).toEqual(['@@ -1,2 +0,0 @@', '-a', '-b'])
    expect(drawn(await copies.diff(same))).toEqual([UNCHANGED])
  })

  test('the lines are drawn as a terminal shows them, and the first DIFF_KEPT kept with the rest counted', async () => {
    const { files, ports } = fakeCopies()
    const copies = new LiveCopies(ports, FRESH_START)
    const rest = Array.from({ length: DIFF_KEPT + 2 }, (_, index) => `${index + 3}\n`).join('')
    await write(copies, files, NOTE, `a\tb\r\nc\u001b[2Jd\n${rest}`)

    const diff = await copies.diff(NOTE)
    expect(diff).toMatchObject({ kind: 'read', more: 5, isCut: false })
    const lines = drawn(diff)
    expect(lines).toHaveLength(DIFF_KEPT)
    expect(lines.slice(0, 3)).toEqual([`@@ -0,0 +1,${DIFF_KEPT + 4} @@`, '+a  b', '+c�[2Jd'])
  })

  test('a copy the store could not take is written again at the next read, and only then', async () => {
    const { failPublishes, files, ports, published } = fakeCopies()
    const copies = new LiveCopies(ports, FRESH_START)
    failPublishes(1)
    files.write(NOTE, 'one\n')
    await write(copies, files, NOTE, 'two\n')
    expect(published).toEqual([])

    await copies.keep([NOTE])
    await copies.keep([NOTE])
    expect(published).toEqual([{ [NOTE]: { kind: 'text', text: 'one\n' } }])
  })
})
