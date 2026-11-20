// A press as data and what running it does, on a store kept in memory with fake ports: no engine, as a front end
// other than the Claude Code dock names and runs them.
import { describe, expect, test } from 'claude-code/testing'
import type {
  ChangesSnapshot,
  LogConversation,
  LogList,
  LogRead,
  MeetingPress,
  OwnerActPress,
  PaneState,
  RefFileRead,
  SessionPress,
  Snapshot,
  TaskDetail,
  TaskRow,
  TeamView,
} from '../types'
import { changesResultKey, searchChanges } from '../hooks/changes-search'
import { readRegister } from '../hooks/core/read/index'
import type { Drawn } from '../hooks/layout'
import { rowOf } from '../hooks/log'
import { AT_LIST, KEYS_PAGE, back, currentPlace, doneAt, fromList, searched } from '../hooks/nav'
import { INITIAL_STATE } from '../hooks/pane-state'
import { MemoryStore } from '../hooks/pane-store'
import { pressOfDrawn, pressOfPart, pressOfPiece, runPress, submitFind, typeFind, type Press, type PressDeps } from '../hooks/press'
import type { PressPiece } from '../hooks/press-keys'
import type { Span } from '../hooks/rows'
import type { ViewLives } from '../hooks/steps'
import { searchTeam } from '../hooks/team-search'
import { HOUR, NOW, NO_TEAM, SNAPSHOT_SETTINGS, createLine } from './fixtures'
import { ACME, treeOf } from './team-fixtures'

/** A store that starts as a pane does, but for `changed`. */
const from = (changed: Partial<PaneState> = {}) => new MemoryStore({ ...INITIAL_STATE, ...changed })

const TASKS: TaskRow[] = [
  ...readRegister(
    [
      createLine('T50', { owner: 'po', by: 'lead', at: NOW - HOUR, title: 'Ship the pages', ref: 'docs/x.md:3' }),
      createLine('T51', { owner: 'po', by: 'lead', at: NOW - HOUR, title: 'Draw the feed chart', ref: null }),
    ].join('\n'),
  ).state.tasks.values(),
].map(task => rowOf(task))
/** The register read, as the drawing a press was made in shows it. */
const SNAP: Snapshot = { tasks: TASKS, area: 'po', areaSource: 'pinned', unreadInbox: null, inbox: [], problem: null, ...NO_TEAM, ...SNAPSHOT_SETTINGS, now: NOW }

const DETAIL_T50: TaskDetail = { ref: 'docs/x.md:3', quotes: [], goals: [] }
const DETAIL_T51: TaskDetail = { ref: null, quotes: [], goals: [] }
const NO_READERS: ViewLives = { sizer: null, tracked: null, logging: null, teaming: null, scheduling: null, tallying: null }
const SPAN: Span = { text: 'x' }
const CONVERSATION: LogRead = { session: 'api', claude: 'c-1' }
const MEETING: MeetingPress = { kind: 'back', id: 'meet:1' }
const SESSION: SessionPress = { act: 'wake', team: 'acme', session: 'po' }

/** What the fake ports were asked, in order. */
type Asked = {
  readonly logs: LogRead[]
  /** One `close` for each time the Log reader was asked to close its page. */
  readonly closes: string[]
  /** The keys the focus ring was moved onto. */
  readonly focused: string[]
  readonly diffs: string[]
  readonly pins: string[]
  readonly meetings: MeetingPress[]
  readonly sessions: SessionPress[]
  readonly acts: { press: OwnerActPress; task: string }[]
}

/** A push onto `list` as a port's method: it resolves once the ask is kept. */
function keeping<T>(list: T[]): (asked: T) => Promise<void> {
  return asked => {
    list.push(asked)
    return Promise.resolve()
  }
}

/** Deps over `store` whose ports keep what they were asked, the pane showing the Tasks view's list as area `po`. */
function deps(store: MemoryStore, changed: Partial<PressDeps> = {}): { readonly deps: PressDeps; readonly asked: Asked } {
  const asked: Asked = { logs: [], closes: [], focused: [], diffs: [], pins: [], meetings: [], sessions: [], acts: [] }
  return {
    asked,
    deps: {
      store,
      snap: SNAP,
      shown: 'tasks',
      place: { kind: 'list', row: null },
      focus: keeping(asked.focused),
      detailOf: task => Promise.resolve({ ref: task.ref, quotes: [], goals: [] }),
      readFile: file => {
        const found: RefFileRead = { kind: 'read', path: `C:/kit/${file}`, text: 'one\n\ntwo' }
        return Promise.resolve(found)
      },
      lives: NO_READERS,
      logging: {
        open: keeping(asked.logs),
        close: () => {
          asked.closes.push('close')
          return Promise.resolve()
        },
      },
      diffing: { toggle: keeping(asked.diffs) },
      pinning: { pin: keeping(asked.pins) },
      scheduling: { press: keeping(asked.meetings) },
      pressing: { press: keeping(asked.sessions) },
      acting: {
        press: (press, task) => {
          asked.acts.push({ press, task })
          return Promise.resolve()
        },
      },
      ...changed,
    },
  }
}

const NO_PORTS: Partial<PressDeps> = { logging: null, diffing: null, pinning: null, scheduling: null, pressing: null, acting: null }

/** An element whose head is words alone, but for `changed`. */
const drawn = (changed: Partial<Drawn> = {}): Drawn => ({ key: 'row:T50', spans: [SPAN], wrap: 'wrap', toggle: null, ...changed })

describe('pressOfPiece', () => {
  const cases: readonly { readonly name: string; readonly piece: PressPiece; readonly press: Press }[] = [
    { name: 'a task id opens its page', piece: { kind: 'id', span: SPAN, task: 'T51' }, press: { kind: 'page', task: 'T51', from: 'row:T50' } },
    {
      name: 'a reference file opens its page',
      piece: { kind: 'file', span: SPAN, file: { file: 'notes/a.md', line: 4 } },
      press: { kind: 'file', file: { file: 'notes/a.md', line: 4 }, from: 'row:T50' },
    },
    {
      name: 'an unread count opens its inbox',
      piece: { kind: 'inbox', span: SPAN, inbox: { area: 'etl', unread: 2 } },
      press: { kind: 'inbox', inbox: { area: 'etl', unread: 2 }, from: 'row:T50' },
    },
    { name: 'a Teams tab key is toggled', piece: { kind: 'toggle', span: SPAN, toggles: 'card:po' }, press: { kind: 'team-key', key: 'card:po' } },
    { name: 'a session ties the tab to it', piece: { kind: 'pin', span: SPAN, pins: 'etl' }, press: { kind: 'pin', area: 'etl' } },
    { name: "a meeting card's press", piece: { kind: 'meeting', span: SPAN, meets: MEETING }, press: { kind: 'meeting', press: MEETING } },
    { name: "a session row's act", piece: { kind: 'session-act', span: SPAN, sessionAct: SESSION }, press: { kind: 'session-act', press: SESSION } },
    {
      name: "a task card's owner act",
      piece: { kind: 'act', span: SPAN, acts: { task: 'T50', press: 'next' } },
      press: { kind: 'act', act: { task: 'T50', press: 'next' } },
    },
    {
      name: 'a Stats tab pick',
      piece: { kind: 'stats', span: SPAN, stats: { kind: 'range', range: '90d' } },
      press: { kind: 'stats', press: { kind: 'range', range: '90d' } },
    },
  ]
  for (const { name, piece, press } of cases) {
    test(name, () => {
      expect(pressOfPiece(piece, 'row:T50')).toEqual(press)
    })
  }
})

describe('pressOfPart', () => {
  test("a Changes file's row opens or closes its diff", () => {
    expect(pressOfPart({ kind: 'press', key: 'file:a.ts', spans: [SPAN], expands: 'repo:a.ts' })).toEqual({ kind: 'diff', key: 'repo:a.ts' })
  })
})

describe('pressOfDrawn', () => {
  test('a head of words alone is no press', () => {
    expect(pressOfDrawn(drawn())).toBeNull()
  })

  test("a task's row opens or closes its card", () => {
    expect(pressOfDrawn(drawn({ toggle: 'T50' }))).toEqual({ kind: 'card', task: 'T50' })
  })

  test("a search result opens its task's page, back landing on the result", () => {
    expect(pressOfDrawn(drawn({ key: 'found:T51', opens: 'T51' }))).toEqual({ kind: 'page', task: 'T51', from: 'found:T51' })
  })

  test('a conversation opens its Log page', () => {
    expect(pressOfDrawn(drawn({ reads: CONVERSATION }))).toEqual({ kind: 'log', read: CONVERSATION })
  })

  test('a heading folds what is under it', () => {
    expect(pressOfDrawn(drawn({ folds: 'owner:etl' }))).toEqual({ kind: 'fold', key: 'owner:etl' })
  })

  test("a Changes file's row opens or closes its diff", () => {
    expect(pressOfDrawn(drawn({ expands: 'repo:a.ts' }))).toEqual({ kind: 'diff', key: 'repo:a.ts' })
  })

  test('with more than one set, a fold wins, then a Log page, a diff, a page, the card', () => {
    const page = { toggle: 'T50', opens: 'T51' }
    const diff = { ...page, expands: 'repo:a.ts' }
    const log = { ...diff, reads: CONVERSATION }
    expect(pressOfDrawn(drawn({ ...log, folds: 'owner:etl' }))).toEqual({ kind: 'fold', key: 'owner:etl' })
    expect(pressOfDrawn(drawn(log))).toEqual({ kind: 'log', read: CONVERSATION })
    expect(pressOfDrawn(drawn(diff))).toEqual({ kind: 'diff', key: 'repo:a.ts' })
    expect(pressOfDrawn(drawn(page))).toEqual({ kind: 'page', task: 'T51', from: 'row:T50' })
  })
})

describe('runPress', () => {
  test("a card press opens the task's card over its detail, a second closes it", async () => {
    const store = from()
    const { deps: on } = deps(store)
    await runPress({ kind: 'card', task: 'T50' }, on)
    expect(store.state.expanded).toEqual({ T50: DETAIL_T50 })
    await runPress({ kind: 'card', task: 'T50' }, on)
    expect(store.state.expanded).toEqual({})
  })

  test("a page press shows the task's page over the list at the element it was pressed in", async () => {
    const store = from()
    await runPress({ kind: 'page', task: 'T51', from: 'row:T50' }, deps(store).deps)
    expect(store.state.pages).toEqual({ T51: DETAIL_T51 })
    expect(store.state.nav).toEqual({ places: [{ kind: 'list', row: 'row:T50' }, { kind: 'task', id: 'T51' }], at: 1 })
  })

  test("a file press reads the file and shows its page at its ref's line", async () => {
    const store = from()
    await runPress({ kind: 'file', file: { file: 'notes/a.md', line: 3 }, from: 'row:T50' }, deps(store).deps)
    expect(store.state.filePages).toEqual({ 'notes/a.md': { kind: 'read', path: 'C:/kit/notes/a.md', text: 'one\n\ntwo' } })
    expect(store.state.nav).toEqual({ places: [{ kind: 'list', row: 'row:T50' }, { kind: 'file', file: 'notes/a.md', line: 3 }], at: 1 })
  })

  test("an inbox press on the session's own area shows the Inbox view, on another's that inbox's file", async () => {
    const own = from({ view: 'team' })
    await runPress({ kind: 'inbox', inbox: { area: 'po', unread: 1 }, from: 'team:po' }, deps(own).deps)
    expect(own.state.view).toBe('inbox')
    const other = from({ view: 'team' })
    await runPress({ kind: 'inbox', inbox: { area: 'etl', unread: 1 }, from: 'team:etl' }, deps(other).deps)
    expect(other.state.view).toBe('tasks')
    expect(other.state.nav).toEqual({ places: [{ kind: 'list', row: null }, { kind: 'file', file: 'inbox/etl.md', line: 3 }], at: 1 })
  })

  test('a Teams tab key press toggles that key whatever view is shown', async () => {
    const store = from({ teamToggled: ['acme'] })
    await runPress({ kind: 'team-key', key: 'card:po' }, deps(store, { shown: 'meetings' }).deps)
    expect(store.state.teamToggled).toEqual(['acme', 'card:po'])
    expect(store.state.meetingsOpen).toEqual(INITIAL_STATE.meetingsOpen)
  })

  test('a Stats pick sets it and folds the registers anew', async () => {
    const store = from({ view: 'stats' })
    const folds = { count: 0 }
    const lives: ViewLives = {
      ...NO_READERS,
      tallying: {
        refresh: () => {
          folds.count += 1
          return Promise.resolve()
        },
      },
    }
    await runPress({ kind: 'stats', press: { kind: 'range', range: '90d' } }, deps(store, { lives }).deps)
    expect(store.state.statsRange).toBe('90d')
    expect(folds.count).toBe(1)
  })

  test('a fold goes by the view shown and the place: a Tasks heading, a Done day, a meeting, else a Teams key', async () => {
    const store = from()
    await runPress({ kind: 'fold', key: 'owner:etl' }, deps(store).deps)
    await runPress({ kind: 'fold', key: 'done:day' }, deps(store, { place: { kind: 'done', week: '2026-W47' } }).deps)
    await runPress({ kind: 'fold', key: 'meet:1' }, deps(store, { shown: 'meetings' }).deps)
    await runPress({ kind: 'fold', key: 'acme' }, deps(store, { shown: 'team' }).deps)
    expect(store.state.tasksFolded).toEqual(['owner:etl'])
    expect(store.state.doneToggled).toEqual(['done:day'])
    expect(store.state.meetingsOpen).toEqual(['meet:1'])
    expect(store.state.teamToggled).toEqual(['acme'])
  })

  test("a log press opens the conversation through the Log reader, at the page's end", async () => {
    const store = from()
    const { deps: on, asked } = deps(store)
    await runPress({ kind: 'log', read: CONVERSATION }, on)
    expect(asked.logs).toEqual([CONVERSATION])
    expect(store.state.bodyScroll.to).toEqual({ kind: 'end' })
  })

  test('a press that acts outside the store goes to its port alone, the store left as it was', async () => {
    const store = from()
    const { deps: on, asked } = deps(store)
    await runPress({ kind: 'diff', key: 'repo:a.ts' }, on)
    await runPress({ kind: 'pin', area: 'etl' }, on)
    await runPress({ kind: 'meeting', press: MEETING }, on)
    await runPress({ kind: 'session-act', press: SESSION }, on)
    await runPress({ kind: 'act', act: { task: 'T50', press: 'next' } }, on)
    expect(asked).toEqual({
      logs: [],
      closes: [],
      focused: [],
      diffs: ['repo:a.ts'],
      pins: ['etl'],
      meetings: [MEETING],
      sessions: [SESSION],
      acts: [{ press: 'next', task: 'T50' }],
    })
    expect(store.state).toEqual(INITIAL_STATE)
  })

  test('with no reader behind a port, its press does nothing and does not throw', async () => {
    const store = from()
    const { deps: on } = deps(store, NO_PORTS)
    await runPress({ kind: 'diff', key: 'repo:a.ts' }, on)
    await runPress({ kind: 'pin', area: 'etl' }, on)
    await runPress({ kind: 'meeting', press: MEETING }, on)
    await runPress({ kind: 'session-act', press: SESSION }, on)
    await runPress({ kind: 'act', act: { task: 'T50', press: 'next' } }, on)
    expect(store.state).toEqual(INITIAL_STATE)
  })

  test('a log press with no Log reader still moves the body to its end', async () => {
    const store = from()
    await runPress({ kind: 'log', read: CONVERSATION }, deps(store, NO_PORTS).deps)
    expect(store.state.bodyScroll.to).toEqual({ kind: 'end' })
  })
})

/** Readers whose Stats fold counts its refreshes. */
function folding(): { readonly lives: ViewLives; readonly folds: { count: number } } {
  const folds = { count: 0 }
  return {
    folds,
    lives: {
      ...NO_READERS,
      tallying: {
        refresh: () => {
          folds.count += 1
          return Promise.resolve()
        },
      },
    },
  }
}

describe("runPress on the head's presses", () => {
  const ON_T50 = fromList('row:T50', { kind: 'task', id: 'T50' })

  test('a view press shows that view, the pane opened on its list', async () => {
    const store = from({ nav: ON_T50 })
    await runPress({ kind: 'view', view: 'team' }, deps(store).deps)
    expect(store.state.view).toBe('team')
    expect(store.state.nav).toEqual({ places: [{ kind: 'list', row: 'row:T50' }], at: 0 })
  })

  test('a mode press shows the other list alone', async () => {
    const store = from({ nav: ON_T50 })
    await runPress({ kind: 'mode', mode: 'all' }, deps(store).deps)
    expect(store.state.mode).toBe('all')
    expect(store.state.nav).toEqual(AT_LIST)
  })

  test('a done-week press shows the Done page at that week', async () => {
    const store = from()
    await runPress({ kind: 'done-week', week: '2026-W41' }, deps(store).deps)
    expect(store.state.nav).toEqual(doneAt(AT_LIST, '2026-W41'))
    expect(currentPlace(store.state.nav)).toEqual({ kind: 'done', week: '2026-W41' })
  })

  test('a close-cards press closes every open card', async () => {
    const store = from({ expanded: { T50: DETAIL_T50, T51: DETAIL_T51 } })
    await runPress({ kind: 'close-cards' }, deps(store).deps)
    expect(store.state.expanded).toEqual({})
  })

  test('a keys press shows the Keys page over the place shown', async () => {
    const store = from()
    await runPress({ kind: 'keys' }, deps(store).deps)
    expect(currentPlace(store.state.nav)).toEqual(KEYS_PAGE)
    expect(store.state.nav.at).toBe(1)
  })

  test('a filter press lists its status alone, a second press every task again', async () => {
    const store = from()
    const { deps: on } = deps(store)
    await runPress({ kind: 'filter', status: 'waiting' }, on)
    expect(store.state.filter).toBe('waiting')
    await runPress({ kind: 'filter', status: 'waiting' }, on)
    expect(store.state.filter).toBeNull()
  })

  test('back, forward and a crumb step among the places kept', async () => {
    const store = from({ nav: ON_T50 })
    const { deps: on } = deps(store)
    await runPress({ kind: 'back' }, on)
    expect(store.state.nav).toEqual(back(ON_T50))
    expect(store.state.nav.at).toBe(0)
    await runPress({ kind: 'forward' }, on)
    expect(store.state.nav).toEqual(ON_T50)
    await runPress({ kind: 'crumb', index: 0 }, on)
    expect(store.state.nav.at).toBe(0)
    await runPress({ kind: 'crumb', index: 1 }, on)
    expect(currentPlace(store.state.nav)).toEqual({ kind: 'task', id: 'T50' })
  })

  test("a log-close press closes the conversation's page through the Log reader, the Find field a new round's", async () => {
    const store = from({ view: 'log', findField: { round: 2, text: 'old' }, nav: searched(AT_LIST, 'ship') })
    const { deps: on, asked } = deps(store)
    await runPress({ kind: 'log-close' }, on)
    expect(asked.closes).toEqual(['close'])
    expect(asked.logs).toEqual([])
    expect(store.state.findField).toEqual({ round: 3, text: 'ship' })
    expect(store.state.bodyScroll.to).toEqual({ kind: 'offset', offset: 0 })
  })

  test('a log-close press with no Log reader still moves the field and the window', async () => {
    const store = from({ view: 'log', findField: { round: 0, text: 'old' } })
    await runPress({ kind: 'log-close' }, deps(store, NO_PORTS).deps)
    expect(store.state.findField).toEqual({ round: 1, text: '' })
    expect(store.state.bodyScroll.to).toEqual({ kind: 'offset', offset: 0 })
  })

  test("a stats-list-close press shows the tab's numbers again, folded anew", async () => {
    const store = from({ view: 'stats', statsList: 'opened' })
    const { lives, folds } = folding()
    await runPress({ kind: 'stats-list-close' }, deps(store, { lives }).deps)
    expect(store.state.statsList).toBeNull()
    expect(folds.count).toBe(1)
  })

  test('a stats-from-close press shows the Teams tab at the row the Stats tab was opened from', async () => {
    const store = from({ view: 'stats', statsFrom: 'team:acme/po' })
    await runPress({ kind: 'stats-from-close' }, deps(store).deps)
    expect(store.state.view).toBe('team')
    expect(store.state.statsFrom).toBeNull()
    expect(store.state.bodyScroll.to).toEqual({ kind: 'reveal', key: 'team:acme/po', block: 'center' })
  })

  test("a find press moves the ring into the field of its round, the store left as it was", async () => {
    const store = from({ findField: { round: 2, text: 'api' } })
    const { deps: on, asked } = deps(store)
    await runPress({ kind: 'find' }, on)
    expect(asked.focused).toEqual(['find:2'])
    expect(store.state.nav).toEqual(AT_LIST)
  })

  test("a find-clear press closes the search and moves the ring into the new round's field", async () => {
    const store = from({ nav: searched(AT_LIST, 'api') })
    const { deps: on, asked } = deps(store)
    await runPress({ kind: 'find-clear' }, on)
    expect(store.state.nav).toEqual(AT_LIST)
    expect(store.state.findField).toEqual({ round: 1, text: '' })
    expect(asked.focused).toEqual(['find:1'])
  })
})

describe('typeFind', () => {
  test('the first words open a search, each change shows its words, and no new round of the field starts', async () => {
    const store = from()
    await typeFind(store, 'fe')
    expect(store.state.nav).toEqual(searched(AT_LIST, 'fe'))
    await typeFind(store, 'feed')
    expect(currentPlace(store.state.nav)).toEqual({ kind: 'search', query: 'feed' })
    expect(store.state.findField).toEqual(INITIAL_STATE.findField)
  })

  test('an empty field closes the search', async () => {
    const store = from({ nav: searched(AT_LIST, 'feed') })
    await typeFind(store, '')
    expect(currentPlace(store.state.nav).kind).toBe('list')
    expect(store.state.findField).toEqual(INITIAL_STATE.findField)
  })
})

describe('submitFind', () => {
  test("in the Tasks view, the one match's page opens and the ring moves onto its back step", async () => {
    const store = from({ nav: searched(AT_LIST, 'chart') })
    const { deps: on, asked } = deps(store)
    await submitFind('tasks', 'chart', on)
    expect(store.state.pages).toEqual({ T51: DETAIL_T51 })
    expect(currentPlace(store.state.nav)).toEqual({ kind: 'task', id: 'T51' })
    expect(asked.focused).toEqual(['back'])
  })

  test("in the Teams tab, the one match's card opens and the ring moves onto it", async () => {
    const teamTree: TeamView = { kind: 'tree', root: treeOf([ACME], 'acme'), failures: [] }
    const key = searchTeam(teamTree.root, 'api')[0]?.row.key ?? ''
    const store = from({ view: 'team', teamTree })
    const { deps: on, asked } = deps(store)
    await submitFind('team', 'api', on)
    expect(store.state.teamToggled.length).toBe(INITIAL_STATE.teamToggled.length + 1)
    expect(asked.focused).toEqual([`team-search:${key}`])
  })

  test("in the Log view, the one match's page opens through the Log reader and the ring moves onto its back step", async () => {
    const conversation = (session: string, claude: string): LogConversation => ({
      session,
      claude,
      firstAt: NOW - 2 * HOUR,
      lastAt: NOW - HOUR,
      nextAt: null,
      lines: 4,
      opening: null,
    })
    const logList: LogList = { kind: 'conversations', hours: 24, conversations: [conversation('po', 'c-1'), conversation('api', 'c-2')] }
    const store = from({ view: 'log', logList })
    const { deps: on, asked } = deps(store)
    await submitFind('log', 'api', on)
    expect(asked.logs).toEqual([{ session: 'api', claude: 'c-2' }])
    expect(asked.focused).toEqual(['back'])
    const none = deps(from({ view: 'log', logList }), NO_PORTS)
    await submitFind('log', 'api', none.deps)
    expect(none.asked.focused).toEqual(['back'])
  })

  test("in the Changes view, the one match's diff opens through its port and the ring moves onto it", async () => {
    const changes: ChangesSnapshot = { repos: [], outside: ['C:/kit/notes/plan.md', 'C:/kit/notes/map.md'], isRead: true }
    const hit = searchChanges(changes, 'plan')[0]
    if (hit === undefined) throw new Error('no hit for plan')
    const { deps: on, asked } = deps(from({ view: 'changes', changes }))
    await submitFind('changes', 'plan', on)
    expect(asked.diffs.length).toBe(1)
    expect(asked.focused).toEqual([changesResultKey(hit.row)])
  })
})
