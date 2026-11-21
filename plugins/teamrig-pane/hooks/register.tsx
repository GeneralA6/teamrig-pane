// teamrig-pane: docks this session's list from the task register (where it is: places.ts) on the right
// of the fullscreen UI. `mine` shows the session's area: a status bar of its tasks (status-bar.ts),
// then its tasks in sections (rows.ts): Verifying, Working on, Up next, Waiting (its own waiting tasks), Asked of
// others (those it asked of another session) and Done today (the team zone's day, as the bar counts it), each task a
// row with a dim meta line (meta.ts); `all` shows every owner's active tasks, its own first. A press on a section's or
// an owner's heading folds its tasks away, a second shows them again (tasksFolded). A press on a task row opens its card in
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
// files changed in the git repos the session works in and their lines, changes.ts, counted on the switch,
// `Changes 3`, and in the tab title), the Log view: each team session's prompts and replies of the hours teamrig
// keeps them (the team config's turnLog.keepHours) from the turn logs it writes (turn-log.ts), a press on a session
// opening its page at its newest lines, back (b) returning to the list, the Inbox view: the session's inbox lines of
// the last 24 hours and its unread ones, newest first, with a search of its own (inbox-rows.ts, inbox-search.ts), a
// press on the header's unread count opening it, and the Teams tab: the tree of teams the
// session's team is in, each team's lead over the sessions it leads and its retired ones (team.ts, team-source.ts), a
// press on a row opening or closing what lies under it, a session's cards on the owner counted on its row and on the
// switch (`Teams (2)`), its [Meet] press running `teamrig meet` on it and its [Wake] press running `teamrig owner wake`
// on it (session-acts.ts), and the Meetings view: the
// team's scheduled and started meetings by time (meetings.ts, meetings-rows.ts), a press on one opening its card,
// whose presses start, move, drop, end or postpone it. The band above the prompt shows the session's
// name and the task it works on now
// (banner.ts), a press opening its card and a button beside it the pane at the task's page, whether the pane is
// open, minimized or never drawn. Reads
// files and runs git (status, diff, grep) and the teamrig CLI (meeting list and start, meet; no model calls);
// /teamrig-pane steers it.
import { atom, read, update } from 'claude-code'
import type { Components, Context, ProcessResult, Register, ToolResult } from 'claude-code'
import type {
  LogRead,
  PaneState,
  Snapshot,
  TaskDetail,
  TaskRow,
  TeamSettings,
} from '../types'
import { claudeCodeCheck, claudeCodeOldLine } from './claude-code-version'
import { ARGUMENT_HINT, COMMAND, inlineReason, KEYS_WORDS, parsePaneArgs, TIE_HINT } from './command'
import { bounded } from './bounded-run'
import { LiveRegister, pinKey } from './live'
import {
  AT_LOG_LIST,
  INITIAL_STATE,
  NO_ACT,
  NO_ANSWER,
  NO_CONFIG_LOG,
  NO_MEETING_ANSWER,
  NO_MEETING_ASKED,
  NO_PREVIOUS,
  NO_TEAM_LOG,
  NO_TEAM_MEETINGS,
  NO_TEAM_STATS,
  NO_TEAM_TREE,
  NOT_SETTING_UP,
} from './pane-state'
import type { PaneKey, PaneStore } from './pane-store'
import { screenOf } from './screen'
import { openConversation, showMode, switchView, type MoveFocus, type ViewLives } from './steps'
import { findPlaces, type Places, type PlacesEnv } from './places'
import { findSession, type TeamLookup } from './sessions'
import { TaskDetails, type RefPlaces } from './details'
import { openTask, toggleBanner, togglePrevious, type ReadsFile } from './presses'
import { pressOfDrawn, pressOfPart, pressOfPiece, runPress, submitFind, typeFind, type Press, type PressDeps } from './press'
import { headOf, headRows, pressOfBar, type HeadButton, type HeadItem, type HeadPart, type HeadPiece, type HeadWords } from './head'
import { RefFileReader } from './ref-file'
import { TaskRegisterSource, registerPaths, unlessMissing, type Files, type RegisterPaths } from './source'
import { TreeGoals } from './tree-goals'
import { TreeRegisters } from './tree-registers'
import { NO_ELSEWHERE } from './elsewhere'
import { WrapCache, dockLayout, type CardPart, type Drawn } from './layout'
import { diffKey, noteKey, pieceKey, placeOf, pressesFrom, standInsOf } from './press-keys'
import { buttonCells } from './pack'
import { barSpans, blankSpans, frameOf, placesOf, revealed, scrolledBy, viewOf, type FrameSlot, type Placed, type View } from './frame'
import { scrolledTo, settle, type Settled } from './body-scroll'
import {
  BANNER_FILL_KEY,
  BANNER_KEY,
  BANNER_OPEN_KEY,
  BANNER_OPEN_LABEL,
  PREVIOUS_ALL_KEY,
  PREVIOUS_ALL_LABEL,
  PREVIOUS_FRAME_CELLS,
  PREVIOUS_FRAME_KEY,
  PREVIOUS_FRAME_PADDING,
  PREVIOUS_HEAD_KEY,
  PREVIOUS_KEY,
  PREVIOUS_LABEL,
  PREVIOUS_OPEN_KEY,
  PREVIOUS_PRESS_KEY,
  bannerBlock,
  currentTask,
  previousBlock,
  type Current,
} from './banner'
import { sessionName } from './session-title'
import type { Span } from './rows'
import type { BarPiece } from './status-bar'
import { PaneSizer, SIZE_KEY } from './size'
import { gitCheck, requirementProblems } from './requirements'
import { EMPTY_CHANGES, knownOf, knownSeed, LiveChanges } from './changes'
import { paneTitle } from './changes-rows'
import { LiveDiffs } from './diff'
import { LiveCopies } from './outside-copies'
import { LiveLog, TurnLogReader, type LogFiles } from './turn-log'
import { LivePrevious } from './previous-conversation'
import { LiveTeam } from './team-source'
import { SetupWatch } from './setup'
import { LiveMeetings } from './meetings'
import { OwnerActs } from './owner-acts'
import { NoteHold } from './note-hold'
import { SessionActs } from './session-acts'
import { LiveStats } from './stats-source'
import { findTeamrigCli } from './teamrig-cli'
import { themeOf } from './theme'
import { currentPlace } from './nav'
import { treeOf } from './meta'
import { clockOf, machineZoneOf, zoneNamed } from './zone'
import { FIRST_MEMO, landedOn, type KeysAt } from './find-field'

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
/** What the close hook answers the person's close with: the engine logs it as why the pane stayed. */
const MINIMIZED = `minimized to its strip: a press on it, or /${COMMAND}, opens it again`
/** How long one git run may take before it is killed and the repo shows the failure. */
const GIT_TIMEOUT_MS = 10_000

// The pane's $.state (declared in ../types), each key starting from what pane-state.ts INITIAL_STATE gives it; the
// engine's scan wants atoms written in the module that uses them.
/**
 * The tag the snapshot is kept under. $.state outlives a hot reload, so without it a new pane would
 * draw the snapshot the old code wrote, rows missing the fields it now reads; under another tag that
 * value reads as absent (the empty snapshot, until the reload's first poll). Bump it whenever the
 * Snapshot or TaskRow type in ../types changes shape.
 */
const SNAPSHOT_SHAPE = 'register-v17'
const snapshot = atom({ plugin: 'teamrig-pane', key: 'snapshot' } as const, INITIAL_STATE.snapshot, { shape: SNAPSHOT_SHAPE })
const mode = atom({ plugin: 'teamrig-pane', key: 'mode' } as const, INITIAL_STATE.mode)
/** The open cards are kept under a shape tag too (see SNAPSHOT_SHAPE): bump it when TaskDetail changes shape. */
const CARDS_SHAPE = 'cards-v1'
const expanded = atom({ plugin: 'teamrig-pane', key: 'expanded' } as const, INITIAL_STATE.expanded, { shape: CARDS_SHAPE })
/** The Tasks view's headings whose tasks are folded away (rows.ts paneBlocks), by block key: a press on one flips it. */
const tasksFolded = atom({ plugin: 'teamrig-pane', key: 'tasksFolded' } as const, INITIAL_STATE.tasksFolded)
const size = atom({ plugin: 'teamrig-pane', key: 'size' } as const, INITIAL_STATE.size)
const view = atom({ plugin: 'teamrig-pane', key: 'view' } as const, INITIAL_STATE.view)
/** The changes are kept under a shape tag too (see SNAPSHOT_SHAPE): bump it when ChangesSnapshot changes shape. */
const CHANGES_SHAPE = 'changes-v3'
const changes = atom({ plugin: 'teamrig-pane', key: 'changes' } as const, INITIAL_STATE.changes, { shape: CHANGES_SHAPE })
/**
 * The repo roots and outside files found, kept apart from the drawn changes: a version that bumps
 * CHANGES_SHAPE reads the drawn ones as absent after a hot reload, and would forget every repo the
 * session found. Bump KNOWN_SHAPE only when KnownChanges itself changes.
 */
const KNOWN_SHAPE = 'known-v1'
const known = atom({ plugin: 'teamrig-pane', key: 'known' } as const, INITIAL_STATE.known, { shape: KNOWN_SHAPE })
/** The open diffs are kept under a shape tag too (see SNAPSHOT_SHAPE): bump it when FileDiff or DiffLine changes shape. */
const DIFFS_SHAPE = 'diffs-v1'
const diffs = atom({ plugin: 'teamrig-pane', key: 'diffs' } as const, INITIAL_STATE.diffs, { shape: DIFFS_SHAPE })
/** The outside files' copies are kept under a shape tag too (see SNAPSHOT_SHAPE): bump it when OutsideCopy changes shape. */
const COPIES_SHAPE = 'copies-v1'
const copies = atom({ plugin: 'teamrig-pane', key: 'copies' } as const, INITIAL_STATE.copies, { shape: COPIES_SHAPE })
/** The Log view's list and page are kept under a shape tag too (see SNAPSHOT_SHAPE): bump it when LogList, LogPage or TurnEntry changes shape. */
const LOG_SHAPE = 'log-v3'
const logList = atom({ plugin: 'teamrig-pane', key: 'logList' } as const, INITIAL_STATE.logList, { shape: LOG_SHAPE })
const logPage = atom({ plugin: 'teamrig-pane', key: 'logPage' } as const, INITIAL_STATE.logPage, { shape: LOG_SHAPE })
/** The area's conversation before the one of now, for the band (previous-conversation.ts); null for none. */
const previousConversation = atom({ plugin: 'teamrig-pane', key: 'previousConversation' } as const, INITIAL_STATE.previousConversation, {
  shape: LOG_SHAPE,
})
/** What the pane lacks (requirements.ts); each session start checks again and writes it anew, a hot reload's too. */
const requirements = atom({ plugin: 'teamrig-pane', key: 'requirements' } as const, INITIAL_STATE.requirements)
/** The setup kept under a shape tag too (see SNAPSHOT_SHAPE): bump it when SetupView or ProjectSetup changes shape. */
const SETUP_SHAPE = 'setup-v1'
/** What the pane shows alone in a project teamrig is not set up for (setup.ts), whatever the view; null once a register is found. */
const setup = atom({ plugin: 'teamrig-pane', key: 'setup' } as const, INITIAL_STATE.setup, { shape: SETUP_SHAPE })
/** The status the status bar filters the mine view to (status-bar.ts), null for all: per pane, cleared at each session start. */
const barFilter = atom({ plugin: 'teamrig-pane', key: 'filter' } as const, INITIAL_STATE.filter)
/** The places are kept under a shape tag too (see SNAPSHOT_SHAPE): bump it when Place or Nav changes shape. */
const NAV_SHAPE = 'nav-v4'
const nav = atom({ plugin: 'teamrig-pane', key: 'nav' } as const, INITIAL_STATE.nav, { shape: NAV_SHAPE })
/** The pages' details, kept under CARDS_SHAPE as the open cards are: both hold TaskDetail. */
const pages = atom({ plugin: 'teamrig-pane', key: 'pages' } as const, INITIAL_STATE.pages, { shape: CARDS_SHAPE })
/** The file pages' reads are kept under a shape tag too (see SNAPSHOT_SHAPE): bump it when RefFileRead changes shape. */
const FILES_SHAPE = 'files-v1'
const filePages = atom({ plugin: 'teamrig-pane', key: 'filePages' } as const, INITIAL_STATE.filePages, { shape: FILES_SHAPE })
/** The Find field's round (find-field.ts): the key it is drawn under and the text it starts with. */
const findField = atom({ plugin: 'teamrig-pane', key: 'findField' } as const, INITIAL_STATE.findField)
/** The focus ring's landings in the pane (find-field.ts), counted by the ui.focus hook, kept under a shape tag too (see SNAPSHOT_SHAPE): bump it when RingLandings changes shape. */
const RING_SHAPE = 'ring-v1'
const ring = atom({ plugin: 'teamrig-pane', key: 'ring' } as const, INITIAL_STATE.ring, { shape: RING_SHAPE })
/** Whether the banner (banner.ts) in the band above the prompt shows its task's card: a press on it opens and closes it. */
const bannerOpen = atom({ plugin: 'teamrig-pane', key: 'banner' } as const, INITIAL_STATE.banner)
/** Whether the band's previous conversation (banner.ts previousBlock) shows its whole titles and facts: a press on its title opens and closes it. */
const previousOpen = atom({ plugin: 'teamrig-pane', key: 'previousOpen' } as const, INITIAL_STATE.previousOpen)
/** Where the docked body's window is to stand (body-scroll.ts), kept under a shape tag too (see SNAPSHOT_SHAPE): bump it when BodyScroll or ScrollTarget changes shape. */
const SCROLL_SHAPE = 'scroll-v1'
const bodyScroll = atom({ plugin: 'teamrig-pane', key: 'bodyScroll' } as const, INITIAL_STATE.bodyScroll, { shape: SCROLL_SHAPE })
/** The Teams tab's tree (team-source.ts) is kept under a shape tag too (see SNAPSHOT_SHAPE): bump it when TeamView or team.ts's TeamTreeNode changes shape. */
const TEAM_SHAPE = 'team-v7'
const teamTree = atom({ plugin: 'teamrig-pane', key: 'teamTree' } as const, INITIAL_STATE.teamTree, { shape: TEAM_SHAPE })
/** The Teams tab's nodes the person opened or closed against their default (team.ts teamRows), by key: a press flips one. */
const teamToggled = atom({ plugin: 'teamrig-pane', key: 'teamToggled' } as const, INITIAL_STATE.teamToggled)
/** The Meetings view's list (meetings.ts) is kept under a shape tag too (see SNAPSHOT_SHAPE): bump it when MeetingsView or Meeting changes shape. */
const MEETINGS_SHAPE = 'meetings-v1'
const meetings = atom({ plugin: 'teamrig-pane', key: 'meetings' } as const, INITIAL_STATE.meetings, { shape: MEETINGS_SHAPE })
/** The Meetings view's meetings whose cards are open (meetings-rows.ts meetingKey), by key: a press on a row flips one. */
const meetingsOpen = atom({ plugin: 'teamrig-pane', key: 'meetingsOpen' } as const, INITIAL_STATE.meetingsOpen)
/** What the last run press on a meeting answered (meetings.ts): cleared at each session start and each switch to the view. */
const meetingAnswer = atom({ plugin: 'teamrig-pane', key: 'meetingAnswer' } as const, INITIAL_STATE.meetingAnswer)
/** The second line a meeting's card shows (Move, Postpone, Drop or End asked, meetings-rows.ts): cleared with the answer. */
const meetingAsked = atom({ plugin: 'teamrig-pane', key: 'meetingAsked' } as const, INITIAL_STATE.meetingAsked)
/** The Stats tab's numbers (stats-source.ts) are kept under a shape tag too (see SNAPSHOT_SHAPE): bump it when StatsView or the core's RegisterStats or RegisterHealth changes shape. */
const STATS_SHAPE = 'stats-v2'
const stats = atom({ plugin: 'teamrig-pane', key: 'stats' } as const, INITIAL_STATE.stats, { shape: STATS_SHAPE })
/** What the Stats tab folds (stats-source.ts): the whole tree until a press on its scope row picks a team or a session. */
const statsScope = atom({ plugin: 'teamrig-pane', key: 'statsScope' } as const, INITIAL_STATE.statsScope)
/** The days the Stats tab folds: the last 7 until a press on its range row picks others. */
const statsRange = atom({ plugin: 'teamrig-pane', key: 'statsRange' } as const, INITIAL_STATE.statsRange)
/** The Health count whose tasks the Stats tab lists in place of its numbers: none until a tile's press picks one, back clears it. */
const statsList = atom({ plugin: 'teamrig-pane', key: 'statsList' } as const, INITIAL_STATE.statsList)
/** The Teams tab row whose [Stats] opened the Stats tab, back's landing: none until such a press, and any view switch drops it. */
const statsFrom = atom({ plugin: 'teamrig-pane', key: 'statsFrom' } as const, INITIAL_STATE.statsFrom)
/** The Stats tab's sections the person opened or closed against their default (stats-rows.ts isSectionOpen), by key: a press on a header flips one. */
const statsToggled = atom({ plugin: 'teamrig-pane', key: 'statsToggled' } as const, INITIAL_STATE.statsToggled)
/** The Done page's days, groups and `n more` rows the person flipped against their default (done-rows.ts), by key. */
const doneToggled = atom({ plugin: 'teamrig-pane', key: 'doneToggled' } as const, INITIAL_STATE.doneToggled)
/** What the last press on a Teams tab session row ([Meet], [Wake]) answered (session-acts.ts): cleared at each session start and each switch to the tab. */
const sessionAnswer = atom({ plugin: 'teamrig-pane', key: 'sessionAnswer' } as const, INITIAL_STATE.sessionAnswer)
/** Where the owner's Note or Next on a task's card stands (owner-acts.ts): cleared at each session start. */
const ownerAct = atom({ plugin: 'teamrig-pane', key: 'ownerAct' } as const, INITIAL_STATE.ownerAct)

/** One key of the pane's state as the engine keeps it. */
type Cell<T> = { readonly read: () => Promise<T>; readonly update: (change: (current: T) => T) => Promise<T> }

/**
 * The pane's state as the engine keeps it, behind the store port (pane-store.ts) the pane's steps take. Each key names
 * its atom in its own read and update: the engine's scan reads a state call only when its atom is written there, never
 * one picked from a map or passed in. A top-level function, as the engine wants every function `$` is passed to.
 */
function atomStore($: Context): PaneStore {
  const cells: { readonly [K in PaneKey]: Cell<PaneState[K]> } = {
    snapshot: { read: () => read($, snapshot), update: change => update($, snapshot, change) },
    mode: { read: () => read($, mode), update: change => update($, mode, change) },
    expanded: { read: () => read($, expanded), update: change => update($, expanded, change) },
    tasksFolded: { read: () => read($, tasksFolded), update: change => update($, tasksFolded, change) },
    size: { read: () => read($, size), update: change => update($, size, change) },
    view: { read: () => read($, view), update: change => update($, view, change) },
    changes: { read: () => read($, changes), update: change => update($, changes, change) },
    known: { read: () => read($, known), update: change => update($, known, change) },
    diffs: { read: () => read($, diffs), update: change => update($, diffs, change) },
    copies: { read: () => read($, copies), update: change => update($, copies, change) },
    logList: { read: () => read($, logList), update: change => update($, logList, change) },
    logPage: { read: () => read($, logPage), update: change => update($, logPage, change) },
    previousConversation: { read: () => read($, previousConversation), update: change => update($, previousConversation, change) },
    requirements: { read: () => read($, requirements), update: change => update($, requirements, change) },
    filter: { read: () => read($, barFilter), update: change => update($, barFilter, change) },
    nav: { read: () => read($, nav), update: change => update($, nav, change) },
    pages: { read: () => read($, pages), update: change => update($, pages, change) },
    filePages: { read: () => read($, filePages), update: change => update($, filePages, change) },
    findField: { read: () => read($, findField), update: change => update($, findField, change) },
    ring: { read: () => read($, ring), update: change => update($, ring, change) },
    banner: { read: () => read($, bannerOpen), update: change => update($, bannerOpen, change) },
    previousOpen: { read: () => read($, previousOpen), update: change => update($, previousOpen, change) },
    setup: { read: () => read($, setup), update: change => update($, setup, change) },
    bodyScroll: { read: () => read($, bodyScroll), update: change => update($, bodyScroll, change) },
    teamTree: { read: () => read($, teamTree), update: change => update($, teamTree, change) },
    teamToggled: { read: () => read($, teamToggled), update: change => update($, teamToggled, change) },
    meetings: { read: () => read($, meetings), update: change => update($, meetings, change) },
    meetingsOpen: { read: () => read($, meetingsOpen), update: change => update($, meetingsOpen, change) },
    meetingAnswer: { read: () => read($, meetingAnswer), update: change => update($, meetingAnswer, change) },
    meetingAsked: { read: () => read($, meetingAsked), update: change => update($, meetingAsked, change) },
    sessionAnswer: { read: () => read($, sessionAnswer), update: change => update($, sessionAnswer, change) },
    ownerAct: { read: () => read($, ownerAct), update: change => update($, ownerAct, change) },
    stats: { read: () => read($, stats), update: change => update($, stats, change) },
    statsScope: { read: () => read($, statsScope), update: change => update($, statsScope, change) },
    statsRange: { read: () => read($, statsRange), update: change => update($, statsRange, change) },
    statsList: { read: () => read($, statsList), update: change => update($, statsList, change) },
    statsFrom: { read: () => read($, statsFrom), update: change => update($, statsFrom, change) },
    statsToggled: { read: () => read($, statsToggled), update: change => update($, statsToggled, change) },
    doneToggled: { read: () => read($, doneToggled), update: change => update($, doneToggled, change) },
  }
  return {
    read: key => cells[key].read(),
    update: (key, change) => cells[key].update(change),
  }
}

/** Moves the pane's focus ring onto the element keyed `key`; refused while the pane does not hold the keys, which leaves it where it was. */
async function focusOn($: Context, key: string): Promise<void> {
  await $.ui.focus({ requestId: PANE, key }).catch(() => undefined)
}

/**
 * The dock's focus ring as the pane's steps move it (steps.ts). A top-level function, as the engine wants every
 * function `$` is passed to.
 */
function ringOf($: Context): MoveFocus {
  return key => focusOn($, key)
}

/** The components spans draw with: each render hook passes those its surface resolved. */
type SpanComponents = Pick<Components, 'Text' | 'Link'>

const isPlain = (span: Span) =>
  span.color === undefined && span.bold !== true && span.dim !== true && span.underline !== true && span.href === undefined

/** One span as a Text in its own style. */
function styledSpan({ Text }: SpanComponents, span: Span, key?: string) {
  return (
    <Text key={key} color={themeOf(span.color)} bold={span.bold} dimColor={span.dim} underline={span.underline}>
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
      <Text key={key} wrap={wrap} color={themeOf(first.color)} bold={first.bold} dimColor={first.dim} underline={first.underline}>
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
  /** Keeps the copies the diffs of files written outside git are drawn against; set when the session starts. */
  let copying: LiveCopies | null = null
  /** Reads the Log view's list or page again while it shows; set when the session starts. */
  let logging: LiveLog | null = null
  /** Reads the area's previous conversation for the band until it settles; set when the session starts, null with no turn log. */
  let recalling: LivePrevious | null = null
  /** Reads the Teams tab's tree again while it shows; set when the session starts, null with no team. */
  let teaming: LiveTeam | null = null
  /** Reads the Meetings view's list again while it shows and starts a meeting on a press; set when the session starts, null with no team. */
  let scheduling: LiveMeetings | null = null
  /** Folds the Stats tab's numbers from the registers' history again while it shows; set when the session starts, null with no team or no register. */
  let tallying: LiveStats | null = null
  /** Runs the teamrig CLI on a Teams tab session row's press ([Meet], [Wake]); set when the session starts, null with no team. */
  let pressing: SessionActs | null = null
  /** Runs the owner's Note and Next on a task's card; set when the session starts, null with no team. */
  let acting: OwnerActs | null = null
  /** The snapshot drawn docked while the Note field is open: the one of its opening (note-hold.ts). */
  const noteHold = new NoteHold<Snapshot>()
  /** Looks for the register again while the project is not set up for teamrig; set when the session starts in one. */
  let watch: SetupWatch | null = null
  /** The tab title last asked for: `Tasks · 3 changed` (changes-rows.ts paneTitle). */
  let title = paneTitle(EMPTY_CHANGES)
  /**
   * What a task's refs and goals point at, for its card or its page. A failed read still opens it, its refs named
   * unquoted and its goals by id: the register's own fields are the rest of the card.
   */
  const detailOf = async (task: TaskRow): Promise<TaskDetail> => {
    const unquoted: TaskDetail = { ref: task.ref, quotes: [], goals: [] }
    return details === null ? unquoted : details.load(task).catch(() => unquoted)
  }
  /** A reference file as its page reads it (ref-file.ts). With no reader yet it says there was no folder to look in. */
  const readFile: ReadsFile = file => (refFiles === null ? Promise.resolve({ kind: 'missing', tried: [] }) : refFiles.read(file))
  /** The readers a view switch refreshes, as the session's start last set them: read at the press. */
  const livesNow = (): ViewLives => ({ sizer, tracked, logging, teaming, scheduling, tallying })

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: "Show this session's register tasks in the side pane",
      argumentHint: ARGUMENT_HINT,
    })
    live?.stop()
    tracked?.stop()
    logging?.stop()
    recalling?.stop()
    teaming?.stop()
    scheduling?.stop()
    tallying?.stop()
    watch?.stop()
    // A filter is a look for the moment, never kept: a new session, or a hot reload, lists every task again.
    await update($, barFilter, () => null)
    // A start's answer is to its press: a new session, or a hot reload, shows none.
    await update($, meetingAnswer, () => NO_MEETING_ANSWER)
    await update($, meetingAsked, () => NO_MEETING_ASKED)
    await update($, sessionAnswer, () => NO_ANSWER)
    await update($, ownerAct, () => NO_ACT)
    // Each run also ends by the pane's own clock (bounded-run.ts): one the engine never settles must not hold a reader's latch.
    const run = (argv: readonly string[], init: { readonly cwd?: string; readonly timeoutMs: number }): Promise<ProcessResult> =>
      bounded($.process.run(argv, init), init.timeoutMs, (ms, fn) => $.clock.every(ms, fn))
    const home =(await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
    // The teamrig CLI the Meetings view runs: the installed plugin's, else the teamrig command's on the PATH
    // (teamrig-cli.ts), found once. Windows may name the PATH `Path`.
    const cli = await findTeamrigCli(
      { exists: path => $.fs.exists(path), read: path => $.fs.read(path) },
      {
        configDir: await $.env.get('CLAUDE_CONFIG_DIR'),
        home,
        path: (await $.env.get('PATH')) ?? (await $.env.get('Path')),
      },
    )
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
    // The folders right under a folder: the kit home's teams, for a project teamrig is not set up for and for the Team
    // tab. A missing folder lists none (source.ts unlessMissing).
    const folders = async (path: string): Promise<string[]> => {
      const entries = await unlessMissing(() => $.fs.list(path), () => $.fs.exists(path), null)
      return entries === null ? [] : entries.filter(entry => entry.kind === 'dir').map(entry => entry.name)
    }
    /**
     * Reads the register `places` names, in place of any read before: its tasks, a task's refs and goals, the Log
     * view's turn logs and the Teams tab's team folders. Places with a problem show it in place of the tasks.
     */
    const bind = async (places: Exclude<Places, { kind: 'unset' }>): Promise<void> => {
      live?.stop()
      logging?.stop()
      recalling?.stop()
      teaming?.stop()
      scheduling?.stop()
      tallying?.stop()
      const registerAt: { paths: RegisterPaths; settings: TeamSettings } | { missing: string } =
        places.kind === 'found' ? { paths: registerPaths(places.dirs), settings: places.settings } : { missing: places.problem }
      const teamFiles = places.kind === 'found' ? places.team : null
      team = teamFiles === null ? null : { files, paths: teamFiles }
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
            : new TaskRegisterSource(
                files,
                registerAt.paths,
                registerAt.settings,
                teamFiles,
                new TreeGoals(files, registerAt.paths.goals, teamFiles),
                teamFiles === null ? NO_ELSEWHERE : new TreeRegisters(files, teamFiles, folders),
              ),
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
              shownPage: async () => {
                const page = await read($, logPage)
                return page === null ? null : { session: page.session, claude: page.claude }
              },
              publishList: async list => {
                await update($, logList, () => list)
              },
              publishPage: async page => {
                await update($, logPage, () => page)
              },
            })
      logging = logLive
      const previousLive =
        turnLog === null
          ? null
          : new LivePrevious({
              reader: new TurnLogReader(logFiles, turnLog),
              now: () => $.clock.now(),
              area: async () => (await read($, snapshot)).area,
              claude: () => $.session.id(),
              publish: async previous => {
                await update($, previousConversation, () => previous)
              },
            })
      recalling = previousLive
      if (logLive === null) {
        // No team, or one with no config file, which teamrig refuses and writes no turn log for: nothing to poll.
        await update($, logList, () => (team === null ? NO_TEAM_LOG : NO_CONFIG_LOG))
        await update($, logPage, () => AT_LOG_LIST)
        await update($, previousConversation, () => NO_PREVIOUS)
      }
      const teamLive =
        team === null
          ? null
          : new LiveTeam(
              files,
              team.paths,
              {
                folders,
                register: async () => {
                  const { tasks, ownerCards, taskCounts } = await read($, snapshot)
                  return { tasks, ownerCards, taskCounts }
                },
                isShown: async () => (await read($, view)) === 'team' && (await read($, size)) !== 'minimized',
                publish: async tree => {
                  await update($, teamTree, () => tree)
                },
                now: () => $.clock.now(),
              },
              'missing' in registerAt ? null : registerAt.paths,
            )
      teaming = teamLive
      if (teamLive === null) await update($, teamTree, () => NO_TEAM_TREE)
      // The CLI runs as the tab's session: its TEAMRIG_SESSION, else the area the pane shows.
      const meetingsLive =
        team === null
          ? null
          : new LiveMeetings(cli, {
              run: (argv, timeoutMs) => run(argv, { cwd: e.cwd, timeoutMs }),
              caller: async () => (await $.env.get('TEAMRIG_SESSION')) ?? (await read($, snapshot)).area,
              isShown: async () => (await read($, view)) === 'meetings' && (await read($, size)) !== 'minimized',
              publish: async shown => {
                await update($, meetings, () => shown)
              },
              clock: async () => clockOf({ now: await $.clock.now(), timeZone: (await read($, snapshot)).timeZone }),
              tell: async answer => {
                await update($, meetingAnswer, () => answer)
              },
              ask: async asked => {
                await update($, meetingAsked, () => asked)
              },
            })
      scheduling = meetingsLive
      if (meetingsLive === null) await update($, meetings, () => NO_TEAM_MEETINGS)
      // The own team's register, zone and owner's marker: the day and the owner's waits of every team the fold takes in.
      const statsLive =
        team === null || 'missing' in registerAt
          ? null
          : new LiveStats(
              files,
              team.paths,
              { events: registerAt.paths.events, goals: registerAt.paths.goals, zone: zoneNamed(registerAt.settings.timeZone), ownerMarker: registerAt.settings.ownerSource },
              {
                folders,
                isShown: async () => (await read($, view)) === 'stats' && (await read($, size)) !== 'minimized',
                choice: async () => ({ scope: await read($, statsScope), range: await read($, statsRange), list: await read($, statsList) }),
                publish: async shown => {
                  await update($, stats, () => shown)
                },
                now: () => $.clock.now(),
              },
            )
      tallying = statsLive
      if (statsLive === null) await update($, stats, () => NO_TEAM_STATS)
      // `teamrig meet` finds the team from the tab's folder, the team whose register the pane reads.
      pressing =
        team === null
          ? null
          : new SessionActs(cli, {
              run: (argv, timeoutMs) => run(argv, { cwd: e.cwd, timeoutMs }),
              tell: async answer => {
                await update($, sessionAnswer, () => answer)
              },
              now: () => $.clock.now(),
            })
      // `teamrig owner note` and `next` find the team from the tab's folder too.
      acting =
        team === null
          ? null
          : new OwnerActs(cli, {
              run: (argv, timeoutMs) => run(argv, { cwd: e.cwd, timeoutMs }),
              tell: async act => {
                await update($, ownerAct, () => act)
              },
              focus: key => focusOn($, key),
            })
      await started.refresh()
      started.startTimers((ms, fn) => $.clock.every(ms, fn))
      logLive?.startTimers((ms, fn) => $.clock.every(ms, fn))
      previousLive?.startTimers((ms, fn) => $.clock.every(ms, fn))
      teamLive?.startTimers((ms, fn) => $.clock.every(ms, fn))
      meetingsLive?.startTimers((ms, fn) => $.clock.every(ms, fn))
      statsLive?.startTimers((ms, fn) => $.clock.every(ms, fn))
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
    const git = (args: readonly string[], cwd: string) => run(['git', ...args], { cwd, timeoutMs: GIT_TIMEOUT_MS })
    const knownAtStart = knownSeed(seed, kept)
    // The copies ask the changes whether a file is outside git only from a write's hook, which waits for `copying`.
    const copiesLive = new LiveCopies(
      {
        files,
        isOutsideGit: path => changesLive.isOutsideGit(path),
        publish: async kept => {
          await update($, copies, () => kept)
        },
      },
      { copies: await read($, copies), outside: knownAtStart.outside },
    )
    const diffsLive = new LiveDiffs(
      {
        git,
        outside: path => copiesLive.diff(path),
        publish: async opened => {
          await update($, diffs, () => opened)
        },
      },
      { diffs: await read($, diffs), changes: seed },
    )
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
        // The copies of files no longer listed go first.
        onRead: async fresh => {
          await copiesLive.keep(fresh.outside)
          await diffsLive.refresh(fresh)
        },
      },
      knownAtStart,
    )
    // Set only once all three exist: the hooks, presses and timers reach them through these, never half made.
    copying = copiesLive
    diffing = diffsLive
    tracked = changesLive
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
      recalling = null
      teaming = null
      scheduling = null
      tallying = null
      pressing = null
      acting = null
      await update($, logList, () => NO_TEAM_LOG)
      await update($, logPage, () => AT_LOG_LIST)
      await update($, previousConversation, () => NO_PREVIOUS)
      await update($, teamTree, () => NO_TEAM_TREE)
      await update($, meetings, () => NO_TEAM_MEETINGS)
      await update($, stats, () => NO_TEAM_STATS)
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
    void requirementProblems([claudeCodeCheck(() => $.session.version()), gitCheck(() => run(['git', '--version'], { timeoutMs: GIT_TIMEOUT_MS }))])
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
    if (command.kind === 'mode') await showMode(atomStore($), command.mode)
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
  // Ahead of the write, a file outside git has its copy kept (outside-copies.ts), so its diff has a before;
  // after it, a copy taken for a write that never landed is dropped.
  const written = async (path: string, run: () => Promise<ToolResult>): Promise<ToolResult> => {
    await copying?.before(path)
    let ran: ToolResult
    try {
      ran = await run()
    } catch (error) {
      // It may have written before it failed: counted as written, the copy goes once the file is not listed.
      void copying?.after(path, true)
      throw error
    }
    const isWritten = ran.deny === undefined && ran.isError !== true
    void copying?.after(path, isWritten)
    if (isWritten) void tracked?.noteWrite(path)
    return ran
  }
  on('tool.call', { tool: 'Edit' }, ($, e, next) => written(e.file_path, () => next(e))).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'Write' }, ($, e, next) => written(e.file_path, () => next(e))).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'NotebookEdit' }, ($, e, next) => written(e.notebook_path, () => next(e))).catch(($, e, next) =>
    next(e),
  )
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
    /** The dock's state and its focus ring, as the pane's steps take them (steps.ts). */
    const store = atomStore($)
    const moveFocus = ringOf($)
    const inline = e.props.placement === 'inline'
    const columns = e.props.bodyColumns - 2 * PAD_COLUMNS
    // What this drawing shows, read as every front end reads it (screen.ts): a read or a layout that throws comes
    // back as one error line for a body, never a throw the engine would answer by skipping this hook.
    const screen = await screenOf(store, {
      inline,
      columns,
      bodyRows: e.props.scroll.bodyRows,
      canAct: acting !== null,
      isHeld: e.props.isFocused,
      memo: keysMemo,
      noteHold,
      wraps,
      hostOld: claudeCodeOldLine,
      tieHint: TIE_HINT,
      keys: KEYS_WORDS,
    })
    keysMemo = screen.memo
    const { current, snap, at, scroll, body } = screen

    // What a press runs over (press.ts): the tasks, view and place this drawing shows; the readers are those held when
    // it is pressed, which a team found since this drawing may have set.
    const pressDeps = (): PressDeps => ({
      store,
      snap,
      shown: current,
      place: currentPlace(at),
      focus: moveFocus,
      detailOf,
      readFile,
      lives: livesNow(),
      logging,
      diffing,
      pinning: live,
      scheduling,
      pressing,
      acting,
    })
    // A press in the head or the body.
    const run = (press: Press) => runPress(press, pressDeps())

    const spanComponents = { Text, Link }
    const styled = (span: Span, key?: string) => styledSpan(spanComponents, span, key)
    const drawText = (spans: readonly Span[], wrap: Drawn['wrap'], key?: string) => drawSpans(spanComponents, spans, wrap, key)
    /** A press in a card (a task id, a reference file): its text underlined, in its span's style. */
    const drawPress = (span: Span, key: string) => (
      <Text key={key} underline color={themeOf(span.color)} bold={span.bold} dimColor={span.dim}>
        {span.text}
      </Text>
    )
    /**
     * A card's lines with no press as one Text; a line with one as a row of its pieces, each id a press that opens
     * its page, keyed `goto:<id>:`, each reference file one that opens the file's, keyed `goto:file:`, an inbox count
     * one that opens the inbox's, keyed `goto:inbox:`, each Teams tab key one that opens or closes it in its span's
     * style, keyed `team:`, each session of a tab tied to none one that ties the tab to it as `/teamrig-pane
     * <session>` does, keyed `pin:`, a meeting card's press one that asks, closes or runs its act, keyed `meeting:`, a Team
     * tab session row's [Meet] or [Wake] one that runs `teamrig meet` or `teamrig owner wake` on its session, keyed
     * `<act>:<team>/<session>:`, then
     * where it is drawn (`from`, the card's element); a Changes file's row one press that opens or closes its diff, keyed `diff:`, then where it is
     * drawn and the row; a task card's owner act (Note, Next, Send, Cancel, Confirm) one press keyed `act:`, the task's
     * Note field an Input keyed `note:`, each by its task alone (press-keys.ts). The field draws no value, ever: the
     * engine drops typed text when the drawn value changes, so what is typed stays with the acts.
     */
    const drawPart = (part: CardPart, wrap: Drawn['wrap'], from: string) => {
      if (part.kind === 'text') return drawText(part.spans, wrap, part.key)
      if (part.kind === 'press')
        return (
          <Button key={diffKey(from, part.key)} plain onPress={() => void run(pressOfPart(part))}>
            {drawText(part.spans, wrap)}
          </Button>
        )
      if (part.kind === 'field') {
        const { task, round } = part.field
        return (
          <components.Input
            key={noteKey(task, round)}
            placeholder={`a Note to ${task}'s session`}
            value=""
            submitLabel="Send"
            onInput={text => acting?.typed(text)}
            onSubmit={text => void acting?.sendNote(task, text)}
          />
        )
      }
      return (
        <Box key={part.key} flexDirection="row">
          {part.pieces.map((piece, i) => {
            if (piece.kind === 'words') return drawText(piece.spans, wrap, String(i))
            const press = pressOfPiece(piece, from)
            return (
              <Button key={pieceKey(piece, from, part.key, i)} plain onPress={() => void run(press)}>
                {piece.kind === 'toggle' ? styled(piece.span) : drawPress(piece.span, piece.kind === 'session-act' ? piece.sessionAct.act : piece.kind)}
              </Button>
            )
          })}
        </Box>
      )
    }
    // A block's first Text: a press when the drawing names one for it (press.ts pressOfDrawn: its task's card or page,
    // a conversation's Log page, a fold, a Changes file's diff), else words alone.
    const drawBlockHead = (drawn: Drawn) => {
      const press = pressOfDrawn(drawn)
      if (press === null) return drawText(drawn.spans, drawn.wrap, drawn.key)
      return (
        <Button key={drawn.key} plain onPress={() => void run(press)}>
          {drawText(drawn.spans, drawn.wrap)}
        </Button>
      )
    }
    // A Button holds strings and Texts alone, so an open card (its links, its ids) draws under the task's Button, not
    // in it. A page's title is no press: its card is always open. An element drawn as parts (a Teams tab leader, its
    // fold mark and id presses) is a column Box of them and its open card's, under its key.
    const drawBlock = (drawn: Drawn) => {
      if (drawn.parts !== undefined)
        return (
          <Box key={drawn.key} flexDirection="column">
            {[...drawn.parts, ...(drawn.card ?? [])].map(part => drawPart(part, drawn.wrap, drawn.key))}
          </Box>
        )
      const head = drawBlockHead(drawn)
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
    // apart (a joined one right under the last), and the engine's window scrolls the pane as one.
    // A drawing with no window of its own: the engine's window takes the scrolls, and every press is drawn in it.
    const drawnWithoutWindow = () => {
      lastView = null
      lastPlaces = []
    }
    const drawFlat = (header: readonly HeaderPart[], gap: number) => {
      drawnWithoutWindow()
      const places = placesOf(body, gap)
      return (
        <Box flexDirection="column" paddingX={PAD_COLUMNS} gap={gap}>
          {header.map(part => part.node)}
          {body.length === 0 ? null : (
            <Box key="body" flexDirection="column">
              {frameOf(places, viewOf(places, 0, Number.POSITIVE_INFINITY)).map(drawSlot)}
            </Box>
          )}
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

    // The head of this drawing as every front end reads it (head.ts): what it holds, in which rows, and what each
    // press does are data, and the dock only draws them, each element under the key head.ts names. The rows that wrap
    // come packed (pack.ts), each a column Box under its key of one row Box a row, keyed `<key>:<row>`: the rows drawn
    // are the rows counted (headRows), so the body's window can take the rows the header leaves (T860).
    const head = headOf(screen, { inline, columns, isHeld: e.props.isFocused, keys: KEYS_WORDS })
    /** Words that are no press: a Text, so they hold no place in the focus ring. */
    const drawWords = (item: HeadWords) => {
      const tone = item.tone === 'bold' ? { bold: true } : { dimColor: true }
      const cut = item.cut ? { wrap: 'truncate-end' as const } : {}
      return (
        <Text key={item.key} {...tone} {...cut}>
          {item.text}
        </Text>
      )
    }
    const drawButton = (item: HeadButton) => {
      const look = item.look === 'plain' ? { plain: true } : { variant: item.look }
      const hotkey = item.hotkey === null ? {} : { hotkey: item.hotkey }
      return <Button key={item.key} label={item.label} {...look} {...hotkey} onPress={() => void run(item.press)} />
    }
    const drawItem = (item: HeadItem) => {
      if (item.kind === 'words') return drawWords(item)
      if (item.kind === 'button') return drawButton(item)
      // A place of a trail: a plain Button holds only strings and Text, so its underline is a Text in it.
      return (
        <Button key={item.key} plain onPress={() => void run(item.press)}>
          <Text underline dimColor={item.isAhead}>
            {item.label}
          </Text>
        </Button>
      )
    }
    // A count of the status bar draws its key before it (`o: `), then its glyph in the color its rows wear it in, which
    // the bar counts in its widths (status-bar.ts drawnText): one Text holding both, as a plain Button holds only
    // strings and Text.
    const drawBarPiece = (piece: BarPiece) => {
      const press = pressOfBar(piece)
      if (press === null) return styled(piece, piece.key)
      const text =
        piece.mark === null ? (
          styled(piece)
        ) : (
          <Text>
            {styled(piece.mark, 'mark')} {styled(piece, 'text')}
          </Text>
        )
      return piece.hotkey === null ? (
        <Button key={piece.key} plain onPress={() => void run(press)}>
          {text}
        </Button>
      ) : (
        <Button key={piece.key} plain hotkey={piece.hotkey} onPress={() => void run(press)}>
          {text}
        </Button>
      )
    }
    const drawHeadPiece = (piece: HeadPiece) => {
      switch (piece.kind) {
        case 'text':
          return drawText(piece.spans, 'truncate-end', piece.key)
        case 'packed':
          return (
            <Box key={piece.key} flexDirection="column">
              {piece.rows.map((row, i) => (
                <Box key={`${piece.key}:${i}`} flexDirection="row" columnGap={piece.gap}>
                  {row.map(drawItem)}
                </Box>
              ))}
            </Box>
          )
        case 'row':
          return (
            <Box flexDirection="row" columnGap={piece.gap}>
              {piece.items.map(drawItem)}
            </Box>
          )
        case 'item':
          return drawItem(piece.item)
        case 'find': {
          // The field is drawn under its round's key, holding what the round started with, never the person's typing,
          // which the engine would drop on each redraw; it never takes the focus by itself, as it would then hold
          // every key the pane's hotkeys answer (find-field.ts). Enter runs on the words as typed: a redraw may lag
          // behind them.
          const { find } = piece
          const { submits } = find
          return drawFindRow(components, {
            key: find.key,
            placeholder: find.placeholder,
            text: find.text,
            submitLabel: find.submitLabel,
            onFind: () => void run({ kind: 'find' }),
            onInput: value => void typeFind(store, value),
            onSubmit: value => void (submits === null ? undefined : submitFind(submits, value, pressDeps())),
            onClear: find.clears ? () => void run({ kind: 'find-clear' }) : null,
          })
        }
        case 'keys':
          return drawKeysLine(components, piece.at, piece.lines.join('\n'))
        case 'rule':
          return <Text dimColor>{'─'.repeat(piece.cells)}</Text>
        case 'bar':
          return (
            <Box key="status-bar" flexDirection="column">
              {piece.lines.map((line, i) => (
                <Box key={`status-bar:${i}`} flexDirection="row">
                  {line.map(drawBarPiece)}
                </Box>
              ))}
            </Box>
          )
      }
    }
    const drawHeadPart = (part: HeadPart): HeaderPart => ({
      node:
        part.kind === 'group' ? (
          <Box key={part.key} flexDirection="column">
            {part.pieces.map(drawHeadPiece)}
          </Box>
        ) : (
          drawHeadPiece(part)
        ),
      rows: headRows(part),
    })
    const header = head.parts.map(drawHeadPart)
    // Minimized, the switch is the whole pane, and a press on any of its buttons opens the pane in full on that view.
    if (head.strip) {
      drawnWithoutWindow()
      return <Box paddingX={PAD_COLUMNS}>{header.map(part => part.node)}</Box>
    }
    return drawPane(header)
  })

  /** The banner's own: each layout settles its cache, so one shared with the pane's body would drop its rows. */
  const bannerWraps = new WrapCache()
  /** The previous conversation's row's own, for the same reason. */
  const previousWraps = new WrapCache()
  // The band above the prompt (AbovePrompt): the banner (banner.ts), the task the session works on now, one press that
  // opens its card and a second that closes it, wrapped at the band's width. A survey takes the band, and a session
  // with no area draws none, so a session outside a team gets no band from the pane. The engine scrolls a card
  // taller than the band and folds the band from its [-] (ctrl+x ctrl+a), a mark no mod can hide. With a current task,
  // a button at the band's right end, beside that [-], opens the pane at its page (T775). Over the banner, the area's
  // previous conversation (previous-conversation.ts) in a dim frame, so it never reads as the banner: a head row with a
  // dim `previous conversation` label that names it (T2355), a button that opens its page and one the list of
  // conversations (T2249), then its title at the frame's whole width; none when the turn log holds none. A press on its
  // title opens and closes it as the banner's does (T2302). No press has a hotkey: a band's hotkey answers a bare key
  // typed in an empty prompt.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const snap = await read($, snapshot)
    if (snap.area === null) return next(e)
    const { Box, Button, Text, Link } = $.ui.resolve(e)
    const tree = treeOf(snap)
    const isOpen = await read($, bannerOpen)
    const name = sessionName(snap.area, snap.areaName)
    const current = currentTask(snap, tree)
    // The open button and the gap before it take their cells from the banner's width.
    const openCells = current === null ? 0 : buttonCells({ label: BANNER_OPEN_LABEL, plain: false, hotkey: null }) + 1
    const [banner] = dockLayout([bannerBlock(current, isOpen, tree, name)], e.props.bodyColumns - openCells, bannerWraps)
    if (banner === undefined) return next(e)
    const press = (
      <Button key={BANNER_KEY} plain onPress={() => void toggleBanner(atomStore($))}>
        {drawSpans({ Text, Link }, banner.spans, banner.wrap)}
      </Button>
    )
    // Opens the pane as /teamrig-pane does, minimized or never opened too, at the task's page over the list at the
    // task's row (presses.ts openTask): back shows the list scrolled to it.
    const openInPane = async (shown: Current) => {
      await sizer?.set('open')
      await $.ui.open({ id: PANE, title, columns: DOCK_COLUMNS })
      await openTask(atomStore($), shown, detailOf)
    }
    // The banner's Box takes the columns the banner leaves free, so the button ends the row, beside the engine's [-].
    const bannerRow =
      current === null ? (
        <Box>{press}</Box>
      ) : (
        <Box flexDirection="row" columnGap={1}>
          <Box key={BANNER_FILL_KEY} flexGrow={1}>
            {press}
          </Box>
          <Button key={BANNER_OPEN_KEY} label={BANNER_OPEN_LABEL} variant="secondary" onPress={() => void openInPane(current)} />
        </Box>
      )
    const previous = await read($, previousConversation)
    if (previous === null) return bannerRow
    // Its buttons sit on the head row, so its title takes the frame's whole inner width.
    const isPreviousOpen = await read($, previousOpen)
    const previousColumns = e.props.bodyColumns - PREVIOUS_FRAME_CELLS
    const [line] = dockLayout([previousBlock(previous, snap, isPreviousOpen, clockOf(snap))], previousColumns, previousWraps)
    if (line === undefined) return bannerRow
    // Opens the pane as /teamrig-pane does on the list of conversations, and with `conversation` at its page.
    const openConversations = async (conversation: LogRead | null) => {
      await switchView(atomStore($), 'log', livesNow())
      await $.ui.open({ id: PANE, title, columns: DOCK_COLUMNS })
      if (conversation !== null) await openConversation(atomStore($), conversation, logging)
    }
    const shown: LogRead = { session: previous.session, claude: previous.claude }
    return (
      <Box flexDirection="column">
        <Box key={PREVIOUS_FRAME_KEY} flexDirection="column" borderStyle="round" borderDimColor paddingX={PREVIOUS_FRAME_PADDING}>
          <Box key={PREVIOUS_HEAD_KEY} flexDirection="row" columnGap={1}>
            <Box flexGrow={1}>
              <Text dimColor>{PREVIOUS_LABEL}</Text>
            </Box>
            <Button key={PREVIOUS_OPEN_KEY} label={BANNER_OPEN_LABEL} variant="secondary" onPress={() => void openConversations(shown)} />
            <Button key={PREVIOUS_ALL_KEY} label={PREVIOUS_ALL_LABEL} variant="secondary" onPress={() => void openConversations(null)} />
          </Box>
          <Box key={PREVIOUS_KEY}>
            <Button key={PREVIOUS_PRESS_KEY} plain onPress={() => void togglePrevious(atomStore($))}>
              {drawSpans({ Text, Link }, line.spans, line.wrap)}
            </Button>
          </Box>
        </Box>
        {bannerRow}
      </Box>
    )
  })
}
