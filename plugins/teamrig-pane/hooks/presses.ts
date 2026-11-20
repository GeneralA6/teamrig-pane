// What a press in the pane's body does to its state: a task's card opened or closed, a task's page, a reference
// file's page, an inbox. Each reads and writes through the store port (pane-store.ts) and takes the steps of
// steps.ts, with the readers it needs handed in, so the Claude Code dock and a front end with no engine answer a
// press the same way; the tests run them on a store kept in memory.
import type { ExpandedTasks, Place, RefFile, RefFileRead, TaskDetail, TaskRow } from '../types'
import { inboxFile } from './details'
import { unreadLine } from './file-page'
import { leavingList, pushed, reset } from './nav'
import type { PaneStore } from './pane-store'
import type { InboxPress } from './rows'
import { go, switchView, type ViewLives } from './steps'

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
