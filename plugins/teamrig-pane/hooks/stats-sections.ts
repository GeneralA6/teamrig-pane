// The Stats tab's sections after Flow (T1859, the T1419 design's increment 4): New work, Speed, Delays, Waits, Bugs
// and People, each a foldable section (stats-parts.ts sectionBlock) closed by default, its header alone answering the
// glance; a press opens its rows. New work: where the range's new tasks came from as a share bar, their type,
// priority and goal. Speed: each team's lead and cycle time (median and p85) as a table, or a line a team where the
// table does not fit, and the active tasks by age. Delays: the overdue tasks, each count a press that lists them (the
// Health tiles' lists, T1864), the share done by its due date as a bar a team, the days late and the moved dues.
// Waits: the waiting tasks by what they wait on as a share bar, and the owner's decisions, a press that lists them.
// Bugs: the bugs opened and fixed as bars on one scale, their share of new work and the dropped share of the closes.
// People: the sessions that closed the most tasks done, PEOPLE_ROWS of them, each name a press that scopes the tab to
// that session. Every number is teamrig's stats fold of the scope and range (stats-source.ts). Pure.
import type { StatsListKind, StatsView } from '../types'
import { joined } from './card'
import { priorityText, WAIT_KINDS, WORK_SOURCES, type Band, type PersonDone, type Spread, type StatsRange, type TeamStats, type WaitKind, type WorkSource } from './core/read/index'
import { SEPARATOR, type Block, type Row, type Span } from './rows'
import { bar } from './stats-chart'
import { daysText, dim, INDENT, noteRow, padded, percent, plural, rangeLabel, sectionBlock, title, VIEW } from './stats-parts'
import { cells } from './width'

export const NEW_KEY = `${VIEW}:new`
export const SPEED_KEY = `${VIEW}:speed`
export const DELAYS_KEY = `${VIEW}:delays`
export const WAITS_KEY = `${VIEW}:waits`
export const BUGS_KEY = `${VIEW}:bugs`
export const PEOPLE_KEY = `${VIEW}:people`
/** The most cells a share bar takes, as the T1419 mockups draw it. */
export const MAX_SHARE_CELLS = 40
/** The bounds of a count bar, in cells. */
export const MIN_BAR_CELLS = 4
export const MAX_BAR_CELLS = 20
/** The most sessions the People section draws a row for; a dim line counts the rest. */
export const PEOPLE_ROWS = 8
/** Between a row's label and its value, and between a table's columns. */
const GAP = 2

/** The `stats` view's numbers. */
type Folded = Extract<StatsView, { kind: 'stats' }>
/** How a bar draws. */
type Look = Omit<Span, 'text'>
/** A part of a share bar: its count, the glyph its cells draw in, and its words in the legend. */
type Share = { readonly count: number; readonly glyph: string; readonly words: string }
/** A section: its key, its header's parts after the fold mark, and its rows while open. */
type Section = { readonly key: string; readonly head: (view: Folded) => Span[]; readonly rows: (view: Folded, width: number) => Row[] }

/** Who asked for new work, in the legend's words, each with its glyph in the source bar. */
const SOURCE_SHARES: Readonly<Record<WorkSource, Omit<Share, 'count'>>> = {
  self: { glyph: '▓', words: 'self-made' },
  session: { glyph: '▒', words: 'another session' },
  owner: { glyph: '█', words: 'owner' },
  lead: { glyph: '░', words: 'lead' },
  github: { glyph: '▞', words: 'GitHub' },
}
/** What a task waits on, in the legend's words, each with its glyph in the wait bar. */
const WAIT_SHARES: Readonly<Record<WaitKind, Omit<Share, 'count'>>> = {
  task: { glyph: '▒', words: 'another task' },
  time: { glyph: '░', words: 'a time' },
  approval: { glyph: '█', words: 'an approval' },
  decision: { glyph: '▓', words: 'a decision' },
}
const OPENED_LOOK: Look = { color: 'warning' }
const DONE_LOOK: Look = { color: 'success' }

/**
 * `counts` shared out over `width` cells by the largest remainder, so the cells add up to `width`; a tie goes to the
 * earlier count, and all zero (or no room) draws none.
 */
export function shareCells(counts: readonly number[], width: number): number[] {
  const total = counts.reduce((sum, count) => sum + count, 0)
  if (total <= 0 || width <= 0) return counts.map(() => 0)
  const exact = counts.map(count => (count * width) / total)
  const floors = exact.map(value => Math.floor(value))
  const left = width - floors.reduce((sum, floor) => sum + floor, 0)
  const ranked = exact.map((value, index) => ({ index, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest || a.index - b.index)
  const extra = new Set(ranked.slice(0, left).map(rank => rank.index))
  return floors.map((floor, index) => floor + (extra.has(index) ? 1 : 0))
}

/** The range after a count: `in 7 d`, `in all days`. */
function rangeWords(range: StatsRange): string {
  return range === 'all' ? 'in all days' : `in ${rangeLabel(range)}`
}

/** The cells a label column takes: its widest label and the gap after it. */
function labelCells(labels: readonly string[]): number {
  return Math.max(...labels.map(label => cells(label))) + GAP
}

/** A row under INDENT: its dim label padded to `width` cells, then its value; a wrapped line starts under the value. */
function labelled(key: string, label: string, width: number, spans: readonly Span[]): Row {
  return { key, spans: [INDENT, dim(padded(label, width)), ...spans], hang: { text: ' '.repeat(cells(INDENT.text) + width) } }
}

/** A count bar's cells: what `free` cells leave, within MIN_BAR_CELLS and MAX_BAR_CELLS. */
function barCells(free: number): number {
  return Math.min(MAX_BAR_CELLS, Math.max(MIN_BAR_CELLS, free))
}

/** `value` as a bar on `top`'s scale in `look`, then the value. */
function countBar(value: number, top: number, width: number, look: Look): Span[] {
  const drawn = bar(value, top, width)
  return drawn === '' ? [{ text: `${value}` }] : [{ text: drawn, ...look }, { text: ` ${value}` }]
}

/** Each band's label and count: `<2 d 117 · 2-7 d 174`. */
function bandSpans(bands: readonly Band[]): Span[] {
  return joined(bands.map((band): Span => ({ text: `${band.label} ${band.count}` })))
}

/** The parts with any count, most first (a tie in the given order). */
function sharesOf<K extends string>(keys: readonly K[], counts: Readonly<Record<K, number>>, looks: Readonly<Record<K, Omit<Share, 'count'>>>): Share[] {
  return keys
    .map((key): Share => ({ count: counts[key], ...looks[key] }))
    .filter(share => share.count > 0)
    .sort((a, b) => b.count - a.count)
}

/** A share bar's runs, each part's glyph over its cells of `width`; a part too small for a cell draws none. */
function shareSpans(shares: readonly Share[], width: number): Span[] {
  const widths = shareCells(
    shares.map(share => share.count),
    width,
  )
  return shares.flatMap((share, index): Span[] => {
    const run = widths[index] ?? 0
    return run > 0 ? [{ text: share.glyph.repeat(run) }] : []
  })
}

/** A share bar's legend: each part's glyph, then its words and count dim. */
function legendSpans(shares: readonly Share[]): Span[] {
  return shares.flatMap((share, index): Span[] => [...(index === 0 ? [] : [SEPARATOR]), { text: share.glyph }, dim(` ${share.words} ${share.count}`)])
}

/** `text` as a press that lists `list`'s tasks, or plain words when it counts none. */
function listPart(text: string, count: number, list: StatsListKind): Span {
  return count > 0 ? { text, stats: { kind: 'list', list } } : { text }
}

function newWorkHead(view: Folded): Span[] {
  const { total, noGoal } = view.stats.newWork
  return [title('New work'), { text: `${total} ${rangeWords(view.range)}` }, ...(total > 0 ? [{ text: `${noGoal} with no goal` }] : [])]
}

/** Where the new tasks came from as a share bar over its legend, then their type, priority and goal. */
function newWorkRows(view: Folded, width: number): Row[] {
  const { newWork } = view.stats
  const key = NEW_KEY
  if (newWork.total === 0) return [noteRow(`${key}:none`, `No task was created ${rangeWords(view.range)}.`)]
  const column = labelCells(['source', 'type', 'priority', 'no goal'])
  const shares = sharesOf(WORK_SOURCES, newWork.bySource, SOURCE_SHARES)
  const room = Math.max(1, Math.min(MAX_SHARE_CELLS, width - cells(INDENT.text) - column))
  const priorities = newWork.byPriority.map((each, index): Span => ({ text: `${priorityText(each.priority)} ${each.count}${index === 0 ? ` (${percent(each.count, newWork.total)})` : ''}` }))
  return [
    labelled(`${key}:source`, 'source', column, shareSpans(shares, room)),
    labelled(`${key}:legend`, '', column, legendSpans(shares)),
    labelled(`${key}:type`, 'type', column, joined([{ text: `bug ${newWork.bugs} (${percent(newWork.bugs, newWork.total)})` }, { text: `other ${newWork.total - newWork.bugs}` }])),
    labelled(`${key}:priority`, 'priority', column, joined(priorities)),
    labelled(`${key}:goal`, 'no goal', column, [{ text: `${newWork.noGoal} of ${newWork.total}` }]),
  ]
}

/** A spread's value as a table cell: `1.5 d`, or `-` with nothing to measure. */
function spreadText(value: number | null): string {
  return value === null ? '-' : daysText(value)
}

function speedHead(view: Folded): Span[] {
  const { teams, neverStarted } = view.stats
  const medians = teams.flatMap(team => (team.leadTime.median === null ? [] : [team.leadTime.median]))
  const never = neverStarted > 0 ? [{ text: `${neverStarted} never started` }] : []
  if (medians.length === 0) return [title('Speed'), { text: `none done ${rangeWords(view.range)}` }]
  const low = Math.min(...medians).toFixed(1)
  const high = Math.max(...medians).toFixed(1)
  return [title('Speed'), { text: `lead time median ${low === high ? low : `${low}-${high}`} d` }, ...never]
}

/** Each team's lead and cycle time as `teamrig stats` names them: median, then p85. */
function speedCells(team: TeamStats): readonly string[] {
  const spread = (each: Spread): string[] => [spreadText(each.median), spreadText(each.p85)]
  return [...spread(team.leadTime), ...spread(team.cycleTime)]
}

/** The teams' lead and cycle times as a table under two header rows; null when it is wider than `width`. */
function speedTable(teams: readonly TeamStats[], width: number): Row[] | null {
  const key = `${SPEED_KEY}:table`
  const values = teams.map(speedCells)
  const name = Math.max(...teams.map(team => cells(team.team))) + GAP
  const column = Math.max(cells('median'), ...values.flat().map(value => cells(value))) + GAP
  if (cells(INDENT.text) + name + 4 * column - GAP > width) return null
  const lead = ' '.repeat(name)
  const line = (parts: readonly string[]): string => parts.map(part => padded(part, column)).join('').trimEnd()
  return [
    { key: `${key}:head`, spans: [INDENT, dim(`${lead}${padded('lead time', 2 * column)}cycle time`)] },
    { key: `${key}:units`, spans: [INDENT, dim(`${lead}${line(['median', 'p85', 'median', 'p85'])}`)] },
    ...teams.map((team, index): Row => ({ key: `${key}:${team.team}`, spans: [INDENT, { text: padded(team.team, name) }, { text: line(values[index] ?? []) }] })),
  ]
}

/** A spread in a line's words: `lead time 0.9 d, p85 4.6 d`, or `cycle time -` with nothing to measure. */
function spreadWords(label: string, spread: Spread): Span {
  return { text: spread.median === null ? `${label} -` : `${label} ${daysText(spread.median)}, p85 ${spreadText(spread.p85)}` }
}

/** The teams' lead and cycle times a line each, for a pane too narrow for the table. */
function speedLines(teams: readonly TeamStats[]): Row[] {
  const name = Math.max(...teams.map(team => cells(team.team))) + GAP
  return teams.map((team): Row => labelled(`${SPEED_KEY}:line:${team.team}`, team.team, name, joined([spreadWords('lead time', team.leadTime), spreadWords('cycle time', team.cycleTime)])))
}

/** Each team's lead and cycle time, a table where it fits, then the active tasks by age. */
function speedRows(view: Folded, width: number): Row[] {
  const { teams, activeByAge } = view.stats
  const done = teams.some(team => team.leadTime.count > 0)
  const times = done ? (speedTable(teams, width) ?? speedLines(teams)) : [noteRow(`${SPEED_KEY}:none`, `No task was done ${rangeWords(view.range)}.`)]
  return [...times, labelled(`${SPEED_KEY}:age`, 'active by age', labelCells(['active by age']), bandSpans(activeByAge))]
}

function delaysHead(view: Folded): Span[] {
  const { count, p1 } = view.stats.all.overdue
  return [title('Delays'), { text: `${count} overdue` }, ...(count > 0 ? [{ text: `p1 ${p1}` }] : [])]
}

/** A team's share done by its due date: a bar of the on-time part in green over the rest dim, the percent and counts. */
function dueRow(team: TeamStats, name: number, width: number): Row {
  const { onTime, total } = team.due
  const tail = `  ${percent(onTime, total).padStart(4)}  ${onTime} of ${total}`
  const run = barCells(width - 2 * cells(INDENT.text) - name - cells(tail))
  const filled = Math.round((onTime / total) * run)
  return {
    key: `${DELAYS_KEY}:due:${team.team}`,
    spans: [INDENT, INDENT, { text: padded(team.team, name) }, { text: '█'.repeat(filled), ...DONE_LOOK }, dim('░'.repeat(run - filled)), { text: tail }],
  }
}

/** The overdue tasks (each count a press listing them) and, with two teams or more, each team's; the share done by its due date; the days late; the moved dues. */
function delaysRows(view: Folded, width: number): Row[] {
  const { all, teams, lateDays, dueMoved } = view.stats
  const key = DELAYS_KEY
  const column = labelCells(['overdue', 'days late', 'due moved'])
  const perTeam = teams.map((team): Span => ({ text: `${team.team} ${team.overdue.count}${team.overdue.p1 > 0 ? ` (p1 ${team.overdue.p1})` : ''}` }))
  const teamRows = teams.length > 1 ? [labelled(`${key}:teams`, '', column, joined(perTeam))] : []
  const dated = teams.filter(team => team.due.total > 0)
  const name = Math.max(0, ...dated.map(team => cells(team.team))) + GAP
  const due =
    dated.length === 0
      ? [noteRow(`${key}:due`, `No task done ${rangeWords(view.range)} had a due date.`)]
      : [{ key: `${key}:due`, spans: [INDENT, dim(`done by its due date, of those done ${rangeWords(view.range)}`)], hang: INDENT }, ...dated.map(team => dueRow(team, name, width))]
  return [
    labelled(`${key}:overdue`, 'overdue', column, joined([listPart(`${all.overdue.count}`, all.overdue.count, 'overdue'), listPart(`p1 ${all.overdue.p1}`, all.overdue.p1, 'overdueP1')])),
    ...teamRows,
    ...due,
    labelled(`${key}:late`, 'days late', column, bandSpans(lateDays)),
    labelled(`${key}:moved`, 'due moved', column, [{ text: `${dueMoved} ${plural(dueMoved, 'task', 'tasks')} ${rangeWords(view.range)}` }]),
  ]
}

function waitsHead(view: Folded): Span[] {
  const { waiting, ownerDecisions } = view.stats.waits
  const oldest = ownerDecisions.oldestDays === null ? '' : `, oldest ${daysText(ownerDecisions.oldestDays)}`
  return [title('Waits'), { text: `${waiting} waiting` }, { text: `owner decisions ${ownerDecisions.count}${oldest}` }]
}

/** What the waiting tasks wait on as a share bar over its legend, a note when the kinds add past them, and the owner's decisions, a press that lists them. */
function waitsRows(view: Folded, width: number): Row[] {
  const { waiting, byKind, ownerDecisions } = view.stats.waits
  const key = WAITS_KEY
  const shares = sharesOf(WAIT_KINDS, byKind, WAIT_SHARES)
  const kinds = shares.reduce((sum, share) => sum + share.count, 0)
  const room = Math.max(1, Math.min(MAX_SHARE_CELLS, width - cells(INDENT.text)))
  const bars: Row[] =
    shares.length === 0
      ? [noteRow(`${key}:none`, 'No task is waiting.')]
      : [
          { key: `${key}:bar`, spans: [INDENT, ...shareSpans(shares, room)] },
          { key: `${key}:legend`, spans: [INDENT, ...legendSpans(shares)], hang: INDENT },
          ...(kinds > waiting ? [noteRow(`${key}:kinds`, `A task can wait on more than one thing, so these add up to ${kinds}.`)] : []),
        ]
  const { count, oldestDays } = ownerDecisions
  const oldest = oldestDays === null ? [] : [{ text: `, the oldest ${daysText(oldestDays)}` }]
  const owner: Row[] = count > 0 ? [{ key: `${key}:owner`, spans: [INDENT, listPart(`${count}`, count, 'ownerDecisions'), { text: ` ${plural(count, 'waits', 'wait')} on the owner's decision or approval` }, ...oldest], hang: INDENT }] : []
  return [...bars, ...owner]
}

function bugsHead(view: Folded): Span[] {
  const { active, opened, fixed } = view.stats.bugs
  return [title('Bugs'), { text: `${active} active` }, { text: `opened ${opened}, fixed ${fixed} ${rangeWords(view.range)}` }]
}

/** The bugs opened and fixed as bars on one scale, then their share of new work and the dropped share of the closes. */
function bugsRows(view: Folded, width: number): Row[] {
  const { bugs, newWork, droppedTasks, closedTasks } = view.stats
  const key = BUGS_KEY
  const column = labelCells(['opened', 'fixed'])
  const top = Math.max(bugs.opened, bugs.fixed)
  const run = barCells(width - cells(INDENT.text) - column - 1 - String(top).length)
  const shares: Span[] = [
    ...(newWork.total > 0 ? [{ text: `share of new work ${percent(newWork.bugs, newWork.total)}` }] : []),
    ...(closedTasks > 0 ? [{ text: `dropped ${droppedTasks} of ${closedTasks} closed ${rangeWords(view.range)} (${percent(droppedTasks, closedTasks)})` }] : []),
  ]
  return [
    labelled(`${key}:opened`, 'opened', column, countBar(bugs.opened, top, run, OPENED_LOOK)),
    labelled(`${key}:fixed`, 'fixed', column, countBar(bugs.fixed, top, run, DONE_LOOK)),
    ...(shares.length === 0 ? [] : [{ key: `${key}:shares`, spans: [INDENT, ...joined(shares)], hang: INDENT }]),
  ]
}

function peopleHead(view: Folded): Span[] {
  const { people } = view.stats
  if (people.length === 0) return [title('People'), { text: `none done ${rangeWords(view.range)}` }]
  return [title('People'), { text: `done ${rangeWords(view.range)}` }, { text: `${people.length} ${plural(people.length, 'session', 'sessions')}` }]
}

/** A session's name: its id, with its team when another team has a session of that id among `people`. */
function personName(person: PersonDone, people: readonly PersonDone[]): string {
  const shared = people.some(other => other.session === person.session && other.team !== person.team)
  return shared ? `${person.session} (${person.team})` : person.session
}

/** The PEOPLE_ROWS sessions that closed the most done, each its name (a press that scopes the tab to it, but on its own scope) and a bar; then a line counting the rest. */
function peopleRows(view: Folded, width: number): Row[] {
  const { people } = view.stats
  const key = PEOPLE_KEY
  if (people.length === 0) return [noteRow(`${key}:none`, `No session closed a task done ${rangeWords(view.range)}.`)]
  const shown = people.slice(0, PEOPLE_ROWS)
  const names = shown.map(person => personName(person, people))
  const top = Math.max(...shown.map(person => person.done))
  const name = Math.max(...names.map(each => cells(each))) + GAP
  const run = barCells(width - cells(INDENT.text) - name - 1 - String(top).length)
  const { scope } = view
  const rows = shown.map((person, index): Row => {
    const text = names[index] ?? person.session
    const own = scope.kind === 'session' && scope.team === person.team && scope.session === person.session
    const label: Span = own ? { text } : { text, stats: { kind: 'scope', scope: { kind: 'session', team: person.team, session: person.session } } }
    return { key: `${key}:${person.team}/${person.session}`, spans: [INDENT, label, { text: ' '.repeat(name - cells(text)) }, ...countBar(person.done, top, run, DONE_LOOK)] }
  })
  const rest = people.slice(PEOPLE_ROWS)
  const more = rest.length === 0 ? [] : [noteRow(`${key}:more`, `${rest.length} more ${plural(rest.length, 'session', 'sessions')}, ${rest.reduce((sum, person) => sum + person.done, 0)} done`)]
  return [...rows, ...more]
}

/** The sections in the order the tab draws them after Flow. */
const SECTIONS: readonly Section[] = [
  { key: NEW_KEY, head: newWorkHead, rows: newWorkRows },
  { key: SPEED_KEY, head: speedHead, rows: speedRows },
  { key: DELAYS_KEY, head: delaysHead, rows: delaysRows },
  { key: WAITS_KEY, head: waitsHead, rows: waitsRows },
  { key: BUGS_KEY, head: bugsHead, rows: bugsRows },
  { key: PEOPLE_KEY, head: peopleHead, rows: peopleRows },
]

/** The sections' keys, in the order the tab draws them. */
export const SECTION_KEYS: readonly string[] = SECTIONS.map(section => section.key)

/** The sections after Flow `width` cells wide, each open while `isOpen` says so: its header, and its rows as its card. */
export function sectionBlocks(view: Folded, isOpen: (key: string) => boolean, width: number): Block[] {
  return SECTIONS.map(section => sectionBlock(section.key, section.head(view), isOpen(section.key) ? section.rows(view, width) : null))
}
