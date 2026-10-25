// teamrig-pane: docks this session's list from the task register (where it is: places.ts) on the right
// of the fullscreen UI. `mine` shows the session's area: a status bar of its tasks (status-bar.ts),
// then its tasks in sections (rows.ts): Verifying, Working on, Up next, Waiting (its waiting tasks, then
// those asked of another session) and Done today (the team zone's day, as the bar counts it), each task a row with a
// dim meta line (meta.ts), and its unread inbox lines; `all` shows every owner's active tasks. A press on a task row opens its card in
// place of the meta line (card.ts): its status and note, plan, the ask quoted where its refs still point, who
// asked, the tasks planned first, its goals' roadmap items, evidence and links. A press on a task id in a card opens
// that task's page (page.ts), the card with the body to itself, under back and forward (b, f) and a trail of the
// last places (nav.ts), which the list keeps while a page lies ahead of it; a page opens at its top, and a return
// to the list scrolls back to the card it left. `Find` (s) moves the keys into the Find field, which shows the tasks
// the pane holds that its words match (search.ts) under a count of them, the matched words underlined, each result a
// press that opens its page, back returning to the results; Enter opens the one match, or moves the keys onto the
// first of more; emptying the field or clear closes it. A line under the field says where the keys go (find-field.ts). The close mark (✕, ctrl+x x) minimizes it to a one-row strip
// instead of closing it; a press on the strip or /teamrig-pane opens it again, and the size is kept for the next
// session (size.ts). A title line leads every docked view: the session's name, area and team (session-title.ts). A switch
// row, under it in every state and width (but a project teamrig is not set up for, where the setup shows alone)
// and the whole strip, flips the body between the tasks, the Changes view (the
// files changed in the git repos the session works in and their lines, changes.ts, counted as Δn on
// the switch and in the tab title) and the Log view: each team session's prompts and replies of the hours teamrig
// keeps them (the team config's turnLog.keepHours) from the turn logs it writes (turn-log.ts), a press on a session
// opening its page at its newest lines, back (b) returning to the list. The band above the prompt shows the session's
// name and the task it works on now
// (banner.ts), a press opening its card, whether the pane is open, minimized or never drawn. Reads
// files and runs git (status, diff, grep; no model calls); /teamrig-pane steers it.
import { atom, read, update } from 'claude-code'
import type { Components, Context, Register } from 'claude-code'
import type {
  BarStatus,
  BodyScroll,
  ExpandedTasks,
  FilePages,
  FindField,
  LogList,
  LogPage,
  Nav,
  PageDetails,
  PaneView,
  RefFile,
  RefFileRead,
  RequirementProblem,
  RingLandings,
  SetupView,
  Snapshot,
  TaskDetail,
  TaskRow,
  TeamSettings,
  ViewMode,
} from '../types'
import { ARGUMENT_HINT, COMMAND, inlineReason, parsePaneArgs } from './command'
import { LiveRegister, pinKey } from './live'
import { findPlaces, type Places, type PlacesEnv } from './places'
import { findSession, type TeamLookup } from './sessions'
import { inboxFile, TaskDetails, type RefPlaces } from './details'
import { RefFileReader } from './ref-file'
import { DEFAULT_REGISTER, TimeZone } from './core/read/index'
import { TaskRegisterSource, registerPaths, unlessMissing, type Files, type RegisterPaths } from './source'
import { WrapCache, dockLayout, failedDrawing, inlineLayout, wrapRow, type CardPart, type Drawn } from './layout'
import { diffKey, pieceKey, placeOf, pressesFrom, standInsOf } from './press-keys'
import { buttonCells, packRows, type ButtonLook } from './pack'
import { cells } from './width'
import { barSpans, blankSpans, frameOf, placesOf, revealed, scrolledBy, viewOf, type FrameSlot, type Placed, type View } from './frame'
import { AT_TOP, scrolledTo, settle, type Settled } from './body-scroll'
import { BANNER_KEY, bannerBlock, currentTask } from './banner'
import { sessionName, titleSpans } from './session-title'
import { NOTHING_EXPANDED, paneBlocks, type Block, type Span } from './rows'
import { inlineBarRows, statusBar, type BarPiece } from './status-bar'
import { PaneSizer, SIZE_KEY } from './size'
import { isGitMissing, requirementBlocks, requirementProblems } from './requirements'
import { EMPTY_CHANGES, knownOf, knownSeed, LiveChanges, NOTHING_KNOWN } from './changes'
import { changesBlocks, changesLabel, paneTitle } from './changes-rows'
import { LiveDiffs, NO_DIFFS } from './diff'
import { LiveLog, TurnLogReader, type LogFiles } from './turn-log'
import { logListBlocks, logPageBlocks } from './log-rows'
import { SetupWatch } from './setup'
import { setupBlocks } from './setup-rows'
import {
  AT_LIST,
  back,
  canGoBack,
  canGoForward,
  currentPlace,
  doneAt,
  filesKept,
  forward,
  isPage,
  landing,
  leavingList,
  leftSearch,
  pagesKept,
  placeLabel,
  pushed,
  reset,
  searched,
  trail,
  type Landing,
  wentTo,
} from './nav'
import { weekSteps } from './done'
import { doneBlocks, weekWords } from './done-rows'
import { treeOf } from './meta'
import { clockOf, machineZoneOf, weekOf } from './zone'
import { filePageBlocks, lineBlockKey, unreadLine } from './file-page'
import { pageBlocks } from './page'
import { matchCount, NO_RESULTS, searchTasks, topResult, type SearchResults } from './task-search'
import { SEARCH_VIEW, searchBlocks } from './search-rows'
import { resultKey } from './search-view'
import { FIRST_FIELD, FIRST_MEMO, NO_LANDINGS, drawnWith, fieldAfter, fieldKey, keysAt, keysHint, landedOn, submitWords, type KeysAt } from './find-field'

const PANE = 'teamrig-pane'
/** The dock width it asks for: an id, priority, due and a 40-column title line, inside the padding. */
const DOCK_COLUMNS = 58
/** Columns of space between the pane's frame and its text, each side. */
const PAD_COLUMNS = 1
/**
 * The most of a docked pane's rows its header, with the blank row under it, may take and still stay put: a taller one
 * (a dock too narrow for its buttons) would leave the body too few rows, so the pane then scrolls as one.
 */
const HEADER_MAX_SHARE = 0.5
/** Most rows an inline pane (above the prompt) shows, its last one saying what it left out. */
const INLINE_MAX_ROWS = 6
/** Between two crumbs of a page's trail. */
const TRAIL_SEPARATOR = ' › '
const BACK_LABEL = '‹ back'
const FORWARD_LABEL = 'forward ›'
/** The Archive page's steps to the week before and the week after the one it shows. */
const PREV_LABEL = '‹ prev'
const NEXT_LABEL = 'next ›'
/** What the close hook answers the person's close with: the engine logs it as why the pane stayed. */
const MINIMIZED = `minimized to its strip: a press on it, or /${COMMAND}, opens it again`
/** How long one git run may take before it is killed and the repo shows the failure. */
const GIT_TIMEOUT_MS = 10_000

// The pane's $.state (declared in ../types); the engine's scan wants atoms written in the module that uses them.
const EMPTY_SNAPSHOT: Snapshot = {
  tasks: [],
  area: null,
  areaSource: null,
  team: null,
  areaName: null,
  leads: null,
  unreadInbox: null,
  problem: null,
  notPickedUpAfterHours: DEFAULT_REGISTER.check.notPickedUpAfterHours,
  timeZone: TimeZone.UTC.name,
  now: 0,
}
/**
 * The tag the snapshot is kept under. $.state outlives a hot reload, so without it a new pane would
 * draw the snapshot the old code wrote, rows missing the fields it now reads; under another tag that
 * value reads as absent (the empty snapshot, until the reload's first poll). Bump it whenever the
 * Snapshot or TaskRow type in ../types changes shape.
 */
const SNAPSHOT_SHAPE = 'register-v8'
const snapshot = atom({ plugin: 'teamrig-pane', key: 'snapshot' } as const, EMPTY_SNAPSHOT, { shape: SNAPSHOT_SHAPE })
const mode = atom({ plugin: 'teamrig-pane', key: 'mode' } as const, 'mine')
/** The open cards are kept under a shape tag too (see SNAPSHOT_SHAPE): bump it when TaskDetail changes shape. */
const CARDS_SHAPE = 'cards-v1'
const expanded = atom({ plugin: 'teamrig-pane', key: 'expanded' } as const, NOTHING_EXPANDED, { shape: CARDS_SHAPE })
const size = atom({ plugin: 'teamrig-pane', key: 'size' } as const, 'open')
const view = atom({ plugin: 'teamrig-pane', key: 'view' } as const, 'tasks')
/** The changes are kept under a shape tag too (see SNAPSHOT_SHAPE): bump it when ChangesSnapshot changes shape. */
const CHANGES_SHAPE = 'changes-v3'
const changes = atom({ plugin: 'teamrig-pane', key: 'changes' } as const, EMPTY_CHANGES, { shape: CHANGES_SHAPE })
/**
 * The repo roots and outside files found, kept apart from the drawn changes: a version that bumps
 * CHANGES_SHAPE reads the drawn ones as absent after a hot reload, and would forget every repo the
 * session found. Bump KNOWN_SHAPE only when KnownChanges itself changes.
 */
const KNOWN_SHAPE = 'known-v1'
const known = atom({ plugin: 'teamrig-pane', key: 'known' } as const, NOTHING_KNOWN, { shape: KNOWN_SHAPE })
/** The open diffs are kept under a shape tag too (see SNAPSHOT_SHAPE): bump it when FileDiff or DiffLine changes shape. */
const DIFFS_SHAPE = 'diffs-v1'
const diffs = atom({ plugin: 'teamrig-pane', key: 'diffs' } as const, NO_DIFFS, { shape: DIFFS_SHAPE })
/** The Log view's list and page are kept under a shape tag too (see SNAPSHOT_SHAPE): bump it when LogList, LogPage or TurnEntry changes shape. */
const LOG_SHAPE = 'log-v2'
const LOG_READING: LogList = { kind: 'reading' }
const NO_TEAM_LOG: LogList = { kind: 'no-team' }
const NO_CONFIG_LOG: LogList = { kind: 'no-config' }
const logList = atom({ plugin: 'teamrig-pane', key: 'logList' } as const, LOG_READING, { shape: LOG_SHAPE })
const AT_LOG_LIST: LogPage | null = null
const logPage = atom({ plugin: 'teamrig-pane', key: 'logPage' } as const, AT_LOG_LIST, { shape: LOG_SHAPE })
const NOTHING_MISSING: RequirementProblem[] = []
/** What the pane lacks (requirements.ts); each session start checks again and writes it anew, a hot reload's too. */
const requirements = atom({ plugin: 'teamrig-pane', key: 'requirements' } as const, NOTHING_MISSING)
/** The setup kept under a shape tag too (see SNAPSHOT_SHAPE): bump it when SetupView or ProjectSetup changes shape. */
const SETUP_SHAPE = 'setup-v1'
const NOT_SETTING_UP: SetupView | null = null
/** What the pane shows alone in a project teamrig is not set up for (setup.ts), whatever the view; null once a register is found. */
const setup = atom({ plugin: 'teamrig-pane', key: 'setup' } as const, NOT_SETTING_UP, { shape: SETUP_SHAPE })
/** The status the status bar filters the mine view to (status-bar.ts), null for all: per pane, cleared at each session start. */
const barFilter = atom({ plugin: 'teamrig-pane', key: 'filter' } as const, null)
/** The places are kept under a shape tag too (see SNAPSHOT_SHAPE): bump it when Place or Nav changes shape. */
const NAV_SHAPE = 'nav-v4'
const nav = atom({ plugin: 'teamrig-pane', key: 'nav' } as const, AT_LIST, { shape: NAV_SHAPE })
const NO_PAGES: PageDetails = {}
/** The pages' details, kept under CARDS_SHAPE as the open cards are: both hold TaskDetail. */
const pages = atom({ plugin: 'teamrig-pane', key: 'pages' } as const, NO_PAGES, { shape: CARDS_SHAPE })
/** The file pages' reads are kept under a shape tag too (see SNAPSHOT_SHAPE): bump it when RefFileRead changes shape. */
const FILES_SHAPE = 'files-v1'
const NO_FILES: FilePages = {}
const filePages = atom({ plugin: 'teamrig-pane', key: 'filePages' } as const, NO_FILES, { shape: FILES_SHAPE })
/** The Find field's round (find-field.ts): the key it is drawn under and the text it starts with. */
const findField = atom({ plugin: 'teamrig-pane', key: 'findField' } as const, FIRST_FIELD)
/** The focus ring's landings in the pane (find-field.ts), counted by the ui.focus hook, kept under a shape tag too (see SNAPSHOT_SHAPE): bump it when RingLandings changes shape. */
const RING_SHAPE = 'ring-v1'
const ring = atom({ plugin: 'teamrig-pane', key: 'ring' } as const, NO_LANDINGS, { shape: RING_SHAPE })
/** Whether the banner (banner.ts) in the band above the prompt shows its task's card: a press on it opens and closes it. */
const bannerOpen = atom({ plugin: 'teamrig-pane', key: 'banner' } as const, false)
/** Where the docked body's window is to stand (body-scroll.ts), kept under a shape tag too (see SNAPSHOT_SHAPE): bump it when BodyScroll or ScrollTarget changes shape. */
const SCROLL_SHAPE = 'scroll-v1'
const bodyScroll = atom({ plugin: 'teamrig-pane', key: 'bodyScroll' } as const, AT_TOP, { shape: SCROLL_SHAPE })

/** The open cards less one. */
function collapse(current: ExpandedTasks, id: string): ExpandedTasks {
  return Object.fromEntries(Object.entries(current).filter(([key]) => key !== id))
}

/** Who moves the tasks view: the person typing in the Find field, or any other step. */
type StepOrigin = 'typing' | 'step'

/**
 * Moves the tasks view by `step` (nav.ts), keeping only the details of the pages, and the reads of the files, a place
 * still names. A step other than typing that changes what the Find field should hold starts a new round of it
 * (find-field.ts). A page opens at its top, a file's page at its ref's line, and a step from a page back to the list
 * brings the element the page was opened from to the middle of the window; a failed move leaves the window where it is.
 */
async function go($: Context, step: (current: Nav) => Nav, origin: StepOrigin = 'step'): Promise<void> {
  // The step runs on the places as last written, so a step written while this one runs is never lost.
  const seen: { before: Nav | null } = { before: null }
  const next = await update($, nav, current => {
    seen.before = current
    return step(current)
  })
  const before = seen.before
  if (before === null || next === before) return
  if (origin === 'step') await update($, findField, field => fieldAfter(field, before, next))
  await update($, pages, current => pagesKept(current, next))
  await update($, filePages, current => filesKept(current, next))
  const to = landing(before, next)
  if (to !== null) await scrollTo($, to).catch(() => undefined)
}

/**
 * Moves the docked body's window (body-scroll.ts) to the top, brings the element a landing names to its middle, or a
 * file page's line to the window's top by the paragraph that holds it (file-page.ts), the page's top when none does.
 * Inline the pane cuts its rows to fit (INLINE_MAX_ROWS) and has no window to move.
 */
async function scrollTo($: Context, to: Landing): Promise<void> {
  const key = to.kind === 'top' ? null : to.kind === 'row' ? to.key : lineBlockKey(to, (await read($, filePages))[to.file])
  await update($, bodyScroll, current =>
    scrolledTo(current, key === null ? { kind: 'offset', offset: 0 } : { kind: 'reveal', key, block: to.kind === 'line' ? 'start' : 'center' }),
  )
}

/** Moves the pane's focus ring onto the element keyed `key`; refused while the pane does not hold the keys, which leaves it where it was. */
async function focusOn($: Context, key: string): Promise<void> {
  await $.ui.focus({ requestId: PANE, key }).catch(() => undefined)
}

/** Moves the pane's focus ring into the Find field, as its round draws it now. */
async function focusFind($: Context): Promise<void> {
  await focusOn($, fieldKey(await read($, findField)))
}

/**
 * Closes the search from its clear button and moves the ring back into the field, a new round's: the button is
 * hidden as the search closes, and the ring left at its index would sit on the next element, so the next keys would
 * press the pane's hotkeys rather than type a new search.
 */
async function clearSearch($: Context): Promise<void> {
  await go($, leftSearch)
  await focusFind($)
}

/** The mine or all view, the list shown alone: the rows a page left from belong to the other list. */
async function showMode($: Context, shown: ViewMode): Promise<void> {
  await update($, mode, () => shown)
  await go($, current => reset(current, false))
}

/** The components spans draw with: each render hook passes those its surface resolved. */
type SpanComponents = Pick<Components, 'Text' | 'Link'>

const isPlain = (span: Span) =>
  span.color === undefined && span.bold !== true && span.dim !== true && span.underline !== true && span.href === undefined

/** One span as a Text in its own style. */
function styledSpan({ Text }: SpanComponents, span: Span, key?: string) {
  return (
    <Text key={key} color={span.color} bold={span.bold} dimColor={span.dim} underline={span.underline}>
      {span.text}
    </Text>
  )
}

/** A span in a Text: a plain string, a link, or a styled Text. */
function inSpan(components: SpanComponents, span: Span, key: string) {
  const { Link } = components
  if (span.href !== undefined)
    return (
      <Link key={key} href={span.href}>
        {span.text}
      </Link>
    )
  return isPlain(span) ? span.text : styledSpan(components, span, key)
}

/** A row's spans as one Text, wrapped or cut as `wrap` says; a lone span with no link is that Text in its style. */
function drawSpans(components: SpanComponents, spans: readonly Span[], wrap: Drawn['wrap'], key?: string) {
  const { Text } = components
  const [first, ...rest] = spans
  if (first !== undefined && rest.length === 0 && first.href === undefined)
    return (
      <Text key={key} wrap={wrap} color={first.color} bold={first.bold} dimColor={first.dim} underline={first.underline}>
        {first.text}
      </Text>
    )
  return (
    <Text key={key} wrap={wrap}>
      {spans.map((span, index) => inSpan(components, span, String(index)))}
    </Text>
  )
}

/** The components a view's Find row and the line under it draw with. */
type FindComponents = Pick<Components, 'Box' | 'Button' | 'Input' | 'Text'>

/** What a view's Find row draws (find-field.ts): its round's field, and the steps of the view's search. */
type FindRow = {
  /** The field's key in its round (fieldKey). */
  key: string
  placeholder: string
  /** What the round started with (fieldText): the query of the search shown, else nothing. */
  text: string
  /** What Enter in the field does (submitWords). */
  submitLabel: string
  /** `s: Find`: moves the focus ring into the field. */
  onFind: () => void
  onInput: (value: string) => void
  onSubmit: (value: string) => void
  /** Closes the search shown; null while none shows, so no clear is drawn. */
  onClear: (() => void) | null
}

/**
 * `s: Find`, the field, then clear while a search shows, in one row that never wraps: the field's width is the
 * engine's, so the header counts the row as one (pack.ts).
 */
function drawFindRow({ Box, Button, Input }: FindComponents, row: FindRow) {
  return (
    <Box key="find-row" flexDirection="row" columnGap={1}>
      <Button key="find-key" label="Find" plain hotkey="s" onPress={row.onFind} />
      <Input key={row.key} placeholder={row.placeholder} value={row.text} submitLabel={row.submitLabel} onInput={row.onInput} onSubmit={row.onSubmit} />
      {row.onClear === null ? null : <Button label="clear" variant="secondary" onPress={row.onClear} />}
    </Box>
  )
}

/** An element of a header row that wraps, and the cells it takes: the header packs those rows in code (pack.ts). */
type HeaderItem = { readonly node: JSX.Element; readonly cells: number }

/** A piece of the docked header and the rows it takes: the header's rows are counted as drawn, so the body's window takes the rest (T860). */
type HeaderPart = { readonly node: JSX.Element; readonly rows: number }

/** The line under the Find field, `text` saying where the keys go (keysHint): bold while typing searches, else dim. */
function drawKeysLine({ Text }: FindComponents, keys: KeysAt, text: string) {
  return keys === 'search' ? (
    <Text key="keys-hint" bold>
      {text}
    </Text>
  ) : (
    <Text key="keys-hint" dimColor>
      {text}
    </Text>
  )
}

export const register: Register = on => {
  let live: LiveRegister | null = null
  /** The team `/teamrig-pane <session>` looks its word up in; set when the session starts, null with no team. */
  let team: TeamLookup | null = null
  /** Reads what an open card's refs and goals point at; set when the session starts. */
  let details: TaskDetails | null = null
  /** Reads the file a card's Reference row names for its page; set when the session starts. */
  let refFiles: RefFileReader | null = null
  /** Draws and keeps the pane's size; set when the session starts. */
  let sizer: PaneSizer | null = null
  /** Reads the session's git changes; set when the session starts. */
  let tracked: LiveChanges | null = null
  /** Opens, closes and reads again the Changes files' diffs; set when the session starts. */
  let diffing: LiveDiffs | null = null
  /** Reads the Log view's list or page again while it shows; set when the session starts. */
  let logging: LiveLog | null = null
  /** Looks for the register again while the project is not set up for teamrig; set when the session starts in one. */
  let watch: SetupWatch | null = null
  /** The tab title last asked for: `Tasks · Δn` (changes-rows.ts paneTitle). */
  let title = paneTitle(EMPTY_CHANGES)
  /**
   * What a task's refs and goals point at, for its card or its page. A failed read still opens it, its refs named
   * unquoted and its goals by id: the register's own fields are the rest of the card.
   */
  const detailOf = async (task: TaskRow): Promise<TaskDetail> => {
    const unquoted: TaskDetail = { ref: task.ref, quotes: [], goals: [] }
    return details === null ? unquoted : details.load(task).catch(() => unquoted)
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: "Show this session's register tasks in the side pane",
      argumentHint: ARGUMENT_HINT,
    })
    live?.stop()
    tracked?.stop()
    logging?.stop()
    watch?.stop()
    // A filter is a look for the moment, never kept: a new session, or a hot reload, lists every task again.
    await update($, barFilter, () => null)
    const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
    // A path that is not there stamps null; a locked or denied one, or any other failure, throws to
    // the poll (source.ts unlessMissing).
    const files: Files = {
      stamp: path =>
        unlessMissing(
          async () => {
            const stat = await $.fs.stat(path)
            return stat.kind === 'file' ? { mtimeMs: stat.mtimeMs, size: stat.size } : null
          },
          () => $.fs.exists(path),
          null,
        ),
      read: path => $.fs.read(path),
    }
    const env: PlacesEnv = {
      TEAMRIG_PANE_TASKS_DIR: await $.env.get('TEAMRIG_PANE_TASKS_DIR'),
      TEAMRIG_PANE_INBOX_DIR: await $.env.get('TEAMRIG_PANE_INBOX_DIR'),
      TEAMRIG_PANE_GOALS_DOC: await $.env.get('TEAMRIG_PANE_GOALS_DOC'),
      TEAMRIG_PANE_SETTINGS: await $.env.get('TEAMRIG_PANE_SETTINGS'),
      TEAMRIG_HOME: await $.env.get('TEAMRIG_HOME'),
      TEAMRIG_TEAM: await $.env.get('TEAMRIG_TEAM'),
    }
    const machineZone = machineZoneOf(await $.env.get('TZ'), Intl.DateTimeFormat().resolvedOptions().timeZone)
    // A missing folder lists as null (no turn logs yet); a locked or denied one throws, which the list shows.
    const logFiles: LogFiles = {
      list: path => unlessMissing(() => $.fs.list(path), () => $.fs.exists(path), null),
      read: path => $.fs.read(path),
    }
    /**
     * Reads the register `places` names, in place of any read before: its tasks, a task's refs and goals, and the
     * Log view's turn logs. Places with a problem show it in place of the tasks.
     */
    const bind = async (places: Exclude<Places, { kind: 'unset' }>): Promise<void> => {
      live?.stop()
      logging?.stop()
      const registerAt: { paths: RegisterPaths; settings: TeamSettings } | { missing: string } =
        places.kind === 'found' ? { paths: registerPaths(places.dirs), settings: places.settings } : { missing: places.problem }
      team = places.kind === 'found' && places.team !== null ? { files, paths: places.team } : null
      const refPlaces: RefPlaces = {
        inboxDir: 'missing' in registerAt ? null : registerAt.paths.inboxDir,
        home: home ?? null,
        cwd: e.cwd,
        teamDir: places.kind === 'found' && places.team !== null ? places.team.dir : null,
        goalsDoc: places.goalsDoc,
      }
      details = new TaskDetails(files, refPlaces)
      refFiles = new RefFileReader(files, refPlaces)
      const started = new LiveRegister({
        source:
          'missing' in registerAt
            ? registerAt
            : new TaskRegisterSource(files, registerAt.paths, registerAt.settings, places.kind === 'found' ? places.team : null),
        sessionId: () => $.session.id(),
        now: () => $.clock.now(),
        publish: async change => {
          await update($, snapshot, change)
        },
        loadPin: claudeSession => $.store.get(pinKey(claudeSession)),
        savePin: (claudeSession, area) =>
          area === null ? $.store.delete(pinKey(claudeSession)) : $.store.set(pinKey(claudeSession), area),
      })
      live = started
      const turnLog = team === null ? null : team.paths.turnLog
      const logLive =
        turnLog === null
          ? null
          : new LiveLog({
              reader: new TurnLogReader(logFiles, turnLog),
              now: () => $.clock.now(),
              isShown: async () => (await read($, view)) === 'log' && (await read($, size)) !== 'minimized',
              shownPage: async () => (await read($, logPage))?.session ?? null,
              publishList: async list => {
                await update($, logList, () => list)
              },
              publishPage: async page => {
                await update($, logPage, () => page)
              },
            })
      logging = logLive
      if (logLive === null) {
        // No team, or one with no config file, which teamrig refuses and writes no turn log for: nothing to poll.
        await update($, logList, () => (team === null ? NO_TEAM_LOG : NO_CONFIG_LOG))
        await update($, logPage, () => AT_LOG_LIST)
      }
      await started.refresh()
      started.startTimers((ms, fn) => $.clock.every(ms, fn))
      logLive?.startTimers((ms, fn) => $.clock.every(ms, fn))
    }
    sizer = new PaneSizer({
      load: () => $.store.get(SIZE_KEY),
      save: value => $.store.set(SIZE_KEY, value),
      show: async value => {
        await update($, size, () => value)
      },
    })
    await sizer.restore()
    // A hot reload keeps the changes drawn: their repos stay known and the count stays in the title.
    const seed = await read($, changes)
    const kept = await read($, known)
    title = paneTitle(seed)
    const git = (args: readonly string[], cwd: string) => $.process.run(['git', ...args], { cwd, timeoutMs: GIT_TIMEOUT_MS })
    const diffsLive = new LiveDiffs(
      {
        git,
        publish: async opened => {
          await update($, diffs, () => opened)
        },
      },
      { diffs: await read($, diffs), changes: seed },
    )
    diffing = diffsLive
    const changesLive = new LiveChanges(
      {
        git,
        exists: path => $.fs.exists(path),
        publish: async fresh => {
          await update($, changes, () => fresh)
          await update($, known, () => knownOf(fresh))
          // Opening the open pane again retitles it in place; the title is a badge, so a failed one is let go.
          const retitled = paneTitle(fresh)
          if (retitled === title) return
          title = retitled
          await $.ui.open({ id: PANE, title, columns: DOCK_COLUMNS }).catch(() => undefined)
        },
        onRead: fresh => diffsLive.refresh(fresh),
      },
      knownSeed(seed, kept),
    )
    tracked = changesLive
    // The kit home's teams, for a project teamrig is not set up for: a missing folder lists none (source.ts unlessMissing).
    const folders = async (path: string): Promise<string[]> => {
      const entries = await unlessMissing(() => $.fs.list(path), () => $.fs.exists(path), null)
      return entries === null ? [] : entries.filter(entry => entry.kind === 'dir').map(entry => entry.name)
    }
    const findHere = () => findPlaces({ env, files, folders, home: home ?? null, cwd: e.cwd, machineZone })
    const places = await findHere()
    if (places.kind === 'unset') {
      // Nothing to read until a team or a register is named here: the tasks view shows how to set the project up,
      // and the watch looks again at each poll and binds the register it finds.
      live = null
      team = null
      details = null
      refFiles = null
      logging = null
      await update($, logList, () => NO_TEAM_LOG)
      await update($, logPage, () => AT_LOG_LIST)
      const watching = new SetupWatch(
        {
          find: findHere,
          show: async shown => {
            await update($, setup, () => shown)
          },
          bind,
        },
        places.setup,
      )
      watch = watching
      await watching.show()
      watching.startTimers((ms, fn) => $.clock.every(ms, fn))
    } else {
      watch = null
      await update($, setup, () => NOT_SETTING_UP)
      await bind(places)
    }
    changesLive.startTimers((ms, fn) => $.clock.every(ms, fn))
    void $.ui.open({ id: PANE, title, columns: DOCK_COLUMNS })
    // Once per start: git --version and the engine's version, never on a poll. The check never rejects; a
    // failed write only leaves the lines out.
    void requirementProblems({
      version: () => $.session.version(),
      gitVersion: () => $.process.run(['git', '--version'], { timeoutMs: GIT_TIMEOUT_MS }),
    })
      .then(found => update($, requirements, () => found))
      .catch(() => undefined)
    void changesLive.addFolder(e.cwd).then(() => changesLive.refresh())
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const command = parsePaneArgs(e.args)
    if (command.kind === 'pin') {
      // A word that names no session is answered, and neither pins nor opens the pane.
      const found = await findSession(command.word, team)
      if (!found.ok) return { text: found.problem }
      await live?.pin(found.id)
    }
    if (command.kind === 'mode') await showMode($, command.mode)
    if (command.kind === 'auto') await live?.pin(null)
    await sizer?.set('open')
    await $.ui.open({ id: PANE, title, columns: DOCK_COLUMNS })
    const reason = inlineReason(e.presentation)
    return reason === null ? {} : { text: reason }
  })

  // The person's close (the ✕ or ctrl+x x) minimizes the pane: refused, the pane stays open and keeps
  // its place among the panes the person opened (an open of its own then needs 110 columns, not 144).
  // The plugin's own close and an unload go through.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (sizer === null || !(await sizer.refusesClose(e.origin))) return next(e)
    return { deny: MINIMIZED }
  })

  // A file the session writes adds its repo to the Changes view (or lists it as outside git); a shell
  // call may commit or write, so the repos are read again on the next poll. Each only watches: the
  // tool's own result goes back as it came, and a hook that failed lets the call run (or replays it).
  const wrote = (ran: { deny?: string; isError?: boolean }, path: string) => {
    if (ran.deny === undefined && ran.isError !== true) void tracked?.noteWrite(path)
  }
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    wrote(ran, e.file_path)
    return ran
  }).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    wrote(ran, e.file_path)
    return ran
  }).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    const ran = await next(e)
    wrote(ran, e.notebook_path)
    return ran
  }).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    tracked?.markDirty()
    return ran
  }).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'PowerShell' }, async ($, e, next) => {
    const ran = await next(e)
    tracked?.markDirty()
    return ran
  }).catch(($, e, next) => next(e))

  // One Text per block (rows.ts, layout.ts), the unstyled spans plain strings: a few elements a
  // task. A task's block is a plain Button around its Text, so a press (or Enter on it) expands or
  // collapses the task. Docked, the header stays put and the body scrolls under it in a window the pane keeps
  // itself (frame.ts), cut to the rows it shows, a blank Text of a row between two blocks.
  /** Where the keys were as the pane last drew (find-field.ts): every drawing updates it, whatever it shows. */
  let keysMemo = FIRST_MEMO
  /** The rows the last docked layout wrapped: a drawing re-wraps only the rows that changed since. */
  const wraps = new WrapCache()
  /**
   * Where the docked body's window stood as last drawn: a reveal and the person's scrolls move it from there. Null
   * while the pane draws no window of its own (inline, minimized or flat), where the engine's window moves as it would.
   */
  let lastView: View | null = null
  /** The reveal the window last settled on (body-scroll.ts settle), held while no new step comes. */
  let settled: Settled | null = null
  /** Where the last docked drawing placed the body's elements (frame.ts placesOf); none while it draws no window of its own. */
  let lastPlaces: readonly Placed[] = []

  // Each landing of the pane's focus ring the engine let through is counted, the line under the Find field reading
  // where the keys go from it (find-field.ts). A landing on a body press the docked window does not show whole (Tab or
  // an arrow on from the last row it shows, onto a stand-in or a cut element) moves the window the least that shows
  // it, so the ring is never out of sight; a landing in view or in the header leaves it. A failed count or move lets
  // the ring move as it would have.
  on('ui.focus', { requestId: PANE }, async ($, e, next) => {
    const moved = await next(e)
    if (moved.deny !== undefined) return moved
    await update($, ring, current => landedOn(current, e.element))
    const view = lastView
    const place = view === null || e.element === undefined ? null : placeOf(lastPlaces, e.element)
    if (view === null || place === null) return moved
    const offset = revealed(place, view, 'nearest')
    if (offset !== view.offset) await update($, bodyScroll, current => scrolledTo(current, { kind: 'offset', offset }))
    return moved
  }).catch(($, e, next) => next(e))
  // A person's wheel tick, arrow or page key over the docked pane moves the body's own window from where it last stood
  // (frame.ts scrolledBy), never the engine's, so the header stays put. A plugin's scroll, or one while the pane draws
  // no window of its own, goes on to the engine. A failed write lets the engine take the scroll as it would have.
  on('ui.scroll', { requestId: PANE }, async ($, e, next) => {
    const view = lastView
    if (e.origin.kind !== 'person' || view === null) return next(e)
    await update($, bodyScroll, current => scrolledTo(current, { kind: 'offset', offset: scrolledBy(view, e) }))
    return {}
  }).catch(($, e, next) => next(e))
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const components = $.ui.resolve(e)
    const { Box, Text, Button, Link } = components
    const inline = e.props.placement === 'inline'
    // A read or a layout that throws draws one error line under the buttons: unguarded, the engine
    // would skip this hook and draw the pane with no tasks and no word of why.
    let isMinimized = false
    let current: PaneView = 'tasks'
    let changed = EMPTY_CHANGES
    let snap = EMPTY_SNAPSHOT
    let shown: ViewMode = 'mine'
    let open: ExpandedTasks = NOTHING_EXPANDED
    /** Where the tasks view is; the list in the Changes view and inline, where a page never shows. */
    let at: Nav = AT_LIST
    /** What the file pages the places name read, drawn with the tasks view docked. */
    let files: FilePages = NO_FILES
    /** The Find field's round (find-field.ts), drawn in the tasks view docked. */
    let field: FindField = FIRST_FIELD
    let landings: RingLandings = NO_LANDINGS
    /** Where the docked body's window is to stand, the last step that moved it; at the top inline. */
    let scroll: BodyScroll = AT_TOP
    /** The tasks the search shown matched, read once for its body, the Find field's Enter and the line under it; none off a search. */
    let found: SearchResults = NO_RESULTS
    /** The session whose Log page shows; null for the list or another view. */
    let logSession: string | null = null
    /** What a project teamrig is not set up for shows (setup.ts), alone, in every view; null once a register is found. */
    let setupShown: SetupView | null = NOT_SETTING_UP
    let body: Drawn[] = []
    /** The status bar's lines over the area's tasks (status-bar.ts); none outside the mine tasks view. */
    let barLines: BarPiece[][] = []
    const columns = e.props.bodyColumns - 2 * PAD_COLUMNS
    try {
      landings = await read($, ring)
      keysMemo = drawnWith(keysMemo, e.props.isFocused, landings)
      isMinimized = (await read($, size)) === 'minimized'
      current = await read($, view)
      changed = await read($, changes)
      if (!isMinimized) {
        snap = await read($, snapshot)
        shown = await read($, mode)
        open = await read($, expanded)
        const missing = await read($, requirements)
        if (!inline) scroll = await read($, bodyScroll)
        if (current === 'tasks' && !inline) {
          at = await read($, nav)
          files = await read($, filePages)
          field = await read($, findField)
        }
        const place = currentPlace(at)
        if (place.kind === 'search') found = searchTasks(snap.tasks, place.query, treeOf(snap))
        // A project teamrig is not set up for has no tasks, changes or log to show: its setup takes every view,
        // whatever place it is at.
        setupShown = await read($, setup)
        // A page has no status bar: the bar counts the list, and a press on it filters the list.
        const bar =
          current === 'tasks' && setupShown === null && shown === 'mine' && place.kind === 'list'
            ? statusBar(snap, await read($, barFilter), columns)
            : null
        // With no bar there is nothing to filter by, and the list shows every task.
        const tasksBlocks = async (): Promise<Block[]> =>
          place.kind === 'task'
            ? pageBlocks(snap, place.id, await read($, pages))
            : place.kind === 'search'
              ? searchBlocks(snap, place.query, found)
              : place.kind === 'done'
                ? doneBlocks(snap, shown, place.week)
                : place.kind === 'file'
                  ? filePageBlocks({ file: place.file, line: place.line }, files[place.file])
                  : paneBlocks(snap, shown, open, bar?.filter ?? null)
        // Inline, the Log view shows its list alone: a page opens in the dock.
        const logShown = setupShown === null && current === 'log' && !inline ? await read($, logPage) : null
        logSession = logShown?.session ?? null
        const viewBlocks =
          setupShown !== null
            ? setupBlocks(setupShown)
            : current === 'tasks'
              ? await tasksBlocks()
              : current === 'changes'
                ? changesBlocks(changed, isGitMissing(missing), await read($, diffs))
                : logShown === null
                  ? logListBlocks(await read($, logList), clockOf(snap))
                  : logPageBlocks(logShown, clockOf(snap))
        const blocks = [...requirementBlocks(missing), ...viewBlocks]
        // Inline, the bar's lines count in the capped rows.
        const cap = Math.min(INLINE_MAX_ROWS, e.props.scroll.bodyRows)
        barLines = bar === null ? [] : inline ? bar.lines.slice(0, inlineBarRows(bar, cap)) : bar.lines
        body = inline ? inlineLayout(blocks, cap - barLines.length) : dockLayout(blocks, columns, wraps)
      }
    } catch (error) {
      barLines = []
      body = failedDrawing(error)
    }

    // Opening a card reads what the task's refs and goals point at, once (detailOf).
    const toggle = async (id: string) => {
      if (open[id] !== undefined) {
        await update($, expanded, current => collapse(current, id))
        return
      }
      const task = snap.tasks.find(t => t.id === id)
      if (task === undefined) return
      const detail = await detailOf(task)
      await update($, expanded, current => ({ ...current, [id]: detail }))
    }
    // A press on a task id opens its page, read as a card's is; from the list, the list remembers `from`, the
    // element the press was in, to scroll back to.
    const openPage = async (id: string, from: string) => {
      const task = snap.tasks.find(t => t.id === id)
      if (task === undefined) return
      const detail = await detailOf(task)
      await update($, pages, current => ({ ...current, [id]: detail }))
      await go($, current => pushed(leavingList(current, from), { kind: 'task', id }))
    }
    // A file's page is read once as it opens (ref-file.ts). With no reader yet it says there was no folder to look in.
    const readFilePage = async (file: string): Promise<RefFileRead> => {
      const found: RefFileRead = refFiles === null ? { kind: 'missing', tried: [] } : await refFiles.read(file)
      await update($, filePages, current => ({ ...current, [file]: found }))
      return found
    }
    // A press on a reference file opens its page; from the list, the list remembers `from` as openPage's does.
    const openFile = async (file: RefFile, from: string) => {
      await readFilePage(file.file)
      await go($, current => pushed(leavingList(current, from), { kind: 'file', file: file.file, line: file.line }))
    }
    // A press on the header's inbox count opens the area's inbox as a file's page, landing on its first unread line
    // (unreadLine). Reading it marks nothing read: the pane writes no inbox, the session's `teamrig inbox read` does.
    const openInbox = async (area: string, from: string) => {
      const file = inboxFile(area)
      const found = await readFilePage(file)
      await go($, current => pushed(leavingList(current, from), { kind: 'file', file, line: unreadLine(found, snap.unreadInbox ?? 0) }))
    }
    // A press on a session in the Log view's list opens its page, read now, at its end: the newest lines are last.
    // Back shows the list, read again, from its top.
    const openLog = async (session: string) => {
      await logging?.open(session)
      await update($, bodyScroll, current => scrolledTo(current, { kind: 'end' }))
    }
    const closeLog = async () => {
      await logging?.close()
      await update($, bodyScroll, current => scrolledTo(current, { kind: 'offset', offset: 0 }))
    }
    // Enter in the Find field, on its words as typed (a redraw may lag behind them): with more than one match it moves
    // the ring onto the first result drawn (task-search.ts topResult), where Enter opens it and the arrows move on; with
    // one it opens that page and moves the ring onto the page's back step: left in the field, a new round's and empty,
    // it would type the next keys into a new search, so b, f and s would never answer.
    const submit = async (query: string) => {
      const results = searchTasks(snap.tasks, query, treeOf(snap))
      const top = topResult(results)
      if (top === null) return
      if (matchCount(results) > 1) {
        await focusOn($, resultKey(SEARCH_VIEW, top.id))
        return
      }
      await openPage(top.id, fieldKey(field))
      await focusOn($, 'back')
    }

    const spanComponents = { Text, Link }
    const styled = (span: Span, key?: string) => styledSpan(spanComponents, span, key)
    const drawText = (spans: readonly Span[], wrap: Drawn['wrap'], key?: string) => drawSpans(spanComponents, spans, wrap, key)
    /** A press in a card (a task id, a reference file): its text underlined, in its span's style. */
    const drawPress = (span: Span, key: string) => (
      <Text key={key} underline color={span.color} bold={span.bold} dimColor={span.dim}>
        {span.text}
      </Text>
    )
    /**
     * A card's lines with no press as one Text; a line with one as a row of its pieces, each id a press that opens
     * its page, keyed `goto:<id>:`, each reference file one that opens the file's, keyed `goto:file:`, an inbox count
     * one that opens the inbox's, keyed `goto:inbox:`, then where it is drawn (`from`, the card's element); a Changes
     * file's row one press that opens or closes its diff, keyed `diff:`, then where it is drawn and the row.
     */
    const drawPart = (part: CardPart, wrap: Drawn['wrap'], from: string) => {
      if (part.kind === 'text') return drawText(part.spans, wrap, part.key)
      if (part.kind === 'press')
        return (
          <Button key={diffKey(from, part.key)} plain onPress={() => void diffing?.toggle(part.expands)}>
            {drawText(part.spans, wrap)}
          </Button>
        )
      return (
        <Box key={part.key} flexDirection="row">
          {part.pieces.map((piece, i) => {
            switch (piece.kind) {
              case 'words':
                return drawText(piece.spans, wrap, String(i))
              case 'id':
                return (
                  <Button key={pieceKey(piece, from, part.key, i)} plain onPress={() => void openPage(piece.task, from)}>
                    {drawPress(piece.span, 'id')}
                  </Button>
                )
              case 'file':
                return (
                  <Button key={pieceKey(piece, from, part.key, i)} plain onPress={() => void openFile(piece.file, from)}>
                    {drawPress(piece.span, 'file')}
                  </Button>
                )
              case 'inbox':
                return (
                  <Button key={pieceKey(piece, from, part.key, i)} plain onPress={() => void openInbox(piece.area, from)}>
                    {drawPress(piece.span, 'inbox')}
                  </Button>
                )
            }
          })}
        </Box>
      )
    }
    // A block's first Text: a press that opens its task's card (`toggle`) or page (`opens`, a search result), a
    // session's Log page (`reads`), or, inline, a Changes file's diff (`expands`), else words alone.
    const headOf = (drawn: Drawn) => {
      const id = drawn.toggle
      const opens = drawn.opens
      const reads = drawn.reads
      const expands = drawn.expands
      if (reads !== undefined)
        return (
          <Button key={drawn.key} plain onPress={() => void openLog(reads)}>
            {drawText(drawn.spans, drawn.wrap)}
          </Button>
        )
      if (expands !== undefined)
        return (
          <Button key={drawn.key} plain onPress={() => void diffing?.toggle(expands)}>
            {drawText(drawn.spans, drawn.wrap)}
          </Button>
        )
      if (opens !== undefined)
        return (
          <Button key={drawn.key} plain onPress={() => void openPage(opens, drawn.key)}>
            {drawText(drawn.spans, drawn.wrap)}
          </Button>
        )
      if (id === null) return drawText(drawn.spans, drawn.wrap, drawn.key)
      return (
        <Button key={drawn.key} plain onPress={() => void toggle(id)}>
          {drawText(drawn.spans, drawn.wrap)}
        </Button>
      )
    }
    // A Button holds strings and Texts alone, so an open card (its links, its ids) draws under the task's Button, not
    // in it. A page's title is no press: its card is always open. An element drawn as parts (the header, its inbox
    // count a press) is a column Box of them, under its key.
    const drawBlock = (drawn: Drawn) => {
      if (drawn.parts !== undefined)
        return (
          <Box key={drawn.key} flexDirection="column">
            {drawn.parts.map(part => drawPart(part, drawn.wrap, pressesFrom(drawn)))}
          </Box>
        )
      const head = headOf(drawn)
      if (drawn.card === undefined) return head
      const from = pressesFrom(drawn)
      return (
        <Box key={from} flexDirection="column">
          {head}
          {drawn.card.map(part => drawPart(part, drawn.wrap, from))}
        </Box>
      )
    }
    // A slot of the docked body's window (frame.ts): an element cut to its rows in view, its open card alone when the
    // cut leaves none of its head's lines, or the blank rows between two elements.
    const drawSlot = (slot: FrameSlot) => {
      if (slot.kind === 'gap') return drawText(blankSpans(slot.rows), 'wrap', slot.key)
      if (slot.head) return drawBlock(slot.drawn)
      const { drawn } = slot
      const from = pressesFrom(drawn)
      return (
        <Box key={from} flexDirection="column">
          {(drawn.card ?? []).map(part => drawPart(part, drawn.wrap, from))}
        </Box>
      )
    }
    // The presses out of the window (press-keys.ts standInsOf), each a Button under its key in a Box no row tall: the
    // engine keeps the focus ring at an index among the pane's elements, so every press is drawn wherever the window
    // stands, and Tab still reaches the list's true ends. A press on one does nothing: it is out of sight.
    const drawStandIns = (key: string, keys: readonly string[]) =>
      keys.length === 0 ? null : (
        <Box key={key} flexDirection="column" height={0} overflow="hidden">
          {keys.map(standIn => (
            <Button key={standIn} label={standIn} plain onPress={() => undefined} />
          ))}
        </Box>
      )
    // The header and body as they are, one under the other, in no window of their own. Inline (gap 0) inlineLayout cut
    // the rows to fit; a dock whose header is too tall to stay put (HEADER_MAX_SHARE) draws every block, a blank row
    // apart, and the engine's window scrolls the pane as one.
    // A drawing with no window of its own: the engine's window takes the scrolls, and every press is drawn in it.
    const drawnWithoutWindow = () => {
      lastView = null
      lastPlaces = []
    }
    const drawFlat = (header: readonly HeaderPart[], gap: number) => {
      drawnWithoutWindow()
      return (
        <Box flexDirection="column" paddingX={PAD_COLUMNS} gap={gap}>
          {header.map(part => part.node)}
          {body.map(drawBlock)}
        </Box>
      )
    }
    // Docked, the header stays put and the body scrolls under it (T860): the two are as tall together as the
    // engine's window, so the engine has no rows to scroll, and the body's window takes the rows the header, counted
    // as drawn, and the blank row under it leave. It shows the body from the offset the last step settles on
    // (body-scroll.ts), the presses out of it drawn as stand-ins, and while the body is taller than the window a
    // scroll bar beside it, in the right padding's column, so the body's width never changes.
    const drawDocked = (header: readonly HeaderPart[]) => {
      const rows = e.props.scroll.bodyRows
      const headerRows = header.reduce((sum, part) => sum + part.rows, 0) + Math.max(0, header.length - 1)
      if (headerRows + 1 > rows * HEADER_MAX_SHARE) return drawFlat(header, 1)
      const visibleRows = rows - headerRows - 1
      const places = placesOf(body, 1)
      const landed = settle(scroll, settled, places, viewOf(places, lastView?.offset ?? 0, visibleRows))
      settled = landed.settled
      const frame = viewOf(places, landed.offset, visibleRows)
      lastView = frame
      lastPlaces = places
      const out = standInsOf(places, frame)
      const bar = barSpans(frame)
      return (
        <Box flexDirection="column" paddingLeft={PAD_COLUMNS} gap={1} height={rows} overflow="hidden">
          <Box key="header" flexDirection="column" gap={1} paddingRight={PAD_COLUMNS} flexShrink={0}>
            {header.map(part => part.node)}
          </Box>
          <Box key="body" flexDirection="row" flexGrow={1} overflow="hidden">
            <Box key="window" flexDirection="column" width={columns}>
              {drawStandIns('above', out.above)}
              {frameOf(places, frame).map(drawSlot)}
              {drawStandIns('below', out.below)}
            </Box>
            {bar.length === 0 ? null : drawText(bar, 'truncate-end', 'scroll-bar')}
          </Box>
        </Box>
      )
    }
    const drawPane = (header: readonly HeaderPart[]) => (inline ? drawFlat(header, 0) : drawDocked(header))

    // The session's title (session-title.ts) leads every docked view on one line cut at the pane's width; a Text, so it
    // holds no place in the focus ring. It stays above the body with the rest of the header. Inline the pane draws
    // none, as it sits by the band above the prompt, which names the session too, in rows INLINE_MAX_ROWS caps and the
    // engine redraws on every keystroke.
    const sessionTitle = inline ? null : titleSpans(snap)
    const titleRow: HeaderPart | null = sessionTitle === null ? null : { node: drawText(sessionTitle, 'truncate-end', 'title'), rows: 1 }

    // The header's rows that wrap (the switch, the mode buttons, a page's trail, the Archive week's steps) are packed in
    // code (pack.ts), each a column Box under its key of one row Box a row, keyed `<key>:<row>`: the rows drawn are the
    // rows counted, so the body's window can take the rows the header leaves (T860).
    const drawPacked = (key: string, items: readonly HeaderItem[], gap: number): HeaderPart => {
      const packed = packRows(items, item => item.cells, columns, gap)
      return {
        node: (
          <Box key={key} flexDirection="column">
            {packed.map((row, i) => (
              <Box key={`${key}:${i}`} flexDirection="row" columnGap={gap}>
                {row.map(item => item.node)}
              </Box>
            ))}
          </Box>
        ),
        rows: packed.length,
      }
    }
    /** A Button as a header item, its cells counted from how it looks. */
    const pressed = (node: JSX.Element, look: ButtonLook): HeaderItem => ({ node, cells: buttonCells(look) })
    /** Words as a header item. */
    const worded = (node: JSX.Element, text: string): HeaderItem => ({ node, cells: cells(text) })

    // The switch: under the title in every state but setup, so another view is always one press (or t / d / g) away, its
    // buttons wrapping under each other in a dock too narrow for both. Minimized, it is the whole
    // pane, one row, and a press on either button opens the pane in full on that view.
    // The Tasks button shows the list, from a page too, scrolled back to where the page was opened from; the Log
    // button shows the sessions, from a session's page too.
    const switchTo = async (target: PaneView) => {
      await update($, view, () => target)
      await sizer?.set('open')
      if (target === 'tasks') await go($, current => reset(current, true))
      if (target === 'changes') await tracked?.refresh()
      if (target === 'log') await logging?.close()
    }
    const changesWords = changesLabel(changed)
    const switchItems = [
      pressed(
        <Button key="tasks" label="Tasks" hotkey="t" variant={current === 'tasks' ? 'primary' : 'secondary'} onPress={() => void switchTo('tasks')} />,
        { label: 'Tasks', plain: false, hotkey: 't' },
      ),
      pressed(
        <Button
          key="changes"
          label={changesWords}
          hotkey="d"
          variant={current === 'changes' ? 'primary' : 'secondary'}
          onPress={() => void switchTo('changes')}
        />,
        { label: changesWords, plain: false, hotkey: 'd' },
      ),
      pressed(<Button key="log" label="Log" hotkey="g" variant={current === 'log' ? 'primary' : 'secondary'} onPress={() => void switchTo('log')} />, {
        label: 'Log',
        plain: false,
        hotkey: 'g',
      }),
      ...(isMinimized
        ? [
            worded(
              <Text key="hint" dimColor wrap="truncate-end">
                minimized
              </Text>,
              'minimized',
            ),
          ]
        : []),
    ]
    const switchRow = drawPacked('switch', switchItems, 1)
    if (isMinimized && body.length === 0) {
      drawnWithoutWindow()
      return <Box paddingX={PAD_COLUMNS}>{switchRow.node}</Box>
    }
    // A project teamrig is not set up for has no tasks to switch to, find or filter: its setup shows alone, with no
    // switch, Find row or mode buttons, so none of their hotkeys (t, d, g, s, m, a, h) answers. The minimized strip
    // above keeps its switch, so a press on it still opens the pane, onto the setup.
    if (setupShown !== null) return drawPane(titleRow === null ? [] : [titleRow])

    const buttons = [
      pressed(<Button label="mine" hotkey="m" variant={shown === 'mine' ? 'primary' : 'secondary'} onPress={() => void showMode($, 'mine')} />, {
        label: 'mine',
        plain: false,
        hotkey: 'm',
      }),
      pressed(<Button label="all" hotkey="a" variant={shown === 'all' ? 'primary' : 'secondary'} onPress={() => void showMode($, 'all')} />, {
        label: 'all',
        plain: false,
        hotkey: 'a',
      }),
    ]
    const place = currentPlace(at)
    // The archive opens the Archive page (done-rows.ts) at the week of now, in the dock alone, where a page can show:
    // inline, the places are never read.
    if (!inline)
      buttons.push(
        pressed(
          <Button
            key="archive"
            label="archive"
            hotkey="h"
            variant={place.kind === 'done' ? 'primary' : 'secondary'}
            onPress={() => void go($, current => doneAt(current, weekOf(snap.now, clockOf(snap).zone)))}
          />,
          { label: 'archive', plain: false, hotkey: 'h' },
        ),
      )
    // A page shows no list, so no card in it to collapse.
    if (Object.keys(open).length > 0 && place.kind === 'list')
      buttons.push(
        pressed(<Button label="collapse" hotkey="c" variant="secondary" onPress={() => void update($, expanded, () => NOTHING_EXPANDED)} />, {
          label: 'collapse',
          plain: false,
          hotkey: 'c',
        }),
      )

    // The Find field, under the switch in the dock whatever it shows: the first change opens a search (a place, so back
    // from a result's page returns to it), each change shows the results for its words, Enter opens the one match's page
    // or moves the ring onto the first of more, and an empty field or clear closes the search. It is drawn under its
    // round's key, holding what the round started with (find-field.ts): the query of the search shown, else nothing;
    // never the person's typing, which the engine would drop on each redraw. `s: Find` before it moves the focus ring
    // into it, and clear moves it back in; the field never takes the focus by itself, as it would then hold every key
    // the pane's hotkeys answer. Esc hands the keys back and leaves the results drawn.
    const findRow = inline
      ? null
      : drawFindRow(components, {
          key: fieldKey(field),
          placeholder: 'id, title, owner, note…',
          text: field.text,
          submitLabel: submitWords(matchCount(found)),
          onFind: () => void focusFind($),
          onInput: value => void go($, current => searched(current, value), 'typing'),
          onSubmit: value => void submit(value),
          onClear: place.kind === 'search' ? () => void clearSearch($) : null,
        })
    // Under the field, where the person's keys go now (find-field.ts): typed into the field, to a result, to the pane's
    // hotkeys or to Claude's prompt, and the key or the click that moves them, wrapped in a narrow dock.
    const keys: KeysAt = keysAt(e.props.isFocused, landings, keysMemo, place.kind === 'search')
    const keysLines = wrapRow({ key: 'keys-hint', spans: [{ text: keysHint(keys, matchCount(found)) }] }, columns).map(line =>
      line.map(span => span.text).join(''),
    )
    const keysLine = inline ? null : drawKeysLine(components, keys, keysLines.join('\n'))
    // In the tasks view the Find row and its line sit right under the switch, then the mode buttons, in the same block.
    // The field comes before every element that shows or hides with the place (collapse, clear, a page's steps): the
    // engine keeps the focus ring at an index among the pane's elements, so one shown or hidden before the field would
    // move the ring off it as the person types (the first key opens a search, which hides collapse), and the next keys
    // would press the pane's hotkeys or reach the prompt.
    // The Find row is one row, as drawFindRow draws it.
    const modes = drawPacked('modes', buttons, 1)
    const controls: HeaderPart =
      current === 'tasks'
        ? {
            node: (
              <Box key="controls" flexDirection="column">
                {titleRow?.node}
                {switchRow.node}
                {findRow}
                {keysLine}
                {modes.node}
              </Box>
            ),
            rows: (titleRow?.rows ?? 0) + switchRow.rows + (findRow === null ? 0 : 1) + (keysLine === null ? 0 : keysLines.length) + modes.rows,
          }
        : {
            node: (
              <Box key="controls" flexDirection="column">
                {titleRow?.node}
                {switchRow.node}
              </Box>
            ),
            rows: (titleRow?.rows ?? 0) + switchRow.rows,
          }
    // The status bar leads the tasks: its segments in one row as wide as the body, its counts under it.
    // A press on a segment or a count (or the count's key) filters the list to that status, a second
    // press on the same one clears it, and one on another switches to it.
    // A count's Button draws its key before it (`o: `), which the bar counts in its widths (status-bar.ts drawnText).
    const filterTo = (status: BarStatus) => void update($, barFilter, current => (current === status ? null : status))
    const drawPiece = (piece: BarPiece) => {
      const status = piece.status
      if (status === null) return styled(piece, piece.key)
      return piece.hotkey === null ? (
        <Button key={piece.key} plain onPress={() => filterTo(status)}>
          {styled(piece)}
        </Button>
      ) : (
        <Button key={piece.key} plain hotkey={piece.hotkey} onPress={() => filterTo(status)}>
          {styled(piece)}
        </Button>
      )
    }
    // Its lines come wrapped to the body's width (status-bar.ts), a row each.
    const statusRows: HeaderPart | null =
      barLines.length === 0
        ? null
        : {
            node: (
              <Box key="status-bar" flexDirection="column">
                {barLines.map((line, i) => (
                  <Box key={`status-bar:${i}`} flexDirection="row">
                    {line.map(drawPiece)}
                  </Box>
                ))}
              </Box>
            ),
            rows: barLines.length,
          }
    // A page, and the list while a page lies ahead of it (back led there), leads with back and forward (b, f; dim
    // when there is nowhere to go), then the trail of the last places, each one a press away but the one shown
    // (bold), those ahead of it dim, then a rule. Each key is written out on its Button, where the guide's key check
    // (tools/docs/llm-guide.test.ts) reads them.
    const nowhere = (key: string, label: string) => (
      <Text key={key} dimColor>
        {label}
      </Text>
    )
    const backStep = canGoBack(at) ? (
      <Button key="back" label={BACK_LABEL} hotkey="b" variant="secondary" onPress={() => void go($, back)} />
    ) : (
      nowhere('back', BACK_LABEL)
    )
    const forwardStep = canGoForward(at) ? (
      <Button key="forward" label={FORWARD_LABEL} hotkey="f" variant="secondary" onPress={() => void go($, forward)} />
    ) : (
      nowhere('forward', FORWARD_LABEL)
    )
    const { crumbs, isCutBefore, isCutAfter } = trail(at)
    const dimWords = (key: string, text: string) =>
      worded(
        <Text key={key} dimColor>
          {text}
        </Text>,
        text,
      )
    const crumbRow = crumbs.flatMap((crumb, i) => {
      const label = placeLabel(crumb.place)
      const drawn = crumb.isShown
        ? worded(
            <Text key={`crumb:${crumb.index}`} bold>
              {label}
            </Text>,
            label,
          )
        : pressed(
            <Button key={`crumb:${crumb.index}`} plain onPress={() => void go($, current => wentTo(current, crumb.index))}>
              <Text underline dimColor={crumb.isAhead}>
                {label}
              </Text>
            </Button>,
            { label, plain: true, hotkey: null },
          )
      return i === 0 ? [drawn] : [dimWords(`after:${crumb.index - 1}`, TRAIL_SEPARATOR), drawn]
    })
    const trailItems = [
      ...(isCutBefore ? [dimWords('cut-before', `…${TRAIL_SEPARATOR}`)] : []),
      ...crumbRow,
      ...(isCutAfter ? [dimWords('cut-after', `${TRAIL_SEPARATOR}…`)] : []),
    ]
    // The Archive page's week between its steps to the week before and after (p, l), each dim where the pane holds no
    // older or newer week. A step changes the page's week in place, so back returns to where the page was opened from.
    const stepTo = (week: string) => () => void go($, current => doneAt(current, week))
    const steps = place.kind === 'done' ? weekSteps(place.week, clockOf(snap)) : null
    const weekText = steps === null ? '' : `week of ${weekWords(steps.week)}`
    const weekRow =
      steps === null
        ? null
        : drawPacked(
            'week-steps',
            [
              steps.prev === null
                ? worded(nowhere('prev', PREV_LABEL), PREV_LABEL)
                : pressed(<Button key="prev" label={PREV_LABEL} hotkey="p" variant="secondary" onPress={stepTo(steps.prev)} />, {
                    label: PREV_LABEL,
                    plain: false,
                    hotkey: 'p',
                  }),
              worded(
                <Text key="week" bold>
                  {weekText}
                </Text>,
                weekText,
              ),
              steps.next === null
                ? worded(nowhere('next', NEXT_LABEL), NEXT_LABEL)
                : pressed(<Button key="next" label={NEXT_LABEL} hotkey="l" variant="secondary" onPress={stepTo(steps.next)} />, {
                    label: NEXT_LABEL,
                    plain: false,
                    hotkey: 'l',
                  }),
            ],
            2,
          )
    // Its steps' row, the trail's packed rows and the rule.
    const trailRows = drawPacked('trail', trailItems, 0)
    const pageHead: HeaderPart | null =
      isPage(place) || canGoForward(at)
        ? {
            node: (
              <Box key="page-head" flexDirection="column">
                <Box flexDirection="row" columnGap={2}>
                  {backStep}
                  {forwardStep}
                </Box>
                {trailRows.node}
                <Text dimColor>{'─'.repeat(Math.max(1, columns))}</Text>
              </Box>
            ),
            rows: 1 + trailRows.rows + 1,
          }
        : null
    // A Log page leads with back (b) to the list, then a rule.
    const logHead: HeaderPart | null =
      logSession === null
        ? null
        : {
            node: (
              <Box key="log-head" flexDirection="column">
                <Button key="back" label={BACK_LABEL} hotkey="b" variant="secondary" onPress={() => void closeLog()} />
                <Text dimColor>{'─'.repeat(Math.max(1, columns))}</Text>
              </Box>
            ),
            rows: 2,
          }
    return drawPane([controls, pageHead, logHead, weekRow, statusRows].filter((part): part is HeaderPart => part !== null))
  })

  /** The banner's own: each layout settles its cache, so one shared with the pane's body would drop its rows. */
  const bannerWraps = new WrapCache()
  // The band above the prompt (AbovePrompt): the banner (banner.ts), the task the session works on now, one press that
  // opens its card and a second that closes it, wrapped at the band's width. A survey takes the band, and a session
  // with no area draws none, so a session outside a team gets no band from the pane. The engine scrolls a card
  // taller than the band and folds the band from its [-] (ctrl+x ctrl+a). The press has no hotkey: a band's hotkey
  // answers a bare key typed in an empty prompt.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const snap = await read($, snapshot)
    if (snap.area === null) return next(e)
    const { Box, Button, Text, Link } = $.ui.resolve(e)
    const tree = treeOf(snap)
    const isOpen = await read($, bannerOpen)
    const name = sessionName(snap.area, snap.areaName)
    const [banner] = dockLayout([bannerBlock(currentTask(snap, tree), isOpen, tree, name)], e.props.bodyColumns, bannerWraps)
    if (banner === undefined) return next(e)
    return (
      <Box>
        <Button key={BANNER_KEY} plain onPress={() => void update($, bannerOpen, wasOpen => !wasOpen)}>
          {drawSpans({ Text, Link }, banner.spans, banner.wrap)}
        </Button>
      </Box>
    )
  })
}
