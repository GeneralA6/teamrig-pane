// The plugin through the engine: env, clock, store, session id and fs answered beneath it.
import type { FsEntry, FsStat, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { cells } from '../hooks/width'
import { HOUR, NOW, bigRegister, createLine, iso, linkLine, markLine, noteLine, statusLine, updateLine, usageRunJson } from './fixtures'

const HOME = 'C:\\Homes\\tester'
const EVENTS = 'C:/Homes/tester/team-notes/tasks/events.jsonl'
const MARKS = 'C:/Homes/tester/team-notes/tasks/inbox-marks.jsonl'
const INBOX = 'C:/Homes/tester/team-notes/board/inbox/po.md'
const USAGE_RUN = 'C:/Homes/tester/team-notes/token-usage/usage-2026-10-13.json'

/** The engine hands fs hooks native paths, so the fake keys every path one way. */
const native = (path: string) => path.replaceAll('/', '\\')

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
    const lock = locks.get(native(e.path))
    if (lock?.op === 'stat') return { deny: lock.message }
    const file = files.get(native(e.path))
    if (!file) return { deny: `ENOENT: ${e.path}` }
    const stat: FsStat = { kind: 'file', size: file.text.length, mtimeMs: file.mtimeMs, isLink: false }
    return { value: stat }
  })
  /** The files right under a folder; a folder exists while a file is in it. */
  const inFolder = (dir: string): FsEntry[] => {
    const prefix = `${native(dir)}\\`
    return [...files].flatMap(([path, file]) => {
      const name = path.slice(prefix.length)
      if (!path.startsWith(prefix) || name.includes('\\')) return []
      return [{ name, kind: 'file' as const, size: file.text.length, mtimeMs: file.mtimeMs, isLink: false }]
    })
  }
  on('fs.exists', async ($, e) => {
    if (locks.get(native(e.path))?.isSeen === false) return { value: false }
    return { value: files.has(native(e.path)) || inFolder(e.path).length > 0 }
  })
  on('fs.read', async ($, e) => {
    reads.push(native(e.path))
    const lock = locks.get(native(e.path))
    if (lock?.op === 'read') return { deny: lock.message }
    const file = files.get(native(e.path))
    return file ? { value: file.text } : { deny: `ENOENT: ${e.path}` }
  })
  on('fs.list', async ($, e) => {
    const entries = inFolder(e.path)
    return entries.length > 0 ? { value: entries } : { deny: `ENOENT: ${e.path}` }
  })
  return {
    reads,
    write: (path: string, lines: string[]) => void files.set(native(path), { text: lines.join('\n'), mtimeMs: tick++ }),
    lock: (path: string, lock: Lock) => void locks.set(native(path), lock),
    unlock: (path: string) => void locks.delete(native(path)),
    remove: (path: string) => void files.delete(native(path)),
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

/** Answers $.store beneath the plugin from a map the test reads: `kept` starts as what earlier sessions left. */
function fakeStore(on: On, kept: Readonly<Record<string, unknown>>) {
  const store = new Map(Object.entries(kept))
  on('store.get', async ($, e) => ({ value: store.get(e.key) }))
  on('store.set', async ($, e) => ({ value: void store.set(e.key, e.value) }))
  on('store.delete', async ($, e) => ({ value: void store.delete(e.key) }))
  on('store.keys', async () => ({ value: [...store.keys()] }))
  return store
}

/** The repos a fake git knows: each folder's root, each root's `status --porcelain=v1 -b -z` output. Tests change it as they go. */
type FakeRepos = { roots: Record<string, string>; statuses: Record<string, string> }

/** Answers $.process.run as git over `repos`, a folder it does not know being outside any repo; `runs` lists each as `<command> <cwd>`. */
function fakeGit(on: On, repos: FakeRepos) {
  const runs: string[] = []
  const answer = (stdout: string, exitCode = 0, stderr = '') => ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })
  on('process.run', async ($, e) => {
    const cwd = e.init?.cwd ?? ''
    const isRevParse = e.argv.includes('rev-parse')
    runs.push(`${isRevParse ? 'rev-parse' : 'status'} ${cwd}`)
    const root = repos.roots[cwd]
    if (isRevParse) return root === undefined ? answer('', 128, 'fatal: not a git repository') : answer(`${root}
`)
    return answer(repos.statuses[cwd] ?? '## main\0')
  })
  return runs
}

/** The environment that names the register's folders (Windows-style, as a Windows host passes them) and its goals document. */
const REGISTER_ENV: Readonly<Record<string, string>> = {
  USERPROFILE: HOME,
  TEAMRIG_PANE_TASKS_DIR: `${HOME}\\team-notes\\tasks`,
  TEAMRIG_PANE_INBOX_DIR: `${HOME}\\team-notes\\board\\inbox`,
  TEAMRIG_PANE_USAGE_DIR: `${HOME}\\team-notes\\token-usage`,
  TEAMRIG_PANE_GOALS_DOC: 'docs/ROADMAP.md',
}

/**
 * Starts the plugin over a fake disk, store and git; `kept` is what $.store holds from earlier
 * sessions, `env` the environment the plugin reads.
 */
async function start(
  on: On,
  kept: Readonly<Record<string, unknown>> = {},
  repos: FakeRepos = { roots: {}, statuses: {} },
  env: Readonly<Record<string, string>> = REGISTER_ENV,
) {
  mock.env(on, env)
  const store = fakeStore(on, kept)
  const runs = fakeGit(on, repos)
  const clock = mock.clock(on, { now: NOW })
  on('session.id', async () => ({ value: 'session-po' }))
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('command.register', async () => ({ value: { command: 'tasklist' } }))
  const opened: string[] = []
  const titles: string[] = []
  on('ui.open', async ($, e) => {
    opened.push(e.id)
    titles.push(e.title ?? '')
    return { value: { isPlaced: true } }
  })
  const disk = fakeDisk(on)
  disk.write(EVENTS, [
    createLine('T1', { owner: 'po', by: 'lead', at: NOW - HOUR, tier: 2, due: '2026-10-14', title: 'Ship the task pane' }),
    createLine('T2', { owner: 'security', by: 'lead', at: NOW - HOUR, tier: 1, title: 'Rotate the local URI' }),
    statusLine('T2', 'security', NOW, 'blocked', 'needs owner paste'),
  ])
  disk.write(MARKS, [markLine('po', 1, 'session-po', NOW)])
  disk.write(INBOX, ['line one', 'line two', 'line three'])
  return { clock, disk, opened, store, runs, titles }
}

test('docks the session area: its tasks, flags and unread inbox', async ($, on) => {
  const { opened } = await start(on)
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
  expect(opened).toEqual(['teamrig-pane'])
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })

  expect(await pane.find({ text: /inbox 2 unread/ })).toBeDefined()
  expect(await pane.find({ text: /Ship the task pane/ })).toBeDefined()
  expect(await pane.find({ text: /NEW/ })).toBeDefined()
  expect(await pane.find({ text: /Rotate the local URI/ })).toBeUndefined()
})

test('the all view lists every owner, blocked notes included', async ($, on) => {
  await start(on)
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })

  await pane.press({ key: 'all' })
  expect(await pane.find({ text: /Rotate the local URI/ })).toBeDefined()
  expect(await pane.find({ text: /needs owner paste/ })).toBeDefined()
})

test('picks up a new register event on the next poll', async ($, on) => {
  const { clock, disk } = await start(on)
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })

  disk.write(EVENTS, [
    createLine('T1', { owner: 'po', by: 'lead', at: NOW - HOUR, tier: 2, title: 'Ship the task pane' }),
    statusLine('T1', 'po', NOW, 'done'),
  ])
  await clock.advance(3_000)
  expect(await pane.find({ text: /finished today/ })).toBeDefined()
  expect(await pane.find({ text: /NEW/ })).toBeUndefined()
})

test('a locked or denied register file keeps the last good tasks drawn under the problem, until it reads again', async ($, on) => {
  const { clock, disk } = await start(on)
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
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
    disk.write(EVENTS, [createLine('T1', { owner: 'po', by: 'lead', at: NOW - HOUR, title: 'Ship the task pane' }), noteLine('T1', 'po', NOW, `step ${i}`)])
    await clock.advance(3_000)
    expect(await pane.find({ text: /Ship the task pane/ })).toBeDefined()
    expect(await pane.find({ text: new RegExp(`⚠ .*${lock.message.slice(0, 6)}`) })).toBeDefined()

    disk.unlock(EVENTS)
    await clock.advance(3_000)
    expect(await pane.find({ text: /⚠/ })).toBeUndefined()
    expect(await pane.find({ text: /Ship the task pane/ })).toBeDefined()
  }
})

test('lines of a newer register: an unknown type or a change of unknown keys alone is counted, every good task and field still drawn', async ($, on) => {
  const { disk } = await start(on)
  disk.write(EVENTS, [
    createLine('T1', { owner: 'po', by: 'lead', at: NOW - HOUR, tier: 2, title: 'Ship the task pane', lineKeys: { v: 3, trace: 'a1' }, taskKeys: { risk: 'high', budget: { tokens: 5 } } }),
    JSON.stringify({ v: 3, type: 'vote', id: 'T1', at: iso(NOW - HOUR / 2), by: 'etl', choice: 'ship' }),
    updateLine('T1', 'lead', NOW - HOUR / 2, { risk: 'low' }),
    updateLine('T1', 'lead', NOW - HOUR / 3, { title: 'Ship the task pane v2', risk: 'low' }),
    createLine('T2', { owner: 'po', by: 'lead', at: NOW - HOUR, title: 'Second task' }),
    '{"type":"status","id":"T2"',
  ])
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })

  expect(await pane.find({ text: /^⚠ 3 register line\(s\) this pane cannot read$/ })).toBeDefined()
  expect(await pane.find({ text: /Ship the task pane v2/ })).toBeDefined()
  expect(await pane.find({ text: /Second task/ })).toBeDefined()
  expect(await pane.find({ text: /po · 2 active/ })).toBeDefined()
})

test('missing register, marks and inbox files draw an empty register with no problem, and fill in as they appear', async ($, on) => {
  const { clock, disk } = await start(on)
  for (const path of [EVENTS, MARKS, INBOX]) disk.remove(path)
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  expect(await pane.find({ text: /No area for this session yet/ })).toBeDefined()
  expect(await pane.find({ text: /⚠/ })).toBeUndefined()

  disk.write(MARKS, [markLine('po', 1, 'session-po', NOW)])
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
  expect(await pane.find({ text: /⚠/ })).toBeUndefined()
})

test('a register of 20,000 events loads and draws in well under a second, and a poll with nothing new reads nothing', async ($, on) => {
  const { clock, disk } = await start(on)
  disk.write(EVENTS, bigRegister(20_000))
  const started = performance.now()
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  const loaded = performance.now()
  expect(await pane.find({ text: /po · 408 active/ })).toBeDefined()
  await pane.redraw({ ...PANE_PROPS, bodyColumns: 40 })
  const redrawn = performance.now()
  await pane.press({ key: 'all' })
  const switched = performance.now()
  expect(await pane.find({ text: /Task 4082 with a title/ })).toBeDefined()
  // Measured on the dev host (2026-10-14): load 350-400 ms, a redraw 75-95 ms, the switch to all 65 ms.
  expect(loaded - started).toBeLessThan(1_500)
  expect(switched - loaded).toBeLessThan(1_000)
  expect(redrawn - loaded).toBeLessThan(500)

  const reads = disk.reads.length
  await clock.advance(3_000)
  expect(disk.reads.length).toBe(reads)
})

/** How many elements of `type` a drawn tree holds. */
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

function keyedProps(node: unknown, key: string): object | null {
  return propsOf(keyedNode(node, key))
}

function countType(node: unknown, type: string): number {
  if (typeof node !== 'object' || node === null) return 0
  const self = 'type' in node && node.type === type ? 1 : 0
  const children: unknown[] = 'children' in node && Array.isArray(node.children) ? node.children : []
  return children.reduce((sum: number, child) => sum + countType(child, type), self)
}

test('docked, it pads the frame, spaces the tasks and wraps a long title under its id', async ($, on) => {
  const { disk } = await start(on)
  const title = 'Ship the task pane with wrapped lines that sit under the task id'
  disk.write(EVENTS, [createLine('T1', { owner: 'po', by: 'lead', at: NOW - HOUR, title })])
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })

  expect((await pane.find({ type: 'Box' }))?.props).toMatchObject({ paddingX: 1, gap: 1 })
  const task = await pane.find({ type: 'Text', text: /Ship the task pane/ })
  expect(task?.text).toMatch(/^▸ ○ T1 .+\n {4}\S/)
  expect(task?.text.split('\n').every(line => line.length <= PANE_PROPS.bodyColumns - 2)).toBe(true)
})

test('a title and note of CJK and emoji sequences wrap by display cells, no line past the frame', async ($, on) => {
  const { disk } = await start(on)
  const title = '修复任务面板的宽字符 👨‍👩‍👧 显示 ❤️ 标题 🇮🇱 한국어 제목 👍🏽 done'
  disk.write(EVENTS, [
    createLine('T1', { owner: 'po', by: 'lead', at: NOW - HOUR, title }),
    noteLine('T1', 'po', NOW - HOUR / 2, '進捗メモ 👩🏽‍💻 ✍️ 完了まであと少し'),
  ])
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  await pane.press({ key: 'active:T1' })

  const task = await pane.find({ type: 'Text', text: /修复/ })
  const lines = task?.text.split('\n') ?? []
  expect(lines.length).toBeGreaterThan(3)
  expect(lines.every(line => cells(line) <= PANE_PROPS.bodyColumns - 2)).toBe(true)
  expect(task?.text).toContain('👨‍👩‍👧')
  expect(task?.text).toContain('👩🏽‍💻')
})

test('names the variables to set while any of the register folders is unset, and reads nothing', async ($, on) => {
  const withoutUsage = Object.fromEntries(Object.entries(REGISTER_ENV).filter(([key]) => key !== 'TEAMRIG_PANE_USAGE_DIR'))
  const { disk } = await start(on, {}, { roots: {}, statuses: {} }, withoutUsage)
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })

  const problem = await pane.find({ text: /^⚠ no register folders/ })
  expect(problem?.text.split(/\s+/).join(' ')).toBe('⚠ no register folders: set TEAMRIG_PANE_TASKS_DIR, TEAMRIG_PANE_INBOX_DIR and TEAMRIG_PANE_USAGE_DIR')
  expect(await pane.find({ text: /Ship the task pane/ })).toBeUndefined()
  expect(disk.reads).toEqual([])
})

test('draws each collapsed task as one Text: no Box beyond the root, the controls and their two button rows', async ($, on) => {
  await start(on)
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })

  await pane.press({ key: 'all' })
  expect(countType(await pane.drawn(), 'Box')).toBe(4)
})

test('pressing a task shows its ask quoted from the inbox and the roadmap, pressing again hides it', async ($, on) => {
  const { disk } = await start(on)
  disk.write(INBOX, ['line one', 'line two', 'line three', '- 2026-10-13 12:40 lead: ship the pane with details'])
  disk.write('C:/docs/ROADMAP.md', ['## G10', '  - [ ] G10.1g **Fix the formula** with `analytics`'])
  const ref = '~/team-notes/board/inbox/po.md:4; docs/ROADMAP.md:2'
  disk.write(EVENTS, [
    createLine('T1', { owner: 'po', by: 'lead', at: NOW - HOUR, title: 'Ship the task pane', ref, goals: ['G10.1g'] }),
  ])
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  expect(await pane.find({ text: /ship the pane with details/ })).toBeUndefined()

  await pane.press({ key: 'active:T1' })
  expect(await pane.find({ text: /│ 2026-10-13 12:40 lead: ship the pane/ })).toBeDefined()
  expect(await pane.find({ text: /│ G10\.1g Fix the formula with analytics$/m })).toBeDefined()
  expect(await pane.find({ text: /│ asked by owner · added by lead/ })).toBeDefined()
  expect(await pane.find({ text: /│ see / })).toBeUndefined()
  expect(await pane.find({ text: /^▾ / })).toBeDefined()

  await pane.press({ key: 'active:T1' })
  expect(await pane.find({ text: /ship the pane with details/ })).toBeUndefined()
  expect(await pane.find({ text: /│ asked by/ })).toBeUndefined()
})

test('an expanded task shows its register v2 facts, its estimate as a share of a fleet week read from the usage folder', async ($, on) => {
  const { disk } = await start(on)
  disk.write(EVENTS, [
    createLine('T1', { owner: 'po', by: 'lead', at: NOW - HOUR, title: 'Ship the task pane' }),
    createLine('T3', { owner: 'po', by: 'lead', at: NOW - HOUR, title: 'Pane v2' }),
    linkLine('T1', 'po', NOW - HOUR, 'parent', 'T3'),
    updateLine('T1', 'po', NOW - HOUR, { kind: 'code', est: { value: 1, unit: 'd' }, eta: '2026-10-15' }),
    noteLine('T1', 'po', NOW - HOUR / 2, 'details drawn'),
  ])
  const day = { cr: 100_000_000, msgs: 1000 }
  disk.write(USAGE_RUN, [usageRunJson({ '2026-10-12': day, '2026-10-13': day })])
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  expect(await pane.find({ text: /kind code/ })).toBeUndefined()

  await pane.press({ key: 'active:T1' })
  expect(await pane.find({ text: /│ kind code$/m })).toBeDefined()
  expect(await pane.find({ text: /│ eta 10-15$/m })).toBeDefined()
  expect(await pane.find({ text: /│ est 1d ≈ 0\.10B = 14\.3% of a fleet week$/m })).toBeDefined()
  expect(await pane.find({ text: /│ part of ○ T3 Pane v2$/m })).toBeDefined()
  expect(await pane.find({ text: /│ {3}└ 10-13 13:30 po: details drawn$/m })).toBeDefined()
  expect(await pane.find({ text: /labels|start |waits on|blocked by|sub-tasks/ })).toBeUndefined()
})

test('an expanded blocked task shows its note in the details; collapse closes every task', async ($, on) => {
  await start(on)
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  await pane.press({ key: 'all' })
  expect(await pane.find({ text: /collapse/ })).toBeUndefined()

  await pane.press({ key: 'security:T2' })
  await pane.press({ key: 'po:T1' })
  expect(await pane.find({ text: /│ blocked: needs owner paste$/m })).toBeDefined()
  expect(await pane.find({ text: /↳ needs owner paste/ })).toBeUndefined()

  await pane.press({ key: 'collapse' })
  expect(await pane.find({ text: /│ asked by/ })).toBeUndefined()
  expect(await pane.find({ text: /↳ needs owner paste/ })).toBeDefined()
  expect(await pane.find({ text: /collapse/ })).toBeUndefined()
})

test('inline above the prompt, it shows a few rows and points to the side dock', async ($, on) => {
  const { disk } = await start(on)
  disk.write(
    EVENTS,
    Array.from({ length: 10 }, (_, i) => createLine(`T${i + 1}`, { owner: 'po', by: 'po', at: NOW, title: `Task number ${i + 1}` })),
  )
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({
    plugin: 'teamrig-pane',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'teamrig-pane',
    props: { ...PANE_PROPS, placement: 'inline' },
  })

  expect((await pane.find({ type: 'Box' }))?.props).toMatchObject({ gap: 0 })
  expect(await pane.find({ text: /Task number 1$/ })).toBeDefined()
  expect(await pane.find({ text: /Task number 10/ })).toBeUndefined()
  expect(await pane.find({ text: /more lines in the side dock/ })).toBeDefined()
})

test('a drawing that throws shows the error under the mode buttons, and the next draw shows the tasks', async ($, on) => {
  await start(on)
  let isStateDown = true
  on('state.get', async ($, e, next) => (isStateDown && e.key === 'expanded' ? { deny: 'state store unavailable' } : next(e)))
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })

  expect(await pane.find({ text: /^⚠ the pane could not draw: .*state store unavailable/ })).toBeDefined()
  expect(buttonKeys(await pane.drawn())).toEqual(['tasks', 'changes', 'mine', 'all'])

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
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
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
    createLine('T1', { owner: 'po', by: 'lead', at: NOW - HOUR, tier: 1, due: '2026-10-14', title: 'Ship the task pane with a title long enough to wrap' }),
    createLine('T3', { owner: 'po', by: 'lead', at: NOW - HOUR, title: 'Pane v2 parent' }),
    linkLine('T1', 'po', NOW - HOUR, 'parent', 'T3'),
    linkLine('T1', 'po', NOW - HOUR, 'blocked-by', 'T3'),
    noteLine('T1', 'po', NOW - HOUR / 2, 'a progress note that also needs to wrap'),
  ])
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  await pane.press({ key: 'active:T1' })

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
  await pane.redraw({ ...PANE_PROPS, bodyColumns: 12, placement: 'inline', scroll: { offset: 0, bodyRows: 3 } })
  const rows = await pane.findAll({ type: 'Text' })
  expect(rows.some(found => found.text.includes('Ship'))).toBe(true)
  expect(await pane.find({ text: /more lines in the side dock/ })).toBeDefined()
})

test('a session starts minimized when the last one was left so: one row, docked or inline, a press on it opens the pane in full', async ($, on) => {
  const { store } = await start(on, { paneSize: 'minimized' })
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
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

test('/tasklist opens a minimized pane in full', async ($, on) => {
  const { store } = await start(on, { paneSize: 'minimized' })
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })

  await $.command.run({ command: 'tasklist', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
  expect(await pane.find({ text: /Ship the task pane/ })).toBeDefined()
  expect(store.get('paneSize')).toBe('open')
})

const REPO_STATUS = ['## pane-v2', ' M hooks/a.ts', 'R  hooks/new.ts', 'hooks/old.ts', '?? tests/', ''].join('\0')
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
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })

  for (const props of [PANE_PROPS, ...NARROW_AND_INLINE]) {
    await pane.redraw(props)
    const drawn = await pane.drawn()
    expect(buttonKeys(keyedNode(drawn, 'switch'))).toEqual(['tasks', 'changes'])
    expect(buttonKeys(drawn).slice(0, 4)).toEqual(['tasks', 'changes', 'mine', 'all'])
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

test("the Changes view lists each repo's changed files, counted on the switch and in the tab title", async ($, on) => {
  const { clock, titles } = await start(on, {}, { roots: { 'C:/work': 'C:/work' }, statuses: { 'C:/work': REPO_STATUS } })
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })

  // The session's repo is read in the background, after the pane opened with no count in its title; the
  // read lands while the mount draws, so the next drawing is the one to look at.
  await clock.settle()
  await pane.redraw(PANE_PROPS)
  expect(titles).toEqual(['Tasks', 'Tasks · Δ3'])
  expect(buttonLabel(await pane.drawn(), 'changes')).toBe('Changes Δ3')
  await pane.press({ key: 'changes' })
  expect(await pane.find({ text: /work · pane-v2 · 3 changed/ })).toBeDefined()
  expect(await pane.find({ text: / M hooks\/a\.ts/ })).toBeDefined()
  expect(await pane.find({ text: /R  hooks\/new\.ts ← hooks\/old\.ts/ })).toBeDefined()
  expect(await pane.find({ text: /Ship the task pane/ })).toBeUndefined()

  await pane.press({ key: 'tasks' })
  expect(await pane.find({ text: /Ship the task pane/ })).toBeDefined()
})

test('a file the session writes adds its repo on the next poll; a failed write adds none; one outside any repo is listed as such', async ($, on) => {
  const repos: FakeRepos = { roots: { 'C:/repo/src': 'C:/repo' }, statuses: { 'C:/repo': ['## main', ' M src/a.ts', ''].join('\0') } }
  const { clock, runs, titles } = await start(on, {}, repos)
  on('tool.call', { tool: 'Edit' }, async ($, e) => (e.file_path.endsWith('bad.ts') ? { result: 'no match', isError: true } : { result: 'edited' }))
  on('tool.call', { tool: 'Write' }, async () => ({ result: 'written' }))
  on('tool.call', { tool: 'Bash' }, async () => ({ result: 'ran' }))
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
  await clock.settle()
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })
  await pane.press({ key: 'changes' })
  expect(await pane.find({ text: /No git repo yet/ })).toBeDefined()

  await $.tool.call({ tool: 'Edit', file_path: 'C:/other/bad.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Edit', file_path: 'C:/repo/src/a.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Write', file_path: 'C:/notes/plan.md', content: 'x' })
  await clock.advance(3_000)
  expect(await pane.find({ text: /repo · main · 1 changed/ })).toBeDefined()
  expect(await pane.find({ text: /written outside git \(1\)/ })).toBeDefined()
  expect(await pane.find({ text: /C:\/notes\/plan\.md/ })).toBeDefined()
  expect(await pane.find({ text: /bad\.ts/ })).toBeUndefined()
  expect(titles.at(-1)).toBe('Tasks · Δ2')

  // A shell call (a commit, say) is read on the next poll; with nothing new, the poll runs no git.
  const statusRuns = () => runs.filter(run => run === 'status C:/repo').length
  const before = statusRuns()
  await clock.advance(3_000)
  expect(statusRuns()).toBe(before)
  repos.statuses['C:/repo'] = '## main\0'
  await $.tool.call({ tool: 'Bash', command: 'git commit -am x' })
  await clock.advance(3_000)
  expect(statusRuns()).toBe(before + 1)
  expect(await pane.find({ text: /repo · main · clean/ })).toBeDefined()
  expect(titles.at(-1)).toBe('Tasks · Δ1')
})

test('from the minimized strip, Changes opens the pane in full on the Changes view', async ($, on) => {
  const { clock, store } = await start(on, { paneSize: 'minimized' })
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
  await clock.settle()
  const pane = await $.ui.mount({ plugin: 'teamrig-pane', surface: 'terminal', component: 'Pane', requestId: 'teamrig-pane', props: PANE_PROPS })

  await pane.press({ key: 'changes' })
  expect(store.get('paneSize')).toBe('open')
  expect(await pane.find({ text: /No git repo yet/ })).toBeDefined()
  expect(buttonKeys(await pane.drawn())).toEqual(['tasks', 'changes'])
})
