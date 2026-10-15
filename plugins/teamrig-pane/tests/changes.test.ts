// The Changes view: its data (hooks/changes.ts), git's status read per repo and repos found from the files the session
// writes, and its rows (hooks/changes-rows.ts).
import { describe, expect, test } from 'claude-code/testing'
import type { ChangesSnapshot, FileChange, LineCount, RepoChanges } from '../types'
import {
  branchOf,
  changeCount,
  CHANGES_KEPT,
  EMPTY_CHANGES,
  folderOf,
  LiveChanges,
  OUTSIDE_KEPT,
  parseGrepCounts,
  parseNumstat,
  parseStatus,
  PATHSPEC_BUDGET,
  type ChangesPorts,
  type GitRun,
} from '../hooks/changes'
import { changesBlocks, changesLabel, lineSpans, paneTitle } from '../hooks/changes-rows'
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
 * each path asked about.
 */
function fakeGit(roots: Record<string, string>, statuses: Record<string, GitRun | Error>, gone = new Set<string>(), lines: LineAnswers = {}) {
  const calls: string[] = []
  const argv: (readonly string[])[] = []
  const checked: string[] = []
  const published: ChangesSnapshot[] = []
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
  }
  return { argv, calls, checked, published, ports }
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

  test('after a hot reload the repos and files the pane drew stay known', async () => {
    const { calls, published, ports } = fakeGit({}, {})
    const seed: ChangesSnapshot = {
      repos: [{ root: REPO, branch: 'main', files: { items: [], more: 0 }, isPartial: false, problem: null }],
      outside: ['C:/notes/a.md'],
      isRead: true,
    }
    await new LiveChanges(ports, seed).refresh()
    expect(calls).toEqual([`status ${REPO}`])
    expect(published[0]?.outside).toEqual(['C:/notes/a.md'])
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
    const seed: ChangesSnapshot = {
      repos: [{ root: REPO, branch: 'main', files: { items: [], more: 0 }, isPartial: false, problem: null }],
      outside: [],
      isRead: true,
    }
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
    const seed: ChangesSnapshot = {
      repos: [{ root: REPO, branch: 'main', files: { items: [], more: 0 }, isPartial: false, problem: null }],
      outside: [],
      isRead: true,
    }
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
    const seed: ChangesSnapshot = { repos: [{ root: REPO, branch: 'main', files: { items: [], more: 0 }, isPartial: false, problem: null }], outside: [], isRead: true }
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
      .flatMap(block => block.rows)
      .find(row => row.key === key)
      ?.spans.map(span => span.text)
      .join('')
  const repo = (over: Partial<RepoChanges>): RepoChanges => ({ root: REPO, branch: 'main', files: { items: [], more: 0 }, isPartial: false, problem: null, ...over })

  test('says git is being read, then that no repo is known, before any repo is', () => {
    expect(changesBlocks(EMPTY_CHANGES).map(block => block.key)).toEqual(['reading'])
    expect(textOf(changesBlocks({ repos: [], outside: [], isRead: true }), 'no-repo')).toMatch(/^No git repo yet/)
  })

  test("counts on the button and the title only once something changed", () => {
    const changed: ChangesSnapshot = { repos: [repo({ files: { items: [change(' M', 'a.ts')], more: 4 } })], outside: ['C:/n.md'], isRead: true }
    expect([changesLabel(changed), paneTitle(changed)]).toEqual(['Changes Δ6', 'Tasks · Δ6'])
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
      [`files:${REPO}`, false],
      ['repo:C:/work/gone', true],
      ['problem:C:/work/gone', false],
      ['repo:C:/work/clean', true],
      ['outside', true],
      ['outside-files', false],
    ])
    expect(textOf(blocks, `repo:${REPO}`)).toBe('repo · detached · 4 changed')
    expect(textOf(blocks, `${REPO}:new.ts`)).toBe('R  new.ts +3 -1 ← old.ts')
    expect(textOf(blocks, `${REPO}:t/`)).toBe('?? t/')
    expect(textOf(blocks, `${REPO}:more`)).toBe('… 2 more')
    expect(textOf(blocks, `${REPO}:partial`)).toMatch(/4 MiB/)
    expect(textOf(blocks, 'problem:C:/work/gone')).toBe('WARN fatal: bad object HEAD')
    expect(textOf(blocks, 'repo:C:/work/clean')).toBe('clean · main · clean')
    expect(textOf(blocks, 'outside')).toBe('── written outside git (1)')
  })
})
