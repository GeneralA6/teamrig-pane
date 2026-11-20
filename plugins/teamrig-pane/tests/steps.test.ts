// The pane's steps on a store kept in memory: no engine, as a front end other than the Claude Code dock runs them.
import { describe, expect, test } from 'claude-code/testing'
import type { LogRead, MeetingAnswer, MeetingAsked, PaneState, PaneView, Place, RefFileRead, SessionAnswer, TaskDetail } from '../types'
import { AT_LIST, back, forward, fromList, pushed, searched } from '../hooks/nav'
import { INITIAL_STATE } from '../hooks/pane-state'
import { MemoryStore } from '../hooks/pane-store'
import { clearSearch, focusFind, go, openConversation, scrollTo, showMode, switchView, type MoveFocus, type ViewLives } from '../hooks/steps'

/** A store that starts as a pane does, but for `changed`. */
const from = (changed: Partial<PaneState> = {}) => new MemoryStore({ ...INITIAL_STATE, ...changed })

const task = (id: string): Place => ({ kind: 'task', id })
const DETAIL: TaskDetail = { ref: null, quotes: [], goals: [] }
const fileRead = (text: string): RefFileRead => ({ kind: 'read', path: 'C:/kit/teams/web/notes/api/t26.md', text })
/** The list remembering the row T4's page was opened from, then that page. */
const ON_T4 = fromList('row:T4', task('T4'))

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

/** The readers a switch refreshes, each keeping the step taken on it in `calls`. */
function readers(): { readonly lives: ViewLives; readonly calls: string[] } {
  const calls: string[] = []
  const called = (call: string) => () => {
    calls.push(call)
    return Promise.resolve()
  }
  return {
    calls,
    lives: {
      sizer: {
        set: size => {
          calls.push(`size ${size}`)
          return Promise.resolve()
        },
      },
      tracked: { refresh: called('changes read') },
      logging: { close: called('log page closed') },
      teaming: { refresh: called('team read') },
      scheduling: { refresh: called('meetings read') },
      tallying: { refresh: called('stats folded') },
    },
  }
}

const NO_READERS: ViewLives = { sizer: null, tracked: null, logging: null, teaming: null, scheduling: null, tallying: null }

describe('go', () => {
  test('a step that leaves the places as they were moves nothing else', async () => {
    const store = from()
    await go(store, current => current)
    expect(store.state).toEqual(INITIAL_STATE)
  })

  test('a page opens at its top, the Find field kept in its round', async () => {
    const store = from()
    await go(store, current => pushed(current, task('T7')))
    expect(store.state.nav).toEqual({ places: [{ kind: 'list', row: null }, task('T7')], at: 1 })
    expect(store.state.bodyScroll).toEqual({ seq: INITIAL_STATE.bodyScroll.seq + 1, to: { kind: 'offset', offset: 0 } })
    expect(store.state.findField).toBe(INITIAL_STATE.findField)
  })

  test('typing never starts a round of the Find field; a step that changes what it holds does', async () => {
    const store = from()
    await go(store, current => searched(current, 'api'), 'typing')
    expect(store.state.findField).toEqual({ round: 0, text: '' })
    await go(store, back)
    expect(store.state.findField).toEqual({ round: 1, text: '' })
    await go(store, forward)
    expect(store.state.findField).toEqual({ round: 2, text: 'api' })
  })

  test('typing in the search shown leaves the window where it is', async () => {
    const store = from({ nav: searched(AT_LIST, 'ap') })
    await go(store, current => searched(current, 'api'), 'typing')
    expect(store.state.bodyScroll).toBe(INITIAL_STATE.bodyScroll)
  })

  test('only the pages and the files a place still names keep what they read', async () => {
    const store = from({
      nav: pushed(pushed(AT_LIST, task('T1')), task('T2')),
      pages: { T1: DETAIL, T2: DETAIL, T9: DETAIL },
      filePages: { 'notes/a.md': fileRead('a') },
    })
    await go(store, back)
    expect(Object.keys(store.state.pages)).toEqual(['T1', 'T2'])
    expect(store.state.filePages).toEqual({})
    await go(store, current => pushed(current, { kind: 'keys' }))
    expect(Object.keys(store.state.pages)).toEqual(['T1'])
  })

  test('a return from a page to the list brings the row it was opened from to the middle', async () => {
    const store = from({ nav: ON_T4 })
    await go(store, back)
    expect(store.state.bodyScroll.to).toEqual({ kind: 'reveal', key: 'row:T4', block: 'center' })
  })

  test("a file's page opens at the paragraph holding its ref's line, at its top while the file is not read", async () => {
    const file: Place = { kind: 'file', file: 'notes/a.md', line: 4 }
    const read = from({ filePages: { 'notes/a.md': fileRead('a\nb\n\nc') } })
    await go(read, current => pushed(current, file))
    expect(read.state.bodyScroll.to).toEqual({ kind: 'reveal', key: 'file-page:para:4', block: 'start' })

    const unread = from()
    await go(unread, current => pushed(current, file))
    expect(unread.state.bodyScroll.to).toEqual({ kind: 'offset', offset: 0 })
  })

  test('two steps taken at once both land, the second on the places the first left', async () => {
    const store = from()
    await Promise.all([go(store, current => pushed(current, task('T1'))), go(store, current => pushed(current, task('T2')))])
    expect(store.state.nav).toEqual({ places: [{ kind: 'list', row: null }, task('T1'), task('T2')], at: 2 })
  })
})

describe('scrollTo', () => {
  test('each move counts, so a second landing on the same row is a new one to settle', async () => {
    const store = from()
    await scrollTo(store, { kind: 'row', key: 'row:T4' })
    await scrollTo(store, { kind: 'row', key: 'row:T4' })
    expect(store.state.bodyScroll).toEqual({ seq: INITIAL_STATE.bodyScroll.seq + 2, to: { kind: 'reveal', key: 'row:T4', block: 'center' } })
  })
})

describe('focusFind', () => {
  test("moves the ring onto the field under its round's key", async () => {
    const { focus, keys } = ring()
    await focusFind(from(), focus)
    await focusFind(from({ findField: { round: 2, text: 'api' } }), focus)
    expect(keys).toEqual(['find', 'find:2'])
  })
})

describe('clearSearch', () => {
  test('closes the search and moves the ring into the field of the round the close started', async () => {
    const store = from({ nav: searched(AT_LIST, 'api') })
    const { focus, keys } = ring()
    await clearSearch(store, focus)
    expect(store.state.nav).toEqual(AT_LIST)
    expect(store.state.findField).toEqual({ round: 1, text: '' })
    expect(keys).toEqual(['find:1'])
  })
})

describe('showMode', () => {
  test('shows the other list alone, the row a page was opened from forgotten', async () => {
    const store = from({ nav: ON_T4 })
    await showMode(store, 'all')
    expect(store.state.mode).toBe('all')
    expect(store.state.nav).toBe(AT_LIST)
  })
})

describe('switchView', () => {
  test("opens the pane on the view's list, back at the row a page was opened from, the Stats tab's back dropped", async () => {
    const store = from({ view: 'stats', statsFrom: 'session:web/api', nav: ON_T4 })
    const { lives, calls } = readers()
    await switchView(store, 'tasks', lives)
    expect(store.state.view).toBe('tasks')
    expect(store.state.statsFrom).toBeNull()
    expect(store.state.nav).toEqual({ places: [{ kind: 'list', row: 'row:T4' }], at: 0 })
    expect(store.state.bodyScroll.to).toEqual({ kind: 'reveal', key: 'row:T4', block: 'center' })
    expect(calls).toEqual(['size open'])
  })

  test('closes a search, which the views share', async () => {
    const store = from({ nav: searched(AT_LIST, 'api') })
    await switchView(store, 'changes', NO_READERS)
    expect(store.state.nav).toEqual(AT_LIST)
    expect(store.state.findField).toEqual({ round: 1, text: '' })
  })

  test('reads the view it shows at once, and closes the Log page for its list', async () => {
    const taken: [PaneView, string[]][] = []
    for (const target of ['tasks', 'changes', 'log', 'inbox', 'team', 'meetings', 'stats'] as const) {
      const { lives, calls } = readers()
      await switchView(from(), target, lives)
      taken.push([target, calls])
    }
    expect(taken).toEqual([
      ['tasks', ['size open']],
      ['changes', ['size open', 'changes read']],
      ['log', ['size open', 'log page closed']],
      ['inbox', ['size open']],
      ['team', ['size open', 'team read']],
      ['meetings', ['size open', 'meetings read']],
      ['stats', ['size open', 'stats folded']],
    ])
  })

  test("a switch to Teams leaves the last press's answer behind, one to Meetings its answer and its second line", async () => {
    const sessionAnswer: SessionAnswer = { act: 'wake', team: 'web', session: 'api', outcome: 'done', lines: ['woken'], at: 1 }
    const meetingAnswer: MeetingAnswer = { id: 'M1', verb: 'start', outcome: 'done', lines: ['started'] }
    const meetingAsked: MeetingAsked = { id: 'M1', ask: 'drop' }
    const store = from({ sessionAnswer, meetingAnswer, meetingAsked })
    await switchView(store, 'team', NO_READERS)
    expect(store.state.sessionAnswer).toBeNull()
    expect(store.state.meetingAnswer).toBe(meetingAnswer)
    expect(store.state.meetingAsked).toBe(meetingAsked)
    await switchView(store, 'meetings', NO_READERS)
    expect(store.state.meetingAnswer).toBeNull()
    expect(store.state.meetingAsked).toBeNull()
  })

  test('before the session starts, with no reader, it still shows the view', async () => {
    const store = from()
    await switchView(store, 'stats', NO_READERS)
    expect(store.state.view).toBe('stats')
  })
})

describe('openConversation', () => {
  const conversation: LogRead = { session: 'api', claude: 'c-1' }

  test("opens the conversation's page, read now, at its end", async () => {
    const store = from()
    const opened: LogRead[] = []
    await openConversation(store, conversation, {
      open: read => {
        opened.push(read)
        return Promise.resolve()
      },
    })
    expect(opened).toEqual([conversation])
    expect(store.state.bodyScroll).toEqual({ seq: INITIAL_STATE.bodyScroll.seq + 1, to: { kind: 'end' } })
  })

  test('with no turn log to read, the window still moves to the end', async () => {
    const store = from()
    await openConversation(store, conversation, null)
    expect(store.state.bodyScroll.to).toEqual({ kind: 'end' })
  })
})
