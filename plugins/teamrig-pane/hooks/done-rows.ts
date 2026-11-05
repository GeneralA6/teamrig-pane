// The Done page's rows (done.ts pages the finished tasks a week at a time, each day's in the done groups): a head
// naming whose tasks, with how many the week holds done and dropped; then each day, newest first, a heading that
// folds it. The newest day starts open (`▾ Today so far · Sat 10-31 · 21 done`); a closed day counts what it holds
// (`▸ Fri 10-30 · 42 done · 10 owner asked · 2 for a goal · 18 p1`). Under an open day each group's heading
// (`Owner asked (4)`) folds its rows, Other work and Dropped closed at first; a group shows GROUP_ROWS rows, then
// `▸ n more`, which opens the rest in place. A row is `✓ T4  title    14:02 IDT` (the team zone's clock, as teamrig
// prints it; in the all view the owner before the time), a press that opens the task's page, as a search result
// does. A press on a heading flips its key against its default among the page's toggled keys (register.tsx
// doneToggled). The oldest week ends with where the pane stops holding finished tasks and the command that lists
// older ones (teamrig's `list --status done` reads the register's whole history). register.tsx draws the week steps
// (‹ prev, next ›) over it. Pure.
import type { Snapshot, TaskRow, ViewMode } from '../types'
import { doneGroupTitle, priorityText, URGENT_PRIORITY, type DoneGroupKind, type TimeZone } from './core/read/index'
import { doneWeek, weekClockOf, type DoneDay, type DoneWeek } from './done'
import { clockWords, dayWords, storedDayWords } from './meta'
import { FOLDED_MARK, GLYPH, GLYPH_COLOR, indentOf, OPEN_MARK, problemBlocks, readingBlock, single, TITLE_GAP, type Block, type Row, type Span } from './rows'

/** The command that lists the finished tasks the pane no longer holds. */
export const OLDER_DONE_COMMAND = 'teamrig list --status done,dropped'
/** How many rows a group shows before its `▸ n more`. */
export const GROUP_ROWS = 4
/** Leads a group's heading under its day. */
const GROUP_INDENT: Span = { text: '  ' }
/** Leads a group's rows and its `▸ n more`. */
const ROW_INDENT = '    '
/** The name a day's dropped tasks go by in their group's keys. */
const DROPPED = 'dropped'

/** `Mon 10-12`: the words a week goes by, its first day's; an unreadable week as written. */
export function weekWords(week: string): string {
  return storedDayWords(week) ?? week
}

/** A day's heading key (`done-day:2026-10-30`): a press opens or closes the day. */
export function dayKey(day: string): string {
  return `done-day:${day}`
}

/** A group's heading key under its day (`done-group:2026-10-30:owner`, a goal's by its tag, `…:dropped`). */
export function groupKey(day: string, group: string): string {
  return `done-group:${day}:${group}`
}

/** A group's `▸ n more` key: a press shows the group's rows past GROUP_ROWS. */
export function moreKey(day: string, group: string): string {
  return `done-more:${day}:${group}`
}

/** A fold's state: its default, flipped when its key is among the toggled ones. */
function isOpen(key: string, byDefault: boolean, toggled: ReadonlySet<string>): boolean {
  return byDefault !== toggled.has(key)
}

/**
 * `✓ T4  title    14:02 IDT`: a finished task under its group, dim, on one line with when it closed on the zone's
 * clock (`po 14:02 IDT` naming its owner).
 */
function doneRow(task: TaskRow, showOwner: boolean, zone: TimeZone): Block {
  const key = `done-page:${task.id}`
  const color = GLYPH_COLOR[task.status]
  const time = clockWords(task.statusAt, zone)
  const row: Row = {
    key,
    spans: [
      { text: ROW_INDENT },
      color === undefined ? { text: GLYPH[task.status], dim: true } : { text: GLYPH[task.status], color },
      { text: ` ${task.id}${TITLE_GAP}${task.title}`, dim: true },
    ],
    hang: { text: ROW_INDENT + indentOf(task).text },
    end: { text: showOwner ? `${task.owner} ${time}` : time, dim: true },
    maxLines: 1,
  }
  return { key, opens: task.id, rows: [row] }
}

/** `Done · po`, bold, and ` · 3 done · 1 dropped`, dim; the week is drawn over it, with its steps (register.tsx). */
function headBlock(who: string, week: DoneWeek): Block {
  return single('done-head', [{ text: `Done · ${who}`, bold: true }, { text: ` · ${week.done} done · ${week.dropped} dropped`, dim: true }])
}

/** A group a day lists: a done group or the dropped tasks, by its key's name, with its heading and default. */
type DayGroup = { name: string; title: string; tasks: readonly TaskRow[]; openByDefault: boolean }

/** A day's groups in the rule's order, then its dropped tasks; Other work and Dropped start closed. */
function dayGroups(day: DoneDay): DayGroup[] {
  const done = day.groups.groups.map(group => ({ name: group.goal ?? group.kind, title: doneGroupTitle(group), tasks: group.tasks, openByDefault: group.kind !== 'other' }))
  const { dropped } = day.groups
  return dropped.length === 0 ? done : [...done, { name: DROPPED, title: 'Dropped', tasks: dropped, openByDefault: false }]
}

/** How many of a day's done tasks its groups of `kind` hold. */
function countOf(day: DoneDay, kind: DoneGroupKind): number {
  return day.groups.groups.filter(group => group.kind === kind).reduce((sum, group) => sum + group.tasks.length, 0)
}

/** A closed day's counts, the nonzero ones after its done: `42 done · 10 owner asked · 2 for a goal · 18 p1 · 3 dropped`. */
function dayCounts(day: DoneDay): string {
  const parts: readonly (readonly [number, string])[] = [
    [countOf(day, 'owner'), 'owner asked'],
    [countOf(day, 'goal'), 'for a goal'],
    [countOf(day, 'urgent'), priorityText(URGENT_PRIORITY)],
    [day.groups.dropped.length, 'dropped'],
  ]
  return [`${day.groups.done} done`, ...parts.filter(([count]) => count > 0).map(([count, words]) => `${count} ${words}`)].join(' · ')
}

/** A group's heading, `Owner asked (4)`, and when open its rows: GROUP_ROWS of them, then `▸ n more` until pressed. */
function groupBlocks(day: string, group: DayGroup, toggled: ReadonlySet<string>, showOwner: boolean, zone: TimeZone): Block[] {
  const key = groupKey(day, group.name)
  const open = isOpen(key, group.openByDefault, toggled)
  const name: Span[] = [{ text: group.title }, { text: ` (${group.tasks.length})`, dim: true }]
  const blocks: Block[] = [{ key, folds: key, rows: [{ key, spans: open ? [GROUP_INDENT, ...name] : [GROUP_INDENT, FOLDED_MARK, ...name] }] }]
  if (!open) return blocks
  const more = moreKey(day, group.name)
  const shown = toggled.has(more) ? group.tasks : group.tasks.slice(0, GROUP_ROWS)
  blocks.push(...shown.map(task => doneRow(task, showOwner, zone)))
  const rest = group.tasks.length - shown.length
  if (rest > 0) blocks.push({ key: more, folds: more, rows: [{ key: more, spans: [{ text: ROW_INDENT }, FOLDED_MARK, { text: `${rest} more`, dim: true }] }] })
  return blocks
}

/** A day's heading (`Today so far · ` leading now's day) and, when open, its groups. */
function dayBlocks(day: DoneDay, openByDefault: boolean, toggled: ReadonlySet<string>, showOwner: boolean, zone: TimeZone): Block[] {
  const key = dayKey(day.day)
  const open = isOpen(key, openByDefault, toggled)
  const name: Span = { text: day.today ? `Today so far · ${day.words}` : day.words }
  const spans = open ? [OPEN_MARK, name, { text: ` · ${day.groups.done} done`, dim: true }] : [FOLDED_MARK, name, { text: ` · ${dayCounts(day)}`, dim: true }]
  const blocks: Block[] = [{ key, folds: key, rows: [{ key, spans }] }]
  if (!open) return blocks
  for (const group of dayGroups(day)) blocks.push(...groupBlocks(day.day, group, toggled, showOwner, zone))
  return blocks
}

/**
 * What the pane holds of the finished tasks before `heldFrom`: none, and the command that lists them; the time on the
 * zone's calendar and clock.
 */
export function heldText(heldFrom: number, zone: TimeZone): string {
  const at = zone.clock(new Date(heldFrom))
  return `The pane holds tasks finished since ${dayWords(heldFrom, zone)} ${at}; ${OLDER_DONE_COMMAND} lists older ones.`
}

/**
 * The Done page for `week`: the area's finished tasks in the mine view (every owner's when the session has no area),
 * every owner's in the all view; `toggled` the folds the person flipped against their default. The newest day starts
 * open.
 */
export function doneBlocks(snap: Snapshot, mode: ViewMode, week: string, toggled: readonly string[]): Block[] {
  const reading = readingBlock(snap)
  if (reading !== null) return [reading]
  const owner = mode === 'mine' ? snap.area : null
  const clock = weekClockOf(snap)
  const shown = doneWeek(snap.tasks, { owner, ownerMarker: snap.ownerSource }, week, clock)
  const flipped = new Set(toggled)
  const blocks: Block[] = [...problemBlocks(snap), headBlock(owner ?? 'all owners', shown)]
  const days = shown.days.flatMap((day, i) => dayBlocks(day, i === 0, flipped, owner === null, clock.zone))
  // One tight list under the head: a blank line between each of a week's many rows would halve what the page shows.
  blocks.push(...days.map((block, i) => (i === 0 ? block : { ...block, joined: true })))
  if (shown.days.length === 0) blocks.push(single('done-none', [{ text: 'Nothing finished this week.', dim: true }]))
  if (shown.heldFrom !== null) blocks.push({ ...single('done-held', [{ text: heldText(shown.heldFrom, clock.zone), dim: true }]), opensSection: true })
  return blocks
}
