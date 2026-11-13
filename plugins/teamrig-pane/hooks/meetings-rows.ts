// The Meetings view as blocks of rows (rows.ts, T1359): the team's scheduled and started meetings (meetings.ts) and
// those done or dropped on the team's day (T2455: the whole day's schedule, not only what is still to come), by time,
// under a header that counts them; one done or dropped on an earlier day is left out. A meeting's row is its mark, its id, when it starts on the team's clock, its
// length and the session met with those joining, and under it, dim, what it is about and the tasks it settles. The
// first scheduled one not missed is marked next (now, once its time came), a missed one (scheduled, its slot over
// with no start) in red, a started one says so, a done or dropped one dim. A press on a row opens or closes its card (`folds`): what it is about
// whole, who joins, each task it settles with its title and status (an id the register holds a press that opens its
// page), its brief (a press that opens the file) and, on a scheduled meeting, a [Start meeting] press (`starts`). What
// the last start press answered leads the list. Plain-text marks, never an emoji. Pure.
import type { Meeting, MeetingStart, MeetingsView, TaskRow } from '../types'
import { joined, labelled, textLines, type Lines } from './card'
import { fileLabel } from './details'
import { STATUS_WORDS } from './meta'
import { META_LINES, SEPARATOR, single, TITLE_GAP, type Block, type Row, type Span } from './rows'
import { cells } from './width'
import { dayOf, type Clock } from './zone'

const VIEW = 'meetings'
/** Starts each card line: the guide that ties the card to its meeting's row. */
const GUIDE: Span = { text: '    │ ', dim: true }
/** What a meeting's row leads with, by where it stands: each one cell of plain text. */
export const MEETING_MARK = { scheduled: '○', next: '›', missed: '!', started: '◐', done: '●', dropped: '×' } as const
/** The text of the press that starts a scheduled meeting. */
export const START_TEXT = '[Start meeting]'
/** What an empty schedule shows. */
export const NO_MEETINGS = 'No meetings scheduled: `teamrig meeting schedule` books one.'

/** Where a meeting stands in the list: the mark and the word its row shows. */
type Standing = keyof typeof MEETING_MARK

/** The key a meeting's block and its card are opened under: its id's. */
export function meetingKey(id: string): string {
  return `meeting:${id}`
}

function note(text: string): Block {
  return single(`${VIEW}:note`, [{ text, dim: true }])
}

/** `meeting`'s standing: done, dropped, started, missed, the next one (`next`'s id), or one more scheduled. */
function standingOf(meeting: Meeting, next: string | null): Standing {
  if (meeting.status !== 'scheduled') return meeting.status
  if (meeting.missed) return 'missed'
  return meeting.id === next ? 'next' : 'scheduled'
}

/** The word a standing adds to its row, in its color; none for one more scheduled meeting. */
function standingSpan(standing: Standing, meeting: Meeting, now: number): Span | null {
  switch (standing) {
    case 'started':
      return { text: 'started', color: 'warning' }
    case 'missed':
      return { text: 'missed', color: 'error' }
    case 'next':
      return { text: meeting.at <= now ? 'now' : 'next', color: 'claude' }
    case 'done':
    case 'dropped':
      return { text: standing, dim: true }
    case 'scheduled':
      return null
  }
}

/** The mark leading a meeting's row, in its standing's color. */
function markSpan(standing: Standing): Span {
  switch (standing) {
    case 'started':
      return { text: MEETING_MARK.started, color: 'warning' }
    case 'missed':
      return { text: MEETING_MARK.missed, color: 'error' }
    case 'next':
      return { text: MEETING_MARK.next, color: 'claude' }
    case 'done':
    case 'dropped':
    case 'scheduled':
      return { text: MEETING_MARK[standing], dim: true }
  }
}

/** The session met and those joining: `api with lead, po`. */
function whoWords(meeting: Meeting): string {
  return meeting.with.length === 0 ? meeting.session : `${meeting.session} with ${meeting.with.join(', ')}`
}

/** `○ M3  Tue 10-13 17:00 · 30 min · api with lead · next`: where a wrapped line starts, under the words after the id. */
function headRow(key: string, meeting: Meeting, standing: Standing, now: number): Row {
  const mark = markSpan(standing)
  const said = standingSpan(standing, meeting, now)
  const parts: Span[] = [{ text: meeting.atText }, { text: `${meeting.minutes} min`, dim: true }, { text: whoWords(meeting) }, ...(said === null ? [] : [said])]
  return { key, spans: [mark, { text: ` ${meeting.id}`, bold: true }, { text: TITLE_GAP }, ...joined(parts)], hang: indentOf(meeting) }
}

/** Under the words after a meeting's id: where its wrapped lines and its about line start. */
function indentOf(meeting: Meeting): Span {
  return { text: ' '.repeat(cells(`${MEETING_MARK.scheduled} ${meeting.id}${TITLE_GAP}`)) }
}

/** The dim line under a closed meeting's row: what it is about, its lines run together, and the tasks it settles, cut at META_LINES. */
function aboutRow(key: string, meeting: Meeting): Row {
  const indent = indentOf(meeting)
  const tasks = meeting.tasks.length === 0 ? [] : [{ text: meeting.tasks.join(', '), dim: true }]
  const about = meeting.about.trim().replace(/\s*\r?\n\s*/g, ' ')
  return { key: `${key}:about`, spans: [indent, ...joined([{ text: about, dim: true }, ...tasks])], hang: indent, maxLines: META_LINES }
}

/** Each task it settles, a line each: its id a press that opens its page, its title and status; one the register lacks, its id alone. */
function taskLines(meeting: Meeting, tasks: ReadonlyMap<string, TaskRow>): Lines {
  return meeting.tasks.map(id => {
    const task = tasks.get(id)
    if (task === undefined) return [{ text: id }, { text: ' not in the register the pane reads', dim: true }]
    return [{ text: id, task: id }, { text: ` ${task.title}` }, SEPARATOR, { text: STATUS_WORDS[task.status], dim: true }]
  })
}

/** A meeting's card: About, With, Tasks and Brief rows, each only with a value, and a scheduled one's start press. */
function cardOf(key: string, meeting: Meeting, tasks: ReadonlyMap<string, TaskRow>): Row[] {
  const isKnown = (id: string) => tasks.has(id)
  const field = (row: string, label: string, lines: Lines) => labelled(`${key}:card:${row}`, label, lines, isKnown, GUIDE)
  const brief: Lines = meeting.brief === null ? [] : [[{ text: fileLabel(meeting.brief), file: { file: meeting.brief, line: null } }]]
  const rows = [
    ...field('about', 'About', textLines(meeting.about)),
    ...field('with', 'With', meeting.with.length === 0 ? [] : [[{ text: meeting.with.join(', ') }]]),
    ...field('tasks', 'Tasks', taskLines(meeting, tasks)),
    ...field('brief', 'Brief', brief),
  ]
  if (meeting.status !== 'scheduled') return rows
  return [...rows, { key: `${key}:card:start`, spans: [GUIDE, { text: START_TEXT, color: 'claude', starts: meeting.id }] }]
}

/** One meeting's block: its row and, closed, its about line; open, its card in that line's place. */
function meetingBlock(meeting: Meeting, standing: Standing, open: ReadonlySet<string>, tasks: ReadonlyMap<string, TaskRow>, now: number): Block {
  const key = meetingKey(meeting.id)
  const head = headRow(key, meeting, standing, now)
  if (open.has(key)) return { key, rows: [head], folds: key, card: cardOf(key, meeting, tasks) }
  return { key, rows: [head, aboutRow(key, meeting)], folds: key }
}

/** What the last start press answered, leading the list: starting, started with what teamrig did, or why it refused. */
function startBlock(start: MeetingStart): Block {
  const key = `${VIEW}:start`
  const style: Omit<Span, 'text'> = start.outcome === 'refused' ? { color: 'warning' } : { dim: true }
  const lines = start.lines.map((line, i): Row => ({ key: `${key}:${i}`, spans: [{ ...style, text: `  ${line}` }], hang: { text: '    ' } }))
  switch (start.outcome) {
    case 'starting':
      return single(key, [{ text: `Starting ${start.id}…`, dim: true }])
    case 'started':
      return { key, rows: [{ key, spans: [{ text: `Started ${start.id}.`, color: 'success' }] }, ...lines] }
    case 'refused':
      return { key, rows: [{ key, spans: [{ text: `${start.id} did not start:`, color: 'warning' }] }, ...lines] }
  }
}

/** The header: how many meetings and how many missed, ruled; and how many the pane could not read. */
function headerBlocks(meetings: readonly Meeting[], unreadable: number): Block[] {
  const missed = meetings.filter(meeting => meeting.missed).length
  const counts: Span[] = [{ text: `${meetings.length} ${meetings.length === 1 ? 'meeting' : 'meetings'}`, dim: true }]
  if (missed > 0) counts.push({ text: `${missed} missed`, color: 'error' })
  const header: Block = { key: `${VIEW}:header`, rows: [{ key: `${VIEW}:header`, spans: joined(counts), rule: true }] }
  if (unreadable === 0) return [header]
  const what = unreadable === 1 ? '1 meeting teamrig printed is' : `${unreadable} meetings teamrig printed are`
  return [header, single(`${VIEW}:unreadable`, [{ text: `WARN ${what} in a newer format: update the pane.`, color: 'warning' }], { text: '  ' })]
}

/** Whether the view shows `meeting`: one still to hold or holding always, one done or dropped only on the clock's day. */
function isShown(meeting: Meeting, { now, zone }: Clock): boolean {
  if (meeting.status === 'scheduled' || meeting.status === 'started') return true
  return dayOf(meeting.at, zone) === dayOf(now, zone)
}

/**
 * The Meetings view: the header, what the last start press answered, and the meetings the clock's day shows (isShown),
 * those whose key (meetingKey) `open` holds with their cards open; or why none show. `tasks` are the register's, for a
 * card's task titles; the clock's `now` marks the next meeting `now` once its time came.
 */
export function meetingsBlocks(view: MeetingsView, open: readonly string[], start: MeetingStart | null, tasks: readonly TaskRow[], clock: Clock): Block[] {
  const told = start === null ? [] : [startBlock(start)]
  switch (view.kind) {
    case 'reading':
      return [...told, note('Reading the meetings…')]
    case 'no-team':
      return [...told, note("No team found: the Meetings view lists the meetings of the session's team.")]
    case 'failed':
      return [...told, single(`${VIEW}:note`, [{ text: `The meetings could not be read: ${view.reason.replace(/\.$/, '')}.`, color: 'warning' }])]
    case 'list': {
      const shown = view.meetings.filter(meeting => isShown(meeting, clock))
      const header = headerBlocks(shown, view.unreadable)
      if (shown.length === 0) return [...header, ...told, note(NO_MEETINGS)]
      const next = shown.find(meeting => meeting.status === 'scheduled' && !meeting.missed)?.id ?? null
      const opened = new Set(open)
      const byId = new Map(tasks.map(task => [task.id, task]))
      return [...header, ...told, ...shown.map(meeting => meetingBlock(meeting, standingOf(meeting, next), opened, byId, clock.now))]
    }
  }
}
