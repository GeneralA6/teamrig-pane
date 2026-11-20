// What one drawing of the pane shows: the view the state names and its blocks laid out, the searches' results, the
// status bar's lines and the titles a head draws. It reads the state through the store port (pane-store.ts), only the
// keys the view shown needs, and takes what a front end alone knows (its width and rows, whether it draws inline,
// whether it holds the keys) as a look, so the Claude Code dock and a front end with no engine show the same screen;
// the tests read it from a store kept in memory.
import type { BodyScroll, ExpandedTasks, FilePages, FindField, Nav, PaneState, PaneView, RingLandings, SetupView, Snapshot, ViewMode } from '../types'
import type { CardActs } from './act-rows'
import { AT_TOP } from './body-scroll'
import { EMPTY_CHANGES } from './changes'
import { changesBlocks } from './changes-rows'
import { searchChanges, type ChangeHit } from './changes-search'
import { doneBlocks } from './done-rows'
import { filePageBlocks } from './file-page'
import { FIRST_FIELD, NO_LANDINGS, drawnWith, type KeysMemo } from './find-field'
import { inboxBlocks } from './inbox-rows'
import { searchInbox, type InboxHit } from './inbox-search'
import { keysBlocks } from './keys-page'
import { WrapCache, dockLayout, failedDrawing, inlineLayout, type Drawn } from './layout'
import { logListBlocks, logPageBlocks, logPageTitle } from './log-rows'
import { searchLog, type LogHit } from './log-search'
import { meetingsBlocks } from './meetings-rows'
import { treeOf } from './meta'
import { AT_LIST, currentPlace } from './nav'
import type { NoteHold } from './note-hold'
import { pageBlocks } from './page'
import { EMPTY_SNAPSHOT, LOG_READING, NO_FILES, NOT_SETTING_UP, TEAM_READING } from './pane-state'
import type { PaneStore } from './pane-store'
import { isGitMissing, requirementBlocks, type HostOldLine } from './requirements'
import { NOTHING_EXPANDED, paneBlocks, type Block, type Span, type TieHint } from './rows'
import { searchBlocks } from './search-rows'
import { setupBlocks } from './setup-rows'
import { listTitle, statsBlocks } from './stats-rows'
import { inlineBarRows, statusBar, type BarPiece } from './status-bar'
import { NO_RESULTS, searchTasks, type SearchResults } from './task-search'
import { sessionKey } from './team'
import { teamBlocks } from './team-rows'
import { searchTeam, type SessionHit } from './team-search'
import { clockOf } from './zone'

/** Most rows an inline pane (above the prompt) shows, its last one saying what it left out. */
export const INLINE_MAX_ROWS = 6

/** What a front end alone knows of a drawing, and what it keeps between drawings. */
export type ScreenLook = {
  /** Drawn above the prompt, its rows cut to fit, rather than docked with a window to scroll. */
  readonly inline: boolean
  /** The body's columns, inside the pane's padding. */
  readonly columns: number
  /** The rows the front end gives the body. */
  readonly bodyRows: number
  /** Whether the owner's acts can run (a team to run them through): an open card then ends in them, docked only. */
  readonly canAct: boolean
  /** Whether the pane holds the keys at this drawing. */
  readonly isHeld: boolean
  /** Where the keys went as of the last drawing (find-field.ts); the screen answers this drawing's. */
  readonly memo: KeysMemo
  /** The snapshot drawn while the Note field is open: the one of its opening (note-hold.ts). */
  readonly noteHold: NoteHold<Snapshot>
  /** The rows the last docked layout wrapped: a drawing re-wraps only the rows that changed since. */
  readonly wraps: WrapCache
  /** The line a host too old for the pane is told (requirements.ts). */
  readonly hostOld: HostOldLine
  /** The words this front end ties a tab to a session with, which a tab tied to none shows; null when it has none. */
  readonly tieHint: TieHint
}

/** One drawing of the pane. */
export type Screen = {
  readonly isMinimized: boolean
  readonly current: PaneView
  readonly changed: PaneState['changes']
  readonly snap: Snapshot
  /** Where the owner's act stands, which an open card's act rows draw from (act-rows.ts); null inline or with no team. */
  readonly acts: CardActs | null
  readonly shown: ViewMode
  readonly open: ExpandedTasks
  /** Where the tasks view is, or the Inbox, Team, Log or Changes view's search; the list inline, where a page never shows. */
  readonly at: Nav
  /** What the file pages the places name read, drawn with the tasks view docked. */
  readonly files: FilePages
  /** The Find field's round (find-field.ts), drawn docked in every view, the Log view's over its list. */
  readonly field: FindField
  readonly landings: RingLandings
  /** Where the keys went as of this drawing; the look's memo when the landings could not be read. */
  readonly memo: KeysMemo
  /** Where the docked body's window is to stand, the last step that moved it; at the top inline. */
  readonly scroll: BodyScroll
  /** The tasks the search shown matched, read once for its body, the Find field's Enter and the line under it; none off a search. */
  readonly found: SearchResults
  /** The sessions the Teams tab's search shown names (team-search.ts); none off it. */
  readonly teamFound: readonly SessionHit[]
  /** The inbox lines the Inbox view's search shown matches (inbox-search.ts); none off it. */
  readonly inboxFound: readonly InboxHit[]
  /** The conversations the Log view's search shown names (log-search.ts); none off it. */
  readonly logFound: readonly LogHit[]
  /** The files the Changes view's search shown names (changes-search.ts); none off it. */
  readonly changesFound: readonly ChangeHit[]
  /** The title of the conversation whose Log page shows (log-rows.ts logPageTitle); null for the list or another view. */
  readonly logTitle: Span[] | null
  /** The title of the Health count whose tasks the Stats tab shows (stats-rows.ts listTitle); null for its numbers or another view. */
  readonly statsTitle: string | null
  /** Whether the Stats tab shows from a Teams row's [Stats], so its head leads back to that row; never for another view. */
  readonly statsBack: boolean
  /** What a project teamrig is not set up for shows (setup.ts), alone, in every view; null once a register is found. */
  readonly setupShown: SetupView | null
  readonly body: Drawn[]
  /** The status bar's lines over the area's tasks (status-bar.ts); none outside the mine tasks view. */
  readonly barLines: BarPiece[][]
}

/**
 * The screen the state shows to a front end of `look`. A read or a layout that throws leaves what was read until then
 * and one error line for a body: a front end that drew nothing would show the pane with no tasks and no word of why.
 */
export async function screenOf(store: PaneStore, look: ScreenLook): Promise<Screen> {
  const { inline, columns } = look
  let isMinimized = false
  let current: PaneView = 'tasks'
  let changed: PaneState['changes'] = EMPTY_CHANGES
  let snap = EMPTY_SNAPSHOT
  let acts: CardActs | null = null
  let shown: ViewMode = 'mine'
  let open: ExpandedTasks = NOTHING_EXPANDED
  let at: Nav = AT_LIST
  let files: FilePages = NO_FILES
  let field: FindField = FIRST_FIELD
  let landings: RingLandings = NO_LANDINGS
  let memo = look.memo
  let scroll: BodyScroll = AT_TOP
  let found: SearchResults = NO_RESULTS
  let teamFound: readonly SessionHit[] = []
  let inboxFound: readonly InboxHit[] = []
  let logFound: readonly LogHit[] = []
  let changesFound: readonly ChangeHit[] = []
  let logTitle: Span[] | null = null
  let statsTitle: string | null = null
  let statsBack = false
  let setupShown: SetupView | null = NOT_SETTING_UP
  let body: Drawn[] = []
  let barLines: BarPiece[][] = []
  try {
    landings = await store.read('ring')
    memo = drawnWith(memo, look.isHeld, landings)
    isMinimized = (await store.read('size')) === 'minimized'
    current = await store.read('view')
    changed = await store.read('changes')
    // An open card ends in the owner's acts, docked only (inline draws none) and with a team to run them through.
    acts = inline || !look.canAct ? null : { act: await store.read('ownerAct') }
    // Minimized too: the strip's Inbox button counts the unread lines. While the Note field is open, the snapshot of
    // its opening: a front end that keeps its focus ring at an index would see it move off the field as a task is
    // added above the card.
    snap = look.noteHold.drawn(await store.read('snapshot'), acts?.act ?? null)
    if (!isMinimized) {
      shown = await store.read('mode')
      open = await store.read('expanded')
      const missing = await store.read('requirements')
      if (!inline) scroll = await store.read('bodyScroll')
      // Every view draws the Find field docked (the Log view over its list), and their searches are one place: the
      // switch between them closes it (steps.ts switchView).
      if (!inline) {
        at = await store.read('nav')
        field = await store.read('findField')
        if (current === 'tasks') files = await store.read('filePages')
      }
      const place = currentPlace(at)
      const team = current === 'team' ? await store.read('teamTree') : TEAM_READING
      const logs = current === 'log' ? await store.read('logList') : LOG_READING
      if (place.kind === 'search' && current === 'tasks') found = searchTasks(snap.tasks, place.query, treeOf(snap))
      if (place.kind === 'search' && team.kind === 'tree') teamFound = searchTeam(team.root, place.query)
      if (place.kind === 'search' && current === 'inbox') inboxFound = searchInbox(snap.inbox, snap.now, place.query)
      if (place.kind === 'search' && current === 'log') logFound = searchLog(logs, snap, place.query)
      if (place.kind === 'search' && current === 'changes') changesFound = searchChanges(changed, place.query)
      // A project teamrig is not set up for has no tasks, changes or log to show: its setup takes every view,
      // whatever place it is at.
      setupShown = await store.read('setup')
      // A page has no status bar: the bar counts the list, and a press on it filters the list.
      const bar =
        current === 'tasks' && setupShown === null && shown === 'mine' && place.kind === 'list'
          ? statusBar(snap, await store.read('filter'), columns)
          : null
      // With no bar there is nothing to filter by, and the list shows every task.
      const tasksBlocks = async (): Promise<Block[]> =>
        place.kind === 'task'
          ? pageBlocks(snap, place.id, await store.read('pages'), acts)
          : place.kind === 'search'
            ? searchBlocks(snap, place.query, found)
            : place.kind === 'done'
              ? doneBlocks(snap, shown, place.week, await store.read('doneToggled'))
              : place.kind === 'file'
                ? filePageBlocks({ file: place.file, line: place.line }, files[place.file])
                : place.kind === 'keys'
                  ? keysBlocks(columns)
                  : paneBlocks(snap, shown, open, bar?.filter ?? null, await store.read('tasksFolded'), acts, look.tieHint)
      // Inline, the Log view shows its list alone: a page opens docked.
      const logShown = setupShown === null && current === 'log' && !inline ? await store.read('logPage') : null
      logTitle = logShown === null ? null : logPageTitle(logShown, logs, snap)
      const statsShown = setupShown === null && current === 'stats' ? await store.read('stats') : null
      statsTitle = statsShown?.kind === 'stats' && statsShown.list !== null ? listTitle(statsShown.list) : null
      statsBack = statsShown !== null && (await store.read('statsFrom')) !== null
      const search = <Hit>(hits: readonly Hit[]) => (place.kind === 'search' ? { query: place.query, hits } : null)
      const viewBlocks =
        setupShown !== null
          ? setupBlocks(setupShown)
          : current === 'tasks'
            ? await tasksBlocks()
            : current === 'changes'
              ? changesBlocks(changed, isGitMissing(missing), await store.read('diffs'), search(changesFound))
              : current === 'team'
                ? teamBlocks(team, await store.read('teamToggled'), clockOf(snap).zone, {
                    search: search(teamFound),
                    answer: await store.read('sessionAnswer'),
                    own: snap.team === null || snap.area === null ? null : sessionKey(snap.team, snap.area),
                  })
                : current === 'meetings'
                  ? meetingsBlocks(
                      await store.read('meetings'),
                      {
                        open: await store.read('meetingsOpen'),
                        answer: await store.read('meetingAnswer'),
                        asked: await store.read('meetingAsked'),
                      },
                      snap.tasks,
                      clockOf(snap),
                    )
                  : statsShown !== null
                    ? statsBlocks(statsShown, await store.read('statsToggled'), columns, {
                        team: snap.team,
                        held: new Set(snap.tasks.map(task => task.id)),
                        clock: clockOf(snap),
                      })
                    : current === 'inbox'
                      ? inboxBlocks(snap, search(inboxFound), look.tieHint)
                      : logShown === null
                        ? logListBlocks(logs, clockOf(snap), snap, search(logFound))
                        : logPageBlocks(logShown, clockOf(snap), logs, snap)
      const blocks = [...requirementBlocks(missing, look.hostOld), ...viewBlocks]
      // Inline, the bar's lines count in the capped rows.
      const cap = Math.min(INLINE_MAX_ROWS, look.bodyRows)
      barLines = bar === null ? [] : inline ? bar.lines.slice(0, inlineBarRows(bar, cap)) : bar.lines
      body = inline ? inlineLayout(blocks, cap - barLines.length) : dockLayout(blocks, columns, look.wraps)
    }
  } catch (error) {
    barLines = []
    body = failedDrawing(error)
  }
  return {
    isMinimized,
    current,
    changed,
    snap,
    acts,
    shown,
    open,
    at,
    files,
    field,
    landings,
    memo,
    scroll,
    found,
    teamFound,
    inboxFound,
    logFound,
    changesFound,
    logTitle,
    statsTitle,
    statsBack,
    setupShown,
    body,
    barLines,
  }
}
