// One drawing of the pane read from a store kept in memory: no engine, as a front end other than the Claude Code dock
// reads it. Each view's body is held to its own blocks laid out, so the screen adds no row and drops none.
import { describe, expect, test } from 'claude-code/testing'
import type { BarStatus, LogConversation, LogList, LogPage, PaneState, Place, RefFileRead, SetupView, Snapshot, TaskRow, TeamView } from '../types'
import { changesBlocks } from '../hooks/changes-rows'
import { searchChanges } from '../hooks/changes-search'
import { readRegister } from '../hooks/core/read/index'
import { doneBlocks } from '../hooks/done-rows'
import { filePageBlocks } from '../hooks/file-page'
import { FIRST_MEMO, type KeysMemo, type KeysWords } from '../hooks/find-field'
import { inboxBlocks } from '../hooks/inbox-rows'
import { searchInbox } from '../hooks/inbox-search'
import { keysBlocks } from '../hooks/keys-page'
import { WrapCache, dockLayout, inlineLayout } from '../hooks/layout'
import { rowOf } from '../hooks/log'
import { logListBlocks, logPageBlocks, logPageTitle } from '../hooks/log-rows'
import { searchLog } from '../hooks/log-search'
import { meetingsBlocks } from '../hooks/meetings-rows'
import { treeOf as goalTreeOf } from '../hooks/meta'
import { AT_LIST, KEYS_PAGE, doneAt, fromList, pushed, searched } from '../hooks/nav'
import { NoteHold } from '../hooks/note-hold'
import { pageBlocks } from '../hooks/page'
import { INITIAL_STATE } from '../hooks/pane-state'
import { MemoryStore, type PaneKey, type PaneStore } from '../hooks/pane-store'
import { requirementBlocks } from '../hooks/requirements'
import { NOTHING_EXPANDED, NOTHING_FOLDED, paneBlocks, type Block } from '../hooks/rows'
import { INLINE_MAX_ROWS, screenOf, type ScreenLook } from '../hooks/screen'
import { searchBlocks } from '../hooks/search-rows'
import { setupBlocks } from '../hooks/setup-rows'
import { statsBlocks } from '../hooks/stats-rows'
import { statusBar, type StatusBar } from '../hooks/status-bar'
import { searchTasks } from '../hooks/task-search'
import { sessionKey } from '../hooks/team'
import { teamBlocks } from '../hooks/team-rows'
import { searchTeam } from '../hooks/team-search'
import { clockOf } from '../hooks/zone'
import { HOUR, NOW, NO_TEAM, SNAPSHOT_SETTINGS, createLine } from './fixtures'
import { ACME, treeOf } from './team-fixtures'

const COLUMNS = 56
const ROWS = 30

/** The rows teamrig's reader folds from event lines. */
function rowsOf(lines: readonly string[]): TaskRow[] {
  return [...readRegister(lines.join('\n')).state.tasks.values()].map(task => rowOf(task))
}

const TASKS = rowsOf([
  createLine('T58', { owner: 'etl', by: 'lead', at: NOW - HOUR, title: 'Load the feed' }),
  createLine('T50', { owner: 'po', by: 'lead', at: NOW - HOUR, title: 'Ship the pages', ref: 'docs/x.md:3' }),
  createLine('T51', { owner: 'po', by: 'lead', at: NOW - HOUR, title: 'Draw the feed chart' }),
  createLine('T52', { owner: 'po', by: 'lead', at: NOW - HOUR, title: 'Name the columns' }),
  createLine('T53', { owner: 'po', by: 'lead', at: NOW - HOUR, title: 'Count the rows' }),
  createLine('T54', { owner: 'po', by: 'lead', at: NOW - HOUR, title: 'Fold the weeks' }),
  createLine('T55', { owner: 'po', by: 'lead', at: NOW - HOUR, title: 'Sort the owners' }),
])
const SNAP: Snapshot = { tasks: TASKS, area: 'po', areaSource: 'pinned', unreadInbox: null, inbox: [], problem: null, ...NO_TEAM, ...SNAPSHOT_SETTINGS, now: NOW }

/** A store that starts as a pane does with the register read, but for `changed`. */
const from = (changed: Partial<PaneState> = {}) => new MemoryStore({ ...INITIAL_STATE, snapshot: SNAP, ...changed })

/** A front end's own words on the keys. */
const KEYS: KeysWords = { leave: { search: 'Esc: out', result: null, pane: 'x: quit' }, away: 'Keys are elsewhere', page: [{ name: 'quit', keys: 'x', words: ': quit' }] }

/** A docked front end that holds the keys, but for `changed`. */
const look = (changed: Partial<ScreenLook> = {}): ScreenLook => ({
  inline: false,
  columns: COLUMNS,
  bodyRows: ROWS,
  canAct: false,
  isHeld: true,
  memo: FIRST_MEMO,
  noteHold: new NoteHold<Snapshot>(),
  wraps: new WrapCache(),
  hostOld: running => `host ${running.major}.${running.minor}.${running.patch} is too old`,
  tieHint: null,
  keys: KEYS,
  ...changed,
})

/** The status bar over the fixture's tasks, failing the test when it draws none. */
function barOf(filter: BarStatus | null): StatusBar {
  const bar = statusBar(SNAP, filter, COLUMNS)
  if (bar === null) throw new Error('no status bar')
  return bar
}

const docked = (blocks: readonly Block[]) => dockLayout(blocks, COLUMNS)
const task = (id: string): Place => ({ kind: 'task', id })
const SEARCH = (query: string) => searched(AT_LIST, query)

/** A store whose read of `failing` throws; every other key reads as `inner` holds it. */
function failingAt(inner: PaneStore, failing: PaneKey): PaneStore {
  return {
    read: key => (key === failing ? Promise.reject(new Error(`no ${failing}`)) : inner.read(key)),
    update: (key, change) => inner.update(key, change),
  }
}

/** A store that keeps the keys read from it, in order. */
function recording(inner: PaneStore): { readonly store: PaneStore; readonly keys: PaneKey[] } {
  const keys: PaneKey[] = []
  return {
    keys,
    store: {
      read: key => {
        keys.push(key)
        return inner.read(key)
      },
      update: (key, change) => inner.update(key, change),
    },
  }
}

const CONVERSATION: LogConversation = { session: 'po', claude: 'c-1', firstAt: NOW - 2 * HOUR, lastAt: NOW - HOUR, nextAt: null, lines: 4, opening: null }
const LOGS: LogList = { kind: 'conversations', hours: 24, conversations: [CONVERSATION] }
const LOG_PAGE: LogPage = { session: 'po', claude: 'c-1', hours: 24, entries: [], isCut: false, problem: null }

describe('the tasks view', () => {
  test('the list of the session’s own tasks shows under the status bar, filtered by the status the bar holds', async () => {
    const bar = barOf(null)
    const screen = await screenOf(from(), look())
    expect(screen.current).toBe('tasks')
    expect(screen.shown).toBe('mine')
    expect(screen.isMinimized).toBe(false)
    expect(screen.snap).toBe(SNAP)
    expect(screen.barLines).toEqual(bar.lines)
    expect(screen.barLines.length).toBeGreaterThan(0)
    expect(screen.body).toEqual(docked(paneBlocks(SNAP, 'mine', NOTHING_EXPANDED, bar.filter, NOTHING_FOLDED, null)))
    expect(screen.body.length).toBeGreaterThan(0)

    const filtered = barOf('not-started')
    const narrowed = await screenOf(from({ filter: 'not-started' }), look())
    expect(narrowed.barLines).toEqual(filtered.lines)
    expect(narrowed.body).toEqual(docked(paneBlocks(SNAP, 'mine', NOTHING_EXPANDED, filtered.filter, NOTHING_FOLDED, null)))
  })

  test('every owner’s tasks show with no bar, the folded headings left folded', async () => {
    const screen = await screenOf(from({ mode: 'all', tasksFolded: ['owner:etl'] }), look())
    expect(screen.shown).toBe('all')
    expect(screen.barLines).toEqual([])
    expect(screen.body).toEqual(docked(paneBlocks(SNAP, 'all', NOTHING_EXPANDED, null, ['owner:etl'], null)))
  })

  test('a tab tied to no session shows the front end’s words for tying one, in Tasks and in Inbox, and none for a front end without them', async () => {
    const untied: Snapshot = { ...SNAP, area: null, areaSource: null }
    const tie = 'tie <session>'
    const tasks = await screenOf(from({ snapshot: untied }), look({ tieHint: tie }))
    expect(tasks.body).toEqual(docked(paneBlocks(untied, 'mine', NOTHING_EXPANDED, null, NOTHING_FOLDED, null, tie)))
    expect(JSON.stringify(tasks.body)).toContain(tie)
    const inbox = await screenOf(from({ snapshot: untied, view: 'inbox' }), look({ tieHint: tie }))
    expect(inbox.body).toEqual(docked(inboxBlocks(untied, null, tie)))
    expect(JSON.stringify(inbox.body)).toContain(tie)
    const none = await screenOf(from({ snapshot: untied }), look())
    expect(none.body).toEqual(docked(paneBlocks(untied, 'mine')))
    expect(JSON.stringify(none.body)).not.toContain('<session>')
  })

  test('a task’s page shows its card with no bar over it', async () => {
    const nav = fromList('row:T50', task('T50'))
    const screen = await screenOf(from({ nav }), look())
    expect(screen.at).toBe(nav)
    expect(screen.barLines).toEqual([])
    expect(screen.body).toEqual(docked(pageBlocks(SNAP, 'T50', {}, null)))
    expect(screen.body[0]?.key).toBe('page:T50')
  })

  test('a search shows the tasks it matched, read once for the body and the field', async () => {
    const found = searchTasks(SNAP.tasks, 'feed', goalTreeOf(SNAP))
    const screen = await screenOf(from({ nav: SEARCH('feed'), findField: { round: 1, text: 'feed' } }), look())
    expect(screen.found).toEqual(found)
    expect(screen.field).toEqual({ round: 1, text: 'feed' })
    expect(screen.body).toEqual(docked(searchBlocks(SNAP, 'feed', found)))
    expect(screen.teamFound).toEqual([])
    expect(screen.barLines).toEqual([])
  })

  test('the Done page shows its week, the rows flipped kept flipped', async () => {
    const screen = await screenOf(from({ nav: doneAt(AT_LIST, '2026-10-12'), doneToggled: ['day:2026-10-13'] }), look())
    expect(screen.body).toEqual(docked(doneBlocks(SNAP, 'mine', '2026-10-12', ['day:2026-10-13'])))
  })

  test('a file’s page shows what was read of the file its place names', async () => {
    const read: RefFileRead = { kind: 'read', path: 'C:/kit/docs/x.md', text: 'one\ntwo\nthree' }
    const nav = pushed(AT_LIST, { kind: 'file', file: 'docs/x.md', line: 2 })
    const screen = await screenOf(from({ nav, filePages: { 'docs/x.md': read } }), look())
    expect(screen.files).toEqual({ 'docs/x.md': read })
    expect(screen.body).toEqual(docked(filePageBlocks({ file: 'docs/x.md', line: 2 }, read)))
  })

  test('the keys page is laid out for the front end’s columns and ends in its own keys', async () => {
    const screen = await screenOf(from({ nav: pushed(AT_LIST, KEYS_PAGE) }), look())
    expect(screen.body).toEqual(docked(keysBlocks(COLUMNS, KEYS.page)))
    expect(screen.body).not.toEqual(docked(keysBlocks(COLUMNS, [])))
  })
})

describe('the other views', () => {
  test('Changes shows the files read, and its search the files it names', async () => {
    const changes: PaneState['changes'] = { repos: [], outside: ['C:/kit/notes/plan.md'], isRead: true }
    const listed = await screenOf(from({ view: 'changes', changes }), look())
    expect(listed.current).toBe('changes')
    expect(listed.changed).toBe(changes)
    expect(listed.body).toEqual(docked(changesBlocks(changes, false, {}, null)))

    const hits = searchChanges(changes, 'plan')
    const searching = await screenOf(from({ view: 'changes', changes, nav: SEARCH('plan'), requirements: [{ kind: 'git-unstartable', reason: 'not found' }] }), look())
    expect(searching.changesFound).toEqual(hits)
    expect(searching.body).toEqual(
      docked([
        ...requirementBlocks([{ kind: 'git-unstartable', reason: 'not found' }], look().hostOld),
        ...changesBlocks(changes, true, {}, { query: 'plan', hits }),
      ]),
    )
  })

  test('Teams shows the tree read, and its search the sessions it names', async () => {
    const teamTree: TeamView = { kind: 'tree', root: treeOf([ACME], 'acme'), failures: [] }
    const zone = clockOf(SNAP).zone
    const listed = await screenOf(from({ view: 'team', teamTree, teamToggled: ['acme'] }), look())
    expect(listed.body).toEqual(docked(teamBlocks(teamTree, ['acme'], zone, { search: null, answer: null, own: null })))

    const hits = searchTeam(teamTree.root, 'api')
    const searching = await screenOf(from({ view: 'team', teamTree, nav: SEARCH('api') }), look())
    expect(searching.teamFound).toEqual(hits)
    expect(searching.found).toEqual(await screenOf(from(), look()).then(screen => screen.found))
    expect(searching.body).toEqual(docked(teamBlocks(teamTree, [], zone, { search: { query: 'api', hits }, answer: null, own: null })))
  })

  test('Teams names the session’s own row once the snapshot holds its team and area', async () => {
    const snapshot: Snapshot = { ...SNAP, team: 'acme', area: 'api' }
    const teamTree: TeamView = { kind: 'tree', root: treeOf([ACME], 'acme'), failures: [] }
    const screen = await screenOf(from({ view: 'team', teamTree, snapshot }), look())
    expect(screen.body).toEqual(docked(teamBlocks(teamTree, [], clockOf(snapshot).zone, { search: null, answer: null, own: sessionKey('acme', 'api') })))
  })

  test('Meetings shows the team’s meetings as last read', async () => {
    const meetings: PaneState['meetings'] = { kind: 'list', meetings: [], unreadable: 1 }
    const screen = await screenOf(from({ view: 'meetings', meetings, meetingsOpen: ['m1'] }), look())
    expect(screen.body).toEqual(docked(meetingsBlocks(meetings, { open: ['m1'], answer: null, asked: null }, SNAP.tasks, clockOf(SNAP))))
  })

  test('Stats shows its numbers as last folded, leading back to the Teams row that opened it', async () => {
    const stats: PaneState['stats'] = { kind: 'failed', reason: 'the register could not be read' }
    const blocks = statsBlocks(stats, [], COLUMNS, { team: SNAP.team, held: new Set(SNAP.tasks.map(row => row.id)), clock: clockOf(SNAP) })
    const fromSwitch = await screenOf(from({ view: 'stats', stats }), look())
    expect(fromSwitch.body).toEqual(docked(blocks))
    expect(fromSwitch.statsTitle).toBe(null)
    expect(fromSwitch.statsBack).toBe(false)

    const fromRow = await screenOf(from({ view: 'stats', stats, statsFrom: 'acme/api' }), look())
    expect(fromRow.statsBack).toBe(true)
    expect((await screenOf(from({ statsFrom: 'acme/api' }), look())).statsBack).toBe(false)
  })

  test('Inbox shows the session’s lines, and its search the lines it matches', async () => {
    const listed = await screenOf(from({ view: 'inbox' }), look())
    expect(listed.body).toEqual(docked(inboxBlocks(SNAP, null)))

    const hits = searchInbox(SNAP.inbox, SNAP.now, 'merge')
    const searching = await screenOf(from({ view: 'inbox', nav: SEARCH('merge') }), look())
    expect(searching.inboxFound).toEqual(hits)
    expect(searching.body).toEqual(docked(inboxBlocks(SNAP, { query: 'merge', hits })))
  })

  test('Conversations shows its list, a search over it, and docked the page of the conversation opened', async () => {
    const listed = await screenOf(from({ view: 'log', logList: LOGS }), look())
    expect(listed.logTitle).toBe(null)
    expect(listed.body).toEqual(docked(logListBlocks(LOGS, clockOf(SNAP), SNAP, null)))

    const hits = searchLog(LOGS, SNAP, 'po')
    const searching = await screenOf(from({ view: 'log', logList: LOGS, nav: SEARCH('po') }), look())
    expect(searching.logFound).toEqual(hits)
    expect(searching.body).toEqual(docked(logListBlocks(LOGS, clockOf(SNAP), SNAP, { query: 'po', hits })))

    const paged = await screenOf(from({ view: 'log', logList: LOGS, logPage: LOG_PAGE }), look())
    expect(paged.logTitle).toEqual(logPageTitle(LOG_PAGE, LOGS, SNAP))
    expect(paged.body).toEqual(docked(logPageBlocks(LOG_PAGE, clockOf(SNAP), LOGS, SNAP)))

    // Inline, the list alone: a page opens docked.
    const inline = await screenOf(from({ view: 'log', logList: LOGS, logPage: LOG_PAGE }), look({ inline: true }))
    expect(inline.logTitle).toBe(null)
    expect(inline.body).toEqual(inlineLayout(logListBlocks(LOGS, clockOf(SNAP), SNAP, null), INLINE_MAX_ROWS))
  })
})

describe('what takes the view’s place', () => {
  test('a project teamrig is not set up for shows its setup in every view, with no bar, title or way back', async () => {
    const setup: SetupView = { setup: { project: 'C:/kit/web', teams: ['acme'] }, problem: null }
    for (const view of ['tasks', 'changes', 'log', 'stats'] as const) {
      const screen = await screenOf(from({ view, setup, logPage: LOG_PAGE, statsFrom: 'acme/api' }), look())
      expect(screen.setupShown).toBe(setup)
      expect(screen.body).toEqual(docked(setupBlocks(setup)))
      expect(screen.barLines).toEqual([])
      expect(screen.logTitle).toBe(null)
      expect(screen.statsBack).toBe(false)
    }
  })

  test('what the pane lacks is told above the view, a host too old in the front end’s own words', async () => {
    const running = { major: 2, minor: 1, patch: 200 }
    const screen = await screenOf(from({ view: 'inbox', requirements: [{ kind: 'claude-code-old', running }] }), look())
    const told = requirementBlocks([{ kind: 'claude-code-old', running }], look().hostOld)
    expect(screen.body).toEqual(docked([...told, ...inboxBlocks(SNAP, null)]))
    expect(JSON.stringify(told)).toContain('host 2.1.200 is too old')
  })

  test('minimized, the snapshot and the view are read and nothing is laid out', async () => {
    const { store, keys } = recording(from({ size: 'minimized', view: 'inbox', mode: 'all' }))
    const screen = await screenOf(store, look())
    expect(screen.isMinimized).toBe(true)
    expect(screen.current).toBe('inbox')
    expect(screen.snap).toBe(SNAP)
    expect(screen.shown).toBe('mine')
    expect(screen.body).toEqual([])
    expect(keys).toEqual(['ring', 'size', 'view', 'changes', 'snapshot'])
  })
})

describe('an inline front end', () => {
  test('shows the list alone, capped, the bar’s lines counted in the cap', async () => {
    const bar = barOf(null)
    const nav = fromList('row:T50', task('T50'))
    const { store, keys } = recording(from({ nav, bodyScroll: { seq: 3, to: { kind: 'offset', offset: 9 } } }))
    const screen = await screenOf(store, look({ inline: true, canAct: true }))
    expect(screen.at).toBe(AT_LIST)
    expect(screen.scroll).toBe(INITIAL_STATE.bodyScroll)
    expect(screen.acts).toBe(null)
    expect(keys).not.toContain('nav')
    expect(keys).not.toContain('bodyScroll')
    expect(keys).not.toContain('ownerAct')
    expect(screen.barLines.length).toBeGreaterThan(0)
    expect(screen.barLines).toEqual(bar.lines.slice(0, screen.barLines.length))
    const blocks = paneBlocks(SNAP, 'mine', NOTHING_EXPANDED, bar.filter, NOTHING_FOLDED, null)
    expect(screen.body).toEqual(inlineLayout(blocks, INLINE_MAX_ROWS - screen.barLines.length))
    expect(screen.body.length + screen.barLines.length).toBe(INLINE_MAX_ROWS)
    expect(screen.body.at(-1)?.key).toBe('more')
  })

  test('with fewer rows than the cap, shows no more than the front end gives', async () => {
    const screen = await screenOf(from({ mode: 'all' }), look({ inline: true, bodyRows: 3 }))
    expect(screen.body).toEqual(inlineLayout(paneBlocks(SNAP, 'all', NOTHING_EXPANDED, null, NOTHING_FOLDED, null), 3))
    expect(screen.body.length).toBe(3)
  })
})

describe('the owner’s acts', () => {
  test('docked with a team to run them through, an open card draws from where the act stands', async () => {
    const ownerAct: PaneState['ownerAct'] = { kind: 'previewing', task: 'T50' }
    const nav = fromList('row:T50', task('T50'))
    const screen = await screenOf(from({ nav, ownerAct }), look({ canAct: true }))
    expect(screen.acts).toEqual({ act: ownerAct })
    expect(screen.body).toEqual(docked(pageBlocks(SNAP, 'T50', {}, { act: ownerAct })))
    expect((await screenOf(from({ nav, ownerAct }), look())).acts).toBe(null)
  })

  test('while the Note field is open the snapshot of its opening is drawn, the newest again once it closes', async () => {
    const noteHold = new NoteHold<Snapshot>()
    const store = from({ ownerAct: { kind: 'noting', task: 'T50', round: 1 } })
    expect((await screenOf(store, look({ canAct: true, noteHold }))).snap).toBe(SNAP)
    const newer: Snapshot = { ...SNAP, tasks: SNAP.tasks.slice(1) }
    await store.update('snapshot', () => newer)
    expect((await screenOf(store, look({ canAct: true, noteHold }))).snap).toBe(SNAP)
    await store.update('ownerAct', () => null)
    expect((await screenOf(store, look({ canAct: true, noteHold }))).snap).toBe(newer)
  })
})

describe('the keys and a failed read', () => {
  test('a drawing without the keys after one with them records the landings so far', async () => {
    const ring: PaneState['ring'] = { count: 4, on: 'field' }
    const lost = await screenOf(from({ ring }), look({ isHeld: false }))
    expect(lost.landings).toBe(ring)
    expect(lost.memo).toEqual({ wasHeld: false, lostAt: 4 })
    expect((await screenOf(from({ ring }), look())).memo).toBe(FIRST_MEMO)
  })

  test('a read that throws leaves one error line for a body, no bar, and what was read until then', async () => {
    const screen = await screenOf(failingAt(from({ view: 'inbox' }), 'mode'), look())
    expect(screen.current).toBe('inbox')
    expect(screen.snap).toBe(SNAP)
    expect(screen.barLines).toEqual([])
    expect(screen.body).toEqual([{ key: 'error', spans: [{ text: 'WARN the pane could not draw: no mode', color: 'error' }], wrap: 'wrap', toggle: null }])
  })

  test('landings that cannot be read leave the keys memo as the front end gave it', async () => {
    const memo: KeysMemo = { wasHeld: true, lostAt: 2 }
    const screen = await screenOf(failingAt(from(), 'ring'), look({ isHeld: false, memo }))
    expect(screen.memo).toBe(memo)
    expect(screen.body[0]?.key).toBe('error')
  })
})
