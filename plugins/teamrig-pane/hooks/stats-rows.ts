// The Stats tab as blocks of rows (rows.ts, T1419): teamrig's stats fold of the registers (stats-source.ts) for the
// scope and range the tab picks. On top two rows of presses (`stats`): the scope (the tree, each team in it, and a
// session once one is picked, a press on it going back to its team) and the range, the pick in brackets, the others
// in plain text so they read as presses. Then the Health section under its heading: tiles, each a `●` in its level's
// colour (good green, warn amber, bad red) beside teamrig's words for it (the HEALTH line of `teamrig stats`) and the
// scope's week against its plan, two a row where they fit. Then the Flow section, its header carrying the range and
// its headline so it still answers folded (`folds`): the active tasks at each day's end, the newest days with bars of
// what opened and closed and a `$` on a day the week sat at its usage limit, the burn-up and the cumulative flow, each
// part after a blank row, a chart under a legend whose title is bold; a team's charts say where a split moved tasks
// out of them, as only the tree's are whole before it. A team folder the last read could not read is a WARN line. Pure.
import type { ThemeKey } from 'claude-code'
import type { StatsChoice, StatsNumbers, StatsView } from '../types'
import { joined } from './card'
import { STATS_RANGES, type ActiveStatus, type HealthLevel, type RegisterHealth, type StatsDay, type StatsRange } from './core/read/index'
import { FOLDED_MARK, single, type Block, type Row, type Span, type StatsPress } from './rows'
import { activeChart, bar, BURN_GLYPH, burnUpChart, FLOW_GLYPH, flowChart, type BurnSeries, type Chart, type LineSeries } from './stats-chart'
import type { TeamWeek } from './team'
import { failureBlock, weekPct } from './team-rows'
import { cells } from './width'

const VIEW = 'stats'
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

/** Leads a section's rows. */
const INDENT: Span = { text: '  ' }
/** Leads a wrapped line of a row INDENT leads. */
const HANG: Span = { text: '    ' }
/** Leads an open section's header, as FOLDED_MARK leads a folded one. */
const OPEN_MARK: Span = { text: '▾ ', dim: true }
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
/** A Health tile: its level, what it measures and teamrig's words for its value. */
type Tile = { readonly level: HealthLevel; readonly label: string; readonly value: string }
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

/** A range as its press reads, its count apart from its unit: `7 d`, `1 y`, `all`. */
export function rangeLabel(range: StatsRange): string {
  return range === 'all' ? 'all' : `${range.slice(0, -1)} ${range.slice(-1)}`
}

/** A `YYYY-MM-DD` day as a day row reads it: `Sat 10-31`. */
export function dayLabel(day: string): string {
  return `${WEEKDAY.format(new Date(`${day}T00:00:00Z`))} ${day.slice(5)}`
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : `${value}`
}

function daysText(value: number): string {
  return `${value.toFixed(1)} d`
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

/**
 * The scope's week as a tile: used, where its plan puts it by now (pace) and the plan. Amber ahead of pace, red past
 * the plan; with no plan, amber once any is used.
 */
function weekTile(week: TeamWeek): Tile {
  if (week.plannedPct <= 0) return { level: week.usedPct > 0 ? 'warn' : 'good', label: 'week', value: `${weekPct(week.usedPct)}, no plan` }
  const pace = (week.plannedPct * week.elapsedPct) / 100
  const level: HealthLevel = week.usedPct > week.plannedPct ? 'bad' : week.usedPct > pace ? 'warn' : 'good'
  return { level, label: 'week', value: `${weekPct(week.usedPct)}, pace ${weekPct(pace)} of ${weekPct(week.plannedPct)}` }
}

function clearsText(weeks: number | null): string {
  if (weeks === null) return 'never, at this rate'
  return `in ${weeks} ${weeks === 1 ? 'week' : 'weeks'}`
}

/** The Health tiles in reading order, the week's (none without a week file) before the backlog's forecast. */
function healthTiles(health: RegisterHealth, week: TeamWeek | null): Tile[] {
  const { closeOpen, backlog, overdue, ownerDecisions, backlogClears } = health
  const oldest = ownerDecisions.oldestDays === null ? '' : `, oldest ${daysText(ownerDecisions.oldestDays)}`
  return [
    { level: closeOpen.level, label: 'close/open', value: closeOpen.ratio === null ? 'none opened' : closeOpen.ratio.toFixed(2) },
    { level: backlog.level, label: 'backlog', value: `${signed(backlog.net)}, ${backlog.active} active` },
    { level: overdue.level, label: 'overdue', value: `${overdue.count}, p1 ${overdue.p1}` },
    { level: ownerDecisions.level, label: 'owner decisions', value: `${ownerDecisions.count}${oldest}` },
    ...(week === null ? [] : [weekTile(week)]),
    { level: backlogClears.level, label: 'backlog clears', value: clearsText(backlogClears.weeks) },
  ]
}

function tileSpans(tile: Tile): Span[] {
  return [{ text: HEALTH_DOT, color: LEVEL_COLOR[tile.level] }, { text: ` ${tile.label}  `, dim: true }, { text: tile.value }]
}

/**
 * The Health section: its bold heading, then the tiles under INDENT, two a row in two columns TILE_GAP apart where both
 * fit, the gap shrinking to MIN_TILE_GAP before they go one a row.
 */
function healthBlock(health: RegisterHealth, week: TeamWeek | null, width: number): Block {
  const key = `${VIEW}:health`
  const room = width - cells(INDENT.text)
  const tiles = healthTiles(health, week).map(tileSpans)
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
  const head: Row = { key: FLOW_KEY, spans: [open ? OPEN_MARK : FOLDED_MARK, ...joined(parts)], hang: INDENT }
  const block: Block = { key: FLOW_KEY, rows: [head], folds: FLOW_KEY, opensSection: true }
  return open ? { ...block, card: flowRows(view, width) } : block
}

/**
 * The Stats tab `width` cells wide: the scope and range rows, a WARN line for each team folder the last read could not
 * read, the Health tiles and the Flow section, open or folded by `toggled` against OPEN_SECTIONS; or why none show.
 */
export function statsBlocks(view: StatsView, toggled: readonly string[], width: number): Block[] {
  switch (view.kind) {
    case 'reading':
      return [note('Reading the registers…')]
    case 'no-team':
      return [note("No team found: the Stats tab folds the registers of the tree of teams the session's team is in.")]
    case 'failed':
      return [single(`${VIEW}:note`, [{ text: `The registers could not be read: ${view.reason.replace(/\.$/, '')}.`, color: 'warning' }])]
    case 'stats':
      return [
        { key: `${VIEW}:pick`, rows: [scopeRow(view.scope, view.teams), rangeRow(view.range)] },
        ...view.failures.map(failure => failureBlock(VIEW, failure)),
        healthBlock(view.health, view.week, width),
        flowBlock(view, isSectionOpen(FLOW_KEY, toggled), width),
      ]
  }
}
