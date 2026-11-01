// The copies a Changes file written outside git is diffed against (T1362): git keeps no earlier version of such a
// file, so the pane keeps one. The Edit, Write and NotebookEdit hooks (register.tsx) call `before` ahead of the tool:
// the first time the session writes a file outside any repo, its content is kept (not there yet is kept too, so a new
// file diffs as all added); `after` the tool, a copy taken for a write that never landed (denied, failed) is dropped.
// A file the Changes view already lists without a copy (written before this pane kept one) gets none: a copy taken
// now would hide the earlier writes. Each read of the changes drops the copies of files no longer listed (`keep`),
// sparing one whose write is under way (an Edit can wait on a permission prompt across reads) or just landed (its
// listing may come a read later). A press diffs the file as it is now against its copy (line-diff.ts). Reads at
// most COPY_MAX_BYTES of a file: one bigger, or not text, is kept as such and diffs as a note. The copies live in
// an atom (register.tsx COPIES_SHAPE), so a hot reload keeps them. Reads files only; runs nothing.
import type { DiffLine, FileDiff, OutsideCopies, OutsideCopy } from '../types'
import { DIFF_KEPT, drawable } from './diff'
import { messageOf } from './errors'
import { lineDiff } from './line-diff'
import { kib } from './ref-file'
import type { Files } from './source'

/** The most of a file kept as its copy, and read again for its diff: an outside file the session writes is a note or a page, far under it. */
export const COPY_MAX_BYTES = 64 * 1024
export const NO_COPIES: OutsideCopies = {}
const NONE: OutsideCopy = { kind: 'none' }
const BINARY: OutsideCopy = { kind: 'binary' }
/** What a diff says when the file has no copy. */
export const NO_COPY = 'No copy from before its first write: written before the pane kept one'
/** What a diff says when no line changed. */
export const UNCHANGED = 'No line changed since the session first wrote it'

export type CopyPorts = {
  files: Files
  /** Whether a file is outside every git repo (a folder not there yet counts as outside). Never rejects. */
  isOutsideGit: (path: string) => Promise<boolean>
  /** Writes the copies atom. */
  publish: (next: OutsideCopies) => Promise<void>
}

/** A write under way: how many tool calls on the path are between `before` and `after`, the read of its copy, whether this round took the copy, and whether any call wrote. */
type Pending = { calls: number; read: Promise<void>; isTaken: boolean; isWritten: boolean }

/** A diff that is one note. */
function noted(text: string): FileDiff {
  return { kind: 'read', lines: [{ kind: 'note', text }], more: 0, isCut: false }
}

/** The text a copy diffs as, or the note that says why it has none. */
function textOf(copy: OutsideCopy, when: 'before' | 'now'): { text: string } | { note: string } | { problem: string } {
  const at = when === 'before' ? 'before the session first wrote it' : 'now'
  switch (copy.kind) {
    case 'none':
      return { text: '' }
    case 'text':
      return { text: copy.text }
    case 'large':
      return { note: `${kib(copy.bytes)} KiB ${at}, over the ${kib(COPY_MAX_BYTES)} KiB a diff reads` }
    case 'binary':
      return { note: `Not text ${at}: no diff` }
    case 'unread':
      return when === 'before' ? { note: `Could not read it before the session first wrote it: ${copy.problem}` } : { problem: copy.problem }
  }
}

/** The copies of the files written outside git: taken before a first write, dropped once a file leaves the list. */
export class LiveCopies {
  private readonly copies: Map<string, OutsideCopy>
  private readonly pending = new Map<string, Pending>()
  /** The outside files the last read of the changes listed. */
  private listed: ReadonlySet<string>
  /** Files written since the last `keep`, spared by it once: a write's listing may come a read later. */
  private readonly fresh = new Set<string>()
  /** A change to the copies not yet written to the atom (the last write failed). */
  private isUnwritten = false

  private readonly ports: CopyPorts

  /** `seed`: the copies kept before a hot reload, and the outside files listed then. */
  constructor(ports: CopyPorts, seed: { copies: OutsideCopies; outside: readonly string[] }) {
    this.ports = ports
    this.copies = new Map(Object.entries(seed.copies))
    this.listed = new Set(seed.outside)
  }

  /** Ahead of a tool's write: keeps the file's copy on the session's first write outside git. A second call on a path waits on the first's read. Never rejects. */
  async before(path: string): Promise<void> {
    const under = this.pending.get(path)
    if (under !== undefined) {
      under.calls++
      await under.read
      return
    }
    const pending: Pending = { calls: 1, read: Promise.resolve(), isTaken: false, isWritten: false }
    pending.read = this.take(path, pending)
    this.pending.set(path, pending)
    await pending.read
  }

  /** After a tool's write, `isWritten` when it landed: once the path's last call is done, a copy taken for writes that never landed is dropped. Never rejects. */
  async after(path: string, isWritten: boolean): Promise<void> {
    const pending = this.pending.get(path)
    if (pending === undefined) return
    pending.isWritten ||= isWritten
    if (--pending.calls > 0) return
    this.pending.delete(path)
    if (pending.isWritten) this.fresh.add(path)
    else if (pending.isTaken && this.copies.delete(path)) await this.write()
  }

  /** The outside files a read of the changes listed: the copies of the others go, but for a write under way or just landed. Never rejects. */
  async keep(outside: readonly string[]): Promise<void> {
    this.listed = new Set(outside)
    let isDropped = false
    for (const path of [...this.copies.keys()]) {
      if (this.listed.has(path) || this.pending.has(path) || this.fresh.has(path)) continue
      this.copies.delete(path)
      isDropped = true
    }
    this.fresh.clear()
    if (isDropped || this.isUnwritten) await this.write()
  }

  /** `path`'s diff: the file now against its copy, drawn as a terminal shows it, the first DIFF_KEPT lines kept. Never rejects. */
  async diff(path: string): Promise<FileDiff> {
    const copy = this.copies.get(path)
    if (copy === undefined) return noted(NO_COPY)
    const before = textOf(copy, 'before')
    if ('note' in before) return noted(before.note)
    if ('problem' in before) return { kind: 'failed', problem: before.problem }
    const now = textOf(await this.copyOf(path), 'now')
    if ('note' in now) return noted(now.note)
    if ('problem' in now) return { kind: 'failed', problem: now.problem }
    const lines = lineDiff(before.text, now.text)
    if (lines.length === 0) return noted(UNCHANGED)
    const drawn: DiffLine[] = lines.slice(0, DIFF_KEPT).map(line => ({ kind: line.kind, text: drawable(line.text) }))
    return { kind: 'read', lines: drawn, more: lines.length - drawn.length, isCut: false }
  }

  /** Keeps `path`'s copy when the session writes it outside git for the first time this pane knows of. Never rejects. */
  private async take(path: string, pending: Pending): Promise<void> {
    if (this.copies.has(path) || this.listed.has(path) || !(await this.ports.isOutsideGit(path))) return
    this.copies.set(path, await this.copyOf(path))
    pending.isTaken = true
    await this.write()
  }

  /** The file as it is now: not there, its text, too big, not text, or why it could not be read. Never rejects. */
  private async copyOf(path: string): Promise<OutsideCopy> {
    try {
      const stamp = await this.ports.files.stamp(path)
      if (stamp === null) return NONE
      if (stamp.size > COPY_MAX_BYTES) return { kind: 'large', bytes: stamp.size }
      const text = await this.ports.files.read(path)
      return text.includes('\u0000') ? BINARY : { kind: 'text', text }
    } catch (error) {
      return { kind: 'unread', problem: messageOf(error) }
    }
  }

  /** Writes the copies; a failed write is tried again by the next `keep`. */
  private async write(): Promise<void> {
    try {
      await this.ports.publish(Object.fromEntries(this.copies))
      this.isUnwritten = false
    } catch {
      this.isUnwritten = true
    }
  }
}
