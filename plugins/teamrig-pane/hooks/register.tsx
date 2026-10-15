// teamrig-pane: docks this session's list from the task register (where it is: places.ts) on the right
// of the fullscreen UI. `mine` shows the session's area: a status bar of its tasks (status-bar.ts),
// its work waiting for proof, its other active tasks in plan order, what it asked of others, what it
// finished in the last day, and its unread inbox lines; `all` shows
// every owner's active tasks. A press on a task row expands it: the ask and its goals' roadmap items
// quoted where its refs still point, who asked and when, its priority, week and goals, its status
// note and evidence, and the files it names. The close mark (✕,
// ctrl+x x) minimizes it to a one-row strip instead of closing it; a press on the strip or /teamrig-pane
// opens it again, and the size is kept for the next session (size.ts). A switch row, first in every
// state and width, the strip included, flips the body between the tasks and the Changes view: the
// files changed in the git repos the session works in and their lines (changes.ts), counted as Δn on
// the switch and in the tab title. Reads files and runs git (status, diff, grep; no model calls);
// /teamrig-pane steers it.
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'
import type { BarStatus, ExpandedTasks, PaneView, RequirementProblem, Snapshot, TaskDetail, ViewMode } from '../types'
import { ARGUMENT_HINT, COMMAND, inlineReason, parsePaneArgs } from './command'
import { LiveRegister, pinKey } from './live'
import { findPlaces, type PlacesEnv } from './places'
import { findSession, type TeamLookup } from './sessions'
import { TaskDetails } from './details'
import { TaskRegisterSource, registerPaths, unlessMissing, type Files } from './source'
import { dockLayout, failedDrawing, inlineLayout, type Drawn } from './layout'
import { NOTHING_EXPANDED, paneBlocks, type Span } from './rows'
import { inlineBarRows, statusBar, type BarPiece } from './status-bar'
import { PaneSizer, SIZE_KEY } from './size'
import { isGitMissing, requirementBlocks, requirementProblems } from './requirements'
import { EMPTY_CHANGES, knownOf, knownSeed, LiveChanges, NOTHING_KNOWN } from './changes'
import { changesBlocks, changesLabel, paneTitle } from './changes-rows'

const PANE = 'teamrig-pane'
/** The dock width it asks for: an id, priority, due and a 40-column title line, inside the padding. */
const DOCK_COLUMNS = 58
/** Columns of space between the pane's frame and its text, each side. */
const PAD_COLUMNS = 1
/** Most rows an inline pane (above the prompt) shows, its last one saying what it left out. */
const INLINE_MAX_ROWS = 6
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
const expanded = atom({ plugin: 'teamrig-pane', key: 'expanded' } as const, NOTHING_EXPANDED)
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

/** The expanded tasks less one. */
function collapse(current: ExpandedTasks, id: string): ExpandedTasks {
  return Object.fromEntries(Object.entries(current).filter(([key]) => key !== id))
}


export const register: Register = on => {
  let live: LiveRegister | null = null
  /** The team `/teamrig-pane <session>` looks its word up in; set when the session starts, null with no team. */
  let team: TeamLookup | null = null
  /** Reads what an expanded task's refs point at; set when the session starts. */
  let details: TaskDetails | null = null
  /** Draws and keeps the pane's size; set when the session starts. */
  let sizer: PaneSizer | null = null
  /** Reads the session's git changes; set when the session starts. */
  let tracked: LiveChanges | null = null
  /** The tab title last asked for: `Tasks · Δn` (changes-rows.ts paneTitle). */
  let title = paneTitle(EMPTY_CHANGES)

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
    details = new TaskDetails(files, { inboxDir: 'missing' in paths ? null : paths.inboxDir, home: home ?? null, cwd: e.cwd, goalsDoc: places.goalsDoc })
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
    if (command.kind === 'mode') await update($, mode, () => command.mode)
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
  // collapses the task. Docked, the root's gap spaces the blocks and its padding the frame.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const inline = e.props.placement === 'inline'
    // A read or a layout that throws draws one error line under the buttons: unguarded, the engine
    // would skip this hook and draw the pane with no tasks and no word of why.
    let isMinimized = false
    let current: PaneView = 'tasks'
    let changed = EMPTY_CHANGES
    let snap = EMPTY_SNAPSHOT
    let shown: ViewMode = 'mine'
    let open: ExpandedTasks = NOTHING_EXPANDED
    let body: Drawn[] = []
    /** The status bar's lines over the area's tasks (status-bar.ts); none outside the mine tasks view. */
    let barLines: BarPiece[][] = []
    try {
      isMinimized = (await read($, size)) === 'minimized'
      current = await read($, view)
      changed = await read($, changes)
      if (!isMinimized) {
        snap = await read($, snapshot)
        shown = await read($, mode)
        open = await read($, expanded)
        const missing = await read($, requirements)
        const columns = e.props.bodyColumns - 2 * PAD_COLUMNS
        const bar = current === 'tasks' && shown === 'mine' ? statusBar(snap, await read($, barFilter), columns) : null
        // With no bar there is nothing to filter by, and the list shows every task.
        const viewBlocks =
          current === 'tasks' ? paneBlocks(snap, shown, open, bar?.filter ?? null) : changesBlocks(changed, isGitMissing(missing))
        const blocks = [...requirementBlocks(missing), ...viewBlocks]
        // Inline, the bar's lines count in the capped rows.
        const cap = Math.min(INLINE_MAX_ROWS, e.props.scroll.bodyRows)
        barLines = bar === null ? [] : inline ? bar.lines.slice(0, inlineBarRows(bar, cap)) : bar.lines
        body = inline ? inlineLayout(blocks, cap - barLines.length) : dockLayout(blocks, columns)
      }
    } catch (error) {
      barLines = []
      body = failedDrawing(error)
    }

    // Opening reads what the task's refs point at, once. A failed read still opens it, its refs named
    // unquoted: the register's own fields are the rest of the details.
    const toggle = async (id: string) => {
      if (open[id] !== undefined) {
        await update($, expanded, current => collapse(current, id))
        return
      }
      const task = snap.tasks.find(t => t.id === id)
      if (task === undefined) return
      const unquoted: TaskDetail = { ref: task.ref, quotes: [] }
      const detail = details === null ? unquoted : await details.load(task).catch(() => unquoted)
      await update($, expanded, current => ({ ...current, [id]: detail }))
    }

    const isPlain = (span: Span) => span.color === undefined && span.bold !== true && span.dim !== true
    const styled = (span: Span, key?: string) => (
      <Text key={key} color={span.color} bold={span.bold} dimColor={span.dim}>
        {span.text}
      </Text>
    )
    const drawText = (drawn: Drawn, key?: string) => {
      const [first, ...rest] = drawn.spans
      if (first !== undefined && rest.length === 0)
        return (
          <Text key={key} wrap={drawn.wrap} color={first.color} bold={first.bold} dimColor={first.dim}>
            {first.text}
          </Text>
        )
      return (
        <Text key={key} wrap={drawn.wrap}>
          {drawn.spans.map((span, index) => (isPlain(span) ? span.text : styled(span, String(index))))}
        </Text>
      )
    }
    const drawBlock = (drawn: Drawn) => {
      const id = drawn.toggle
      if (id === null) return drawText(drawn, drawn.key)
      return (
        <Button key={drawn.key} plain onPress={() => void toggle(id)}>
          {drawText(drawn)}
        </Button>
      )
    }

    // The switch: first in every state, so the other view is always one press (or t / d) away, its
    // buttons wrapping under each other in a dock too narrow for both. Minimized, it is the whole
    // pane, one row, and a press on either button opens the pane in full on that view.
    const switchTo = async (target: PaneView) => {
      await update($, view, () => target)
      await sizer?.set('open')
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
        onPress={() => void update($, mode, () => 'mine')}
      />,
      <Button
        label="all"
        hotkey="a"
        variant={shown === 'all' ? 'primary' : 'secondary'}
        onPress={() => void update($, mode, () => 'all')}
      />,
    ]
    if (Object.keys(open).length > 0)
      buttons.push(
        <Button label="collapse" hotkey="c" variant="secondary" onPress={() => void update($, expanded, () => NOTHING_EXPANDED)} />,
      )

    // In the tasks view the mode buttons sit right under the switch, in the same block.
    const controls =
      current === 'tasks' ? (
        <Box key="controls" flexDirection="column">
          {switchRow}
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
    return (
      <Box flexDirection="column" paddingX={PAD_COLUMNS} gap={inline ? 0 : 1}>
        {controls}
        {statusRows}
        {body.map(drawBlock)}
      </Box>
    )
  })
}
