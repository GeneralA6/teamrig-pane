// A Changes file's edits (T333): a press on a file's row in the Changes view (changes-rows.ts) opens its diff under
// it, and a second press closes it. A tracked file's diff is one `git --no-optional-locks diff HEAD -- <path>`: its
// staged and unstaged edits against the last commit, as its row counts them (`--cached` on a branch with no commit
// yet); a rename's names its old path too, with `-M`, so it shows as the one file it is. An untracked file's is
// `git diff --no-index` against nothing, every line added. Color, external diff tools and textconv filters are
// off, so the patch is git's own whatever the person's config says. Git's headers are left out: each hunk's `@@`
// line and its lines show, at most DIFF_KEPT of them, the rest counted. A file written outside git (T1362), keyed
// `outside:<path>`, has no git to ask: it diffs against the copy the pane kept before the session first wrote it
// (outside-copies.ts). The open diffs are read again after each read of the changes (changes.ts: after a write or a
// shell call, and every 60 s), so an open diff follows the edits, and a file that leaves the list closes its diff.
// Runs git for a repo's file, one run an open file a read; an outside file's is read from disk.
import type { ChangesSnapshot, DiffLine, FileChange, FileDiff, OpenDiffs, RepoChanges } from '../types'
import { failure, LITERAL, type GitRun } from './changes'
import { messageOf } from './errors'

/** The most lines of a diff kept and drawn; the rest are counted. */
export const DIFF_KEPT = 200
export const NO_DIFFS: OpenDiffs = {}
/** What leads the key of a file written outside git, `outside:<path>`; a repo's file is keyed by its root, an absolute path, so never by it. */
export const OUTSIDE = 'outside:'
const READING: FileDiff = { kind: 'reading' }
/** Flags that keep git's patch its own whatever its config says: no color, no external diff tool, no textconv filter. */
const PLAIN = ['--no-color', '--no-ext-diff', '--no-textconv'] as const
/** What a tab draws as, as on a file's page (file-page.ts). */
const TAB = '  '
/** A line git writes for a hunk, by its first character; any other inside a hunk is none of the patch's. */
const HUNK_LINES: Readonly<Record<string, DiffLine['kind']>> = { '+': 'add', '-': 'del', ' ': 'same', '\\': 'note' }

export type DiffPorts = {
  /** Runs `git <args>` in `cwd`; rejects when git cannot start or outlasts its timeout. */
  git: (args: readonly string[], cwd: string) => Promise<GitRun>
  /** A file written outside git as it is now against its copy from before the session first wrote it (outside-copies.ts). Never rejects. */
  outside: (path: string) => Promise<FileDiff>
  /** Writes the diffs atom (each write redraws the pane). */
  publish: (next: OpenDiffs) => Promise<void>
}

/** The file a diff's key names: one a repo lists, with its repo, or one written outside git, by its path. */
export type DiffFile = { kind: 'repo'; repo: RepoChanges; file: FileChange } | { kind: 'outside'; path: string }

/** The git run that reads `file`'s diff in its repo: against HEAD (the staged lines with no commit yet), or, untracked, against nothing. */
export function diffArgs(file: FileChange, isUnborn: boolean): string[] {
  if (file.code === '??') return ['--no-optional-locks', 'diff', ...PLAIN, '--no-index', '--', '/dev/null', file.path]
  const renamed = file.code.includes('R') && file.from !== null ? file.from : null
  const base = isUnborn ? '--cached' : 'HEAD'
  const paths = [file.path, ...(renamed === null ? [] : [renamed])].map(path => `${LITERAL}${path}`)
  return ['--no-optional-locks', 'diff', base, ...PLAIN, ...(renamed === null ? [] : ['-M']), '--', ...paths]
}

/** A line as a terminal draws it: a CRLF file's `\r` dropped, tabs as TAB, any other control character (it would move the cursor or start an escape) as `�`. */
export function drawable(text: string): string {
  return text.replace(/\r$/, '').replaceAll('\t', TAB).replace(/\p{Cc}/gu, '�')
}

/**
 * Git's patch as the lines a diff draws: each file's headers (`diff --git`, `index`, `---`, `+++`, its modes, a
 * rename's) left out up to its first `@@`, its `Binary files … differ` kept as a note; then each hunk's `@@` line and
 * its lines. The first DIFF_KEPT are kept and the rest counted. `isCut` (git wrote more than a run keeps) drops the
 * last line, which may stop part way.
 */
export function parseDiff(stdout: string, isCut: boolean): FileDiff {
  const written = stdout.split('\n')
  if (isCut) written.pop()
  const lines: DiffLine[] = []
  let more = 0
  let isHeader = true
  for (const line of written) {
    if (line.startsWith('diff --git ')) {
      isHeader = true
      continue
    }
    const kind: DiffLine['kind'] | undefined = line.startsWith('@@')
      ? 'hunk'
      : isHeader
        ? line.startsWith('Binary files ')
          ? 'note'
          : undefined
        : HUNK_LINES[line.charAt(0)]
    if (kind === undefined) continue
    if (kind === 'hunk') isHeader = false
    if (lines.length === DIFF_KEPT) {
      more++
      continue
    }
    const marked = kind === 'add' || kind === 'del' || kind === 'same'
    lines.push({ kind, text: drawable(marked ? line.slice(1) : line) })
  }
  return { kind: 'read', lines, more, isCut }
}

/** `file`'s diff in `repo`, read now; why not when git fails (exit 1 is `--no-index` finding a difference). Never rejects. */
export async function readDiff(git: DiffPorts['git'], repo: RepoChanges, file: FileChange): Promise<FileDiff> {
  try {
    const ran = await git(diffArgs(file, repo.isUnborn), repo.root)
    if (ran.exitCode !== 0 && ran.exitCode !== 1) return { kind: 'failed', problem: failure(ran) }
    return parseDiff(ran.stdout, ran.isStdoutTruncated)
  } catch (error) {
    return { kind: 'failed', problem: messageOf(error) }
  }
}

/** The file a Changes row's key names in `changes`: `<repo root>:<path>` with its repo, or `outside:<path>`; null once it is not listed. */
export function fileOf(changes: ChangesSnapshot, key: string): DiffFile | null {
  if (key.startsWith(OUTSIDE)) {
    const path = key.slice(OUTSIDE.length)
    return changes.outside.includes(path) ? { kind: 'outside', path } : null
  }
  for (const repo of changes.repos) {
    const file = repo.files.items.find(item => `${repo.root}:${item.path}` === key)
    if (file !== undefined) return { kind: 'repo', repo, file }
  }
  return null
}

/** The open diffs: opened and closed by a press, read again after each read of the changes. Writes the atom only on a change. */
export class LiveDiffs {
  private readonly open: Map<string, FileDiff>
  private changes: ChangesSnapshot
  /** What was last written, as JSON; null before the first write or after a failed one. */
  private shown: string | null = null

  private readonly ports: DiffPorts

  /** `seed`: the diffs open before a hot reload, and the changes drawn then; the next read of the changes reads them again. */
  constructor(ports: DiffPorts, seed: { diffs: OpenDiffs; changes: ChangesSnapshot }) {
    this.ports = ports
    this.open = new Map(Object.entries(seed.diffs))
    this.changes = seed.changes
  }

  /** Closes `key`'s diff when open; else opens it, `Reading…` until it is read. A file no longer listed opens none. Never rejects. */
  async toggle(key: string): Promise<void> {
    if (this.open.delete(key)) {
      await this.write()
      return
    }
    const found = fileOf(this.changes, key)
    if (found === null) return
    this.open.set(key, READING)
    await this.write()
    await this.readOne(key, found)
    await this.write()
  }

  /** The changes as just read: each open diff whose file is still listed is read again, the others close. Never rejects. */
  async refresh(changes: ChangesSnapshot): Promise<void> {
    this.changes = changes
    await Promise.all(
      [...this.open.keys()].map(async key => {
        const found = fileOf(changes, key)
        if (found === null) this.open.delete(key)
        else await this.readOne(key, found)
      }),
    )
    await this.write()
  }

  /** Reads `key`'s diff: git's for a repo's file, against its copy for one outside git; one closed while it was read stays closed. */
  private async readOne(key: string, found: DiffFile): Promise<void> {
    const diff = found.kind === 'outside' ? await this.ports.outside(found.path) : await readDiff(this.ports.git, found.repo, found.file)
    if (this.open.has(key)) this.open.set(key, diff)
  }

  /** Writes the open diffs when they changed; a failed write is tried again by the next. */
  private async write(): Promise<void> {
    const next: OpenDiffs = Object.fromEntries(this.open)
    const json = JSON.stringify(next)
    if (json === this.shown) return
    this.shown = null
    try {
      await this.ports.publish(next)
      this.shown = json
    } catch {
      // Left unshown: the next write tries again.
    }
  }
}
