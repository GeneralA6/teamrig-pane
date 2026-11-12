// The Stats tab's Bottlenecks section (T1866): the areas whose work piles up, teams against teams and sessions against
// sessions, from teamrig's areas fold (stats-areas.ts makes it slim). Each group is a table: an area a row, its active
// tasks, then its bugs, p1, late p1, low-priority share and long waits; a cell high against the others and its own
// usual carries a red ▲, high against one an amber △, as `teamrig stats` marks them. A cell with tasks is a press that
// lists them, an area's name a press that scopes the tab to it. BOTTLENECK_ROWS areas a group, a dim median row and a
// line counting the rest; a pane too narrow for the table draws a line an area. It stands alone so a later redesign of
// the tab can move it. Pure.
import type { StatsArea, StatsAreaCell, StatsAreaGroup, StatsChoice, StatsView } from '../types'
import { AREA_MEASURE_LABELS, AREA_MEASURES, type AreaMeasure, type HealthLevel } from './core/read/index'
import { SEPARATOR, type Row, type Span } from './rows'
import { dim, HANG, INDENT, noteRow, padded, plural, title, VIEW } from './stats-parts'
import { cells } from './width'

export const BOTTLENECKS_KEY = `${VIEW}:bottlenecks`
/** The most areas a group draws a row for; a dim line counts the rest. */
export const BOTTLENECK_ROWS = 6
/** Between the table's columns. */
const GAP = 2

/** The `stats` view's numbers. */
type Folded = Extract<StatsView, { kind: 'stats' }>
/** A group the section draws: its words in the table's first column, and its areas. */
type Shown = { readonly name: 'teams' | 'sessions'; readonly group: StatsAreaGroup }

/** A cell's mark by its level: none for good, so a calm cell reads plain. */
const MARKS: Readonly<Record<HealthLevel, Span | null>> = {
  good: null,
  warn: { text: '△', color: 'warning' },
  bad: { text: '▲', color: 'error' },
}

/** The groups to draw: the teams only when there is more than one to hold against each other, then the sessions. */
function shownGroups(view: Folded): Shown[] {
  const { teams, sessions } = view.stats.areas
  return [...(teams.areas.length > 1 ? [{ name: 'teams' as const, group: teams }] : []), { name: 'sessions' as const, group: sessions }]
}

export function bottlenecksHead(view: Folded): Span[] {
  const shown = shownGroups(view)
  if (shown.every(each => each.group.areas.length === 0)) return [title('Bottlenecks'), { text: 'no active tasks' }]
  const out = shown.reduce((sum, each) => sum + each.group.areas.filter(area => area.standsOut).length, 0)
  return [title('Bottlenecks'), { text: out === 0 ? 'none stands out' : `${out} ${plural(out, 'area stands', 'areas stand')} out` }]
}

/** A value as the table writes it: the low-priority share in percent, every other a count. */
function valueText(measure: AreaMeasure | 'active', value: number): string {
  return measure === 'low' ? `${value}%` : `${value}`
}

/** A cell's value, a press listing its tasks when it has any, then its mark. */
function cellSpans(area: StatsArea, measure: AreaMeasure): Span[] {
  const cell: StatsAreaCell = area.cells[measure]
  const text = valueText(measure, cell.value)
  const value: Span = cell.listed > 0 ? { text, stats: { kind: 'list', list: { team: area.team, session: area.session, measure } } } : { text }
  const mark = MARKS[cell.level]
  return mark === null ? [value] : [value, mark]
}

/** The scope an area's name picks. */
function scopeOf(area: StatsArea): StatsChoice {
  return area.session === null ? { kind: 'team', team: area.team } : { kind: 'session', team: area.team, session: area.session }
}

/** Whether `area` is the scope the tab folds now, where its name is no press. */
function isScope(area: StatsArea, scope: StatsChoice): boolean {
  if (area.session === null) return scope.kind === 'team' && scope.team === area.team
  return scope.kind === 'session' && scope.team === area.team && scope.session === area.session
}

/** An area's name: its team's, or its session's, with the team when the teams show too. */
function areaName(area: StatsArea, withTeam: boolean): string {
  if (area.session === null) return area.team
  return withTeam ? `${area.team}/${area.session}` : area.session
}

/** An area's name as a press that scopes the tab to it, but on its own scope. */
function nameSpan(area: StatsArea, text: string, scope: StatsChoice): Span {
  return isScope(area, scope) ? { text } : { text, stats: { kind: 'scope', scope: scopeOf(area) } }
}

/** A row's key among the section's: the group, then the area's `<team>/<session>`. */
function areaKey(name: Shown['name'], area: StatsArea): string {
  return `${BOTTLENECKS_KEY}:${name}:${area.team}/${area.session ?? ''}`
}

/** `spans` padded with blanks to `width` cells. */
function paddedSpans(spans: readonly Span[], width: number): Span[] {
  const used = spans.reduce((sum, span) => sum + cells(span.text), 0)
  return used >= width ? [...spans] : [...spans, { text: ' '.repeat(width - used) }]
}

/** The shown areas as a table under a dim header, then a dim median row; null when it is wider than `width`. */
function areaTable(shown: Shown, areas: readonly StatsArea[], names: readonly string[], scope: StatsChoice, width: number): Row[] | null {
  const { name: group, group: numbers } = shown
  const key = `${BOTTLENECKS_KEY}:${group}`
  const labels = ['active', ...AREA_MEASURES.map(measure => AREA_MEASURE_LABELS[measure])]
  const median = [`${numbers.median.active}`, ...AREA_MEASURES.map(measure => valueText(measure, numbers.median[measure]))]
  const columns = areas.map((area): Span[][] => [[{ text: `${area.active}` }], ...AREA_MEASURES.map(measure => cellSpans(area, measure))])
  const widest = columns.flat().map(spans => spans.reduce((sum, span) => sum + cells(span.text), 0))
  const first = Math.max(cells(group), cells('median'), ...names.map(each => cells(each))) + GAP
  const column = Math.max(...[...labels, ...median].map(text => cells(text)), ...widest) + GAP
  if (cells(INDENT.text) + first + labels.length * column - GAP > width) return null
  const line = (parts: readonly string[]): string => parts.map(part => padded(part, column)).join('').trimEnd()
  const rows = areas.map((area, index): Row => {
    const parts = columns[index] ?? []
    const values = parts.flatMap((spans, at) => (at === parts.length - 1 ? spans : paddedSpans(spans, column)))
    return { key: areaKey(group, area), spans: [INDENT, ...paddedSpans([nameSpan(area, names[index] ?? area.team, scope)], first), ...values] }
  })
  return [
    { key: `${key}:head`, spans: [INDENT, dim(`${padded(group, first)}${line(labels)}`)] },
    ...rows,
    { key: `${key}:median`, spans: [INDENT, dim(`${padded('median', first)}${line(median)}`)] },
  ]
}

/** The shown areas a line each, for a pane too narrow for the table: `api  active 102 · bugs 17▲ · ...`. */
function areaLines(shown: Shown, areas: readonly StatsArea[], names: readonly string[], scope: StatsChoice): Row[] {
  const { name: group, group: numbers } = shown
  const lines = areas.map((area, index): Row => {
    const parts: Span[][] = [[{ text: `active ${area.active}` }], ...AREA_MEASURES.map(measure => [{ text: `${AREA_MEASURE_LABELS[measure]} ` }, ...cellSpans(area, measure)])]
    return {
      key: areaKey(group, area),
      spans: [INDENT, nameSpan(area, names[index] ?? area.team, scope), { text: '  ' }, ...parts.flatMap((part, at) => (at === 0 ? part : [SEPARATOR, ...part]))],
      hang: HANG,
    }
  })
  const median = [`active ${numbers.median.active}`, ...AREA_MEASURES.map(measure => `${AREA_MEASURE_LABELS[measure]} ${valueText(measure, numbers.median[measure])}`)]
  return [...lines, { key: `${BOTTLENECKS_KEY}:${group}:median`, spans: [INDENT, dim(`median  ${median.join(' · ')}`)], hang: HANG }]
}

/** A group's first BOTTLENECK_ROWS areas as a table where it fits, else a line each, then a line counting the rest. */
function groupRows(shown: Shown, withTeam: boolean, scope: StatsChoice, width: number): Row[] {
  const { name: group, group: numbers } = shown
  const areas = numbers.areas.slice(0, BOTTLENECK_ROWS)
  const names = areas.map(area => areaName(area, withTeam))
  const rows = areaTable(shown, areas, names, scope, width) ?? areaLines(shown, areas, names, scope)
  const rest = numbers.areas.length - areas.length
  const noun = group === 'teams' ? plural(rest, 'team', 'teams') : plural(rest, 'session', 'sessions')
  return rest > 0 ? [...rows, noteRow(`${BOTTLENECKS_KEY}:${group}:more`, `${rest} more ${noun}`)] : rows
}

/** Each shown group's areas, teams first; a note when no area has an active task. */
export function bottlenecksRows(view: Folded, width: number): Row[] {
  const shown = shownGroups(view).filter(each => each.group.areas.length > 0)
  if (shown.length === 0) return [noteRow(`${BOTTLENECKS_KEY}:none`, 'No task is active.')]
  const withTeam = shown.some(each => each.name === 'teams')
  return shown.flatMap(each => groupRows(each, withTeam, view.scope, width))
}
