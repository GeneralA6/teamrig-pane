// The pane's head as data, read from a screen of a store kept in memory: no engine, as a front end other than the
// Claude Code dock reads it. Each piece is held to its key, its words, its look and the press it carries.
import { describe, expect, test } from 'claude-code/testing'
import type { LogConversation, LogList, LogPage, Nav, PaneState, SessionOwnerCards, Snapshot, TaskDetail, TaskRow } from '../types'
import { changesLabel } from '../hooks/changes-rows'
import { readRegister } from '../hooks/core/read/index'
import { heldWeeks, weekClockOf, weekSteps } from '../hooks/done'
import { weekWords } from '../hooks/done-rows'
import { FIRST_MEMO, keysAt, keysHint, submitWords, type KeysWords } from '../hooks/find-field'
import {
  BACK_LABEL,
  DONE_LABEL,
  FORWARD_LABEL,
  LOG_LABEL,
  MINIMIZED_HINT,
  NEXT_LABEL,
  PREV_LABEL,
  STATS_LABEL,
  TEAMS_LABEL,
  TRAIL_SEPARATOR,
  headOf,
  headRows,
  itemCells,
  pressOfBar,
  type Head,
  type HeadButton,
  type HeadGroup,
  type HeadItem,
  type HeadLook,
  type HeadPart,
  type HeadPiece,
} from '../hooks/head'
import { KEYS_HOTKEY, KEYS_LABEL } from '../hooks/keys-page'
import { WrapCache } from '../hooks/layout'
import { rowOf } from '../hooks/log'
import { AT_LIST, back, doneAt, fromList, pushed, searched, wentTo } from '../hooks/nav'
import { NoteHold } from '../hooks/note-hold'
import { buttonCells } from '../hooks/pack'
import { INITIAL_STATE } from '../hooks/pane-state'
import { MemoryStore } from '../hooks/pane-store'
import { screenOf, type Screen } from '../hooks/screen'
import { titleSpans } from '../hooks/session-title'
import { matchCount } from '../hooks/task-search'
import { cells } from '../hooks/width'
import { HOUR, NOW, NO_TEAM, SNAPSHOT_SETTINGS, createLine } from './fixtures'

const COLUMNS = 56
const ROWS = 30

const TASKS: TaskRow[] = [
  ...readRegister(
    [
      createLine('T58', { owner: 'etl', by: 'lead', at: NOW - HOUR, title: 'Load the feed' }),
      createLine('T50', { owner: 'po', by: 'lead', at: NOW - HOUR, title: 'Ship the pages', ref: 'docs/x.md:3' }),
      createLine('T51', { owner: 'po', by: 'lead', at: NOW - HOUR, title: 'Draw the feed chart' }),
      createLine('T52', { owner: 'po', by: 'lead', at: NOW - HOUR, title: 'Name the columns' }),
      createLine('T53', { owner: 'po', by: 'lead', at: NOW - HOUR, title: 'Count the rows' }),
      createLine('T54', { owner: 'po', by: 'lead', at: NOW - HOUR, title: 'Fold the weeks' }),
    ].join('\n'),
  ).state.tasks.values(),
].map(task => rowOf(task))
const SNAP: Snapshot = { tasks: TASKS, area: 'po', areaSource: 'pinned', unreadInbox: null, inbox: [], problem: null, ...NO_TEAM, ...SNAPSHOT_SETTINGS, now: NOW }
const DETAIL: TaskDetail = { ref: null, quotes: [], goals: [] }
/** A page read for every task of the fixture, so any of them can be the place shown. */
const PAGES: PaneState['pages'] = Object.fromEntries(TASKS.map(task => [task.id, DETAIL]))
const task = (id: string) => ({ kind: 'task', id }) as const
const ON_T50 = fromList('row:T50', task('T50'))

/** A front end's own words on the keys. */
const KEYS: KeysWords = { leave: { search: 'Esc: out', result: null, pane: 'x: quit' }, away: 'Keys are elsewhere', page: [] }

/** A docked front end that holds the keys, but for `changed`. */
const lookOf = (changed: Partial<HeadLook> = {}): HeadLook => ({ inline: false, columns: COLUMNS, isHeld: true, keys: KEYS, ...changed })

/** The screen of a pane that starts with the register read, but for `changed`, and its head, both to the same front end. */
async function shown(changed: Partial<PaneState> = {}, at: Partial<HeadLook> = {}): Promise<{ readonly screen: Screen; readonly head: Head }> {
  const look = lookOf(at)
  const screen = await screenOf(new MemoryStore({ ...INITIAL_STATE, snapshot: SNAP, ...changed }), {
    ...look,
    bodyRows: ROWS,
    canAct: false,
    memo: FIRST_MEMO,
    noteHold: new NoteHold<Snapshot>(),
    wraps: new WrapCache(),
    hostOld: () => 'host too old',
    tieHint: null,
  })
  return { screen, head: headOf(screen, look) }
}

type Packed = Extract<HeadPiece, { kind: 'packed' }>

/** What a part is known by: its key where it has one, else its kind. */
function nameOf(part: HeadPart): string {
  return part.kind === 'group' || part.kind === 'packed' || part.kind === 'text' ? part.key : part.kind
}

function groupOf(head: Head, key: string): HeadGroup {
  const found = head.parts.find((part): part is HeadGroup => part.kind === 'group' && part.key === key)
  if (found === undefined) throw new Error(`no ${key} group`)
  return found
}

function packedOf(parts: readonly HeadPart[], key: string): Packed {
  const found = parts.find((part): part is Packed => part.kind === 'packed' && part.key === key)
  if (found === undefined) throw new Error(`no ${key} rows`)
  return found
}

function pieceOf<K extends HeadPiece['kind']>(parts: readonly HeadPart[], kind: K): Extract<HeadPiece, { kind: K }> {
  const found = parts.find((part): part is Extract<HeadPiece, { kind: K }> => part.kind === kind)
  if (found === undefined) throw new Error(`no ${kind} piece`)
  return found
}

function buttonOf(items: readonly HeadItem[], key: string): HeadButton {
  const found = items.find((item): item is HeadButton => item.kind === 'button' && item.key === key)
  if (found === undefined) throw new Error(`no ${key} button`)
  return found
}

const itemsOf = (piece: Packed): HeadItem[] => piece.rows.flat()
const keysOf = (items: readonly HeadItem[]): string[] => items.map(item => item.key)
/** The switch's items of a head, the minimized pane's too. */
const switchItems = (head: Head): HeadItem[] => itemsOf(packedOf(head.strip ? head.parts : groupOf(head, 'controls').pieces, 'switch'))
const modeItems = (head: Head): HeadItem[] => itemsOf(packedOf(groupOf(head, 'controls').pieces, 'modes'))
/** A row's cells as drawn: its items and the gap between two. */
const rowCells = (row: readonly HeadItem[], gap: number): number => row.reduce((sum, item) => sum + itemCells(item), 0) + gap * (row.length - 1)

const VIEW_KEYS = ['tasks', 'changes', 'log', 'inbox', 'team', 'meetings', 'stats']
const dimWords = (key: string, text: string): HeadItem => ({ kind: 'words', key, text, tone: 'dim', cut: false })
const boldWords = (key: string, text: string): HeadItem => ({ kind: 'words', key, text, tone: 'bold', cut: false })

describe("the Tasks list's head", () => {
  test('the controls stand over the status bar: title, switch, Find row, its line, modes', async () => {
    const { screen, head } = await shown()
    expect(head.strip).toBe(false)
    expect(head.parts.map(nameOf)).toEqual(['controls', 'bar'])
    const { pieces } = groupOf(head, 'controls')
    expect(pieces.map(nameOf)).toEqual(['title', 'switch', 'find', 'keys', 'modes'])
    expect(pieceOf(pieces, 'text').spans).toEqual(titleSpans(SNAP))
    expect(screen.barLines.length).toBeGreaterThan(0)
    expect(pieceOf(head.parts, 'bar').lines).toEqual(screen.barLines)
  })

  test('the rows of a part are those of its pieces, a row each but the packed rows, the keys line and the bar', async () => {
    const { screen, head } = await shown({}, { columns: 20 })
    const controls = groupOf(head, 'controls')
    const views = packedOf(controls.pieces, 'switch')
    const modes = packedOf(controls.pieces, 'modes')
    const keys = pieceOf(controls.pieces, 'keys')
    expect(views.rows.length).toBeGreaterThan(1)
    expect(keys.lines.length).toBeGreaterThan(1)
    expect(headRows(views)).toBe(views.rows.length)
    expect(headRows(keys)).toBe(keys.lines.length)
    // The title and the Find row take a row each.
    expect(headRows(controls)).toBe(2 + views.rows.length + keys.lines.length + modes.rows.length)
    expect(headRows(pieceOf(head.parts, 'bar'))).toBe(screen.barLines.length)
  })
})

describe('the switch', () => {
  test('a button a view in order, each with its key and press, the view shown primary', async () => {
    const { screen, head } = await shown()
    const items = switchItems(head)
    expect(keysOf(items)).toEqual(VIEW_KEYS)
    expect(items.map(item => (item.kind === 'button' ? item.hotkey : null))).toEqual(['t', 'd', 'g', 'u', 'e', 'j', 'r'])
    expect(items.map(item => (item.kind === 'button' ? item.press : null))).toEqual(VIEW_KEYS.map(view => ({ kind: 'view', view })))
    expect(items.map(item => (item.kind === 'button' ? item.label : null))).toEqual([
      'Tasks',
      changesLabel(screen.changed),
      LOG_LABEL,
      'Inbox',
      TEAMS_LABEL,
      'Meetings',
      STATS_LABEL,
    ])
    expect(items.map(item => (item.kind === 'button' ? item.look : null))).toEqual(['primary', ...VIEW_KEYS.slice(1).map(() => 'secondary')])
  })

  test('another view shown is the primary one', async () => {
    const { head } = await shown({ view: 'team' })
    const items = switchItems(head)
    expect(buttonOf(items, 'team').look).toBe('primary')
    expect(buttonOf(items, 'tasks').look).toBe('secondary')
  })

  test('Inbox counts the unread lines and Teams the cards waiting on the owner now, each the word alone at none', async () => {
    const cards = (...ids: string[]): SessionOwnerCards => ({ due: ids.map(id => ({ id, title: `Decide ${id}` })), later: [] })
    const counted = await shown({ snapshot: { ...SNAP, unreadInbox: 3, ownerCards: { po: cards('T4', 'T5'), etl: cards('T6') } } })
    expect(buttonOf(switchItems(counted.head), 'inbox').label).toBe('Inbox (3)')
    expect(buttonOf(switchItems(counted.head), 'team').label).toBe(`${TEAMS_LABEL} (3)`)
    const none = await shown({ snapshot: { ...SNAP, unreadInbox: 0, ownerCards: { po: cards() } } })
    expect(buttonOf(switchItems(none.head), 'inbox').label).toBe('Inbox')
    expect(buttonOf(switchItems(none.head), 'team').label).toBe(TEAMS_LABEL)
  })

  test('narrow columns pack it in more rows, none wider than the columns', async () => {
    const columns = 24
    const { head } = await shown({}, { columns })
    const views = packedOf(groupOf(head, 'controls').pieces, 'switch')
    expect(views.rows.length).toBeGreaterThan(1)
    expect(keysOf(itemsOf(views))).toEqual(VIEW_KEYS)
    for (const row of views.rows) expect(rowCells(row, views.gap)).toBeLessThanOrEqual(columns)
  })
})

describe('a minimized pane', () => {
  test('draws the switch alone as a strip, a dim mark after it saying how to open the pane', async () => {
    const { head } = await shown({ size: 'minimized' }, { columns: 200 })
    expect(head.strip).toBe(true)
    expect(head.parts.map(nameOf)).toEqual(['switch'])
    const items = switchItems(head)
    expect(keysOf(items)).toEqual([...VIEW_KEYS, 'switch:sep:1', 'hint'])
    expect(items.at(-2)).toEqual(dimWords('switch:sep:1', '·'))
    expect(items.at(-1)).toEqual({ kind: 'words', key: 'hint', text: MINIMIZED_HINT, tone: 'dim', cut: true })
  })

  test('at narrow columns the mark takes a row of its own, no separator before it', async () => {
    const { head } = await shown({ size: 'minimized' }, { columns: 24 })
    const views = packedOf(head.parts, 'switch')
    expect(keysOf(itemsOf(views))).toEqual([...VIEW_KEYS, 'hint'])
    expect(keysOf(views.rows.at(-1) ?? [])).toEqual(['hint'])
  })
})

describe('a project teamrig is not set up for', () => {
  const setup: PaneState['setup'] = { setup: { project: 'C:/kit/web', teams: ['acme'] }, problem: null }

  test('docked, the title alone: no switch, Find row or modes', async () => {
    const { head } = await shown({ setup })
    expect(head.strip).toBe(false)
    expect(head.parts.map(nameOf)).toEqual(['title'])
  })

  test('inline, nothing', async () => {
    const { head } = await shown({ setup }, { inline: true })
    expect(head.parts).toEqual([])
  })
})

describe('inline, above the prompt', () => {
  test('no title, Find row, Done page or Keys page: the switch and the modes', async () => {
    const { head } = await shown({}, { inline: true })
    expect(groupOf(head, 'controls').pieces.map(nameOf)).toEqual(['switch', 'modes'])
    expect(keysOf(modeItems(head))).toEqual(['mine', 'all'])
  })
})

describe('the modes', () => {
  test('mine and all, the Done page at the week of now, then the Keys page, each group apart', async () => {
    const { head } = await shown()
    const items = modeItems(head)
    expect(keysOf(items)).toEqual(['mine', 'all', 'modes:sep:1', 'done-page', 'modes:sep:3', 'keys'])
    expect(buttonOf(items, 'mine')).toEqual({ kind: 'button', key: 'mine', label: 'mine', hotkey: 'm', look: 'primary', press: { kind: 'mode', mode: 'mine' } })
    expect(buttonOf(items, 'all')).toEqual({ kind: 'button', key: 'all', label: 'all', hotkey: 'a', look: 'secondary', press: { kind: 'mode', mode: 'all' } })
    expect(buttonOf(items, 'done-page')).toEqual({
      kind: 'button',
      key: 'done-page',
      label: DONE_LABEL,
      hotkey: 'h',
      look: 'secondary',
      press: { kind: 'done-week', week: heldWeeks(weekClockOf(SNAP)).newest },
    })
    expect(buttonOf(items, 'keys')).toEqual({ kind: 'button', key: 'keys', label: KEYS_LABEL, hotkey: KEYS_HOTKEY, look: 'plain', press: { kind: 'keys' } })
  })

  test('the all list shown, all is the primary one', async () => {
    const { head } = await shown({ mode: 'all' })
    expect(buttonOf(modeItems(head), 'all').look).toBe('primary')
    expect(buttonOf(modeItems(head), 'mine').look).toBe('secondary')
  })

  test('close cards shows while a card is open in the list, never on a page', async () => {
    const expanded = { T50: DETAIL }
    const onList = await shown({ expanded })
    expect(buttonOf(modeItems(onList.head), 'close-cards')).toEqual({
      kind: 'button',
      key: 'close-cards',
      label: 'close cards',
      hotkey: 'c',
      look: 'secondary',
      press: { kind: 'close-cards' },
    })
    const onPage = await shown({ expanded, nav: ON_T50, pages: PAGES })
    expect(keysOf(modeItems(onPage.head))).not.toContain('close-cards')
    const closed = await shown()
    expect(keysOf(modeItems(closed.head))).not.toContain('close-cards')
  })

  test('only the Tasks view draws them', async () => {
    const { head } = await shown({ view: 'team' })
    expect(groupOf(head, 'controls').pieces.map(nameOf)).not.toContain('modes')
  })
})

describe("a page's head", () => {
  /** The list, then a page of each of `ids` pushed over it, the last shown. */
  const through = (...ids: string[]): Nav => ids.reduce((nav, id) => pushed(nav, task(id)), AT_LIST)

  test('none on the list with nothing ahead', async () => {
    const { head } = await shown()
    expect(head.parts.map(nameOf)).not.toContain('page-head')
  })

  test('on a page: back a press, forward dim words, the trail to the page shown in bold, a rule', async () => {
    const { head } = await shown({ nav: ON_T50, pages: PAGES })
    const group = groupOf(head, 'page-head')
    expect(group.pieces.map(nameOf)).toEqual(['row', 'trail', 'rule'])
    const steps = pieceOf(group.pieces, 'row')
    expect(steps.gap).toBe(2)
    expect(steps.items).toEqual([
      { kind: 'button', key: 'back', label: BACK_LABEL, hotkey: 'b', look: 'secondary', press: { kind: 'back' } },
      dimWords('forward', FORWARD_LABEL),
    ])
    expect(itemsOf(packedOf(group.pieces, 'trail'))).toEqual([
      { kind: 'crumb', key: 'crumb:0', label: 'Tasks', isAhead: false, press: { kind: 'crumb', index: 0 } },
      dimWords('after:0', TRAIL_SEPARATOR),
      boldWords('crumb:1', 'T50'),
    ])
    expect(pieceOf(group.pieces, 'rule').cells).toBe(COLUMNS)
    expect(headRows(group)).toBe(3)
  })

  test('on the list a page lies ahead of: back dim words, forward a press, the page ahead dim in the trail', async () => {
    const { head } = await shown({ nav: back(ON_T50), pages: PAGES })
    const group = groupOf(head, 'page-head')
    expect(pieceOf(group.pieces, 'row').items).toEqual([
      dimWords('back', BACK_LABEL),
      { kind: 'button', key: 'forward', label: FORWARD_LABEL, hotkey: 'f', look: 'secondary', press: { kind: 'forward' } },
    ])
    expect(itemsOf(packedOf(group.pieces, 'trail'))).toEqual([
      boldWords('crumb:0', 'Tasks'),
      dimWords('after:0', TRAIL_SEPARATOR),
      { kind: 'crumb', key: 'crumb:1', label: 'T50', isAhead: true, press: { kind: 'crumb', index: 1 } },
    ])
  })

  test('past four places the trail is cut, before the oldest shown or after the newest', async () => {
    const deep = through('T50', 'T51', 'T52', 'T53', 'T54')
    const atEnd = await shown({ nav: deep, pages: PAGES })
    expect(keysOf(itemsOf(packedOf(groupOf(atEnd.head, 'page-head').pieces, 'trail')))).toEqual([
      'cut-before',
      'crumb:2',
      'after:2',
      'crumb:3',
      'after:3',
      'crumb:4',
      'after:4',
      'crumb:5',
    ])
    const atStart = await shown({ nav: wentTo(deep, 0), pages: PAGES })
    const items = itemsOf(packedOf(groupOf(atStart.head, 'page-head').pieces, 'trail'))
    expect(keysOf(items)).toEqual(['crumb:0', 'after:0', 'crumb:1', 'after:1', 'crumb:2', 'after:2', 'crumb:3', 'cut-after'])
    expect(items.at(-1)).toEqual(dimWords('cut-after', `${TRAIL_SEPARATOR}…`))
    expect(itemsOf(packedOf(groupOf(atEnd.head, 'page-head').pieces, 'trail'))[0]).toEqual(dimWords('cut-before', `…${TRAIL_SEPARATOR}`))
  })

  test('a narrow pane packs the trail in more rows, the rule a cell at least', async () => {
    const { head } = await shown({ nav: through('T50', 'T51', 'T52'), pages: PAGES }, { columns: 12 })
    const group = groupOf(head, 'page-head')
    const places = packedOf(group.pieces, 'trail')
    expect(places.rows.length).toBeGreaterThan(1)
    expect(headRows(group)).toBe(2 + places.rows.length)
    const none = headOf((await shown({ nav: ON_T50, pages: PAGES })).screen, lookOf({ columns: 0 }))
    expect(pieceOf(groupOf(none, 'page-head').pieces, 'rule').cells).toBe(1)
  })
})

describe('the Find row', () => {
  test("the Tasks view's field under its round's key, Enter searching the tasks, no clear while no search shows", async () => {
    const { screen, head } = await shown({}, { columns: 200 })
    const { pieces } = groupOf(head, 'controls')
    const enter = submitWords(matchCount(screen.found))
    expect(pieceOf(pieces, 'find').find).toEqual({ key: 'find', placeholder: 'id, title, owner, note…', text: '', submitLabel: enter, submits: 'tasks', clears: false })
    const keys = pieceOf(pieces, 'keys')
    expect(keys.at).toBe(keysAt(true, screen.landings, screen.memo, false))
    expect(keys.lines).toEqual([keysHint(keys.at, enter, KEYS)])
    expect(keys.lines[0]).toContain(' · x: quit')
  })

  test('a search shown: the field holds its words in a new round, and clear is drawn', async () => {
    const { screen, head } = await shown({ nav: searched(AT_LIST, 'feed'), findField: { round: 1, text: 'feed' } })
    const { find } = pieceOf(groupOf(head, 'controls').pieces, 'find')
    expect(find.key).toBe('find:1')
    expect(find.text).toBe('feed')
    expect(find.clears).toBe(true)
    expect(find.submitLabel).toBe(submitWords(matchCount(screen.found)))
    expect(pieceOf(groupOf(head, 'controls').pieces, 'keys').at).toBe(keysAt(true, screen.landings, screen.memo, true))
  })

  test('the line under it says where the keys go, wrapped to the columns, by whether the pane holds them', async () => {
    const columns = 20
    const held = await shown({}, { columns })
    const lines = pieceOf(groupOf(held.head, 'controls').pieces, 'keys').lines
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) expect(cells(line)).toBeLessThanOrEqual(columns)
    const lost = await shown({}, { isHeld: false })
    const keys = pieceOf(groupOf(lost.head, 'controls').pieces, 'keys')
    expect(keys.at).toBe(keysAt(false, lost.screen.landings, lost.screen.memo, false))
    expect(keys.at).not.toBe(pieceOf(groupOf(held.head, 'controls').pieces, 'keys').at)
  })

  test('each view with a search names what Enter runs; the Inbox view runs none', async () => {
    const finds = async (view: PaneState['view']) => pieceOf(groupOf((await shown({ view })).head, 'controls').pieces, 'find').find
    const team = await finds('team')
    expect([team.placeholder, team.submits]).toEqual(['id, name, role, scope…', 'team'])
    const changes = await finds('changes')
    expect([changes.placeholder, changes.submits]).toEqual(['path, repo, branch…', 'changes'])
    const log = await finds('log')
    expect([log.placeholder, log.submits]).toEqual(['task, title, session…', 'log'])
    const inbox = await finds('inbox')
    expect([inbox.placeholder, inbox.submits, inbox.submitLabel]).toEqual(['sender, words…', null, 'search'])
  })

  test('the Meetings view and the Stats tab draw none', async () => {
    for (const view of ['meetings', 'stats'] as const) {
      const { head } = await shown({ view })
      expect(groupOf(head, 'controls').pieces.map(nameOf)).toEqual(['title', 'switch'])
    }
  })
})

describe('a view with one way back', () => {
  const CONVERSATION: LogConversation = { session: 'po', claude: 'c-1', firstAt: NOW - 2 * HOUR, lastAt: NOW - HOUR, nextAt: null, lines: 4, opening: null }
  const LOGS: LogList = { kind: 'conversations', hours: 24, conversations: [CONVERSATION] }
  const LOG_PAGE: LogPage = { session: 'po', claude: 'c-1', hours: 24, entries: [], isCut: false, problem: null }
  const backTo = (press: HeadButton['press']): HeadPiece => ({
    kind: 'item',
    item: { kind: 'button', key: 'back', label: BACK_LABEL, hotkey: 'b', look: 'secondary', press },
  })

  test("a conversation's page leads back to the list, its title after the view's name, and draws no Find row", async () => {
    const { screen, head } = await shown({ view: 'log', logList: LOGS, logPage: LOG_PAGE })
    expect(screen.logTitle).not.toBeNull()
    expect(groupOf(head, 'controls').pieces.map(nameOf)).toEqual(['title', 'switch'])
    const group = groupOf(head, 'log-head')
    expect(group.pieces).toEqual([
      backTo({ kind: 'log-close' }),
      { kind: 'text', key: 'log-trail', spans: [{ text: LOG_LABEL }, { text: TRAIL_SEPARATOR, dim: true }, ...(screen.logTitle ?? [])] },
      { kind: 'rule', cells: COLUMNS },
    ])
    expect(headRows(group)).toBe(3)
  })

  test('the Stats tab a Teams row opened leads back to that row', async () => {
    const { screen, head } = await shown({ view: 'stats', stats: { kind: 'failed', reason: 'no register' }, statsFrom: 'acme/api' })
    expect(screen.statsBack).toBe(true)
    expect(groupOf(head, 'stats-head').pieces).toEqual([
      backTo({ kind: 'stats-from-close' }),
      { kind: 'text', key: 'stats-trail', spans: [{ text: TEAMS_LABEL }, { text: TRAIL_SEPARATOR, dim: true }, { text: STATS_LABEL }] },
      { kind: 'rule', cells: COLUMNS },
    ])
  })

  test("a Health count's tasks lead back to the tab's numbers, before any Teams row", async () => {
    const { screen } = await shown({ view: 'stats', stats: { kind: 'failed', reason: 'no register' }, statsFrom: 'acme/api' })
    const head = headOf({ ...screen, statsTitle: 'Overdue (3)' }, lookOf())
    expect(groupOf(head, 'stats-head').pieces).toEqual([
      backTo({ kind: 'stats-list-close' }),
      { kind: 'text', key: 'stats-trail', spans: [{ text: STATS_LABEL }, { text: TRAIL_SEPARATOR, dim: true }, { text: 'Overdue (3)' }] },
      { kind: 'rule', cells: COLUMNS },
    ])
  })

  test('the Stats tab opened from the switch has no way back', async () => {
    const { head } = await shown({ view: 'stats' })
    expect(head.parts.map(nameOf)).not.toContain('stats-head')
  })
})

describe("the Done page's weeks", () => {
  const clock = weekClockOf(SNAP)
  const { newest, oldest } = heldWeeks(clock)
  const weeks = async (week: string) => {
    const { head } = await shown({ nav: doneAt(AT_LIST, week) })
    return { head, steps: packedOf(head.parts, 'week-steps') }
  }

  test('none off the Done page', async () => {
    const { head } = await shown()
    expect(head.parts.map(nameOf)).not.toContain('week-steps')
  })

  test('at the newest week held: a step to the week before, the week in bold, no newer one', async () => {
    expect(oldest).not.toBe(newest)
    const { head, steps } = await weeks(newest)
    expect(steps.gap).toBe(2)
    expect(itemsOf(steps)).toEqual([
      { kind: 'button', key: 'prev', label: PREV_LABEL, hotkey: 'p', look: 'secondary', press: { kind: 'done-week', week: weekSteps(newest, clock).prev } },
      boldWords('week', `week of ${weekWords(newest)}`),
      dimWords('next', NEXT_LABEL),
    ])
    // The Done page is a page: its head stands before the weeks, and its button is the one that is on.
    expect(head.parts.map(nameOf)).toEqual(['controls', 'page-head', 'week-steps'])
    expect(buttonOf(modeItems(head), 'done-page').look).toBe('primary')
  })

  test('at the oldest week held: no older one, a step to the week after', async () => {
    const { steps } = await weeks(oldest)
    expect(itemsOf(steps)).toEqual([
      dimWords('prev', PREV_LABEL),
      boldWords('week', `week of ${weekWords(oldest)}`),
      { kind: 'button', key: 'next', label: NEXT_LABEL, hotkey: 'l', look: 'secondary', press: { kind: 'done-week', week: weekSteps(oldest, clock).next } },
    ])
  })
})

describe('pressOfBar', () => {
  test('a segment or a count filters the list to its status; words are no press', async () => {
    const { screen } = await shown()
    const pieces = screen.barLines.flat()
    const pressed = pieces.filter(piece => piece.status !== null)
    expect(pressed.length).toBeGreaterThan(0)
    expect(pressed.length).toBeLessThan(pieces.length)
    for (const piece of pieces) expect(pressOfBar(piece)).toEqual(piece.status === null ? null : { kind: 'filter', status: piece.status })
  })
})

describe('itemCells', () => {
  test('words take their own cells, a crumb those of a plain button, a button its frame and key too', () => {
    const press = { kind: 'back' } as const
    const framed: HeadItem = { kind: 'button', key: 'back', label: BACK_LABEL, hotkey: 'b', look: 'secondary', press }
    const plain: HeadItem = { ...framed, look: 'plain' }
    expect(itemCells(dimWords('after:0', TRAIL_SEPARATOR))).toBe(3)
    expect(itemCells({ kind: 'crumb', key: 'crumb:0', label: 'Tasks', isAhead: false, press })).toBe(buttonCells({ label: 'Tasks', plain: true, hotkey: null }))
    expect(itemCells(framed)).toBe(buttonCells({ label: BACK_LABEL, plain: false, hotkey: 'b' }))
    expect(itemCells(plain)).toBe(buttonCells({ label: BACK_LABEL, plain: true, hotkey: 'b' }))
    expect(itemCells(framed)).toBeGreaterThan(itemCells(plain))
  })
})
