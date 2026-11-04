// The Stats tab as blocks of rows (rows.ts, T1419): teamrig's stats fold of the registers (stats-source.ts) for the
// scope and range the tab picks. On top two rows of presses (`stats`): the scope (the tree, each team in it, and a
// session once one is picked, a press on it going back to its team) and the range, the pick in brackets, the others
// in plain text so they read as presses. Then the Health section under its heading: tiles, each a `●` in its level's
// colour (good green, warn amber, bad red) beside teamrig's words for it (the HEALTH line of `teamrig stats`) and the
// scope's week against its plan, two a row where they fit; each count of tasks above none is a press (`stats`) that
// lists the tasks behind it (T1864) in place of the tab's numbers: a dim line saying what the list holds, then each
// task's title row over a dim meta line, a press on one of the own team's that the pane holds opening its page; the
// head's back (register.tsx statsHead) returns to the numbers. Then the Flow section, its header carrying the range and
// its headline so it still answers folded (`folds`): the active tasks at each day's end, the newest days with bars of
// what opened and closed and a `$` on a day the week sat at its usage limit, the burn-up and the cumulative flow, each
// part after a blank row, a chart under a legend whose title is bold; a team's charts say where a split moved tasks
// out of them, as only the tree's are whole before it. After Flow the New work, Speed, Delays, Waits, Bugs and People
// sections (stats-sections.ts, T1859), closed by default. A team folder the last read could not read is a WARN line.
// Pure.
import type { ThemeKey } from 'claude-code'
import type { StatsChoice, StatsList, StatsListKind, StatsListRow, StatsNumbers, StatsView } from '../types'
import { priorityText, STATS_RANGES, type ActiveStatus, type HealthLevel, type RegisterHealth, type StatsDay, type StatsRange } from './core/read/index'
import { storedDueWords } from './meta'
import { indentOf, META_LINES, SEPARATOR, single, TITLE_LINES, titleRow, type Block, type Row, type Span, type StatsPress } from './rows'
import { activeChart, bar, BURN_GLYPH, burnUpChart, FLOW_GLYPH, flowChart, type BurnSeries, type Chart, type LineSeries } from './stats-chart'
import { daysText, HANG, INDENT, rangeLabel, sectionBlock, signed, VIEW } from './stats-parts'
import { sectionBlocks } from './stats-sections'
import type { TeamWeek } from './team'
import { failureBlock, weekPct } from './team-rows'
import { cells } from './width'
import type { Clock } from './zone'

/** The Flow section's block key: a press on its header folds the section. */
export const FLOW_KEY = `${VIEW}:flow`
/** The sections that start open; a section's key among the tab's toggled keys flips it from this. */
export const OPEN_SECTIONS: readonly string[] = [FLOW_KEY]
/** The most days the Flow section's day rows show, newest first; its charts show the whole range. */
export const DAY_ROWS = 14
/** Each Health tile's dot, in its level's colour (LEVEL_COLOR). */
export const HEALTH_DOT = '●'
/** A Health level's colour. */
export const LEVEL_COLOR: Readonly<Record<HealthLevel, ThemeKey>> = { good: 'success', warn: 'warning', bad: 'error' }
/** Marks a day the week sat at its usage limit, so a quiet day there is not read as slack. */
export const LIMIT_MARK = '$'

/** Between a pick row's label and its presses, and between two presses. */
const PICK_GAP = '  '
/** The blank cells between two Health tiles on one row, and the fewest it shrinks to before they go one a row. */
const TILE_GAP = 4
const MIN_TILE_GAP = 2
/** Between a day row's columns. */
const COLUMN_GAP = '  '
/** The cells a day row's date takes: `Sat 10-31`. */
const DAY_CELLS = 9
/** The bounds of a day row's bars, in cells. */
const MIN_BAR_CELLS = 4
const MAX_BAR_CELLS = 20
const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' })

/** The `stats` view's numbers. */
type Folded = Extract<StatsView, { kind: 'stats' }>
/** A part of a tile's value: its words, and the Health count whose tasks a press on it lists (null: plain words, or a count of none). */
type TilePart = { readonly text: string; readonly opens: StatsListKind | null }
/** A Health tile: its level, what it measures and teamrig's words for its value, in parts. */
type Tile = { readonly level: HealthLevel; readonly label: string; readonly parts: readonly TilePart[] }
/** The pane's own team, the tasks its snapshot holds (a press on one opens its page) and its clock: what a Stats list's rows read. */
export type StatsOwn = { readonly team: string | null; readonly held: ReadonlySet<string>; readonly clock: Clock }

/** Each list's title, as the tab's head names it. */
const LIST_TITLES: Readonly<Record<StatsListKind, string>> = { active: 'Active', opened: 'Opened', closed: 'Closed', overdue: 'Overdue', overdueP1: 'Overdue p1', ownerDecisions: 'Owner decisions' }
/** What each list holds, around the scope's words: `The tasks` + ` in the tree` + ` opened`. */
const LIST_WORDS: Readonly<Record<StatsListKind, { readonly lead: string; readonly tail: string }>> = {
  active: { lead: 'The active tasks', tail: '' },
  opened: { lead: 'The tasks', tail: ' opened' },
  closed: { lead: 'The tasks', tail: ' closed' },
  overdue: { lead: 'The active tasks', tail: ' past their due date' },
  overdueP1: { lead: 'The active p1 tasks', tail: ' past their due date' },
  ownerDecisions: { lead: 'The tasks', tail: ' waiting on the owner' },
}
/** How a chart's series draws. */
type Look = Omit<Span, 'text'>

const LINE_LOOK: Readonly<Record<LineSeries, Look>> = { active: { color: 'claude' } }
const BURN_LOOK: Readonly<Record<BurnSeries, Look>> = { created: { color: 'warning' }, closed: { color: 'success' }, both: {} }
const FLOW_LOOK: Readonly<Record<ActiveStatus, Look>> = { verifying: { color: 'success' }, 'in-progress': { color: 'claude' }, waiting: { color: 'warning' }, open: {} }
/** The flow legend's order: top band first, as the chart stacks them. */
const FLOW_LEGEND: readonly ActiveStatus[] = ['open', 'waiting', 'in-progress', 'verifying']
const STATUS_WORDS: Readonly<Record<ActiveStatus, string>> = { open: 'open', waiting: 'waiting', 'in-progress': 'in progress', verifying: 'verifying' }

/** Whether the section under `key` is open: its default (OPEN_SECTIONS) unless `toggled` flips it. */
export function isSectionOpen(key: string, toggled: readonly string[]): boolean {
  return OPEN_SECTIONS.includes(key) !== toggled.includes(key)
}

/** A `YYYY-MM-DD` day as a day row reads it: `Sat 10-31`. */
export function dayLabel(day: string): string {
  return `${WEEKDAY.format(new Date(`${day}T00:00:00Z`))} ${day.slice(5)}`
}

function note(text: string): Block {
  return single(`${VIEW}:note`, [{ text, dim: true }])
}

function spansCells(spans: readonly Span[]): number {
  return cells(spans.map(span => span.text).join(''))
}

/** A pick row's choice: the picked one in brackets, no press; another a press that picks it, in plain text (a dim one reads as no press). */
function choiceSpan(label: string, picked: boolean, press: StatsPress): Span {
  return picked ? { text: `[${label}]`, color: 'claude', bold: true } : { text: label, stats: press }
}

/** `label` in bold and its choices, PICK_GAP apart, a wrapped line starting under the first choice. */
function pickRow(key: string, label: string, choices: readonly Span[]): Row {
  return { key, spans: [{ text: label, bold: true }, ...choices.flatMap(choice => [{ text: PICK_GAP }, choice])], hang: { text: ' '.repeat(cells(label + PICK_GAP)) } }
}

/** The scope row: the tree and each of its teams; on a session's scope, the session too, its press back to its team. */
function scopeRow(scope: StatsChoice, teams: readonly string[]): Row {
  const choices = [
    choiceSpan('tree', scope.kind === 'tree', { kind: 'scope', scope: { kind: 'tree' } }),
    ...teams.map(team => choiceSpan(team, scope.kind === 'team' && scope.team === team, { kind: 'scope', scope: { kind: 'team', team } })),
  ]
  if (scope.kind === 'session') choices.push({ text: `[${scope.session} ×]`, color: 'claude', bold: true, stats: { kind: 'scope', scope: { kind: 'team', team: scope.team } } })
  return pickRow(`${VIEW}:scope`, 'Scope', choices)
}

function rangeRow(range: StatsRange): Row {
  return pickRow(
    `${VIEW}:range`,
    'Range',
    STATS_RANGES.map(choice => choiceSpan(rangeLabel(choice), choice === range, { kind: 'range', range: choice })),
  )
}

/** `text` as plain words in a tile's value: no press. */
function plain(text: string): TilePart {
  return { text, opens: null }
}

/** `text` for a count of `count` tasks: a press that lists them, or plain words when there are none. */
function countPart(text: string, count: number, list: StatsListKind): TilePart {
  return { text, opens: count > 0 ? list : null }
}

const COMMA = plain(', ')

/**
 * The scope's week as a tile: used, where its plan puts it by now (pace) and the plan. Amber ahead of pace, red past
 * the plan; with no plan, amber once any is used.
 */
function weekTile(week: TeamWeek): Tile {
  if (week.plannedPct <= 0) return { level: week.usedPct > 0 ? 'warn' : 'good', label: 'week', parts: [plain(`${weekPct(week.usedPct)}, no plan`)] }
  const pace = (week.plannedPct * week.elapsedPct) / 100
  const level: HealthLevel = week.usedPct > week.plannedPct ? 'bad' : week.usedPct > pace ? 'warn' : 'good'
  return { level, label: 'week', parts: [plain(`${weekPct(week.usedPct)}, pace ${weekPct(pace)} of ${weekPct(week.plannedPct)}`)] }
}

/**
 * The Health tiles in reading order, the week's last (none without a week file). The ratio of closes to opens names
 * both counts (`0.79, 64 closed, 81 opened`, the opened one only when any opened), so each count of tasks is a part of
 * its own that lists them. The core's backlog forecast (`backlog clears`) is left out: it has no tasks to list, and
 * `teamrig stats` still prints it.
 */
function healthTiles(health: RegisterHealth, stats: StatsNumbers, week: TeamWeek | null): Tile[] {
  const { closeOpen, backlog, overdue, ownerDecisions } = health
  const opened = stats.opened > 0 ? [COMMA, countPart(`${stats.opened} opened`, stats.opened, 'opened')] : []
  const closes = [plain(closeOpen.ratio === null ? 'none opened' : closeOpen.ratio.toFixed(2)), COMMA, countPart(`${stats.closedTasks} closed`, stats.closedTasks, 'closed'), ...opened]
  const oldest = ownerDecisions.oldestDays === null ? [] : [plain(`, oldest ${daysText(ownerDecisions.oldestDays)}`)]
  return [
    { level: closeOpen.level, label: 'close/open', parts: closes },
    { level: backlog.level, label: 'backlog', parts: [plain(signed(backlog.net)), COMMA, countPart(`${backlog.active} active`, backlog.active, 'active')] },
    { level: overdue.level, label: 'overdue', parts: [countPart(`${overdue.count}`, overdue.count, 'overdue'), COMMA, countPart(`p1 ${overdue.p1}`, overdue.p1, 'overdueP1')] },
    { level: ownerDecisions.level, label: 'owner decisions', parts: [countPart(`${ownerDecisions.count}`, ownerDecisions.count, 'ownerDecisions'), ...oldest] },
    ...(week === null ? [] : [weekTile(week)]),
  ]
}

function tileSpans(tile: Tile): Span[] {
  const parts = tile.parts.map((part): Span => (part.opens === null ? { text: part.text } : { text: part.text, stats: { kind: 'list', list: part.opens } }))
  return [{ text: HEALTH_DOT, color: LEVEL_COLOR[tile.level] }, { text: ` ${tile.label}  `, dim: true }, ...parts]
}

/**
 * The Health section: its bold heading, then the tiles under INDENT, two a row in two columns TILE_GAP apart where both
 * fit, the gap shrinking to MIN_TILE_GAP before they go one a row.
 */
function healthBlock(view: Folded, width: number): Block {
  const key = `${VIEW}:health`
  const room = width - cells(INDENT.text)
  const tiles = healthTiles(view.health, view.stats, view.week).map(tileSpans)
  const lefts = tiles.filter((_, index) => index % 2 === 0)
  const rights = tiles.filter((_, index) => index % 2 === 1)
  const leftCells = Math.max(0, ...lefts.map(spansCells))
  const gap = Math.min(TILE_GAP, room - leftCells - Math.max(0, ...rights.map(spansCells)))
  const paired = gap >= MIN_TILE_GAP
  const column = leftCells + gap
  const lines = paired
    ? lefts.map((left, index) => {
        const right = rights[index]
        return right === undefined ? left : [...left, { text: ' '.repeat(column - spansCells(left)) }, ...right]
      })
    : tiles
  const heading: Row = { key: `${key}:head`, spans: [{ text: 'Health', bold: true }] }
  return { key, rows: [heading, ...lines.map((spans, index): Row => ({ key: `${key}:${index}`, spans: [INDENT, ...spans], hang: HANG }))], opensSection: true }
}

/** A blank row before a part of the Flow section, so its parts read apart. */
function gapRow(key: string): Row {
  return { key: `${key}:gap`, spans: [] }
}

/** A legend row: its bold title, then dim words with each series' glyph in its look. */
function legendRow(key: string, title: string, spans: readonly Span[]): Row {
  return { key: `${key}:legend`, spans: [INDENT, { text: title, bold: true }, ...spans], hang: INDENT }
}

/** A chart's rows under INDENT: its axis dim, each run in its series' look; then its days, and its `$` marks in amber. */
function chartRows<S extends string>(key: string, chart: Chart<S>, looks: Readonly<Record<S, Look>>): Row[] {
  const rows = chart.rows.map(
    (row, index): Row => ({
      key: `${key}:${index}`,
      spans: [INDENT, { text: row.axis, dim: true }, ...row.runs.map((run): Span => (run.series === null ? { text: run.text } : { text: run.text, ...looks[run.series] }))],
    }),
  )
  const limits: Row[] = chart.limits === null ? [] : [{ key: `${key}:limits`, spans: [INDENT, { text: chart.limits, color: 'warning' }] }]
  return [...rows, { key: `${key}:days`, spans: [INDENT, { text: chart.days, dim: true }] }, ...limits]
}

function closedOn(day: StatsDay): number {
  return day.done + day.dropped
}

/**
 * The newest DAY_ROWS days, newest first: the date, a `$` on a day at the usage limit, what opened and closed (done or
 * dropped) as counts and bars on one scale, and the net; a line saying how many older days only the charts show; the
 * range's days at the limit, as `teamrig stats` prints them.
 */
function dayRows(days: readonly StatsDay[], width: number): Row[] {
  const key = `${FLOW_KEY}:day`
  const shown = days.slice(-DAY_ROWS).reverse()
  const top = Math.max(0, ...shown.map(day => Math.max(day.opened, closedOn(day))))
  const countCells = String(top).length
  const nets = shown.map(day => signed(day.opened - closedOn(day)))
  const netCells = Math.max(cells('net'), ...nets.map(net => net.length))
  const fixed = cells(INDENT.text) + DAY_CELLS + 2 + 3 * COLUMN_GAP.length + 2 * (countCells + 1) + netCells
  const barCells = Math.min(MAX_BAR_CELLS, Math.max(MIN_BAR_CELLS, Math.floor((width - fixed) / 2)))
  const column = countCells + 1 + barCells + COLUMN_GAP.length
  const head = `${'day'.padEnd(DAY_CELLS + 2 + COLUMN_GAP.length)}${'opened'.padEnd(column)}${'closed'.padEnd(column)}${'net'.padStart(netCells)}`
  const count = (value: number, look: Look): Span[] => {
    const drawn = bar(value, top, barCells)
    return [{ text: `${String(value).padStart(countCells)} ` }, { text: drawn, ...look }, { text: ' '.repeat(barCells - drawn.length) + COLUMN_GAP }]
  }
  const rows = shown.map((day, index): Row => {
    const net = day.opened - closedOn(day)
    const netLook: Look = net > 0 ? { color: 'warning' } : net < 0 ? { color: 'success' } : { dim: true }
    return {
      key: `${key}:${day.day}`,
      spans: [
        INDENT,
        { text: dayLabel(day.day) },
        day.atLimit ? { text: ` ${LIMIT_MARK}`, color: 'warning' } : { text: '  ' },
        { text: COLUMN_GAP },
        ...count(day.opened, {}),
        ...count(closedOn(day), { color: 'success' }),
        { text: (nets[index] ?? '').padStart(netCells), ...netLook },
      ],
      hang: INDENT,
    }
  })
  const older = days.length - shown.length
  const olderRows: Row[] = older > 0 ? [{ key: `${key}:older`, spans: [INDENT, { text: `${older} older ${older === 1 ? 'day shows' : 'days show'} in the charts only`, dim: true }] }] : []
  const marked = days.filter(day => day.atLimit).map(day => day.day.slice(5))
  const limitRows: Row[] =
    marked.length === 0
      ? []
      : [
          {
            key: `${key}:limit`,
            spans: [INDENT, { text: LIMIT_MARK, color: 'warning' }, { text: ` ${marked.join(', ')}: the week sat at its usage limit, so a quiet day there is no slack`, dim: true }],
            hang: INDENT,
          },
        ]
  return [{ key: `${key}:head`, spans: [INDENT, { text: head, dim: true }] }, ...rows, ...olderRows, ...limitRows]
}

/** On a team's or a session's scope, each split in the range: before it only the tree's charts hold the tasks it moved. */
function splitRows(scope: StatsChoice, stats: StatsNumbers): Row[] {
  if (scope.kind === 'tree') return []
  const first = stats.days[0]?.day ?? ''
  return stats.splits
    .filter(split => split.day >= first)
    .map((split, index) => ({
      key: `${FLOW_KEY}:split:${index}`,
      spans: [INDENT, { text: `before ${split.day.slice(5)}: tree only, ${split.tasks} ${split.tasks === 1 ? 'task' : 'tasks'} moved ${split.from} -> ${split.to}`, color: 'warning' }],
      hang: INDENT,
    }))
}

/** The open Flow section's rows: split marks, then each after a blank row the active line, the day rows, the burn-up and the cumulative flow. */
function flowRows(view: Folded, width: number): Row[] {
  const { stats } = view
  const room = width - cells(INDENT.text)
  const dim = (text: string): Span => ({ text, dim: true })
  const activeKey = `${FLOW_KEY}:active`
  const burnKey = `${FLOW_KEY}:burn`
  const flowKey = `${FLOW_KEY}:cfd`
  const flowLegend = FLOW_LEGEND.flatMap((status, index): Span[] => [dim(index === 0 ? '  ' : ', '), { text: FLOW_GLYPH[status], ...FLOW_LOOK[status] }, dim(` ${STATUS_WORDS[status]}`)])
  return [
    ...splitRows(view.scope, stats),
    gapRow(activeKey),
    legendRow(activeKey, 'Active tasks', [dim(" at each day's end")]),
    ...chartRows(activeKey, activeChart(stats.days, room), LINE_LOOK),
    gapRow(`${FLOW_KEY}:day`),
    ...dayRows(stats.days, width),
    gapRow(burnKey),
    legendRow(burnKey, 'Burn-up', [
      dim('  '),
      { text: BURN_GLYPH.created, ...BURN_LOOK.created },
      dim(' created, '),
      { text: BURN_GLYPH.closed, ...BURN_LOOK.closed },
      dim(' closed; the gap is the backlog'),
    ]),
    ...chartRows(burnKey, burnUpChart(stats.days, room), BURN_LOOK),
    gapRow(flowKey),
    legendRow(flowKey, 'Cumulative flow', flowLegend),
    ...chartRows(flowKey, flowChart(stats.days, room), FLOW_LOOK),
  ]
}

/** The Flow section: its header with the range and its opened, closed and net, and while open its rows as the block's card. */
function flowBlock(view: Folded, open: boolean, width: number): Block {
  const { stats } = view
  const dropped = stats.droppedTasks > 0 ? ` (${stats.droppedTasks} dropped)` : ''
  const range = view.range === 'all' ? 'all days' : `last ${rangeLabel(view.range)}`
  const parts: Span[] = [{ text: 'Flow', bold: true }, { text: range }, { text: `opened ${stats.opened}` }, { text: `closed ${stats.closedTasks}${dropped}` }, { text: `net ${signed(stats.net)}` }]
  return sectionBlock(FLOW_KEY, parts, open ? flowRows(view, width) : null)
}

/** `Overdue (35)`: the list's title, as the tab's head names it, and how many tasks it holds. */
export function listTitle(list: StatsList): string {
  return `${LIST_TITLES[list.kind]} (${list.rows.length})`
}

function scopeWords(scope: StatsChoice): string {
  switch (scope.kind) {
    case 'tree':
      return 'in the tree'
    case 'team':
      return `in ${scope.team} and the teams under it`
    case 'session':
      return `of ${scope.session} in ${scope.team}`
  }
}

/** The line over a list: what it holds in the scope, the range for the tasks opened or closed in it, and its order. */
function listWhat(view: Folded, kind: StatsListKind): string {
  const { lead, tail } = LIST_WORDS[kind]
  const range = kind === 'opened' || kind === 'closed' ? (view.range === 'all' ? ' ever' : ` in the last ${rangeLabel(view.range)}`) : ''
  const order = kind === 'ownerDecisions' ? 'the oldest wait first' : kind === 'overdueP1' ? 'by due date' : 'p1 first, then by due date'
  return `${lead} ${scopeWords(view.scope)}${tail}${range}, ${order}.`
}

/**
 * A listed task: `◐ T12  title` cut at TITLE_LINES, over a dim meta line of its owner, priority, own due on the
 * team's clock and, when another team holds it, that team. A press opens its page when the pane holds it: one of the
 * own team's tasks its snapshot keeps.
 */
function listBlock(row: StatsListRow, own: StatsOwn): Block {
  const key = `${VIEW}:list:${row.team}/${row.id}`
  const indent = indentOf(row)
  const due = row.due === null ? [] : [`due ${storedDueWords(row.due, own.clock)}`]
  const facts = [row.owner, priorityText(row.priority), ...due, ...(row.team === own.team ? [] : [row.team])]
  const spans = facts.flatMap((fact, index): Span[] => (index === 0 ? [{ text: fact, dim: true }] : [SEPARATOR, { text: fact, dim: true }]))
  const block: Block = { key, rows: [titleRow(key, row, TITLE_LINES), { key: `${key}:meta`, spans: [indent, ...spans], hang: indent, maxLines: META_LINES }] }
  return row.team === own.team && own.held.has(row.id) ? { ...block, opens: row.id } : block
}

/** A Health count's tasks in place of the tab's numbers: the WARN lines, the line saying what it holds, then its tasks. */
function listBlocks(view: Folded, list: StatsList, own: StatsOwn): Block[] {
  const tasks = list.rows.length === 0 ? [note('No tasks.')] : list.rows.map(row => listBlock(row, own))
  return [...view.failures.map(failure => failureBlock(VIEW, failure)), single(`${VIEW}:list`, [{ text: listWhat(view, list.kind), dim: true }]), ...tasks]
}

/**
 * The Stats tab `width` cells wide: the scope and range rows, a WARN line for each team folder the last read could not
 * read, the Health tiles, the Flow section and the sections after it (stats-sections.ts), each open or folded by
 * `toggled` against OPEN_SECTIONS; while a count's press picked it, its tasks instead, read against `own`; or why none
 * show.
 */
export function statsBlocks(view: StatsView, toggled: readonly string[], width: number, own: StatsOwn): Block[] {
  switch (view.kind) {
    case 'reading':
      return [note('Reading the registers…')]
    case 'no-team':
      return [note("No team found: the Stats tab folds the registers of the tree of teams the session's team is in.")]
    case 'failed':
      return [single(`${VIEW}:note`, [{ text: `The registers could not be read: ${view.reason.replace(/\.$/, '')}.`, color: 'warning' }])]
    case 'stats':
      if (view.list !== null) return listBlocks(view, view.list, own)
      return [
        { key: `${VIEW}:pick`, rows: [scopeRow(view.scope, view.teams), rangeRow(view.range)] },
        ...view.failures.map(failure => failureBlock(VIEW, failure)),
        healthBlock(view, width),
        flowBlock(view, isSectionOpen(FLOW_KEY, toggled), width),
        ...sectionBlocks(view, key => isSectionOpen(key, toggled), width),
      ]
  }
}
