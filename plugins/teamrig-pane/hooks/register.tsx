// teamrig-pane: docks this session's list from the task register (where it is: places.ts) on the right
// of the fullscreen UI. `mine` shows the session's area: a status bar of its tasks (status-bar.ts),
// then its tasks in sections (rows.ts): Verifying, Working on, Up next, Waiting (its waiting tasks, then
// those asked of another session) and Done today (the UTC day, as the bar counts it), each task a row with a
// dim meta line (meta.ts), and its unread inbox lines; `all` shows every owner's active tasks. A press on a task row opens its card in
// place of the meta line (card.ts): its status and note, plan, the ask quoted where its refs still point, who
// asked, the tasks planned first, its goals' roadmap items, evidence and links. A press on a task id in a card opens
// that task's page (page.ts), the card with the body to itself, under back and forward (b, f) and a trail of the
// last places (nav.ts), which the list keeps while a page lies ahead of it; a page opens at its top, and a return
// to the list scrolls back to the card it left. `Find` (s) moves the keys into the Find field, which shows the tasks
// the pane holds that its words match (search.ts), the matched words underlined, each result a press that opens its
// page, Enter the top one's, back returning to the results; emptying the field or clear closes it. A line under the
// field says where the keys go (find-field.ts). The close mark (✕, ctrl+x x) minimizes it to a one-row strip
// instead of closing it; a press on the strip or /teamrig-pane opens it again, and the size is kept for the next
// session (size.ts). A switch row, first in every
// state and width, the strip included, flips the body between the tasks and the Changes view: the
// files changed in the git repos the session works in and their lines (changes.ts), counted as Δn on
// the switch and in the tab title. The band above the prompt shows the task the session works on now
// (banner.ts), a press opening its card, whether the pane is open, minimized or never drawn. Reads
// files and runs git (status, diff, grep; no model calls); /teamrig-pane steers it.
import { atom, read, update } from 'claude-code'
import type { Components, Context, Register } from 'claude-code'
import type {
  BarStatus,
  ExpandedTasks,
  FilePages,
  FindField,
  Nav,
  PageDetails,
  PaneView,
  RefFile,
  RefFileRead,
  RequirementProblem,
  RingLandings,
  Snapshot,
  TaskDetail,
  TaskRow,
  ViewMode,
} from '../types'
import { ARGUMENT_HINT, COMMAND, inlineReason, parsePaneArgs } from './command'
import { LiveRegister, pinKey } from './live'
import { findPlaces, type PlacesEnv } from './places'
import { findSession, type TeamLookup } from './sessions'
import { TaskDetails, type RefPlaces } from './details'
import { RefFileReader } from './ref-file'
import { TaskRegisterSource, registerPaths, unlessMissing, type Files } from './source'
import { WrapCache, dockLayout, failedDrawing, inlineLayout, wrapRow, type CardPart, type Drawn } from './layout'
import { windowed, type Slot } from './window'
import { BANNER_KEY, bannerBlock, currentTask } from './banner'
import { NOTHING_EXPANDED, paneBlocks, type Span } from './rows'
import { inlineBarRows, statusBar, type BarPiece } from './status-bar'
import { PaneSizer, SIZE_KEY } from './size'
import { isGitMissing, requirementBlocks, requirementProblems } from './requirements'
import { EMPTY_CHANGES, knownOf, knownSeed, LiveChanges, NOTHING_KNOWN } from './changes'
import { changesBlocks, changesLabel, paneTitle } from './changes-rows'
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
import { weekSteps, weekOf } from './done'
import { doneBlocks, weekWords } from './done-rows'
import { treeOf } from './meta'
import { filePageBlocks, lineBlockKey } from './file-page'
import { pageBlocks } from './page'
import { searchTasks, topResult } from './search'
import { searchBlocks } from './search-rows'
import { FIRST_FIELD, FIRST_MEMO, NO_LANDINGS, drawnWith, fieldAfter, fieldKey, keysAt, keysHint, landedOn, type KeysAt } from './find-field'

const PANE = 'teamrig-pane'
/** The dock width it asks for: an id, priority, due and a 40-column title line, inside the padding. */
const DOCK_COLUMNS = 58
/** Columns of space between the pane's frame and its text, each side. */
const PAD_COLUMNS = 1
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
const EMPTY_SNAPSHOT: Snapshot = { tasks: [], area: null, areaSource: null, unreadInbox: null, problem: null, now: 0 }
/**
 * The tag the snapshot is kept under. $.state outlives a hot reload, so without it a new pane would
 * draw the snapshot the old code wrote, rows missing the fields it now reads; under another tag that
 * value reads as absent (the empty snapshot, until the reload's first poll). Bump it whenever the
 * Snapshot or TaskRow type in ../types changes shape.
 */
const SNAPSHOT_SHAPE = 'register-v4'
const snapshot = atom({ plugin: 'teamrig-pane', key: 'snapshot' } as const, EMPTY_SNAPSHOT, { shape: SNAPSHOT_SHAPE })
const mode = atom({ plugin: 'teamrig-pane', key: 'mode' } as const, 'mine')
/** The open cards are kept under a shape tag too (see SNAPSHOT_SHAPE): bump it when TaskDetail changes shape. */
const CARDS_SHAPE = 'cards-v1'
const expanded = atom({ plugin: 'teamrig-pane', key: 'expanded' } as const, NOTHING_EXPANDED, { shape: CARDS_SHAPE })
const size = atom({ plugin: 'teamrig-pane', key: 'size' } as const, 'open')
const view = atom({ plugin: 'teamrig-pane', key: 'view' } as const, 'tasks')
/** The changes are kept under a shape tag too (see SNAPSHOT_SHAPE): bump it when ChangesSnapshot changes shape. */
const CHANGES_SHAPE = 'changes-v2'
const changes = atom({ plugin: 'teamrig-pane', key: 'changes' } as const, EMPTY_CHANGES, { shape: CHANGES_SHAPE })
/**
 * The repo roots and outside files found, kept apart from the drawn changes: a version that bumps
 * CHANGES_SHAPE reads the drawn ones as absent after a hot reload, and would forget every repo the
 * session found. Bump KNOWN_SHAPE only when KnownChanges itself changes.
 */
const KNOWN_SHAPE = 'known-v1'
const known = atom({ plugin: 'teamrig-pane', key: 'known' } as const, NOTHING_KNOWN, { shape: KNOWN_SHAPE })
const NOTHING_MISSING: RequirementProblem[] = []
/** What the pane lacks (requirements.ts); each session start checks again and writes it anew, a hot reload's too. */
const requirements = atom({ plugin: 'teamrig-pane', key: 'requirements' } as const, NOTHING_MISSING)
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
/** The focus ring's landings in the pane (find-field.ts), counted by the ui.focus hook. */
const ring = atom({ plugin: 'teamrig-pane', key: 'ring' } as const, NO_LANDINGS)
/** The key of the pane element the focus ring last landed on, null for none or an engine stop: a windowed body (window.ts) always draws it. */
const held = atom({ plugin: 'teamrig-pane', key: 'held' } as const, null)
/** Whether the banner (banner.ts) in the band above the prompt shows its task's card: a press on it opens and closes it. */
const bannerOpen = atom({ plugin: 'teamrig-pane', key: 'banner' } as const, false)

/** The key of an open card's element: `from` for the presses on the task ids in it. */
function openKey(key: string): string {
  return `${key}-open`
}

/** True when the element keyed `key` is drawn in `drawn`: its press, its open card, or a press on a task id in the card. */
function isDrawnIn(drawn: Drawn, key: string): boolean {
  const open = openKey(drawn.key)
  return key === drawn.key || key === open || (key.startsWith('goto:') && key.includes(`:${open}:`))
}

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
 * brings the element the page was opened from to the middle of the window; a refused or failed scroll (an engine
 * without `$.ui.scroll` among them) leaves the window where it is.
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
 * Moves the pane's window to the top, brings the element a landing names to its middle, or a file page's line to the
 * window's top by the paragraph that holds it (file-page.ts), the page's top when none does.
 */
async function scrollTo($: Context, to: Landing): Promise<void> {
  const key = to.kind === 'top' ? null : to.kind === 'row' ? to.key : lineBlockKey(to, (await read($, filePages))[to.file])
  await $.ui.scroll(key === null ? { to: 'start', in: PANE } : { to: { key }, in: PANE, block: to.kind === 'line' ? 'start' : 'center' })
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
    const places = await findPlaces({ env, files, home: home ?? null, cwd: e.cwd })
    const paths = places.found ? registerPaths(places.dirs) : { missing: places.problem }
    team = places.found && places.team !== null ? { files, paths: places.team } : null
    const refPlaces: RefPlaces = {
      inboxDir: 'missing' in paths ? null : paths.inboxDir,
      home: home ?? null,
      cwd: e.cwd,
      teamDir: places.found && places.team !== null ? places.team.dir : null,
      goalsDoc: places.goalsDoc,
    }
    details = new TaskDetails(files, refPlaces)
    refFiles = new RefFileReader(files, refPlaces)
    const started = new LiveRegister({
      source: 'missing' in paths ? paths : new TaskRegisterSource(files, paths, places.found ? places.priorities : []),
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
    const changesLive = new LiveChanges(
      {
        git: (args, cwd) => $.process.run(['git', ...args], { cwd, timeoutMs: GIT_TIMEOUT_MS }),
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
      },
      knownSeed(seed, kept),
    )
    tracked = changesLive
    await started.refresh()
    started.startTimers((ms, fn) => $.clock.every(ms, fn))
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
  // collapses the task. Docked, the root's gap spaces the blocks and its padding the frame, and only the blocks
  // near the window are drawn (window.ts), each run of the others one empty Box of their rows.
  // Each landing of the pane's focus ring the engine let through is counted, the line under the Find field reading
  // where the keys go from it (find-field.ts), and the element it landed on kept, which a windowed body draws
  // wherever the window is. A failed count lets the ring move as it would have.
  on('ui.focus', { requestId: PANE }, async ($, e, next) => {
    const moved = await next(e)
    if (moved.deny === undefined) {
      await update($, ring, current => landedOn(current, e.element))
      await update($, held, () => e.element ?? null)
    }
    return moved
  }).catch(($, e, next) => next(e))

  /** Where the keys were as the pane last drew (find-field.ts): every drawing updates it, whatever it shows. */
  let keysMemo = FIRST_MEMO
  /** The rows the last docked layout wrapped: a drawing re-wraps only the rows that changed since. */
  const wraps = new WrapCache()
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link, Input } = $.ui.resolve(e)
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
    let heldKey: string | null = null
    let body: Drawn[] = []
    /** The status bar's lines over the area's tasks (status-bar.ts); none outside the mine tasks view. */
    let barLines: BarPiece[][] = []
    const columns = e.props.bodyColumns - 2 * PAD_COLUMNS
    try {
      landings = await read($, ring)
      heldKey = await read($, held)
      keysMemo = drawnWith(keysMemo, e.props.isFocused, landings)
      isMinimized = (await read($, size)) === 'minimized'
      current = await read($, view)
      changed = await read($, changes)
      if (!isMinimized) {
        snap = await read($, snapshot)
        shown = await read($, mode)
        open = await read($, expanded)
        const missing = await read($, requirements)
        if (current === 'tasks' && !inline) {
          at = await read($, nav)
          files = await read($, filePages)
          field = await read($, findField)
        }
        const place = currentPlace(at)
        // A page has no status bar: the bar counts the list, and a press on it filters the list.
        const bar = current === 'tasks' && shown === 'mine' && place.kind === 'list' ? statusBar(snap, await read($, barFilter), columns) : null
        // With no bar there is nothing to filter by, and the list shows every task.
        const tasksBlocks =
          place.kind === 'task'
            ? pageBlocks(snap, shown, place.id, await read($, pages))
            : place.kind === 'search'
              ? searchBlocks(snap, place.query)
              : place.kind === 'done'
                ? doneBlocks(snap, shown, place.week)
                : place.kind === 'file'
                  ? filePageBlocks({ file: place.file, line: place.line }, files[place.file])
                  : paneBlocks(snap, shown, open, bar?.filter ?? null)
        const viewBlocks = current === 'tasks' ? tasksBlocks : changesBlocks(changed, isGitMissing(missing))
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
    // A press on a reference file opens its page, read once as it opens (ref-file.ts); from the list, the list
    // remembers `from` as openPage's does. With no reader yet the page says there was no folder to look in.
    const openFile = async (file: RefFile, from: string) => {
      const found: RefFileRead = refFiles === null ? { kind: 'missing', tried: [] } : await refFiles.read(file.file)
      await update($, filePages, current => ({ ...current, [file.file]: found }))
      await go($, current => pushed(leavingList(current, from), { kind: 'file', file: file.file, line: file.line }))
    }
    // Enter in the Find field opens the top result's page, the first active match, else the newest finished one, and
    // moves the ring onto the page's back step: left in the field, a new round's and empty, it would type the next
    // keys into a new search, so b, f and s would never answer.
    const openTop = async (query: string) => {
      const top = topResult(searchTasks(snap.tasks, query, treeOf(snap.tasks, snap.now)))
      if (top === null) return
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
     * its page, keyed `goto:<id>:`, each reference file one that opens the file's, keyed `goto:file:`, then where it
     * is drawn (`from`, the card's element).
     */
    const drawPart = (part: CardPart, wrap: Drawn['wrap'], from: string) => {
      if (part.kind === 'text') return drawText(part.spans, wrap, part.key)
      return (
        <Box key={part.key} flexDirection="row">
          {part.pieces.map((piece, i) => {
            switch (piece.kind) {
              case 'words':
                return drawText(piece.spans, wrap, String(i))
              case 'id':
                return (
                  <Button key={`goto:${piece.task}:${from}:${part.key}:${i}`} plain onPress={() => void openPage(piece.task, from)}>
                    {drawPress(piece.span, 'id')}
                  </Button>
                )
              case 'file':
                return (
                  <Button key={`goto:file:${from}:${part.key}:${i}`} plain onPress={() => void openFile(piece.file, from)}>
                    {drawPress(piece.span, 'file')}
                  </Button>
                )
            }
          })}
        </Box>
      )
    }
    // A block's first Text: a press that opens its task's card (`toggle`) or page (`opens`, a search result), else
    // words alone.
    const headOf = (drawn: Drawn) => {
      const id = drawn.toggle
      const opens = drawn.opens
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
    // The key of the element a step lands on: back to the list, or into a file's page at its line.
    const listed = currentPlace(at)
    const landingKey =
      listed.kind === 'list' ? listed.row : listed.kind === 'file' ? lineBlockKey({ file: listed.file, line: listed.line }, files[listed.file]) : null
    // A Button holds strings and Texts alone, so an open card (its links, its ids) draws under the task's Button, not
    // in it. A page's title is no press: its card is always open. A Text keeps no key (the engine keeps a Box's and
    // a Button's), so the block a step lands on, when it is words alone (a file page's paragraph), draws in a Box
    // under its key for `$.ui.scroll` to find.
    const drawBlock = (drawn: Drawn) => {
      const head = headOf(drawn)
      if (drawn.card === undefined) {
        if (drawn.key !== landingKey || drawn.toggle !== null || drawn.opens !== undefined) return head
        return (
          <Box key={drawn.key} flexDirection="column">
            {head}
          </Box>
        )
      }
      const from = openKey(drawn.key)
      return (
        <Box key={from} flexDirection="column">
          {head}
          {drawn.card.map(part => drawPart(part, drawn.wrap, from))}
        </Box>
      )
    }
    // Docked, the body is drawn windowed (window.ts): the elements near what the person sees, the one the keys are
    // on and the one a step lands on, each run of the others one empty Box of their rows.
    const bodyWindow = {
      offset: e.props.scroll.offset,
      bodyRows: e.props.scroll.bodyRows,
      gap: 1,
      isAnchor: (drawn: Drawn) => [heldKey, landingKey].some(key => key !== null && isDrawnIn(drawn, key)),
    }
    const drawSlot = (slot: Slot) => (slot.kind === 'drawn' ? drawBlock(slot.drawn) : <Box key={slot.key} height={slot.rows} />)

    // The switch: first in every state, so the other view is always one press (or t / d) away, its
    // buttons wrapping under each other in a dock too narrow for both. Minimized, it is the whole
    // pane, one row, and a press on either button opens the pane in full on that view.
    // The Tasks button shows the list, from a page too, scrolled back to where the page was opened from.
    const switchTo = async (target: PaneView) => {
      await update($, view, () => target)
      await sizer?.set('open')
      if (target === 'tasks') await go($, current => reset(current, true))
      if (target === 'changes') await tracked?.refresh()
    }
    const switchRow = (
      <Box key="switch" flexDirection="row" flexWrap="wrap" columnGap={1}>
        <Button
          key="tasks"
          label="Tasks"
          hotkey="t"
          variant={current === 'tasks' ? 'primary' : 'secondary'}
          onPress={() => void switchTo('tasks')}
        />
        <Button
          key="changes"
          label={changesLabel(changed)}
          hotkey="d"
          variant={current === 'changes' ? 'primary' : 'secondary'}
          onPress={() => void switchTo('changes')}
        />
        {isMinimized ? (
          <Text key="hint" dimColor wrap="truncate-end">
            minimized
          </Text>
        ) : null}
      </Box>
    )
    if (isMinimized && body.length === 0) return <Box paddingX={PAD_COLUMNS}>{switchRow}</Box>

    const buttons = [
      <Button
        label="mine"
        hotkey="m"
        variant={shown === 'mine' ? 'primary' : 'secondary'}
        onPress={() => void showMode($, 'mine')}
      />,
      <Button
        label="all"
        hotkey="a"
        variant={shown === 'all' ? 'primary' : 'secondary'}
        onPress={() => void showMode($, 'all')}
      />,
    ]
    const place = currentPlace(at)
    // The archive opens the Archive page (done-rows.ts) at the week of now, in the dock alone, where a page can show:
    // inline, the places are never read.
    if (!inline)
      buttons.push(
        <Button
          key="archive"
          label="archive"
          hotkey="h"
          variant={place.kind === 'done' ? 'primary' : 'secondary'}
          onPress={() => void go($, current => doneAt(current, weekOf(snap.now)))}
        />,
      )
    // A page shows no list, so no card in it to collapse.
    if (Object.keys(open).length > 0 && place.kind === 'list')
      buttons.push(
        <Button label="collapse" hotkey="c" variant="secondary" onPress={() => void update($, expanded, () => NOTHING_EXPANDED)} />,
      )

    // The Find field, under the switch in the dock whatever it shows: the first change opens a search (a place, so back
    // from a result's page returns to it), each change shows the results for its words, Enter opens the top one's page,
    // and an empty field or clear closes the search. It is drawn under its round's key, holding what the round started
    // with (find-field.ts): the query of the search shown, else nothing; never the person's typing, which the engine
    // would drop on each redraw. `s: Find` before it moves the focus ring into it, and clear moves it back in; the
    // field never takes the focus by itself, as it would then hold every key the pane's hotkeys answer. Esc hands the
    // keys back and leaves the results drawn.
    const findRow = inline ? null : (
      <Box key="find-row" flexDirection="row" flexWrap="wrap" columnGap={1}>
        <Button key="find-key" label="Find" plain hotkey="s" onPress={() => void focusFind($)} />
        <Input
          key={fieldKey(field)}
          placeholder="id, title, owner, note…"
          value={field.text}
          submitLabel="open"
          onInput={value => void go($, current => searched(current, value), 'typing')}
          onSubmit={value => void openTop(value)}
        />
        {place.kind === 'search' ? <Button label="clear" variant="secondary" onPress={() => void clearSearch($)} /> : null}
      </Box>
    )
    // Under the field, where the person's keys go now (find-field.ts): typed into the field, to the pane's hotkeys or to
    // Claude's prompt, and the key or the click that moves them; bold while typing searches, wrapped in a narrow dock.
    const keys: KeysAt = keysAt(e.props.isFocused, landings, keysMemo)
    const keysText = wrapRow({ key: 'keys-hint', spans: [{ text: keysHint(keys) }] }, columns)
      .map(line => line.map(span => span.text).join(''))
      .join('\n')
    const keysLine = inline ? null : keys === 'search' ? (
      <Text key="keys-hint" bold>
        {keysText}
      </Text>
    ) : (
      <Text key="keys-hint" dimColor>
        {keysText}
      </Text>
    )
    // In the tasks view the Find row and its line sit right under the switch, then the mode buttons, in the same block.
    // The field comes before every element that shows or hides with the place (collapse, clear, a page's steps): the
    // engine keeps the focus ring at an index among the pane's elements, so one shown or hidden before the field would
    // move the ring off it as the person types (the first key opens a search, which hides collapse), and the next keys
    // would press the pane's hotkeys or reach the prompt.
    const controls =
      current === 'tasks' ? (
        <Box key="controls" flexDirection="column">
          {switchRow}
          {findRow}
          {keysLine}
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            {buttons}
          </Box>
        </Box>
      ) : (
        switchRow
      )
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
    const statusRows =
      barLines.length === 0 ? null : (
        <Box key="status-bar" flexDirection="column">
          {barLines.map((line, i) => (
            <Box key={`status-bar:${i}`} flexDirection="row">
              {line.map(drawPiece)}
            </Box>
          ))}
        </Box>
      )
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
    const crumbRow = crumbs.flatMap((crumb, i) => {
      const label = placeLabel(crumb.place)
      const drawn = crumb.isShown ? (
        <Text key={`crumb:${crumb.index}`} bold>
          {label}
        </Text>
      ) : (
        <Button key={`crumb:${crumb.index}`} plain onPress={() => void go($, current => wentTo(current, crumb.index))}>
          <Text underline dimColor={crumb.isAhead}>
            {label}
          </Text>
        </Button>
      )
      return i === 0 ? [drawn] : [<Text key={`after:${crumb.index - 1}`} dimColor>{TRAIL_SEPARATOR}</Text>, drawn]
    })
    // The Archive page's week between its steps to the week before and after (p, l), each dim where the pane holds no
    // older or newer week. A step changes the page's week in place, so back returns to where the page was opened from.
    const stepTo = (week: string) => () => void go($, current => doneAt(current, week))
    const steps = place.kind === 'done' ? weekSteps(place.week, snap.now) : null
    const weekRow =
      steps === null ? null : (
        <Box key="week-steps" flexDirection="row" flexWrap="wrap" columnGap={2}>
          {steps.prev === null ? (
            nowhere('prev', PREV_LABEL)
          ) : (
            <Button key="prev" label={PREV_LABEL} hotkey="p" variant="secondary" onPress={stepTo(steps.prev)} />
          )}
          <Text key="week" bold>
            {`week of ${weekWords(steps.week)}`}
          </Text>
          {steps.next === null ? (
            nowhere('next', NEXT_LABEL)
          ) : (
            <Button key="next" label={NEXT_LABEL} hotkey="l" variant="secondary" onPress={stepTo(steps.next)} />
          )}
        </Box>
      )
    const pageHead =
      isPage(place) || canGoForward(at) ? (
        <Box key="page-head" flexDirection="column">
          <Box flexDirection="row" columnGap={2}>
            {backStep}
            {forwardStep}
          </Box>
          <Box key="trail" flexDirection="row" flexWrap="wrap">
            {isCutBefore ? <Text key="cut-before" dimColor>{`…${TRAIL_SEPARATOR}`}</Text> : null}
            {crumbRow}
            {isCutAfter ? <Text key="cut-after" dimColor>{`${TRAIL_SEPARATOR}…`}</Text> : null}
          </Box>
          <Text dimColor>{'─'.repeat(Math.max(1, columns))}</Text>
        </Box>
      ) : null
    return (
      <Box flexDirection="column" paddingX={PAD_COLUMNS} gap={inline ? 0 : 1}>
        {controls}
        {pageHead}
        {weekRow}
        {statusRows}
        {inline ? body.map(drawBlock) : windowed(body, bodyWindow).map(drawSlot)}
      </Box>
    )
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
    const tree = treeOf(snap.tasks, snap.now)
    const isOpen = await read($, bannerOpen)
    const [banner] = dockLayout([bannerBlock(currentTask(snap, tree), isOpen, tree, snap.area)], e.props.bodyColumns, bannerWraps)
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
