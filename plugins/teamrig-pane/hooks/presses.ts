// What a press in the pane's body does to its state: a task's card opened or closed, a task's page, a reference
// file's page, an inbox, a pick on the Stats tab, Enter in a view's Find field, back from a conversation's page. Each
// reads and writes through the store port (pane-store.ts) and takes the steps of steps.ts, with the readers it needs
// handed in, so the Claude Code dock and a front end with no engine answer a press the same way; the tests run them on
// a store kept in memory.
import type { ExpandedTasks, LogRead, Place, RefFile, RefFileRead, TaskDetail, TaskRow } from '../types'
import { scrolledTo } from './body-scroll'
import { changesResultKey, diffKeyOf, searchChanges } from './changes-search'
import { inboxFile } from './details'
import { unreadLine } from './file-page'
import { fieldAnew, fieldKey } from './find-field'
import { logResultKey, searchLog } from './log-search'
import type { Worked } from './log-title'
import { treeOf, type TreeSource } from './meta'
import { leavingList, pushed, reset } from './nav'
import { NO_STATS_LIST } from './pane-state'
import type { PaneStore } from './pane-store'
import type { InboxPress, StatsPress } from './rows'
import { SEARCH_VIEW } from './search-rows'
import { resultKey } from './search-view'
import { go, openConversation, scrollTo, switchView, type MoveFocus, type ViewLives } from './steps'
import { matchCount, searchTasks, topResult } from './task-search'
import { cardKey, openedWith } from './team-rows'
import { searchTeam, TEAM_SEARCH_VIEW } from './team-search'

/** Reads what a task's refs and goals point at, for its card or its page; a failed read still resolves, unquoted. */
export type ReadsDetail = (task: TaskRow) => Promise<TaskDetail>

/** Reads a reference file as a ref names it; a file not found or not readable resolves to that, never a throw. */
export type ReadsFile = (file: string) => Promise<RefFileRead>

/** The open cards less one. */
function collapse(current: ExpandedTasks, id: string): ExpandedTasks {
  return Object.fromEntries(Object.entries(current).filter(([key]) => key !== id))
}

/**
 * A press on a task row: closes its card when open, else opens it over what its refs and goals point at, read once
 * as it opens. A task the drawing no longer holds opens nothing.
 */
export async function toggleCard(store: PaneStore, tasks: readonly TaskRow[], id: string, detailOf: ReadsDetail): Promise<void> {
  if ((await store.read('expanded'))[id] !== undefined) {
    await store.update('expanded', current => collapse(current, id))
    return
  }
  const task = tasks.find(t => t.id === id)
  if (task === undefined) return
  const detail = await detailOf(task)
  await store.update('expanded', current => ({ ...current, [id]: detail }))
}

/**
 * Shows the page `place`. A page draws in the Tasks view, so a press that opens one from another view (a Teams tab
 * session's card, or another area's inbox count on it) shows the Tasks view at it, over its list: back shows the list,
 * never the other view's search. From the Tasks view's list, the list remembers `from`, the key of the element the
 * press was in, to scroll back to.
 */
export async function openPlace(store: PaneStore, place: Place, from: string): Promise<void> {
  const shown = await store.read('view')
  if (shown !== 'tasks') await store.update('view', () => 'tasks')
  await go(store, current => pushed(shown === 'tasks' ? leavingList(current, from) : reset(current, true), place))
}

/** A press on a task id opens its page, read as a card's is. A task the drawing no longer holds opens nothing. */
export async function openPage(store: PaneStore, tasks: readonly TaskRow[], id: string, from: string, detailOf: ReadsDetail): Promise<void> {
  const task = tasks.find(t => t.id === id)
  if (task === undefined) return
  const detail = await detailOf(task)
  await store.update('pages', current => ({ ...current, [id]: detail }))
  await openPlace(store, { kind: 'task', id }, from)
}

/** Reads a file for its page, once as the page opens, and keeps what was read for the drawing. */
export async function readFilePage(store: PaneStore, file: string, readFile: ReadsFile): Promise<RefFileRead> {
  const found = await readFile(file)
  await store.update('filePages', current => ({ ...current, [file]: found }))
  return found
}

/** A press on a reference file opens its page, at the line its ref points at. */
export async function openFile(store: PaneStore, file: RefFile, from: string, readFile: ReadsFile): Promise<void> {
  await readFilePage(store, file.file, readFile)
  await openPlace(store, { kind: 'file', file: file.file, line: file.line }, from)
}

/**
 * A press on a Teams tab card's inbox count opens that inbox: the session's own (`own` its area) in the Inbox view,
 * another area's as a file's page, landing on its first unread line (file-page.ts unreadLine). Reading it marks
 * nothing read: the pane writes no inbox, the session's `teamrig inbox read` does.
 */
export async function openInbox(
  store: PaneStore,
  press: InboxPress,
  from: string,
  own: string | null,
  readFile: ReadsFile,
  lives: ViewLives,
): Promise<void> {
  if (press.area === own) {
    await switchView(store, 'inbox', lives)
    return
  }
  const file = inboxFile(press.area)
  const found = await readFilePage(store, file, readFile)
  await openPlace(store, { kind: 'file', file, line: unreadLine(found, press.unread) }, from)
}

/** The body's window back at its top, as a step that changes what the body lists leaves it. */
async function toTop(store: PaneStore): Promise<void> {
  await store.update('bodyScroll', current => scrolledTo(current, { kind: 'offset', offset: 0 }))
}

/**
 * A press on the Stats tab's scope or range row picks it, and one on a Health count shows its tasks from their top;
 * each folds the registers at once. A Teams row's [Stats] shows the tab on that row's scope, its numbers from their
 * top, and keeps the row for back; the switch has folded the registers by then.
 */
export async function pickStats(store: PaneStore, press: StatsPress, lives: ViewLives): Promise<void> {
  switch (press.kind) {
    case 'open':
      await store.update('statsScope', () => press.scope)
      await store.update('statsList', () => NO_STATS_LIST)
      await switchView(store, 'stats', lives)
      // After the switch, which drops the row a Stats tab was opened from.
      await store.update('statsFrom', () => press.row)
      await toTop(store)
      return
    case 'scope':
      await store.update('statsScope', () => press.scope)
      break
    case 'range':
      await store.update('statsRange', () => press.range)
      break
    case 'list':
      await store.update('statsList', () => press.list)
      await toTop(store)
      break
  }
  await lives.tallying?.refresh()
}

/** Back from a Health count's tasks shows the tab's numbers again, from their top, folded anew. */
export async function closeStatsList(store: PaneStore, lives: ViewLives): Promise<void> {
  await store.update('statsList', () => NO_STATS_LIST)
  await toTop(store)
  await lives.tallying?.refresh()
}

/** Back from a Stats tab a Teams row opened shows the Teams tab at that row. Read first: the switch drops it. */
export async function closeStatsFrom(store: PaneStore, lives: ViewLives): Promise<void> {
  const row = await store.read('statsFrom')
  await switchView(store, 'team', lives)
  if (row !== null) await scrollTo(store, { kind: 'row', key: row }).catch(() => undefined)
}

/** The Log view's reader, as back from a conversation's page uses it. */
export type ClosesLog = { close(): Promise<void> }

/** The Log view's reader, as a press that opens a conversation's page uses it. */
export type OpensLog = { open(read: LogRead): Promise<void> }

/** The Changes view's diffs, as a press uses them: `toggle` closes the diff keyed `key` when open, else opens it. */
export type TogglesDiff = { toggle(key: string): Promise<void> }

/**
 * Back from a conversation's page shows the list, read again, from its top, or the search the page was opened from:
 * the page drew no Find field, so it comes back a fresh round holding the search's words (fieldAnew).
 */
export async function closeLog(store: PaneStore, logging: ClosesLog | null): Promise<void> {
  await logging?.close()
  const shown = await store.read('nav')
  await store.update('findField', field => fieldAnew(field, shown))
  await toTop(store)
}

/**
 * Enter in the Find field, on its words as typed (a redraw may lag behind them): with more than one match it moves
 * the ring onto the first result drawn (task-search.ts topResult), where Enter opens it and the arrows move on; with
 * one it opens that page and moves the ring onto the page's back step: left in the field, a new round's and empty,
 * it would type the next keys into a new search, so b, f and s would never answer.
 */
export async function submitTasks(store: PaneStore, snap: TreeSource, query: string, focus: MoveFocus, detailOf: ReadsDetail): Promise<void> {
  const results = searchTasks(snap.tasks, query, treeOf(snap))
  const top = topResult(results)
  if (top === null) return
  if (matchCount(results) > 1) {
    await focus(resultKey(SEARCH_VIEW, top.id))
    return
  }
  await openPage(store, snap.tasks, top.id, fieldKey(await store.read('findField')), detailOf)
  await focus('back')
}

/**
 * Enter in the Find field on the Teams tab: with one match it opens that session's card too (openedWith, never
 * closing it), and either way moves the ring onto the first match drawn, where Enter opens or closes its card.
 */
export async function submitTeam(store: PaneStore, query: string, focus: MoveFocus): Promise<void> {
  const tree = await store.read('teamTree')
  const top = tree.kind === 'tree' ? searchTeam(tree.root, query) : []
  const first = top[0]
  if (first === undefined) return
  if (top.length === 1) await store.update('teamToggled', toggled => openedWith(toggled, cardKey(first.row.key)))
  await focus(resultKey(TEAM_SEARCH_VIEW, first.row.key))
}

/**
 * Enter in the Find field on the Log view's list, its titles read from `worked`: with more than one match it moves
 * the ring onto the first drawn; with one it opens that conversation's page and moves the ring onto the page's back
 * step, as submitTasks does. Back from the page shows the search again: its place is still the search.
 */
export async function submitLog(store: PaneStore, worked: Worked, query: string, focus: MoveFocus, logging: OpensLog | null): Promise<void> {
  const top = searchLog(await store.read('logList'), worked, query)
  const first = top[0]
  if (first === undefined) return
  if (top.length > 1) {
    await focus(logResultKey(first.row.conversation))
    return
  }
  const { session, claude } = first.row.conversation
  await openConversation(store, { session, claude }, logging)
  await focus('back')
}

/**
 * Enter in the Find field on the Changes view: with one match it opens that file's diff too (never closing it), and
 * either way moves the ring onto the first match with a diff, where Enter opens or closes it; an untracked folder
 * has none to open.
 */
export async function submitChanges(store: PaneStore, query: string, focus: MoveFocus, diffing: TogglesDiff | null): Promise<void> {
  const hits = searchChanges(await store.read('changes'), query)
  const first = hits.flatMap(hit => {
    const key = diffKeyOf(hit.row)
    return key === null ? [] : [{ hit, key }]
  })[0]
  if (first === undefined) return
  if (hits.length === 1 && (await store.read('diffs'))[first.key] === undefined) await diffing?.toggle(first.key)
  await focus(changesResultKey(first.hit.row))
}
