// The pane's presses on a store kept in memory: no engine, as a front end other than the Claude Code dock runs them.
import { describe, expect, test } from 'claude-code/testing'
import type { PaneState, RefFileRead, TaskDetail, TaskRow } from '../types'
import { readRegister } from '../hooks/core/read/index'
import { rowOf } from '../hooks/log'
import { AT_LIST, searched } from '../hooks/nav'
import { INITIAL_STATE } from '../hooks/pane-state'
import { MemoryStore } from '../hooks/pane-store'
import {
  closeStatsFrom,
  closeStatsList,
  openFile,
  openInbox,
  openPage,
  openPlace,
  pickStats,
  readFilePage,
  toggleCard,
  type ReadsDetail,
  type ReadsFile,
} from '../hooks/presses'
import type { ViewLives } from '../hooks/steps'
import { HOUR, NOW, createLine } from './fixtures'

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
