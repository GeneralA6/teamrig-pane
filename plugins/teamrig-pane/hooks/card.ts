// The card an open task shows in place of its meta line (rows.ts): what the register, the task's refs and its
// goals say about it, one labelled row per fact, each only when it has a value. Status: since when, who set it
// when that is known, then why a waiting task waits or the status note. Plan: priority, due, week. What: the ask
// quoted from the ref (details.ts), then the files it only names. Who: who asked, who added it, when; the owner
// when the list is another area's. After: the tasks planned first, with their status. Goal: each goal's roadmap
// item. Evidence. Links (links.ts). The register's fold keeps no parent, sub-tasks or history, so the card has
// no row for them. Pure: rows of spans that layout.ts wraps, each value's lines under the value column, and
// register.tsx draws, a link as a link and a task id the snapshot holds (ids.ts) underlined.
import type { ThemeKey } from 'claude-code'
import type { TaskDetail, TaskRow, TaskStatus } from '../types'
import { priorityText, type WaitContext } from './core/read/index'
import { refLabel, refParts } from './details'
import { idSpans } from './ids'
import { taskLinks } from './links'
import { dueLabel, lateWords, STATUS_WORDS, waitingWords, whenWords } from './meta'
import type { Row, Span } from './rows'
import { shortDue, shortTime } from './view'

/** Starts each card line: the guide that ties the card to its task's title. */
const GUIDE: Span = { text: '    │ ', dim: true }
/** The label column, in cells: the longest label (`Evidence`) and the gap before the value. */
export const LABEL_CELLS = 10
/** Starts a value's further lines, and each line a value wraps onto: the guide, then blank up to the value column. */
const VALUE_HANG: Span = { text: `${GUIDE.text}${' '.repeat(LABEL_CELLS)}`, dim: true }
/** Between the parts of one value line. */
const SEPARATOR: Span = { text: ' · ', dim: true }
/** A status note's color: why a waiting task waits, what proves a verifying one; others draw in the text color. */
const NOTE_COLOR: Partial<Record<TaskStatus, ThemeKey>> = { waiting: 'error', verifying: 'success' }

/** A value's lines, each its spans; a row with none is left out. */
type Lines = Span[][]

/** `p2`, and `p2 correctness` when the team config names it. */
function priorityLabel(task: TaskRow): string {
  const text = priorityText(task.priority)
  return task.priorityName === null ? text : `${text} ${task.priorityName}`
}

/** Spans between dim dots. */
function joined(parts: readonly Span[]): Span[] {
  return parts.flatMap((part, i) => (i === 0 ? [part] : [SEPARATOR, part]))
}

/**
 * `in progress since 11:55 by po`, then the note: a waiting task's reasons in teamrig's words and its note. The fold
 * keeps who wrote the task's newest event (`updatedBy`), not who set its status: the two are one only when that event
 * came at the status's own time, so only then does the card say who.
 */
function statusLines(task: TaskRow, context: WaitContext): Lines {
  const by = task.updatedAt === task.statusAt ? ` by ${task.updatedBy}` : ''
  const first: Span[] = [{ text: `${STATUS_WORDS[task.status]} since ${whenWords(task.statusAt, context.now)}${by}` }]
  const why = task.status === 'waiting' ? waitingWords(task, context) : task.note
  return why === null ? [first] : [first, [{ text: why, color: NOTE_COLOR[task.status] }]]
}

/** `p2 correctness · due Fri 10-17 · late 1d · week 10-13`: the priority, its due (late in red) and its week. */
function planLines(task: TaskRow, now: number): Lines {
  const parts: Span[] = [{ text: priorityLabel(task) }]
  const due = dueLabel(task, now)
  if (due !== null) parts.push({ text: due })
  const late = lateWords(task, now)
  if (late !== null) parts.push({ text: late, color: 'error' })
  if (task.week !== null) parts.push({ text: `week ${shortDue(task.week)}` })
  return [joined(parts)]
}

/** Each quoted line of the ask, then `see <file> · <file>` for the files nothing was quoted from, named without line numbers. */
function whatLines(task: TaskRow, detail: TaskDetail): Lines {
  // Quotes read for another ref (the task's ref changed since its card opened) are not this ask.
  const quotes = detail.ref === task.ref ? detail.quotes : []
  const lines: Lines = quotes.flatMap(quote => quote.lines.map(text => [{ text }]))
  const quoted = new Set(quotes.map(quote => refLabel(quote.ref)))
  const others = [...new Set(refParts(task.ref).map(refLabel))].filter(label => !quoted.has(label))
  return others.length === 0 ? lines : [...lines, [{ text: `see ${others.join(' · ')}`, dim: true }]]
}

/** `asked by owner · added by lead · 10-13 13:00 · owner po`: the owner named when `viewer`'s list is another area's. */
function whoLines(task: TaskRow, viewer: string | null): Lines {
  const parts: Span[] = [{ text: `asked by ${task.source}` }]
  if (task.createdBy !== task.source) parts.push({ text: `added by ${task.createdBy}` })
  parts.push({ text: shortTime(task.createdAt) })
  if (viewer !== null && task.owner !== viewer) parts.push({ text: `owner ${task.owner}` })
  return [joined(parts)]
}

/** `T1 done, T2 open`: the tasks planned first, each with its status when the snapshot holds it. */
function afterLines(task: TaskRow, context: WaitContext): Lines {
  if (task.after.length === 0) return []
  const words = task.after.map(id => {
    const status = context.statusOf(id)
    return status === undefined ? id : `${id} ${STATUS_WORDS[status]}`
  })
  return [[{ text: words.join(', ') }]]
}

/** Each goal on its line: its roadmap item (which starts with its id), or the bare id when none was read or a quote holds it. */
function goalLines(task: TaskRow, detail: TaskDetail): Lines {
  return task.goals.map(goal => [{ text: detail.goals.find(item => item.goal === goal)?.text ?? goal }])
}

/** Each link on its line: the address, a link layout.ts shortens to its line when it is wider. */
function linkLines(task: TaskRow): Lines {
  return taskLinks(task).map(href => [{ text: href, href }])
}

/**
 * A labelled row, its value's first line beside the dim label, each further line its own row under the value
 * column, and every wrapped line hanging there too. Each id `isKnown` holds in a value's words is a span of its
 * own (ids.ts); a link's address is left whole. No lines, no row.
 */
function labelled(key: string, label: string, lines: Lines, isKnown: (id: string) => boolean): Row[] {
  return lines.map((spans, i) => {
    const value = spans.flatMap(span => (span.href === undefined ? idSpans(span, isKnown) : [span]))
    return {
      key: i === 0 ? key : `${key}:${i}`,
      spans: i === 0 ? [GUIDE, { text: label.padEnd(LABEL_CELLS), dim: true }, ...value] : [VALUE_HANG, ...value],
      hang: VALUE_HANG,
    }
  })
}

/**
 * The card's rows, keyed `<section>-card:<id>:<row>`. `detail` is what was read when it opened (details.ts),
 * `context` the snapshot's (meta.ts contextOf), `viewer` the area whose list it is (null in the all view). An id
 * in its words is a span of its own, marked with its task, when the snapshot holds that task.
 */
export function cardRows(section: string, task: TaskRow, detail: TaskDetail, context: WaitContext, viewer: string | null): Row[] {
  const key = (row: string) => `${section}-card:${task.id}:${row}`
  const isKnown = (id: string) => context.statusOf(id) !== undefined
  const field = (row: string, label: string, lines: Lines) => labelled(key(row), label, lines, isKnown)
  return [
    ...field('status', 'Status', statusLines(task, context)),
    ...field('plan', 'Plan', planLines(task, context.now)),
    ...field('what', 'What', whatLines(task, detail)),
    ...field('who', 'Who', whoLines(task, viewer)),
    ...field('after', 'After', afterLines(task, context)),
    ...field('goal', 'Goal', goalLines(task, detail)),
    ...field('evidence', 'Evidence', task.evidence === null ? [] : [[{ text: task.evidence }]]),
    ...field('links', 'Links', linkLines(task)),
  ]
}
