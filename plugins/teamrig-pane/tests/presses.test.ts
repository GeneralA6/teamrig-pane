// The pane's presses on a store kept in memory: no engine, as a front end other than the Claude Code dock runs them.
import { describe, expect, test } from 'claude-code/testing'
import type { ChangesSnapshot, LogConversation, LogList, LogRead, PaneState, RefFileRead, RepoChanges, Snapshot, TaskDetail, TaskRow, TeamView } from '../types'
import { changesResultKey, searchChanges } from '../hooks/changes-search'
import { readRegister } from '../hooks/core/read/index'
import { rowOf } from '../hooks/log'
import { logResultKey } from '../hooks/log-search'
import { AT_LIST, searched } from '../hooks/nav'
import { INITIAL_STATE } from '../hooks/pane-state'
import { MemoryStore } from '../hooks/pane-store'
import {
  closeCards,
  closeLog,
  closeStatsFrom,
  closeStatsList,
  filterBar,
  fold,
  openFile,
  openInbox,
  openPage,
  openPlace,
  pickStats,
  readFilePage,
  submitChanges,
  submitLog,
  submitTasks,
  submitTeam,
  toggleCard,
  toggleTeamKey,
  type ReadsDetail,
  type ReadsFile,
} from '../hooks/presses'
import type { MoveFocus, ViewLives } from '../hooks/steps'
import { cardKey } from '../hooks/team-rows'
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

/** A detail reader that names each task's ref unquoted and keeps the ids it was asked for. */
function details(): { readonly detailOf: ReadsDetail; readonly asked: string[] } {
  const asked: string[] = []
  return {
    asked,
    detailOf: task => {
      asked.push(task.id)
      return Promise.resolve({ ref: task.ref, quotes: [], goals: [] })
    },
  }
}

const DETAIL_T50: TaskDetail = { ref: 'docs/x.md:3', quotes: [], goals: [] }
const DETAIL_T51: TaskDetail = { ref: null, quotes: [], goals: [] }

/** A file reader over `texts` by file, missing for any other, that keeps the files it was asked for. */
function files(texts: Readonly<Record<string, string>>): { readonly readFile: ReadsFile; readonly asked: string[] } {
  const asked: string[] = []
  return {
    asked,
    readFile: file => {
      asked.push(file)
      const text = texts[file]
      const found: RefFileRead = text === undefined ? { kind: 'missing', tried: [file] } : { kind: 'read', path: `C:/kit/${file}`, text }
      return Promise.resolve(found)
    },
  }
}

const NO_READERS: ViewLives = { sizer: null, tracked: null, logging: null, teaming: null, scheduling: null, tallying: null }

describe('toggleCard', () => {
  test("a press on a closed card opens it over what its task's refs point at", async () => {
    const store = from()
    const { detailOf, asked } = details()
    await toggleCard(store, TASKS, 'T50', detailOf)
    expect(store.state.expanded).toEqual({ T50: DETAIL_T50 })
    expect(asked).toEqual(['T50'])
  })

  test('a press on an open card closes it alone, reading nothing', async () => {
    const store = from({ expanded: { T50: DETAIL_T50, T51: DETAIL_T51 } })
    const { detailOf, asked } = details()
    await toggleCard(store, TASKS, 'T50', detailOf)
    expect(store.state.expanded).toEqual({ T51: DETAIL_T51 })
    expect(asked).toEqual([])
  })

  test('a task the drawing no longer holds opens nothing', async () => {
    const store = from()
    const { detailOf, asked } = details()
    await toggleCard(store, TASKS, 'T99', detailOf)
    expect(store.state).toEqual(INITIAL_STATE)
    expect(asked).toEqual([])
  })
})

describe('openPlace', () => {
  test('from the Tasks list, the list remembers the element the press was in', async () => {
    const store = from()
    await openPlace(store, { kind: 'task', id: 'T50' }, 'row:T50')
    expect(store.state.view).toBe('tasks')
    expect(store.state.nav).toEqual({ places: [{ kind: 'list', row: 'row:T50' }, { kind: 'task', id: 'T50' }], at: 1 })
  })

  test('from another view, the Tasks view shows the page over its list alone', async () => {
    const store = from({ view: 'team', nav: searched(AT_LIST, 'api') })
    await openPlace(store, { kind: 'task', id: 'T50' }, 'team:po')
    expect(store.state.view).toBe('tasks')
    expect(store.state.nav).toEqual({ places: [{ kind: 'list', row: null }, { kind: 'task', id: 'T50' }], at: 1 })
  })
})

describe('openPage', () => {
  test("a press on a task id reads its page's detail, then shows the page", async () => {
    const store = from()
    const { detailOf } = details()
    await openPage(store, TASKS, 'T51', 'row:T50', detailOf)
    expect(store.state.pages).toEqual({ T51: DETAIL_T51 })
    expect(store.state.nav).toEqual({ places: [{ kind: 'list', row: 'row:T50' }, { kind: 'task', id: 'T51' }], at: 1 })
  })

  test('a task the drawing no longer holds opens nothing', async () => {
    const store = from()
    const { detailOf, asked } = details()
    await openPage(store, TASKS, 'T99', 'row:T50', detailOf)
    expect(store.state).toEqual(INITIAL_STATE)
    expect(asked).toEqual([])
  })
})

describe('readFilePage', () => {
  test('keeps what was read by its file, beside the files read before', async () => {
    const before: RefFileRead = { kind: 'read', path: 'C:/kit/notes/a.md', text: 'a' }
    const store = from({ filePages: { 'notes/a.md': before } })
    const { readFile } = files({ 'notes/b.md': 'b' })
    const found = await readFilePage(store, 'notes/b.md', readFile)
    expect(found).toEqual({ kind: 'read', path: 'C:/kit/notes/b.md', text: 'b' })
    expect(store.state.filePages).toEqual({ 'notes/a.md': before, 'notes/b.md': found })
  })

  test('a file not found is kept as missing, so its page says where it looked', async () => {
    const store = from()
    const { readFile } = files({})
    await readFilePage(store, 'notes/gone.md', readFile)
    expect(store.state.filePages).toEqual({ 'notes/gone.md': { kind: 'missing', tried: ['notes/gone.md'] } })
  })
})

describe('openFile', () => {
  test("a press on a reference file opens its page at the paragraph holding its ref's line", async () => {
    const store = from()
    const { readFile, asked } = files({ 'notes/a.md': 'a\nb\n\nc' })
    await openFile(store, { file: 'notes/a.md', line: 4 }, 'row:T50', readFile)
    expect(asked).toEqual(['notes/a.md'])
    expect(store.state.nav).toEqual({ places: [{ kind: 'list', row: 'row:T50' }, { kind: 'file', file: 'notes/a.md', line: 4 }], at: 1 })
    expect(store.state.bodyScroll.to).toEqual({ kind: 'reveal', key: 'file-page:para:4', block: 'start' })
  })
})

describe('openInbox', () => {
  test("the session's own inbox opens in the Inbox view, reading no file", async () => {
    const store = from({ view: 'team' })
    const { readFile, asked } = files({})
    const sized: string[] = []
    const lives: ViewLives = {
      ...NO_READERS,
      sizer: {
        set: size => {
          sized.push(size)
          return Promise.resolve()
        },
      },
    }
    await openInbox(store, { area: 'po', unread: 2 }, 'team:po', 'po', readFile, lives)
    expect(store.state.view).toBe('inbox')
    expect(store.state.nav).toEqual(AT_LIST)
    expect(sized).toEqual(['open'])
    expect(asked).toEqual([])
  })

  test("another area's inbox opens as a file's page in the Tasks view, at its first unread line", async () => {
    const store = from({ view: 'team' })
    const { readFile, asked } = files({ 'inbox/etl.md': 'one\n\ntwo\nthree' })
    await openInbox(store, { area: 'etl', unread: 2 }, 'team:etl', 'po', readFile, NO_READERS)
    expect(asked).toEqual(['inbox/etl.md'])
    expect(store.state.view).toBe('tasks')
    expect(store.state.nav).toEqual({ places: [{ kind: 'list', row: null }, { kind: 'file', file: 'inbox/etl.md', line: 3 }], at: 1 })
  })

  test('an inbox that cannot be read opens its page with no line to land on', async () => {
    const store = from({ view: 'team' })
    const { readFile } = files({})
    await openInbox(store, { area: 'etl', unread: 1 }, 'team:etl', 'po', readFile, NO_READERS)
    expect(store.state.nav).toEqual({ places: [{ kind: 'list', row: null }, { kind: 'file', file: 'inbox/etl.md', line: null }], at: 1 })
  })

  test('a session with no area opens every inbox as a file', async () => {
    const store = from({ view: 'team' })
    const { readFile, asked } = files({ 'inbox/po.md': 'one' })
    await openInbox(store, { area: 'po', unread: 1 }, 'team:po', null, readFile, NO_READERS)
    expect(asked).toEqual(['inbox/po.md'])
    expect(store.state.view).toBe('tasks')
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

const SCROLLED: PaneState['bodyScroll'] = { seq: 4, to: { kind: 'offset', offset: 12 } }
const AT_TOP_NEXT: PaneState['bodyScroll'] = { seq: 5, to: { kind: 'offset', offset: 0 } }

describe('pickStats', () => {
  test('a scope pick folds the registers at once, the window left where it is', async () => {
    const store = from({ view: 'stats', bodyScroll: SCROLLED })
    const { lives, folds } = folding()
    await pickStats(store, { kind: 'scope', scope: { kind: 'team', team: 'acme' } }, lives)
    expect(store.state.statsScope).toEqual({ kind: 'team', team: 'acme' })
    expect(store.state.bodyScroll).toBe(SCROLLED)
    expect(folds.count).toBe(1)
  })

  test('a range pick folds the registers at once', async () => {
    const store = from({ view: 'stats' })
    const { lives, folds } = folding()
    await pickStats(store, { kind: 'range', range: '90d' }, lives)
    expect(store.state.statsRange).toBe('90d')
    expect(folds.count).toBe(1)
  })

  test("a Health count shows its tasks from their top, folded at once", async () => {
    const store = from({ view: 'stats', bodyScroll: SCROLLED })
    const { lives, folds } = folding()
    await pickStats(store, { kind: 'list', list: 'opened' }, lives)
    expect(store.state.statsList).toBe('opened')
    expect(store.state.bodyScroll).toEqual(AT_TOP_NEXT)
    expect(folds.count).toBe(1)
  })

  test("a Teams row's Stats opens the tab on its scope, its numbers shown, and keeps the row for back", async () => {
    const store = from({ view: 'team', statsList: 'opened', statsFrom: 'team:old' })
    const { lives, folds } = folding()
    await pickStats(store, { kind: 'open', scope: { kind: 'session', team: 'acme', session: 'po' }, row: 'team:acme/po' }, lives)
    expect(store.state.view).toBe('stats')
    expect(store.state.statsScope).toEqual({ kind: 'session', team: 'acme', session: 'po' })
    expect(store.state.statsList).toBeNull()
    expect(store.state.statsFrom).toBe('team:acme/po')
    expect(store.state.bodyScroll.to).toEqual({ kind: 'offset', offset: 0 })
    // The switch's own fold, no second one.
    expect(folds.count).toBe(1)
  })

  test('a pick with no Stats reader yet still lands', async () => {
    const store = from({ view: 'stats' })
    await pickStats(store, { kind: 'range', range: 'all' }, NO_READERS)
    expect(store.state.statsRange).toBe('all')
  })
})

describe('closeStatsList', () => {
  test("back from a Health count's tasks shows the numbers from their top, folded anew", async () => {
    const store = from({ view: 'stats', statsList: 'opened', bodyScroll: SCROLLED })
    const { lives, folds } = folding()
    await closeStatsList(store, lives)
    expect(store.state.statsList).toBeNull()
    expect(store.state.bodyScroll).toEqual(AT_TOP_NEXT)
    expect(folds.count).toBe(1)
  })
})

describe('closeStatsFrom', () => {
  test('back shows the Teams tab at the row the Stats tab was opened from, which the switch drops', async () => {
    const store = from({ view: 'stats', statsFrom: 'team:acme/po' })
    await closeStatsFrom(store, NO_READERS)
    expect(store.state.view).toBe('team')
    expect(store.state.statsFrom).toBeNull()
    expect(store.state.bodyScroll.to).toEqual({ kind: 'reveal', key: 'team:acme/po', block: 'center' })
  })

  test('with no row kept, the Teams tab shows from where its window is', async () => {
    const store = from({ view: 'stats' })
    await closeStatsFrom(store, NO_READERS)
    expect(store.state.view).toBe('team')
    expect(store.state.bodyScroll.to).not.toEqual({ kind: 'reveal', key: 'team:acme/po', block: 'center' })
  })
})

describe('fold', () => {
  const LIST = { kind: 'list', row: null } as const
  const DONE = { kind: 'done', week: '2026-W47' } as const

  test("in the Meetings view, a meeting's card opens, and closes on a second press", async () => {
    const store = from({ view: 'meetings' })
    await fold(store, 'meet:1', 'meetings', LIST)
    expect(store.state.meetingsOpen).toEqual(['meet:1'])
    await fold(store, 'meet:1', 'meetings', LIST)
    expect(store.state.meetingsOpen).toEqual([])
  })

  test('on the Stats tab, a section is toggled and no other list', async () => {
    const store = from({ view: 'stats' })
    await fold(store, 'stats:health', 'stats', LIST)
    expect(store.state).toEqual({ ...INITIAL_STATE, view: 'stats', statsToggled: ['stats:health'] })
  })

  test("in the Tasks view's list, a heading's tasks fold away beside the headings folded before", async () => {
    const store = from({ tasksFolded: ['owner:po'] })
    await fold(store, 'owner:etl', 'tasks', LIST)
    expect(store.state.tasksFolded).toEqual(['owner:po', 'owner:etl'])
    expect(store.state.doneToggled).toEqual(INITIAL_STATE.doneToggled)
  })

  test('on the Done page, a day or group is toggled, the list headings left as they are', async () => {
    const store = from({ tasksFolded: ['owner:po'] })
    await fold(store, 'done:day', 'tasks', DONE)
    expect(store.state.doneToggled).toEqual(['done:day'])
    expect(store.state.tasksFolded).toEqual(['owner:po'])
  })

  test('in any other view, a Teams tab key is toggled', async () => {
    const store = from({ view: 'team', teamToggled: ['acme'] })
    await fold(store, 'acme', 'team', LIST)
    expect(store.state.teamToggled).toEqual([])
    expect(store.state.meetingsOpen).toEqual(INITIAL_STATE.meetingsOpen)
  })
})

describe('toggleTeamKey', () => {
  test('a press opens a closed key and closes an open one', async () => {
    const store = from({ teamToggled: ['acme'] })
    await toggleTeamKey(store, 'card:po')
    expect(store.state.teamToggled).toEqual(['acme', 'card:po'])
    await toggleTeamKey(store, 'acme')
    expect(store.state.teamToggled).toEqual(['card:po'])
  })
})

describe('closeCards', () => {
  test("every task's card closes at once, their pages kept", async () => {
    const store = from({ expanded: { T50: DETAIL_T50, T51: DETAIL_T51 }, pages: { T50: DETAIL_T50 } })
    await closeCards(store)
    expect(store.state.expanded).toEqual({})
    expect(store.state.pages).toEqual({ T50: DETAIL_T50 })
  })
})

describe('filterBar', () => {
  test('a press lists that status alone, another status replaces it, a second press lists every task', async () => {
    const store = from()
    await filterBar(store, 'waiting')
    expect(store.state.filter).toBe('waiting')
    await filterBar(store, 'working')
    expect(store.state.filter).toBe('working')
    await filterBar(store, 'working')
    expect(store.state.filter).toBeNull()
  })
})

/** A focus ring that keeps the keys it was moved onto. */
function ring(): { readonly focus: MoveFocus; readonly keys: string[] } {
  const keys: string[] = []
  return {
    keys,
    focus: key => {
      keys.push(key)
      return Promise.resolve()
    },
  }
}

/** The register read, as the Tasks search and the Log view's titles take it. */
const SNAP: Snapshot = { tasks: TASKS, area: 'po', areaSource: 'pinned', unreadInbox: null, inbox: [], problem: null, ...NO_TEAM, ...SNAPSHOT_SETTINGS, now: NOW }

describe('closeLog', () => {
  test("back from a conversation's page closes it and shows the list from its top, the Find field a new round's", async () => {
    const store = from({ findField: { round: 2, text: 'old' }, nav: searched(AT_LIST, 'ship') })
    let closed = 0
    await closeLog(store, {
      close: () => {
        closed += 1
        return Promise.resolve()
      },
    })
    expect(closed).toBe(1)
    expect(store.state.findField).toEqual({ round: 3, text: 'ship' })
    expect(store.state.bodyScroll.to).toEqual({ kind: 'offset', offset: 0 })
    expect(store.state.bodyScroll.seq).toBe(INITIAL_STATE.bodyScroll.seq + 1)
  })

  test('with no reader yet, the field and the window still move', async () => {
    const store = from({ findField: { round: 0, text: 'old' } })
    await closeLog(store, null)
    expect(store.state.findField).toEqual({ round: 1, text: '' })
    expect(store.state.bodyScroll.to).toEqual({ kind: 'offset', offset: 0 })
  })
})

describe('submitTasks', () => {
  test('with more than one match, the ring moves onto the first result and no page opens', async () => {
    const store = from({ nav: searched(AT_LIST, 'the') })
    const { focus, keys } = ring()
    const { detailOf, asked } = details()
    await submitTasks(store, SNAP, 'the', focus, detailOf)
    expect(keys).toEqual(['search:T50'])
    expect(asked).toEqual([])
    expect(store.state.nav).toEqual(searched(AT_LIST, 'the'))
  })

  test("with one match, its page opens and the ring moves onto the page's back step", async () => {
    const store = from({ nav: searched(AT_LIST, 'chart') })
    const { focus, keys } = ring()
    const { detailOf } = details()
    await submitTasks(store, SNAP, 'chart', focus, detailOf)
    expect(store.state.pages).toEqual({ T51: DETAIL_T51 })
    expect(store.state.nav.places[store.state.nav.at]).toEqual({ kind: 'task', id: 'T51' })
    expect(keys).toEqual(['back'])
  })

  test('with no match, nothing moves', async () => {
    const store = from()
    const { focus, keys } = ring()
    const { detailOf, asked } = details()
    await submitTasks(store, SNAP, 'zebra', focus, detailOf)
    expect(store.state).toEqual(INITIAL_STATE)
    expect(keys).toEqual([])
    expect(asked).toEqual([])
  })
})

describe('submitTeam', () => {
  const teamTree: TeamView = { kind: 'tree', root: treeOf([ACME], 'acme'), failures: [] }

  test("with one match, that session's card opens and the ring moves onto it", async () => {
    const hits = searchTeam(teamTree.root, 'api')
    expect(hits.length).toBe(1)
    const key = hits[0]?.row.key ?? ''
    const store = from({ teamTree, teamToggled: ['acme'] })
    const { focus, keys } = ring()
    await submitTeam(store, 'api', focus)
    expect(store.state.teamToggled).toEqual(['acme', cardKey(key)])
    expect(keys).toEqual([`team-search:${key}`])
  })

  test('a card already open stays open', async () => {
    const key = searchTeam(teamTree.root, 'api')[0]?.row.key ?? ''
    const store = from({ teamTree, teamToggled: [cardKey(key)] })
    await submitTeam(store, 'api', ring().focus)
    expect(store.state.teamToggled).toEqual([cardKey(key)])
  })

  test('with more than one match, the ring moves onto the first and no card opens', async () => {
    const hits = searchTeam(teamTree.root, 'acme')
    expect(hits.length).toBeGreaterThan(1)
    const store = from({ teamTree })
    const { focus, keys } = ring()
    await submitTeam(store, 'acme', focus)
    expect(store.state.teamToggled).toEqual(INITIAL_STATE.teamToggled)
    expect(keys).toEqual([`team-search:${hits[0]?.row.key ?? ''}`])
  })

  test('with no match, or no tree read yet, nothing moves', async () => {
    const { focus, keys } = ring()
    const read = from({ teamTree })
    await submitTeam(read, 'zebra', focus)
    const reading = from()
    await submitTeam(reading, 'api', focus)
    expect(keys).toEqual([])
    expect(read.state.teamToggled).toEqual(INITIAL_STATE.teamToggled)
    expect(reading.state).toEqual(INITIAL_STATE)
  })
})

describe('submitLog', () => {
  const conversation = (session: string, claude: string): LogConversation => ({
    session,
    claude,
    firstAt: NOW - 2 * HOUR,
    lastAt: NOW - HOUR,
    nextAt: null,
    lines: 4,
    opening: null,
  })
  const listOf = (...conversations: LogConversation[]): LogList => ({ kind: 'conversations', hours: 24, conversations })
  /** A Log reader that keeps the conversations it was asked to open. */
  function opener(): { readonly logging: { open(read: LogRead): Promise<void> }; readonly opened: LogRead[] } {
    const opened: LogRead[] = []
    return {
      opened,
      logging: {
        open: read => {
          opened.push(read)
          return Promise.resolve()
        },
      },
    }
  }

  test("with one match, its page opens at its end and the ring moves onto the page's back step", async () => {
    const store = from({ logList: listOf(conversation('po', 'c-1'), conversation('api', 'c-2')) })
    const { focus, keys } = ring()
    const { logging, opened } = opener()
    await submitLog(store, SNAP, 'api', focus, logging)
    expect(opened).toEqual([{ session: 'api', claude: 'c-2' }])
    expect(store.state.bodyScroll.to).toEqual({ kind: 'end' })
    expect(keys).toEqual(['back'])
  })

  test('with more than one match, the ring moves onto the first and no page opens', async () => {
    const store = from({ logList: listOf(conversation('po', 'c-1'), conversation('po', 'c-2')) })
    const { focus, keys } = ring()
    const { logging, opened } = opener()
    await submitLog(store, SNAP, 'po', focus, logging)
    expect(opened).toEqual([])
    expect(keys).toEqual([logResultKey({ session: 'po', claude: 'c-1' })])
    expect(store.state.bodyScroll).toEqual(INITIAL_STATE.bodyScroll)
  })

  test('with no match, or no list read yet, nothing moves', async () => {
    const { focus, keys } = ring()
    const { logging, opened } = opener()
    await submitLog(from({ logList: listOf(conversation('po', 'c-1')) }), SNAP, 'zebra', focus, logging)
    await submitLog(from(), SNAP, 'po', focus, logging)
    expect(opened).toEqual([])
    expect(keys).toEqual([])
  })
})

describe('submitChanges', () => {
  const PLAN = 'C:/kit/notes/plan.md'
  const MAP = 'C:/kit/notes/map.md'
  const outside = (...files: string[]): ChangesSnapshot => ({ repos: [], outside: files, isRead: true })
  /** Diffs that keep the keys toggled. */
  function diffs(): { readonly diffing: { toggle(key: string): Promise<void> }; readonly toggled: string[] } {
    const toggled: string[] = []
    return {
      toggled,
      diffing: {
        toggle: key => {
          toggled.push(key)
          return Promise.resolve()
        },
      },
    }
  }
  /** The ring's key of the first file `query` names. */
  function resultOf(changes: ChangesSnapshot, query: string): string {
    const hit = searchChanges(changes, query)[0]
    if (hit === undefined) throw new Error(`no hit for ${query}`)
    return changesResultKey(hit.row)
  }

  test("with one match, that file's diff opens and the ring moves onto it", async () => {
    const changes = outside(PLAN, MAP)
    const { focus, keys } = ring()
    const { diffing, toggled } = diffs()
    await submitChanges(from({ changes }), 'plan', focus, diffing)
    expect(toggled.length).toBe(1)
    expect(toggled[0]?.endsWith(PLAN)).toBe(true)
    expect(keys).toEqual([resultOf(changes, 'plan')])
  })

  test('a diff already open stays open', async () => {
    const changes = outside(PLAN, MAP)
    const first = diffs()
    await submitChanges(from({ changes }), 'plan', ring().focus, first.diffing)
    const key = first.toggled[0] ?? ''
    const { focus, keys } = ring()
    const { diffing, toggled } = diffs()
    await submitChanges(from({ changes, diffs: { [key]: { kind: 'reading' } } }), 'plan', focus, diffing)
    expect(toggled).toEqual([])
    expect(keys).toEqual([resultOf(changes, 'plan')])
  })

  test('with more than one match, the ring moves onto the first and no diff opens', async () => {
    const changes = outside(PLAN, MAP)
    expect(searchChanges(changes, 'notes').length).toBe(2)
    const { focus, keys } = ring()
    const { diffing, toggled } = diffs()
    await submitChanges(from({ changes }), 'notes', focus, diffing)
    expect(toggled).toEqual([])
    expect(keys).toEqual([resultOf(changes, 'notes')])
  })

  test('with no diffs to open yet, the ring still moves onto the one match', async () => {
    const changes = outside(PLAN)
    const { focus, keys } = ring()
    await submitChanges(from({ changes }), 'plan', focus, null)
    expect(keys).toEqual([resultOf(changes, 'plan')])
  })

  test('an untracked folder has no diff to move onto, and no match moves nothing', async () => {
    const repo: RepoChanges = {
      root: 'C:/kit',
      branch: 'main',
      files: { items: [{ code: '??', path: 'drafts/', from: null, lines: null }], more: 0 },
      isPartial: false,
      isUnborn: false,
      problem: null,
    }
    const changes: ChangesSnapshot = { repos: [repo], outside: [], isRead: true }
    expect(searchChanges(changes, 'drafts').length).toBe(1)
    const { focus, keys } = ring()
    const { diffing, toggled } = diffs()
    await submitChanges(from({ changes }), 'drafts', focus, diffing)
    await submitChanges(from({ changes }), 'zebra', focus, diffing)
    expect(toggled).toEqual([])
    expect(keys).toEqual([])
  })
})
