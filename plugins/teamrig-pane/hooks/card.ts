// The card an open task shows in place of its meta line (rows.ts): what the register, the task's refs and its
// goals say about it, one labelled row per fact, each only when it has a value, in the words a task tracker uses.
// Description: what the task is and why, as written (`teamrig add --description`, a GitHub issue's body); a task
// written before teamrig kept one shows the ask quoted from its ref (details.ts) instead. Status: since when, who
// set it when that is known, then why a waiting task waits. Note: the newest status note. Proof: what proves a
// verifying task. Priority, Due (Verify by while verifying, late in red) and Week, each on its own row. After: the
// tasks planned first, with their status. Goal: each goal's roadmap item. From: who asked, or the GitHub issue it
// came from. Added: when it was written and by whom, as a tracker's Created row. Owner: in another area's
// list. Reference: where the ask is written, each file by its folder and name, other words as written (an issue
// ref is the first link instead). Evidence. Links (links.ts). The register's fold keeps no parent, sub-tasks or
// history, so the card has no row for them. In the list each line starts with a guide under the task's title; on a
// task's page (page.ts) the card has the body to itself and starts at its edge. Pure: rows of spans that layout.ts
// wraps, each value's lines under the value column, and register.tsx draws, a link as a link and a task id the
// snapshot holds (ids.ts) underlined, a press on it opening that task's page.
import type { TaskDetail, TaskRow } from '../types'
import type { TaskTree, WaitContext } from './core/read/index'
import { lineRef, refLabel, refParts } from './details'
import { idSpans } from './ids'
import { issueOf, taskLinks } from './links'
import { dayWords, dueWords, lateWords, STATUS_WORDS, waitingWords, whenWords } from './meta'
import type { Row, Span } from './rows'

/** Starts each card line in the list: the guide that ties the card to its task's title. */
const GUIDE: Span = { text: '    │ ', dim: true }
/** The label column, in cells: the longest label (`Description`) and the gap before the value. */
export const LABEL_CELLS = 13
/** Between the parts of one value line. */
const SEPARATOR: Span = { text: ' · ', dim: true }

/** A value's lines, each its spans; a row with none is left out. */
type Lines = Span[][]

/** Spans between dim dots. */
function joined(parts: readonly Span[]): Span[] {
  return parts.flatMap((part, i) => (i === 0 ? [part] : [SEPARATOR, part]))
}

/** Each line of `text` with something on it, a line of its own in `style`; none for no text. */
function textLines(text: string | null, style: Omit<Span, 'text'> = {}): Lines {
  if (text === null) return []
  return text
    .split(/\r?\n/)
    .filter(line => line.trim() !== '')
    .map(line => [{ ...style, text: line }])
}

/**
 * The description as written, a line a row; for a task with none, each line quoted from its ref, so long as the
 * quotes were read for the ref it has now (its ref can change after its card opened).
 */
function descriptionLines(task: TaskRow, detail: TaskDetail): Lines {
  if (task.description !== null) return textLines(task.description)
  const quotes = detail.ref === task.ref ? detail.quotes : []
  return quotes.flatMap(quote => quote.lines.map(text => [{ text }]))
}

/**
 * `in progress since 11:55 by po`, then why a waiting task waits, in teamrig's words (its note has its own row). The
 * fold keeps who wrote the task's newest event (`updatedBy`), not who set its status: the two are one only when that
 * event came at the status's own time, so only then does the card say who.
 */
function statusLines(task: TaskRow, context: WaitContext): Lines {
  const by = task.updatedAt === task.statusAt ? ` by ${task.updatedBy}` : ''
  const first: Span[] = [{ text: `${STATUS_WORDS[task.status]} since ${whenWords(task.statusAt, context.now)}${by}` }]
  const why = task.status === 'waiting' ? waitingWords({ ...task, note: null }, context) : null
  return why === null ? [first] : [first, [{ text: why, color: 'error' }]]
}

/** `Fri 10-17`, then `late 1d` in red while it is past due. */
function dueLines(task: TaskRow, now: number): Lines {
  const due = dueWords(task, now)
  if (due === null) return []
  const late = lateWords(task, now)
  const parts: Span[] = [{ text: due }]
  if (late !== null) parts.push({ text: late, color: 'error' })
  return [joined(parts)]
}

/** `Mon 10-12`: the first day of the planning week, as written when it cannot be read. */
function weekLines(task: TaskRow): Lines {
  if (task.week === null) return []
  const start = Date.parse(task.week)
  return [[{ text: Number.isNaN(start) ? task.week : dayWords(start) }]]
}

/** `T1 (done), T2 (not started)`: the tasks planned first, each with its status when the snapshot holds it. */
function afterLines(task: TaskRow, context: WaitContext): Lines {
  if (task.after.length === 0) return []
  const words = task.after.map(id => {
    const status = context.statusOf(id)
    return status === undefined ? id : `${id} (${STATUS_WORDS[status]})`
  })
  return [[{ text: words.join(', ') }]]
}

/** Each goal on its line: its roadmap item (which starts with its id), or the bare id when none was read or a quote holds it. */
function goalLines(task: TaskRow, detail: TaskDetail): Lines {
  return task.goals.map(goal => [{ text: detail.goals.find(item => item.goal === goal)?.text ?? goal }])
}

/** `owner`, the session that asked, or `GitHub issue #12` for a task teamrig opened from that issue. */
function fromLines(task: TaskRow): Lines {
  const issue = issueOf(task)
  return [[{ text: issue === null ? task.source : `GitHub issue #${issue.number}` }]]
}

/** `Tue 10-13 by lead`: when the task was written and who wrote it. */
function addedLines(task: TaskRow, now: number): Lines {
  return [[{ text: `${whenWords(task.createdAt, now)} by ${task.createdBy}` }]]
}

/** Where the ask is written: each file by its folder and name, other words as written; none for an issue's ref, a link already. */
function referenceLines(task: TaskRow): Lines {
  const parts = issueOf(task) === null ? refParts(task.ref) : []
  return [...new Set(parts.map(part => (lineRef(part) === null ? part : refLabel(part))))].map(text => [{ text }])
}

/** Each link on its line: the address, a link layout.ts shortens to its line when it is wider. */
function linkLines(task: TaskRow): Lines {
  return taskLinks(task).map(href => [{ text: href, href }])
}

/**
 * A labelled row, its value's first line beside the dim label, each further line its own row under the value
 * column, and every wrapped line hanging there too (`hang`: the lead, then blank up to the value column). Each id
 * `isKnown` holds in a value's words is a span of its own (ids.ts); a link's address is left whole. No lines, no row.
 */
function labelled(key: string, label: string, lines: Lines, isKnown: (id: string) => boolean, lead: Span | null): Row[] {
  const hang: Span = { text: `${lead?.text ?? ''}${' '.repeat(LABEL_CELLS)}`, dim: true }
  const first = [...(lead === null ? [] : [lead]), { text: label.padEnd(LABEL_CELLS), dim: true }]
  return lines.map((spans, i) => {
    const value = spans.flatMap(span => (span.href === undefined ? idSpans(span, isKnown) : [span]))
    return { key: i === 0 ? key : `${key}:${i}`, spans: i === 0 ? [...first, ...value] : [hang, ...value], hang }
  })
}

/**
 * The card's rows, keyed `<section>-card:<id>:<row>`. `detail` is what was read when it opened (details.ts),
 * `tree` the snapshot's (meta.ts treeOf), `viewer` the area whose list it is (null in the all view). An id
 * in its words is a span of its own, marked with its task, when the snapshot holds that task. `lead` starts each
 * line: the guide under the task's title in the list, none on a task's page.
 */
export function cardRows(
  section: string,
  task: TaskRow,
  detail: TaskDetail,
  tree: TaskTree<TaskRow>,
  viewer: string | null,
  lead: Span | null = GUIDE,
): Row[] {
  const context = tree.context
  const key = (row: string) => `${section}-card:${task.id}:${row}`
  const isKnown = (id: string) => context.statusOf(id) !== undefined
  const field = (row: string, label: string, lines: Lines) => labelled(key(row), label, lines, isKnown, lead)
  return [
    ...field('description', 'Description', descriptionLines(task, detail)),
    ...field('status', 'Status', statusLines(task, context)),
    ...field('note', 'Note', textLines(task.note)),
    ...field('proof', 'Proof', textLines(task.proof, { color: 'success' })),
    ...field('priority', 'Priority', [[{ text: String(task.priority) }]]),
    ...field('due', task.status === 'verifying' ? 'Verify by' : 'Due', dueLines(task, context.now)),
    ...field('week', 'Week', weekLines(task)),
    ...field('after', 'After', afterLines(task, context)),
    ...field('goal', 'Goal', goalLines(task, detail)),
    ...field('from', 'From', fromLines(task)),
    ...field('added', 'Added', addedLines(task, context.now)),
    ...field('owner', 'Owner', viewer !== null && task.owner !== viewer ? [[{ text: task.owner }]] : []),
    ...field('reference', 'Reference', referenceLines(task)),
    ...field('evidence', 'Evidence', textLines(task.evidence)),
    ...field('links', 'Links', linkLines(task)),
  ]
}
