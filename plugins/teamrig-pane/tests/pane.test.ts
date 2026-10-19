// The plugin through the engine: env, clock, store, session id and fs answered beneath it.
import type { AbovePromptProps, Answer, FsEntry, FsStat, On, SessionVersion, UiFocusInput } from 'claude-code'
import { expect, mock, test, type Mounted, type TestEngine } from 'claude-code/testing'
import { BANNER_KEY, NOTHING_CURRENT } from '../hooks/banner'
import { LABEL_CELLS } from '../hooks/card'
import { cells } from '../hooks/width'
import { HOUR, NOW, S1, bigRegister, createLine, iso, markLine, statusLine, updateLine, verifyingLine } from './fixtures'

const HOME = '\\Homes\\tester'
const EVENTS = '/Homes/tester/team-notes/tasks/events.jsonl'
const MARKS = '/Homes/tester/team-notes/tasks/inbox-marks.jsonl'
const INBOX = '/Homes/tester/team-notes/board/inbox/po.md'

/**
 * The engine resolves each $.fs path the host’s way before a hook sees it: Windows puts the drive on
 * a rooted path and turns its slashes back (`/work/a` arrives as `D:\work\a`), POSIX keeps `/work/a`.
 * A drive-letter path is absolute on Windows alone, so the test paths are rooted without one, absolute
 * on every OS the CI runs, and the fake keys each in one form: forward slashes, no drive.
 */
const keyOf = (path: string) => path.replaceAll('\\', '/').replace(/^[A-Za-z]:/, '')

/**
 * A file the fake disk refuses: its stat or its read rejects with `message`; `isSeen` false makes
 * `exists` answer false too, as Windows answers for a file it denies (one pending delete, an ACL).
 */
type Lock = { op: 'stat' | 'read'; message: string; isSeen: boolean }

/** Answers $.fs beneath the plugin from a map; `write` moves the file's mtime as a real append would, `reads` lists each read. */
function fakeDisk(on: On) {
  const files = new Map<string, { text: string; mtimeMs: number }>()
  const locks = new Map<string, Lock>()
  const reads: string[] = []
  let tick = 1
  on('fs.stat', async ($, e) => {
    const lock = locks.get(keyOf(e.path))
    if (lock?.op === 'stat') return { deny: lock.message }
    const file = files.get(keyOf(e.path))
    if (!file) return { deny: `ENOENT: ${e.path}` }
    const stat: FsStat = { kind: 'file', size: file.text.length, mtimeMs: file.mtimeMs, isLink: false }
    return { value: stat }
  })
  /** The files right under a folder; a folder exists while a file is in it. */
  const inFolder = (dir: string): FsEntry[] => {
    const prefix = `${keyOf(dir)}/`
    return [...files].flatMap(([path, file]) => {
      const name = path.slice(prefix.length)
      if (!path.startsWith(prefix) || name.includes('/')) return []
      return [{ name, kind: 'file' as const, size: file.text.length, mtimeMs: file.mtimeMs, isLink: false }]
    })
  }
  on('fs.exists', async ($, e) => {
    if (locks.get(keyOf(e.path))?.isSeen === false) return { value: false }
    return { value: files.has(keyOf(e.path)) || inFolder(e.path).length > 0 }
  })
  on('fs.read', async ($, e) => {
    reads.push(keyOf(e.path))
    const lock = locks.get(keyOf(e.path))
    if (lock?.op === 'read') return { deny: lock.message }
    const file = files.get(keyOf(e.path))
    return file ? { value: file.text } : { deny: `ENOENT: ${e.path}` }
  })
  return {
    reads,
    write: (path: string, lines: string[]) => void files.set(keyOf(path), { text: lines.join('\n'), mtimeMs: tick++ }),
    lock: (path: string, lock: Lock) => void locks.set(keyOf(path), lock),
    unlock: (path: string) => void locks.delete(keyOf(path)),
    remove: (path: string) => void files.delete(keyOf(path)),
  }
}

const PANE_PROPS = {
  title: 'Tasks',
  isFocused: false,
  bodyColumns: 50,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const

/** A dock wide enough that a requirement's WARN line is one drawn line, so a test can match all of it. */
const WIDE = { ...PANE_PROPS, bodyColumns: 200 } as const

/** An open card: its Status row first, its Who row further down. */
const CARD = /^ {4}│ (Description|Status) [\s\S]*│ Added /
/** Where a card value's further lines start: the guide, then blank up to the value column. */
const CARD_UNDER = `    │ ${' '.repeat(LABEL_CELLS)}`
/** A card row's first line in the list: the guide, the label padded to the value column, the value. */
const cardLine = (label: string, value: string) => `    │ ${label.padEnd(LABEL_CELLS)}${value}`

/** Answers $.store beneath the plugin from a map the test reads: `kept` starts as what earlier sessions left. */
function fakeStore(on: On, kept: Readonly<Record<string, unknown>>) {
  const store = new Map(Object.entries(kept))
  on('store.get', async ($, e) => ({ value: store.get(e.key) }))
  on('store.set', async ($, e) => ({ value: void store.set(e.key, e.value) }))
  on('store.delete', async ($, e) => ({ value: void store.delete(e.key) }))
  on('store.keys', async () => ({ value: [...store.keys()] }))
  return store
}

/**
 * The repos a fake git knows: each folder's root, each root's `status --porcelain=v1 -b -z` output, the
 * line counts' outputs (`diff --numstat -z`, `grep -c -z`; none by default), and each file's diff by its path
 * (none by default). Tests change it as they go.
 */
type FakeRepos = {
  roots: Record<string, string>
  statuses: Record<string, string>
  numstats?: Record<string, string>
  greps?: Record<string, string>
  patches?: Record<string, string>
  /** No git to start: every run rejects as a spawn of a missing program does. */
  isMissing?: boolean
}

/**
 * Answers $.process.run as git over `repos`, a folder it does not know being outside any repo; `runs` lists each as
 * `<command> <cwd>`, `git --version` as `--version `.
 */
function fakeGit(on: On, repos: FakeRepos) {
  const runs: string[] = []
  const answer = (stdout: string, exitCode = 0, stderr = '') => ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })
  on('process.run', async ($, e) => {
    const cwd = e.init?.cwd ?? ''
    const command = e.argv.slice(1).find(arg => !arg.startsWith('-')) ?? e.argv[1] ?? ''
    runs.push(`${command} ${cwd}`)
    if (repos.isMissing === true) return { deny: 'spawn git ENOENT' }
    if (command === '--version') return answer('git version 2.47.1')
    const root = repos.roots[cwd]
    if (command === 'rev-parse') return root === undefined ? answer('', 128, 'fatal: not a git repository') : answer(`${root}
`)
    if (command === 'diff' && e.argv.includes('--numstat')) return answer(repos.numstats?.[cwd] ?? '')
    // A file's diff, named last; `--no-index` exits 1 on finding a difference.
    if (command === 'diff') return answer(repos.patches?.[(e.argv.at(-1) ?? '').replace(':(literal)', '')] ?? '', e.argv.includes('--no-index') ? 1 : 0)
    if (command === 'grep') return repos.greps?.[cwd] === undefined ? answer('', 1) : answer(repos.greps[cwd])
    return answer(repos.statuses[cwd] ?? '## main\0')
  })
  return runs
}

/** The Claude Code the tests run the pane on: new enough for it. */
const NEW_ENOUGH: Answer<SessionVersion> = { value: { version: '2.1.300', base: '2.1.300', builtAt: '2026-10-01T10:00:00Z' } }

/** The environment that names the register's folders (backslashed, as a Windows host passes them) and its goals document. */
const REGISTER_ENV: Readonly<Record<string, string>> = {
  USERPROFILE: HOME,
  TEAMRIG_PANE_TASKS_DIR: `${HOME}\\team-notes\\tasks`,
  TEAMRIG_PANE_INBOX_DIR: `${HOME}\\team-notes\\board\\inbox`,
  TEAMRIG_PANE_GOALS_DOC: 'docs/ROADMAP.md',
}

/**
 * Starts the plugin over a fake disk, store and git; `kept` is what $.store holds from earlier
 * sessions, `env` the environment the plugin reads, `version` what `$.session.version()` answers. Each repo the git knows is on the disk: its
 * root's `.git`, and a file in each folder named in it (git never runs in a folder that is not there).
 */
async function start(
  on: On,
  kept: Readonly<Record<string, unknown>> = {},
  repos: FakeRepos = { roots: {}, statuses: {} },
  env: Readonly<Record<string, string>> = REGISTER_ENV,
  version: Answer<SessionVersion> = NEW_ENOUGH,
) {
  mock.env(on, env)
  const store = fakeStore(on, kept)
  const runs = fakeGit(on, repos)
  const clock = mock.clock(on, { now: NOW })
  on('session.id', async () => ({ value: S1 }))
  on('session.version', async () => version)
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  const registered: string[] = []
  on('command.register', async ($, e) => {
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  const opened: string[] = []
  const titles: string[] = []
  on('ui.open', async ($, e) => {
    opened.push(e.id)
    titles.push(e.title ?? '')
    return { value: { isPlaced: true } }
  })
  const disk = fakeDisk(on)
  disk.write(EVENTS, [
    createLine('T1', { owner: 'po', by: 'lead', at: NOW - HOUR, priority: 2, due: '2026-10-14', title: 'Ship the task pane' }),
    createLine('T2', { owner: 'security', by: 'lead', at: NOW - HOUR, priority: 1, title: 'Rotate the local URI' }),
    statusLine('T2', 'security', NOW, 'waiting', 'needs owner paste'),
  ])
  disk.write(MARKS, [markLine('po', 1, S1, NOW, 'line one')])
  disk.write(INBOX, ['line one', 'line two', 'line three'])
  for (const [folder, root] of Object.entries(repos.roots)) {
    disk.write(`${root}/.git`, ['gitdir'])
    disk.write(`${folder}/.keep`, [''])
  }
  return { clock, disk, opened, registered, store, runs, titles }
}

test('docks the session area: its tasks, flags and unread inbox', async ($, on) => {
  const { opened } = await start(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  expect(opened).toEqual(['teamrig-pane'])
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })

  expect(await pane.find({ text: /inbox 2 unread/ })).toBeDefined()
  expect(await pane.find({ text: /Ship the task pane/ })).toBeDefined()
  expect(await pane.find({ text: /p2 · due Wed 10-14 · new · asked by owner/ })).toBeDefined()
  expect(await pane.find({ text: /Rotate the local URI/ })).toBeUndefined()
})

test('the all view lists every owner, a waiting task saying why', async ($, on) => {
  await start(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: WIDE })

  await pane.press({ key: 'all' })
  expect(await pane.find({ text: /Rotate the local URI/ })).toBeDefined()
  expect(await pane.find({ text: /p1 · waiting since 14:00: needs owner paste/ })).toBeDefined()
})

test("the area's Tasks view leads with a bar of its tasks by status and their counts; the all and Changes views draw none", async ($, on) => {
  const { disk } = await start(on)
  disk.write(EVENTS, [
    createLine('T1', { owner: 'po', by: 'lead', at: NOW - HOUR, title: 'Ship the task pane' }),
    createLine('T2', { owner: 'po', by: 'po', at: NOW - HOUR, title: 'Check the roll' }),
    statusLine('T2', 'po', NOW, 'verifying', 'health check passes'),
    createLine('T3', { owner: 'po', by: 'po', at: NOW - 72 * HOUR, title: 'Closed before today' }),
    statusLine('T3', 'po', NOW - 48 * HOUR, 'done'),
    createLine('T4', { owner: 'po', by: 'po', at: NOW - HOUR, title: 'Closed today' }),
    statusLine('T4', 'po', NOW, 'done'),
    createLine('T5', { owner: 'security', by: 'po', at: NOW - HOUR, title: 'Rotate the local URI' }),
  ])
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })

  const segments = await pane.findAll({ type: 'Text', text: /^[█▓░]+$/ })
  expect(segments.map(found => found.text)).toEqual(['█'.repeat(16), '▓'.repeat(16), '░'.repeat(16)])
  expect(segments.map(found => found.props['color'])).toEqual(['success', 'success', undefined])
  for (const count of ['1 done today', '1 verifying', '1 not started'])
    expect(await pane.find({ type: 'Text', text: count })).toBeDefined()
  expect(await pane.find({ text: /working|waiting/ })).toBeUndefined()
  // The bar sits between the switch and the tasks.
  const drawn = await pane.drawn()
  const rootKeys = childrenOf(drawn).map(child => propsOf(child)).map(props => (props !== null && 'key' in props ? props.key : null))
  expect(rootKeys.indexOf('status-bar')).toBe(1)

  await pane.press({ key: 'all' })
  expect(keyedNode(await pane.drawn(), 'status-bar')).toBe(null)
  await pane.press({ key: 'mine' })
  await pane.press({ key: 'changes' })
  expect(keyedNode(await pane.drawn(), 'status-bar')).toBe(null)
})

test("a press on a status's count or segment filters the list to it, again clears it, on another switches; each count has its key", async ($, on) => {
  const { disk } = await start(on)
  disk.write(EVENTS, [
    createLine('T1', { owner: 'po', by: 'lead', at: NOW - HOUR, title: 'Ship the task pane' }),
    createLine('T2', { owner: 'po', by: 'po', at: NOW - HOUR, title: 'Check the roll' }),
    statusLine('T2', 'po', NOW, 'verifying', 'health check passes'),
  ])
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  const listed = async () => [
    (await pane.find({ text: /Ship the task pane/ })) !== undefined,
    (await pane.find({ text: /Check the roll/ })) !== undefined,
  ]

  const drawn = await pane.drawn()
  expect(keyedProps(drawn, 'count:verifying')).toMatchObject({ hotkey: 'v', plain: true })
  expect(keyedProps(drawn, 'count:not-started')).toMatchObject({ hotkey: 'n', plain: true })
  const segment = keyedProps(drawn, 'bar:verifying')
  expect(segment).toMatchObject({ plain: true })
  expect(segment !== null && 'hotkey' in segment).toBe(false)
  expect(await pane.find({ text: /^showing/ })).toBeUndefined()

  await pane.press({ key: 'count:verifying' })
  expect(await listed()).toEqual([false, true])
  expect(await pane.find({ text: 'showing verifying only, click again for all' })).toBeDefined()
  expect(await pane.find({ text: /Verifying \(/ })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: '1 verifying' })).toMatchObject({ props: { bold: true } })

  await pane.press({ key: 'bar:not-started' })
  expect(await listed()).toEqual([true, false])
  expect(await pane.find({ text: 'showing not started only, click again for all' })).toBeDefined()

  await pane.press({ key: 'count:not-started' })
  expect(await listed()).toEqual([true, true])
  expect(await pane.find({ text: /^showing/ })).toBeUndefined()
  expect(await pane.find({ text: /Verifying \(1\)/ })).toBeDefined()
})

test('a filter whose status empties keeps its count at 0 and says nothing is left, until a press clears it', async ($, on) => {
  const { clock, disk } = await start(on)
  const lines = [
    createLine('T1', { owner: 'po', by: 'lead', at: NOW - HOUR, title: 'Ship the task pane' }),
    statusLine('T1', 'po', NOW - HOUR / 2, 'waiting', 'waits on the owner'),
    createLine('T2', { owner: 'po', by: 'po', at: NOW - HOUR, title: 'Check the roll' }),
  ]
  disk.write(EVENTS, lines)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  await pane.press({ key: 'count:waiting' })
  expect(await pane.find({ text: /Ship the task pane/ })).toBeDefined()

  disk.write(EVENTS, [...lines, statusLine('T1', 'po', NOW, 'in-progress')])
  await clock.advance(3_000)
  expect(await pane.find({ type: 'Text', text: '0 waiting' })).toMatchObject({ props: { bold: true } })
  expect(await pane.find({ text: 'Nothing waiting.' })).toBeDefined()
  expect(await pane.find({ text: /Ship the task pane|Check the roll/ })).toBeUndefined()

  await pane.press({ key: 'count:waiting' })
  expect(await pane.find({ text: /waiting/ })).toBeUndefined()
  expect(await pane.find({ text: /Ship the task pane/ })).toBeDefined()
})

test('a filter holds across the all and Changes views, and a new session start lists every task again', async ($, on) => {
  await start(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  await pane.press({ key: 'count:not-started' })
  expect(await pane.find({ text: /^showing not started only/ })).toBeDefined()

  await pane.press({ key: 'all' })
  expect(await pane.find({ text: /Rotate the local URI/ })).toBeDefined()
  await pane.press({ key: 'mine' })
  await pane.press({ key: 'changes' })
  await pane.press({ key: 'tasks' })
  expect(await pane.find({ text: /^showing not started only/ })).toBeDefined()

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await pane.redraw(PANE_PROPS)
  expect(await pane.find({ text: /^showing/ })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: '1 not started' })).toMatchObject({ props: { bold: false } })
})

test('picks up a new register event on the next poll', async ($, on) => {
  const { clock, disk } = await start(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })

  disk.write(EVENTS, [
    createLine('T1', { owner: 'po', by: 'lead', at: NOW - HOUR, priority: 2, title: 'Ship the task pane' }),
    statusLine('T1', 'po', NOW, 'done'),
  ])
  await clock.advance(3_000)
  expect(await pane.find({ text: /Done today \(1\)/ })).toBeDefined()
  expect(await pane.find({ text: /\bnew\b/ })).toBeUndefined()
})

test('a locked or denied register file keeps the last good tasks drawn under the problem, until it reads again', async ($, on) => {
  const { clock, disk } = await start(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  const locks: Lock[] = [
    { op: 'stat', message: 'EBUSY: resource busy or locked, stat', isSeen: true },
    { op: 'stat', message: 'EPERM: operation not permitted, stat', isSeen: false },
    { op: 'stat', message: 'EACCES: permission denied, stat', isSeen: false },
    { op: 'read', message: 'EBUSY: resource busy or locked, read', isSeen: true },
    { op: 'read', message: 'EPERM: operation not permitted, read', isSeen: true },
  ]
  for (const [i, lock] of locks.entries()) {
    disk.lock(EVENTS, lock)
    // A read happens only once the file moved.
    disk.write(EVENTS, [createLine('T1', { owner: 'po', by: 'lead', at: NOW - HOUR, title: 'Ship the task pane' }), statusLine('T1', 'po', NOW, 'in-progress', `step ${i}`)])
    await clock.advance(3_000)
    expect(await pane.find({ text: /Ship the task pane/ })).toBeDefined()
    expect(await pane.find({ text: new RegExp(`WARN .*${lock.message.slice(0, 6)}`) })).toBeDefined()

    disk.unlock(EVENTS)
    await clock.advance(3_000)
    expect(await pane.find({ text: /WARN/ })).toBeUndefined()
    expect(await pane.find({ text: /Ship the task pane/ })).toBeDefined()
  }
})

test('lines teamrig skips are counted as teamrig counts them, and every task and field it reads is still drawn', async ($, on) => {
  const { disk } = await start(on)
  disk.write(EVENTS, [
    createLine('T1', { owner: 'po', by: 'lead', at: NOW - HOUR, priority: 2, title: 'Ship the task pane', lineKeys: { trace: 'a1' }, taskKeys: { risk: 'high', budget: { tokens: 5 } } }),
    JSON.stringify({ v: 3, type: 'vote', id: 'T1', at: iso(NOW - HOUR / 2), by: 'etl', choice: 'ship' }),
    updateLine('T1', 'lead', NOW - HOUR / 2, { risk: 'low' }),
    updateLine('T1', 'lead', NOW - HOUR / 3, { title: 'Ship the task pane v2', risk: 'low' }),
    createLine('T2', { owner: 'po', by: 'lead', at: NOW - HOUR, title: 'Second task' }),
    '{"type":"status","id":"T2"',
    statusLine('T9', 'po', NOW, 'done'),
  ])
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  // Wide enough that the problem line draws unwrapped.
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: { ...PANE_PROPS, bodyColumns: 200 } })

  expect(await pane.find({ text: /^WARN events\.jsonl: 1 unreadable line\(s\), 1 line\(s\) from a newer teamrig, 1 event\(s\) naming no task$/ })).toBeDefined()
  expect(await pane.find({ text: /Ship the task pane v2/ })).toBeDefined()
  expect(await pane.find({ text: /Second task/ })).toBeDefined()
  expect(await pane.find({ text: /^2 active · inbox/ })).toBeDefined()
})

test('missing register, marks and inbox files draw an empty register with no problem, and fill in as they appear', async ($, on) => {
  const { clock, disk } = await start(on)
  for (const path of [EVENTS, MARKS, INBOX]) disk.remove(path)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  expect(await pane.find({ text: /No area for this session yet/ })).toBeDefined()
  expect(await pane.find({ text: /\/teamrig-pane/ })).toBeDefined()
  expect(await pane.find({ text: /WARN/ })).toBeUndefined()

  disk.write(MARKS, [markLine('po', 1, S1, NOW, 'line one')])
  await clock.advance(3_000)
  expect(await pane.find({ text: /Nothing active\./ })).toBeDefined()
  expect(await pane.find({ text: /inbox 0 unread/ })).toBeDefined()

  disk.write(EVENTS, [createLine('T1', { owner: 'po', by: 'lead', at: NOW - HOUR, title: 'Ship the task pane' })])
  disk.write(INBOX, ['line one', 'line two'])
  await clock.advance(3_000)
  expect(await pane.find({ text: /Ship the task pane/ })).toBeDefined()
  expect(await pane.find({ text: /inbox 1 unread/ })).toBeDefined()

  disk.remove(EVENTS)
  await clock.advance(3_000)
  expect(await pane.find({ text: /Nothing active\./ })).toBeDefined()
  expect(await pane.find({ text: /WARN/ })).toBeUndefined()
})

test('a register of 20,000 events loads and draws in well under a second, and a poll with nothing new reads nothing', async ($, on) => {
  const { clock, disk } = await start(on)
  disk.write(EVENTS, bigRegister(20_000))
  const started = performance.now()
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  const loaded = performance.now()
  expect(await pane.find({ text: /^408 active/ })).toBeDefined()
  await pane.redraw({ ...PANE_PROPS, bodyColumns: 40 })
  const redrawn = performance.now()
  await pane.press({ key: 'all' })
  const switched = performance.now()
  expect(await pane.find({ text: /Task 4082 with a title/ })).toBeDefined()
  // Measured on the dev host (2026-10-15, three runs): load 185-200 ms, a redraw 43-48 ms, the switch to all 36-40 ms.
  expect(loaded - started).toBeLessThan(1_500)
  expect(switched - loaded).toBeLessThan(1_000)
  expect(redrawn - loaded).toBeLessThan(500)

  const reads = disk.reads.length
  await clock.advance(3_000)
  expect(disk.reads.length).toBe(reads)
})

test('docked, a list of 2,000 tasks draws only the elements near the window, and a scroll draws the rows it moves to', async ($, on) => {
  const { disk } = await start(on)
  disk.write(
    EVENTS,
    Array.from({ length: 2_000 }, (_, i) => createLine(`T${i + 1}`, { owner: 'po', by: 'lead', at: NOW - HOUR, title: `Long list task ${i + 1}` })),
  )
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  await pane.press({ key: 'all' })
  const numbers = async () =>
    (await pane.findAll({ type: 'Text', text: /Long list task \d+/ })).map(found => Number(/Long list task (\d+)/.exec(found.text)?.[1]))
  // Four screenfuls of 40 rows hold a few dozen tasks of the 2,000, and the tree's buttons stay as few.
  const top = await numbers()
  expect(top).toContain(1)
  expect(top.length).toBeLessThan(60)
  expect(top).not.toContain(2_000)
  expect(buttonKeys(await pane.drawn()).length).toBeLessThan(80)

  await pane.redraw({ ...PANE_PROPS, scroll: { offset: 5_000, bodyRows: 40 } })
  const middle = await numbers()
  expect(middle.length).toBeGreaterThan(0)
  expect(middle.length).toBeLessThan(60)
  expect(Math.min(...middle)).toBeGreaterThan(1)
  expect(Math.max(...middle)).toBeLessThan(2_000)
})

/** A drawn element's props, when it has any. */
function propsOf(node: unknown): object | null {
  return typeof node === 'object' && node !== null && 'props' in node && typeof node.props === 'object' && node.props !== null ? node.props : null
}

function childrenOf(node: unknown): unknown[] {
  return typeof node === 'object' && node !== null && 'children' in node && Array.isArray(node.children) ? node.children : []
}

/** The keys of a drawing's buttons, in drawing order. */
function buttonKeys(node: unknown): string[] {
  const props = propsOf(node)
  const isButton = typeof node === 'object' && node !== null && 'type' in node && node.type === 'Button'
  if (isButton && props !== null && 'key' in props && typeof props.key === 'string') return [props.key]
  return childrenOf(node).flatMap(buttonKeys)
}

/** The drawn element keyed `key`, depth first. */
function keyedNode(node: unknown, key: string): unknown {
  const props = propsOf(node)
  if (props !== null && 'key' in props && props.key === key) return node
  for (const child of childrenOf(node)) {
    const found = keyedNode(child, key)
    if (found !== null) return found
  }
  return null
}

const FOCUSABLE = new Set(['Button', 'Input', 'Select'])

/** A drawing's focusable elements (Button, Input, Select) in drawing order, by tag and key: the engine's focus ring is an index into them. */
function focusables(node: unknown): { type: string; key: string }[] {
  const props = propsOf(node)
  const type = typeof node === 'object' && node !== null && 'type' in node && typeof node.type === 'string' ? node.type : null
  if (type !== null && FOCUSABLE.has(type) && props !== null && 'key' in props && typeof props.key === 'string') return [{ type, key: props.key }]
  return childrenOf(node).flatMap(focusables)
}

/** Where the Find field sits among a drawing's focusable elements; -1 where none is drawn. */
function fieldIndex(node: unknown): number {
  return focusables(node).findIndex(element => element.type === 'Input')
}

/** The Find field as drawn: the key of its round (find-field.ts) and the text it holds as drawn; null where none is drawn. */
function drawnField(node: unknown): { key: string; value: unknown } | null {
  const field = focusables(node).find(element => element.type === 'Input')
  if (field === undefined) return null
  const props = keyedProps(node, field.key)
  return { key: field.key, value: props !== null && 'value' in props ? props.value : undefined }
}

function keyedProps(node: unknown, key: string): object | null {
  return propsOf(keyedNode(node, key))
}

/** Each Link a drawn tree holds, depth first: its address and its children, the text it draws. */
function linksIn(node: unknown): Array<[unknown, unknown[]]> {
  const props = propsOf(node)
  const isLink = typeof node === 'object' && node !== null && 'type' in node && node.type === 'Link'
  if (isLink && props !== null && 'href' in props) return [[props.href, childrenOf(node)]]
  return childrenOf(node).flatMap(linksIn)
}

/** How many elements of `type` a drawn tree holds. */
function countType(node: unknown, type: string): number {
  if (typeof node !== 'object' || node === null) return 0
  const self = 'type' in node && node.type === type ? 1 : 0
  const children: unknown[] = 'children' in node && Array.isArray(node.children) ? node.children : []
  return children.reduce((sum: number, child) => sum + countType(child, type), self)
}

test('docked, it pads the frame, spaces the tasks, wraps a long title under itself and cuts it at two lines, a meta line under it', async ($, on) => {
  const { disk } = await start(on)
  const title = 'Ship the task pane with wrapped lines that sit under the task id'
  const long = 'A title long enough to need more than two lines in a pane this narrow, so the row cuts it at two and the card shows it whole'
  disk.write(EVENTS, [createLine('T1', { owner: 'po', by: 'lead', at: NOW - HOUR, title }), createLine('T2', { owner: 'po', by: 'lead', at: NOW - HOUR, title: long })])
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })

  expect((await pane.find({ type: 'Box' }))?.props).toMatchObject({ paddingX: 1, gap: 1 })
  const task = await pane.find({ type: 'Text', text: /Ship the task pane/ })
  expect(task?.text).toMatch(/^○ T1  .+\n {6}\S.+\n {6}p3 · new · asked by owner$/)
  expect(task?.text.split('\n').every(line => line.length <= PANE_PROPS.bodyColumns - 2)).toBe(true)
  const cut = (await pane.find({ type: 'Text', text: /^○ T2 / }))?.text.split('\n') ?? []
  expect(cut.length).toBe(3)
  expect(cut[1]).toMatch(/^ {6}\S.*…$/)
  expect(cut[2]).toBe('      p3 · new · asked by owner')
})

test('a title and note of CJK and emoji sequences wrap by display cells, no line past the frame', async ($, on) => {
  const { disk } = await start(on)
  const title = '修复任务面板的宽字符 👨‍👩‍👧 显示 ❤️ 标题 🇮🇱 한국어 제목 👍🏽 done'
  disk.write(EVENTS, [
    createLine('T1', { owner: 'po', by: 'lead', at: NOW - HOUR, title }),
    statusLine('T1', 'po', NOW - HOUR / 2, 'in-progress', '進捗メモ 👩🏽‍💻 ✍️ 完了まであと少し'),
  ])
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  await pane.press({ key: 'working:T1' })

  const texts = (await pane.findAll({ type: 'Text' })).map(found => found.text)
  expect(texts.flatMap(text => text.split('\n')).every(line => cells(line) <= PANE_PROPS.bodyColumns - 2)).toBe(true)
  // The title draws whole above the card, the note in the card, each wrapped.
  expect((await pane.find({ type: 'Text', text: /^◐ T1  修复/ }))?.text).toContain('👨‍👩‍👧')
  const card = (await pane.find({ type: 'Text', text: CARD }))?.text ?? ''
  expect(card).toContain('👩🏽‍💻')
  expect(card.split('\n').length).toBeGreaterThan(4)
})

test('with one folder named, no settings file and no teamrig project, it says what to set and reads nothing', async ($, on) => {
  const tasksOnly = Object.fromEntries(Object.entries(REGISTER_ENV).filter(([key]) => key !== 'TEAMRIG_PANE_INBOX_DIR'))
  const { disk } = await start(on, {}, { roots: {}, statuses: {} }, tasksOnly)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })

  const problem = await pane.find({ text: /^WARN no register found/ })
  expect(problem?.text.split(/\s+/).join(' ')).toBe(
    "WARN no register found: set TEAMRIG_PANE_TASKS_DIR and TEAMRIG_PANE_INBOX_DIR, write them in /Homes/tester/.teamrig/pane.json, or start the session in a teamrig team's project (.teamrig.json)",
  )
  expect(await pane.find({ text: /Ship the task pane/ })).toBeUndefined()
  expect(disk.reads).toEqual([])
})

test('with no folder named, it reads the register teamrig keeps for the team its pointer file names', async ($, on) => {
  const { disk } = await start(on, {}, { roots: {}, statuses: {} }, { USERPROFILE: HOME })
  disk.write('/work/.teamrig.json', [JSON.stringify({ team: 'web' })])
  disk.write('/Homes/tester/.teamrig/teams/web/state/events.jsonl', [
    createLine('T7', { owner: 'web', by: 'lead', at: NOW - HOUR, title: 'Ship the team register' }),
  ])
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })

  await pane.press({ key: 'all' })
  expect(await pane.find({ text: /Ship the team register/ })).toBeDefined()
  expect(await pane.find({ text: /Ship the task pane/ })).toBeUndefined()
})

test('/teamrig-pane <session> pins the session an id or a name names; a word naming none pins nothing and lists the sessions', async ($, on) => {
  const { disk, opened, store } = await start(on, {}, { roots: {}, statuses: {} }, { USERPROFILE: HOME })
  const team = '/Homes/tester/.teamrig/teams/web'
  disk.write('/work/.teamrig.json', [JSON.stringify({ team: 'web' })])
  disk.write(`${team}/config.json`, [JSON.stringify({ sessions: ['lead', 'api'], names: { api: 'web-backend' } })])
  disk.write(`${team}/state/events.jsonl`, [createLine('T7', { owner: 'api', by: 'lead', at: NOW - HOUR, title: 'Ship the api' })])
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  const run = (args: string) => $.command.run({ command: 'teamrig-pane', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
  const opens = opened.length

  const unknown = await run('web')
  expect(unknown.text).toBe('Not pinned (team web): web is not a session on this team (sessions: lead (web-lead), api (web-backend)).')
  expect(store.get(`pin:${S1}`)).toBeUndefined()
  expect(opened.length).toBe(opens)

  // The name the user renamed the session to since the pane started is read from the rename log at the command.
  disk.write(`${team}/state/renames.jsonl`, [JSON.stringify({ v: 1, id: 'api', from: 'web-backend', to: 'web-api', at: iso(NOW), by: 'api' })])
  expect((await run('Web-API')).text).toBeUndefined()
  expect(store.get(`pin:${S1}`)).toBe('api')
  expect(await pane.find({ text: /^api \(pinned\) · 1 active/ })).toBeDefined()
  expect(await pane.find({ text: /Ship the api/ })).toBeDefined()

  await run('lead')
  expect(store.get(`pin:${S1}`)).toBe('lead')
  expect(await pane.find({ text: /^lead \(pinned\) · 0 active/ })).toBeDefined()
})

test('the settings file in the kit home names the folders, ~/ under the home folder', async ($, on) => {
  const { disk } = await start(on, {}, { roots: {}, statuses: {} }, { USERPROFILE: HOME })
  disk.write('/Homes/tester/.teamrig/pane.json', [
    JSON.stringify({ tasksDir: '~/team-notes/tasks', inboxDir: '~/team-notes/board/inbox' }),
  ])
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })

  expect(await pane.find({ text: /Ship the task pane/ })).toBeDefined()
  expect(await pane.find({ text: /WARN/ })).toBeUndefined()
})

test('draws each collapsed task as one Text: no Box beyond the root, the controls, their two button rows and the find row', async ($, on) => {
  await start(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })

  await pane.press({ key: 'all' })
  expect(countType(await pane.drawn(), 'Box')).toBe(5)
})

test('pressing a task opens its card in place of its meta line, the ask quoted from the inbox and the roadmap; pressing again closes it', async ($, on) => {
  const { disk } = await start(on)
  disk.write(INBOX, ['line one', 'line two', 'line three', '- 2026-10-13 12:40 lead: ship the pane with details'])
  disk.write('/docs/ROADMAP.md', ['## G10', '  - [ ] G10.1g **Fix the formula** with `analytics`'])
  const ref = '~/team-notes/board/inbox/po.md:4; docs/ROADMAP.md:2'
  disk.write(EVENTS, [
    createLine('T1', { owner: 'po', by: 'lead', at: NOW - HOUR, title: 'Ship the task pane', ref, goals: ['G10.1g'] }),
  ])
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: WIDE })
  const collapsed = /^○ T1  Ship the task pane\n {6}p3 · new · asked by owner$/
  expect(await pane.find({ type: 'Text', text: collapsed })).toBeDefined()
  expect(await pane.find({ text: /ship the pane with details/ })).toBeUndefined()
  const boxes = countType(await pane.drawn(), 'Box')

  await pane.press({ key: 'next:T1' })
  expect(await pane.find({ type: 'Text', text: /^○ T1  Ship the task pane$/ })).toBeDefined()
  expect(await pane.find({ text: /new · asked by owner/ })).toBeUndefined()
  expect((await pane.find({ type: 'Text', text: CARD }))?.text.split('\n')).toEqual([
    cardLine('Description', '2026-10-13 12:40 lead: ship the pane with details'),
    `${CARD_UNDER}G10.1g Fix the formula with analytics`,
    cardLine('Status', 'not started since 13:00 by lead'),
    cardLine('Priority', '3'),
    cardLine('Week', 'Tue 10-13'),
    cardLine('Goal', 'G10.1g'),
    cardLine('From', 'owner'),
    cardLine('Added', '13:00 by lead'),
  ])
  // Each reference file is a press, so its line is a row of its own under the card's text.
  const drawn = await pane.drawn()
  const screen = screenOf(drawn)
  expect(screen).toContain(` ${cardLine('Reference', 'inbox/po.md')}`)
  expect(screen).toContain(` ${CARD_UNDER}docs/ROADMAP.md`)
  // The card sits under the task's button, the two in a column of their own, each reference line a row in it: three
  // Boxes more than collapsed.
  expect(buttonKeys(keyedNode(drawn, 'next:T1-open')).map(key => key.split(':').slice(0, 2).join(':'))).toEqual(['next:T1', 'goto:file', 'goto:file'])
  expect(countType(drawn, 'Box')).toBe(boxes + 3)

  await pane.press({ key: 'next:T1' })
  expect(await pane.find({ text: /│ Status|ship the pane with details/ })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: collapsed })).toBeDefined()
  expect(countType(await pane.drawn(), 'Box')).toBe(boxes)
})

test("an open card shows its priority as a number, never the team config's name for it, with its week, goals, note and evidence", async ($, on) => {
  const { disk } = await start(on, {}, { roots: {}, statuses: {} }, { USERPROFILE: HOME })
  disk.write('/work/.teamrig.json', [JSON.stringify({ team: 'web' })])
  disk.write('/Homes/tester/.teamrig/teams/web/config.json', [JSON.stringify({ register: { priorities: [{ id: 2, name: 'correctness' }] } })])
  disk.write('/Homes/tester/.teamrig/teams/web/state/events.jsonl', [
    createLine('T7', { owner: 'web', by: 'lead', at: NOW - HOUR, priority: 2, title: 'Ship the team register', goals: ['G10.2', 'G15'] }),
    statusLine('T7', 'web', NOW - HOUR / 2, 'in-progress', 'details drawn', 'abc1234'),
  ])
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: WIDE })
  await pane.press({ key: 'all' })
  expect(await pane.find({ text: /^◐ T7  Ship the team register\n {6}p2 · in progress since 13:30$/ })).toBeDefined()
  expect(await pane.find({ text: /correctness/ })).toBeUndefined()

  await pane.press({ key: 'web:T7' })
  expect((await pane.find({ type: 'Text', text: CARD }))?.text.split('\n')).toEqual([
    cardLine('Status', 'in progress since 13:30 by web'),
    cardLine('Note', 'details drawn'),
    cardLine('Priority', '2'),
    cardLine('Week', 'Tue 10-13'),
    cardLine('Goal', 'G10.2'),
    `${CARD_UNDER}G15`,
    cardLine('From', 'owner'),
    cardLine('Added', '13:00 by lead'),
  ])
  // The reference file, a press, draws on a row of its own, and the rows after it in a text of their own.
  const screen = screenOf(await pane.drawn())
  expect(screen).toContain(` ${cardLine('Reference', 'docs/x.md')}`)
  expect(screen).toContain(` ${cardLine('Evidence', 'abc1234')}`)
  expect(await pane.find({ text: /correctness/ })).toBeUndefined()
})

test('an open waiting card says since when it waits, its note on a row of its own; collapse (c) closes every card', async ($, on) => {
  await start(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: WIDE })
  await pane.press({ key: 'all' })
  expect(await pane.find({ text: /collapse/ })).toBeUndefined()
  expect(await pane.find({ text: /waiting since 14:00: needs owner paste/ })).toBeDefined()

  await pane.press({ key: 'security:T2' })
  await pane.press({ key: 'po:T1' })
  expect(await pane.find({ type: 'Text', text: /^ {4}│ Status {7}waiting since 14:00 by security\n {4}│ Note {9}needs owner paste\n/ })).toBeDefined()
  expect(await pane.find({ text: /waiting since 14:00: needs owner paste/ })).toBeUndefined()
  // Each open card is a column Box, its reference file's line a row Box in it.
  expect(countType(await pane.drawn(), 'Box')).toBe(9)
  const collapse = (await pane.findAll({ type: 'Button' })).find(found => found.props['label'] === 'collapse')
  expect(collapse?.props).toMatchObject({ hotkey: 'c' })

  await pane.press({ key: 'collapse' })
  expect(await pane.find({ text: /│ (Status|From)/ })).toBeUndefined()
  expect(await pane.find({ text: /waiting since 14:00: needs owner paste/ })).toBeDefined()
  expect(await pane.find({ text: /collapse/ })).toBeUndefined()
  expect(countType(await pane.drawn(), 'Box')).toBe(5)
})

test('an open card draws each address its ref, note, proof and evidence hold as one Link, the issue a GitHub task came from first', async ($, on) => {
  const { disk } = await start(on)
  disk.write(EVENTS, [
    createLine('T1', { owner: 'po', by: 'github', at: NOW - HOUR, source: 'github', ref: 'gh:acme/app#12', title: 'Fix the sign-in' }),
    verifyingLine('T1', 'po', NOW, 'run https://ci.example/run/9 passes', 'review https://example.com/pr/7, then https://example.com/pr/7.', 'https://ci.example/run/9'),
  ])
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: WIDE })
  expect(countType(await pane.drawn(), 'Link')).toBe(0)

  await pane.press({ key: 'verifying:T1' })
  // Each Link's text (its children) is its address, whole in a pane this wide.
  expect(linksIn(await pane.drawn())).toEqual([
    ['https://github.com/acme/app/issues/12', ['https://github.com/acme/app/issues/12']],
    ['https://example.com/pr/7', ['https://example.com/pr/7']],
    ['https://ci.example/run/9', ['https://ci.example/run/9']],
  ])
  expect(countType(await pane.drawn(), 'Link')).toBe(3)
  // A note's and a proof's words stay plain text, the addresses they hold among them; the proof in green.
  expect(await pane.find({ type: 'Text', text: /│ Note {9}review https:\/\/example\.com\/pr\/7, then/ })).toBeDefined()
  const proof = await pane.find({ type: 'Text', text: /^run https:\/\/ci\.example\/run\/9 passes$/ })
  expect(proof?.props).toMatchObject({ color: 'success' })
})

/** Open cards as an older pane's TaskDetail held them, without goals, kept under a tag that is not the cards'. */
const OLDER_CARDS = { shape: 'expanded-v0', value: { T1: { ref: 'docs/x.md', quotes: [] } } }

test('after a hot reload, open cards kept under another tag read as none open, and a press opens a card again', async ($, on) => {
  await start(on)
  let isOldValueStored = true
  on('state.get', async ($, e, next) => {
    const answer = await next(e)
    return isOldValueStored && e.key === 'expanded' ? { value: OLDER_CARDS } : answer
  })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: WIDE })

  expect(await pane.find({ text: /│ Status|could not draw|collapse/ })).toBeUndefined()
  expect(await pane.find({ text: /p2 · due Wed 10-14 · new · asked by owner/ })).toBeDefined()
  isOldValueStored = false
  await pane.press({ key: 'next:T1' })
  expect(await pane.find({ text: /^ {4}│ Status {7}not started since 13:00 by lead$/m })).toBeDefined()
})

test('inline above the prompt, it shows a few rows and points to the side dock', async ($, on) => {
  const { disk } = await start(on)
  disk.write(
    EVENTS,
    Array.from({ length: 10 }, (_, i) => createLine(`T${i + 1}`, { owner: 'po', by: 'po', at: NOW, title: `Task number ${i + 1}` })),
  )
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({
    plugin: 'teamrig-pane',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'teamrig-pane',
    props: { ...PANE_PROPS, placement: 'inline' },
  })

  expect((await pane.find({ type: 'Box' }))?.props).toMatchObject({ gap: 0 })
  // The bar's two lines count in the few rows, and the list keeps its header, first heading and task, and pointer.
  expect(await pane.find({ type: 'Text', text: '░'.repeat(48) })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '10 not started' })).toBeDefined()
  expect(await pane.find({ text: /Task number 1$/ })).toBeDefined()
  expect(await pane.find({ text: /Task number 3$/ })).toBeUndefined()
  expect(await pane.find({ text: /Task number 10/ })).toBeUndefined()
  expect(await pane.find({ text: /more lines in the side dock/ })).toBeDefined()
})

test('a drawing that throws shows the error under the mode buttons, and the next draw shows the tasks', async ($, on) => {
  await start(on)
  let isStateDown = true
  on('state.get', async ($, e, next) => (isStateDown && e.key === 'expanded' ? { deny: 'state store unavailable' } : next(e)))
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })

  expect(await pane.find({ text: /^WARN the pane could not draw: .*state store unavailable/ })).toBeDefined()
  expect(buttonKeys(await pane.drawn())).toEqual(['tasks', 'changes', 'find-key', 'mine', 'all', 'archive'])

  isStateDown = false
  await pane.redraw(PANE_PROPS)
  expect(await pane.find({ text: /could not draw/ })).toBeUndefined()
  expect(await pane.find({ text: /Ship the task pane/ })).toBeDefined()
})

/** A snapshot as the pane before register v2 kept it: untagged, its rows without the v2 fields. */
const PRE_V2_SNAPSHOT = {
  tasks: [{ id: 'T1', title: 'Drawn by the old pane', owner: 'po', tier: 2, status: 'open', shown: 'open', lastNote: null }],
  area: 'po',
  areaSource: 'inbox',
  unreadInbox: 0,
  problem: null,
  now: NOW,
}

test('after a hot reload, a snapshot the older pane wrote reads as empty, never drawn with fields missing', async ($, on) => {
  await start(on)
  let isOldValueStored = true
  on('state.get', async ($, e, next) => {
    const answer = await next(e)
    if (!isOldValueStored || e.key !== 'snapshot' || answer.value === undefined) return answer
    return { value: { ...answer.value, value: PRE_V2_SNAPSHOT } }
  })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  await pane.press({ key: 'all' })

  expect(await pane.find({ text: /Drawn by the old pane|could not draw/ })).toBeUndefined()
  expect(await pane.find({ text: /^Reading the register…$/ })).toBeDefined()
  isOldValueStored = false
  await pane.redraw(PANE_PROPS)
  expect(await pane.find({ text: /Ship the task pane/ })).toBeDefined()
})

test('resized to a narrow dock or inline, it draws every line inside the frame and never blanks', async ($, on) => {
  const { disk } = await start(on)
  disk.write(EVENTS, [
    createLine('T1', { owner: 'po', by: 'lead', at: NOW - HOUR, priority: 1, due: '2026-10-14', title: 'Ship the task pane with a title long enough to wrap' }),
    statusLine('T1', 'po', NOW - HOUR / 2, 'waiting', 'a status note that also needs to wrap', 'evidence long enough to wrap too'),
  ])
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  await pane.press({ key: 'waiting:T1' })

  for (const bodyColumns of [30, 20, 12]) {
    await pane.redraw({ ...PANE_PROPS, bodyColumns })
    const lines = (await pane.findAll({ type: 'Text' })).flatMap(found => found.text.split('\n'))
    expect(lines.some(line => line.includes('Ship'))).toBe(true)
    expect(lines.filter(line => cells(line) > bodyColumns - 2)).toEqual([])
  }
  for (const bodyColumns of [2, 0]) {
    await pane.redraw({ ...PANE_PROPS, bodyColumns })
    const text = (await pane.findAll({ type: 'Text' })).map(found => found.text).join('')
    expect(text.replace(/\s/g, '')).toContain('Ship')
  }
  await pane.redraw({ ...PANE_PROPS, bodyColumns: 12, placement: 'inline', scroll: { offset: 0, bodyRows: 4 } })
  const rows = await pane.findAll({ type: 'Text' })
  expect(rows.some(found => found.text.includes('Ship'))).toBe(true)
  expect(await pane.find({ text: /more lines in the side dock/ })).toBeDefined()
})

test('a session starts minimized when the last one was left so: one row, docked or inline, a press on it opens the pane in full', async ($, on) => {
  const { store } = await start(on, { paneSize: 'minimized' })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })

  for (const props of [PANE_PROPS, { ...PANE_PROPS, bodyColumns: 23 }, { ...PANE_PROPS, placement: 'inline' as const }]) {
    await pane.redraw(props)
    expect((await pane.findAll({ type: 'Text' })).map(found => found.text)).toEqual(['minimized'])
    expect(buttonKeys(await pane.drawn())).toEqual(['tasks', 'changes'])
  }
  expect(await pane.find({ text: /Ship the task pane/ })).toBeUndefined()

  await pane.press({ key: 'tasks' })
  expect(await pane.find({ text: /Ship the task pane/ })).toBeDefined()
  expect(store.get('paneSize')).toBe('open')
})

/** The band above the prompt (AbovePrompt) as the terminal raises it with no survey up. */
const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} } as const

function mountBand($: TestEngine, props: AbovePromptProps = BAND_PROPS): Promise<Mounted<'AbovePrompt'>> {
  return $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'AbovePrompt', requestId: 'band', props })
}

/** The banner's text in the band, its card's rows too when open; null when the band draws none. */
async function bannerText(band: Mounted<'AbovePrompt'>): Promise<string | null> {
  const buttons = await band.findAll({ type: 'Button' })
  return buttons.find(button => button.props['key'] === BANNER_KEY)?.text ?? null
}

/** What the engine draws in the band once the plugin passes it: the test stands for it, as nothing sits beneath the test. */
const ENGINE_BAND = 'the engine band'

/** Stands for the engine on the band, drawing ENGINE_BAND; the drawings the plugin passed to it, by whether a survey was up. */
function engineBand(on: On): boolean[] {
  const passes: boolean[] = []
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    passes.push(e.props.hasSurvey)
    const { Text } = $.ui.resolve(e)
    return Text({ children: ENGINE_BAND })
  })
  return passes
}

test('the band above the prompt names the task up next, follows a status change, and a press opens its card and a second closes it', async ($, on) => {
  const { clock, disk } = await start(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const band = await mountBand($)
  const banner = () => bannerText(band)

  // Nothing in progress: the area's first open task, after a dim next, cut at one line; one press and no hotkey, as a
  // band's hotkey would answer a bare key typed in an empty prompt.
  expect(buttonKeys(await band.drawn())).toEqual([BANNER_KEY])
  const press = keyedProps(await band.drawn(), BANNER_KEY)
  expect(press).toMatchObject({ plain: true })
  expect(press !== null && 'hotkey' in press).toBe(false)
  expect(await banner()).toMatch(/^next ○ T1 {2}Ship the task pane/)

  disk.write(EVENTS, [
    createLine('T1', { owner: 'po', by: 'lead', at: NOW - HOUR, priority: 2, title: 'Ship the task pane' }),
    statusLine('T1', 'po', NOW, 'in-progress', 'halfway'),
  ])
  await clock.advance(3_000)
  expect(await banner()).toMatch(/^◐ T1 {2}Ship the task pane/)
  expect(await banner()).not.toMatch(/Note/)

  await band.press({ key: BANNER_KEY })
  expect(await banner()).toMatch(/\nNote +halfway/)
  expect(await banner()).toMatch(/\nPriority +2/)

  await band.press({ key: BANNER_KEY })
  expect(await banner()).not.toMatch(/Note/)
})

test('the band shows the task whether the pane is minimized or never drawn, and the pane draws no banner of its own', async ($, on) => {
  await start(on, { paneSize: 'minimized' })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const band = await mountBand($)
  expect(await bannerText(band)).toMatch(/^next ○ T1 {2}Ship the task pane/)

  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  expect(buttonKeys(await pane.drawn())).toEqual(['tasks', 'changes'])
  await pane.press({ key: 'tasks' })
  expect(buttonKeys(await pane.drawn())).not.toContain(BANNER_KEY)
  expect(await bannerText(band)).toMatch(/^next ○ T1 {2}Ship the task pane/)
})

test('a survey takes the band: the plugin passes it to the engine, and draws the banner again once the survey is gone', async ($, on) => {
  await start(on)
  const passes = engineBand(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const band = await mountBand($, { ...BAND_PROPS, hasSurvey: true })
  expect(buttonKeys(await band.drawn())).not.toContain(BANNER_KEY)
  expect(await band.find({ text: ENGINE_BAND })).toBeDefined()
  expect(passes).toEqual([true])

  await band.redraw(BAND_PROPS)
  expect(await bannerText(band)).toMatch(/^next ○ T1 {2}Ship the task pane/)
  expect(await band.find({ text: ENGINE_BAND })).toBeUndefined()
  expect(passes).toEqual([true])
})

test('the band draws nothing for a session with no area, then says its area has nothing current, then names its task up next', async ($, on) => {
  const { clock, disk } = await start(on)
  for (const path of [EVENTS, MARKS]) disk.remove(path)
  const passes = engineBand(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const band = await mountBand($)
  expect(buttonKeys(await band.drawn())).not.toContain(BANNER_KEY)
  expect(await band.find({ text: ENGINE_BAND })).toBeDefined()
  expect(passes).toEqual([false])

  disk.write(MARKS, [markLine('po', 1, S1, NOW, 'line one')])
  await clock.advance(3_000)
  expect(await bannerText(band)).toBe(NOTHING_CURRENT)

  disk.write(EVENTS, [createLine('T1', { owner: 'po', by: 'lead', at: NOW - HOUR, title: 'Ship the task pane' })])
  await clock.advance(3_000)
  expect(await bannerText(band)).toMatch(/^next ○ T1 {2}Ship the task pane/)
})

test('the session registers /teamrig-pane alone: /teamrig stays free for the teamrig plugin', async ($, on) => {
  const { registered } = await start(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  expect(registered).toEqual(['teamrig-pane'])
})

test('/teamrig leaves a minimized pane alone: the pane answers only /teamrig-pane', async ($, on) => {
  const { store } = await start(on, { paneSize: 'minimized' })
  // Beneath the plugin: what answers a command no plugin takes.
  on('command.run', async ($, e) => ({ text: `no plugin took /${e.command}` }))
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })

  const ran = await $.command.run({ command: 'teamrig', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
  expect(ran.text).toBe('no plugin took /teamrig')
  expect(await pane.find({ text: /Ship the task pane/ })).toBeUndefined()
  expect(store.get('paneSize')).toBe('minimized')
})

test('/teamrig-pane opens a minimized pane in full', async ($, on) => {
  const { store } = await start(on, { paneSize: 'minimized' })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })

  await $.command.run({ command: 'teamrig-pane', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
  expect(await pane.find({ text: /Ship the task pane/ })).toBeDefined()
  expect(store.get('paneSize')).toBe('open')
})

const REPO_STATUS = ['## pane-v2', ' M hooks/a.ts', 'R  hooks/new.ts', 'hooks/old.ts', '?? tests/', ''].join('\0')
const REPO_NUMSTAT = ['4\t1\thooks/a.ts', '2\t2\t', 'hooks/old.ts', 'hooks/new.ts', ''].join('\0')
const REPO_GREP = ['tests/a.test.ts\u00006', 'tests/b.test.ts\u00003', ''].join('\n')
const NARROW_AND_INLINE = [
  { ...PANE_PROPS, bodyColumns: 20 },
  { ...PANE_PROPS, bodyColumns: 12 },
  { ...PANE_PROPS, placement: 'inline' as const, scroll: { offset: 0, bodyRows: 3 } },
]

/** The label of the drawn button keyed `key`. */
function buttonLabel(node: unknown, key: string): string | null {
  const props = keyedProps(node, key)
  return props !== null && 'label' in props && typeof props.label === 'string' ? props.label : null
}

test('the Tasks / Changes switch leads the pane in every view, width and placement, wrapping rather than clipping', async ($, on) => {
  await start(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })

  for (const props of [PANE_PROPS, ...NARROW_AND_INLINE]) {
    await pane.redraw(props)
    const drawn = await pane.drawn()
    expect(buttonKeys(keyedNode(drawn, 'switch'))).toEqual(['tasks', 'changes'])
    // Then the mode buttons, past the Find row the dock draws between them.
    expect(buttonKeys(drawn).filter(key => key !== 'find-key').slice(0, 4)).toEqual(['tasks', 'changes', 'mine', 'all'])
    const row = keyedProps(drawn, 'switch')
    expect(row !== null && 'flexWrap' in row ? row.flexWrap : null).toBe('wrap')
  }
  await pane.redraw(PANE_PROPS)
  await pane.press({ key: 'changes' })
  for (const props of [PANE_PROPS, ...NARROW_AND_INLINE]) {
    await pane.redraw(props)
    expect(buttonKeys(await pane.drawn())).toEqual(['tasks', 'changes'])
  }
})

test("the Changes view lists each repo's changed files with their lines, counted on the switch and in the tab title", async ($, on) => {
  const { clock, titles } = await start(on, {}, { roots: { '/work': '/work' }, statuses: { '/work': REPO_STATUS }, numstats: { '/work': REPO_NUMSTAT }, greps: { '/work': REPO_GREP } })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })

  // The session's repo is read in the background, after the pane opened with no count in its title; the
  // read lands while the mount draws, so the next drawing is the one to look at.
  await clock.settle()
  await pane.redraw(PANE_PROPS)
  expect(titles).toEqual(['Tasks', 'Tasks · Δ3'])
  expect(buttonLabel(await pane.drawn(), 'changes')).toBe('Changes Δ3')
  await pane.press({ key: 'changes' })
  expect(await pane.find({ text: /work · pane-v2 · 3 changed/ })).toBeDefined()
  expect(await pane.find({ text: / M hooks\/a\.ts \+4 -1/ })).toBeDefined()
  expect(await pane.find({ text: /R  hooks\/new\.ts \+2 -2 ← hooks\/old\.ts/ })).toBeDefined()
  expect(await pane.find({ text: /\?\? tests\/ \+9/ })).toBeDefined()
  expect(await pane.find({ text: /Ship the task pane/ })).toBeUndefined()

  await pane.press({ key: 'tasks' })
  expect(await pane.find({ text: /Ship the task pane/ })).toBeDefined()
})

test('a press on a Changes file opens its diff under it, kept current as the file changes, and a second press closes it', async ($, on) => {
  const patch = (line: string) => ['diff --git a/hooks/a.ts b/hooks/a.ts', '--- a/hooks/a.ts', '+++ b/hooks/a.ts', '@@ -1,2 +1,2 @@', ' const x = 1', '-const y = 2', `+${line}`, ''].join('\n')
  const patches: Record<string, string> = { 'hooks/a.ts': patch('const y = 3') }
  const repos: FakeRepos = { roots: { '/work': '/work' }, statuses: { '/work': REPO_STATUS }, numstats: { '/work': REPO_NUMSTAT }, greps: { '/work': REPO_GREP }, patches }
  const { clock, runs } = await start(on, {}, repos)
  on('tool.call', { tool: 'Bash' }, async () => ({ result: 'ran' }))
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  await clock.settle()
  await pane.redraw(PANE_PROPS)
  await pane.press({ key: 'changes' })
  // The file's row is a press in its repo's card: keyed by the card (`repo:/work-open`) and the row.
  const file = 'diff:repo:/work-open:/work:hooks/a.ts'
  await pane.press({ key: file })
  await clock.settle()
  expect(await pane.find({ text: /-const y = 2/ })).toBeDefined()
  expect(await pane.find({ text: /\+const y = 3/ })).toBeDefined()
  expect(await pane.find({ text: /\+\+\+ b\/hooks/ })).toBeUndefined()

  // Edited again to the same counts: the shell call's read of the changes reads the open diff again.
  patches['hooks/a.ts'] = patch('const y = 4')
  await $.tool.call({ tool: 'Bash', command: 'npm run fmt' })
  await clock.advance(3_000)
  expect(await pane.find({ text: /\+const y = 4/ })).toBeDefined()

  await pane.press({ key: file })
  await clock.settle()
  expect(await pane.find({ text: /const y/ })).toBeUndefined()
  // Closed, it is read no more: the next read runs the numstat alone.
  const diffRuns = () => runs.filter(run => run === 'diff /work').length
  const before = diffRuns()
  await $.tool.call({ tool: 'Bash', command: 'npm run fmt' })
  await clock.advance(3_000)
  expect(diffRuns()).toBe(before + 1)
})

test('a file the session writes adds its repo on the next poll; a failed write adds none; one outside any repo is listed as such', async ($, on) => {
  const repos: FakeRepos = { roots: { '/repo/src': '/repo' }, statuses: { '/repo': ['## main', ' M src/a.ts', ''].join('\0') } }
  const { clock, disk, runs, titles } = await start(on, {}, repos)
  on('tool.call', { tool: 'Edit' }, async ($, e) => (e.file_path.endsWith('bad.ts') ? { result: 'no match', isError: true } : { result: 'edited' }))
  on('tool.call', { tool: 'Write' }, async ($, e) => {
    disk.write(e.file_path, [e.content])
    return { result: 'written' }
  })
  on('tool.call', { tool: 'Bash' }, async () => ({ result: 'ran' }))
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.settle()
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  await pane.press({ key: 'changes' })
  expect(await pane.find({ text: /No git repo yet/ })).toBeDefined()

  await $.tool.call({ tool: 'Edit', file_path: '/other/bad.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/a.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Write', file_path: '/notes/plan.md', content: 'x' })
  await clock.advance(3_000)
  expect(await pane.find({ text: /repo · main · 1 changed/ })).toBeDefined()
  expect(await pane.find({ text: /written outside git \(1\)/ })).toBeDefined()
  expect(await pane.find({ text: /\/notes\/plan\.md/ })).toBeDefined()
  expect(await pane.find({ text: /bad\.ts/ })).toBeUndefined()
  expect(titles.at(-1)).toBe('Tasks · Δ2')

  // A shell call (a commit, say) is read on the next poll; with nothing new, the poll runs no git.
  const statusRuns = () => runs.filter(run => run === 'status /repo').length
  const before = statusRuns()
  await clock.advance(3_000)
  expect(statusRuns()).toBe(before)
  repos.statuses['/repo'] = '## main\0'
  await $.tool.call({ tool: 'Bash', command: 'git commit -am x' })
  await clock.advance(3_000)
  expect(statusRuns()).toBe(before + 1)
  expect(await pane.find({ text: /repo · main · clean/ })).toBeDefined()
  expect(titles.at(-1)).toBe('Tasks · Δ1')
})

test('a worktree removed while the session works leaves the Changes view, with no warning and no git run in it', async ($, on) => {
  const { clock, disk, runs, titles } = await start(on, {}, { roots: { '/work': '/work' }, statuses: { '/work': REPO_STATUS } })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.settle()
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  await pane.press({ key: 'changes' })
  expect(await pane.find({ text: /work · pane-v2 · 3 changed/ })).toBeDefined()

  for (const path of ['/work/.git', '/work/.keep']) disk.remove(path)
  const before = runs.length
  await clock.advance(60_000)
  expect(runs.length).toBe(before)
  expect(await pane.find({ text: /No git repo yet/ })).toBeDefined()
  expect(await pane.find({ text: /WARN|detached/ })).toBeUndefined()
  expect(titles.at(-1)).toBe('Tasks')
})

test('after a hot reload that reads the drawn changes as an older shape, the repos the session found stay listed', async ($, on) => {
  const repos: FakeRepos = { roots: { '/repo/src': '/repo' }, statuses: { '/repo': ['## main', ' M src/a.ts', ''].join(' ') } }
  const { clock } = await start(on, {}, repos)
  on('tool.call', { tool: 'Edit' }, async () => ({ result: 'edited' }))
  // A version that bumps CHANGES_SHAPE reads what the older pane drew as absent.
  let isOlderShape = false
  on('state.get', async ($, e, next) => {
    const answer = await next(e)
    if (!isOlderShape || e.key !== 'changes' || answer.value === undefined) return answer
    return { value: { ...answer.value, value: { shape: 'changes-v1', value: { repos: [], outside: [] } } } }
  })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/a.ts', old_string: 'a', new_string: 'b' })
  await clock.advance(3_000)

  isOlderShape = true
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  isOlderShape = false
  await clock.settle()
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  await pane.press({ key: 'changes' })

  expect(await pane.find({ text: /repo · main · 1 changed/ })).toBeDefined()
  expect(await pane.find({ text: /No git repo yet/ })).toBeUndefined()
})

test('from the minimized strip, Changes opens the pane in full on the Changes view', async ($, on) => {
  const { clock, store } = await start(on, { paneSize: 'minimized' })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.settle()
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })

  await pane.press({ key: 'changes' })
  expect(store.get('paneSize')).toBe('open')
  expect(await pane.find({ text: /No git repo yet/ })).toBeDefined()
  expect(buttonKeys(await pane.drawn())).toEqual(['tasks', 'changes'])
})

test('with Claude Code new enough and git there, it draws no requirement line and runs git --version once', async ($, on) => {
  const { clock, runs } = await start(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.settle()
  await clock.advance(60_000)
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })

  expect(await pane.find({ text: /WARN/ })).toBeUndefined()
  expect(runs.filter(run => run.startsWith('--version'))).toEqual(['--version '])
})

test('on a Claude Code older than it needs, it says so above the tasks, with the fix', async ($, on) => {
  const { clock } = await start(on, {}, { roots: {}, statuses: {} }, REGISTER_ENV, { value: { version: '2.1.290', base: '2.1.290' } })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.settle()
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: WIDE })

  expect(await pane.find({ text: /WARN Claude Code 2\.1\.290 is older than teamrig-pane needs \(2\.1\.295 or later\): run claude update, then restart Claude Code\./ })).toBeDefined()
  expect(await pane.find({ text: /Ship the task pane/ })).toBeDefined()
})

test('with no git to start, it says so in both views, and the Changes view neither waits on git nor blames the folder', async ($, on) => {
  const { clock } = await start(on, {}, { roots: {}, statuses: {}, isMissing: true })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.settle()
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })

  expect(await pane.find({ text: /WARN git could not be started/ })).toBeDefined()
  expect(await pane.find({ text: /ENOENT/ })).toBeDefined()
  expect(await pane.find({ text: /git-scm\.com/ })).toBeDefined()
  expect(await pane.find({ text: /Ship the task pane/ })).toBeDefined()

  await pane.press({ key: 'changes' })
  expect(await pane.find({ text: /WARN git could not be started/ })).toBeDefined()
  expect(await pane.find({ text: /Reading git|No git repo yet/ })).toBeUndefined()
})

test('when the engine gives no version, a short line says the check failed, and the pane works on', async ($, on) => {
  const { clock } = await start(on, {}, { roots: {}, statuses: {} }, REGISTER_ENV, { deny: 'no version here' })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.settle()
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: WIDE })

  expect(await pane.find({ text: /WARN The teamrig-pane check for Claude Code failed \(.*no version here\)\./ })).toBeDefined()
  expect(await pane.find({ text: /older than|could not be started/ })).toBeUndefined()
  expect(await pane.find({ text: /Ship the task pane/ })).toBeDefined()
})

/** The key of the press on `id` the drawing holds: one, in an open card or a page. */
function gotoKey(node: unknown, id: string): string {
  const keys = buttonKeys(node).filter(key => key.startsWith(`goto:${id}:`))
  if (keys.length !== 1) throw new Error(`${keys.length} presses on ${id}`)
  return keys[0] ?? ''
}

/** The key of the press on a reference file the drawing holds: one, in an open card or a page. */
function fileKey(node: unknown): string {
  const keys = buttonKeys(node).filter(key => key.startsWith('goto:file:'))
  if (keys.length !== 1) throw new Error(`${keys.length} presses on a reference file`)
  return keys[0] ?? ''
}

function typeOf(node: unknown): unknown {
  return typeof node === 'object' && node !== null && 'type' in node ? node.type : null
}

/** A drawn element's number prop `name`; 0 when it has none. */
function numberProp(props: object | null, name: string): number {
  const value = props === null ? undefined : Object.entries(props).find(([key]) => key === name)?.[1]
  return typeof value === 'number' ? value : 0
}

/**
 * A drawn tree as the lines it reads as, unstyled and unwrapped: a Text's children run on, a row Box's children
 * stand side by side (its columnGap between), a column Box's one under another (its gap blank lines between), a
 * labelled Button is its label, paddingX indents. Trailing blanks are cut.
 */
function screenOf(node: unknown): string[] {
  if (typeof node === 'string') return node.split('\n')
  const props = propsOf(node)
  if (typeOf(node) === 'Button' && props !== null && 'label' in props && typeof props.label === 'string') return [props.label]
  const parts = childrenOf(node)
    .filter(child => typeof child === 'string' || (typeof child === 'object' && child !== null))
    .map(screenOf)
  if (typeOf(node) !== 'Box') return parts.map(lines => lines.join('\n')).join('').split('\n')
  const pad = ' '.repeat(numberProp(props, 'paddingX'))
  if (props !== null && 'flexDirection' in props && props.flexDirection === 'row') {
    const gap = ' '.repeat(numberProp(props, 'columnGap'))
    const widths = parts.map(lines => Math.max(...lines.map(cells)))
    const height = Math.max(0, ...parts.map(lines => lines.length))
    const rows = Array.from({ length: height }, (_, i) => parts.map((lines, j) => (lines[i] ?? '').padEnd(widths[j] ?? 0)).join(gap))
    return rows.map(row => `${pad}${row}`.trimEnd())
  }
  const blank = Array.from({ length: numberProp(props, 'gap') }, () => '')
  return parts.flatMap((lines, i) => (i === 0 ? lines : [...blank, ...lines])).map(line => (line === '' ? '' : `${pad}${line}`.trimEnd()))
}

/** T52 in po's list, planned after T50, itself after T58: a chain of ids to follow. */
const CHAIN = [
  createLine('T52', { owner: 'po', by: 'lead', at: NOW - HOUR, title: 'Draw the pages', taskKeys: { after: ['T50'] } }),
  createLine('T50', { owner: 'etl', by: 'lead', at: NOW - HOUR, title: 'Load the feed', taskKeys: { after: ['T58'] } }),
  createLine('T58', { owner: 'etl', by: 'lead', at: NOW - 72 * HOUR, title: 'Read the source' }),
]

test("a task id in an open card opens that task's page: its title and card alone, under back, forward and a trail", async ($, on) => {
  const { disk } = await start(on)
  disk.write(EVENTS, CHAIN)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  await pane.press({ key: 'next:T52' })
  let drawn = await pane.drawn()
  expect(keyedNode(drawn, 'page-head')).toBe(null)
  const toT50 = gotoKey(drawn, 'T50')
  expect(keyedProps(drawn, toT50)).toMatchObject({ plain: true })
  expect(childrenOf(keyedNode(drawn, toT50))).toMatchObject([{ type: 'Text', props: { underline: true }, children: ['T50'] }])

  await pane.press({ key: toT50 })
  drawn = await pane.drawn()
  // No status bar and no collapse on a page: the bar counts the list, and the page holds no card to collapse. Its card
  // names T58, planned first, T52, of another owner, which needs it, and the file it references.
  expect(buttonKeys(drawn)).toEqual([
    'tasks',
    'changes',
    'find-key',
    'mine',
    'all',
    'archive',
    'back',
    'crumb:0',
    gotoKey(drawn, 'T58'),
    gotoKey(drawn, 'T52'),
    fileKey(drawn),
  ])
  expect(keyedProps(drawn, 'back')).toMatchObject({ label: '‹ back', hotkey: 'b', variant: 'secondary' })
  // Nowhere to go draws the step as dim words, no press.
  expect(await pane.find({ type: 'Text', text: 'forward ›' })).toMatchObject({ props: { dimColor: true } })

  await pane.press({ key: gotoKey(drawn, 'T58') })
  expect(screenOf(await pane.drawn())).toEqual([
    ' Tasks Changes',
    ' Find',
    ' Keys go to Claude · click the field to search',
    ' mine all archive',
    '',
    ' ‹ back  forward ›',
    ' Tasks › T50 › T58',
    ` ${'─'.repeat(PANE_PROPS.bodyColumns - 2)}`,
    '',
    ' ○ T58  Read the source',
    ' Status       not started since Sat 10-10 by lead',
    ' Priority     3',
    ' Week         Tue 10-13',
    ' Goal         G10.2',
    ' From         owner',
    ' Added        Sat 10-10 by lead',
    ' Owner        etl',
    ' Reference    docs/x.md',
  ])
})

test('back, forward and the trail step through the places; the list keeps the head while a page lies ahead, and Tasks clears it', async ($, on) => {
  const { disk } = await start(on)
  disk.write(EVENTS, CHAIN)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  await pane.press({ key: 'next:T52' })
  await pane.press({ key: gotoKey(await pane.drawn(), 'T50') })
  await pane.press({ key: gotoKey(await pane.drawn(), 'T58') })

  await pane.press({ key: 'back' })
  let drawn = await pane.drawn()
  expect(await pane.find({ type: 'Text', text: /^○ T50  Load the feed$/ })).toBeDefined()
  expect(keyedProps(drawn, 'forward')).toMatchObject({ label: 'forward ›', hotkey: 'f' })
  expect(keyedNode(drawn, 'crumb:2')).toMatchObject({ type: 'Button', children: [{ type: 'Text', props: { underline: true, dimColor: true }, children: ['T58'] }] })
  expect(childrenOf(keyedNode(drawn, 'trail'))).toMatchObject([
    { type: 'Button' },
    { type: 'Text', props: { dimColor: true }, children: [' › '] },
    { type: 'Text', props: { bold: true }, children: ['T50'] },
    { type: 'Text', props: { dimColor: true }, children: [' › '] },
    { type: 'Button' },
  ])

  await pane.press({ key: 'forward' })
  expect(await pane.find({ type: 'Text', text: /^○ T58  Read the source$/ })).toBeDefined()
  await pane.press({ key: 'crumb:1' })
  expect(await pane.find({ type: 'Text', text: /^○ T50  Load the feed$/ })).toBeDefined()

  // The Tasks crumb: the list, its bar and T52's card as they were, back dim and forward a press away.
  await pane.press({ key: 'crumb:0' })
  drawn = await pane.drawn()
  expect(buttonKeys(drawn)).toEqual([
    'tasks',
    'changes',
    'find-key',
    'mine',
    'all',
    'archive',
    'collapse',
    'forward',
    'crumb:1',
    'crumb:2',
    'bar:not-started',
    'count:not-started',
    'next:T52',
    gotoKey(drawn, 'T50'),
    fileKey(drawn),
  ])
  expect(await pane.find({ type: 'Text', text: '‹ back' })).toMatchObject({ props: { dimColor: true } })
  expect(screenOf(keyedNode(drawn, 'trail'))).toEqual(['Tasks › T50 › T58'])

  await pane.press({ key: 'forward' })
  expect(await pane.find({ type: 'Text', text: /^○ T50  Load the feed$/ })).toBeDefined()
  await pane.press({ key: 'tasks' })
  drawn = await pane.drawn()
  expect(keyedNode(drawn, 'page-head')).toBe(null)
  expect(buttonKeys(drawn)).toContain('next:T52')
})

test('mine and all show the list alone; inline no page shows; a page whose task closed over 8 days ago says so', async ($, on) => {
  const { disk, clock } = await start(on)
  disk.write(EVENTS, CHAIN)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  await pane.press({ key: 'next:T52' })
  await pane.press({ key: gotoKey(await pane.drawn(), 'T50') })
  await pane.press({ key: 'all' })
  expect(keyedNode(await pane.drawn(), 'page-head')).toBe(null)
  expect(await pane.find({ type: 'Text', text: /^○ T50  Load the feed/ })).toBeDefined()
  await pane.press({ key: 'mine' })
  expect(keyedNode(await pane.drawn(), 'page-head')).toBe(null)

  await pane.press({ key: gotoKey(await pane.drawn(), 'T50') })
  await pane.redraw({ ...PANE_PROPS, placement: 'inline' })
  expect(keyedNode(await pane.drawn(), 'page-head')).toBe(null)
  expect(buttonKeys(await pane.drawn()).filter(key => key.startsWith('goto:'))).toEqual([])
  await pane.redraw(PANE_PROPS)
  expect(keyedNode(await pane.drawn(), 'page-head')).not.toBe(null)

  await pane.press({ key: gotoKey(await pane.drawn(), 'T58') })
  disk.write(EVENTS, [...CHAIN, statusLine('T58', 'etl', NOW - 9 * 24 * HOUR, 'done')])
  await clock.advance(3_000)
  expect(await pane.find({ type: 'Text', text: /^T58 left the pane's tasks: it closed over 8[ \n]days[ \n]ago\.$/ })).toMatchObject({
    children: [{ props: { dimColor: true } }, '\n', { props: { dimColor: true } }],
  })
  await pane.press({ key: 'back' })
  // T50's page names T58 no more as a press: the snapshot no longer holds it. T52, which needs T50, still is one.
  const onT50 = await pane.drawn()
  expect(buttonKeys(onT50).filter(key => key.startsWith('goto:'))).toEqual([gotoKey(onT50, 'T52'), fileKey(onT50)])
})

test("a reference file in an open card opens as a page: its name, where it was read and its text, under back and the trail; back returns to the card", async ($, on) => {
  const { disk } = await start(on)
  disk.write(EVENTS, CHAIN)
  disk.write('/work/docs/x.md', ['# Pages', '', 'Draw each task as a page,', '\tits card alone.'])
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  await pane.press({ key: 'next:T52' })
  let drawn = await pane.drawn()
  const toFile = fileKey(drawn)
  expect(keyedProps(drawn, toFile)).toMatchObject({ plain: true })
  expect(childrenOf(keyedNode(drawn, toFile))).toMatchObject([{ type: 'Text', props: { underline: true }, children: ['docs/x.md'] }])

  await pane.press({ key: toFile })
  expect(screenOf(await pane.drawn())).toEqual([
    ' Tasks Changes',
    ' Find',
    ' Keys go to Claude · click the field to search',
    ' mine all archive',
    '',
    ' ‹ back  forward ›',
    ' Tasks › x.md',
    ` ${'─'.repeat(PANE_PROPS.bodyColumns - 2)}`,
    '',
    ' docs/x.md',
    ' /work/docs/x.md',
    '',
    ' # Pages',
    '',
    ' Draw each task as a page,',
    '   its card alone.',
  ])

  // Back on the list, the head stays while forward returns to the file.
  await pane.press({ key: 'back' })
  drawn = await pane.drawn()
  expect(buttonKeys(keyedNode(drawn, 'page-head'))).toContain('forward')
  expect(buttonKeys(drawn)).toContain(fileKey(drawn))
})

test("a reference file's line: its page lands on the paragraph that holds it, the line bold; a file not found lists where it was looked for", async ($, on) => {
  const { disk } = await start(on)
  disk.write(EVENTS, [createLine('T1', { owner: 'po', by: 'lead', at: NOW - HOUR, title: 'Read the long brief', ref: 'docs/long.md:300; docs/gone.md' })])
  disk.write('/work/docs/long.md', Array.from({ length: 400 }, (_, i) => `brief line ${i + 1}`))
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  await pane.press({ key: 'next:T1' })
  const [toLong] = buttonKeys(await pane.drawn()).filter(key => key.startsWith('goto:file:'))
  if (toLong === undefined) throw new Error('no press on docs/long.md')

  await pane.press({ key: toLong })
  // 400 lines with no blank line split every 50: line 300 sits in the block from line 251, drawn though far below
  // the window's top, as the step lands there, in a Box under its key: a Text keeps none for `$.ui.scroll` to find.
  // The kit has no implementation of a plugin's own scroll (it throws before any ui.scroll hook), so the move
  // itself is the engine's; what the test holds is that its target is drawn. The paragraphs it does not land on
  // stay Texts, keyless.
  const drawn = await pane.drawn()
  expect(propsOf(keyedNode(drawn, 'file-page:para:251'))).toMatchObject({ key: 'file-page:para:251' })
  expect(keyedNode(drawn, 'file-page:para:1')).toBeNull()
  expect(await pane.find({ type: 'Text', text: /^brief line 300\n?$/ })).toMatchObject({ props: { bold: true } })

  await pane.press({ key: 'back' })
  const toGone = buttonKeys(await pane.drawn()).filter(key => key.startsWith('goto:file:'))[1]
  if (toGone === undefined) throw new Error('no press on docs/gone.md')
  await pane.press({ key: toGone })
  const screen = screenOf(await pane.drawn())
  expect(screen).toContain(' Not found. Looked for it at:')
  expect(screen).toContain(' /work/docs/gone.md')
})

test('the dock always draws the Find field, s moving the focus into it; each change draws the matches, Enter opens the top one, back returns, clear or an empty field closes the search', async ($, on) => {
  const { disk } = await start(on)
  disk.write(EVENTS, CHAIN)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  let drawn = await pane.drawn()
  // On the list, empty, under the switch; it never takes the focus by itself, so the pane's hotkeys stay live.
  expect(keyedProps(drawn, 'find')).toMatchObject({ placeholder: 'id, title, owner, note…', value: '', submitLabel: 'open' })
  expect('autoFocus' in (keyedProps(drawn, 'find') ?? {})).toBe(false)
  expect(keyedProps(drawn, 'find-key')).toMatchObject({ label: 'Find', plain: true, hotkey: 's' })
  expect(buttonKeys(drawn)).not.toContain('clear')
  expect(buttonKeys(drawn)).toContain('next:T52')
  // s reaches the Find label. Its move of the ring into the field ($.ui.focus), as Enter's and clear's below, is refused
  // here: the kit answers no plugin's own move, so the test of the line under the field raises those landings itself.
  expect(await pane.press({ key: 'find-key' })).toMatchObject({ element: 'find-key' })

  await pane.input({ key: 'find', text: 'etl the', kind: 'change' })
  drawn = await pane.drawn()
  // Typing never draws the field again: the same key, the same empty text, so the engine keeps every key typed in it.
  expect(drawnField(drawn)).toEqual({ key: 'find', value: '' })
  // The active matches in plan order, each a press with a dim line of whose it is; the Find field draws no words.
  expect(screenOf(drawn)).toEqual([
    ' Tasks Changes',
    ' Find  clear',
    ' Keys go to Claude · click the field to search',
    ' mine all archive',
    '',
    ' ○ T50  Load the feed\n       on etl',
    '',
    ' ○ T58  Read the source\n       on etl',
  ])
  // The words that matched underlined: `the` in the title, `etl` in the dim line of whose it is.
  expect(childrenOf(keyedNode(drawn, 'search:T50'))).toEqual([
    {
      type: 'Text',
      props: { wrap: 'wrap' },
      children: [
        '○ ',
        { type: 'Text', props: { bold: true }, children: ['T50'] },
        '  Load ',
        { type: 'Text', props: { underline: true }, children: ['the'] },
        ' feed\n       ',
        { type: 'Text', props: { dimColor: true }, children: ['on '] },
        { type: 'Text', props: { dimColor: true, underline: true }, children: ['etl'] },
      ],
    },
  ])

  // Enter: the top result's page.
  await pane.input({ key: 'find', text: 'etl the' })
  drawn = await pane.drawn()
  expect(await pane.find({ type: 'Text', text: /^○ T50  Load the feed$/ })).toBeDefined()
  expect(keyedNode(drawn, 'page-head')).not.toBe(null)
  // A page draws a fresh field, empty: typing there opens a search past the page.
  expect(drawnField(drawn)).toEqual({ key: 'find:1', value: '' })

  await pane.press({ key: 'back' })
  drawn = await pane.drawn()
  // Back on the search, a fresh field holding its words.
  expect(drawnField(drawn)).toEqual({ key: 'find:2', value: 'etl the' })
  expect(screenOf(keyedNode(drawn, 'trail'))).toEqual(['Tasks › Search "etl the" › T50'])
  await pane.press({ key: 'search:T58' })
  expect(await pane.find({ type: 'Text', text: /^○ T58  Read the source$/ })).toBeDefined()
  await pane.press({ key: 'back' })
  expect(drawnField(await pane.drawn())).toEqual({ key: 'find:4', value: 'etl the' })

  await pane.press({ key: 'clear' })
  drawn = await pane.drawn()
  expect(drawnField(drawn)).toEqual({ key: 'find:5', value: '' })
  expect(buttonKeys(drawn)).not.toContain('clear')
  expect(buttonKeys(drawn)).toContain('next:T52')

  await pane.input({ key: 'find:5', text: 'nothing-here', kind: 'change' })
  expect(await pane.find({ type: 'Text', text: /^Nothing matches./ })).toBeDefined()
  await pane.input({ key: 'find:5', text: '', kind: 'change' })
  drawn = await pane.drawn()
  expect(drawnField(drawn)).toEqual({ key: 'find:5', value: '' })
  expect(buttonKeys(drawn)).toContain('next:T52')

  // mine or all from a search shows the list alone, under a fresh, empty field.
  await pane.input({ key: 'find:5', text: 'etl', kind: 'change' })
  await pane.press({ key: 'all' })
  drawn = await pane.drawn()
  expect(drawnField(drawn)).toEqual({ key: 'find:6', value: '' })
  expect(buttonKeys(drawn)).not.toContain('clear')

  // Inline, where no page shows, there is no field.
  await pane.redraw({ ...PANE_PROPS, placement: 'inline' })
  drawn = await pane.drawn()
  expect(keyedNode(drawn, 'find')).toBe(null)
  expect(buttonKeys(drawn)).not.toContain('find-key')
})

test('the Find field keeps its index among the focusable elements on the list, with a card open, in a search, on a page and on the Archive page, so the focus ring stays in it as the person types', async ($, on) => {
  const { disk } = await start(on)
  disk.write(EVENTS, CHAIN)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  const indexes = [fieldIndex(await pane.drawn())]
  // A card open shows collapse; the first key typed opens a search, which hides it and shows clear.
  await pane.press({ key: 'next:T52' })
  let drawn = await pane.drawn()
  expect(buttonKeys(drawn)).toContain('collapse')
  indexes.push(fieldIndex(drawn))
  await pane.input({ key: 'find', text: 'e', kind: 'change' })
  drawn = await pane.drawn()
  expect(buttonKeys(drawn)).not.toContain('collapse')
  expect(buttonKeys(drawn)).toContain('clear')
  indexes.push(fieldIndex(drawn))
  await pane.input({ key: 'find', text: 'etl' })
  drawn = await pane.drawn()
  expect(keyedNode(drawn, 'page-head')).not.toBe(null)
  indexes.push(fieldIndex(drawn))
  await pane.press({ key: 'archive' })
  drawn = await pane.drawn()
  expect(keyedNode(drawn, 'week-steps')).not.toBe(null)
  indexes.push(fieldIndex(drawn))
  // After Tasks, Changes and s: Find.
  expect(indexes).toEqual([3, 3, 3, 3, 3])
})

test("the line under the Find field says where the keys go: to Claude's prompt, to the pane, or typed into the search", async ($, on) => {
  const { disk } = await start(on)
  disk.write(EVENTS, CHAIN)
  // Beneath the plugin, the engine moves the focus ring, or keeps it while `refusal` is set.
  let refusal: string | null = null
  on('ui.focus', async () => (refusal === null ? {} : { deny: refusal }))
  const HELD = { ...PANE_PROPS, isFocused: true } as const
  /** The ring landing on the element keyed `element`: the person's Tab, arrow or click, or the plugin's own `$.ui.focus`. */
  const land = (element: string, origin: UiFocusInput['origin'] = { kind: 'person' }) =>
    $.ui.focus({ component: 'Pane', requestId: 'teamrig-pane', plugin: 'teamrig-pane', element, origin })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  /** The line under the Find field as drawn: its text, and whether it is bold (typing searches) or dim; null where none is. */
  const keysLine = async () => {
    const found = await pane.find({ type: 'Text', text: /^(Typing searches|Keys on the pane|Keys go to Claude) · / })
    if (found === undefined) return null
    // Drawn one way or the other, never both.
    expect(found.props['bold'] === true).toBe(found.props['dimColor'] !== true)
    return { text: found.text, bold: found.props['bold'] === true }
  }
  const CLAUDE = { text: 'Keys go to Claude · click the field to search', bold: false }
  const ON_PANE = { text: 'Keys on the pane · s: search · Esc: to Claude', bold: false }
  const SEARCH = { text: 'Typing searches · Enter: open · Esc: to Claude', bold: true }
  // The pane's own $.ui.focus, which the engine raises as ui.focus with this origin; the kit answers no plugin's own
  // move, so the test raises its landing as the engine would.
  const PLUGIN: UiFocusInput['origin'] = { kind: 'plugin', name: 'teamrig-pane' }
  // The pane without the keys: they go to Claude's prompt.
  expect(await keysLine()).toEqual(CLAUDE)
  // Given the keys, the ring on nothing: the pane's hotkeys answer.
  await pane.redraw(HELD)
  expect(await keysLine()).toEqual(ON_PANE)

  // s moves the ring into the field: typing searches, and still does once typed.
  await pane.press({ key: 'find-key' })
  expect(await land('find', PLUGIN)).toEqual({})
  expect(await keysLine()).toEqual(SEARCH)
  await pane.input({ key: 'find', text: 'etl', kind: 'change' })
  expect(await keysLine()).toEqual(SEARCH)
  // Tab on to a button: the pane's keys; back into the field: typing again.
  expect(await land('mine')).toEqual({})
  expect(await keysLine()).toEqual(ON_PANE)
  expect(await land('find')).toEqual({})
  expect(await keysLine()).toEqual(SEARCH)
  // A move the engine refused leaves the ring, and the line, where they were.
  refusal = 'the pane does not hold the keys'
  expect(await land('mine')).toEqual({ deny: refusal })
  expect(await keysLine()).toEqual(SEARCH)
  refusal = null

  // Esc, a click outside, a dialog or the prompt taking a key: the keys go to Claude, and the ring is cleared.
  await pane.redraw(PANE_PROPS)
  expect(await keysLine()).toEqual(CLAUDE)
  // Given back by a click on the pane's text, the ring on nothing: the field no longer holds the keys.
  await pane.redraw(HELD)
  expect(await keysLine()).toEqual(ON_PANE)
  // A click on the field lands the ring as it hands the pane the keys: typing searches again.
  await pane.redraw(PANE_PROPS)
  expect(await land('find')).toEqual({})
  expect(await keysLine()).toEqual(CLAUDE)
  await pane.redraw(HELD)
  expect(await keysLine()).toEqual(SEARCH)

  // Enter opens the top result's page and moves the ring onto its back step: the pane's keys, so b, f and s answer
  // rather than typing a new search into the page's fresh field.
  await pane.input({ key: 'find', text: 'etl' })
  expect(drawnField(await pane.drawn())).toEqual({ key: 'find:1', value: '' })
  expect(await land('back', PLUGIN)).toEqual({})
  expect(await keysLine()).toEqual(ON_PANE)
  // Back on the search, clear moves the ring back into the field, a new round's: typing searches.
  await pane.press({ key: 'back' })
  await pane.press({ key: 'clear' })
  expect(drawnField(await pane.drawn())).toEqual({ key: 'find:3', value: '' })
  expect(await land('find:3', PLUGIN)).toEqual({})
  expect(await keysLine()).toEqual(SEARCH)

  // Inline, where no field is drawn, no line either.
  await pane.redraw({ ...HELD, placement: 'inline' })
  expect(await keysLine()).toBe(null)
})

test('archive (h) opens the Archive page at the week of now; prev (p) and next (l) step weeks; a row opens its page; back returns', async ($, on) => {
  const { disk } = await start(on)
  disk.write(EVENTS, [
    ...CHAIN,
    createLine('T7', { owner: 'po', by: 'po', at: NOW - 120 * HOUR, title: 'Fix the loader' }),
    statusLine('T7', 'po', NOW - 2 * HOUR, 'done', 'fed the loader'),
    createLine('T9', { owner: 'po', by: 'po', at: NOW - 120 * HOUR, title: 'Feed the pages' }),
    statusLine('T9', 'po', NOW - 96 * HOUR, 'dropped', 'folded into the feed'),
  ])
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  expect(keyedProps(await pane.drawn(), 'archive')).toMatchObject({ label: 'archive', hotkey: 'h', variant: 'secondary' })

  await pane.press({ key: 'archive' })
  let drawn = await pane.drawn()
  expect(keyedProps(drawn, 'archive')).toMatchObject({ variant: 'primary' })
  expect(keyedProps(drawn, 'prev')).toMatchObject({ label: '‹ prev', hotkey: 'p' })
  // The newest week has no next: dim words, no press.
  expect(buttonKeys(drawn)).not.toContain('next')
  expect(await pane.find({ type: 'Text', text: /^next ›$/ })).toMatchObject({ props: { dimColor: true } })
  expect(screenOf(drawn)).toEqual([
    ' Tasks Changes',
    ' Find',
    ' Keys go to Claude · click the field to search',
    ' mine all archive',
    '',
    ' ‹ back  forward ›',
    ' Tasks › Archive 10-12',
    ` ${'─'.repeat(48)}`,
    '',
    ' ‹ prev  week of Mon 10-12  next ›',
    '',
    ' Archive · po · 1 done · 0 dropped',
    '',
    ' Tue 10-13',
    '',
    ' ✓ T7  Fix the loader                       12:00',
  ])

  // The week before: T9 dropped on Friday, and where the pane stops holding finished tasks.
  await pane.press({ key: 'prev' })
  drawn = await pane.drawn()
  expect(buttonKeys(drawn)).not.toContain('prev')
  expect(await pane.find({ type: 'Text', text: /^‹ prev$/ })).toMatchObject({ props: { dimColor: true } })
  expect(keyedProps(drawn, 'next')).toMatchObject({ label: 'next ›', hotkey: 'l' })
  expect(await pane.find({ type: 'Text', text: /^week of Mon 10-05$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^Fri 10-09$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^The pane holds tasks finished since Mon/ })).toBeDefined()

  // A row opens its task's page; back returns to the week it was opened from.
  await pane.press({ key: 'done-page:T9' })
  expect(await pane.find({ type: 'Text', text: /^✗ T9  Feed the pages$/ })).toBeDefined()
  await pane.press({ key: 'back' })
  expect(await pane.find({ type: 'Text', text: /^week of Mon 10-05$/ })).toBeDefined()

  await pane.press({ key: 'next' })
  expect(await pane.find({ type: 'Text', text: /^week of Mon 10-12$/ })).toBeDefined()
  // A step changes the week in place: back returns to the list.
  await pane.press({ key: 'back' })
  drawn = await pane.drawn()
  // The list keeps the head while the places ahead stay, the Archive page and T9's (forward returns to them).
  expect(screenOf(keyedNode(drawn, 'trail'))).toEqual(['Tasks › Archive 10-12 › T9'])
  expect(keyedNode(drawn, 'week-steps')).toBe(null)
  expect(buttonKeys(drawn)).toContain('next:T52')

  // Inline, where no page shows, there is no archive.
  await pane.redraw({ ...PANE_PROPS, placement: 'inline' })
  expect(buttonKeys(await pane.drawn())).not.toContain('archive')
})
