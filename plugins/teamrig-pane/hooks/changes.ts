// The Changes view's data: the files changed in the git repos this session works in, and their changed
// lines. A repo is known from the session's folder and from each file the session writes (Edit, Write,
// NotebookEdit: the tool.call hooks in register.tsx), its root found once per folder with `git rev-parse
// --show-toplevel` (a worktree's own root, never the main checkout's). A file written outside any repo
// is listed as such, the newest OUTSIDE_KEPT. Git never runs in a folder that is not there: a folder is
// checked before its root is asked, and a repo's `.git` before each read, so a repo whose folder or
// `.git` is gone (a removed worktree) leaves the list. A read costs one `git --no-optional-locks status
// --porcelain=v1 -b -z` (no index lock, so it never blocks a commit); while files changed, one `diff
// HEAD --numstat -z` counts the tracked files' lines and one `grep --untracked -I -c` the untracked
// ones' (a second grep only to tell an untracked binary file from an empty one). A repo is read on the
// next 3 s poll after a write or a shell call (a burst of edits costs one read), every 60 s (a commit or
// a change made from elsewhere), and at once when the person switches to the view; after each read the
// open diffs are read again (diff.ts). Runs git only; no model calls. The repos and outside files found
// are kept apart from the drawn snapshot (KnownChanges), so a reload that bumps the snapshot's shape
// still knows them. Before each write the tool hooks also ask whether its file is outside every repo
// (isOutsideGit, the same one rev-parse a folder), so outside-copies.ts keeps such a file's copy.
import type { ChangesSnapshot, Cut, FileChange, KnownChanges, LineCount, RepoChanges } from '../types'
import { messageOf } from './errors'
import { POLL_MS, TICK_MS, type Timer } from './live'

export const EMPTY_CHANGES: ChangesSnapshot = { repos: [], outside: [], isRead: false }
export const NOTHING_KNOWN: KnownChanges = { roots: [], outside: [] }
/** The most files kept per repo; the rest are counted. */
export const CHANGES_KEPT = 200
/** The most files kept that were written outside any repo. */
export const OUTSIDE_KEPT = 20
/** The most characters of untracked paths one grep names, well under Windows' 32,767-character command line; the rest go uncounted. */
export const PATHSPEC_BUDGET = 16_000
const TOPLEVEL = ['rev-parse', '--show-toplevel'] as const
const STATUS = ['--no-optional-locks', 'status', '--porcelain=v1', '-b', '-z'] as const
/** Names a path as it is spelled, never as a glob. */
export const LITERAL = ':(literal)'
/** A status line on a branch with no commit yet. */
const UNBORN = /^(?:No commits yet|Initial commit) on (.+)$/
const BINARY: LineCount = { kind: 'binary' }
const NO_LINES: ReadonlyMap<string, LineCount> = new Map()

/** What a git run answers: `$.process.run`'s result, the fields read here. */
export type GitRun = { exitCode: number; stdout: string; stderr: string; isStdoutTruncated: boolean }

export type ChangesPorts = {
  /** Runs `git <args>` in `cwd`; rejects when git cannot start or outlasts its timeout. */
  git: (args: readonly string[], cwd: string) => Promise<GitRun>
  /** Whether a file or folder is there; may reject when it cannot tell. */
  exists: (path: string) => Promise<boolean>
  /** Writes the changes atom (each write redraws the pane). */
  publish: (next: ChangesSnapshot) => Promise<void>
  /** Runs after each read, whether or not it changed what is drawn: the open diffs (diff.ts) are read again, as an edit can keep a file's counts. Never rejects. */
  onRead: (read: ChangesSnapshot) => Promise<void>
}

/** The folder a file is in, by either separator; a drive or filesystem root keeps its separator; `.` for a bare name. */
export function folderOf(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (cut < 0) return '.'
  const folder = path.slice(0, cut)
  return folder === '' || /^[A-Za-z]:$/.test(folder) ? path.slice(0, cut + 1) : folder
}

/** The branch a `## ` status line names: `main...origin/main [ahead 1]`, `No commits yet on main`; null when detached. */
export function branchOf(line: string): string | null {
  const unborn = UNBORN.exec(line)
  if (unborn?.[1] !== undefined) return unborn[1]
  if (line.startsWith('HEAD (no branch)')) return null
  const name = line.split(' [')[0]?.split('...')[0] ?? ''
  return name === '' ? null : name
}

/**
 * Reads `git status --porcelain=v1 -b -z`: NUL-separated entries, the branch's `## ` first, each
 * file `XY path`, a rename's or copy's source path the entry after it. `isUnborn`: the branch has no
 * commit yet, so there is no HEAD to count lines against. The lines are counted after (withLines).
 */
export function parseStatus(stdout: string): { branch: string | null; isUnborn: boolean; files: FileChange[] } {
  const entries = stdout.split('\0')
  let branch: string | null = null
  let isUnborn = false
  const files: FileChange[] = []
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] ?? ''
    if (entry.startsWith('## ')) {
      branch = branchOf(entry.slice(3))
      isUnborn = UNBORN.test(entry.slice(3))
    } else if (entry.length > 3) {
      const code = entry.slice(0, 2)
      const from = /[RC]/.test(code) ? (entries[++i] ?? null) : null
      files.push({ code, path: entry.slice(3), from, lines: null })
    }
  }
  return { branch, isUnborn, files }
}

/**
 * Reads `git diff --numstat -z`: each file `added TAB removed TAB path` NUL-ended, a rename's or copy's
 * path left empty and its source and new path the next two entries; `-` for both counts of a binary
 * file. Keyed by the path git status lists (a rename's new one).
 */
export function parseNumstat(stdout: string): Map<string, LineCount> {
  const lines = new Map<string, LineCount>()
  const entries = stdout.split('\0')
  for (let i = 0; i < entries.length; i++) {
    const match = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(entries[i] ?? '')
    if (match === null) continue
    const [, added = '-', removed = '-', named = ''] = match
    let path = named
    if (path === '') {
      i += 2
      path = entries[i] ?? ''
    }
    if (path === '') continue
    lines.set(path, added === '-' || removed === '-' ? BINARY : { kind: 'text', added: Number(added), removed: Number(removed) })
  }
  return lines
}

/** Reads `git grep -c -z`: one line a file, `path NUL count`. */
export function parseGrepCounts(stdout: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const line of stdout.split('\n')) {
    const cut = line.lastIndexOf('\0')
    const count = line.slice(cut + 1).trim()
    if (cut > 0 && /^\d+$/.test(count)) counts.set(line.slice(0, cut), Number(count))
  }
  return counts
}

/** How many files the view lists: every repo's changed files, then those written outside any repo. */
export function changeCount(changes: ChangesSnapshot): number {
  return changes.repos.reduce((sum, repo) => sum + repo.files.items.length + repo.files.more, 0) + changes.outside.length
}

/** The folder name a repo's root ends in. */
export function repoName(root: string): string {
  return root.split(/[\\/]/).filter(part => part !== '').at(-1) ?? root
}

function kept<T>(items: readonly T[], most: number): Cut<T> {
  return { items: items.slice(0, most), more: Math.max(0, items.length - most) }
}

/** Lines that were all added: an untracked file's or folder's. */
function allAdded(count: number): LineCount {
  return { kind: 'text', added: count, removed: 0 }
}

/** The first paths whose pathspecs fit PATHSPEC_BUDGET characters. */
function withinBudget(paths: readonly string[]): string[] {
  const named: string[] = []
  let used = 0
  for (const path of paths) {
    used += LITERAL.length + path.length + 1
    if (used > PATHSPEC_BUDGET) break
    named.push(path)
  }
  return named
}

/** The tracked files' lines against HEAD; with no commit yet, the staged lines (against the empty tree). */
function numstatArgs(isUnborn: boolean): string[] {
  return ['--no-optional-locks', 'diff', isUnborn ? '--cached' : 'HEAD', '--numstat', '-z']
}

/** Counts each named untracked file's lines (`-e ''` matches every line, whatever `grep.patternType` says); `-I` leaves binary files out. */
function grepArgs(paths: readonly string[], isTextOnly: boolean): string[] {
  const textOnly = isTextOnly ? ['-I'] : []
  return ['--no-optional-locks', 'grep', '--untracked', ...textOnly, '-c', '-z', '-e', '', '--', ...paths.map(path => `${LITERAL}${path}`)]
}

/** The first line git wrote to stderr, or what its exit code says. */
export function failure(ran: GitRun): string {
  const line = ran.stderr.split('\n').find(text => text.trim() !== '')
  return line?.trim() ?? `git exited ${ran.exitCode}`
}

/** The repos and outside files a drawn snapshot holds. */
export function knownOf(changes: ChangesSnapshot): KnownChanges {
  return { roots: changes.repos.map(repo => repo.root), outside: [...changes.outside] }
}

/**
 * What a reloaded pane starts from: the known repos and files, and those of the snapshot it drew when
 * that still reads (a pane that kept no known list yet wrote only the snapshot).
 */
export function knownSeed(drawn: ChangesSnapshot, kept: KnownChanges): KnownChanges {
  const roots = new Set([...kept.roots, ...drawn.repos.map(repo => repo.root)])
  const outside = new Set([...kept.outside, ...drawn.outside])
  return { roots: [...roots], outside: [...outside].slice(0, OUTSIDE_KEPT) }
}

export class LiveChanges {
  /** Each folder's repo root, null outside any repo: one rev-parse a folder. */
  private readonly roots = new Map<string, string | null>()
  /** The repo roots, in the order found. */
  private readonly repos = new Set<string>()
  private outside: string[]
  private isDirty = true
  private isReading = false
  private shown: ChangesSnapshot | null = null
  private timers: Timer[] = []

  private readonly ports: ChangesPorts

  /** `seed` is what the pane knew before a hot reload: its repos and outside files stay known. */
  constructor(ports: ChangesPorts, seed: KnownChanges = NOTHING_KNOWN) {
    this.ports = ports
    for (const root of seed.roots) this.repos.add(root)
    this.outside = seed.outside.slice(0, OUTSIDE_KEPT)
  }

  /** Reads again on the 3 s poll when something may have changed, and every 60 s in any case; neither rejects. */
  startTimers(every: (ms: number, fn: () => void) => Timer): void {
    this.stop()
    this.timers = [every(POLL_MS, () => void this.refresh(false)), every(TICK_MS, () => void this.refresh())]
  }

  stop(): void {
    for (const timer of this.timers) timer.cancel()
    this.timers = []
  }

  /** Adds the repo `folder` is in, if any. Never rejects. */
  async addFolder(folder: string): Promise<void> {
    const root = await this.rootOf(folder)
    if (typeof root !== 'string' || this.repos.has(root)) return
    this.repos.add(root)
    this.isDirty = true
  }

  /** A file the session wrote: its repo is read on the next poll, or it is listed as outside git. Never rejects. */
  async noteWrite(path: string): Promise<void> {
    this.isDirty = true
    const root = await this.rootOf(folderOf(path))
    if (root === undefined) return
    if (root === null) this.outside = [path, ...this.outside.filter(known => known !== path)].slice(0, OUTSIDE_KEPT)
    else this.repos.add(root)
  }

  /**
   * Whether `path` is outside every repo: its folder is in none, or not there yet, or git cannot be asked (so far
   * outside; the read that finds it in a repo leaves it off the outside list). Never rejects.
   */
  async isOutsideGit(path: string): Promise<boolean> {
    return typeof (await this.rootOf(folderOf(path))) !== 'string'
  }

  /** A shell call may have committed, staged or written files: read again on the next poll. */
  markDirty(): void {
    this.isDirty = true
  }

  /** Reads every known repo (with `force` false, only when something may have changed), writing only a change. Never rejects. */
  async refresh(force = true): Promise<void> {
    if (!force && !this.isDirty) return
    if (this.isReading) {
      this.isDirty = true
      return
    }
    this.isReading = true
    this.isDirty = false
    try {
      const read = await Promise.all([...this.repos].map(root => this.readRepo(root)))
      const next: ChangesSnapshot = { repos: read.filter(repo => repo !== null), outside: [...this.outside], isRead: true }
      if (this.shown === null || JSON.stringify(this.shown) !== JSON.stringify(next)) {
        await this.ports.publish(next)
        this.shown = next
      }
      await this.ports.onRead(next)
    } catch {
      this.isDirty = true
    } finally {
      this.isReading = false
    }
  }

  /**
   * A folder's repo root; null outside any repo, kept so the folder is asked once; undefined when the
   * folder is not there or git cannot be asked, so it is asked again next time. Never rejects.
   */
  private async rootOf(folder: string): Promise<string | null | undefined> {
    const known = this.roots.get(folder)
    if (known !== undefined) return known
    try {
      if (!(await this.ports.exists(folder))) return undefined
      const ran = await this.ports.git(TOPLEVEL, folder)
      const root = ran.exitCode === 0 && ran.stdout.trim() !== '' ? ran.stdout.trim() : null
      this.roots.set(folder, root)
      return root
    } catch {
      return undefined
    }
  }

  /** Drops a repo that is gone, and the folders known to be in it, so a later write there asks its root again. */
  private forget(root: string): void {
    this.repos.delete(root)
    for (const [folder, known] of this.roots) if (known === root) this.roots.delete(folder)
  }

  /** One repo as git reads it now; null once its folder or its `.git` is gone, and it leaves the list. */
  private async readRepo(root: string): Promise<RepoChanges | null> {
    const unread = { root, branch: null, files: kept<FileChange>([], CHANGES_KEPT), isPartial: false, isUnborn: false }
    try {
      if (!(await this.ports.exists(`${root}/.git`))) {
        this.forget(root)
        return null
      }
      const ran = await this.ports.git(STATUS, root)
      if (ran.exitCode !== 0) return { ...unread, problem: failure(ran) }
      const status = parseStatus(ran.stdout)
      const files = kept(status.files, CHANGES_KEPT)
      const items = await this.withLines(root, files.items, status.isUnborn)
      return { root, branch: status.branch, files: { items, more: files.more }, isPartial: ran.isStdoutTruncated, isUnborn: status.isUnborn, problem: null }
    } catch (error) {
      return { ...unread, problem: messageOf(error) }
    }
  }

  /** The files with their changed lines: one numstat while a tracked file changed, the greps while an untracked one is listed. Never rejects. */
  private async withLines(root: string, files: readonly FileChange[], isUnborn: boolean): Promise<FileChange[]> {
    const untracked = files.filter(file => file.code === '??').map(file => file.path)
    const [tracked, fresh] = await Promise.all([
      untracked.length < files.length ? this.trackedLines(root, isUnborn) : NO_LINES,
      untracked.length > 0 ? this.untrackedLines(root, untracked) : NO_LINES,
    ])
    return files.map(file => ({ ...file, lines: (file.code === '??' ? fresh : tracked).get(file.path) ?? null }))
  }

  /** Each tracked file's lines; none when git fails or its list was cut short. Never rejects. */
  private async trackedLines(root: string, isUnborn: boolean): Promise<ReadonlyMap<string, LineCount>> {
    const ran = await this.ports.git(numstatArgs(isUnborn), root).catch(() => null)
    return ran === null || ran.exitCode !== 0 || ran.isStdoutTruncated ? NO_LINES : parseNumstat(ran.stdout)
  }

  /**
   * Each untracked entry's lines, all added: a file's, binary or empty when `-I` left it out (a second
   * grep tells which), and a folder's summed over the text files in it (none counted when it holds no
   * text). Paths past PATHSPEC_BUDGET, and every path when grep fails, go uncounted. Never rejects.
   */
  private async untrackedLines(root: string, paths: readonly string[]): Promise<ReadonlyMap<string, LineCount>> {
    const named = withinBudget(paths)
    const lines = new Map<string, LineCount>()
    const text = await this.grepCounts(root, named, true)
    if (text === null) return lines
    const left: string[] = []
    for (const path of named) {
      if (path.endsWith('/')) {
        const inside = [...text].filter(([file]) => file.startsWith(path))
        if (inside.length > 0) lines.set(path, allAdded(inside.reduce((sum, [, count]) => sum + count, 0)))
        continue
      }
      const count = text.get(path)
      if (count === undefined) left.push(path)
      else lines.set(path, allAdded(count))
    }
    if (left.length === 0) return lines
    const any = await this.grepCounts(root, left, false)
    if (any !== null) for (const path of left) lines.set(path, any.has(path) ? BINARY : allAdded(0))
    return lines
  }

  /** Each named file's line count; null when grep fails or its list was cut short (exit 1 only says no line matched). Never rejects. */
  private async grepCounts(root: string, paths: readonly string[], isTextOnly: boolean): Promise<Map<string, number> | null> {
    const ran = await this.ports.git(grepArgs(paths, isTextOnly), root).catch(() => null)
    if (ran === null || ran.isStdoutTruncated || (ran.exitCode !== 0 && ran.exitCode !== 1)) return null
    return parseGrepCounts(ran.stdout)
  }
}
