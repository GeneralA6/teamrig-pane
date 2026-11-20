// The pane's task rows from teamrig's `tasks` document (T4742): each served task read field by field into the row
// the views already draw (types/index.d.ts TaskRow), so nothing downstream changes with where a row came from. The
// document serves a title and a description as marked text, a source and a ref as data; a row keeps the text of each
// and the source's id, what the register's own fold gave it, with what only the document says: whether a tracker
// brought the task in, and the tracker item its ref names. Where the pane draws every value its own way it must
// know the value: a task whose status or answer it does not know, or with a field of another type, is left out, and
// the left-out tasks are told in one line rather than drawn wrong. What it can draw without knowing is passed over
// instead, as the interface says a reader may: a type it does not know reads as a task, and a wait of a kind it does
// not know is not drawn. Rows come back ordered by the number in their id, as the fold's are. An `unchanged` answer
// holds no tasks, so it is never handed here. Pure.
import type { AnswerRow, DecisionRow, TaskItem, TaskRow, TaskStatus, WaitRow } from '../types'
import { Fields, isList, isOneOf, leftOutLine, type BodyRead } from './document-fields'
import { pageOf } from './links'
import { isRecord, type ReadDocument } from './read-document'

// Each list is typed by the contract's own union, so a status, verdict or type the contract gains or drops fails the
// typecheck here until the list follows.
const STATUSES: Readonly<Record<TaskStatus, true>> = { open: true, 'in-progress': true, verifying: true, waiting: true, done: true, dropped: true }
const VERDICTS: Readonly<Record<AnswerRow['verdict'], true>> = { approved: true, declined: true }
const TYPES: Readonly<Record<NonNullable<TaskRow['type']>, true>> = { task: true, bug: true }

function typeOf(type: string | null): TaskRow['type'] {
  return type !== null && isOneOf(TYPES, type) ? type : null
}

/** The wait `wait` holds, or none for a kind this pane does not know. */
function waitsOf(wait: Fields): WaitRow[] {
  const kind = wait.text('kind')
  switch (kind) {
    case 'decision':
    case 'approval':
      return [{ kind, who: wait.text('who') }]
    case 'task':
      return [{ kind, id: wait.text('id') }]
    case 'time':
      return [{ kind, at: wait.text('at') }]
    default:
      return []
  }
}

function answerOf(answer: Fields | null): AnswerRow | null {
  if (answer === null) return null
  return { verdict: answer.oneOf('verdict', VERDICTS, 'declined'), by: answer.text('by'), at: answer.text('at'), note: answer.textOrNull('note') }
}

function decisionOf(decided: Fields | null): DecisionRow | null {
  return decided === null ? null : { by: decided.text('by'), at: decided.text('at'), note: decided.textOrNull('note') }
}

/** teamrig's kind for a source that is a tracker's connector, not the owner or a session (teamrig's src/interface/source.ts). */
const CONNECTOR_KIND = 'connector'

/**
 * The tracker item `ref` names: teamrig fills a ref's connector, id and page together, only when a tracker knows the
 * ref as one of its items, so a ref with no connector names none. The page is kept only as an address the pane links
 * to (links.ts pageOf).
 */
function itemOf(ref: Fields | null): TaskItem | null {
  const connector = ref?.partOrNull('connector') ?? null
  if (ref === null || connector === null) return null
  return { tracker: connector.text('name'), id: ref.text('id'), url: pageOf(ref.textOrNull('url')) }
}

/** Who asked and where the ask is written: the source's id and whether it is a tracker, the ref's text and its item. */
function originOf(task: Fields): Pick<TaskRow, 'source' | 'isImported' | 'ref' | 'item'> {
  const source = task.part('source')
  const ref = task.partOrNull('ref')
  return { source: source.text('id'), isImported: source.text('kind') === CONNECTOR_KIND, ref: ref?.text('text') ?? null, item: itemOf(ref) }
}

function rowOf(task: Fields): TaskRow {
  return {
    id: task.text('id'),
    title: task.part('title').text('text'),
    description: task.partOrNull('description')?.text('text') ?? null,
    // Interface 1.0 serves no mark of a description the register's snapshot left out, so a row never says one was.
    descriptionCut: null,
    owner: task.text('owner'),
    priority: task.number('priority'),
    type: typeOf(task.textOrNull('type')),
    critical: task.flag('critical'),
    due: task.textOrNull('due'),
    status: task.oneOf('status', STATUSES, 'open'),
    note: task.textOrNull('note'),
    proof: task.textOrNull('proof'),
    evidence: task.textOrNull('evidence'),
    skill: task.textOrNull('skill'),
    statusAt: task.text('statusAt'),
    ...originOf(task),
    goals: task.texts('goals'),
    week: task.textOrNull('week'),
    size: task.numberOrNull('size'),
    pin: task.textOrNull('pin'),
    workClass: task.textOrNull('workClass'),
    createdBy: task.text('createdBy'),
    createdAt: task.text('createdAt'),
    updatedAt: task.text('updatedAt'),
    updatedBy: task.text('updatedBy'),
    priorityAt: task.text('priorityAt'),
    assignedAt: task.text('assignedAt'),
    ownerSeenAt: task.textOrNull('ownerSeenAt'),
    waits: task.parts('waits').flatMap(waitsOf),
    answer: answerOf(task.partOrNull('answer')),
    decided: decisionOf(task.partOrNull('decided')),
    after: task.texts('after'),
  }
}

type TaskRead = { readonly kind: 'row'; readonly row: TaskRow } | { readonly kind: 'left-out'; readonly why: string }

/** The row of one served task, or which task was left out and the first field that could not be read. */
function taskOf(value: unknown): TaskRead {
  if (!isRecord(value)) return { kind: 'left-out', why: 'an entry that is no task' }
  const task = new Fields(value)
  const row = rowOf(task)
  const bad = task.bad
  const [first] = bad
  if (first === undefined) return { kind: 'row', row }
  return { kind: 'left-out', why: `${bad.includes('id') ? 'a task' : row.id} (${first})` }
}

const ID = /^T(\d+)$/

/** The number in a task's id (`T12`), which the rows are ordered by; an id spelled another way goes last. */
function numberOf(id: string): number {
  const digits = ID.exec(id)?.[1]
  return digits === undefined ? Infinity : Number(digits)
}

function byNumber(a: TaskRow, b: TaskRow): number {
  const [first, second] = [numberOf(a.id), numberOf(b.id)]
  if (first === second) return 0
  return first < second ? -1 : 1
}

/** The rows of the tasks `document` serves, with the tasks left out told in one line; unreadable with no task list. */
export function tasksOf(document: ReadDocument): BodyRead<TaskRow[]> {
  const served = document.fields['tasks']
  if (!isList(served)) return { kind: 'unreadable', reason: "teamrig's tasks document holds no task list: update teamrig" }
  const rows: TaskRow[] = []
  const left: string[] = []
  for (const read of served.map(taskOf)) {
    if (read.kind === 'row') rows.push(read.row)
    else left.push(read.why)
  }
  return { kind: 'read', value: rows.sort(byNumber), problems: left.length === 0 ? [] : [leftOutLine('task', left)] }
}
