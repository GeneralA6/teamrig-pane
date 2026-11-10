// The Stats tab's Goals section (T1420, the T1419 design's goals mockup): each goal of the scope's teams and those above
// them (stats-source.ts goalsOf) over its whole history, whatever the range. A foldable section (stats-parts.ts
// sectionBlock) closed by default, its header naming the goals at risk and late, else counting them. Open, a dim
// header row over the columns, then a row a goal: its tag, a timeline on one axis for every goal (`░` the days from
// its start to its target, `█` a day a task of it was done, `│` today), its done of all its tasks, its forecast and
// its state in its colour; a press on a goal's row opens its card under it: its title, its days and parent, each
// move of its target, its pace and its tasks. Under the goals, the share of the range's done tasks that served none.
// Pure.
import type { StatsGoal, StatsGoals, StatsListRow, StatsView } from '../types'
import type { ThemeKey } from 'claude-code'
import { GOAL_PACE_DAYS, type GoalSlip, type GoalState, type TimeZone } from './core/read/index'
import { FOLDED_MARK, OPEN_MARK, SEPARATOR, titleRow, type Block, type Row, type Span } from './rows'
import { dim, HANG, INDENT, noteRow, padded, percent, plural, sectionBlock, title, VIEW } from './stats-parts'
import { cells } from './width'
import { dayOf } from './zone'

export const GOALS_KEY = `${VIEW}:goals`
/** The off-goal line's key, under the goals. */
export const OFF_GOAL_KEY = `${GOALS_KEY}:off`
/** The fewest cells a timeline draws in; on a narrower row the timeline and its gap are left out. */
export const MIN_TIMELINE_CELLS = 8
/** The fewest cells the timeline's header holds both its first and last day in: `10-01 10-31` and a blank. */
export const BOTH_DAYS_CELLS = 11
/** A timeline cell's glyph: today's, a day a task of the goal was done, a day between its start and its target. */
export const TODAY_GLYPH = '│'
export const DONE_GLYPH = '█'
export const PLANNED_GLYPH = '░'
/** The goal states the section's header names, as `teamrig stats` does on its GOALS line; the others it only counts. */
const NAMED_STATES: readonly GoalState[] = ['at risk', 'late']
/** A state's colour in a goal's row; a done goal's state is dim. */
const STATE_COLOR: Readonly<Record<Exclude<GoalState, 'done'>, ThemeKey>> = { late: 'error', 'at risk': 'warning', 'on track': 'success' }
/** Between a goal row's columns. */
const GAP = 2
const DAY_MS = 86_400_000
/** The header row's words over each column. */
const HEADS = { tag: 'goal', done: 'done', forecast: 'forecast', state: 'state' } as const

/** The `stats` view's numbers. */
type Folded = Extract<StatsView, { kind: 'stats' }>
/** The cells of a goal row's columns; `timeline` is 0 when the row has no room for one. */
type Columns = { readonly tag: number; readonly timeline: number; readonly done: number; readonly forecast: number; readonly state: number }
/** The timeline's days, from `first` over `days` of them, and today's day. */
type Axis = { readonly first: string; readonly days: number; readonly today: string }

/** Days from `from` to `to`, both `YYYY-MM-DD`: 0 for the same day. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS)
}

/** The day `days` after `day`. */
function dayAfter(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

/** A goal's state in words: a late goal counts the days past its target. */
export function stateWords(goal: StatsGoal, today: string): string {
  return goal.state === 'late' ? `late ${daysBetween(goal.target, today)} d` : goal.state
}

function stateSpan(goal: StatsGoal, words: string): Span {
  return goal.state === 'done' ? dim(words) : { text: words, color: STATE_COLOR[goal.state] }
}

function doneWords(goal: StatsGoal): string {
  return `${goal.done}/${goal.done + goal.open}`
}

/** A day as the forecast column shows it: `10-31`, or `—` for none. */
function shortDay(day: string | null): string {
  return day === null ? '—' : day.slice(5)
}

/** The section header's parts after its title: the goals at risk and late, else how many goals there are. */
function headCounts(goals: readonly StatsGoal[]): string[] {
  if (goals.length === 0) return ['no goals']
  const named = NAMED_STATES.flatMap(state => {
    const count = goals.filter(goal => goal.state === state).length
    return count === 0 ? [] : [`${count} ${state}`]
  })
  return named.length > 0 ? named : [`${goals.length} ${plural(goals.length, 'goal', 'goals')}`]
}

/** The days every goal's timeline spans: the earliest start, done day or today, to the latest target, forecast or today. */
function axisOf({ goals, today }: StatsGoals): Axis {
  const starts = goals.flatMap(goal => [goal.start, ...goal.doneDays.map(each => each.day)])
  const ends = goals.flatMap(goal => (goal.forecast === null ? [goal.target] : [goal.target, goal.forecast]))
  const first = [today, ...starts].reduce((a, b) => (b < a ? b : a))
  const last = [today, ...ends].reduce((a, b) => (b > a ? b : a))
  return { first, days: daysBetween(first, last) + 1, today }
}

/** The cells of each column `width` cells leave, the timeline taking what the others do not, up to a cell a day. */
function columnsOf(view: StatsGoals, axis: Axis, width: number): Columns {
  const tag = Math.max(cells(HEADS.tag), ...view.goals.map(goal => cells(goal.tag)))
  const done = Math.max(cells(HEADS.done), ...view.goals.map(goal => cells(doneWords(goal))))
  const forecast = cells(HEADS.forecast)
  const state = Math.max(cells(HEADS.state), ...view.goals.map(goal => cells(stateWords(goal, view.today))))
  const free = width - cells(INDENT.text) - cells(FOLDED_MARK.text) - tag - done - forecast - state - 4 * GAP
  const timeline = Math.min(axis.days, free)
  return { tag, timeline: timeline < MIN_TIMELINE_CELLS ? 0 : timeline, done, forecast, state }
}

/**
 * A goal's timeline in `count` cells over `axis`, cell i covering its days from floor(i·days/count) to the next
 * cell's: `│` on today's cell, else `█` where a task of it was done, else `░` inside its start to its target, else a blank.
 */
export function timeline(goal: Pick<StatsGoal, 'start' | 'target' | 'doneDays'>, axis: Axis, count: number): string {
  const done = new Set(goal.doneDays.map(each => daysBetween(axis.first, each.day)))
  const start = daysBetween(axis.first, goal.start)
  const target = daysBetween(axis.first, goal.target)
  const today = daysBetween(axis.first, axis.today)
  return Array.from({ length: count }, (_, i) => {
    const from = Math.floor((i * axis.days) / count)
    const to = Math.floor(((i + 1) * axis.days) / count)
    if (today >= from && today < to) return TODAY_GLYPH
    for (let day = from; day < to; day++) if (done.has(day)) return DONE_GLYPH
    return from <= target && to - 1 >= start ? PLANNED_GLYPH : ' '
  }).join('')
}

/** The timeline column's header: its first day at the left and its last at the right, or the first alone where both do not fit. */
function axisHead(axis: Axis, count: number): string {
  const first = axis.first.slice(5)
  if (count < BOTH_DAYS_CELLS) return first
  const last = dayAfter(axis.first, axis.days - 1).slice(5)
  return first + ' '.repeat(count - cells(first) - cells(last)) + last
}

/** A row's columns, GAP apart, a column of no cells and its gap left out; the last one unpadded. */
function columnSpans(parts: readonly { readonly span: Span; readonly cells: number }[]): Span[] {
  const shown = parts.filter(part => part.cells > 0)
  return shown.map((part, i) => (i === shown.length - 1 ? part.span : { ...part.span, text: padded(part.span.text, part.cells + GAP) }))
}

function headerRow(axis: Axis, columns: Columns): Row {
  const spans = columnSpans([
    { span: dim(HEADS.tag), cells: columns.tag },
    { span: dim(axisHead(axis, columns.timeline)), cells: columns.timeline },
    { span: dim(HEADS.done), cells: columns.done },
    { span: dim(HEADS.forecast), cells: columns.forecast },
    { span: dim(HEADS.state), cells: columns.state },
  ])
  return { key: `${GOALS_KEY}:head`, spans: [INDENT, { text: ' '.repeat(cells(FOLDED_MARK.text)) }, ...spans], hang: HANG }
}

function goalRow(key: string, goal: StatsGoal, open: boolean, view: StatsGoals, axis: Axis, columns: Columns): Row {
  const spans = columnSpans([
    { span: { text: goal.tag, bold: true }, cells: columns.tag },
    { span: { text: timeline(goal, axis, columns.timeline), color: 'claude' }, cells: columns.timeline },
    { span: { text: doneWords(goal) }, cells: columns.done },
    { span: dim(shortDay(goal.forecast)), cells: columns.forecast },
    { span: stateSpan(goal, stateWords(goal, view.today)), cells: columns.state },
  ])
  return { key, spans: [INDENT, open ? OPEN_MARK : FOLDED_MARK, ...spans], hang: HANG }
}

/** A move of the goal's target: `moved from 10-31 to 11-15 on 2026-10-20 by lead: scope grew`. */
function slipWords(slip: GoalSlip, zone: TimeZone): string {
  return `moved from ${slip.from} to ${slip.to} on ${dayOf(Date.parse(slip.at), zone)} by ${slip.by}${slip.note === '' ? '' : `: ${slip.note}`}`
}

function cardLine(key: string, spans: readonly Span[]): Row {
  return { key, spans: [HANG, ...spans], hang: HANG }
}

/** A task of the goal, under HANG: its status glyph, id and title on one line. */
function taskRow(key: string, row: StatsListRow): Row {
  const drawn = titleRow(`${key}:${row.team}/${row.id}`, row, 1)
  return { ...drawn, spans: [HANG, ...drawn.spans] }
}

/** A goal's open card: its title, its days and parent, each move of its target, its pace and its tasks. */
function cardRows(key: string, goal: StatsGoal, zone: TimeZone): Row[] {
  const parent: Span[] = goal.parent === null ? [] : [SEPARATOR, dim(`parent ${goal.parent}`)]
  const pace = `pace ${goal.pace.toFixed(1)} a day over ${GOAL_PACE_DAYS} d`
  return [
    cardLine(`${key}:title`, [title(goal.title)]),
    cardLine(`${key}:days`, [dim(`${goal.start} → ${goal.target}`), ...parent]),
    ...goal.slips.map((slip, i) => cardLine(`${key}:slip:${i}`, [dim(slipWords(slip, zone))])),
    cardLine(`${key}:pace`, [dim(pace)]),
    ...goal.rows.map(row => taskRow(key, row)),
  ]
}

/** The off-goal line: `off goal: 750 of 774 done tasks (97%)`, or `no task done` in a range with none. */
export function offGoalWords({ offGoal, doneInRange }: StatsGoals): string {
  return `off goal: ${doneInRange === 0 ? 'no task done' : `${offGoal} of ${doneInRange} done tasks (${percent(offGoal, doneInRange)})`}`
}

/**
 * The Goals section `width` cells wide: its header, and while it is open (`isOpen` of GOALS_KEY) a block a goal under
 * it, each a press that opens its card (`isOpen` of its key), and the off-goal line. A slip's day is read in `zone`.
 */
export function goalBlocks(view: Folded, isOpen: (key: string) => boolean, width: number, zone: TimeZone): Block[] {
  const goals = view.stats.goals
  const head = [title('Goals'), ...headCounts(goals.goals).map(count => ({ text: count }))]
  if (!isOpen(GOALS_KEY)) return [sectionBlock(GOALS_KEY, head, null)]
  const offGoal: Block = { key: OFF_GOAL_KEY, rows: [noteRow(OFF_GOAL_KEY, offGoalWords(goals))], joined: true }
  if (goals.goals.length === 0) return [sectionBlock(GOALS_KEY, head, [noteRow(`${GOALS_KEY}:none`, 'No goals: teamrig goal add sets one.')]), offGoal]
  const axis = axisOf(goals)
  const columns = columnsOf(goals, axis, width)
  const rows = goals.goals.map((goal): Block => {
    const key = `${GOALS_KEY}:${goal.tag}`
    const open = isOpen(key)
    const block: Block = { key, rows: [goalRow(key, goal, open, goals, axis, columns)], folds: key, joined: true }
    return open ? { ...block, card: cardRows(key, goal, zone) } : block
  })
  return [sectionBlock(GOALS_KEY, head, [headerRow(axis, columns)]), ...rows, offGoal]
}
