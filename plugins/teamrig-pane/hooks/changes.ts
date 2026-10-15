// The Changes view's data: the files changed in the git repos this session works in. A repo is known
// from the session's folder and from each file the session writes (Edit, Write, NotebookEdit: the
// tool.call hooks in register.tsx), its root found once per folder with `git rev-parse
// --show-toplevel` (a worktree's own root, never the main checkout's). A file written outside any repo
// is listed as such, the newest OUTSIDE_KEPT. Each repo costs one `git --no-optional-locks status
// --porcelain=v1 -b -z` (no index lock, so it never blocks a commit): on the next 3 s poll after a
// write or a shell call (a burst of edits costs one run), every 60 s (a commit or a change made from
// elsewhere), and at once when the person switches to the view. Runs git only; no model calls.
import type { ChangesSnapshot, Cut, FileChange, RepoChanges } from '../types'
import { POLL_MS, TICK_MS, type Timer } from './live'

export const EMPTY_CHANGES: ChangesSnapshot = { repos: [], outside: [], isRead: false }
/** The most files kept per repo; the rest are counted. */
export const CHANGES_KEPT = 200
/** The most files kept that were written outside any repo. */
export const OUTSIDE_KEPT = 20
const TOPLEVEL = ['rev-parse', '--show-toplevel'] as const
const STATUS = ['--no-optional-locks', 'status', '--porcelain=v1', '-b', '-z'] as const

/** What a git run answers: `$.process.run`'s result, the fields read here. */
export type GitRun = { exitCode: number; stdout: string; stderr: string; isStdoutTruncated: boolean }

export type ChangesPorts = {
  /** Runs `git <args>` in `cwd`; rejects when git cannot start or outlasts its timeout. */
  git: (args: readonly string[], cwd: string) => Promise<GitRun>
  /** Writes the changes atom (each write redraws the pane). */
  publish: (next: ChangesSnapshot) => Promise<void>
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
  const unborn = /^(?:No commits yet|Initial commit) on (.+)$/.exec(line)
  if (unborn?.[1] !== undefined) return unborn[1]
  if (line.startsWith('HEAD (no branch)')) return null
  const name = line.split(' [')[0]?.split('...')[0] ?? ''
  return name === '' ? null : name
}

/**
 * Reads `git status --porcelain=v1 -b -z`: NUL-separated entries, the branch's `## ` first, each
 * file `XY path`, a rename's or copy's source path the entry after it.
 */
export function parseStatus(stdout: string): { branch: string | null; files: FileChange[] } {
  const entries = stdout.split('\0')
  let branch: string | null = null
  const files: FileChange[] = []
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] ?? ''
    if (entry.startsWith('## ')) branch = branchOf(entry.slice(3))
    else if (entry.length > 3) {
      const code = entry.slice(0, 2)
      const from = /[RC]/.test(code) ? (entries[++i] ?? null) : null
      files.push({ code, path: entry.slice(3), from })
    }
  }
  return { branch, files }
}

/** How many files the view lists: every repo's changed files, then those written outside any repo. */
export function changeCount(changes: ChangesSnapshot): number {
  return changes.repos.reduce((sum, repo) => sum + repo.files.items.length + repo.files.more, 0) + changes.outside.length
}

function kept<T>(items: readonly T[], most: number): Cut<T> {
  return { items: items.slice(0, most), more: Math.max(0, items.length - most) }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The first line git wrote to stderr, or what its exit code says. */
function failure(ran: GitRun): string {
  const line = ran.stderr.split('\n').find(text => text.trim() !== '')
  return line?.trim() ?? `git exited ${ran.exitCode}`
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

  /** `seed` is what the pane drew before a hot reload: its repos and outside files stay known. */
  constructor(ports: ChangesPorts, seed: ChangesSnapshot = EMPTY_CHANGES) {
    this.ports = ports
    for (const repo of seed.repos) this.repos.add(repo.root)
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
    const root = await this.rootOf(folder).catch(() => null)
    if (root === null || this.repos.has(root)) return
    this.repos.add(root)
    this.isDirty = true
  }

  /** A file the session wrote: its repo is read on the next poll, or it is listed as outside git. Never rejects. */
  async noteWrite(path: string): Promise<void> {
    this.isDirty = true
    const root = await this.rootOf(folderOf(path)).catch(() => undefined)
    if (root === undefined) return
    if (root === null) this.outside = [path, ...this.outside.filter(known => known !== path)].slice(0, OUTSIDE_KEPT)
    else this.repos.add(root)
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
      const repos = await Promise.all([...this.repos].map(root => this.readRepo(root)))
      const next: ChangesSnapshot = { repos, outside: [...this.outside], isRead: true }
      if (this.shown !== null && JSON.stringify(this.shown) === JSON.stringify(next)) return
      await this.ports.publish(next)
      this.shown = next
    } catch {
      this.isDirty = true
    } finally {
      this.isReading = false
    }
  }

  /** A git that cannot start rejects, and the folder is asked again next time; one outside any repo is kept as null. */
  private async rootOf(folder: string): Promise<string | null> {
    const known = this.roots.get(folder)
    if (known !== undefined) return known
    const ran = await this.ports.git(TOPLEVEL, folder)
    const root = ran.exitCode === 0 && ran.stdout.trim() !== '' ? ran.stdout.trim() : null
    this.roots.set(folder, root)
    return root
  }

  private async readRepo(root: string): Promise<RepoChanges> {
    const unread = { root, branch: null, files: kept<FileChange>([], CHANGES_KEPT), isPartial: false }
    try {
      const ran = await this.ports.git(STATUS, root)
      if (ran.exitCode !== 0) return { ...unread, problem: failure(ran) }
      const status = parseStatus(ran.stdout)
      return { root, branch: status.branch, files: kept(status.files, CHANGES_KEPT), isPartial: ran.isStdoutTruncated, problem: null }
    } catch (error) {
      return { ...unread, problem: messageOf(error) }
    }
  }
}
