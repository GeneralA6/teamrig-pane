// The pane's head as data: what stands over the body in a drawing (screen.ts), from the session's title down to the
// status bar. The switch between the views, the Find row and the line under it, the Tasks view's modes, a page's
// steps and trail, a conversation's and a Stats list's way back, the Done page's weeks: each is a piece that names
// its words, its key, how it looks and the press it holds (press.ts), packed to the body's columns (pack.ts), so a
// front end only draws the pieces and hands a press back. The Claude Code dock and a front end with no engine show
// the same head; the tests read it from a screen of a store kept in memory.
import { changesLabel } from './changes-rows'
import { heldWeeks, weekClockOf, weekSteps } from './done'
import { weekWords } from './done-rows'
import { fieldKey, keysAt, keysHint, submitWords, type KeysAt, type KeysWords } from './find-field'
import { KEYS_HOTKEY, KEYS_LABEL } from './keys-page'
import { wrapRow } from './layout'
import { canGoBack, canGoForward, currentPlace, isPage, placeLabel, trail } from './nav'
import { buttonCells, packGroups, packRows } from './pack'
import type { FindSubmit, Press } from './press'
import type { Span } from './rows'
import type { Screen } from './screen'
import { titleSpans } from './session-title'
import type { BarPiece } from './status-bar'
import { matchCount } from './task-search'
import { cells } from './width'

/** Between two places of a trail. */
export const TRAIL_SEPARATOR = ' › '
/** The Log view's name on its switch button and in its trail. */
export const LOG_LABEL = 'Conversations'
/** The Stats tab's name on its switch button and in its trail. */
export const STATS_LABEL = 'Stats'
/** The Teams tab's name on its switch button and in its trail. */
export const TEAMS_LABEL = 'Teams'
export const BACK_LABEL = '‹ back'
export const FORWARD_LABEL = 'forward ›'
/** The Done page's steps to the week before and after. */
export const PREV_LABEL = '‹ prev'
export const NEXT_LABEL = 'next ›'
/** The button that opens the Done page: its `›` says it opens a page and is no mode. */
export const DONE_LABEL = 'done ›'
/** After the switch of a minimized pane: how to open it in full again. */
export const MINIMIZED_HINT = 'minimized, press a view'

/** What a front end alone knows of the head it draws. */
export type HeadLook = {
  /** Drawn above the prompt: no title, Find row, pages or Keys page. */
  readonly inline: boolean
  /** The body's columns, inside the pane's padding: the rows that wrap are packed to them. */
  readonly columns: number
  /** Whether the pane holds the keys at this drawing. */
  readonly isHeld: boolean
  /** This front end's words on where the keys go beside the pane, which the line under the Find field ends in. */
  readonly keys: KeysWords
}

/** A press drawn as a button: framed (`primary` for the one that is on, else `secondary`) or plain words, its key before it. */
export type HeadButton = {
  readonly kind: 'button'
  readonly key: string
  readonly label: string
  readonly hotkey: string | null
  readonly look: 'primary' | 'secondary' | 'plain'
  readonly press: Press
}

/** A place of a trail that is a press away: its label underlined, dim when it lies ahead of the place shown. */
export type HeadCrumb = { readonly kind: 'crumb'; readonly key: string; readonly label: string; readonly isAhead: boolean; readonly press: Press }

/** Words that are no press, dim or bold; `cut` when they are cut at their row's end rather than left to wrap. */
export type HeadWords = { readonly kind: 'words'; readonly key: string; readonly text: string; readonly tone: 'dim' | 'bold'; readonly cut: boolean }

export type HeadItem = HeadButton | HeadCrumb | HeadWords

/** The Find row of the view shown (find-field.ts): its round's field and what the view's search does. */
export type FindRow = {
  /** The field's key in its round (fieldKey). */
  readonly key: string
  readonly placeholder: string
  /** What the round started with (fieldText): the query of the search shown, else nothing. */
  readonly text: string
  /** What Enter in the field does (submitWords). */
  readonly submitLabel: string
  /** The search Enter runs (press.ts submitFind); null in the Inbox view, whose lines open nothing. */
  readonly submits: FindSubmit | null
  /** Whether a search shows, so clear is drawn. */
  readonly clears: boolean
}

/**
 * One piece of the head, top to bottom: a line of spans cut at its end (`text`), items packed in rows under a key,
 * each row keyed `<key>:<row>` (`packed`), one row of items under no key (`row`), an item alone (`item`), the Find
 * row (`find`), the line under it saying where the keys go, wrapped (`keys`), a rule (`rule`), the status bar's
 * lines (`bar`).
 */
export type HeadPiece =
  | { readonly kind: 'text'; readonly key: string; readonly spans: readonly Span[] }
  | { readonly kind: 'packed'; readonly key: string; readonly gap: number; readonly rows: readonly (readonly HeadItem[])[] }
  | { readonly kind: 'row'; readonly gap: number; readonly items: readonly HeadItem[] }
  | { readonly kind: 'item'; readonly item: HeadItem }
  | { readonly kind: 'find'; readonly find: FindRow }
  | { readonly kind: 'keys'; readonly at: KeysAt; readonly lines: readonly string[] }
  | { readonly kind: 'rule'; readonly cells: number }
  | { readonly kind: 'bar'; readonly lines: readonly (readonly BarPiece[])[] }

/** Pieces that stand as one block under a key, no blank row between them. */
export type HeadGroup = { readonly kind: 'group'; readonly key: string; readonly pieces: readonly HeadPiece[] }

export type HeadPart = HeadPiece | HeadGroup

/**
 * The head of one drawing: its parts top to bottom, a blank row apart in a dock. `strip` is the minimized pane, whose
 * switch is all it draws.
 */
export type Head = { readonly strip: boolean; readonly parts: readonly HeadPart[] }

/** The cells an item takes as drawn: what the rows are packed by. */
export function itemCells(item: HeadItem): number {
  if (item.kind === 'words') return cells(item.text)
  if (item.kind === 'crumb') return buttonCells({ label: item.label, plain: true, hotkey: null })
  return buttonCells({ label: item.label, plain: item.look === 'plain', hotkey: item.hotkey })
}

/** The rows a part takes as drawn: a docked front end gives its body the rows the head leaves. */
export function headRows(part: HeadPart): number {
  switch (part.kind) {
    case 'group':
      return part.pieces.reduce((sum, piece) => sum + headRows(piece), 0)
    case 'packed':
      return part.rows.length
    case 'keys':
    case 'bar':
      return part.lines.length
    case 'text':
    case 'row':
    case 'item':
    case 'find':
    case 'rule':
      return 1
  }
}

/** The press a piece of the status bar holds: a segment or a count filters the list to its status; null for words. */
export function pressOfBar(piece: BarPiece): Press | null {
  return piece.status === null ? null : { kind: 'filter', status: piece.status }
}

const dim = (key: string, text: string): HeadWords => ({ kind: 'words', key, text, tone: 'dim', cut: false })
const bold = (key: string, text: string): HeadWords => ({ kind: 'words', key, text, tone: 'bold', cut: false })

/** A framed button, `primary` while what it shows is on. */
const framed = (key: string, label: string, hotkey: string, isOn: boolean, press: Press): HeadButton => ({
  kind: 'button',
  key,
  label,
  hotkey,
  look: isOn ? 'primary' : 'secondary',
  press,
})

/** Items in rows no wider than `columns`, `gap` cells between two. */
function packed(key: string, items: readonly HeadItem[], columns: number, gap: number): HeadPiece {
  return { kind: 'packed', key, gap, rows: packRows(items, itemCells, columns, gap) }
}

/** Groups of items in rows, a dim `·` keyed `<key>:sep:<group>` between two groups that share a row (pack.ts packGroups). */
function grouped(key: string, groups: readonly (readonly HeadItem[])[], columns: number, gap: number): HeadPiece {
  return { kind: 'packed', key, gap, rows: packGroups<HeadItem>(groups, itemCells, columns, gap, group => dim(`${key}:sep:${group}`, '·')) }
}

/**
 * The switch: a button a view (t, d, g, u, e, j, r), the one shown `primary`. Changes says what changed, Inbox counts
 * the unread lines and Teams the cards waiting on the owner now, each the word alone at none. Minimized, a dim mark
 * after the buttons says how to open the pane in full, a group of its own.
 */
function switchOf(screen: Screen, columns: number): HeadPiece {
  const { current, snap } = screen
  const inboxWords = snap.unreadInbox !== null && snap.unreadInbox > 0 ? `Inbox (${snap.unreadInbox})` : 'Inbox'
  const decisions = Object.values(snap.ownerCards).reduce((sum, cards) => sum + cards.due.length, 0)
  const teamWords = decisions > 0 ? `${TEAMS_LABEL} (${decisions})` : TEAMS_LABEL
  const views: readonly HeadItem[] = [
    framed('tasks', 'Tasks', 't', current === 'tasks', { kind: 'view', view: 'tasks' }),
    framed('changes', changesLabel(screen.changed), 'd', current === 'changes', { kind: 'view', view: 'changes' }),
    framed('log', LOG_LABEL, 'g', current === 'log', { kind: 'view', view: 'log' }),
    framed('inbox', inboxWords, 'u', current === 'inbox', { kind: 'view', view: 'inbox' }),
    framed('team', teamWords, 'e', current === 'team', { kind: 'view', view: 'team' }),
    framed('meetings', 'Meetings', 'j', current === 'meetings', { kind: 'view', view: 'meetings' }),
    framed('stats', STATS_LABEL, 'r', current === 'stats', { kind: 'view', view: 'stats' }),
  ]
  const mark: HeadWords = { kind: 'words', key: 'hint', text: MINIMIZED_HINT, tone: 'dim', cut: true }
  return grouped('switch', screen.isMinimized ? [views, [mark]] : [views], columns, 1)
}

/**
 * The Tasks view's mode row in groups: the modes the list switches between (m, a), the Done page at the week of now
 * (h), close cards (c) while a card is open in the list, then the Keys page. The pages are the dock's alone: inline,
 * a page never shows.
 */
function modesOf(screen: Screen, { inline, columns }: HeadLook): HeadPiece {
  const { shown, snap } = screen
  const place = currentPlace(screen.at)
  const modes: HeadItem[] = [
    framed('mine', 'mine', 'm', shown === 'mine', { kind: 'mode', mode: 'mine' }),
    framed('all', 'all', 'a', shown === 'all', { kind: 'mode', mode: 'all' }),
  ]
  // Not keyed `done`: that key is the Tasks list's Done today heading (rows.ts SECTION_KEY), drawn beside this button.
  const pages: HeadItem[] = inline
    ? []
    : [framed('done-page', DONE_LABEL, 'h', place.kind === 'done', { kind: 'done-week', week: heldWeeks(weekClockOf(snap)).newest })]
  // A page shows no list, so no card in it to close.
  const cards: HeadItem[] =
    Object.keys(screen.open).length > 0 && place.kind === 'list' ? [framed('close-cards', 'close cards', 'c', false, { kind: 'close-cards' })] : []
  const keys: HeadItem[] = inline ? [] : [{ kind: 'button', key: 'keys', label: KEYS_LABEL, hotkey: KEYS_HOTKEY, look: 'plain', press: { kind: 'keys' } }]
  return grouped('modes', [modes, pages, cards, keys], columns, 1)
}

/** The search of the view shown: what its field shows empty, how many results its words match, and what Enter runs. */
type Search = { readonly placeholder: string; readonly matches: number; readonly submits: FindSubmit | null }

/**
 * The search of the view shown; null where no Find row is drawn: the Meetings view and the Stats tab (a few rows,
 * nothing to search) and a conversation's page (the field is its list's).
 */
function searchOf(screen: Screen): Search | null {
  switch (screen.current) {
    case 'tasks':
      return { placeholder: 'id, title, owner, note…', matches: matchCount(screen.found), submits: 'tasks' }
    case 'team':
      return { placeholder: 'id, name, role, scope…', matches: screen.teamFound.length, submits: 'team' }
    case 'inbox':
      return { placeholder: 'sender, words…', matches: screen.inboxFound.length, submits: null }
    case 'changes':
      return { placeholder: 'path, repo, branch…', matches: screen.changesFound.length, submits: 'changes' }
    case 'log':
      return screen.logTitle === null ? { placeholder: 'task, title, session…', matches: screen.logFound.length, submits: 'log' } : null
    case 'meetings':
    case 'stats':
      return null
  }
}

/**
 * The Find row and the line under it, docked: the field under its round's key, holding what the round started with,
 * and where the person's keys go now (find-field.ts keysAt), with the key or the click that moves them, wrapped to
 * the body's columns. None inline or in a view with no search.
 */
function findOf(screen: Screen, look: HeadLook): HeadPiece[] {
  const search = look.inline ? null : searchOf(screen)
  if (search === null) return []
  const isSearching = currentPlace(screen.at).kind === 'search'
  const enter = search.submits === null ? null : submitWords(search.matches)
  const at = keysAt(look.isHeld, screen.landings, screen.memo, isSearching)
  const lines = wrapRow({ key: 'keys-hint', spans: [{ text: keysHint(at, enter, look.keys) }] }, look.columns).map(line => line.map(span => span.text).join(''))
  const find: FindRow = {
    key: fieldKey(screen.field),
    placeholder: search.placeholder,
    text: screen.field.text,
    submitLabel: enter ?? 'search',
    submits: search.submits,
    clears: isSearching,
  }
  return [
    { kind: 'find', find },
    { kind: 'keys', at, lines },
  ]
}

/** Back (b), a button while `press` has somewhere to go. */
const backButton = (press: Press): HeadButton => framed('back', BACK_LABEL, 'b', false, press)

/**
 * A page's head, and the list's while a page lies ahead of it (back led there): back and forward (b, f; dim words
 * when there is nowhere to go), the trail of the last places, each a press away but the one shown (bold), then a
 * rule. Null on the list with nothing ahead.
 */
function pageHeadOf(screen: Screen, columns: number): HeadGroup | null {
  const { at } = screen
  if (!isPage(currentPlace(at)) && !canGoForward(at)) return null
  const { crumbs, isCutBefore, isCutAfter } = trail(at)
  const places = crumbs.flatMap((crumb, i): HeadItem[] => {
    const key = `crumb:${crumb.index}`
    const label = placeLabel(crumb.place)
    const item: HeadItem = crumb.isShown ? bold(key, label) : { kind: 'crumb', key, label, isAhead: crumb.isAhead, press: { kind: 'crumb', index: crumb.index } }
    return i === 0 ? [item] : [dim(`after:${crumb.index - 1}`, TRAIL_SEPARATOR), item]
  })
  const items: HeadItem[] = [
    ...(isCutBefore ? [dim('cut-before', `…${TRAIL_SEPARATOR}`)] : []),
    ...places,
    ...(isCutAfter ? [dim('cut-after', `${TRAIL_SEPARATOR}…`)] : []),
  ]
  const steps: HeadItem[] = [
    canGoBack(at) ? backButton({ kind: 'back' }) : dim('back', BACK_LABEL),
    canGoForward(at) ? framed('forward', FORWARD_LABEL, 'f', false, { kind: 'forward' }) : dim('forward', FORWARD_LABEL),
  ]
  return {
    kind: 'group',
    key: 'page-head',
    pieces: [{ kind: 'row', gap: 2, items: steps }, packed('trail', items, columns, 0), { kind: 'rule', cells: Math.max(1, columns) }],
  }
}

/** A head of a view with one way back: back (b), a trail of where it leads and what shows, cut at its row's end, a rule. */
function backHead(key: string, press: Press, from: string, shown: readonly Span[], columns: number): HeadGroup {
  return {
    kind: 'group',
    key: `${key}-head`,
    pieces: [
      { kind: 'item', item: backButton(press) },
      { kind: 'text', key: `${key}-trail`, spans: [{ text: from }, { text: TRAIL_SEPARATOR, dim: true }, ...shown] },
      { kind: 'rule', cells: Math.max(1, columns) },
    ],
  }
}

/**
 * The Done page's week between its steps to the week before and after (p, l), each dim words where the pane holds no
 * older or newer week. Null off the Done page.
 */
function weeksOf(screen: Screen, columns: number): HeadPiece | null {
  const place = currentPlace(screen.at)
  if (place.kind !== 'done') return null
  const steps = weekSteps(place.week, weekClockOf(screen.snap))
  return packed(
    'week-steps',
    [
      steps.prev === null ? dim('prev', PREV_LABEL) : framed('prev', PREV_LABEL, 'p', false, { kind: 'done-week', week: steps.prev }),
      bold('week', `week of ${weekWords(steps.week)}`),
      steps.next === null ? dim('next', NEXT_LABEL) : framed('next', NEXT_LABEL, 'l', false, { kind: 'done-week', week: steps.next }),
    ],
    columns,
    2,
  )
}

/**
 * The head `screen` shows to a front end of `look`. Minimized with nothing to say, the switch alone; a project
 * teamrig is not set up for, the title alone (no switch, Find row or modes, so none of their keys answers). Else the
 * controls (title, switch, the view's Find row and its line, the Tasks view's modes), a page's head, a
 * conversation's, a Stats list's or a Teams row's Stats, the Done page's weeks, then the status bar.
 */
export function headOf(screen: Screen, look: HeadLook): Head {
  const { inline, columns } = look
  // Inline the pane sits by the band above the prompt, which names the session too: it draws no title.
  const spans = inline ? null : titleSpans(screen.snap)
  const title: HeadPiece[] = spans === null ? [] : [{ kind: 'text', key: 'title', spans }]
  const views = switchOf(screen, columns)
  if (screen.isMinimized && screen.body.length === 0) return { strip: true, parts: [views] }
  if (screen.setupShown !== null) return { strip: false, parts: title }
  const controls: HeadGroup = {
    kind: 'group',
    key: 'controls',
    pieces: [...title, views, ...findOf(screen, look), ...(screen.current === 'tasks' ? [modesOf(screen, look)] : [])],
  }
  const { logTitle, statsTitle } = screen
  // A conversation's page leads back to the list; a Health count's tasks to the tab's numbers, and the numbers of a
  // tab a Teams row opened to that row.
  const logHead = logTitle === null ? null : backHead('log', { kind: 'log-close' }, LOG_LABEL, logTitle, columns)
  const statsHead =
    statsTitle !== null
      ? backHead('stats', { kind: 'stats-list-close' }, STATS_LABEL, [{ text: statsTitle }], columns)
      : screen.statsBack
        ? backHead('stats', { kind: 'stats-from-close' }, TEAMS_LABEL, [{ text: STATS_LABEL }], columns)
        : null
  const bar: HeadPiece | null = screen.barLines.length === 0 ? null : { kind: 'bar', lines: screen.barLines }
  const parts = [controls, pageHeadOf(screen, columns), logHead, statsHead, weeksOf(screen, columns), bar]
  return { strip: false, parts: parts.filter((part): part is HeadPart => part !== null) }
}
