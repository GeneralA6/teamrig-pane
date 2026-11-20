// The steps a press takes on the pane's state: a move of the tasks view and where it leaves the window, the Find
// field's focus, mine or all, a switch of view, a conversation opened. Each reads and writes through the store port
// (pane-store.ts) and moves the focus ring through the one a front end hands it, so the Claude Code dock and a front
// end with no engine take the same steps; the tests run them on a store kept in memory.
import type { LogRead, Nav, PaneSize, PaneView, ViewMode } from '../types'
import { scrolledTo } from './body-scroll'
import { lineBlockKey } from './file-page'
import { fieldAfter, fieldKey } from './find-field'
import { filesKept, landing, leftSearch, pagesKept, reset, type Landing } from './nav'
import { NO_ANSWER, NO_MEETING_ANSWER, NO_MEETING_ASKED, NO_STATS_FROM } from './pane-state'
import type { PaneStore } from './pane-store'

/** Who moves the tasks view: the person typing in the Find field, or any other step. */
export type StepOrigin = 'typing' | 'step'

/**
 * Moves a front end's focus ring onto the element keyed `key`. A front end that cannot (it does not hold the keys)
 * leaves the ring where it was and still resolves.
 */
export type MoveFocus = (key: string) => Promise<void>

/** A reader that reads again on a press. */
type Refreshes = { refresh(): Promise<void> }

/**
 * The readers a view switch refreshes, each by the one step the switch takes on it; null until the session starts or
 * with nothing to read.
 */
export type ViewLives = {
  readonly sizer: { set(size: PaneSize): Promise<void> } | null
  readonly tracked: Refreshes | null
  readonly logging: { close(): Promise<void> } | null
  readonly teaming: Refreshes | null
  readonly scheduling: Refreshes | null
  readonly tallying: Refreshes | null
}

/**
 * Moves the tasks view by `step` (nav.ts), keeping only the details of the pages, and the reads of the files, a place
 * still names. A step other than typing that changes what the Find field should hold starts a new round of it
 * (find-field.ts). A page opens at its top, a file's page at its ref's line, and a step from a page back to the list
 * brings the element the page was opened from to the middle of the window; a failed move leaves the window where it is.
 */
export async function go(store: PaneStore, step: (current: Nav) => Nav, origin: StepOrigin = 'step'): Promise<void> {
  // The step runs on the places as last written, so a step written while this one runs is never lost.
  const seen: { before: Nav | null } = { before: null }
  const next = await store.update('nav', current => {
    seen.before = current
    return step(current)
  })
  const before = seen.before
  if (before === null || next === before) return
  if (origin === 'step') await store.update('findField', field => fieldAfter(field, before, next))
  await store.update('pages', current => pagesKept(current, next))
  await store.update('filePages', current => filesKept(current, next))
  const to = landing(before, next)
  if (to !== null) await scrollTo(store, to).catch(() => undefined)
}

/**
 * Moves the body's window (body-scroll.ts) to the top, brings the element a landing names to its middle, or a file
 * page's line to the window's top by the paragraph that holds it (file-page.ts), the page's top when none does. A
 * front end with no window to move (the dock's inline pane cuts its rows to fit) draws the same rows whatever this
 * writes.
 */
export async function scrollTo(store: PaneStore, to: Landing): Promise<void> {
  const key = to.kind === 'top' ? null : to.kind === 'row' ? to.key : lineBlockKey(to, (await store.read('filePages'))[to.file])
  await store.update('bodyScroll', current =>
    scrolledTo(current, key === null ? { kind: 'offset', offset: 0 } : { kind: 'reveal', key, block: to.kind === 'line' ? 'start' : 'center' }),
  )
}

/** Moves the focus ring into the Find field, as its round draws it now. */
export async function focusFind(store: PaneStore, focus: MoveFocus): Promise<void> {
  await focus(fieldKey(await store.read('findField')))
}

/**
 * Closes the search from its clear button and moves the ring back into the field, a new round's: the button is
 * hidden as the search closes, and the ring left at its index would sit on the next element, so the next keys would
 * press the pane's hotkeys rather than type a new search.
 */
export async function clearSearch(store: PaneStore, focus: MoveFocus): Promise<void> {
  await go(store, leftSearch)
  await focusFind(store, focus)
}

/** The mine or all view, the list shown alone: the rows a page left from belong to the other list. */
export async function showMode(store: PaneStore, shown: ViewMode): Promise<void> {
  await store.update('mode', () => shown)
  await go(store, current => reset(current, false))
}

/**
 * A press on the switch's buttons. The Tasks button shows the list, from a page too, scrolled back to where the page
 * was opened from; the Log button shows the sessions, from a session's page too; the Teams button reads the team tree
 * at once; the Meetings button reads the meetings at once, leaving the last start's answer behind; the Stats button
 * folds the registers at once. Every button closes a search, which the views share: one typed in one view is never
 * found shown in another, and drops a Teams row's back, as the Stats tab then shows from the switch.
 */
export async function switchView(store: PaneStore, target: PaneView, lives: ViewLives): Promise<void> {
  await store.update('statsFrom', () => NO_STATS_FROM)
  await store.update('view', () => target)
  await lives.sizer?.set('open')
  await go(store, current => reset(current, true))
  if (target === 'changes') await lives.tracked?.refresh()
  if (target === 'log') await lives.logging?.close()
  if (target === 'team') {
    await store.update('sessionAnswer', () => NO_ANSWER)
    await lives.teaming?.refresh()
  }
  if (target === 'meetings') {
    await store.update('meetingAnswer', () => NO_MEETING_ANSWER)
    await store.update('meetingAsked', () => NO_MEETING_ASKED)
    await lives.scheduling?.refresh()
  }
  if (target === 'stats') await lives.tallying?.refresh()
}

/** A press on a conversation in the Log view's list opens its page, read now, at its end: the newest lines are last. */
export async function openConversation(store: PaneStore, conversation: LogRead, logging: { open(read: LogRead): Promise<void> } | null): Promise<void> {
  await logging?.open(conversation)
  await store.update('bodyScroll', current => scrolledTo(current, { kind: 'end' }))
}
