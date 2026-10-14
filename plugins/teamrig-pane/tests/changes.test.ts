// The Changes view: its data (hooks/changes.ts), git's status read per repo and repos found from the files the session
// writes, and its rows (hooks/changes-rows.ts).
import { describe, expect, test } from 'claude-code/testing'
import type { ChangesSnapshot, RepoChanges } from '../types'
import { branchOf, changeCount, CHANGES_KEPT, EMPTY_CHANGES, folderOf, LiveChanges, OUTSIDE_KEPT, parseStatus, type ChangesPorts, type GitRun } from '../hooks/changes'
import { changesBlocks, changesLabel, paneTitle } from '../hooks/changes-rows'
import type { Block } from '../hooks/rows'

const REPO = 'C:/work/repo'
const STATUS_OUT = ['## pane-v2...origin/pane-v2 [ahead 2]', ' M hooks/a.ts', 'R  hooks/new.ts', 'hooks/old.ts', '?? tests/', ''].join('\0')

/** What a git run answers. */
function ran(stdout: string, exitCode = 0, stderr = ''): GitRun {
  return { exitCode, stdout, stderr, isStdoutTruncated: false }
}

/** A git over fixed answers: each folder's root (absent: not a repo), each root's status output, or a run that rejects. */
function fakeGit(roots: Record<string, string>, statuses: Record<string, GitRun | Error>) {
  const calls: string[] = []
  const published: ChangesSnapshot[] = []
  const ports: ChangesPorts = {
    git: async (args, cwd) => {
      calls.push(`${args[0] === 'rev-parse' ? 'rev-parse' : 'status'} ${cwd}`)
      if (args[0] === 'rev-parse') {
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
  return { calls, published, ports }
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

  test('reads the branch and each file, a rename with where it came from', () => {
    expect(parseStatus(STATUS_OUT)).toEqual({
      branch: 'pane-v2',
      files: [
        { code: ' M', path: 'hooks/a.ts', from: null },
        { code: 'R ', path: 'hooks/new.ts', from: 'hooks/old.ts' },
        { code: '??', path: 'tests/', from: null },
      ],
    })
    expect(parseStatus(['## main', 'A  a file with spaces.ts', ''].join('\0')).files).toEqual([{ code: 'A ', path: 'a file with spaces.ts', from: null }])
    expect(parseStatus('')).toEqual({ branch: null, files: [] })
  })

  test("a write in a repo adds it: its status read on the next poll, a folder's root asked once, an unchanged status not written again", async () => {
    const { calls, published, ports } = fakeGit({ 'C:/work/repo/hooks': REPO }, { [REPO]: ran(STATUS_OUT) })
    const changes = new LiveChanges(ports)
    await changes.noteWrite('C:/work/repo/hooks/a.ts')
    await changes.noteWrite('C:/work/repo/hooks/b.ts')
    await changes.refresh(false)

    expect(calls).toEqual(['rev-parse C:/work/repo/hooks', `status ${REPO}`])
    expect(published).toHaveLength(1)
    const [repo] = published[0]?.repos ?? []
    expect(repo?.branch).toBe('pane-v2')
    expect(repo?.files.items.map(file => file.path)).toEqual(['hooks/a.ts', 'hooks/new.ts', 'tests/'])
    expect(published[0] === undefined ? 0 : changeCount(published[0])).toBe(3)

    await changes.refresh(false)
    expect(calls).toHaveLength(2)
    await changes.refresh()
    expect(calls).toHaveLength(3)
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
      { 'C:/work/repo': REPO, 'C:/work/gone': 'C:/work/gone' },
      { [REPO]: ran('', 128, '\nfatal: bad object HEAD\nmore\n'), 'C:/work/gone': new Error('spawn git ENOENT') },
    )
    const changes = new LiveChanges(ports)
    await changes.addFolder('C:/work/repo')
    await changes.addFolder('C:/work/gone')
    await changes.refresh()
    expect(published[0]?.repos.map(repo => repo.problem)).toEqual(['fatal: bad object HEAD', 'spawn git ENOENT'])

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
    const changed: ChangesSnapshot = { repos: [repo({ files: { items: [{ code: ' M', path: 'a.ts', from: null }], more: 4 } })], outside: ['C:/n.md'], isRead: true }
    expect([changesLabel(changed), paneTitle(changed)]).toEqual(['Changes Δ6', 'Tasks · Δ6'])
    expect([changesLabel(EMPTY_CHANGES), paneTitle(EMPTY_CHANGES)]).toEqual(['Changes', 'Tasks'])
  })

  test("each repo under a ruled header: a detached one, one git can't read, one cut short; then the files outside git", () => {
    const blocks = changesBlocks({
      repos: [
        repo({ branch: null, files: { items: [{ code: 'R ', path: 'new.ts', from: 'old.ts' }, { code: '??', path: 't/', from: null }], more: 2 }, isPartial: true }),
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
    expect(textOf(blocks, `${REPO}:new.ts`)).toBe('R  new.ts ← old.ts')
    expect(textOf(blocks, `${REPO}:more`)).toBe('… 2 more')
    expect(textOf(blocks, `${REPO}:partial`)).toMatch(/4 MiB/)
    expect(textOf(blocks, 'problem:C:/work/gone')).toBe('⚠ fatal: bad object HEAD')
    expect(textOf(blocks, 'repo:C:/work/clean')).toBe('clean · main · clean')
    expect(textOf(blocks, 'outside')).toBe('── written outside git (1)')
  })
})
