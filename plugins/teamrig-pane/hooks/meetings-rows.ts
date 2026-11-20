// The Meetings view as blocks of rows (rows.ts, T1359): the team's scheduled and started meetings (meetings.ts) and
// those done or dropped on the team's day (T2455: the whole day's schedule, not only what is still to come), by time,
// under a header that counts them; one done or dropped on an earlier day is left out. A meeting's row is its mark, its id, when it starts on the team's clock, its
// length and the session met with those joining, and under it, dim, what it is about and the tasks it settles. The
// first scheduled one not missed is marked next (now, once its time came), a missed one (scheduled, its slot over
// with no start) in red, a started one says so, a done or dropped one dim. A press on a row opens or closes its card (`folds`): what it is about
// whole, who joins, each task it settles with its title and status (an id the register holds a press that opens its
// page), its brief (a press that opens the file) and its presses (`meets`, T2778): a scheduled one [Start meeting]
// [Move] [Drop], a started one [End] [Postpone]. Move, Postpone, Drop and End ask a second line first: when to (in an
// hour, or tomorrow at its time), why it drops, or whether to end now, each with [Back]. What the last run press
// answered leads the list. Plain-text marks, never an emoji. Pure.
import type { DropWhy, Meeting, MeetingAnswer, MeetingAsk, MeetingAsked, MeetingPress, MeetingRun, MeetingsView, TaskRow } from '../types'
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
/** The text of each press on a meeting's card. */
export const PRESS_TEXT = {
  start: '[Start meeting]',
  move: '[Move]',
  postpone: '[Postpone]',
  drop: '[Drop]',
  end: '[End]',
  inHour: '[In 1 h]',
  endYes: '[Yes, end]',
  back: '[Back]',
} as const
/** The reasons a Drop press offers, each the note those it would meet are told. */
export const DROP_WHYS: readonly DropWhy[] = ['Not needed', 'Covered elsewhere']
/** Between two presses on one line. */
const PRESS_GAP: Span = { text: '  ' }
/** The words of a run, as its answer says them. */
const RUN_WORDS: Readonly<Record<MeetingRun['verb'], { readonly running: string; readonly done: string }>> = {
  start: { running: 'Starting', done: 'Started' },
  end: { running: 'Ending', done: 'Ended' },
  drop: { running: 'Dropping', done: 'Dropped' },
  move: { running: 'Moving', done: 'Moved' },
  postpone: { running: 'Postponing', done: 'Postponed' },
}
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
      return { text: meeting.at <= now ? 'now' : 'next', color: 'accent' }
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
      return { text: MEETING_MARK.next, color: 'accent' }
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

/** A press on meeting `id`'s card, drawn as `text`. */
function pressSpan(text: string, meets: MeetingPress): Span {
  return { text, color: 'accent', meets }
}

/** Presses side by side, after the card's guide and `lead` words. */
function pressRow(key: string, lead: string | null, presses: readonly Span[]): Row {
  const words: Span[] = lead === null ? [] : [{ text: lead }, PRESS_GAP]
  return { key, spans: [GUIDE, ...words, ...presses.flatMap((press, i) => (i === 0 ? [press] : [PRESS_GAP, press]))] }
}

/** The presses a meeting's card offers, by its status: none on a done or dropped one. */
function pressesOf(meeting: Meeting): Span[] {
  const id = meeting.id
  const ask = (text: string, asked: MeetingAsk) => pressSpan(text, { kind: 'ask', id, ask: asked })
  switch (meeting.status) {
    case 'scheduled':
      return [pressSpan(PRESS_TEXT.start, { kind: 'run', id, run: { verb: 'start' } }), ask(PRESS_TEXT.move, 'move'), ask(PRESS_TEXT.drop, 'drop')]
    case 'started':
      return [ask(PRESS_TEXT.end, 'end'), ask(PRESS_TEXT.postpone, 'postpone')]
    case 'done':
    case 'dropped':
      return []
  }
}

/**
 * The second line `ask` opens on a meeting's card: when to move or postpone it to (in an hour, tomorrow at its time on
 * the team's clock), why it drops, or whether to end it now; each with [Back].
 */
function askedRow(key: string, meeting: Meeting, ask: MeetingAsk, clock: Clock): Row {
  const id = meeting.id
  const run = (text: string, run: MeetingRun) => pressSpan(text, { kind: 'run', id, run })
  const back = pressSpan(PRESS_TEXT.back, { kind: 'back', id })
  const rowKey = `${key}:card:ask`
  switch (ask) {
    case 'move':
    case 'postpone': {
      const tomorrow = `[Tomorrow ${clock.zone.clock(new Date(meeting.at))}]`
      const lead = `${ask === 'move' ? 'Move' : 'Postpone'} ${id} to:`
      return pressRow(rowKey, lead, [run(PRESS_TEXT.inHour, { verb: ask, to: { kind: 'in-1h' } }), run(tomorrow, { verb: ask, to: { kind: 'tomorrow', from: meeting.at } }), back])
    }
    case 'drop':
      return pressRow(rowKey, `Drop ${id}?`, [...DROP_WHYS.map(why => run(`[${why}]`, { verb: 'drop', why })), back])
    case 'end':
      return pressRow(rowKey, `End ${id} now?`, [run(PRESS_TEXT.endYes, { verb: 'end' }), back])
  }
}

/** Whether `ask` fits a meeting of `status`: Move and Drop a scheduled one, End and Postpone a started one. */
function isAskable(ask: MeetingAsk, status: Meeting['status']): boolean {
  if (status === 'scheduled') return ask === 'move' || ask === 'drop'
  return status === 'started' && (ask === 'end' || ask === 'postpone')
}

/** A meeting's card: About, With, Tasks and Brief rows, each only with a value, its presses and the second line asked of it. */
function cardOf(key: string, meeting: Meeting, tasks: ReadonlyMap<string, TaskRow>, asked: MeetingAsked | null, clock: Clock): Row[] {
  const isKnown = (id: string) => tasks.has(id)
  const field = (row: string, label: string, lines: Lines) => labelled(`${key}:card:${row}`, label, lines, isKnown, GUIDE)
  const brief: Lines = meeting.brief === null ? [] : [[{ text: fileLabel(meeting.brief), file: { file: meeting.brief, line: null } }]]
  const rows = [
    ...field('about', 'About', textLines(meeting.about)),
    ...field('with', 'With', meeting.with.length === 0 ? [] : [[{ text: meeting.with.join(', ') }]]),
    ...field('tasks', 'Tasks', taskLines(meeting, tasks)),
    ...field('brief', 'Brief', brief),
  ]
  const presses = pressesOf(meeting)
  if (presses.length === 0) return rows
  const pressed = pressRow(`${key}:card:presses`, null, presses)
  if (asked === null || asked.id !== meeting.id || !isAskable(asked.ask, meeting.status)) return [...rows, pressed]
  return [...rows, pressed, askedRow(key, meeting, asked.ask, clock)]
}

/** What one meeting's block draws from beyond the meeting: the open cards, the register's tasks, the second line asked, the clock. */
type BlockContext = { readonly open: ReadonlySet<string>; readonly tasks: ReadonlyMap<string, TaskRow>; readonly asked: MeetingAsked | null; readonly clock: Clock }

/** One meeting's block: its row and, closed, its about line; open, its card in that line's place. */
function meetingBlock(meeting: Meeting, standing: Standing, { open, tasks, asked, clock }: BlockContext): Block {
  const key = meetingKey(meeting.id)
  const head = headRow(key, meeting, standing, clock.now)
  if (open.has(key)) return { key, rows: [head], folds: key, card: cardOf(key, meeting, tasks, asked, clock) }
  return { key, rows: [head, aboutRow(key, meeting)], folds: key }
}

/** What the last run press answered, leading the list: running, done with what teamrig did, or why it refused. */
function answerBlock(answer: MeetingAnswer): Block {
  const key = `${VIEW}:answer`
  const words = RUN_WORDS[answer.verb]
  const style: Omit<Span, 'text'> = answer.outcome === 'refused' ? { color: 'warning' } : { dim: true }
  const lines = answer.lines.map((line, i): Row => ({ key: `${key}:${i}`, spans: [{ ...style, text: `  ${line}` }], hang: { text: '    ' } }))
  switch (answer.outcome) {
    case 'running':
      return single(key, [{ text: `${words.running} ${answer.id}…`, dim: true }])
    case 'done':
      return { key, rows: [{ key, spans: [{ text: `${words.done} ${answer.id}.`, color: 'success' }] }, ...lines] }
    case 'refused':
      return { key, rows: [{ key, spans: [{ text: `${answer.id} was not ${words.done.toLowerCase()}:`, color: 'warning' }] }, ...lines] }
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

/** What the Meetings view draws beside the list: the open cards' keys, the last run's answer and the second line asked. */
export type MeetingsShown = { readonly open: readonly string[]; readonly answer: MeetingAnswer | null; readonly asked: MeetingAsked | null }

/**
 * The Meetings view: the header, what the last run press answered, and the meetings the clock's day shows (isShown),
 * those whose key (meetingKey) `open` holds with their cards open, the one `asked` names with its second line; or why
 * none show. `tasks` are the register's, for a card's task titles; the clock's `now` marks the next meeting `now` once
 * its time came, and its zone prints a Move's tomorrow time.
 */
export function meetingsBlocks(view: MeetingsView, { open, answer, asked }: MeetingsShown, tasks: readonly TaskRow[], clock: Clock): Block[] {
  const told = answer === null ? [] : [answerBlock(answer)]
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
      const context: BlockContext = { open: new Set(open), tasks: new Map(tasks.map(task => [task.id, task])), asked, clock }
      return [...header, ...told, ...shown.map(meeting => meetingBlock(meeting, standingOf(meeting, next), context))]
    }
  }
}
