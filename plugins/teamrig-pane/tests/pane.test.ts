// The plugin through the engine: env, clock, store, session id and fs answered beneath it.
import type { AbovePromptProps, Answer, FsEntry, FsStat, On, SessionVersion, UiFocusInput, UiScrollInput } from 'claude-code'
import { expect, mock, test, type Mounted, type TestEngine } from 'claude-code/testing'
import { BANNER_FILL_KEY, BANNER_KEY, BANNER_OPEN_KEY, BANNER_OPEN_LABEL, NOTHING_CURRENT, PREVIOUS_ALL_KEY, PREVIOUS_ALL_LABEL, PREVIOUS_KEY, PREVIOUS_OPEN_KEY } from '../hooks/banner'
import { LABEL_CELLS } from '../hooks/card'
import { barKeys, KEY_GROUPS } from '../hooks/keys-page'
import { POLL_MS } from '../hooks/live'
import { cells } from '../hooks/width'
import { EVENT_VERSION, type HireRecord, type RetireRecord } from '../hooks/core/read/index'
import { HOUR, NOW, S1, S2, bigRegister, createLine, iso, markLine, statusLine, updateLine, verifyingLine, waitingLine } from './fixtures'
import { hire, retire } from './team-fixtures'

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
  /** What lies right under a folder: its files, and a folder for each deeper path; nothing there is ENOENT. */
  on('fs.list', async ($, e) => {
    const prefix = `${keyOf(e.path)}/`
    const entries = new Map<string, FsEntry>()
    for (const [path, file] of files) {
      if (!path.startsWith(prefix)) continue
      const [name = '', ...deeper] = path.slice(prefix.length).split('/')
      const entry: FsEntry =
        deeper.length > 0
          ? { name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false }
          : { name, kind: 'file', size: file.text.length, mtimeMs: file.mtimeMs, isLink: false }
      entries.set(name, entry)
    }
    return entries.size === 0 ? { deny: `ENOENT: ${e.path}` } : { value: [...entries.values()] }
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

/**
 * A person's scroll of the docked pane by `by` rows, sized as the engine sizes it: the pane's tree fills the engine's
 * 40 rows exactly, so the engine's own window has nowhere to move.
 */
function personScroll(by: number): UiScrollInput {
  return { component: 'Pane', requestId: 'teamrig-pane', offset: 0, by, bodyRows: 40, contentRows: 40, origin: { kind: 'person' } }
}

/** A dock wide enough that a requirement's WARN line is one drawn line, so a test can match all of it. */
/** `words` as a drawn row holds them: a docked pane may wrap between any two. */
const wrappable = (words: string) => new RegExp(words.replaceAll(' ', '\\s+'))
const WIDE = { ...PANE_PROPS, bodyColumns: 200 } as const
/**
 * WIDE with a window the whole Stats tab fits in: its Flow section open and the six sections after it run past WIDE's 40
 * rows, and a scroll bar beside the window would end each drawn line with its track.
 */
const STATS_PROPS = { ...WIDE, scroll: { offset: 0, bodyRows: 120 } } as const

/** An open card: its Status row first, its Origin row further down. */
const CARD = /^ {4}│ (Description|Status) [\s\S]*│ Origin /
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
  /** What the teamrig CLI (`node <main.js> <args>`) prints for its args; unset, a run of it fails as a missing script does. */
  teamrig?: (args: readonly string[]) => string
}

/**
 * Answers $.process.run as git over `repos`, a folder it does not know being outside any repo, and as the teamrig CLI
 * by `repos.teamrig`; `runs` lists each as `<command> <cwd>`, `git --version` as `--version `, a CLI run as
 * `teamrig <args>`.
 */
function fakeGit(on: On, repos: FakeRepos) {
  const runs: string[] = []
  const answer = (stdout: string, exitCode = 0, stderr = '') => ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })
  on('process.run', async ($, e) => {
    if (e.argv[0] === 'node') {
      const args = e.argv.slice(2)
      runs.push(`teamrig ${args.join(' ')}`)
      return repos.teamrig === undefined ? answer('', 1, 'Error: Cannot find module') : answer(repos.teamrig(args))
    }
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
 * sessions, `env` the environment the plugin reads (its TZ UTC unless `env` names one, so every time prints in UTC
 * whatever the machine's zone), `version` what `$.session.version()` answers. Each repo the git knows is on the disk: its
 * root's `.git`, and a file in each folder named in it (git never runs in a folder that is not there).
 */
async function start(
  on: On,
  kept: Readonly<Record<string, unknown>> = {},
  repos: FakeRepos = { roots: {}, statuses: {} },
  env: Readonly<Record<string, string>> = REGISTER_ENV,
  version: Answer<SessionVersion> = NEW_ENOUGH,
) {
  mock.env(on, { TZ: 'UTC', ...env })
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

  expect(keyedProps(await pane.drawn(), 'inbox')).toMatchObject({ label: 'Inbox (2)' })
  expect(keyedProps(await pane.drawn(), 'team')).toMatchObject({ label: 'Teams' })
  expect(await pane.find({ text: /Ship the task pane/ })).toBeDefined()
  expect(await pane.find({ text: wrappable('p2 · due Wed 10-14 · new · asked by owner') })).toBeDefined()
  expect(await pane.find({ text: /Rotate the local URI/ })).toBeUndefined()
})

test('the Teams button counts the cards waiting on the owner now, not those put off', async ($, on) => {
  const { disk } = await start(on)
  const card = { question: 'Ship it?', options: ['A: now', 'B: later'], recommend: 'A', byDefault: 'B', gate: 'product' }
  disk.write(EVENTS, [
    createLine('T1', { owner: 'po', by: 'lead', at: NOW - 2 * HOUR, title: 'Ship the tab?' }),
    waitingLine('T1', 'po', NOW - HOUR, [{ kind: 'decision', who: 'owner' }], null, card),
    createLine('T2', { owner: 'security', by: 'lead', at: NOW - 2 * HOUR, title: 'Rotate the key?' }),
    waitingLine('T2', 'security', NOW - HOUR, [{ kind: 'decision', who: 'owner' }], null, card),
    createLine('T3', { owner: 'po', by: 'lead', at: NOW - 2 * HOUR, title: 'Name the release?' }),
    waitingLine('T3', 'po', NOW - HOUR, [{ kind: 'decision', who: 'owner' }, { kind: 'time', at: '2026-10-20' }], null, card),
  ])
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })

  expect(keyedProps(await pane.drawn(), 'team')).toMatchObject({ label: 'Teams (2)' })
})

test('the all view lists every owner, a waiting task saying why', async ($, on) => {
  await start(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: WIDE })

  await pane.press({ key: 'all' })
  expect(await pane.find({ text: /Rotate the local URI/ })).toBeDefined()
  expect(await pane.find({ text: /p1 · waiting since 14:00 UTC: needs owner paste/ })).toBeDefined()
})

test('a press on a Tasks view heading folds its tasks away, ▸ marking it, and a second shows them; the fold holds across mine and all', async ($, on) => {
  await start(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: WIDE })

  await pane.press({ key: 'next' })
  expect(await pane.find({ text: /Ship the task pane/ })).toBeUndefined()
  expect(await drawsLine(pane, /^▸ Up next \(1\)$/)).toBe(true)
  // The all view keys its headings by owner: po's task shows there, and a press on security's heading folds its alone.
  await pane.press({ key: 'all' })
  expect(await pane.find({ text: /Ship the task pane/ })).toBeDefined()
  await pane.press({ key: 'owner:security' })
  expect(await pane.find({ text: /Rotate the local URI/ })).toBeUndefined()
  expect(await drawsLine(pane, /^▸ security · 1 active · 1 waiting$/)).toBe(true)
  await pane.press({ key: 'mine' })
  expect(await drawsLine(pane, /^▸ Up next \(1\)$/)).toBe(true)
  await pane.press({ key: 'next' })
  expect(await pane.find({ text: /Ship the task pane/ })).toBeDefined()
  expect(await drawsLine(pane, /^Up next \(1\)$/)).toBe(true)
})

test("with no team config, the session's TZ is the team's zone: every time prints on its clock, as teamrig's would", async ($, on) => {
  await start(on, {}, { roots: {}, statuses: {} }, { ...REGISTER_ENV, TZ: 'Asia/Jerusalem' })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: WIDE })

  await pane.press({ key: 'all' })
  expect(await pane.find({ text: /p1 · waiting since 17:00 IDT: needs owner paste/ })).toBeDefined()
})

test("the area's Tasks view leads with a bar of its tasks by status and their counts, what it asked of others waiting; the all and Changes views draw none", async ($, on) => {
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

  // T5, asked of security, is waiting, as its section is; T3, done on an earlier day, is left out.
  const segments = await pane.findAll({ type: 'Text', text: /^[█▓░]+$/ })
  expect(segments.map(found => found.text)).toEqual(['█'.repeat(12), '▓'.repeat(12), '█'.repeat(12), '░'.repeat(12)])
  expect(segments.map(found => found.props['color'])).toEqual(['success', 'success', 'error', undefined])
  for (const count of ['1 done today', '1 verifying', '1 waiting', '1 not started'])
    expect(await pane.find({ type: 'Text', text: count })).toBeDefined()
  expect(await pane.find({ text: /working/ })).toBeUndefined()
  // The bar ends the header, under the switch and above the tasks' window.
  const drawn = await pane.drawn()
  const headerKeys = childrenOf(keyedNode(drawn, 'header')).map(child => propsOf(child)).map(props => (props !== null && 'key' in props ? props.key : null))
  expect(headerKeys.indexOf('status-bar')).toBe(1)
  expect(headerKeys.at(-1)).toBe('status-bar')

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
  // Each count wears its section's glyph before its words, in the color the rows wear it in (status-bar.ts): the first
  // Text in the count's one Text (a Text keeps no key to find it by).
  const markOf = (key: string) => childrenOf(childrenOf(keyedNode(drawn, key))[0])[0]
  expect(propsOf(markOf('count:verifying'))).toMatchObject({ color: 'success' })
  expect(childrenOf(markOf('count:verifying'))).toEqual(['◑'])
  expect(propsOf(markOf('count:not-started'))).toMatchObject({ dimColor: true })
  const segment = keyedProps(drawn, 'bar:verifying')
  expect(segment).toMatchObject({ plain: true })
  expect(segment !== null && 'hotkey' in segment).toBe(false)
  expect(await pane.find({ text: /^showing/ })).toBeUndefined()

  await pane.press({ key: 'count:verifying' })
  expect(await listed()).toEqual([false, true])
  expect(await pane.find({ text: 'showing verifying only, click again for all' })).toBeDefined()
  expect(await pane.find({ text: /Verifying \(/ })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /^1 verifying$/ })).toMatchObject({ props: { bold: true } })

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
  expect(await pane.find({ type: 'Text', text: /^0 waiting$/ })).toMatchObject({ props: { bold: true } })
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
  expect(await pane.find({ type: 'Text', text: /^1 not started$/ })).toMatchObject({ props: { bold: false } })
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
    JSON.stringify({ v: EVENT_VERSION + 1, type: 'vote', id: 'T1', at: iso(NOW - HOUR / 2), by: 'etl', choice: 'ship' }),
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
  expect(await pane.find({ text: /^2 active/ })).toBeDefined()
})

test('missing register, marks and inbox files draw an empty register with no problem, and fill in as they appear', async ($, on) => {
  const { clock, disk } = await start(on)
  for (const path of [EVENTS, MARKS, INBOX]) disk.remove(path)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  expect(await pane.find({ text: /^This tab is not tied to a session/ })).toBeDefined()
  expect(await pane.find({ text: /\/teamrig-pane/ })).toBeDefined()
  expect(await pane.find({ text: /WARN/ })).toBeUndefined()

  disk.write(MARKS, [markLine('po', 1, S1, NOW, 'line one')])
  await clock.advance(3_000)
  expect(await pane.find({ text: /Nothing active\./ })).toBeDefined()
  expect(keyedProps(await pane.drawn(), 'inbox')).toMatchObject({ label: 'Inbox' })

  disk.write(EVENTS, [createLine('T1', { owner: 'po', by: 'lead', at: NOW - HOUR, title: 'Ship the task pane' })])
  disk.write(INBOX, ['line one', 'line two'])
  await clock.advance(3_000)
  expect(await pane.find({ text: /Ship the task pane/ })).toBeDefined()
  expect(keyedProps(await pane.drawn(), 'inbox')).toMatchObject({ label: 'Inbox (1)' })

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
  // The all view leads with the session's own group, the 408 of po; etl's T4082 sits past them, out of the window.
  expect(await pane.find({ text: /^po \(you\) · 408 active/ })).toBeDefined()
  // Measured on the dev host (2026-10-15, three runs): load 185-200 ms, a redraw 43-48 ms, the switch to all 36-40 ms.
  expect(loaded - started).toBeLessThan(1_500)
  expect(switched - loaded).toBeLessThan(1_000)
  expect(redrawn - loaded).toBeLessThan(500)

  const reads = disk.reads.length
  await clock.advance(3_000)
  expect(disk.reads.length).toBe(reads)
})

test("docked, a list of 2,000 tasks draws the words of only the tasks its window shows, each other task's press a stand-in under its key", async ($, on) => {
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
  // The window under the header, less than 40 rows, holds a few tasks from the list's first; the stand-ins hold no
  // words, so the tree holds no other task's text.
  const top = await numbers()
  expect(top).toContain(1)
  expect(top).not.toContain(2_000)
  expect(top.length).toBeLessThan(20)
  // Every task's press is drawn, in the window or as a stand-in, so the focus ring's indexes stay put as it moves.
  expect(buttonKeys(await pane.drawn()).filter(key => /^po:T\d+$/.test(key))).toHaveLength(2_000)
  // The person's page key moves the window down its rows, on from the last task it showed, the header put above it;
  // the presses stay 2,000. Back up, the window shows the first tasks again.
  const header = linesOf(keyedNode(await pane.drawn(), 'header'))
  expect(await $.ui.scroll(personScroll(40))).toEqual({})
  const paged = await numbers()
  expect(paged).not.toContain(1)
  expect(Math.min(...paged)).toBeGreaterThanOrEqual(Math.max(...top))
  expect(linesOf(keyedNode(await pane.drawn(), 'header'))).toEqual(header)
  expect(buttonKeys(await pane.drawn()).filter(key => /^po:T\d+$/.test(key))).toHaveLength(2_000)
  await $.ui.scroll(personScroll(-40))
  expect(await numbers()).toEqual(top)
})

test("a person's scroll moves the docked pane's own window and goes no further; a plugin's, or one inline or in a dock too narrow for the header to stay put, goes on to the engine", async ($, on) => {
  const { disk } = await start(on)
  const engine: UiScrollInput[] = []
  on('ui.scroll', async ($, e) => {
    engine.push(e)
    return {}
  })
  disk.write(
    EVENTS,
    Array.from({ length: 200 }, (_, i) => createLine(`T${i + 1}`, { owner: 'po', by: 'lead', at: NOW - HOUR, title: `Long list task ${i + 1}` })),
  )
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  await pane.press({ key: 'all' })
  await $.ui.scroll(personScroll(1))
  expect(engine).toEqual([])
  const moved: UiScrollInput = { ...personScroll(40), origin: { kind: 'plugin', name: 'other' } }
  await $.ui.scroll(moved)
  expect(engine).toEqual([moved])
  await pane.redraw({ ...PANE_PROPS, placement: 'inline' })
  await $.ui.scroll(personScroll(1))
  expect(engine).toEqual([moved, personScroll(1)])
  await pane.redraw({ ...PANE_PROPS, bodyColumns: 2 })
  await $.ui.scroll(personScroll(-1))
  expect(engine).toEqual([moved, personScroll(1), personScroll(-1)])
})

test('docked, the header and the body\'s window fill the rows the engine gives the pane, a scroll bar beside a body taller than its window', async ($, on) => {
  const { disk } = await start(on)
  disk.write(
    EVENTS,
    Array.from({ length: 200 }, (_, i) => createLine(`T${i + 1}`, { owner: 'po', by: 'lead', at: NOW - HOUR, title: `Long list task ${i + 1}` })),
  )
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  await pane.press({ key: 'all' })
  const drawn = await pane.drawn()
  // The header's rows are counted as the pane draws them: with the blank row under the header, the window takes the
  // rest of the 40, and the root, as tall as the engine's window, holds both.
  const headerRows = linesOf(keyedNode(drawn, 'header')).length
  const windowRows = linesOf(keyedNode(drawn, 'window')).length
  expect(headerRows + 1 + windowRows).toBe(PANE_PROPS.scroll.bodyRows)
  expect(linesOf(drawn)).toHaveLength(PANE_PROPS.scroll.bodyRows)
  // The bar runs the window's rows, its thumb at the top, its track dim below.
  const [, bar] = childrenOf(keyedNode(drawn, 'body'))
  const marks = linesOf(bar)
  expect(marks).toHaveLength(windowRows)
  expect(marks[0]).toBe('┃')
  expect(marks.at(-1)).toBe('│')
})

test("docked, a long list's first and last tasks are drawn wherever the window stands, so Tab and Shift+Tab wrap to its true ends", async ($, on) => {
  const { disk } = await start(on)
  disk.write(
    EVENTS,
    Array.from({ length: 2_000 }, (_, i) => createLine(`T${i + 1}`, { owner: 'po', by: 'lead', at: NOW - HOUR, title: `Long list task ${i + 1}` })),
  )
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  await pane.press({ key: 'all' })
  // The engine's focus ring runs over the drawing's focusable elements in order and wraps at its ends: Shift+Tab on its
  // first lands on its last, the list's last task's press; Tab on from the buttons and the Find field reaches its first.
  // So wherever the person scrolled the window: at the top, then 5 and 10 page keys down, where task 1 is out of sight.
  for (const pages of [0, 5, 5]) {
    for (let page = 0; page < pages; page += 1) await $.ui.scroll(personScroll(40))
    const ring = focusables(await pane.drawn()).map(element => element.key)
    expect(ring.find(key => /^po:T\d+$/.test(key))).toBe('po:T1')
    expect(ring.at(-1)).toBe('po:T2000')
  }
  const shown = (await pane.findAll({ type: 'Text', text: /Long list task \d+/ })).map(found => /Long list task (\d+)/.exec(found.text)?.[1])
  expect(shown.length).toBeGreaterThan(0)
  expect(shown).not.toContain('1')
})

test('docked, the focus ring landing on a press out of the window moves the window the least that shows it; a landing in view leaves the window where it is', async ($, on) => {
  const { disk } = await start(on)
  disk.write(
    EVENTS,
    Array.from({ length: 200 }, (_, i) => createLine(`T${i + 1}`, { owner: 'po', by: 'lead', at: NOW - HOUR, title: `Long list task ${i + 1}` })),
  )
  // Beneath the plugin, the engine moves the focus ring.
  on('ui.focus', async () => ({}))
  const land = (element: string) => $.ui.focus({ component: 'Pane', requestId: 'teamrig-pane', plugin: 'teamrig-pane', element, origin: { kind: 'person' } })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  await pane.press({ key: 'all' })
  const numbers = async () =>
    (await pane.findAll({ type: 'Text', text: /Long list task \d+/ })).map(found => Number(/Long list task (\d+)/.exec(found.text)?.[1]))
  const header = linesOf(keyedNode(await pane.drawn(), 'header'))
  const top = await numbers()
  expect(top).toContain(1)
  // Tab on from the last task the window shows lands on the next one's stand-in: the window moves down just enough
  // that it is the last task shown, the header put above it.
  const next = Math.max(...top) + 1
  expect(await land(`po:T${next}`)).toEqual({})
  const moved = await numbers()
  expect(Math.max(...moved)).toBe(next)
  expect(moved).not.toContain(1)
  expect(linesOf(keyedNode(await pane.drawn(), 'header'))).toEqual(header)
  // A landing on a task already in view, and one on a header button, keep the window still.
  await land(`po:T${Math.min(...moved)}`)
  expect(await numbers()).toEqual(moved)
  await land('all')
  expect(await numbers()).toEqual(moved)
  // Shift+Tab back onto task 1, its title above the window's top, moves the window up just enough that task 1 leads it
  // (the owner's heading above it stays out of view).
  await land('po:T1')
  const back = await numbers()
  expect(back[0]).toBe(1)
  expect(back).not.toContain(next + 1)
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

/**
 * The items on each row of the packed header part keyed `key` (a column Box of row Boxes), row by row: each by its
 * key, a Text, which keeps none, by its words.
 */
function rowItems(node: unknown, key: string): (string | null)[][] {
  const nameOf = (item: unknown): string | null => {
    const props = propsOf(item)
    if (props !== null && 'key' in props && typeof props.key === 'string') return props.key
    return typeOf(item) === 'Text' ? screenOf(item).join('\n') : null
  }
  return childrenOf(keyedNode(node, key)).map(row => childrenOf(row).map(nameOf))
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

/** The key a drawn element's props carry; null for none. */
function elementKey(props: object | null): unknown {
  return props !== null && 'key' in props ? props.key : null
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

  // The root is as tall as the engine's window and clips the body's window under the header (T860).
  expect((await pane.find({ type: 'Box' }))?.props).toMatchObject({ paddingLeft: 1, gap: 1, height: PANE_PROPS.scroll.bodyRows, overflow: 'hidden' })
  expect(propsOf(keyedNode(await pane.drawn(), 'header'))).toMatchObject({ paddingRight: 1 })
  const task = await pane.find({ type: 'Text', text: /Ship the task pane/ })
  expect(task?.text).toMatch(/^○ T1  .+\n {6}\S.+\n {6}Improvements · score \S+ · p3 · new ·\n {6}asked by owner$/)
  expect(task?.text.split('\n').every(line => line.length <= PANE_PROPS.bodyColumns - 2)).toBe(true)
  const cut = (await pane.find({ type: 'Text', text: /^○ T2 / }))?.text.split('\n') ?? []
  expect(cut.length).toBe(4)
  expect(cut[1]).toMatch(/^ {6}\S.*…$/)
  expect(cut.slice(2).join('\n')).toMatch(/^ {6}Improvements · score \S+ · p3 · new ·\n {6}asked by owner$/)
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

  const problem = await pane.find({ type: 'Text', text: /^WARN no register found/ })
  expect(problem?.text.split(/\s+/).join(' ')).toBe(
    "WARN no register found: set TEAMRIG_PANE_TASKS_DIR and TEAMRIG_PANE_INBOX_DIR, write them in /Homes/tester/.teamrig/pane.json, or start the session in a teamrig team's project (.teamrig.json)",
  )
  expect(await pane.find({ text: /Ship the task pane/ })).toBeUndefined()
  expect(disk.reads).toEqual([])
})

/** A drawn text's words, one space between each, as a wrapped line reads unwrapped. */
const unwrapped = (text: string | undefined) => text?.split(/\s+/).join(' ')
const SETUP_HEAD = /^teamrig is not set up for this project$/
/** The labels of every Button the pane draws: the switch, Find, the mode buttons and any press in the body. */
const buttonLabels = async (pane: Mounted<'Pane'>) => (await pane.findAll({ type: 'Button' })).map(found => found.props['label'])

test('in a project teamrig is not set up for, the pane shows how to set it up alone: no switch, Find, mode buttons, warning or area hint', async ($, on) => {
  const { disk } = await start(on, {}, { roots: {}, statuses: {} }, { USERPROFILE: HOME })
  disk.write('/Homes/tester/.teamrig/teams/web/config.json', ['{}'])
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: WIDE })

  expect(await pane.find({ text: SETUP_HEAD })).toBeDefined()
  expect(unwrapped((await pane.find({ text: /^Set up a team/ }))?.text)).toBe(
    'Set up a team: ask Claude here, or run /teamrig:team-setup. It proposes the sessions, then makes the team and ties this project to it.',
  )
  expect(await pane.find({ text: /Join a team|tasksDir|Install teamrig/ })).toBeUndefined()
  expect(await buttonLabels(pane)).toEqual([])
  expect(await pane.findAll({ type: 'Input' })).toEqual([])
  expect(await pane.find({ text: /^Keys on the pane/ })).toBeUndefined()
  expect(await pane.find({ text: /^WARN / })).toBeUndefined()
  expect(await pane.find({ text: /not tied to a session/ })).toBeUndefined()
  expect(disk.reads).toEqual([])
})

test('a pane left minimized in a project teamrig is not set up for keeps its switch, and a press on it opens the steps alone', async ($, on) => {
  await start(on, { paneSize: 'minimized' }, { roots: {}, statuses: {} }, { USERPROFILE: HOME })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: WIDE })
  expect(buttonKeys(await pane.drawn())).toEqual(['tasks', 'changes', 'log', 'inbox', 'team', 'meetings', 'stats'])

  await pane.press({ key: 'changes' })
  expect(await pane.find({ text: SETUP_HEAD })).toBeDefined()
  expect(await buttonLabels(pane)).toEqual([])
})

test('a project set up while the pane shows the steps lists its tasks at the next poll, with no restart', async ($, on) => {
  const { clock, disk } = await start(on, {}, { roots: {}, statuses: {} }, { USERPROFILE: HOME })
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: WIDE })
  expect(await pane.find({ text: SETUP_HEAD })).toBeDefined()

  // A pointer that names no team is a problem over the steps; the watch keeps looking.
  disk.write('/work/.teamrig.json', ['{"name": "web"}'])
  await clock.advance(POLL_MS)
  expect(unwrapped((await pane.find({ text: /^WARN / }))?.text)).toBe('WARN /work/.teamrig.json has no "team" text; expected {"team": "<id>"}')
  expect(await pane.find({ text: SETUP_HEAD })).toBeDefined()

  disk.write('/work/.teamrig.json', [JSON.stringify({ team: 'web' })])
  disk.write('/Homes/tester/.teamrig/teams/web/state/events.jsonl', [
    createLine('T7', { owner: 'web', by: 'lead', at: NOW - HOUR, title: 'Ship the team register' }),
  ])
  await clock.advance(POLL_MS)
  // With a team found, the switch, Find and the mode buttons are back.
  const labels = await buttonLabels(pane)
  for (const label of ['Tasks', 'Conversations', 'Find', 'mine', 'all', 'done ›', 'keys']) expect(labels).toContain(label)
  await pane.press({ key: 'all' })
  expect(await pane.find({ text: /Ship the team register/ })).toBeDefined()
  expect(await pane.find({ text: SETUP_HEAD })).toBeUndefined()
  expect(await pane.find({ text: /^WARN / })).toBeUndefined()
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
  expect(await pane.find({ type: 'Text', text: '[web] api (pinned)' })).toBeDefined()
  expect(await bannerText(await mountBand($))).toMatch(/^web-api · next ○ T7 {2}Ship the api/)

  await run('lead')
  expect(store.get(`pin:${S1}`)).toBe('lead')
  expect(await pane.find({ text: /^lead \(pinned\) · 0 active/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '[web] lead (pinned)' })).toBeDefined()
})

test("a tab tied to no session lists its team's sessions; a press on one ties the tab to it, as /teamrig-pane <session> does", async ($, on) => {
  const { disk, store } = await start(on, {}, { roots: {}, statuses: {} }, { USERPROFILE: HOME })
  const team = '/Homes/tester/.teamrig/teams/web'
  disk.write('/work/.teamrig.json', [JSON.stringify({ team: 'web' })])
  disk.write(`${team}/config.json`, [JSON.stringify({ sessions: ['lead', 'api'] })])
  disk.write(`${team}/state/events.jsonl`, [createLine('T7', { owner: 'api', by: 'lead', at: NOW - HOUR, title: 'Ship the api' })])
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: WIDE })

  expect(await drawsLine(pane, /^This tab is not tied to a session of team web yet\. Press the one this tab is:$/)).toBe(true)
  expect(await drawsLine(pane, /^lead {3}api$/)).toBe(true)
  expect(await drawsLine(pane, /^\(or \/teamrig-pane <session>\)$/)).toBe(true)
  const presses = buttonKeys(await pane.drawn()).filter(key => key.startsWith('pin:'))
  expect(presses.map(key => key.split(':')[1])).toEqual(['lead', 'api'])
  // The Inbox view, which needs a session too, lists them the same.
  await pane.press({ key: 'inbox' })
  expect(buttonKeys(await pane.drawn()).filter(key => key.startsWith('pin:')).map(key => key.split(':')[1])).toEqual(['lead', 'api'])
  await pane.press({ key: 'tasks' })

  const api = presses[1]
  if (api === undefined) throw new Error('no press on api')
  await pane.press({ key: api })
  expect(store.get(`pin:${S1}`)).toBe('api')
  expect(await pane.find({ text: /^api \(pinned\) · 1 active/ })).toBeDefined()
  expect(await pane.find({ text: /Ship the api/ })).toBeDefined()
  expect(buttonKeys(await pane.drawn()).some(key => key.startsWith('pin:'))).toBe(false)
})

test('a title line leads the docked tasks, Changes and Log views: the session as its tab title names it, [web] api; inline, none', async ($, on) => {
  const { disk } = await start(on, {}, { roots: {}, statuses: {} }, { USERPROFILE: HOME })
  disk.write('/work/.teamrig.json', [JSON.stringify({ team: 'web' })])
  disk.write('/Homes/tester/.teamrig/teams/web/config.json', [JSON.stringify({ sessions: ['lead', 'api'] })])
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  await $.command.run({ command: 'teamrig-pane', args: 'api', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })

  for (const view of ['changes', 'log', 'tasks']) {
    await pane.press({ key: view })
    const first = childrenOf(keyedNode(await pane.drawn(), 'controls'))[0]
    expect(typeOf(first)).toBe('Text')
    expect(screenOf(first)).toEqual(['[web] api (pinned)'])
  }
  // Above the prompt the band beside the pane names the session, so the pane spends no row of its few on it.
  await pane.redraw({ ...PANE_PROPS, placement: 'inline' })
  const inline = await pane.drawn()
  expect(childrenOf(keyedNode(inline, 'controls'))[0]).toBe(keyedNode(inline, 'switch'))
  expect(await pane.find({ text: /\[web\]/ })).toBeUndefined()
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

test('draws each collapsed task as one Text: no Box beyond the frame, the controls, the find row and the two packed button rows', async ($, on) => {
  await start(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })

  await pane.press({ key: 'all' })
  // The frame is the root, the header, the body's row and its window (T860); the switch and the mode buttons are
  // packed in code (pack.ts): each a column Box of one row Box a row: the switch two rows here, its Inbox (2) wrapping
  // Team under it, the mode buttons one.
  const drawn = await pane.drawn()
  expect(countType(drawn, 'Box')).toBe(11)
  // The list fits its window, so no scroll bar stands beside it.
  expect(childrenOf(keyedNode(drawn, 'body')).filter(child => child !== null)).toHaveLength(1)
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
  const collapsed = /^○ T1  Ship the task pane\n {6}Improvements · score \S+ · p3 · new · asked by owner$/
  expect(await pane.find({ type: 'Text', text: collapsed })).toBeDefined()
  expect(await pane.find({ text: /ship the pane with details/ })).toBeUndefined()
  const boxes = countType(await pane.drawn(), 'Box')

  await pane.press({ key: 'next:T1' })
  expect(await pane.find({ type: 'Text', text: /^○ T1  Ship the task pane$/ })).toBeDefined()
  expect(await pane.find({ text: /new · asked by owner/ })).toBeUndefined()
  expect((await pane.find({ type: 'Text', text: CARD }))?.text.split('\n')).toEqual([
    cardLine('Description', '2026-10-13 12:40 lead: ship the pane with details'),
    `${CARD_UNDER}G10.1g Fix the formula with analytics`,
    cardLine('Status', 'not started since 13:00 UTC by lead'),
    cardLine('Owner', 'po'),
    cardLine('Priority', '3'),
    cardLine('Class', 'Improvements'),
    cardLine('Score', '3.33'),
    cardLine('Planned', 'this week'),
    cardLine('Goal', 'G10.1g'),
    cardLine('Origin', 'Asked by owner, added by lead 13:00 UTC'),
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
  expect(await pane.find({ text: /^◐ T7  Ship the team register\n {6}Improvements · score \S+ · p2 · in progress since 13:30 UTC$/ })).toBeDefined()
  expect(await pane.find({ text: /correctness/ })).toBeUndefined()

  await pane.press({ key: 'web:T7' })
  expect((await pane.find({ type: 'Text', text: CARD }))?.text.split('\n')).toEqual([
    cardLine('Status', 'in progress since 13:30 UTC by web'),
    cardLine('Note', 'details drawn'),
    cardLine('Owner', 'web'),
    cardLine('Priority', '2'),
    cardLine('Class', 'Improvements'),
    cardLine('Score', '23.33'),
    cardLine('Planned', 'this week'),
    cardLine('Goal', 'G10.2'),
    `${CARD_UNDER}G15`,
    cardLine('Origin', 'Asked by owner, added by lead 13:00 UTC'),
  ])
  // The reference file, a press, draws on a row of its own, and the rows after it in a text of their own.
  const screen = screenOf(await pane.drawn())
  expect(screen).toContain(` ${cardLine('Reference', 'docs/x.md')}`)
  expect(screen).toContain(` ${cardLine('Evidence', 'abc1234')}`)
  expect(await pane.find({ text: /correctness/ })).toBeUndefined()
})

test('an open waiting card says since when it waits, its note on a row of its own; close cards (c) closes every card', async ($, on) => {
  await start(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: WIDE })
  await pane.press({ key: 'all' })
  expect(await pane.find({ text: /close cards/ })).toBeUndefined()
  expect(await pane.find({ text: /waiting since 14:00 UTC: needs owner paste/ })).toBeDefined()

  await pane.press({ key: 'security:T2' })
  await pane.press({ key: 'po:T1' })
  expect(await pane.find({ type: 'Text', text: /^ {4}│ Status {7}waiting since 14:00 UTC by security\n {4}│ Note {9}needs owner paste\n/ })).toBeDefined()
  expect(await pane.find({ text: /waiting since 14:00 UTC: needs owner paste/ })).toBeUndefined()
  // Each open card is a column Box, its reference file's line a row Box in it; the frame is four Boxes (the root, the
  // header, the body's row, its window); the switch and the mode buttons are packed in code (pack.ts), each a column
  // Box of one row Box here.
  expect(countType(await pane.drawn(), 'Box')).toBe(14)
  const closeCards = (await pane.findAll({ type: 'Button' })).find(found => found.props['label'] === 'close cards')
  expect(closeCards?.props).toMatchObject({ hotkey: 'c' })

  await pane.press({ key: 'close-cards' })
  expect(await pane.find({ text: /│ (Status|From)/ })).toBeUndefined()
  expect(await pane.find({ text: /waiting since 14:00 UTC: needs owner paste/ })).toBeDefined()
  expect(await pane.find({ text: /close cards/ })).toBeUndefined()
  expect(countType(await pane.drawn(), 'Box')).toBe(10)
})

test('the mode row draws its groups (the modes, the Done page, close cards, keys) a dim · between two on a row, none at a wrap', async ($, on) => {
  await start(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: WIDE })
  await pane.press({ key: 'all' })
  expect(rowItems(await pane.drawn(), 'modes')).toEqual([['mine', 'all', '·', 'done-page', '·', 'keys']])
  expect(await pane.find({ type: 'Text', text: /^·$/ })).toMatchObject({ props: { dimColor: true } })

  await pane.press({ key: 'security:T2' })
  expect(rowItems(await pane.drawn(), 'modes')).toEqual([['mine', 'all', '·', 'done-page', '·', 'close-cards', '·', 'keys']])
  // `[ mine ] [ all ] · [ done › ] · [ close cards ]` takes 47 of the 48 columns: `· [ keys ]` would run past them, so keys
  // starts the next row, with no `·` before it.
  await pane.redraw(PANE_PROPS)
  expect(rowItems(await pane.drawn(), 'modes')).toEqual([['mine', 'all', '·', 'done-page', '·', 'close-cards'], ['keys']])
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

  expect(await pane.find({ text: /│ Status|could not draw|close cards/ })).toBeUndefined()
  expect(await pane.find({ text: /p2 · due Wed 10-14 · new · asked by owner/ })).toBeDefined()
  isOldValueStored = false
  await pane.press({ key: 'next:T1' })
  expect(await pane.find({ text: /^ {4}│ Status {7}not started since 13:00 UTC by lead$/m })).toBeDefined()
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
  expect(buttonKeys(await pane.drawn())).toEqual(['tasks', 'changes', 'log', 'inbox', 'team', 'meetings', 'stats', 'find-key', 'mine', 'all', 'done-page', 'keys'])

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
    // The header alone is taller than the pane: no window of its own, the engine scrolls the pane as one.
    expect(keyedNode(await pane.drawn(), 'window')).toBe(null)
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

  // The mark follows a `·` on the switch's last row where the two fit there, and takes a row of its own where not:
  // in 48 columns `[ Teams ] [ Meetings ] [ Stats ]`, wrapped under Inbox (2), leaves it no room.
  const strips = [
    { props: PANE_PROPS, texts: ['minimized, press a view'] },
    { props: { ...PANE_PROPS, bodyColumns: 23 }, texts: ['minimized, press a view'] },
    { props: { ...PANE_PROPS, placement: 'inline' as const }, texts: ['minimized, press a view'] },
    { props: WIDE, texts: ['·', 'minimized, press a view'] },
  ]
  for (const { props, texts } of strips) {
    await pane.redraw(props)
    expect((await pane.findAll({ type: 'Text' })).map(found => found.text)).toEqual(texts)
    expect(buttonKeys(await pane.drawn())).toEqual(['tasks', 'changes', 'log', 'inbox', 'team', 'meetings', 'stats'])
  }
  // The strip counts the unread lines too.
  expect(keyedProps(await pane.drawn(), 'inbox')).toMatchObject({ label: 'Inbox (2)' })
  expect(await pane.find({ text: /Ship the task pane/ })).toBeUndefined()

  await pane.press({ key: 'tasks' })
  expect(await pane.find({ text: /Ship the task pane/ })).toBeDefined()
  expect(store.get('paneSize')).toBe('open')
})

test('minimized, the mark after the switch is a group of its own: a dim · before it on a shared row, none where it wraps', async ($, on) => {
  await start(on, { paneSize: 'minimized' })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: WIDE })

  const mark = 'minimized, press a view'
  expect(rowItems(await pane.drawn(), 'switch')).toEqual([['tasks', 'changes', 'log', 'inbox', 'team', 'meetings', 'stats', '·', mark]])
  expect(await pane.find({ type: 'Text', text: /^·$/ })).toMatchObject({ props: { dimColor: true } })
  expect(await pane.find({ type: 'Text', text: mark })).toMatchObject({ props: { dimColor: true } })
  // In 48 columns the mark fits beside no button of the wrapped `[ Inbox ] … [ Stats ]`: a row of its own.
  await pane.redraw(PANE_PROPS)
  expect(rowItems(await pane.drawn(), 'switch')).toEqual([
    ['tasks', 'changes', 'log'],
    ['inbox', 'team', 'meetings', 'stats'],
    [mark],
  ])
  // In 21 columns `· minimized, press a view` fits beside no button: the mark starts a row, with no `·` before it.
  await pane.redraw({ ...PANE_PROPS, bodyColumns: 23 })
  expect(rowItems(await pane.drawn(), 'switch')).toEqual([['tasks', 'changes'], ['log'], ['inbox'], ['team'], ['meetings'], ['stats'], [mark]])
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

  // Nothing in progress: the area's first open task, after a dim next, cut at one line; its press and the open button
  // beside it, neither with a hotkey, as a band's hotkey would answer a bare key typed in an empty prompt.
  expect(buttonKeys(await band.drawn())).toEqual([BANNER_KEY, BANNER_OPEN_KEY])
  const press = keyedProps(await band.drawn(), BANNER_KEY)
  expect(press).toMatchObject({ plain: true })
  expect(press !== null && 'hotkey' in press).toBe(false)
  const opens = keyedProps(await band.drawn(), BANNER_OPEN_KEY)
  expect(opens).toMatchObject({ label: BANNER_OPEN_LABEL, variant: 'secondary' })
  expect(opens !== null && 'hotkey' in opens).toBe(false)
  expect(await banner()).toMatch(/^po · next ○ T1 {2}Ship the task pane/)

  disk.write(EVENTS, [
    createLine('T1', { owner: 'po', by: 'lead', at: NOW - HOUR, priority: 2, title: 'Ship the task pane' }),
    statusLine('T1', 'po', NOW, 'in-progress', 'halfway'),
  ])
  await clock.advance(3_000)
  expect(await banner()).toMatch(/^po · ◐ T1 {2}Ship the task pane/)
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
  expect(await bannerText(band)).toMatch(/^po · next ○ T1 {2}Ship the task pane/)

  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  expect(buttonKeys(await pane.drawn())).toEqual(['tasks', 'changes', 'log', 'inbox', 'team', 'meetings', 'stats'])
  // The strip is the switch alone: the title comes back with the pane. In 48 columns the mark takes a row of its own.
  expect((await pane.findAll({ type: 'Text' })).map(found => found.text)).toEqual(['minimized, press a view'])
  await pane.press({ key: 'tasks' })
  const title = childrenOf(keyedNode(await pane.drawn(), 'controls'))[0]
  expect(typeOf(title)).toBe('Text')
  expect(screenOf(title)).toEqual(['po'])
  expect(buttonKeys(await pane.drawn())).not.toContain(BANNER_KEY)
  expect(await bannerText(band)).toMatch(/^po · next ○ T1 {2}Ship the task pane/)
})

test("the band's open button opens the pane, minimized or on another view, at the task's page; back shows the list at the task's row", async ($, on) => {
  const { disk, opened, store } = await start(on, { paneSize: 'minimized' })
  disk.write(EVENTS, [createLine('T1', { owner: 'po', by: 'lead', at: NOW - HOUR, title: 'Ship the task pane '.repeat(6).trim() })])
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  opened.length = 0
  const band = await mountBand($)
  // The banner is cut short of the button and the gap before it.
  const text = await bannerText(band)
  expect(text).not.toBeNull()
  expect(text?.length ?? 0).toBeLessThanOrEqual(BAND_PROPS.bodyColumns - `[ ${BANNER_OPEN_LABEL} ]`.length - 1)
  // The button ends the band's row, beside the engine's [-]: the Box around the banner takes the free columns.
  const row = await band.drawn()
  expect(childrenOf(row).map(child => elementKey(propsOf(child)))).toEqual([BANNER_FILL_KEY, BANNER_OPEN_KEY])
  expect(numberProp(keyedProps(row, BANNER_FILL_KEY), 'flexGrow')).toBe(1)
  expect(buttonKeys(keyedNode(row, BANNER_FILL_KEY))).toEqual([BANNER_KEY])

  await band.press({ key: BANNER_OPEN_KEY })
  expect(opened).toEqual(['teamrig-pane'])
  expect(store.get('paneSize')).toBe('open')
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  expect(buttonKeys(await pane.drawn())).toContain('back')
  expect(await pane.find({ type: 'Text', text: /^○ T1 {2}Ship the task pane/ })).toBeDefined()

  await pane.press({ key: 'back' })
  let drawn = await pane.drawn()
  expect(buttonKeys(drawn)).not.toContain('back')
  expect(keyedNode(drawn, 'next:T1')).not.toBe(null)

  // From another view the press shows the Tasks view at the page too.
  await pane.press({ key: 'log' })
  await band.press({ key: BANNER_OPEN_KEY })
  drawn = await pane.drawn()
  expect(buttonKeys(drawn)).toContain('back')
  expect(keyedProps(drawn, 'tasks')).toMatchObject({ variant: 'primary' })
})

test("over the banner the band names the area's previous conversation; its buttons open the pane at its page or at the list of conversations", async ($, on) => {
  const { clock, disk, opened } = await startWithLogs(on)
  disk.write('/Homes/tester/.teamrig/teams/web/config.json', [JSON.stringify({ sessions: ['lead', 'api'], turnLog: { keepHours: 2 } })])
  // The conversation Claude Code runs now (S1) began after api's /clear: the band names the one before it.
  const nowLine = (minutes: number, text: string) => JSON.stringify({ v: 1, at: iso(NOW - minutes * 60_000), kind: 'prompt', text, claude: S1 })
  disk.write(`${WEB_LOG}/api/2026-10-13T13.jsonl`, [
    turnLine(40, 'prompt', 'Ship the log view'),
    turnLine(39, 'reply', 'Shipped it'),
    turnLine(38, 'clear', 'context cleared (/clear)'),
    nowLine(1, 'Carry on'),
  ])
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  const run = (args: string) => $.command.run({ command: 'teamrig-pane', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
  await run('api')
  const band = await mountBand($)
  // Before the first poll the band is the banner's alone.
  expect(buttonKeys(await band.drawn())).toEqual([BANNER_KEY])

  await clock.advance(POLL_MS)
  const drawn = await band.drawn()
  expect(buttonKeys(drawn)).toEqual([PREVIOUS_OPEN_KEY, PREVIOUS_ALL_KEY, BANNER_KEY])
  expect(await band.find({ type: 'Text', text: /^previous · Ship the log view$/ })).toBeDefined()
  // Its title takes the free columns, so its buttons end the row; neither has a hotkey.
  const [previousRow] = childrenOf(drawn)
  expect(childrenOf(previousRow).map(child => elementKey(propsOf(child)))).toEqual([PREVIOUS_KEY, PREVIOUS_OPEN_KEY, PREVIOUS_ALL_KEY])
  expect(numberProp(keyedProps(drawn, PREVIOUS_KEY), 'flexGrow')).toBe(1)
  expect(keyedProps(drawn, PREVIOUS_OPEN_KEY)).toMatchObject({ label: BANNER_OPEN_LABEL, variant: 'secondary' })
  expect(keyedProps(drawn, PREVIOUS_ALL_KEY)).toMatchObject({ label: PREVIOUS_ALL_LABEL, variant: 'secondary' })
  for (const key of [PREVIOUS_OPEN_KEY, PREVIOUS_ALL_KEY]) expect('hotkey' in (keyedProps(drawn, key) ?? {})).toBe(false)

  // Its open button opens the pane at the conversation's page; back shows the list.
  opened.length = 0
  await band.press({ key: PREVIOUS_OPEN_KEY })
  expect(opened).toEqual(['teamrig-pane'])
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: WIDE })
  expect(await drawnLines(pane)).toContain('Conversations › Ship the log view')
  expect(keyedProps(await pane.drawn(), 'log')).toMatchObject({ variant: 'primary' })
  await pane.press({ key: 'back' })
  expect(buttonKeys(await pane.drawn())).toContain('log:conv:api:c-1')

  // From another view, all conversations shows the list.
  await pane.press({ key: 'tasks' })
  await band.press({ key: PREVIOUS_ALL_KEY })
  const list = buttonKeys(await pane.drawn())
  expect(list).toContain('log:conv:api:c-1')
  expect(list).not.toContain('back')
  expect(keyedProps(await pane.drawn(), 'log')).toMatchObject({ variant: 'primary' })

  // An area whose turn log holds only the conversation of now draws no previous row.
  disk.write(`${WEB_LOG}/lead/2026-10-13T13.jsonl`, [nowLine(5, 'Plan the day')])
  await run('lead')
  await clock.advance(POLL_MS)
  expect(buttonKeys(await band.drawn())).toEqual([BANNER_KEY])
  expect(await band.find({ type: 'Text', text: /^previous · / })).toBeUndefined()
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
  expect(await bannerText(band)).toMatch(/^po · next ○ T1 {2}Ship the task pane/)
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
  expect(await bannerText(band)).toBe(`po · ${NOTHING_CURRENT}`)
  // With nothing current there is no page to open: no open button.
  expect(buttonKeys(await band.drawn())).toEqual([BANNER_KEY])

  disk.write(EVENTS, [createLine('T1', { owner: 'po', by: 'lead', at: NOW - HOUR, title: 'Ship the task pane' })])
  await clock.advance(3_000)
  expect(await bannerText(band)).toMatch(/^po · next ○ T1 {2}Ship the task pane/)
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

test('the Tasks / Changes / Conversations / Inbox / Teams / Meetings / Stats switch leads the pane in every view, width and placement, wrapping rather than clipping', async ($, on) => {
  await start(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })

  for (const props of [PANE_PROPS, ...NARROW_AND_INLINE]) {
    await pane.redraw(props)
    const drawn = await pane.drawn()
    expect(buttonKeys(keyedNode(drawn, 'switch'))).toEqual(['tasks', 'changes', 'log', 'inbox', 'team', 'meetings', 'stats'])
    // Then the mode buttons, past the Find row the dock draws between them.
    expect(buttonKeys(drawn).filter(key => key !== 'find-key').slice(0, 9)).toEqual(['tasks', 'changes', 'log', 'inbox', 'team', 'meetings', 'stats', 'mine', 'all'])
    // Packed in code (pack.ts), a row Box a row: `[ Tasks ] [ Changes ] [ Conversations ]` takes 39 cells, one row
    // in a 50-column dock (48 inside its padding), `[ Inbox (2) ] [ Teams ] [ Meetings ] [ Stats ]` wrapping under them;
    // at 20 and 12 columns a row a button.
    const rows = childrenOf(keyedNode(drawn, 'switch')).map(row => buttonKeys(row))
    const narrowRows = [['tasks'], ['changes'], ['log'], ['inbox'], ['team'], ['meetings'], ['stats']]
    expect(rows).toEqual(props.bodyColumns === 50 ? [['tasks', 'changes', 'log'], ['inbox', 'team', 'meetings', 'stats']] : narrowRows)
  }
  await pane.redraw(PANE_PROPS)
  await pane.press({ key: 'changes' })
  for (const props of [PANE_PROPS, ...NARROW_AND_INLINE]) {
    await pane.redraw(props)
    // The Changes view has no modes: the switch alone, past the Find row the dock draws under it.
    expect(buttonKeys(await pane.drawn()).filter(key => key !== 'find-key')).toEqual(['tasks', 'changes', 'log', 'inbox', 'team', 'meetings', 'stats'])
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
  expect(titles).toEqual(['Tasks', 'Tasks · 3 changed'])
  expect(buttonLabel(await pane.drawn(), 'changes')).toBe('Changes 3')
  await pane.press({ key: 'changes' })
  expect(await pane.find({ text: /work · branch pane-v2 · 3 files/ })).toBeDefined()
  expect(await pane.find({ text: /changed {2}hooks\/a\.ts \+4 -1/ })).toBeDefined()
  // Too long for the dock's 50 columns, the rename's row goes on under its path.
  expect(await drawsLine(pane, /^renamed {2}hooks\/new\.ts \+2 -2 ← hooks\/old\.ts$/)).toBe(true)
  expect(await drawsLine(pane, /^\(staged\)$/)).toBe(true)
  expect(await pane.find({ text: /new {6}tests\/ \+9 \(not in git yet\)/ })).toBeDefined()
  // Only the first repo with a diff to open says a press opens one.
  expect(await pane.find({ text: 'click a file for its diff' })).toBeDefined()
  expect(await pane.find({ text: /Ship the task pane/ })).toBeUndefined()

  await pane.press({ key: 'tasks' })
  expect(await pane.find({ text: /Ship the task pane/ })).toBeDefined()
})

test("the Changes view's Find field draws the files it names; Enter on one opens its diff, and another view closes the search", async ($, on) => {
  const patch = ['diff --git a/hooks/a.ts b/hooks/a.ts', '--- a/hooks/a.ts', '+++ b/hooks/a.ts', '@@ -1,2 +1,2 @@', ' const x = 1', '-const y = 2', '+const y = 3', ''].join('\n')
  const repos: FakeRepos = { roots: { '/work': '/work' }, statuses: { '/work': REPO_STATUS }, numstats: { '/work': REPO_NUMSTAT }, greps: { '/work': REPO_GREP }, patches: { 'hooks/a.ts': patch } }
  const { clock } = await start(on, {}, repos)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: WIDE })
  await clock.settle()
  await pane.redraw(WIDE)
  const results = async () => buttonKeys(await pane.drawn()).filter(key => key.startsWith('changes-search:'))

  await pane.press({ key: 'changes' })
  expect(keyedProps(await pane.drawn(), 'find')).toMatchObject({ placeholder: 'path, repo, branch…', value: '' })
  await pane.input({ key: 'find', text: 'hooks', kind: 'change' })
  // The count, then the two files it names over their repo and branch; the list's repo header is not drawn.
  expect(await drawsLine(pane, /^2 files match$/)).toBe(true)
  expect(await drawsLine(pane, /^renamed {2}hooks\/new\.ts \+2 -2 ← hooks\/old\.ts \(staged\)$/)).toBe(true)
  expect(await drawsLine(pane, /^work · branch pane-v2$/)).toBe(true)
  expect(await drawsLine(pane, /3 files/)).toBe(false)
  expect(await results()).toEqual(['changes-search:/work:hooks/a.ts', 'changes-search:/work:hooks/new.ts'])
  expect(keyedProps(await pane.drawn(), 'find')).toMatchObject({ submitLabel: 'to the results' })
  // Enter on more matches opens no diff.
  await pane.input({ key: 'find', text: 'hooks' })
  await clock.settle()
  expect(await pane.find({ text: /-const y = 2/ })).toBeUndefined()

  // Enter on the one match opens its diff under it, and Enter again leaves it open.
  await pane.input({ key: 'find', text: 'a.ts', kind: 'change' })
  expect(await drawsLine(pane, /^1 file matches$/)).toBe(true)
  expect(keyedProps(await pane.drawn(), 'find')).toMatchObject({ submitLabel: 'open' })
  await pane.input({ key: 'find', text: 'a.ts' })
  await clock.settle()
  expect(await pane.find({ text: /-const y = 2/ })).toBeDefined()
  await pane.input({ key: 'find', text: 'a.ts' })
  await clock.settle()
  expect(await pane.find({ text: /-const y = 2/ })).toBeDefined()
  // A press on the result closes it.
  await pane.press({ key: 'changes-search:/work:hooks/a.ts' })
  await clock.settle()
  expect(await pane.find({ text: /-const y = 2/ })).toBeUndefined()

  // An untracked folder is found, with no diff to open.
  await pane.input({ key: 'find', text: 'tests', kind: 'change' })
  expect(await drawsLine(pane, /^new {6}tests\/ \+9 \(not in git yet\)$/)).toBe(true)
  expect(await results()).toEqual([])

  // Another view and back to Changes: the list, the search gone.
  await pane.press({ key: 'tasks' })
  await pane.press({ key: 'changes' })
  expect(await drawsLine(pane, /match/)).toBe(false)
  expect(await pane.find({ text: /work · branch pane-v2 · 3 files/ })).toBeDefined()
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
  expect(await pane.find({ text: /repo · branch main · 1 file/ })).toBeDefined()
  expect(await pane.find({ text: /written outside git \(1\)/ })).toBeDefined()
  expect(await pane.find({ text: /\/notes\/plan\.md/ })).toBeDefined()
  expect(await pane.find({ text: /bad\.ts/ })).toBeUndefined()
  expect(titles.at(-1)).toBe('Tasks · 2 changed')

  // A shell call (a commit, say) is read on the next poll; with nothing new, the poll runs no git.
  const statusRuns = () => runs.filter(run => run === 'status /repo').length
  const before = statusRuns()
  await clock.advance(3_000)
  expect(statusRuns()).toBe(before)
  repos.statuses['/repo'] = '## main\0'
  await $.tool.call({ tool: 'Bash', command: 'git commit -am x' })
  await clock.advance(3_000)
  expect(statusRuns()).toBe(before + 1)
  expect(await pane.find({ text: /repo · branch main · clean/ })).toBeDefined()
  expect(titles.at(-1)).toBe('Tasks · 1 changed')
})

test('a press on a file written outside git opens its diff against its copy from before the first write, and a second press closes it', async ($, on) => {
  const { clock, disk } = await start(on)
  on('tool.call', { tool: 'Write' }, async ($, e) => {
    disk.write(e.file_path, [e.content])
    return { result: 'written' }
  })
  disk.write('/notes/plan.md', ['old'])
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.settle()
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  await pane.press({ key: 'changes' })

  await $.tool.call({ tool: 'Write', file_path: '/notes/plan.md', content: 'new' })
  await clock.advance(3_000)
  expect(await pane.find({ text: /written outside git \(1\)/ })).toBeDefined()
  // The file's row is a press in the outside files' card: keyed by the card (`outside-open`) and the row.
  const file = 'diff:outside-open:outside:/notes/plan.md'
  await pane.press({ key: file })
  await clock.settle()
  expect(await pane.find({ text: /-old/ })).toBeDefined()
  expect(await pane.find({ text: /\+new/ })).toBeDefined()

  await pane.press({ key: file })
  await clock.settle()
  expect(await pane.find({ text: /[-+](old|new)/ })).toBeUndefined()
})

test('a worktree removed while the session works leaves the Changes view, with no warning and no git run in it', async ($, on) => {
  const { clock, disk, runs, titles } = await start(on, {}, { roots: { '/work': '/work' }, statuses: { '/work': REPO_STATUS } })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.settle()
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  await pane.press({ key: 'changes' })
  expect(await pane.find({ text: /work · branch pane-v2 · 3 files/ })).toBeDefined()

  for (const path of ['/work/.git', '/work/.keep']) disk.remove(path)
  const before = runs.length
  await clock.advance(60_000)
  expect(runs.length).toBe(before)
  expect(await pane.find({ text: /No git repo yet/ })).toBeDefined()
  expect(await pane.find({ text: /WARN|no branch/ })).toBeUndefined()
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

  expect(await pane.find({ text: /repo · branch main · 1 file/ })).toBeDefined()
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
  // The switch, then the Find row under it.
  expect(buttonKeys(await pane.drawn())).toEqual(['tasks', 'changes', 'log', 'inbox', 'team', 'meetings', 'stats', 'find-key'])
})

const WEB_LOG = '/Homes/tester/.teamrig/teams/web/state/turn-log'

/** A turn log line as teamrig writes it, `minutes` before NOW. */
function turnLine(minutes: number, kind: 'prompt' | 'reply' | 'clear', text: string): string {
  return JSON.stringify({ v: 1, at: iso(NOW - minutes * 60_000), kind, text, claude: 'c-1' })
}

/** Every line the pane draws, each Text split at its line ends. */
async function drawnLines(pane: Mounted<'Pane'>): Promise<string[]> {
  return (await pane.findAll({ type: 'Text' })).flatMap(found => found.text.split('\n'))
}

/**
 * A session of team web, its pointer file in /work and its config keeping the turn log 2 h, with turn logs for lead,
 * then api, in the hour before NOW; `withConfig` false leaves the config file out.
 */
async function startWithLogs(on: On, withConfig = true) {
  const started = await start(on, {}, { roots: {}, statuses: {} }, { USERPROFILE: HOME })
  started.disk.write('/work/.teamrig.json', [JSON.stringify({ team: 'web' })])
  if (withConfig) started.disk.write('/Homes/tester/.teamrig/teams/web/config.json', [JSON.stringify({ turnLog: { keepHours: 2 } })])
  started.disk.write('/Homes/tester/.teamrig/teams/web/state/events.jsonl', [
    createLine('T7', { owner: 'web', by: 'lead', at: NOW - HOUR, title: 'Ship the team register' }),
  ])
  started.disk.write(`${WEB_LOG}/lead/2026-10-13T13.jsonl`, [turnLine(50, 'prompt', 'Plan the week'), turnLine(49, 'reply', 'Planned')])
  started.disk.write(`${WEB_LOG}/api/2026-10-13T13.jsonl`, [
    turnLine(40, 'prompt', 'Ship the log view'),
    turnLine(39, 'reply', 'Shipped it'),
    turnLine(38, 'clear', 'context cleared (/clear)'),
  ])
  return started
}

test('the Log view lists each conversation of its kept hours, the newest last line first, each titled by how it opened', async ($, on) => {
  const { clock, disk } = await startWithLogs(on)
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })

  await pane.press({ key: 'log' })
  expect(await pane.find({ text: /Ship the team register/ })).toBeUndefined()
  const conversations = async () => buttonKeys(await pane.drawn()).filter(key => key.startsWith('log:conv:'))
  expect(await conversations()).toEqual(['log:conv:api:c-1', 'log:conv:lead:c-1'])
  expect(await drawnLines(pane)).toContain('Ship the log view')
  expect(await drawnLines(pane)).toContain('Plan the week')

  // A new prompt moves its session up on the next poll; Tasks leaves the Log view, and as the session has no area,
  // all shows its team's tasks again.
  disk.write(`${WEB_LOG}/lead/2026-10-13T13.jsonl`, [turnLine(50, 'prompt', 'Plan the week'), turnLine(1, 'prompt', 'Review the plan')])
  await clock.advance(POLL_MS)
  expect(await conversations()).toEqual(['log:conv:lead:c-1', 'log:conv:api:c-1'])
  expect(await drawnLines(pane)).toContain('lead · 13:10 UTC–13:59 UTC · 2 lines')
  await pane.press({ key: 'tasks' })
  expect(await drawnLines(pane)).not.toContain('lead · 13:10 UTC–13:59 UTC · 2 lines')
  await pane.press({ key: 'all' })
  expect(await pane.find({ text: /Ship the team register/ })).toBeDefined()
})

test('a press on a conversation opens its page: its title, its lines oldest first, under back, kept current; back returns to the list', async ($, on) => {
  const { clock, disk } = await startWithLogs(on)
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: WIDE })

  await pane.press({ key: 'log' })
  await pane.press({ key: 'log:conv:api:c-1' })
  expect(buttonKeys(await pane.drawn())).toEqual(['tasks', 'changes', 'log', 'inbox', 'team', 'meetings', 'stats', 'back'])
  expect(await pane.find({ text: /^lead · /m })).toBeUndefined()
  // Under back, the trail says where the page is, as a task's page does, and its row is cut at its end.
  expect(await drawnLines(pane)).toContain('Conversations › Ship the log view')
  expect(await pane.find({ type: 'Text', text: 'Conversations › Ship the log view' })).toMatchObject({ props: { wrap: 'truncate-end' } })
  expect(await drawnLines(pane)).toContain('api · last 2 h · 3 lines, the newest last')
  const lines = async () => (await drawnLines(pane)).filter(line => /^(owner|Claude) · |^── |^Ship|^Next/.test(line))
  expect(await lines()).toEqual([
    'Ship the log view',
    'owner · 13:20 UTC',
    'Ship the log view',
    'Claude · 13:21 UTC',
    'Shipped it',
    '── 13:22 UTC · context cleared (/clear) ──',
  ])

  disk.write(`${WEB_LOG}/api/2026-10-13T13.jsonl`, [
    turnLine(40, 'prompt', 'Ship the log view'),
    turnLine(39, 'reply', 'Shipped it'),
    turnLine(38, 'clear', 'context cleared (/clear)'),
    turnLine(2, 'prompt', 'Next step'),
  ])
  await clock.advance(POLL_MS)
  expect((await lines()).at(-1)).toBe('Next step')

  await pane.press({ key: 'back' })
  // The list draws the Find field again (s: Find before it), the page none.
  expect(buttonKeys(await pane.drawn())).toEqual(['tasks', 'changes', 'log', 'inbox', 'team', 'meetings', 'stats', 'find-key', 'log:conv:api:c-1', 'log:conv:lead:c-1'])

  // Log from a page shows the list too, and inline the list shows alone.
  await pane.press({ key: 'log:conv:api:c-1' })
  await pane.press({ key: 'log' })
  expect(await pane.find({ text: /^lead · /m })).toBeDefined()
  await pane.press({ key: 'log:conv:api:c-1' })
  await pane.redraw({ ...PANE_PROPS, placement: 'inline', scroll: { offset: 0, bodyRows: 10 } })
  expect(await pane.find({ text: /^lead · /m })).toBeDefined()
})

test("the Log view's Find field draws the conversations it names; Enter on one opens its page, and back shows the search again", async ($, on) => {
  await startWithLogs(on)
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: WIDE })
  const results = async () => buttonKeys(await pane.drawn()).filter(key => key.startsWith('log-search:'))

  await pane.press({ key: 'log' })
  expect(keyedProps(await pane.drawn(), 'find')).toMatchObject({ placeholder: 'task, title, session…', value: '' })
  await pane.input({ key: 'find', text: 'api', kind: 'change' })
  // The count, then the one conversation it names; the list's rows are not drawn.
  expect(await drawsLine(pane, /^1 conversation matches$/)).toBe(true)
  expect(await drawsLine(pane, /^Ship the log view$/)).toBe(true)
  expect(await drawsLine(pane, /^Plan the week$/)).toBe(false)
  expect(await results()).toEqual(['log-search:api:c-1'])
  expect(keyedProps(await pane.drawn(), 'find')).toMatchObject({ submitLabel: 'open' })

  // Enter on the one match opens its page, which draws no field.
  await pane.input({ key: 'find', text: 'api' })
  expect(await drawnLines(pane)).toContain('api · last 2 h · 3 lines, the newest last')
  expect(buttonKeys(await pane.drawn())).toContain('back')
  expect(drawnField(await pane.drawn())).toBe(null)
  // Back shows the search again, in a fresh field holding its words.
  await pane.press({ key: 'back' })
  expect(await drawsLine(pane, /^1 conversation matches$/)).toBe(true)
  expect(drawnField(await pane.drawn())).toEqual({ key: 'find:1', value: 'api' })

  // Words both conversations hold: Enter moves the ring to the results and opens no page.
  await pane.input({ key: 'find:1', text: 'the', kind: 'change' })
  expect(await drawsLine(pane, /^2 conversations match$/)).toBe(true)
  expect(await results()).toEqual(['log-search:api:c-1', 'log-search:lead:c-1'])
  expect(keyedProps(await pane.drawn(), 'find:1')).toMatchObject({ submitLabel: 'to the results' })
  await pane.input({ key: 'find:1', text: 'the' })
  expect(buttonKeys(await pane.drawn())).not.toContain('back')
  // A press on a result opens its page.
  await pane.press({ key: 'log-search:lead:c-1' })
  expect(await drawnLines(pane)).toContain('lead · last 2 h · 2 lines, the newest last')

  // Another view and back to Log: the list, the search gone.
  await pane.press({ key: 'tasks' })
  await pane.press({ key: 'log' })
  expect(await drawsLine(pane, /match/)).toBe(false)
  expect(await drawnLines(pane)).toContain('Plan the week')
})

test("the Log view titles a conversation by the task its session worked while it ran, from the register's events", async ($, on) => {
  const { disk } = await startWithLogs(on)
  disk.write('/Homes/tester/.teamrig/teams/web/state/events.jsonl', [
    createLine('T8', { owner: 'lead', by: 'lead', at: NOW - HOUR, title: 'Plan the week ahead' }),
    statusLine('T8', 'lead', NOW - 45 * 60_000, 'in-progress'),
  ])
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })

  await pane.press({ key: 'log' })
  expect(await drawnLines(pane)).toContain('T8 Plan the week ahead')
  expect(await drawnLines(pane)).not.toContain('Plan the week')
  expect(await drawnLines(pane)).toContain('Ship the log view')
})

test('the Log view says so when the session has no team', async ($, on) => {
  await start(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: WIDE })

  await pane.press({ key: 'log' })
  expect(await pane.find({ text: /^No team found: the Conversations view shows/ })).toBeDefined()
})

test('the Log view says so when the team has no config file, reading no turn log: teamrig writes it none', async ($, on) => {
  const { disk } = await startWithLogs(on, false)
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: WIDE })

  await pane.press({ key: 'log' })
  expect(await pane.find({ text: /^No turn logs: the team has no config file/ })).toBeDefined()
  expect(disk.reads.filter(path => path.includes('/turn-log/'))).toEqual([])
})

test('the Log view reads no turn log while another view shows, and reads what moved when it shows again', async ($, on) => {
  const { clock, disk } = await startWithLogs(on)
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  const logReads = () => disk.reads.filter(path => path.includes('/turn-log/'))

  await pane.press({ key: 'log' })
  await pane.press({ key: 'tasks' })
  disk.reads.length = 0
  disk.write(`${WEB_LOG}/api/2026-10-13T13.jsonl`, [turnLine(1, 'prompt', 'Unseen yet')])
  await clock.advance(POLL_MS)
  expect(logReads()).toEqual([])

  await pane.press({ key: 'log' })
  expect(logReads()).toEqual([`${WEB_LOG}/api/2026-10-13T13.jsonl`])
  expect(await drawnLines(pane)).toContain('Unseen yet')
})

const TEAMS = '/Homes/tester/.teamrig/teams'
const TOOLS_CONFIG = { team: { id: 'tools', parent: 'acme' }, sessions: ['boss'], roles: { lead: 'boss' } }

/** A hire log record as teamrig writes it to hires.jsonl: its format, and its time as an ISO string. */
function hiringLine(record: HireRecord | RetireRecord): string {
  return JSON.stringify({ v: 2, ...record, at: iso(record.at) })
}

/**
 * A session of team acme, its pointer file in /work: lead over web, web a sub-lead over api and ui; ui hired, qa hired
 * and retired. Its child team tools, and another root team, other, another project's.
 */
async function startWithTeam(on: On) {
  const started = await start(on, {}, { roots: {}, statuses: {} }, { USERPROFILE: HOME })
  started.disk.write('/work/.teamrig.json', [JSON.stringify({ team: 'acme' })])
  started.disk.write(`${TEAMS}/acme/config.json`, [
    JSON.stringify({ team: { id: 'acme' }, sessions: ['lead', 'web', 'api', 'ui'], roles: { lead: 'lead' }, leads: { web: ['api', 'ui'] } }),
  ])
  started.disk.write(`${TEAMS}/acme/state/events.jsonl`, [createLine('T7', { owner: 'api', by: 'lead', at: NOW - HOUR, title: 'Add the route' })])
  started.disk.write(`${TEAMS}/acme/state/hires.jsonl`, [hiringLine(hire('ui', NOW - 96 * HOUR)), hiringLine(hire('qa', NOW - 90 * HOUR)), hiringLine(retire('qa', NOW - 60 * HOUR))])
  started.disk.write(`${TEAMS}/tools/config.json`, [JSON.stringify(TOOLS_CONFIG)])
  started.disk.write(`${TEAMS}/other/config.json`, [JSON.stringify({ team: { id: 'other' }, sessions: ['lead'], roles: { lead: 'lead' } })])
  return started
}

/**
 * True when a line on the pane's screen, its padding trimmed, matches `pattern`: the screen, as a row whose presses
 * are pieces of their own (a leader's row, a card's inbox count) draws as several Texts side by side.
 */
async function drawsLine(pane: Mounted<'Pane'>, pattern: RegExp): Promise<boolean> {
  return screenOf(await pane.drawn()).some(line => pattern.test(line.trim()))
}

/** The key of the press within a Teams tab row that opens or closes the tab's key `toggles`. */
async function pressOn(pane: Mounted<'Pane'>, toggles: string): Promise<string> {
  const key = buttonKeys(await pane.drawn()).find(found => found.startsWith(`team:${toggles}:`))
  if (key === undefined) throw new Error(`no press on ${toggles}`)
  return key
}

test("the Teams tab lists the tree of teams the session's team is in; a press on a row closes or opens what lies under it", async ($, on) => {
  await startWithTeam(on)
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: WIDE })

  await pane.press({ key: 'team' })
  expect(await drawsLine(pane, /^▾ acme · 4 active · 1 retired \[Stats\]$/)).toBe(true)
  expect(await drawsLine(pane, /● acme-api \[Wake\] \[Stats\]$/)).toBe(true)
  expect(await drawsLine(pane, /● acme-ui \[Wake\] \[Stats\]$/)).toBe(true)
  expect(await drawsLine(pane, /▸ retired \(1\)$/)).toBe(true)
  expect(await drawsLine(pane, /○ acme-qa/)).toBe(false)
  expect(await drawsLine(pane, /▾ tools · 1 active · 0 retired \[Stats\]$/)).toBe(true)
  expect(await drawsLine(pane, /\bother\b/)).toBe(false)
  expect(await pane.find({ text: /Add the route/ })).toBeUndefined()

  // web leads, so its row holds two presses: its mark closes what it leads and a second opens it again, its name opens its
  // card. The retired group's row opens the retired sessions; api's name opens api's card, as every session's does.
  await pane.press({ key: await pressOn(pane, 'session:acme/web') })
  expect(await drawsLine(pane, /● acme-api \[Wake\] \[Stats\]$/)).toBe(false)
  expect(await drawsLine(pane, /▸ ● acme-web \(2\) · sub-lead \[Wake\] \[Stats\]$/)).toBe(true)
  await pane.press({ key: await pressOn(pane, 'session:acme/web') })
  expect(await drawsLine(pane, /● acme-api \[Wake\] \[Stats\]$/)).toBe(true)
  expect(await drawsLine(pane, /│ Role {9}sub-lead · leads 2 sessions$/)).toBe(false)
  await pane.press({ key: await pressOn(pane, 'card:session:acme/web') })
  expect(await drawsLine(pane, /│ Role {9}sub-lead · leads 2 sessions$/)).toBe(true)
  await pane.press({ key: 'retired:acme' })
  expect(await drawsLine(pane, /○ acme-qa \[Stats\]$/)).toBe(true)
  await pane.press({ key: await pressOn(pane, 'card:session:acme/api') })
  expect(await drawsLine(pane, /│ Led by {7}web, then lead$/)).toBe(true)
  expect(await drawsLine(pane, /│ Now {10}nothing in progress$/)).toBe(true)
  expect(await drawsLine(pane, /│ Tasks {8}0 done of 1$/)).toBe(true)
})

test("a session's card counts its unread inbox lines, and a press on the count opens that inbox at the first of them", async ($, on) => {
  const { disk } = await startWithTeam(on)
  const inbox = `${TEAMS}/acme/state/inbox/api.md`
  disk.write(`${TEAMS}/acme/state/inbox-marks.jsonl`, [markLine('api', 1, S2, NOW, 'line one')])
  disk.write(inbox, ['line one', '', 'line two', 'line three'])
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: WIDE })

  await pane.press({ key: 'team' })
  await pane.press({ key: await pressOn(pane, 'card:session:acme/api') })
  expect(await drawsLine(pane, /│ Inbox {8}2 unread$/)).toBe(true)
  const toInbox = buttonKeys(await pane.drawn()).find(key => key.startsWith('goto:inbox:session:acme/api:'))
  if (toInbox === undefined) throw new Error("no press on api's inbox count")
  await pane.press({ key: toInbox })
  const screen = screenOf(await pane.drawn())
  expect(screen).toContain(' inbox/api.md')
  expect(screen).toContain(` ${inbox} · line 3`)
  // Landing on its first unread line, drawn bold.
  expect(await pane.find({ type: 'Text', text: /^line two\n?$/ })).toMatchObject({ props: { bold: true } })
})

test("the Teams tab's Find field draws the sessions it names under their leaders; Enter on one opens its card, and back from a page the card opens shows the tasks list", async ($, on) => {
  const { disk } = await startWithTeam(on)
  disk.write(`${TEAMS}/acme/state/inbox-marks.jsonl`, [markLine('api', 1, S2, NOW, 'line one')])
  disk.write(`${TEAMS}/acme/state/inbox/api.md`, ['line one', '', 'line two', 'line three'])
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: WIDE })

  await pane.press({ key: 'team' })
  expect(keyedProps(await pane.drawn(), 'find')).toMatchObject({ placeholder: 'id, name, role, scope…', value: '' })
  await pane.input({ key: 'find', text: 'api', kind: 'change' })
  // The count, then api under its team and the leaders over it; the sessions and teams it leads nowhere near are not drawn.
  expect(await drawsLine(pane, /^1 session matches$/)).toBe(true)
  expect(await drawsLine(pane, /● acme-api \[Wake\] \[Stats\]$/)).toBe(true)
  expect(await drawsLine(pane, /● acme-web\b/)).toBe(true)
  expect(await drawsLine(pane, /● acme-ui\b/)).toBe(false)
  expect(await drawsLine(pane, /\btools\b/)).toBe(false)
  expect(keyedProps(await pane.drawn(), 'find')).toMatchObject({ submitLabel: 'open' })

  // Enter on the one match opens its card, and Enter again leaves it open.
  await pane.input({ key: 'find', text: 'api' })
  expect(await drawsLine(pane, /│ Led by {7}web, then lead$/)).toBe(true)
  await pane.input({ key: 'find', text: 'api' })
  expect(await drawsLine(pane, /│ Led by {7}web, then lead$/)).toBe(true)

  // The card's inbox count opens that inbox in the Tasks view; back shows the tasks list, never the Teams tab's search
  // drawn as one of tasks.
  const toInbox = buttonKeys(await pane.drawn()).find(key => key.startsWith('goto:inbox:'))
  if (toInbox === undefined) throw new Error("no press on api's inbox count")
  await pane.press({ key: toInbox })
  expect(screenOf(await pane.drawn())).toContain(' inbox/api.md')
  await pane.press({ key: 'back' })
  expect(await drawsLine(pane, /match/)).toBe(false)
  expect(screenOf(await pane.drawn())).not.toContain(' inbox/api.md')
  expect(buttonKeys(await pane.drawn())).toContain('mine')
})

test("the Teams tab and the Tasks view share one search: a switch between them closes it, so neither draws the other's", async ($, on) => {
  await startWithTeam(on)
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: WIDE })

  await pane.press({ key: 'team' })
  await pane.input({ key: 'find', text: 'api', kind: 'change' })
  expect(await drawsLine(pane, /^1 session matches$/)).toBe(true)
  await pane.press({ key: 'tasks' })
  expect(await drawsLine(pane, /match/)).toBe(false)
  // The closed search draws the field in a new round, empty, so the engine drops what was typed in it.
  expect(drawnField(await pane.drawn())).toEqual({ key: 'find:1', value: '' })

  await pane.input({ key: 'find:1', text: 'route', kind: 'change' })
  expect(await drawsLine(pane, /^1 task matches$/)).toBe(true)
  await pane.press({ key: 'team' })
  expect(await drawsLine(pane, /match/)).toBe(false)
  expect(await drawsLine(pane, /^▾ tools · 1 active · 0 retired \[Stats\]$/)).toBe(true)
})

test('the Teams tab reads no team folder while another view shows, and reads what moved when it shows again', async ($, on) => {
  const { clock, disk } = await startWithTeam(on)
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: WIDE })
  const teamReads = () => disk.reads.filter(path => path.startsWith(`${TEAMS}/tools/`) || path.endsWith('/hires.jsonl'))

  await pane.press({ key: 'team' })
  await pane.press({ key: 'tasks' })
  disk.reads.length = 0
  disk.write(`${TEAMS}/tools/config.json`, [JSON.stringify({ ...TOOLS_CONFIG, sessions: ['boss', 'dev'] })])
  await clock.advance(POLL_MS)
  expect(teamReads()).toEqual([])

  await pane.press({ key: 'team' })
  expect(teamReads()).toEqual([`${TEAMS}/tools/config.json`])
  expect(await drawsLine(pane, /● tools-dev \[Wake\] \[Stats\]$/)).toBe(true)
})

test('the Teams tab says so when the session has no team', async ($, on) => {
  await start(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: WIDE })

  await pane.press({ key: 'team' })
  expect(await pane.find({ text: /^No team found: the Teams tab shows the tree of teams/ })).toBeDefined()
})

/**
 * After a hot reload the stored team tree is as an older pane kept it, each key and value rewritten by `older`: the tab
 * reads it as not read yet, never drawing it with a card open, and draws the tree again from the next read.
 */
async function olderTreeReadsAsNotRead($: TestEngine, on: On, older: (key: string, value: unknown) => unknown): Promise<void> {
  await startWithTeam(on)
  let isOlderStored = false
  on('state.get', async ($, e, next) => {
    const answer = await next(e)
    if (!isOlderStored || e.key !== 'teamTree' || answer.value === undefined) return answer
    const kept: unknown = JSON.parse(JSON.stringify(answer.value.value, older))
    return { value: { ...answer.value, value: kept } }
  })
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: WIDE })
  await pane.press({ key: 'team' })
  await pane.press({ key: await pressOn(pane, 'card:session:acme/api') })
  expect(await drawsLine(pane, /│ Tasks {8}0 done of 1$/)).toBe(true)

  isOlderStored = true
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  await pane.redraw(WIDE)
  await pane.press({ key: 'team' })

  expect(await pane.find({ text: /could not draw/ })).toBeUndefined()
  expect(await pane.find({ text: /^Reading the team…$/ })).toBeDefined()
  isOlderStored = false
  await pane.redraw(WIDE)
  expect(await drawsLine(pane, /│ Tasks {8}0 done of 1$/)).toBe(true)
}

test('after a hot reload, a team tree an older pane kept without its task counts reads as not read yet, never drawn with a card open', async ($, on) => {
  // The pane before the card's Tasks row kept the tree under team-v4, its sessions without their task counts.
  await olderTreeReadsAsNotRead($, on, (key, value) => (key === 'tasks' ? undefined : key === 'shape' ? 'team-v4' : value))
})

test('after a hot reload, a team tree an older pane kept without its failed folders reads as not read yet, never drawn', async ($, on) => {
  // The pane before the WARN line for a team folder it could not read kept the tree under team-v5, with no failures.
  await olderTreeReadsAsNotRead($, on, (key, value) => (key === 'failures' ? undefined : key === 'shape' ? 'team-v5' : value))
})

test("after a hot reload, a team tree an older pane kept without its teams' weeks reads as not read yet, never drawn", async ($, on) => {
  // The pane before the team week kept the tree under team-v6, its teams without their week.
  await olderTreeReadsAsNotRead($, on, (key, value) => (key === 'week' ? undefined : key === 'shape' ? 'team-v6' : value))
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
 * labelled Button is its label, paddingX and paddingLeft indent. A Box with a width fills it, so what stands beside
 * it starts past it; one with a height takes those rows, cut or filled with blank lines. Trailing blanks, and the
 * blank lines under the last drawn one, are cut.
 */
function screenOf(node: unknown): string[] {
  const lines = linesOf(node)
  const last = lines.findLastIndex(line => line !== '')
  return lines.slice(0, last + 1)
}

/** A drawn tree's lines as screenOf reads them, the blank lines a Box's height fills kept. */
function linesOf(node: unknown): string[] {
  if (typeof node === 'string') return node.split('\n')
  const props = propsOf(node)
  if (typeOf(node) === 'Button' && props !== null && 'label' in props && typeof props.label === 'string') return props.label.split('\n')
  const parts = childrenOf(node)
    .filter(child => typeof child === 'string' || (typeof child === 'object' && child !== null))
    .map(linesOf)
  if (typeOf(node) !== 'Box') return parts.map(lines => lines.join('\n')).join('').split('\n')
  const pad = ' '.repeat(numberProp(props, 'paddingX') + numberProp(props, 'paddingLeft'))
  const sized = (lines: string[]): string[] => {
    const width = numberProp(props, 'width')
    const filled = width === 0 ? lines : lines.map(line => line.padEnd(width))
    if (props === null || !('height' in props) || typeof props.height !== 'number') return filled
    return Array.from({ length: props.height }, (_, i) => filled[i] ?? ''.padEnd(width))
  }
  if (props !== null && 'flexDirection' in props && props.flexDirection === 'row') {
    const gap = ' '.repeat(numberProp(props, 'columnGap'))
    const widths = parts.map(lines => Math.max(...lines.map(cells)))
    const height = Math.max(0, ...parts.map(lines => lines.length))
    const rows = Array.from({ length: height }, (_, i) => parts.map((lines, j) => (lines[i] ?? '').padEnd(widths[j] ?? 0)).join(gap))
    return sized(rows.map(row => `${pad}${row}`.trimEnd()))
  }
  const blank = Array.from({ length: numberProp(props, 'gap') }, () => '')
  return sized(parts.flatMap((lines, i) => (i === 0 ? lines : [...blank, ...lines])).map(line => (line === '' ? '' : `${pad}${line}`.trimEnd())))
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
  // No status bar and no close cards on a page: the bar counts the list, and the page holds no card to close. Its card
  // names T58, planned first, T52, of another owner, which needs it, and the file it references.
  expect(buttonKeys(drawn)).toEqual([
    'tasks',
    'changes',
    'log',
    'inbox',
    'team',
    'meetings',
    'stats',
    'find-key',
    'mine',
    'all',
    'done-page',
    'keys',
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
    ' po',
    ' Tasks Changes Conversations',
    ' Inbox (2) Teams Meetings Stats',
    ' Find',
    ' Keys go to Claude · click the field to search',
    ' mine all · done › · keys',
    '',
    ' ‹ back  forward ›',
    ' Tasks › T50 › T58',
    ` ${'─'.repeat(PANE_PROPS.bodyColumns - 2)}`,
    '',
    ' ○ T58  Read the source',
    ' Status       not started since Sat 10-10 by lead',
    ' Owner        etl',
    ' Priority     3',
    ' Class        Improvements',
    ' Score        5',
    ' Planned      this week',
    ' Goal         G10.2',
    ' Origin       Asked by owner, added by lead Sat',
    '              10-10',
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
  expect(childrenOf(keyedNode(drawn, 'trail:0'))).toMatchObject([
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
    'log',
    'inbox',
    'team',
    'meetings',
    'stats',
    'find-key',
    'mine',
    'all',
    'done-page',
    'close-cards',
    'keys',
    'forward',
    'crumb:1',
    'crumb:2',
    'bar:not-started',
    'count:not-started',
    'next',
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
    ' po',
    ' Tasks Changes Conversations',
    ' Inbox (2) Teams Meetings Stats',
    ' Find',
    ' Keys go to Claude · click the field to search',
    ' mine all · done › · keys',
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
  // 400 lines with no blank line split every 50: line 300 sits in the block from line 251, far below the body's
  // top, and the step moves the body's window to start at that block. The blocks out of the window are not drawn.
  const drawn = await pane.drawn()
  const shown = linesOf(keyedNode(drawn, 'window')).map(line => line.trimEnd())
  expect(shown[0]).toBe('brief line 251')
  expect(shown).toContain('brief line 260')
  expect(shown).not.toContain('brief line 250')
  expect(screenOf(drawn)).not.toContain(' brief line 1')

  await pane.press({ key: 'back' })
  const toGone = buttonKeys(await pane.drawn()).filter(key => key.startsWith('goto:file:'))[1]
  if (toGone === undefined) throw new Error('no press on docs/gone.md')
  await pane.press({ key: toGone })
  const screen = screenOf(await pane.drawn())
  expect(screen).toContain(' Not found. Looked for it at:')
  expect(screen).toContain(' /work/docs/gone.md')
})

/** An inbox of stamped lines, its first two read: one posted past the last 24 hours before NOW, one inside them. */
const STAMPED_INBOX = [
  '- 2026-10-12 09:00 lead: read a day ago',
  '- 2026-10-13 10:00 docs: read today',
  '- 2026-10-13 12:00 qa: the checks pass',
  '- 2026-10-13 13:00 lead: ship the Inbox view',
]

/** The pane started on STAMPED_INBOX, read up to its third line, mounted wide. */
async function startOnInbox($: TestEngine, on: On) {
  const started = await start(on)
  started.disk.write(INBOX, STAMPED_INBOX)
  started.disk.write(MARKS, [markLine('po', 2, S1, NOW, '- 2026-10-13 10:00 docs: read today')])
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: WIDE })
  return { ...started, pane }
}

test("the switch's Inbox button counts the unread lines and opens the Inbox view: the last 24 hours' lines and the unread ones, the last written first, each unread one marked, under a Find field and no modes", async ($, on) => {
  const { clock, disk, pane } = await startOnInbox($, on)
  expect(keyedProps(await pane.drawn(), 'inbox')).toMatchObject({ label: 'Inbox (2)', hotkey: 'u', variant: 'secondary' })

  await pane.press({ key: 'inbox' })
  expect(keyedProps(await pane.drawn(), 'inbox')).toMatchObject({ variant: 'primary' })
  expect(await drawsLine(pane, /^2 unread · 1 read in the last 24 hours$/)).toBe(true)
  expect(await drawsLine(pane, /^● lead · 13:00 UTC$/)).toBe(true)
  expect(await drawsLine(pane, /^● qa · 12:00 UTC$/)).toBe(true)
  expect(await drawsLine(pane, /^docs · 10:00 UTC$/)).toBe(true)
  const shown = screenOf(await pane.drawn()).map(line => line.trim())
  const at = ['ship the Inbox view', 'the checks pass', 'read today'].map(words => shown.indexOf(words))
  expect(at.every(index => index >= 0)).toBe(true)
  expect(at).toEqual([...at].sort((a, b) => a - b))
  expect(shown).not.toContain('read a day ago')
  expect(keyedProps(await pane.drawn(), 'find')).toMatchObject({ placeholder: 'sender, words…', value: '', submitLabel: 'search' })
  expect(buttonKeys(await pane.drawn())).not.toContain('mine')

  // Once the session reads its inbox, the next poll draws the button as the word alone and no line marked.
  disk.write(MARKS, [markLine('po', 4, S1, NOW, '- 2026-10-13 13:00 lead: ship the Inbox view')])
  await clock.advance(POLL_MS)
  expect(keyedProps(await pane.drawn(), 'inbox')).toMatchObject({ label: 'Inbox' })
  expect(await drawsLine(pane, /^3 read in the last 24 hours$/)).toBe(true)
  expect(await drawsLine(pane, /^lead · 13:00 UTC$/)).toBe(true)
})

test("the Inbox view's Find field draws the lines its words name, by sender or words; Enter opens nothing, and a switch to the Tasks view closes the search", async ($, on) => {
  const { pane } = await startOnInbox($, on)
  await pane.press({ key: 'inbox' })

  await pane.input({ key: 'find', text: 'qa', kind: 'change' })
  expect(await drawsLine(pane, /^1 line matches$/)).toBe(true)
  expect(await drawsLine(pane, /^● qa · 12:00 UTC$/)).toBe(true)
  expect(screenOf(await pane.drawn())).not.toContain('ship the Inbox view')
  expect(keyedProps(await pane.drawn(), 'find')).toMatchObject({ submitLabel: 'search' })
  expect(screenOf(await pane.drawn())).not.toContain('Enter:')
  // Enter leaves the results as they are: a line has nothing to open.
  await pane.input({ key: 'find', text: 'qa' })
  expect(await drawsLine(pane, /^1 line matches$/)).toBe(true)

  await pane.input({ key: 'find', text: 'ship', kind: 'change' })
  expect(await drawsLine(pane, /^1 line matches$/)).toBe(true)
  expect(await drawsLine(pane, /^● lead · 13:00 UTC$/)).toBe(true)

  await pane.press({ key: 'tasks' })
  expect(await drawsLine(pane, /match/)).toBe(false)
  await pane.press({ key: 'inbox' })
  expect(await drawsLine(pane, /match/)).toBe(false)
  expect(await drawsLine(pane, /^2 unread · 1 read in the last 24 hours$/)).toBe(true)
})

test("the switch's Inbox button alone counts the unread lines and opens the view, the header no count of its own; reading it marks nothing read", async ($, on) => {
  const { clock, pane } = await startOnInbox($, on)
  let drawn = await pane.drawn()
  expect(buttonKeys(drawn).filter(key => key.startsWith('goto:inbox:'))).toEqual([])
  expect(await pane.find({ text: /inbox 2 unread/ })).toBeUndefined()
  expect(keyedProps(drawn, 'inbox')).toMatchObject({ label: 'Inbox (2)', variant: 'secondary' })

  await pane.press({ key: 'inbox' })
  drawn = await pane.drawn()
  expect(keyedProps(drawn, 'inbox')).toMatchObject({ variant: 'primary' })
  expect(await drawsLine(pane, /^2 unread · 1 read in the last 24 hours$/)).toBe(true)

  // Back on the tasks after a poll, the two lines are still unread: the pane writes no mark.
  await pane.press({ key: 'tasks' })
  await clock.advance(POLL_MS)
  expect(keyedProps(await pane.drawn(), 'inbox')).toMatchObject({ label: 'Inbox (2)' })
})

test('the dock always draws the Find field, s moving the focus into it; each change draws the matches, Enter opens the one match or moves to the first of more, back returns, clear or an empty field closes the search', async ($, on) => {
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
  // The count, then the active matches in plan order, each a press with a dim line of whose it is; the Find field draws
  // no words.
  expect(screenOf(drawn)).toEqual([
    ' po',
    ' Tasks Changes Conversations',
    ' Inbox (2) Teams Meetings Stats',
    ' Find  clear',
    ' Keys go to Claude · click the field to search',
    ' mine all · done › · keys',
    '',
    ' 2 tasks match',
    '',
    ' ○ T58  Read the source',
    "        etl's",
    '',
    ' ○ T50  Load the feed',
    "        etl's",
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
        { type: 'Text', props: { dimColor: true, underline: true }, children: ['etl'] },
        { type: 'Text', props: { dimColor: true }, children: ["'s"] },
      ],
    },
  ])

  // Two matches: Enter moves the ring onto the first result (refused here, as s's move), and opens no page.
  expect(keyedProps(drawn, 'find')).toMatchObject({ submitLabel: 'to the results' })
  await pane.input({ key: 'find', text: 'etl the' })
  drawn = await pane.drawn()
  expect(keyedNode(drawn, 'page-head')).toBe(null)
  expect(drawnField(drawn)).toEqual({ key: 'find', value: '' })
  // A press on a result, as Enter on it: its page.
  await pane.press({ key: 'search:T50' })
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

test('the Find field keeps its index among the focusable elements on the list, with a card open, in a search, on a page and on the Done page, so the focus ring stays in it as the person types', async ($, on) => {
  const { disk } = await start(on)
  disk.write(EVENTS, CHAIN)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  const indexes = [fieldIndex(await pane.drawn())]
  // A card open shows close cards; the first key typed opens a search, which hides it and shows clear.
  await pane.press({ key: 'next:T52' })
  let drawn = await pane.drawn()
  expect(buttonKeys(drawn)).toContain('close-cards')
  indexes.push(fieldIndex(drawn))
  await pane.input({ key: 'find', text: 'e', kind: 'change' })
  drawn = await pane.drawn()
  expect(buttonKeys(drawn)).not.toContain('close-cards')
  expect(buttonKeys(drawn)).toContain('clear')
  indexes.push(fieldIndex(drawn))
  // Enter on words one task matches opens its page.
  await pane.input({ key: 'find', text: 'feed' })
  drawn = await pane.drawn()
  expect(keyedNode(drawn, 'page-head')).not.toBe(null)
  indexes.push(fieldIndex(drawn))
  await pane.press({ key: 'done-page' })
  drawn = await pane.drawn()
  expect(keyedNode(drawn, 'week-steps')).not.toBe(null)
  indexes.push(fieldIndex(drawn))
  // After Tasks, Changes, Log, Inbox, Teams, Meetings, Stats and s: Find.
  expect(indexes).toEqual([8, 8, 8, 8, 8])
})

test("the line under the Find field says where the keys go: to Claude's prompt, to the pane, typed into the search, or on a result", async ($, on) => {
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
  /** The line under the Find field as drawn: its words, and whether it is bold (typing searches) or dim; null where none is. */
  const keysLine = async () => {
    const found = await pane.find({ type: 'Text', text: /^(Typing searches|On a result|Keys on the pane|Keys go to Claude) · / })
    if (found === undefined) return null
    // Drawn one way or the other, never both.
    expect(found.props['bold'] === true).toBe(found.props['dimColor'] !== true)
    // A narrow dock wraps the line within its columns; its words read the same.
    const lines = found.text.split('\n')
    expect(lines.every(line => line.length <= PANE_PROPS.bodyColumns - 2)).toBe(true)
    return { text: lines.join(' '), bold: found.props['bold'] === true }
  }
  const CLAUDE = { text: 'Keys go to Claude · click the field to search', bold: false }
  const ON_PANE = { text: 'Keys on the pane · s: search · Esc: to Claude', bold: false }
  // Typing searches: Enter opens the one match of words, moves to the results of more ('etl' matches T50 and T58).
  const SEARCH_ONE = { text: 'Typing searches · Enter: open · Esc: to Claude', bold: true }
  const SEARCH = { text: 'Typing searches · Enter: to the results · Esc: to Claude', bold: true }
  const RESULT = { text: 'On a result · Enter: open · ↑↓: move · s: search · Esc: to Claude', bold: false }
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
  expect(await keysLine()).toEqual(SEARCH_ONE)
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

  // Enter on two matches moves the ring onto the first result: on a result, where Enter opens it.
  await pane.input({ key: 'find', text: 'etl' })
  expect(drawnField(await pane.drawn())).toEqual({ key: 'find', value: '' })
  expect(await land('search:T50', PLUGIN)).toEqual({})
  expect(await keysLine()).toEqual(RESULT)
  // Its page opens, and the ring left where the result was sits on another element: the pane's keys.
  await pane.press({ key: 'search:T50' })
  expect(drawnField(await pane.drawn())).toEqual({ key: 'find:1', value: '' })
  expect(await keysLine()).toEqual(ON_PANE)
  expect(await land('back', PLUGIN)).toEqual({})
  expect(await keysLine()).toEqual(ON_PANE)
  // Back on the search, clear moves the ring back into the field, a new round's: typing searches.
  await pane.press({ key: 'back' })
  await pane.press({ key: 'clear' })
  expect(drawnField(await pane.drawn())).toEqual({ key: 'find:3', value: '' })
  expect(await land('find:3', PLUGIN)).toEqual({})
  expect(await keysLine()).toEqual(SEARCH_ONE)
  // Enter on one match opens its page and moves the ring onto its back step: the pane's keys, so b, f and s answer
  // rather than typing a new search into the page's fresh field.
  await pane.input({ key: 'find:3', text: 'feed', kind: 'change' })
  expect(await keysLine()).toEqual(SEARCH_ONE)
  await pane.input({ key: 'find:3', text: 'feed' })
  expect(drawnField(await pane.drawn())).toEqual({ key: 'find:4', value: '' })
  expect(await land('back', PLUGIN)).toEqual({})
  expect(await keysLine()).toEqual(ON_PANE)

  // Inline, where no field is drawn, no line either.
  await pane.redraw({ ...HELD, placement: 'inline' })
  expect(await keysLine()).toBe(null)
})

test('done (h) opens the Done page at the week of now; prev (p) and next (l) step weeks; a row opens its page; back returns', async ($, on) => {
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
  expect(keyedProps(await pane.drawn(), 'done-page')).toMatchObject({ label: 'done ›', hotkey: 'h', variant: 'secondary' })

  await pane.press({ key: 'done-page' })
  let drawn = await pane.drawn()
  expect(keyedProps(drawn, 'done-page')).toMatchObject({ variant: 'primary' })
  expect(keyedProps(drawn, 'prev')).toMatchObject({ label: '‹ prev', hotkey: 'p' })
  // The newest week has no next: dim words, no press.
  expect(buttonKeys(drawn)).not.toContain('next')
  expect(await pane.find({ type: 'Text', text: /^next ›$/ })).toMatchObject({ props: { dimColor: true } })
  expect(screenOf(drawn)).toEqual([
    ' po',
    ' Tasks Changes Conversations',
    ' Inbox (2) Teams Meetings Stats',
    ' Find',
    ' Keys go to Claude · click the field to search',
    ' mine all · done › · keys',
    '',
    ' ‹ back  forward ›',
    ' Tasks › Done 10-13',
    ` ${'─'.repeat(48)}`,
    '',
    ' ‹ prev  week of Tue 10-13  next ›',
    '',
    ' Done · po · 1 done · 0 dropped',
    '',
    ' ▾ Today so far · Tue 10-13 · 1 done',
    '   Owner asked (1)',
    '     ✓ T7  Fix the loader               12:00 UTC',
  ])

  // A dock too short to keep the header still draws the page in the engine's window: its list stays as tight.
  await pane.redraw({ ...PANE_PROPS, scroll: { offset: 0, bodyRows: 12 } })
  expect(screenOf(await pane.drawn()).slice(-5)).toEqual([
    ' Done · po · 1 done · 0 dropped',
    '',
    ' ▾ Today so far · Tue 10-13 · 1 done',
    '   Owner asked (1)',
    '     ✓ T7  Fix the loader               12:00 UTC',
  ])
  await pane.redraw(PANE_PROPS)

  // The week before: the tasks' week tag is Tuesday's, so the weeks are; T9 dropped on Friday, in a group that starts closed.
  await pane.press({ key: 'prev' })
  expect(await pane.find({ type: 'Text', text: /^week of Tue 10-06$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^▾ Fri 10-09 · 0 done$/ })).toBeDefined()
  expect(buttonKeys(await pane.drawn())).not.toContain('done-page:T9')

  // A press opens the group, and a row opens its task's page; back returns to the week it was opened from, still open.
  await pane.press({ key: 'done-group:2026-10-09:dropped' })
  await pane.press({ key: 'done-page:T9' })
  expect(await pane.find({ type: 'Text', text: /^✗ T9  Feed the pages$/ })).toBeDefined()
  await pane.press({ key: 'back' })
  expect(await pane.find({ type: 'Text', text: /^week of Tue 10-06$/ })).toBeDefined()
  expect(buttonKeys(await pane.drawn())).toContain('done-page:T9')

  // The oldest week: no prev, and where the pane stops holding finished tasks.
  await pane.press({ key: 'prev' })
  drawn = await pane.drawn()
  expect(buttonKeys(drawn)).not.toContain('prev')
  expect(await pane.find({ type: 'Text', text: /^‹ prev$/ })).toMatchObject({ props: { dimColor: true } })
  expect(keyedProps(drawn, 'next')).toMatchObject({ label: 'next ›', hotkey: 'l' })
  expect(await pane.find({ type: 'Text', text: /^week of Tue 09-29$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^The pane holds tasks finished since Mon/ })).toBeDefined()

  await pane.press({ key: 'next' })
  await pane.press({ key: 'next' })
  expect(await pane.find({ type: 'Text', text: /^week of Tue 10-13$/ })).toBeDefined()
  // A step changes the week in place: back returns to the list.
  await pane.press({ key: 'back' })
  drawn = await pane.drawn()
  // The list keeps the head while the places ahead stay, the Done page and T9's (forward returns to them).
  expect(screenOf(keyedNode(drawn, 'trail'))).toEqual(['Tasks › Done 10-13 › T9'])
  expect(keyedNode(drawn, 'week-steps')).toBe(null)
  expect(buttonKeys(drawn)).toContain('next:T52')

  // Inline, where no page shows, there is no Done page.
  await pane.redraw({ ...PANE_PROPS, placement: 'inline' })
  expect(buttonKeys(await pane.drawn())).not.toContain('done-page')
})

/** The hotkeys of a drawing's buttons, in drawing order. */
function hotkeysOf(node: unknown): string[] {
  const props = propsOf(node)
  const own = typeOf(node) === 'Button' && props !== null && 'hotkey' in props && typeof props.hotkey === 'string' ? [props.hotkey] : []
  return [...own, ...childrenOf(node).flatMap(hotkeysOf)]
}

test('keys (k) opens the Keys page, every key the pane answers in a grid at the body width under Tasks › Keys; back returns; inline there is none', async ($, on) => {
  const { disk } = await start(on)
  disk.write(EVENTS, CHAIN)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  expect(keyedProps(await pane.drawn(), 'keys')).toMatchObject({ label: 'keys', hotkey: 'k', plain: true })

  await pane.press({ key: 'keys' })
  expect(screenOf(await pane.drawn())).toEqual([
    ' po',
    ' Tasks Changes Conversations',
    ' Inbox (2) Teams Meetings Stats',
    ' Find',
    ' Keys go to Claude · click the field to search',
    ' mine all · done › · keys',
    '',
    ' ‹ back  forward ›',
    ' Tasks › Keys',
    ` ${'─'.repeat(PANE_PROPS.bodyColumns - 2)}`,
    '',
    ` ${'t  Tasks'.padEnd(18)}d  Changes`,
    ` ${'g  Conversations'.padEnd(18)}u  Inbox`,
    ` ${'e  Teams'.padEnd(18)}j  Meetings`,
    ' r  Stats',
    '',
    ` ${'s  Find'.padEnd(18)}m  mine`,
    ` ${'a  all'.padEnd(18)}h  done`,
    ` ${'c  close cards'.padEnd(18)}k  keys`,
    '',
    ` ${'b  back'.padEnd(18)}f  forward`,
    ` ${'p  week before'.padEnd(18)}l  week after`,
    '',
    ' o v w i n  only that status; again shows all',
    '',
    ' ctrl+x tab, or a click: keys to the pane',
    ' Esc: keys back to Claude',
    ' ctrl+x x, or ✕: minimize the pane',
  ])

  // Pressed again it stays; back returns to the list, the Keys page a step ahead.
  await pane.press({ key: 'keys' })
  await pane.press({ key: 'back' })
  const drawn = await pane.drawn()
  expect(buttonKeys(drawn)).toContain('next:T52')
  expect(screenOf(keyedNode(drawn, 'trail'))).toEqual(['Tasks › Keys'])

  await pane.redraw({ ...PANE_PROPS, placement: 'inline' })
  expect(buttonKeys(await pane.drawn())).not.toContain('keys')
})

test("the Keys page names every key a button of the pane answers, and each key it names but the status bar's is drawn", async ($, on) => {
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
  const seen = new Set(hotkeysOf(await pane.drawn()))
  // A card open (close cards), the Done page (back, prev), the week before (next), the list again (forward), then
  // each other view.
  for (const key of ['next:T52', 'done-page', 'prev', 'back', 'changes', 'log', 'inbox', 'team', 'meetings', 'stats']) {
    await pane.press({ key })
    for (const hotkey of hotkeysOf(await pane.drawn())) seen.add(hotkey)
  }
  const named = KEY_GROUPS.flatMap(group => group.entries.map(entry => entry.key))
  expect([...seen].filter(key => !named.includes(key) && !barKeys().split(' ').includes(key))).toEqual([])
  expect(named.filter(key => !seen.has(key))).toEqual([])
})

/** Where the fake Claude Code keeps its config, and the teamrig install its plugin list names. */
const CLAUDE_DIR = '/Homes/tester/.claude'
const TEAMRIG_INSTALL = `${CLAUDE_DIR}/plugins/cache/teamrig/teamrig/0.227.0`
/** A scheduled meeting as `teamrig meeting list --json` prints it: an hour from now, with web, on T1. */
const MEETING = {
  id: 'M3',
  at: iso(NOW + HOUR),
  atText: 'Tue 10-13 15:00 UTC',
  minutes: 30,
  session: 'web',
  with: ['lead'],
  tasks: ['T1'],
  about: 'the pricing tiers',
  brief: null,
  status: 'scheduled',
  missed: false,
}

test("the switch's Meetings button lists the team's meetings through the teamrig CLI, with no Find field; a press on one opens its card, whose start press starts it", async ($, on) => {
  let isStarted = false
  const teamrig = (args: readonly string[]): string => {
    if (args[1] !== 'start') return JSON.stringify({ meetings: [isStarted ? { ...MEETING, status: 'started' } : MEETING] })
    isStarted = true
    return ['STARTED M3 started, Tue 10-13 15:00 UTC, 30 min, web with lead, tasks T1 | the pricing tiers', 'TOLD web', 'TOLD lead', ''].join('\n')
  }
  // A session of team web, its pointer file in /work, its register holding T1.
  const { disk, runs } = await start(on, {}, { roots: {}, statuses: {}, teamrig }, { USERPROFILE: HOME, CLAUDE_CONFIG_DIR: CLAUDE_DIR, TEAMRIG_SESSION: 'po' })
  disk.write('/work/.teamrig.json', [JSON.stringify({ team: 'web' })])
  disk.write('/Homes/tester/.teamrig/teams/web/config.json', ['{}'])
  disk.write('/Homes/tester/.teamrig/teams/web/state/events.jsonl', [createLine('T1', { owner: 'web', by: 'lead', at: NOW - HOUR, title: 'Ship the pricing page' })])
  disk.write(`${CLAUDE_DIR}/plugins/installed_plugins.json`, [JSON.stringify({ version: 2, plugins: { 'teamrig@teamrig': [{ installPath: TEAMRIG_INSTALL }] } })])
  disk.write(`${TEAMRIG_INSTALL}/dist/cli/main.js`, [''])
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: WIDE })
  const cliRuns = () => runs.filter(run => run.startsWith('teamrig '))
  const LIST = 'teamrig meeting list --json --session po'

  // Nothing runs while another view shows.
  expect(keyedProps(await pane.drawn(), 'meetings')).toMatchObject({ label: 'Meetings', hotkey: 'j', variant: 'secondary' })
  expect(cliRuns()).toEqual([])

  await pane.press({ key: 'meetings' })
  expect(cliRuns()).toEqual([LIST])
  expect(await drawsLine(pane, /^1 meeting ─+$/)).toBe(true)
  expect(await drawsLine(pane, /^› M3  Tue 10-13 15:00 UTC · 30 min · web with lead · next$/)).toBe(true)
  expect(keyedProps(await pane.drawn(), 'find')).toBeNull()

  await pane.press({ key: 'meeting:M3' })
  expect(await drawsLine(pane, /^│ Tasks +T1 Ship the pricing page · not started$/)).toBe(true)
  const startKey = buttonKeys(await pane.drawn()).find(key => key.startsWith('start:M3:'))
  if (startKey === undefined) throw new Error('no start press on the open card')
  await pane.press({ key: startKey })
  expect(cliRuns()).toEqual([LIST, 'teamrig meeting start M3 --session po', LIST])
  expect(await drawsLine(pane, /^Started M3\.$/)).toBe(true)
  expect(await drawsLine(pane, /^TOLD lead$/)).toBe(true)
  expect(await drawsLine(pane, /^◐ M3  Tue 10-13 15:00 UTC · 30 min · web with lead · started$/)).toBe(true)
  expect(buttonKeys(await pane.drawn()).filter(key => key.startsWith('start:'))).toEqual([])
})

test("the switch's Stats button, key r, folds the tree's registers with no Find field; a press on a range or a team picks it and folds again", async ($, on) => {
  // A session of team web, its pointer file in /work, its register holding T1.
  const { disk } = await start(on, {}, { roots: {}, statuses: {} }, { USERPROFILE: HOME })
  disk.write('/work/.teamrig.json', [JSON.stringify({ team: 'web' })])
  disk.write('/Homes/tester/.teamrig/teams/web/config.json', ['{}'])
  disk.write('/Homes/tester/.teamrig/teams/web/state/events.jsonl', [createLine('T1', { owner: 'web', by: 'lead', at: NOW - HOUR, title: 'Ship the pricing page' })])
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: STATS_PROPS })
  expect(keyedProps(await pane.drawn(), 'stats')).toMatchObject({ label: 'Stats', hotkey: 'r', variant: 'secondary' })

  await pane.press({ key: 'stats' })
  expect(keyedProps(await pane.drawn(), 'stats')).toMatchObject({ variant: 'primary' })
  expect(await drawsLine(pane, /^Scope {2}\[tree\] {2}web$/)).toBe(true)
  expect(await drawsLine(pane, /^Range {2}\[7 d\] {2}30 d {2}90 d {2}180 d {2}1 y {2}all$/)).toBe(true)
  expect(keyedProps(await pane.drawn(), 'find')).toBeNull()
  expect(await drawsLine(pane, /^Health$/)).toBe(true)
  // A press on a section's header folds it.
  expect(await drawsLine(pane, /^▾ Flow · last 7 d · opened 1 · closed 0 · net \+1$/)).toBe(true)
  await pane.press({ key: 'stats:flow' })
  expect(await drawsLine(pane, /^▸ Flow · last 7 d · opened 1 · closed 0 · net \+1$/)).toBe(true)

  const rangeKey = buttonKeys(await pane.drawn()).find(key => key.startsWith('stats:range:1y:'))
  if (rangeKey === undefined) throw new Error('no 1 y press on the range row')
  await pane.press({ key: rangeKey })
  expect(await drawsLine(pane, /^Range {2}7 d {2}30 d {2}90 d {2}180 d {2}\[1 y\] {2}all$/)).toBe(true)
  expect(await drawsLine(pane, /^▸ Flow · last 1 y · opened 1 · closed 0 · net \+1$/)).toBe(true)

  const teamKey = buttonKeys(await pane.drawn()).find(key => key.startsWith('stats:team:web:'))
  if (teamKey === undefined) throw new Error('no web press on the scope row')
  await pane.press({ key: teamKey })
  expect(await drawsLine(pane, /^Scope {2}tree {2}\[web\]$/)).toBe(true)
})

test("a press on a Health count lists its tasks under back and the trail `Stats › Active (1)`; back shows the numbers, a held task's row opens its page", async ($, on) => {
  // A session of team web, its pointer file in /work, its register holding T1, open.
  const { disk } = await start(on, {}, { roots: {}, statuses: {} }, { USERPROFILE: HOME })
  disk.write('/work/.teamrig.json', [JSON.stringify({ team: 'web' })])
  disk.write('/Homes/tester/.teamrig/teams/web/config.json', ['{}'])
  disk.write('/Homes/tester/.teamrig/teams/web/state/events.jsonl', [createLine('T1', { owner: 'web', by: 'lead', at: NOW - HOUR, title: 'Ship the pricing page' })])
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: STATS_PROPS })
  await pane.press({ key: 'stats' })
  const activeKey = (keys: readonly string[]) => keys.find(key => key.startsWith('stats:list:active:'))
  const pressActive = async () => {
    const key = activeKey(buttonKeys(await pane.drawn()))
    if (key === undefined) throw new Error('no press on the backlog tile\'s active count')
    await pane.press({ key })
  }
  expect(keyedProps(await pane.drawn(), 'back')).toBeNull()

  await pressActive()
  expect(keyedProps(await pane.drawn(), 'back')).toMatchObject({ label: '‹ back', hotkey: 'b', variant: 'secondary' })
  expect(await pane.find({ type: 'Text', text: 'Stats › Active (1)' })).toMatchObject({ props: { wrap: 'truncate-end' } })
  expect(await drawsLine(pane, /^The active tasks in the tree, p1 first, then by due date\.$/)).toBe(true)
  expect(await drawsLine(pane, /^○ T1 {2}Ship the pricing page$/)).toBe(true)
  expect(await drawsLine(pane, /^Health$/)).toBe(false)
  expect(activeKey(buttonKeys(await pane.drawn()))).toBeUndefined()

  await pane.press({ key: 'back' })
  expect(keyedProps(await pane.drawn(), 'back')).toBeNull()
  expect(await drawsLine(pane, /^Health$/)).toBe(true)

  await pressActive()
  await pane.press({ key: 'stats:list:web/T1' })
  expect(keyedProps(await pane.drawn(), 'tasks')).toMatchObject({ variant: 'primary' })
  expect(await drawsLine(pane, /Ship the pricing page/)).toBe(true)
})

/** Mounts the pane of a session of team acme on the Teams tab, tall enough to hold every Stats section. */
async function mountOnTeams($: TestEngine, on: On): Promise<Mounted<'Pane'>> {
  await startWithTeam(on)
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: STATS_PROPS })
  await pane.press({ key: 'team' })
  return pane
}

/** Presses the [Stats] of the Teams tab row that opens the Stats tab on `scope`, as rows.ts statsPressKey words it. */
async function pressRowStats(pane: Mounted<'Pane'>, scope: string): Promise<void> {
  const key = buttonKeys(await pane.drawn()).find(found => found.startsWith(`stats:open:${scope}:`))
  if (key === undefined) throw new Error(`no [Stats] on the row of ${scope}`)
  await pane.press({ key })
}

/** Presses the Health tile's count of the active tasks, which lists them. */
async function pressActiveCount(pane: Mounted<'Pane'>): Promise<void> {
  const key = buttonKeys(await pane.drawn()).find(found => found.startsWith('stats:list:active:'))
  if (key === undefined) throw new Error("no press on the backlog tile's active count")
  await pane.press({ key })
}

test("[Stats] on a team's row opens the Stats tab on that team, on a session's on that session, under back and the trail `Teams › Stats`; back shows the Teams tab", async ($, on) => {
  const pane = await mountOnTeams($, on)
  expect(keyedProps(await pane.drawn(), 'back')).toBeNull()

  await pressRowStats(pane, 'team:acme')
  expect(keyedProps(await pane.drawn(), 'stats')).toMatchObject({ variant: 'primary' })
  expect(await drawsLine(pane, /^Scope {2}tree {2}\[acme\]/)).toBe(true)
  expect(keyedProps(await pane.drawn(), 'back')).toMatchObject({ label: '‹ back', hotkey: 'b', variant: 'secondary' })
  expect(await pane.find({ type: 'Text', text: 'Teams › Stats' })).toMatchObject({ props: { wrap: 'truncate-end' } })

  await pane.press({ key: 'back' })
  expect(keyedProps(await pane.drawn(), 'team')).toMatchObject({ variant: 'primary' })
  expect(keyedProps(await pane.drawn(), 'back')).toBeNull()

  await pressRowStats(pane, 'session:acme/api')
  expect(await drawsLine(pane, /^Scope .*\[api ×\]$/)).toBe(true)
})

test('back from a Stats tab a Teams row opened brings that row into a dock too short to hold the tree', async ($, on) => {
  const { disk } = await startWithTeam(on)
  const sessions = Array.from({ length: 60 }, (_, i) => `s${i + 1}`)
  disk.write(`${TEAMS}/acme/config.json`, [JSON.stringify({ team: { id: 'acme' }, sessions: ['lead', ...sessions], roles: { lead: 'lead' } })])
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: STATS_PROPS })
  await pane.press({ key: 'team' })
  await pressRowStats(pane, 'session:acme/s50')
  await pane.redraw(WIDE)

  await pane.press({ key: 'back' })
  expect(await drawsLine(pane, /● acme-s50\b/)).toBe(true)
  expect(await drawsLine(pane, /● acme-s1\b/)).toBe(false)
})

test("the Stats switch button drops a Teams row's back, the tab staying on the row's scope", async ($, on) => {
  const pane = await mountOnTeams($, on)
  await pressRowStats(pane, 'team:acme')

  await pane.press({ key: 'stats' })
  expect(keyedProps(await pane.drawn(), 'back')).toBeNull()
  expect(await pane.find({ type: 'Text', text: 'Teams › Stats' })).toBeUndefined()
  expect(await drawsLine(pane, /^Scope {2}tree {2}\[acme\]/)).toBe(true)
})

test("a Health count's list opened under a Teams row's back keeps its own back first; a second back leaves for the Teams tab", async ($, on) => {
  const pane = await mountOnTeams($, on)
  await pressRowStats(pane, 'team:acme')

  await pressActiveCount(pane)
  expect(await pane.find({ type: 'Text', text: /^Stats › Active/ })).toBeDefined()

  await pane.press({ key: 'back' })
  expect(keyedProps(await pane.drawn(), 'stats')).toMatchObject({ variant: 'primary' })
  expect(await pane.find({ type: 'Text', text: 'Teams › Stats' })).toBeDefined()

  await pane.press({ key: 'back' })
  expect(keyedProps(await pane.drawn(), 'team')).toMatchObject({ variant: 'primary' })
})

test("[Stats] on a Teams row shows the tab's numbers, never a Health count's list left open there", async ($, on) => {
  const pane = await mountOnTeams($, on)
  await pane.press({ key: 'stats' })
  await pressActiveCount(pane)
  await pane.press({ key: 'team' })

  await pressRowStats(pane, 'team:acme')
  expect(await pane.find({ type: 'Text', text: 'Teams › Stats' })).toBeDefined()
  expect(await drawsLine(pane, /^Health$/)).toBe(true)
})

test('the six sections after Flow draw folded, each header alone answering; a press opens one, and a name in People scopes the tab to that session', async ($, on) => {
  // A session of team web, its pointer file in /work, its register holding T1, made by lead and done by api.
  const { disk } = await start(on, {}, { roots: {}, statuses: {} }, { USERPROFILE: HOME })
  disk.write('/work/.teamrig.json', [JSON.stringify({ team: 'web' })])
  disk.write('/Homes/tester/.teamrig/teams/web/config.json', ['{}'])
  disk.write('/Homes/tester/.teamrig/teams/web/state/events.jsonl', [
    createLine('T1', { owner: 'api', by: 'lead', at: NOW - HOUR, title: 'Ship the pricing page', goals: [] }),
    statusLine('T1', 'api', NOW - HOUR / 2, 'done'),
  ])
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: STATS_PROPS })
  await pane.press({ key: 'stats' })
  for (const head of [
    /^▸ New work · 1 in 7 d · 1 with no goal$/,
    /^▸ Speed · lead time median 0\.0 d · 1 never started$/,
    /^▸ Delays · 0 overdue$/,
    /^▸ Waits · 0 waiting · owner decisions 0$/,
    /^▸ Bugs · 0 active · opened 0, fixed 0 in 7 d$/,
    /^▸ People · done in 7 d · 1 session$/,
  ]) {
    expect(await drawsLine(pane, head)).toBe(true)
  }
  const sessionKey = (keys: readonly string[]) => keys.find(key => key.startsWith('stats:session:web/api:'))
  expect(sessionKey(buttonKeys(await pane.drawn()))).toBeUndefined()

  await pane.press({ key: 'stats:people' })
  expect(await drawsLine(pane, /^▾ People · done in 7 d · 1 session$/)).toBe(true)
  const key = sessionKey(buttonKeys(await pane.drawn()))
  if (key === undefined) throw new Error("no press on api's name in People")
  await pane.press({ key })
  expect(await drawsLine(pane, /^Scope {2}tree {2}web {2}\[api ×\]$/)).toBe(true)
})

/** What `teamrig owner` prints for the acts on T1 in the tests below, by its words. */
const OWNER_ANSWERS: Readonly<Record<string, string>> = {
  'owner next T1 --preview': "PREVIEW po next T1: goes to the top of po's list; nothing written\n",
  'owner next T1': 'NEXT ○ T1 Ship the pricing page\n',
  'owner note T1 --text ship it today': 'NOTED ○ T1 Ship the pricing page\n',
}

/** A session po of team web, its pointer file in /work, its register `lines`, and the teamrig plugin's CLI installed. */
async function startActing(on: On, lines: readonly string[]) {
  const teamrig = (args: readonly string[]): string => OWNER_ANSWERS[args.join(' ')] ?? JSON.stringify({ meetings: [] })
  const started = await start(on, {}, { roots: {}, statuses: {}, teamrig }, { USERPROFILE: HOME, CLAUDE_CONFIG_DIR: CLAUDE_DIR, TEAMRIG_SESSION: 'po' })
  started.disk.write('/work/.teamrig.json', [JSON.stringify({ team: 'web' })])
  started.disk.write(`${TEAMS}/web/config.json`, ['{}'])
  started.disk.write(`${TEAMS}/web/state/events.jsonl`, [...lines])
  started.disk.write(`${CLAUDE_DIR}/plugins/installed_plugins.json`, [JSON.stringify({ version: 2, plugins: { 'teamrig@teamrig': [{ installPath: TEAMRIG_INSTALL }] } })])
  started.disk.write(`${TEAMRIG_INSTALL}/dist/cli/main.js`, [''])
  return started
}

/** The owner-act presses drawn (press-keys.ts actKey), in drawing order. */
async function actKeys(pane: Mounted<'Pane'>): Promise<string[]> {
  return buttonKeys(await pane.drawn()).filter(key => key.startsWith('act:'))
}

test("an open card ends in the owner's Note and Next: Note sends the typed text through teamrig owner note, Next runs owner next after its preview's confirm", async ($, on) => {
  const T1 = createLine('T1', { owner: 'po', by: 'lead', at: NOW - HOUR, title: 'Ship the pricing page' })
  const { clock, disk, runs } = await startActing(on, [T1])
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: WIDE })
  const ownerRuns = () => runs.filter(run => run.startsWith('teamrig owner '))
  const RESTING = ['act:note:T1', 'act:next:T1']

  // A closed card draws no act; the open one ends in Note and Next.
  await pane.press({ key: 'all' })
  expect(await actKeys(pane)).toEqual([])
  await pane.press({ key: 'po:T1' })
  expect(await actKeys(pane)).toEqual(RESTING)

  // Note opens an empty field, Send and Cancel in place of the presses; typing runs nothing, Enter sends it.
  await pane.press({ key: 'act:note:T1' })
  expect(keyedProps(await pane.drawn(), 'note:T1:1')).toMatchObject({ value: '', submitLabel: 'Send' })
  expect(await actKeys(pane)).toEqual(['act:send:T1', 'act:cancel:T1'])
  await pane.input({ key: 'note:T1:1', text: 'ship it today', kind: 'change' })
  expect(ownerRuns()).toEqual([])
  // While the field is open the pane draws the register as it stood at the opening: a task added above the card
  // would move the ring off the field (note-hold.ts).
  disk.write(`${TEAMS}/web/state/events.jsonl`, [T1, createLine('T2', { owner: 'po', by: 'lead', at: NOW, priority: 1, title: 'Rotate the key' })])
  await clock.advance(POLL_MS)
  expect(await drawsLine(pane, /T2 +Rotate the key/)).toBe(false)
  await pane.input({ key: 'note:T1:1', text: 'ship it today' })
  expect(ownerRuns()).toEqual(['teamrig owner note T1 --text ship it today'])
  expect(await drawsLine(pane, /^│ NOTED ○ T1 Ship the pricing page$/)).toBe(true)
  expect(keyedProps(await pane.drawn(), 'note:T1:1')).toBeNull()
  expect(await actKeys(pane)).toEqual(RESTING)
  expect(await drawsLine(pane, /T2 +Rotate the key/)).toBe(true)

  // Next reads the preview into a confirm and writes nothing; Cancel closes it, Confirm runs owner next.
  const PREVIEW = /^│ PREVIEW po next T1: goes to the top of po's list; nothing written$/
  await pane.press({ key: 'act:next:T1' })
  expect(ownerRuns().slice(1)).toEqual(['teamrig owner next T1 --preview'])
  expect(await drawsLine(pane, PREVIEW)).toBe(true)
  expect(await actKeys(pane)).toEqual(['act:confirm:T1', 'act:cancel:T1'])
  await pane.press({ key: 'act:cancel:T1' })
  expect(await drawsLine(pane, PREVIEW)).toBe(false)
  expect(await actKeys(pane)).toEqual(RESTING)
  await pane.press({ key: 'act:next:T1' })
  await pane.press({ key: 'act:confirm:T1' })
  expect(ownerRuns().slice(1)).toEqual(['teamrig owner next T1 --preview', 'teamrig owner next T1 --preview', 'teamrig owner next T1'])
  expect(await drawsLine(pane, /^│ NEXT ○ T1 Ship the pricing page$/)).toBe(true)
  expect(await actKeys(pane)).toEqual(RESTING)

  // Inline the card draws its presses as words, so no act at all.
  await pane.redraw({ ...WIDE, placement: 'inline' })
  expect(await drawsLine(pane, /│ Status /)).toBe(true)
  expect(await actKeys(pane)).toEqual([])
})

test('an open card draws no owner act with no team to run it through', async ($, on) => {
  await start(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: WIDE })
  await pane.press({ key: 'next:T1' })
  expect(await pane.find({ text: /│ Status/ })).toBeDefined()
  expect(await actKeys(pane)).toEqual([])
})
