// The Changes files' diffs (hooks/diff.ts): the git run each file's diff takes, git's patch read into the lines
// drawn, and the open diffs opened, closed and read again over a fake git and a fake reader of the files written
// outside git.
import { describe, expect, test } from 'claude-code/testing'
import type { ChangesSnapshot, FileChange, FileDiff, OpenDiffs, RepoChanges } from '../types'
import type { GitRun } from '../hooks/changes'
import { DIFF_KEPT, LiveDiffs, NO_DIFFS, OUTSIDE, diffArgs, fileOf, parseDiff, readDiff, type DiffPorts } from '../hooks/diff'

const REPO = 'C:/work/repo'
const NOTE = 'C:/notes/plan.md'
const PATCH = [
  'diff --git a/hooks/a.ts b/hooks/a.ts',
  'index 1111111..2222222 100644',
  '--- a/hooks/a.ts',
  '+++ b/hooks/a.ts',
  '@@ -1,3 +1,3 @@ export function a()',
  ' const x = 1',
  '-const y = 2',
  '+const y = 3',
  '--- not a header inside a hunk',
  '\\ No newline at end of file',
  '',
].join('\n')

function ran(stdout: string, exitCode = 0, stderr = '', isStdoutTruncated = false): GitRun {
  return { exitCode, stdout, stderr, isStdoutTruncated }
}

function change(code: string, path: string, from: string | null = null): FileChange {
  return { code, path, from, lines: null }
}

function repo(files: FileChange[], isUnborn = false): RepoChanges {
  return { root: REPO, branch: 'main', files: { items: files, more: 0 }, isPartial: false, isUnborn, problem: null }
}

function snapshot(files: FileChange[], outside: string[] = []): ChangesSnapshot {
  return { repos: [repo(files)], outside, isRead: true }
}

/** A diff of one added line, as a file outside git reads against its copy. */
function oneAdded(text: string): FileDiff {
  return { kind: 'read', lines: [{ kind: 'hunk', text: '@@ -0,0 +1 @@' }, { kind: 'add', text }], more: 0, isCut: false }
}

/** No file outside git: a fake that is never asked. */
const NO_OUTSIDE: DiffPorts['outside'] = async path => ({ kind: 'failed', problem: `asked for ${path}` })

/**
 * A git that answers each diff from `answers` by the path it names last, a reader of the files outside git that
 * answers from `outside` by path, and the diffs written, in order; `runs` holds git's runs and the outside reads.
 */
function fakeDiffs(answers: Record<string, GitRun | Error>, outside: Record<string, FileDiff> = {}) {
  const runs: string[] = []
  const published: OpenDiffs[] = []
  const ports: DiffPorts = {
    git: async (args, cwd) => {
      const path = (args.at(-1) ?? '').replace(':(literal)', '')
      runs.push(`${cwd} ${path}`)
      const answer = answers[path] ?? ran('')
      if (answer instanceof Error) throw answer
      return answer
    },
    outside: async path => {
      runs.push(`outside ${path}`)
      return outside[path] ?? { kind: 'failed', problem: `no answer for ${path}` }
    },
    publish: async next => {
      published.push(next)
    },
  }
  return { ports, published, runs }
}

describe('diff', () => {
  test("a tracked file's diff is against HEAD, a rename's names its old path, one on an unborn branch is the staged lines", () => {
    const plain = ['--no-color', '--no-ext-diff', '--no-textconv']
    expect(diffArgs(change(' M', 'hooks/a.ts'), false)).toEqual(['--no-optional-locks', 'diff', 'HEAD', ...plain, '--', ':(literal)hooks/a.ts'])
    expect(diffArgs(change('R ', 'new.ts', 'old.ts'), false)).toEqual([
      '--no-optional-locks',
      'diff',
      'HEAD',
      ...plain,
      '-M',
      '--',
      ':(literal)new.ts',
      ':(literal)old.ts',
    ])
    // A copy's source is left as it was: only the new file differs.
    expect(diffArgs(change('C ', 'copy.ts', 'a.ts'), false).slice(-2)).toEqual(['--', ':(literal)copy.ts'])
    expect(diffArgs(change('A ', 'first.ts'), true)).toEqual(['--no-optional-locks', 'diff', '--cached', ...plain, '--', ':(literal)first.ts'])
  })

  test("an untracked file's diff is against nothing, its path as it is spelled", () => {
    expect(diffArgs(change('??', 'notes [draft].md'), false)).toEqual([
      '--no-optional-locks',
      'diff',
      '--no-color',
      '--no-ext-diff',
      '--no-textconv',
      '--no-index',
      '--',
      '/dev/null',
      'notes [draft].md',
    ])
  })

  test("git's patch reads as its hunks' lines, the headers left out and a hunk's own `---` line kept", () => {
    expect(parseDiff(PATCH, false)).toEqual({
      kind: 'read',
      lines: [
        { kind: 'hunk', text: '@@ -1,3 +1,3 @@ export function a()' },
        { kind: 'same', text: 'const x = 1' },
        { kind: 'del', text: 'const y = 2' },
        { kind: 'add', text: 'const y = 3' },
        { kind: 'del', text: '-- not a header inside a hunk' },
        { kind: 'note', text: '\\ No newline at end of file' },
      ],
      more: 0,
      isCut: false,
    })
  })

  test("a rename's and a binary file's headers: the rename shows its hunks, the binary file git's note", () => {
    const renamed = ['diff --git a/old.ts b/new.ts', 'similarity index 90%', 'rename from old.ts', 'rename to new.ts', '@@ -1 +1 @@', '-a', '+b', ''].join('\n')
    expect(parseDiff(renamed, false)).toMatchObject({ lines: [{ kind: 'hunk' }, { kind: 'del', text: 'a' }, { kind: 'add', text: 'b' }] })
    const binary = ['diff --git a/logo.png b/logo.png', 'index 1..2 100644', 'Binary files a/logo.png and b/logo.png differ', ''].join('\n')
    expect(parseDiff(binary, false)).toEqual({ kind: 'read', lines: [{ kind: 'note', text: 'Binary files a/logo.png and b/logo.png differ' }], more: 0, isCut: false })
    expect(parseDiff('', false)).toEqual({ kind: 'read', lines: [], more: 0, isCut: false })
  })

  test("a line draws as the terminal can: a CRLF file's \\r dropped, tabs as two spaces, other control characters as �", () => {
    const patch = ['diff --git a/a b/a', '@@ -0,0 +1,2 @@', '+\tindented\r', '+bell\u0007 and \u001b[31mred', ''].join('\n')
    expect(parseDiff(patch, false)).toMatchObject({
      lines: [{ kind: 'hunk' }, { kind: 'add', text: '  indented' }, { kind: 'add', text: 'bell\uFFFD and \uFFFD[31mred' }],
    })
  })

  test('the first DIFF_KEPT lines are kept and the rest counted; a patch git cut short drops its last, partial line', () => {
    const long = ['diff --git a/a b/a', '@@ -0,0 +1,250 @@', ...Array.from({ length: 250 }, (_, i) => `+line ${i}`), ''].join('\n')
    const read = parseDiff(long, false)
    expect(read).toMatchObject({ kind: 'read', more: 251 - DIFF_KEPT, isCut: false })
    expect(read.kind === 'read' ? read.lines.length : 0).toBe(DIFF_KEPT)
    expect(parseDiff('diff --git a/a b/a\n@@ -0,0 +1,2 @@\n+whole\n+par', true)).toEqual({
      kind: 'read',
      lines: [
        { kind: 'hunk', text: '@@ -0,0 +1,2 @@' },
        { kind: 'add', text: 'whole' },
      ],
      more: 0,
      isCut: true,
    })
  })

  test("a diff is read in the file's repo; `--no-index` finding a difference is no failure, git's error and a failed start are", async () => {
    const file = change('??', 'new.md')
    const added = ['diff --git a/new.md b/new.md', 'new file mode 100644', '--- /dev/null', '+++ b/new.md', '@@ -0,0 +1 @@', '+hello', ''].join('\n')
    const { ports, runs } = fakeDiffs({ 'new.md': ran(added, 1), 'bad.ts': ran('', 128, 'fatal: bad revision HEAD\n'), 'gone.ts': new Error('spawn git ENOENT') })
    expect(await readDiff(ports.git, repo([file]), file)).toMatchObject({ kind: 'read', lines: [{ kind: 'hunk' }, { kind: 'add', text: 'hello' }] })
    expect(runs).toEqual([`${REPO} new.md`])
    expect(await readDiff(ports.git, repo([]), change(' M', 'bad.ts'))).toEqual({ kind: 'failed', problem: 'fatal: bad revision HEAD' })
    expect(await readDiff(ports.git, repo([]), change(' M', 'gone.ts'))).toEqual({ kind: 'failed', problem: 'spawn git ENOENT' })
  })

  test("a row's key names its file in the changes, with its repo, or one outside git by its path; none once it is not listed", () => {
    const changes = snapshot([change(' M', 'hooks/a.ts')], [NOTE])
    expect(fileOf(changes, `${REPO}:hooks/a.ts`)).toMatchObject({ kind: 'repo', repo: { root: REPO }, file: { path: 'hooks/a.ts' } })
    expect(fileOf(changes, `${REPO}:hooks/b.ts`)).toBeNull()
    expect(fileOf(changes, 'C:/other:hooks/a.ts')).toBeNull()
    expect(fileOf(changes, `${OUTSIDE}${NOTE}`)).toEqual({ kind: 'outside', path: NOTE })
    expect(fileOf(changes, `${OUTSIDE}C:/notes/other.md`)).toBeNull()
  })

  test('a file outside git opens its diff against its copy, read again on each read of the changes, closed once it is not listed', async () => {
    const outside: Record<string, FileDiff> = { [NOTE]: oneAdded('first') }
    const { ports, published, runs } = fakeDiffs({}, outside)
    const key = `${OUTSIDE}${NOTE}`
    const diffs = new LiveDiffs(ports, { diffs: NO_DIFFS, changes: snapshot([], [NOTE]) })
    await diffs.toggle(key)
    expect(published).toEqual([{ [key]: { kind: 'reading' } }, { [key]: oneAdded('first') }])
    expect(runs).toEqual([`outside ${NOTE}`])

    // The session writes it again: the next read of the changes reads its diff again; git is never asked.
    outside[NOTE] = oneAdded('second')
    await diffs.refresh(snapshot([], [NOTE]))
    expect(published.at(-1)).toEqual({ [key]: oneAdded('second') })
    expect(runs).toEqual([`outside ${NOTE}`, `outside ${NOTE}`])

    // It left the list: its diff closes, unread.
    await diffs.refresh(snapshot([]))
    expect(published.at(-1)).toEqual({})
    expect(runs).toHaveLength(2)
  })

  test("a press opens a file's diff, `Reading…` until git answers, and a second press closes it", async () => {
    const { ports, published } = fakeDiffs({ 'hooks/a.ts': ran(PATCH) })
    const diffs = new LiveDiffs(ports, { diffs: NO_DIFFS, changes: snapshot([change(' M', 'hooks/a.ts')]) })
    const key = `${REPO}:hooks/a.ts`
    await diffs.toggle(key)
    expect(published[0]).toEqual({ [key]: { kind: 'reading' } })
    expect(published[1]?.[key]).toMatchObject({ kind: 'read', lines: [{ kind: 'hunk' }, { kind: 'same' }, { kind: 'del' }, { kind: 'add' }, { kind: 'del' }, { kind: 'note' }] })
    await diffs.toggle(key)
    expect(published).toHaveLength(3)
    expect(published[2]).toEqual({})
  })

  test('a press on a file no longer listed opens nothing', async () => {
    const { ports, published, runs } = fakeDiffs({})
    const diffs = new LiveDiffs(ports, { diffs: NO_DIFFS, changes: snapshot([]) })
    await diffs.toggle(`${REPO}:hooks/a.ts`)
    expect(published).toEqual([])
    expect(runs).toEqual([])
  })

  test('each read of the changes reads the open diffs again, writing only a change; a file that left the list closes its diff', async () => {
    const answers: Record<string, GitRun> = { 'a.ts': ran(PATCH), 'b.ts': ran(PATCH) }
    const { ports, published, runs } = fakeDiffs(answers)
    const seeded: OpenDiffs = { [`${REPO}:a.ts`]: { kind: 'reading' }, [`${REPO}:b.ts`]: { kind: 'reading' } }
    const diffs = new LiveDiffs(ports, { diffs: seeded, changes: snapshot([]) })
    const both = snapshot([change(' M', 'a.ts'), change(' M', 'b.ts')])
    await diffs.refresh(both)
    expect(runs).toEqual([`${REPO} a.ts`, `${REPO} b.ts`])
    expect(Object.values(published[0] ?? {}).map(diff => diff.kind)).toEqual(['read', 'read'])

    // Read again with nothing new: git runs, the atom is not written.
    await diffs.refresh(both)
    expect(runs).toHaveLength(4)
    expect(published).toHaveLength(1)

    // An edit that keeps the counts still shows; b.ts was committed and leaves the list.
    answers['a.ts'] = ran(PATCH.replace('+const y = 3', '+const y = 4'))
    await diffs.refresh(snapshot([change(' M', 'a.ts')]))
    expect(Object.keys(published[1] ?? {})).toEqual([`${REPO}:a.ts`])
    const read: FileDiff | undefined = published[1]?.[`${REPO}:a.ts`]
    expect(read?.kind === 'read' ? read.lines.find(line => line.kind === 'add')?.text : null).toBe('const y = 4')
  })

  test('a diff closed while git reads it stays closed', async () => {
    const key = `${REPO}:a.ts`
    let answer: (got: GitRun) => void = () => undefined
    let started: () => void = () => undefined
    const gitStarted = new Promise<void>(resolve => {
      started = resolve
    })
    const published: OpenDiffs[] = []
    const ports: DiffPorts = {
      git: () =>
        new Promise(resolve => {
          answer = resolve
          started()
        }),
      outside: NO_OUTSIDE,
      publish: async next => {
        published.push(next)
      },
    }
    const diffs = new LiveDiffs(ports, { diffs: NO_DIFFS, changes: snapshot([change(' M', 'a.ts')]) })
    const opening = diffs.toggle(key)
    await gitStarted
    await diffs.toggle(key)
    answer(ran(PATCH))
    await opening
    expect(published).toEqual([{ [key]: { kind: 'reading' } }, {}])
  })

  test('a failed write is tried again by the next, never rejecting', async () => {
    const key = `${REPO}:a.ts`
    let fails = 1
    const published: OpenDiffs[] = []
    const ports: DiffPorts = {
      git: async () => ran(PATCH),
      outside: NO_OUTSIDE,
      publish: async next => {
        if (fails-- > 0) throw new Error('state write failed')
        published.push(next)
      },
    }
    const diffs = new LiveDiffs(ports, { diffs: NO_DIFFS, changes: snapshot([change(' M', 'a.ts')]) })
    await diffs.toggle(key)
    expect(Object.values(published[0] ?? {}).map(diff => diff.kind)).toEqual(['read'])
  })
})
