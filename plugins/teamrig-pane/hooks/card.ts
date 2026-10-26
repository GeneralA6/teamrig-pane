// The card an open task shows in place of its meta line (rows.ts): what the register, the task's refs and its
// goals say about it, one labelled row per fact, each only when it has a value, in the words a task tracker uses.
// Description: what the task is and why, as written (`teamrig add --description`, a GitHub issue's body); a task
// written before teamrig kept one shows the ask quoted from its ref (details.ts) instead. Status: since when, who
// set it when that is known, then why a waiting task waits. Note: the newest status note. Proof: what proves a
// verifying task. Owner: the session that owns it, on every card. Lead: the lead its owner answers to (leads.ts),
// when the team's config is read. Priority, Type (a bug or a critical bug; none for a task), Due (Verify by while
// verifying; a date taken from a task that needs it names that task; late in red) and Planned (its week plan against
// the team's week: this week, next week, the week of a day, or none), each on its own row. After: the tasks planned first, with their
// status. Needed by: each active task of another owner that needs it, with its owner and due, the earliest due first.
// Goal: each goal's roadmap item. Origin: who asked (or the GitHub issue it came from), who wrote it and when, as a
// tracker's Created row. Reference: where the ask is written, each file by its
// folder and name (ref-file.ts), other words as written (an issue ref is the first link instead). Evidence. Links
// (links.ts). The register's fold keeps no parent, sub-tasks or history, so the card has no row for them. In the list
// each line starts with a guide under the task's title; on a task's page (page.ts) the card has the body to itself
// and starts at its edge. Pure: rows of spans that layout.ts wraps, each value's lines under the value column, and
// register.tsx draws, a link as a link, and a task id the snapshot holds (ids.ts) and a reference file underlined, a
// press on one opening that task's or that file's page.
import type { TaskDetail, TaskRow } from '../types'
import { TimeZone, type TaskTree, type WaitContext } from './core/read/index'
import { fileLabel, refParts } from './details'
import { idSpans } from './ids'
import { leadOf } from './leads'
import { issueOf, taskLinks } from './links'
import { dueWords, lateWords, neededByLines, STATUS_WORDS, storedDayWords, typeWords, waitingWords, whenWords, type PaneTree } from './meta'
import { refSegments } from './ref-file'
import type { Row, Span } from './rows'
import { weekAfter, weekOf, type Clock } from './zone'

/** Starts each card line in the list: the guide that ties the card to its task's title. */
const GUIDE: Span = { text: '    │ ', dim: true }
/** The label column, in cells: the longest label (`Description`) and the gap before the value. */
export const LABEL_CELLS = 13
/** Between the parts of one value line. */
const SEPARATOR: Span = { text: ' · ', dim: true }

/** A value's lines, each its spans; a row with none is left out. */
export type Lines = Span[][]

/** A fact a card shows on its labelled row, named as its row's key ends. */
export type CardField =
  | 'description'
  | 'status'
  | 'note'
  | 'proof'
  | 'owner'
  | 'lead'
  | 'priority'
  | 'type'
  | 'due'
  | 'planned'
  | 'after'
  | 'needed-by'
  | 'goal'
  | 'origin'
  | 'reference'
  | 'evidence'
  | 'links'

/** Spans between dim dots. */
export function joined(parts: readonly Span[]): Span[] {
  return parts.flatMap((part, i) => (i === 0 ? [part] : [SEPARATOR, part]))
}

/** Each line of `text` with something on it, a line of its own in `style`; none for no text. */
export function textLines(text: string | null, style: Omit<Span, 'text'> = {}): Lines {
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
 * `in progress since 11:55 IDT by po`, then why a waiting task waits, in teamrig's words (its note has its own row). The
 * fold keeps who wrote the task's newest event (`updatedBy`), not who set its status: the two are one only when that
 * event came at the status's own time, so only then does the card say who.
 */
function statusLines(task: TaskRow, context: WaitContext): Lines {
  const by = task.updatedAt === task.statusAt ? ` by ${task.updatedBy}` : ''
  const first: Span[] = [{ text: `${STATUS_WORDS[task.status]} since ${whenWords(task.statusAt, context)}${by}` }]
  const why = task.status === 'waiting' ? waitingWords({ ...task, note: null }, context) : null
  return why === null ? [first] : [first, [{ text: why, color: 'error' }]]
}

/** `Fri 10-17` (`Fri 10-17 (from T7)` on a date taken from T7, meta.ts dueWords), then `late 1d` in red while it is past due. */
function dueLines(task: TaskRow, tree: TaskTree<TaskRow>): Lines {
  const due = dueWords(task, tree)
  if (due === null) return []
  const late = lateWords(task, tree)
  const parts: Span[] = [{ text: due }]
  if (late !== null) parts.push({ text: late, color: 'error' })
  return [joined(parts)]
}

/**
 * `this week`, `next week` or `week of Mon 10-26`: the week plan the task is in, against the week the clock is in on
 * the team's calendar (a stored week is a day, its week the one that day falls in); `not in a week plan` for none, and
 * a week that cannot be read as written.
 */
function plannedLines(task: TaskRow, clock: Clock): Lines {
  if (task.week === null) return [[{ text: 'not in a week plan' }]]
  const day = Date.parse(task.week)
  if (Number.isNaN(day)) return [[{ text: `week of ${task.week}` }]]
  const week = weekOf(day, TimeZone.UTC)
  const current = weekOf(clock.now, clock.zone)
  if (week === current) return [[{ text: 'this week' }]]
  if (week === weekAfter(current, 1)) return [[{ text: 'next week' }]]
  return [[{ text: `week of ${storedDayWords(week) ?? week}` }]]
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

/**
 * `Asked by owner, added by lead Tue 10-13`: who asked, then who wrote the task and when, at the clock in its zone;
 * `Asked and added by lead ...` when one session did both, `GitHub issue #12, added by ...` for a task teamrig opened
 * from that issue.
 */
function originLines(task: TaskRow, clock: Clock): Lines {
  const added = `added by ${task.createdBy} ${whenWords(task.createdAt, clock)}`
  const issue = issueOf(task)
  if (issue !== null) return [[{ text: `GitHub issue #${issue.number}, ${added}` }]]
  return [[{ text: task.source === task.createdBy ? `Asked and ${added}` : `Asked by ${task.source}, ${added}` }]]
}

/**
 * Where the ask is written, a line per ref part: each file by its folder and name, a press that opens its page, other
 * words as written; a part that reads as one already listed (the same file at another line) once. None for an
 * issue's ref, a link already.
 */
function referenceLines(task: TaskRow): Lines {
  const parts = issueOf(task) === null ? refParts(task.ref) : []
  const lines = parts.map(part =>
    refSegments(part).map((segment): Span => (segment.kind === 'words' ? { text: segment.text } : { text: fileLabel(segment.file.file), file: segment.file })),
  )
  const seen = new Set<string>()
  return lines.filter(line => {
    const words = line.map(span => span.text).join('')
    if (seen.has(words)) return false
    seen.add(words)
    return true
  })
}

/** Each link on its line: the address, a link layout.ts shortens to its line when it is wider. */
function linkLines(task: TaskRow): Lines {
  return taskLinks(task).map(href => [{ text: href, href }])
}

/**
 * A labelled row, its value's first line beside the dim label, each further line its own row under the value
 * column, and every wrapped line hanging there too (`hang`: the lead, then blank up to the value column). Each id
 * `isKnown` holds in a value's words is a span of its own (ids.ts); a link's address and a file's name are left
 * whole. No lines, no row.
 */
export function labelled(key: string, label: string, lines: Lines, isKnown: (id: string) => boolean, lead: Span | null): Row[] {
  const hang: Span = { text: `${lead?.text ?? ''}${' '.repeat(LABEL_CELLS)}`, dim: true }
  const first = [...(lead === null ? [] : [lead]), { text: label.padEnd(LABEL_CELLS), dim: true }]
  return lines.map((spans, i) => {
    const value = spans.flatMap(span => (span.href === undefined && span.file === undefined ? idSpans(span, isKnown) : [span]))
    return { key: i === 0 ? key : `${key}:${i}`, spans: i === 0 ? [...first, ...value] : [hang, ...value], hang }
  })
}

/**
 * The card's rows, keyed `<section>-card:<id>:<row>`. `detail` is what was read when it opened (details.ts),
 * `tree` the snapshot's (meta.ts treeOf). An id
 * in its words is a span of its own, marked with its task, when the snapshot holds that task. `lead` starts each
 * line: the guide under the task's title in the list, none on a task's page. `only` keeps those facts alone (the
 * banner's, banner.ts); null keeps every one.
 */
export function cardRows(
  section: string,
  task: TaskRow,
  detail: TaskDetail,
  tree: PaneTree,
  lead: Span | null = GUIDE,
  only: ReadonlySet<CardField> | null = null,
): Row[] {
  const context = tree.context
  const key = (row: CardField) => `${section}-card:${task.id}:${row}`
  const isKnown = (id: string) => context.statusOf(id) !== undefined
  const field = (row: CardField, label: string, lines: Lines) =>
    only === null || only.has(row) ? labelled(key(row), label, lines, isKnown, lead) : []
  return [
    ...field('description', 'Description', descriptionLines(task, detail)),
    ...field('status', 'Status', statusLines(task, context)),
    ...field('note', 'Note', textLines(task.note)),
    ...field('proof', 'Proof', textLines(task.proof, { color: 'success' })),
    ...field('owner', 'Owner', [[{ text: task.owner }]]),
    ...field('lead', 'Lead', textLines(leadOf(task.owner, tree.leads))),
    ...field('priority', 'Priority', [[{ text: String(task.priority) }]]),
    ...field('type', 'Type', textLines(typeWords(task))),
    ...field('due', task.status === 'verifying' ? 'Verify by' : 'Due', dueLines(task, tree)),
    ...field('planned', 'Planned', plannedLines(task, context)),
    ...field('after', 'After', afterLines(task, context)),
    ...field('needed-by', 'Needed by', neededByLines(task, tree).map(text => [{ text }])),
    ...field('goal', 'Goal', goalLines(task, detail)),
    ...field('origin', 'Origin', originLines(task, context)),
    ...field('reference', 'Reference', referenceLines(task)),
    ...field('evidence', 'Evidence', textLines(task.evidence)),
    ...field('links', 'Links', linkLines(task)),
  ]
}
