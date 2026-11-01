// The Changes view: its data (hooks/changes.ts), git's status read per repo and repos found from the files the session
// writes, and its rows (hooks/changes-rows.ts).
import { describe, expect, test } from 'claude-code/testing'
import type { ChangesSnapshot, DiffLine, FileChange, FileDiff, KnownChanges, LineCount, OpenDiffs, RepoChanges } from '../types'
import {
  branchOf,
  changeCount,
  CHANGES_KEPT,
  EMPTY_CHANGES,
  folderOf,
  knownOf,
  knownSeed,
  LiveChanges,
  NOTHING_KNOWN,
  OUTSIDE_KEPT,
  parseGrepCounts,
  parseNumstat,
  parseStatus,
  PATHSPEC_BUDGET,
  type ChangesPorts,
  type GitRun,
} from '../hooks/changes'
import {
  CHANGES_NOTHING_FOUND,
  CHANGES_SEARCH_HINT,
  changesBlocks,
  changesLabel,
  changeWords,
  DIFF_HINT,
  DIFF_LINE_ROWS,
  diffRows,
  lineSpans,
  paneTitle,
} from '../hooks/changes-rows'
import { searchChanges } from '../hooks/changes-search'
import type { Block } from '../hooks/rows'

const REPO = 'C:/work/repo'
const STATUS_OUT = ['## pane-v2...origin/pane-v2 [ahead 2]', ' M hooks/a.ts', 'R  hooks/new.ts', 'hooks/old.ts', '?? tests/', ''].join('\0')

/** What a git run answers. */
function ran(stdout: string, exitCode = 0, stderr = ''): GitRun {
  return { exitCode, stdout, stderr, isStdoutTruncated: false }
}

/** A text file's lines. */
function text(added: number, removed: number): LineCount {
  return { kind: 'text', added, removed }
}

/** A changed file, its lines not counted unless given. */
function change(code: string, path: string, from: string | null = null, lines: LineCount | null = null): FileChange {
  return { code, path, from, lines }
}

/** What the line counts' git runs answer: the numstat, and each grep by its arguments; an Error rejects. */
type LineAnswers = { diff?: GitRun | Error; grep?: (args: readonly string[]) => GitRun | Error }

function answered(got: GitRun | Error): GitRun {
  if (got instanceof Error) throw got
  return got
}

/**
 * A git over fixed answers: each folder's root (absent: not a repo), each root's status output, or a run that rejects,
 * and the line counts' runs (by default no tracked line changed and no untracked line matched); and a disk where every
 * path is there but those in `gone`. `calls` lists each git run as `<command> <cwd>`, `argv` its arguments, `checked`
 * each path asked about, `reads` each snapshot read.
 */
function fakeGit(roots: Record<string, string>, statuses: Record<string, GitRun | Error>, gone = new Set<string>(), lines: LineAnswers = {}) {
  const calls: string[] = []
  const argv: (readonly string[])[] = []
  const checked: string[] = []
  const published: ChangesSnapshot[] = []
  const reads: ChangesSnapshot[] = []
  const ports: ChangesPorts = {
    exists: async path => {
      checked.push(path)
      return !gone.has(path)
    },
    git: async (args, cwd) => {
      const command = args.find(arg => !arg.startsWith('-')) ?? ''
      calls.push(`${command} ${cwd}`)
      argv.push(args)
      if (command === 'diff') return answered(lines.diff ?? ran(''))
      if (command === 'grep') return answered(lines.grep?.(args) ?? ran('', 1))
      if (command === 'rev-parse') {
        const root = roots[cwd]
        return root === undefined ? ran('', 128, 'fatal: not a git repository (or any of the parent directories): .git\n') : ran(`${root}\n`)
      }
      const status = statuses[cwd]
      if (status instanceof Error) throw status
      return status ?? ran('## main\0')
    },
    publish: async next => {
      published.push(next)
    },
    onRead: async read => {
      reads.push(read)
    },
  }
  return { argv, calls, checked, published, ports, reads }
}

describe('changes', () => {
  test('the folder of a file, by either separator, a root keeping its separator', () => {
    expect(folderOf('C:\\work\\repo\\a.ts')).toBe('C:\\work\\repo')
    expect(folderOf('C:/work/repo/a.ts')).toBe('C:/work/repo')
    expect(folderOf('C:\\a.ts')).toBe('C:\\')
    expect(folderOf('/a.ts')).toBe('/')
    expect(folderOf('a.ts')).toBe('.')
  })

  test("the branch git's status line names, null when detached", () => {
    expect(branchOf('main...origin/main [ahead 1, behind 2]')).toBe('main')
    expect(branchOf('pane-v2')).toBe('pane-v2')
    expect(branchOf('No commits yet on main')).toBe('main')
    expect(branchOf('HEAD (no branch)')).toBeNull()
  })

  test('reads the branch and each file, a rename with where it came from, and whether the branch has a commit yet', () => {
    expect(parseStatus(STATUS_OUT)).toEqual({
      branch: 'pane-v2',
      isUnborn: false,
      files: [change(' M', 'hooks/a.ts'), change('R ', 'hooks/new.ts', 'hooks/old.ts'), change('??', 'tests/')],
    })
    expect(parseStatus(['## main', 'A  a file with spaces.ts', ''].join('\0')).files).toEqual([change('A ', 'a file with spaces.ts')])
    expect(parseStatus(['## No commits yet on main', 'A  a.ts', ''].join('\0'))).toEqual({ branch: 'main', isUnborn: true, files: [change('A ', 'a.ts')] })
    expect(parseStatus('')).toEqual({ branch: null, isUnborn: false, files: [] })
  })

  test("reads numstat's lines: a rename under its new path, a binary file as binary, anything else skipped", () => {
    const out = ['5\t2\thooks/a.ts', '3\t1\t', 'hooks/old.ts', 'hooks/new.ts', '-\t-\tlogo.png', '0\t0\ta\tname with a tab.ts', 'warning: not numstat', '1\t0\t', ''].join('\0')
    expect([...parseNumstat(out)]).toEqual([
      ['hooks/a.ts', text(5, 2)],
      ['hooks/new.ts', text(3, 1)],
      ['logo.png', { kind: 'binary' }],
      ['a\tname with a tab.ts', text(0, 0)],
    ])
    expect(parseNumstat('').size).toBe(0)
  })

  test("reads grep's per-file counts, skipping a line that names no file or no count", () => {
    expect([...parseGrepCounts(['notes.md\u00004', 'new dir/x.ts\u000010', '\u00003', 'no count here', 'x.ts\u0000many', ''].join('\n'))]).toEqual([
      ['notes.md', 4],
      ['new dir/x.ts', 10],
    ])
  })

  test("a write in a repo adds it: its status read on the next poll, a folder's root asked once, an unchanged status not written again", async () => {
    const { calls, published, ports } = fakeGit({ 'C:/work/repo/hooks': REPO }, { [REPO]: ran(STATUS_OUT) })
    const changes = new LiveChanges(ports)
    await changes.noteWrite('C:/work/repo/hooks/a.ts')
    await changes.noteWrite('C:/work/repo/hooks/b.ts')
    await changes.refresh(false)

    expect(calls).toEqual(['rev-parse C:/work/repo/hooks', `status ${REPO}`, `diff ${REPO}`, `grep ${REPO}`])
    expect(published).toHaveLength(1)
    const [repo] = published[0]?.repos ?? []
    expect(repo?.branch).toBe('pane-v2')
    expect(repo?.files.items.map(file => file.path)).toEqual(['hooks/a.ts', 'hooks/new.ts', 'tests/'])
    expect(published[0] === undefined ? 0 : changeCount(published[0])).toBe(3)

    const statuses = () => calls.filter(call => call.startsWith('status')).length
    await changes.refresh(false)
    expect(statuses()).toBe(1)
    await changes.refresh()
    expect(statuses()).toBe(2)
    expect(published).toHaveLength(1)
  })

  test('a file written outside any repo is listed newest first, once, the newest few kept', async () => {
    const { published, ports } = fakeGit({}, {})
    const changes = new LiveChanges(ports)
    for (let i = 0; i < OUTSIDE_KEPT + 3; i++) await changes.noteWrite(`C:/notes/n${i}.md`)
    await changes.noteWrite('C:/notes/n22.md')
    await changes.noteWrite('C:/notes/n5.md')
    await changes.refresh()

    const outside = published[0]?.outside ?? []
    expect(outside).toHaveLength(OUTSIDE_KEPT)
    expect(outside.slice(0, 3)).toEqual(['C:/notes/n5.md', 'C:/notes/n22.md', 'C:/notes/n21.md'])
  })

  test('each read is handed on, drawn or not, so the open diffs are read again with it', async () => {
    const { published, ports, reads } = fakeGit({ 'C:/work/repo': REPO }, {})
    const changes = new LiveChanges(ports)
    await changes.addFolder('C:/work/repo')
    await changes.refresh()
    await changes.refresh()
    expect(published).toHaveLength(1)
    expect(reads).toHaveLength(2)
    expect(reads[1]).toEqual(published[0])
  })

  test("the session's folder adds its repo; a folder outside any repo adds none", async () => {
    const { calls, published, ports } = fakeGit({ 'C:/work/repo': REPO }, {})
    const changes = new LiveChanges(ports)
    await changes.addFolder('C:/elsewhere')
    await changes.addFolder('C:/work/repo')
    await changes.refresh()
    expect(calls).toEqual(['rev-parse C:/elsewhere', 'rev-parse C:/work/repo', `status ${REPO}`])
    expect(published[0]?.repos.map(repo => repo.branch)).toEqual(['main'])
    expect(published[0]?.isRead).toBe(true)
  })

  test('a file is outside git when its folder is in no repo, not there yet, or git cannot be asked; a repo folder is asked once', async () => {
    const { calls, ports } = fakeGit({ 'C:/work/repo': REPO }, {}, new Set(['C:/new']))
    const changes = new LiveChanges(ports)
    expect(await changes.isOutsideGit('C:/work/repo/a.ts')).toBe(false)
    expect(await changes.isOutsideGit('C:/work/repo/b.ts')).toBe(false)
    expect(await changes.isOutsideGit('C:/notes/a.md')).toBe(true)
    expect(await changes.isOutsideGit('C:/new/a.md')).toBe(true)
    expect(calls).toEqual(['rev-parse C:/work/repo', 'rev-parse C:/notes'])
    const unstarted = new LiveChanges({ ...ports, git: async () => Promise.reject(new Error('spawn git ENOENT')) })
    expect(await unstarted.isOutsideGit('C:/work/repo/a.ts')).toBe(true)
  })

  test("a repo git cannot read shows why; a git that cannot start leaves the file unlisted and is asked again", async () => {
    const { calls, published, ports } = fakeGit(
      { 'C:/work/repo': REPO, 'C:/work/slow': 'C:/work/slow' },
      { [REPO]: ran('', 128, '\nfatal: bad object HEAD\nmore\n'), 'C:/work/slow': new Error('git timed out after 10000 ms') },
    )
    const changes = new LiveChanges(ports)
    await changes.addFolder('C:/work/repo')
    await changes.addFolder('C:/work/slow')
    await changes.refresh()
    expect(published[0]?.repos.map(repo => repo.problem)).toEqual(['fatal: bad object HEAD', 'git timed out after 10000 ms'])

    expect(calls.filter(call => call.startsWith('rev-parse'))).toHaveLength(2)

    let starts = 0
    const failing: ChangesPorts = { ...ports, git: async () => Promise.reject(new Error(`spawn git ENOENT ${++starts}`)) }
    const unstarted = new LiveChanges(failing)
    await unstarted.noteWrite('C:/x/a.ts')
    await unstarted.noteWrite('C:/x/a.ts')
    await unstarted.refresh()
    expect(starts).toBe(2)
    expect(published.at(-1)).toEqual({ repos: [], outside: [], isRead: true })
  })

  test('a long status keeps the first files and counts the rest', async () => {
    const lines = Array.from({ length: CHANGES_KEPT + 5 }, (_, i) => `?? f${i}.ts`)
    const { published, ports } = fakeGit({ 'C:/work/repo': REPO }, { [REPO]: ran(['## main', ...lines, ''].join('\0')) })
    const changes = new LiveChanges(ports)
    await changes.addFolder('C:/work/repo')
    await changes.refresh()
    const snapshot = published[0]
    expect(snapshot?.repos[0]?.files.items).toHaveLength(CHANGES_KEPT)
    expect(snapshot?.repos[0]?.files.more).toBe(5)
    expect(snapshot === undefined ? 0 : changeCount(snapshot)).toBe(CHANGES_KEPT + 5)
  })

  test('after a hot reload the repos and files the pane knew stay known', async () => {
    const { calls, published, ports } = fakeGit({}, {})
    await new LiveChanges(ports, { roots: [REPO], outside: ['C:/notes/a.md'] }).refresh()
    expect(calls).toEqual([`status ${REPO}`])
    expect(published[0]?.outside).toEqual(['C:/notes/a.md'])
  })

  test('the known repos and files are those drawn, and a reloaded pane starts from both the known and the drawn ones', () => {
    const drawn: ChangesSnapshot = {
      repos: [{ root: REPO, branch: 'main', files: { items: [], more: 0 }, isPartial: false, isUnborn: false, problem: null }],
      outside: ['C:/notes/a.md'],
      isRead: true,
    }
    expect(knownOf(drawn)).toEqual({ roots: [REPO], outside: ['C:/notes/a.md'] })
    // A pane that wrote no known list yet: the drawn snapshot alone.
    expect(knownSeed(drawn, NOTHING_KNOWN)).toEqual({ roots: [REPO], outside: ['C:/notes/a.md'] })
    // A snapshot under an older shape reads as empty: the known list alone.
    expect(knownSeed(EMPTY_CHANGES, { roots: [REPO], outside: ['C:/notes/a.md'] })).toEqual({ roots: [REPO], outside: ['C:/notes/a.md'] })
    const many = Array.from({ length: OUTSIDE_KEPT + 5 }, (_, i) => `C:/notes/${i}.md`)
    const both = knownSeed({ ...drawn, outside: ['C:/notes/a.md', ...many] }, { roots: ['C:/other'], outside: ['C:/notes/a.md'] })
    expect(both.roots).toEqual(['C:/other', REPO])
    expect(both.outside).toHaveLength(OUTSIDE_KEPT)
    expect(both.outside[0]).toBe('C:/notes/a.md')
  })

  test('a read asked while one runs is done on the next poll; the timers poll every 3 s and read every 60 s', async () => {
    const { calls, ports } = fakeGit({ 'C:/work/repo': REPO }, {})
    let release = () => {}
    const gate = new Promise<void>(resolve => (release = resolve))
    const held: ChangesPorts = {
      ...ports,
      git: async (args, cwd) => {
        if (args[0] !== 'rev-parse' && calls.length === 1) await gate
        return ports.git(args, cwd)
      },
    }
    const changes = new LiveChanges(held)
    await changes.addFolder('C:/work/repo')
    const first = changes.refresh()
    await changes.refresh()
    release()
    await first
    expect(calls).toEqual(['rev-parse C:/work/repo', `status ${REPO}`])
    await changes.refresh(false)
    expect(calls).toEqual(['rev-parse C:/work/repo', `status ${REPO}`, `status ${REPO}`])

    const timers: { ms: number; fn: () => void }[] = []
    let cancelled = 0
    changes.startTimers((ms, fn) => {
      timers.push({ ms, fn })
      return { cancel: () => void cancelled++ }
    })
    expect(timers.map(timer => timer.ms)).toEqual([3_000, 60_000])
    changes.stop()
    expect(cancelled).toBe(2)
  })

  test('the poll reads again only once something may have changed (a shell call marks it); the tick reads in any case', async () => {
    const { calls, ports } = fakeGit({ 'C:/work/repo': REPO }, {})
    const statuses = () => calls.filter(call => call.startsWith('status')).length
    // A timer's read is not awaited: let it run before counting.
    const settled = () => new Promise<void>(resolve => setTimeout(resolve, 0))
    const started = async () => {
      const changes = new LiveChanges(ports)
      await changes.addFolder('C:/work/repo')
      await changes.refresh()
      const fired: (() => void)[] = []
      changes.startTimers((_ms, fn) => {
        fired.push(fn)
        return { cancel: () => undefined }
      })
      return { changes, poll: fired[0], tick: fired[1] }
    }
    const polled = await started()
    polled.poll?.()
    await settled()
    expect(statuses()).toBe(1)
    polled.changes.markDirty()
    polled.poll?.()
    await settled()
    expect(statuses()).toBe(2)

    const ticked = await started()
    expect(statuses()).toBe(3)
    ticked.tick?.()
    await settled()
    expect(statuses()).toBe(4)
  })

  test('a repo whose folder is removed leaves the list, git never runs there, and a write there once it is back asks its root again', async () => {
    const gone = new Set<string>()
    const { calls, published, ports } = fakeGit({ 'C:/work/repo/hooks': REPO, 'C:/work/repo': REPO }, { [REPO]: ran(STATUS_OUT) }, gone)
    const changes = new LiveChanges(ports)
    await changes.addFolder('C:/work/repo')
    await changes.noteWrite('C:/work/repo/hooks/a.ts')
    await changes.refresh()
    expect(published[0]?.repos.map(repo => repo.root)).toEqual([REPO])

    for (const path of [REPO, `${REPO}/.git`, 'C:/work/repo/hooks']) gone.add(path)
    const before = calls.length
    await changes.refresh()
    expect(published.at(-1)).toEqual({ repos: [], outside: [], isRead: true })
    // A write into the removed folder is not listed, and nothing runs git in it.
    await changes.noteWrite('C:/work/repo/hooks/b.ts')
    await changes.refresh()
    expect(calls.slice(before)).toEqual([])
    expect(published.at(-1)?.outside).toEqual([])

    gone.clear()
    await changes.noteWrite('C:/work/repo/hooks/c.ts')
    await changes.refresh()
    expect(calls.slice(before)).toEqual(['rev-parse C:/work/repo/hooks', `status ${REPO}`, `diff ${REPO}`, `grep ${REPO}`])
    expect(published.at(-1)?.repos.map(repo => repo.root)).toEqual([REPO])
  })

  test('a removed worktree whose folder is left behind (no .git) leaves the list without a git run', async () => {
    const { calls, checked, published, ports } = fakeGit({}, {}, new Set([`${REPO}/.git`]))
    const seed: KnownChanges = { roots: [REPO], outside: [] }
    await new LiveChanges(ports, seed).refresh()
    expect(checked).toEqual([`${REPO}/.git`])
    expect(calls).toEqual([])
    expect(published).toEqual([{ repos: [], outside: [], isRead: true }])
  })

  test('a repo the disk cannot be asked about shows why; a folder it cannot be asked about adds no repo and is asked again', async () => {
    const { calls, published, ports } = fakeGit({ 'C:/work/repo': REPO }, {})
    const refusing: ChangesPorts = {
      ...ports,
      exists: async path => (path === `${REPO}/.git` ? Promise.reject(new Error('EPERM: operation not permitted')) : ports.exists(path)),
    }
    const seed: KnownChanges = { roots: [REPO], outside: [] }
    await new LiveChanges(refusing, seed).refresh()
    expect(published[0]?.repos.map(repo => repo.problem)).toEqual(['EPERM: operation not permitted'])
    expect(calls).toEqual([])

    let asks = 0
    const unsure = new LiveChanges({ ...ports, exists: async () => Promise.reject(new Error(`EBUSY ${++asks}`)) })
    await unsure.noteWrite('C:/work/repo/a.ts')
    await unsure.noteWrite('C:/work/repo/a.ts')
    await unsure.refresh()
    expect(asks).toBe(2)
    expect(calls).toEqual([])
    expect(published.at(-1)).toEqual({ repos: [], outside: [], isRead: true })
  })

  test("each file's lines: tracked ones from one numstat, untracked ones all added, a binary file as binary, a folder summed", async () => {
    const status = ['## main', ' M a.ts', 'R  new.ts', 'old.ts', ' D gone.ts', '?? notes.md', '?? empty.txt', '?? logo.png', '?? newdir/', '?? bin/', ''].join('\0')
    const numstat = ['5\t2\ta.ts', '3\t1\t', 'old.ts', 'new.ts', '0\t7\tgone.ts', ''].join('\0')
    const { argv, published, ports } = fakeGit({}, { [REPO]: ran(status) }, new Set(), {
      diff: ran(numstat),
      grep: args => (args.includes('-I') ? ran(['notes.md\u00004', 'newdir/x.ts\u000010', 'newdir/y.ts\u00002', ''].join('\n')) : ran('logo.png\u00001\n')),
    })
    const seed: KnownChanges = { roots: [REPO], outside: [] }
    await new LiveChanges(ports, seed).refresh()

    const lines = Object.fromEntries((published[0]?.repos[0]?.files.items ?? []).map(file => [file.path, file.lines]))
    expect(lines).toEqual({
      'a.ts': text(5, 2),
      'new.ts': text(3, 1),
      'gone.ts': text(0, 7),
      'notes.md': text(4, 0),
      'empty.txt': text(0, 0),
      'logo.png': { kind: 'binary' },
      'newdir/': text(12, 0),
      'bin/': null,
    })
    expect(published[0]?.repos[0]?.problem).toBeNull()
    expect(argv.filter(args => args.includes('diff'))).toEqual([['--no-optional-locks', 'diff', 'HEAD', '--numstat', '-z']])
    const literal = (paths: string[]) => paths.map(path => `:(literal)${path}`)
    expect(argv.filter(args => args.includes('grep'))).toEqual([
      ['--no-optional-locks', 'grep', '--untracked', '-I', '-c', '-z', '-e', '', '--', ...literal(['notes.md', 'empty.txt', 'logo.png', 'newdir/', 'bin/'])],
      ['--no-optional-locks', 'grep', '--untracked', '-c', '-z', '-e', '', '--', ...literal(['empty.txt', 'logo.png'])],
    ])
  })

  test('counts only what changed: no numstat while every file is untracked, no grep while none is, staged lines on a branch with no commit yet', async () => {
    const unborn = fakeGit({ 'C:/work/repo': REPO }, { [REPO]: ran(['## No commits yet on main', 'A  a.ts', ''].join('\0')) }, new Set(), { diff: ran('2\t0\ta.ts\0') })
    const fresh = new LiveChanges(unborn.ports)
    await fresh.addFolder('C:/work/repo')
    await fresh.refresh()
    expect(unborn.calls).toEqual(['rev-parse C:/work/repo', `status ${REPO}`, `diff ${REPO}`])
    expect(unborn.argv.at(-1)).toEqual(['--no-optional-locks', 'diff', '--cached', '--numstat', '-z'])
    expect(unborn.published[0]?.repos[0]?.files.items).toEqual([change('A ', 'a.ts', null, text(2, 0))])
    expect(unborn.published[0]?.repos[0]?.isUnborn).toBe(true)

    const untracked = fakeGit({ 'C:/work/repo': REPO }, { [REPO]: ran(['## main', '?? a.ts', ''].join('\0')) }, new Set(), { grep: () => ran('a.ts\u00003\n') })
    const only = new LiveChanges(untracked.ports)
    await only.addFolder('C:/work/repo')
    await only.refresh()
    expect(untracked.calls).toEqual(['rev-parse C:/work/repo', `status ${REPO}`, `grep ${REPO}`])
    expect(untracked.published[0]?.repos[0]?.files.items).toEqual([change('??', 'a.ts', null, text(3, 0))])
  })

  test('lines git cannot count are left out, never a warning: a failed or cut-short numstat, a failed grep, a failed second grep', async () => {
    const status = ran(['## main', ' M a.ts', '?? notes.md', '?? logo.png', ''].join('\0'))
    const linesOf = async (answers: LineAnswers) => {
      const { published, ports } = fakeGit({ 'C:/work/repo': REPO }, { [REPO]: status }, new Set(), answers)
      const changes = new LiveChanges(ports)
      await changes.addFolder('C:/work/repo')
      await changes.refresh()
      const repo = published[0]?.repos[0]
      expect(repo?.problem).toBeNull()
      return repo?.files.items.map(file => file.lines)
    }
    const counted = (args: readonly string[]) => (args.includes('-I') ? ran('notes.md\u00004\n') : ran('logo.png\u00001\n'))
    expect(await linesOf({ diff: ran('', 128, 'fatal: bad revision'), grep: counted })).toEqual([null, text(4, 0), { kind: 'binary' }])
    expect(await linesOf({ diff: { ...ran('1\t1\ta.ts\0'), isStdoutTruncated: true }, grep: counted })).toEqual([null, text(4, 0), { kind: 'binary' }])
    expect(await linesOf({ diff: new Error('git timed out after 10000 ms'), grep: () => ran('', 128, 'fatal: bad pathspec') })).toEqual([null, null, null])
    expect(await linesOf({ diff: ran('1\t1\ta.ts\0'), grep: () => new Error('git timed out after 10000 ms') })).toEqual([text(1, 1), null, null])
    expect(await linesOf({ grep: args => (args.includes('-I') ? ran('notes.md\u00004\n') : { ...ran(''), isStdoutTruncated: true }) })).toEqual([null, text(4, 0), null])
  })

  test('untracked paths past the pathspec budget go uncounted, the rest counted in one grep', async () => {
    const paths = Array.from({ length: 200 }, (_, i) => `${'d'.repeat(96)}/f${String(i).padStart(3, '0')}`)
    const { argv, published, ports } = fakeGit({ 'C:/work/repo': REPO }, { [REPO]: ran(['## main', ...paths.map(path => `?? ${path}`), ''].join('\0')) }, new Set(), {
      grep: args => ran(args.filter(arg => arg.startsWith(':(literal)')).map(arg => `${arg.slice(':(literal)'.length)}\u00001`).join('\n')),
    })
    const changes = new LiveChanges(ports)
    await changes.addFolder('C:/work/repo')
    await changes.refresh()
    const named = argv.find(args => args.includes('grep'))?.filter(arg => arg.startsWith(':(literal)')) ?? []
    expect(named.join(' ').length).toBeLessThanOrEqual(PATHSPEC_BUDGET)
    expect(named.length).toBe(Math.floor(PATHSPEC_BUDGET / (':(literal)'.length + 101 + 1)))
    const lines = published[0]?.repos[0]?.files.items.map(file => file.lines) ?? []
    expect(lines.slice(0, named.length).every(line => line?.kind === 'text' && line.added === 1)).toBe(true)
    expect(lines.slice(named.length).every(line => line === null)).toBe(true)
    expect(argv.filter(args => args.includes('grep'))).toHaveLength(1)
  })

  test('a folder git cannot be asked about adds no repo', async () => {
    const { published, ports } = fakeGit({}, {})
    const changes = new LiveChanges({ ...ports, git: async () => Promise.reject(new Error('spawn git ENOENT')) })
    await changes.addFolder('C:/work/repo')
    await changes.refresh()
    expect(published).toEqual([{ repos: [], outside: [], isRead: true }])
  })
})

describe('changes rows', () => {
  const textOf = (blocks: readonly Block[], key: string) =>
    blocks
      .flatMap(block => [...block.rows, ...(block.card ?? [])])
      .find(row => row.key === key)
      ?.spans.map(span => span.text)
      .join('')
  const repo = (over: Partial<RepoChanges>): RepoChanges => ({ root: REPO, branch: 'main', files: { items: [], more: 0 }, isPartial: false, isUnborn: false, problem: null, ...over })

  test('says git is being read, then, in plain text, why no repo is listed yet', () => {
    expect(changesBlocks(EMPTY_CHANGES).map(block => block.key)).toEqual(['reading'])
    const empty = changesBlocks({ repos: [], outside: [], isRead: true }).flatMap(block => block.rows)
    expect(empty.map(row => row.spans)).toEqual([[{ text: 'No git repo yet: the session folder is in none, and no file the session or its agents edited (Edit, Write) is in one.' }]])
  })

  test('with no git to start, an empty view stays empty, as the WARN line above it says why; a repo found earlier is still drawn', () => {
    expect(changesBlocks(EMPTY_CHANGES, true)).toEqual([])
    expect(changesBlocks({ repos: [], outside: [], isRead: true }, true)).toEqual([])
    const found: ChangesSnapshot = { repos: [repo({})], outside: ['C:/n.md'], isRead: true }
    expect(changesBlocks(found, true)).toEqual(changesBlocks(found))
  })

  test("counts on the button and the title only once something changed", () => {
    const changed: ChangesSnapshot = { repos: [repo({ files: { items: [change(' M', 'a.ts')], more: 4 } })], outside: ['C:/n.md'], isRead: true }
    expect([changesLabel(changed), paneTitle(changed)]).toEqual(['Changes 6', 'Tasks · 6 changed'])
    expect([changesLabel(EMPTY_CHANGES), paneTitle(EMPTY_CHANGES)]).toEqual(['Changes', 'Tasks'])
  })

  test("a file's lines: added in green, removed in red, binary or unchanged lines dim, nothing while uncounted", () => {
    expect(lineSpans(text(12, 3))).toEqual([
      { text: ' +12', color: 'success' },
      { text: ' -3', color: 'error' },
    ])
    expect(lineSpans(text(4, 0))).toEqual([{ text: ' +4', color: 'success' }])
    expect(lineSpans(text(0, 7))).toEqual([{ text: ' -7', color: 'error' }])
    expect(lineSpans(text(0, 0))).toEqual([{ text: ' +0 -0', dim: true }])
    expect(lineSpans({ kind: 'binary' })).toEqual([{ text: ' binary', dim: true }])
    expect(lineSpans(null)).toEqual([])
  })

  test('a worktree whose folder bears its branch name names it once', () => {
    const root = 'C:/work/t300-guide'
    const blocks = changesBlocks({ repos: [repo({ root, branch: 't300-guide', files: { items: [change(' M', 'a.ts')], more: 0 } })], outside: [], isRead: true })
    expect(textOf(blocks, `repo:${root}`)).toBe('t300-guide · 1 file')
    const other = changesBlocks({ repos: [repo({ root, branch: 'main' })], outside: [], isRead: true })
    expect(textOf(other, `repo:${root}`)).toBe('t300-guide · branch main · clean')
  })

  test("git's two-letter code in words: where the change is, staged green and in the work tree yellow, a new file dim, a conflict red", () => {
    expect(changeWords(' M')).toEqual({ word: { text: 'changed', color: 'warning' }, after: null })
    expect(changeWords(' D')).toEqual({ word: { text: 'deleted', color: 'warning' }, after: null })
    expect(changeWords(' T')).toEqual({ word: { text: 'changed', color: 'warning' }, after: null })
    expect(changeWords('A ')).toEqual({ word: { text: 'added', color: 'success' }, after: 'staged' })
    expect(changeWords('R ')).toEqual({ word: { text: 'renamed', color: 'success' }, after: 'staged' })
    expect(changeWords('C ')).toEqual({ word: { text: 'copied', color: 'success' }, after: 'staged' })
    expect(changeWords('MM')).toEqual({ word: { text: 'changed', color: 'success' }, after: 'staged, changed since' })
    expect(changeWords('AD')).toEqual({ word: { text: 'added', color: 'success' }, after: 'staged, deleted since' })
    expect(changeWords('??')).toEqual({ word: { text: 'new', dim: true }, after: 'not in git yet' })
    for (const code of ['UU', 'AU', 'UD', 'DU', 'UA', 'AA', 'DD']) expect(changeWords(code)).toEqual({ word: { text: 'conflict', color: 'error' }, after: null })
  })

  test('a header counts one file as one, and names a detached repo as on no branch', () => {
    const one = changesBlocks({ repos: [repo({ files: { items: [change(' M', 'a.ts')], more: 0 } })], outside: [], isRead: true })
    expect(textOf(one, `repo:${REPO}`)).toBe('repo · branch main · 1 file')
    const detached = changesBlocks({ repos: [repo({ branch: null })], outside: [], isRead: true })
    expect(textOf(detached, `repo:${REPO}`)).toBe('repo · no branch · clean')
  })

  test('what changed fills one column, so the paths line up, and a wrapped path goes on under the path', () => {
    const files = [change(' M', 'a.ts'), change('UU', 'b.ts'), change('??', 'c.md')]
    const card = changesBlocks({ repos: [repo({ files: { items: files, more: 0 } })], outside: [], isRead: true })[0]?.card ?? []
    const rows = card.filter(row => row.key !== `${REPO}:hint`)
    expect(rows.map(row => row.spans[0]?.text)).toEqual(['changed  ', 'conflict ', 'new      '])
    expect(rows.map(row => row.hang)).toEqual([{ text: '         ' }, { text: '         ' }, { text: '         ' }])
  })

  test("each repo under a ruled header: a detached one, one git can't read, one cut short; then the files outside git", () => {
    const blocks = changesBlocks({
      repos: [
        repo({ branch: null, files: { items: [change('R ', 'new.ts', 'old.ts', text(3, 1)), change('??', 't/')], more: 2 }, isPartial: true }),
        repo({ root: 'C:/work/gone', problem: 'fatal: bad object HEAD' }),
        repo({ root: 'C:/work/clean' }),
      ],
      outside: ['C:/notes/a.md'],
      isRead: true,
    })
    expect(blocks.map(block => [block.key, block.opensSection === true])).toEqual([
      [`repo:${REPO}`, false],
      ['repo:C:/work/gone', true],
      ['problem:C:/work/gone', false],
      ['repo:C:/work/clean', true],
      ['outside', true],
      ['outside-files', false],
    ])
    expect(textOf(blocks, `repo:${REPO}`)).toBe('repo · no branch · 4 files')
    expect(textOf(blocks, `${REPO}:new.ts`)).toBe('renamed  new.ts +3 -1 ← old.ts (staged)')
    expect(textOf(blocks, `${REPO}:t/`)).toBe('new      t/ (not in git yet)')
    expect(textOf(blocks, `${REPO}:more`)).toBe('… 2 more')
    expect(textOf(blocks, `${REPO}:partial`)).toMatch(/4 MiB/)
    expect(textOf(blocks, 'repo:C:/work/gone')).toBe('gone')
    expect(textOf(blocks, 'problem:C:/work/gone')).toBe('WARN fatal: bad object HEAD')
    expect(textOf(blocks, 'repo:C:/work/clean')).toBe('clean · branch main · clean')
    expect(textOf(blocks, 'outside')).toBe('── written outside git (1)')
    // The files are the header's card, so no blank line parts them from it, led by the hint as the first repo with a diff to open.
    expect(blocks[0]?.card?.map(row => row.key)).toEqual([`${REPO}:hint`, `${REPO}:new.ts`, `${REPO}:t/`, `${REPO}:more`, `${REPO}:partial`])
    expect(blocks[0]?.card?.[0]?.spans).toEqual([{ text: DIFF_HINT, dim: true }])
  })

  test('the hint leads only the first repo with a diff to open: not one with an untracked folder alone, nor a later one', () => {
    const folderOnly = repo({ root: 'C:/work/folder', files: { items: [change('??', 't/')], more: 0 } })
    const first = repo({ root: 'C:/work/first', files: { items: [change(' M', 'a.ts')], more: 0 } })
    const second = repo({ root: 'C:/work/second', files: { items: [change(' M', 'b.ts')], more: 0 } })
    const blocks = changesBlocks({ repos: [folderOnly, first, second], outside: [], isRead: true })
    const hinted = blocks.filter(block => block.card?.some(row => row.key.endsWith(':hint')) === true).map(block => block.key)
    expect(hinted).toEqual(['repo:C:/work/first'])
    expect(changesBlocks({ repos: [folderOnly], outside: [], isRead: true }).flatMap(block => block.card ?? []).map(row => row.key)).toEqual(['C:/work/folder:t/'])
  })

  test("a file's row opens its diff, an untracked folder's none; an open diff's lines sit under its row in the card", () => {
    const key = `${REPO}:a.ts`
    const files = [change(' M', 'a.ts', null, text(1, 1)), change('??', 't/'), change('??', 'b.md')]
    const changes: ChangesSnapshot = { repos: [repo({ files: { items: files, more: 0 } })], outside: [], isRead: true }
    const lines: DiffLine[] = [
      { kind: 'hunk', text: '@@ -1 +1 @@' },
      { kind: 'del', text: 'old' },
      { kind: 'add', text: 'new' },
      { kind: 'same', text: 'kept' },
    ]
    const diffs: OpenDiffs = { [key]: { kind: 'read', lines, more: 3, isCut: false } }
    const blocks = changesBlocks(changes, false, diffs)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.card?.map(row => [row.key, row.expands ?? null])).toEqual([
      [`${REPO}:hint`, null],
      [key, key],
      [`diff:${key}:0`, null],
      [`diff:${key}:1`, null],
      [`diff:${key}:2`, null],
      [`diff:${key}:3`, null],
      [`diff:${key}:more`, null],
      [`${REPO}:t/`, null],
      [`${REPO}:b.md`, `${REPO}:b.md`],
    ])
    // An open diff's lines sit indented less than the path, so a narrow dock keeps room for them.
    expect(blocks[0]?.card?.slice(2, 7).map(row => row.spans)).toEqual([
      [{ text: '   ' }, { text: '@@ -1 +1 @@', dim: true }],
      [{ text: '   ' }, { text: '-old', color: 'error' }],
      [{ text: '   ' }, { text: '+new', color: 'success' }],
      [{ text: '   ' }, { text: ' kept' }],
      [{ text: '   ' }, { text: '… 3 more lines', dim: true }],
    ])
    // A diff line wraps under its text, past its marker, and stops at DIFF_LINE_ROWS screen lines.
    expect(blocks[0]?.card?.[3]).toMatchObject({ hang: { text: '    ' }, maxLines: DIFF_LINE_ROWS })
    // Closed, the file's row stands alone.
    expect(changesBlocks(changes).at(0)?.card?.map(row => row.key)).toEqual([`${REPO}:hint`, key, `${REPO}:t/`, `${REPO}:b.md`])
  })

  test('an open diff while git reads it, when git fails, with no line changed, and cut short', () => {
    const key = `${REPO}:a.ts`
    const words = (diff: FileDiff) => diffRows(key, diff).map(row => row.spans.map(span => span.text).join(''))
    expect(words({ kind: 'reading' })).toEqual(['   Reading the diff…'])
    expect(words({ kind: 'failed', problem: 'fatal: bad revision HEAD' })).toEqual(['   WARN git could not read the diff: fatal: bad revision HEAD'])
    expect(words({ kind: 'read', lines: [], more: 0, isCut: false })).toEqual(['   No line changed: a mode change, a rename or an empty file.'])
    expect(words({ kind: 'read', lines: [{ kind: 'add', text: 'a' }], more: 0, isCut: true })).toEqual([
      '   +a',
      "   … some more lines: git's diff ran past 4 MiB and stops short",
    ])
    expect(words({ kind: 'read', lines: [], more: 2, isCut: true })).toEqual(["   … 2+ more lines: git's diff ran past 4 MiB and stops short"])
  })

  test('while the Find field holds a query, the view draws the search: the hint, nothing found, or the count and the files it names over their repo and branch', () => {
    const files = [change(' M', 'hooks/a.ts', null, text(4, 1)), change('R ', 'hooks/new.ts', 'hooks/old.ts'), change('??', 'tests/')]
    const changes: ChangesSnapshot = { repos: [repo({ branch: 'pane-v2', files: { items: files, more: 0 } })], outside: ['C:/n.md'], isRead: true }
    const searchedIn = (shown: ChangesSnapshot, query: string, diffs: OpenDiffs = {}) => changesBlocks(shown, false, diffs, { query, hits: searchChanges(shown, query) })
    const searched = (query: string, diffs: OpenDiffs = {}) => searchedIn(changes, query, diffs)
    const words = (blocks: Block[]) => blocks.map(block => [block.key, block.rows.map(row => row.spans.map(span => span.text).join(''))])
    const underlined = (block: Block | undefined) => block?.rows.flatMap(row => row.spans.filter(span => span.underline === true))
    expect(words(searched(' '))).toEqual([['changes-search-hint', [CHANGES_SEARCH_HINT]]])
    expect(words(searched('nothing'))).toEqual([['changes-search-none', [CHANGES_NOTHING_FOUND]]])
    // Before git is read there is nothing to search yet.
    expect(changesBlocks(EMPTY_CHANGES, false, {}, { query: 'hooks', hits: [] }).map(block => block.key)).toEqual(['reading'])

    const hooks = searched('hooks')
    expect(words(hooks)).toEqual([
      ['changes-search-count', ['2 files match']],
      [`changes-search:${REPO}:hooks/a.ts`, ['changed  hooks/a.ts +4 -1', '         repo · branch pane-v2']],
      [`changes-search:${REPO}:hooks/new.ts`, ['renamed  hooks/new.ts ← hooks/old.ts (staged)', '         repo · branch pane-v2']],
    ])
    // A result opens its file's diff, keyed as the list's row opens it, the words that matched underlined.
    expect(hooks[1]?.expands).toBe(`${REPO}:hooks/a.ts`)
    expect(underlined(hooks[1])).toEqual([{ text: 'hooks', underline: true }])
    // The path a file was renamed from, and the branch, keep their dim style.
    expect(underlined(searched('old')[1])).toEqual([{ text: 'old', dim: true, underline: true }])
    expect(underlined(searched('v2')[1])).toEqual([{ text: 'v2', dim: true, underline: true }])

    // An untracked folder has no diff to open; a file outside git says where it is; a detached repo says so.
    const tests = searched('tests')
    expect(words(tests).slice(1)).toEqual([[`changes-search:${REPO}:tests/`, ['new      tests/ (not in git yet)', '         repo · branch pane-v2']]])
    expect(tests[1]?.expands).toBeUndefined()
    expect(words(searched('n.md')).slice(1)).toEqual([['changes-search:outside:C:/n.md', ['C:/n.md', '   written outside git']]])
    const detached: ChangesSnapshot = { ...changes, repos: [repo({ branch: null, files: { items: files, more: 0 } })] }
    expect(words(searchedIn(detached, 'tests')).at(1)).toEqual([`changes-search:${REPO}:tests/`, ['new      tests/ (not in git yet)', '         repo · no branch']])

    // An open diff draws under its result, as its card.
    const opened: OpenDiffs = { [`${REPO}:hooks/a.ts`]: { kind: 'read', lines: [{ kind: 'del', text: 'old' }], more: 0, isCut: false } }
    expect(searched('a.ts', opened)[1]?.card?.map(row => row.spans.map(span => span.text).join(''))).toEqual(['   -old'])
    expect(searched('hooks', opened)[2]?.card).toBeUndefined()
  })
})
