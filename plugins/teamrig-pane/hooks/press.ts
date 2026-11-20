// A press in the pane as data, and what running it does. The drawing says where a press is: in the body (layout.ts)
// a piece of a card's line, a row of a card that is a press of its own, an element's head; in the head (head.ts) a
// button, a place of a trail, a piece of the status bar. `pressOf...` names the press each of the body's holds, the
// head's pieces carry theirs, and `runPress` answers it through presses.ts, steps.ts and the ports of the readers that
// act outside the store, so a front end only draws something to press and hands the press back: the Claude Code dock
// and a front end with no engine answer it the same way. The Find field is typed into, not pressed: `typeFind` and
// `submitFind` answer its words. The tests run every kind on a store kept in memory.
import type { BarStatus, LogRead, MeetingPress, PaneView, Place, RefFile, SessionPress, Snapshot, ViewMode } from '../types'
import type { CardPart, Drawn } from './layout'
import { back, doneAt, forward, KEYS_PAGE, pushed, searched, wentTo } from './nav'
import type { PaneStore } from './pane-store'
import type { PressPiece } from './press-keys'
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
  pickStats,
  submitChanges,
  submitLog,
  submitTasks,
  submitTeam,
  toggleCard,
  toggleTeamKey,
  type ClosesLog,
  type OpensLog,
  type ReadsDetail,
  type ReadsFile,
  type TogglesDiff,
} from './presses'
import type { ActPress, InboxPress, StatsPress } from './rows'
import { clearSearch, focusFind, go, openConversation, showMode, switchView, type MoveFocus, type ViewLives } from './steps'

/**
 * A press in the body: a task's card opened or closed (`card`), a task's page (`page`), a reference file's (`file`)
 * or an inbox's (`inbox`), each with `from`, the key of the element it was pressed in, for back to land on; a Teams
 * tab key drawn inside a row (`team-key`); the session a tab tied to none ties to (`pin`); a meeting card's press
 * (`meeting`); a session row's act (`session-act`); a task card's owner act (`act`); a Stats tab pick (`stats`); a
 * heading that opens or closes what is under it (`fold`); a conversation's Log page (`log`); a Changes file's diff
 * opened or closed (`diff`).
 *
 * A press in the head (head.ts): a view of the switch (`view`); the Tasks view's mine or all (`mode`); the Done page
 * at a week (`done-week`); every open card closed (`close-cards`); the Keys page (`keys`); the list filtered to a
 * status of the bar, or unfiltered by a second press (`filter`); a step back or forward (`back`, `forward`) or to a
 * place of the trail (`crumb`, the place's index among the places kept); back from a conversation's page
 * (`log-close`), from a Health count's tasks (`stats-list-close`) and from a Stats tab a Teams row opened
 * (`stats-from-close`); the focus ring moved into the Find field (`find`); the search closed (`find-clear`).
 */
export type Press =
  | { readonly kind: 'view'; readonly view: PaneView }
  | { readonly kind: 'mode'; readonly mode: ViewMode }
  | { readonly kind: 'done-week'; readonly week: string }
  | { readonly kind: 'close-cards' }
  | { readonly kind: 'keys' }
  | { readonly kind: 'filter'; readonly status: BarStatus }
  | { readonly kind: 'back' }
  | { readonly kind: 'forward' }
  | { readonly kind: 'crumb'; readonly index: number }
  | { readonly kind: 'log-close' }
  | { readonly kind: 'stats-list-close' }
  | { readonly kind: 'stats-from-close' }
  | { readonly kind: 'find' }
  | { readonly kind: 'find-clear' }
  | { readonly kind: 'card'; readonly task: string }
  | { readonly kind: 'page'; readonly task: string; readonly from: string }
  | { readonly kind: 'file'; readonly file: RefFile; readonly from: string }
  | { readonly kind: 'inbox'; readonly inbox: InboxPress; readonly from: string }
  | { readonly kind: 'team-key'; readonly key: string }
  | { readonly kind: 'pin'; readonly area: string }
  | { readonly kind: 'meeting'; readonly press: MeetingPress }
  | { readonly kind: 'session-act'; readonly press: SessionPress }
  | { readonly kind: 'act'; readonly act: ActPress }
  | { readonly kind: 'stats'; readonly press: StatsPress }
  | { readonly kind: 'fold'; readonly key: string }
  | { readonly kind: 'log'; readonly read: LogRead }
  | { readonly kind: 'diff'; readonly key: string }

/** The live register, as a press that ties the tab to a session uses it. */
export type PinsArea = { pin(area: string): Promise<void> }

/** The Meetings view's reader, as a press on a meeting's card uses it. */
export type PressesMeeting = { press(press: MeetingPress): Promise<void> }

/** The session acts, as a press on a session row's act uses them. */
export type PressesSession = { press(press: SessionPress): Promise<void> }

/** The owner acts, as a press on a task card's act uses them. */
export type PressesAct = { press(press: ActPress['press'], task: string): Promise<void> }

/** The Log view's reader, as the presses use it: a conversation's page opened, and back from it. */
export type ReadsLog = OpensLog & ClosesLog

/** The view whose search Enter in the Find field runs. */
export type FindSubmit = 'tasks' | 'team' | 'log' | 'changes'

/**
 * What a press runs on: the store, the snapshot the drawing shows (its tasks, the session's own area, what a
 * conversation's title reads), the view shown and the Tasks view's place (a fold reads both), the front end's focus
 * ring, the readers of a card's detail and of a file, the view readers a switch folds, and a port for each reader
 * that acts outside the store. A port is null while the pane has no such reader (no team found, no teamrig CLI); its
 * press then does nothing outside the store.
 */
export type PressDeps = {
  readonly store: PaneStore
  readonly snap: Snapshot
  readonly shown: PaneView
  readonly place: Place
  readonly focus: MoveFocus
  readonly detailOf: ReadsDetail
  readonly readFile: ReadsFile
  readonly lives: ViewLives
  readonly logging: ReadsLog | null
  readonly diffing: TogglesDiff | null
  readonly pinning: PinsArea | null
  readonly scheduling: PressesMeeting | null
  readonly pressing: PressesSession | null
  readonly acting: PressesAct | null
}

/** The press a piece of a card's line holds, pressed in the element keyed `from`. */
export function pressOfPiece(piece: PressPiece, from: string): Press {
  switch (piece.kind) {
    case 'id':
      return { kind: 'page', task: piece.task, from }
    case 'file':
      return { kind: 'file', file: piece.file, from }
    case 'inbox':
      return { kind: 'inbox', inbox: piece.inbox, from }
    case 'toggle':
      return { kind: 'team-key', key: piece.toggles }
    case 'pin':
      return { kind: 'pin', area: piece.pins }
    case 'meeting':
      return { kind: 'meeting', press: piece.meets }
    case 'session-act':
      return { kind: 'session-act', press: piece.sessionAct }
    case 'act':
      return { kind: 'act', act: piece.acts }
    case 'stats':
      return { kind: 'stats', press: piece.stats }
  }
}

/** A card's part that is a press as a whole. A line's presses are its pieces'; the Note field is typed into, not pressed. */
export type PressPart = Extract<CardPart, { kind: 'press' }>

/** The press a card's row is as a whole: a Changes file's row opens or closes its diff. */
export function pressOfPart(part: PressPart): Press {
  return { kind: 'diff', key: part.expands }
}

/**
 * The press an element's head is, null when it is words alone. A drawing sets one of these at most; the order holds
 * what wins if it ever sets two: a fold, a conversation's Log page, a file's diff, a task's page, then its card.
 */
export function pressOfDrawn(drawn: Drawn): Press | null {
  if (drawn.folds !== undefined) return { kind: 'fold', key: drawn.folds }
  if (drawn.reads !== undefined) return { kind: 'log', read: drawn.reads }
  if (drawn.expands !== undefined) return { kind: 'diff', key: drawn.expands }
  if (drawn.opens !== undefined) return { kind: 'page', task: drawn.opens, from: drawn.key }
  if (drawn.toggle !== null) return { kind: 'card', task: drawn.toggle }
  return null
}

/** Runs a press: the store's presses through presses.ts, the rest through its port, nothing when the port is null. */
export async function runPress(press: Press, deps: PressDeps): Promise<void> {
  const { store } = deps
  switch (press.kind) {
    case 'view':
      return switchView(store, press.view, deps.lives)
    case 'mode':
      return showMode(store, press.mode)
    case 'done-week':
      return go(store, current => doneAt(current, press.week))
    case 'close-cards':
      return closeCards(store)
    case 'keys':
      return go(store, current => pushed(current, KEYS_PAGE))
    case 'filter':
      return filterBar(store, press.status)
    case 'back':
      return go(store, back)
    case 'forward':
      return go(store, forward)
    case 'crumb':
      return go(store, current => wentTo(current, press.index))
    case 'log-close':
      return closeLog(store, deps.logging)
    case 'stats-list-close':
      return closeStatsList(store, deps.lives)
    case 'stats-from-close':
      return closeStatsFrom(store, deps.lives)
    case 'find':
      return focusFind(store, deps.focus)
    case 'find-clear':
      return clearSearch(store, deps.focus)
    case 'card':
      return toggleCard(store, deps.snap.tasks, press.task, deps.detailOf)
    case 'page':
      return openPage(store, deps.snap.tasks, press.task, press.from, deps.detailOf)
    case 'file':
      return openFile(store, press.file, press.from, deps.readFile)
    case 'inbox':
      return openInbox(store, press.inbox, press.from, deps.snap.area, deps.readFile, deps.lives)
    case 'team-key':
      return toggleTeamKey(store, press.key)
    case 'pin':
      return deps.pinning?.pin(press.area)
    case 'meeting':
      return deps.scheduling?.press(press.press)
    case 'session-act':
      return deps.pressing?.press(press.press)
    case 'act':
      return deps.acting?.press(press.act.press, press.act.task)
    case 'stats':
      return pickStats(store, press.press, deps.lives)
    case 'fold':
      return fold(store, press.key, deps.shown, deps.place)
    case 'log':
      return openConversation(store, press.read, deps.logging)
    case 'diff':
      return deps.diffing?.toggle(press.key)
  }
}

/**
 * The Find field's words as the person types them: the first open a search, each change shows the results for its
 * words, and an empty field closes it (nav.ts searched). Typing starts no new round of the field.
 */
export async function typeFind(store: PaneStore, words: string): Promise<void> {
  await go(store, current => searched(current, words), 'typing')
}

/** Enter in the Find field of the view `submits` names, on its words as typed (presses.ts). */
export async function submitFind(submits: FindSubmit, words: string, deps: PressDeps): Promise<void> {
  const { store, focus } = deps
  switch (submits) {
    case 'tasks':
      return submitTasks(store, deps.snap, words, focus, deps.detailOf)
    case 'team':
      return submitTeam(store, words, focus)
    case 'log':
      return submitLog(store, deps.snap, words, focus, deps.logging)
    case 'changes':
      return submitChanges(store, words, focus, deps.diffing)
  }
}
