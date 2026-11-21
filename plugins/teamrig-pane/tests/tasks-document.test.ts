// The pane's rows from teamrig's `tasks` document (hooks/tasks-document.ts): a served task reads into the row the views
// draw, marked text as its text and a source or a ref as what the fold gave, with whether a tracker brought it in and
// the tracker item its ref names, the item's page only as an address the pane links to; a field a later minor adds is passed over,
// with a type or a wait kind the pane does not know; a task with a status or an answer it does not know, or a field of
// another type, is left out and told in one line; rows come back in the order of their ids' numbers (T4742).
import { describe, expect, test } from 'claude-code/testing'
import { parseDocument, type JsonRecord, type ReadDocument } from '../hooks/read-document'
import { tasksOf } from '../hooks/tasks-document'
import type { TaskRow } from '../types'

const AT = '2026-03-02T09:00:00.000Z'

/** A task as interface 1.0 serves it (teamrig src/interface/tasks.ts ServedTask), every field named. */
function served(over: JsonRecord = {}): JsonRecord {
  return {
    id: 'T7',
    title: { text: 'Draw the list', source: 'team' },
    description: { text: 'So a row reads the same wherever it came from.', source: 'team' },
    owner: 'api',
    priority: 2,
    type: 'bug',
    critical: true,
    due: '2026-03-09',
    status: 'waiting',
    note: 'waits for the lead',
    proof: null,
    evidence: 'abc1234',
    skill: 'none',
    statusAt: AT,
    source: { kind: 'session', id: 'lead', name: 'the lead' },
    ref: { text: 'notes/plan.md:12', connector: null, id: null, label: null, url: null },
    goals: ['G2'],
    week: '2026-03-02',
    size: 1.5,
    pin: 'lead',
    workClass: 'Roadmap',
    createdBy: 'lead',
    createdAt: AT,
    updatedAt: AT,
    updatedBy: 'api',
    priorityAt: AT,
    assignedAt: AT,
    ownerSeenAt: AT,
    waits: [
      { kind: 'approval', who: 'lead' },
      { kind: 'decision', who: 'owner' },
      { kind: 'task', id: 'T3' },
      { kind: 'time', at: '2026-03-03 08:00' },
    ],
    answer: { verdict: 'approved', by: 'lead', at: AT, note: 'read the diff' },
    decided: { by: 'lead', at: AT, note: 'go on' },
    after: ['T3'],
    ...over,
  }
}

/** `served()` as the row it reads into. */
const ROW: TaskRow = {
  id: 'T7',
  title: 'Draw the list',
  description: 'So a row reads the same wherever it came from.',
  descriptionCut: null,
  owner: 'api',
  priority: 2,
  type: 'bug',
  critical: true,
  due: '2026-03-09',
  status: 'waiting',
  note: 'waits for the lead',
  proof: null,
  evidence: 'abc1234',
  skill: 'none',
  statusAt: AT,
  source: 'lead',
  ref: 'notes/plan.md:12',
  item: null,
  isImported: false,
  goals: ['G2'],
  week: '2026-03-02',
  size: 1.5,
  pin: 'lead',
  workClass: 'Roadmap',
  createdBy: 'lead',
  createdAt: AT,
  updatedAt: AT,
  updatedBy: 'api',
  priorityAt: AT,
  assignedAt: AT,
  ownerSeenAt: AT,
  waits: [
    { kind: 'approval', who: 'lead' },
    { kind: 'decision', who: 'owner' },
    { kind: 'task', id: 'T3' },
    { kind: 'time', at: '2026-03-03 08:00' },
  ],
  answer: { verdict: 'approved', by: 'lead', at: AT, note: 'read the diff' },
  decided: { by: 'lead', at: AT, note: 'go on' },
  after: ['T3'],
}

/** A ref a tracker knows as its item 12, as teamrig serves one, with `url` as the item's page. */
function trackerRef(url: string | null, over: JsonRecord = {}): JsonRecord {
  return { text: 'tracker:12', connector: { id: 'tracker', name: 'Tracker' }, id: '#12', label: { text: '#12', source: 'outside' }, url, ...over }
}

/** A task with every optional field unset, as teamrig serves one just added. */
const BARE = {
  description: null,
  type: null,
  due: null,
  note: null,
  evidence: null,
  skill: null,
  ref: null,
  week: null,
  size: null,
  pin: null,
  workClass: null,
  ownerSeenAt: null,
  answer: null,
  decided: null,
}

/** `record` as teamrig would print it with the fields `names` left out. */
function without(record: JsonRecord, ...names: readonly string[]): JsonRecord {
  return Object.fromEntries(Object.entries(record).filter(([name]) => !names.includes(name)))
}

function documentOf(body: JsonRecord): ReadDocument {
  const read = parseDocument({ interface: '1.0', document: 'tasks', revision: 'r1', problems: [], cuts: [], ...body })
  if (read.kind !== 'document') throw new Error(`the fixture is no document: ${read.kind}`)
  return read.document
}

/** What the reader makes of `tasks`; fails the test on a document it could not read at all. */
function readOf(tasks: readonly unknown[]): { rows: TaskRow[]; problems: readonly string[] } {
  const read = tasksOf(documentOf({ tasks }))
  if (read.kind !== 'read') throw new Error(read.reason)
  return { rows: read.value, problems: read.problems }
}

function rowOf(over: JsonRecord): TaskRow | undefined {
  return readOf([served(over)]).rows[0]
}

describe('tasksOf', () => {
  test('reads a served task into the row the views draw', () => {
    expect(readOf([served()])).toEqual({ rows: [ROW], problems: [] })
  })

  test('reads every optional field as null when teamrig serves it null', () => {
    expect(rowOf(BARE)).toEqual({ ...ROW, ...BARE })
  })

  test('reads an optional field teamrig left out as null', () => {
    const task = without(served(), 'description', 'answer', 'size')
    expect(readOf([task])).toEqual({ rows: [{ ...ROW, description: null, answer: null, size: null }], problems: [] })
  })

  test('keeps the text of outside words, the id of a tracker as the source and the ref as stored, with the item it names', () => {
    const row = rowOf({
      title: { text: 'Crash on start', source: 'outside' },
      description: { text: 'It stops.', source: 'outside' },
      source: { kind: 'connector', id: 'tracker', name: 'Tracker' },
      ref: trackerRef('https://tracker.example/items/12'),
    })
    expect(row).toEqual({
      ...ROW,
      title: 'Crash on start',
      description: 'It stops.',
      source: 'tracker',
      isImported: true,
      ref: 'tracker:12',
      item: { tracker: 'Tracker', id: '#12', url: 'https://tracker.example/items/12' },
    })
  })

  test("a session's task whose ref a tracker knows has the item, and is not imported", () => {
    const row = rowOf({ ref: trackerRef('https://tracker.example/items/12') })
    expect(row?.item).toEqual({ tracker: 'Tracker', id: '#12', url: 'https://tracker.example/items/12' })
    expect(row?.isImported).toBe(false)
  })

  test('reads a source of a kind it does not know as not imported', () => {
    expect(rowOf({ source: { kind: 'robot', id: 'r2', name: null } })).toEqual({ ...ROW, source: 'r2' })
  })

  test('a ref with no connector names no item, whatever else it holds, and one teamrig cut to its text alone too', () => {
    expect(rowOf({ ref: trackerRef('https://tracker.example/items/12', { connector: null }) })?.item).toBeNull()
    expect(rowOf({ ref: { text: 'tracker:12' } })).toEqual({ ...ROW, ref: 'tracker:12' })
  })

  test("keeps an item's page only as an https address that is whole as a written one reads", () => {
    const refused = [
      null,
      'http://tracker.example/items/12',
      'javascript:alert(1)',
      'file:///etc/hosts',
      'HTTPS://tracker.example/items/12',
      'https://',
      'https://tracker.example/items/12 https://other.example',
      ' https://tracker.example/items/12',
      'https://tracker.example/items/12)',
      `https://tracker.example/${'a'.repeat(2048)}`,
    ]
    for (const url of refused) expect(rowOf({ ref: trackerRef(url) })?.item).toEqual({ tracker: 'Tracker', id: '#12', url: null })
    expect(rowOf({ ref: without(trackerRef(null), 'url') })?.item).toEqual({ tracker: 'Tracker', id: '#12', url: null })
  })

  test('draws a cut field as the text teamrig put in its place', () => {
    expect(rowOf({ note: '[cut: a token]' })?.note).toBe('[cut: a token]')
  })

  test('passes over a field a later minor added, on the task and inside its parts', () => {
    const later = served({
      rank: 4,
      title: { text: 'Draw the list', source: 'team', language: 'en' },
      answer: { verdict: 'approved', by: 'lead', at: AT, note: 'read the diff', seen: true },
    })
    expect(readOf([later])).toEqual({ rows: [ROW], problems: [] })
  })

  test('reads a type it does not know as a task, and null as one', () => {
    expect(rowOf({ type: 'task' })?.type).toBe('task')
    expect(rowOf({ type: 'epic' })?.type).toBeNull()
    expect(rowOf({ type: null })?.type).toBeNull()
  })

  test('passes over a wait of a kind it does not know and keeps the others', () => {
    const row = rowOf({ waits: [{ kind: 'review', of: 'T2' }, { kind: 'task', id: 'T3' }] })
    expect(row?.waits).toEqual([{ kind: 'task', id: 'T3' }])
  })

  test('reads each status the pane draws', () => {
    for (const status of ['open', 'in-progress', 'verifying', 'waiting', 'done', 'dropped']) {
      expect(rowOf({ status })?.status).toBe(status)
    }
  })

  test('reads a declined answer and a decision with no note', () => {
    const row = rowOf({ answer: { verdict: 'declined', by: 'lead', at: AT, note: null }, decided: { by: 'lead', at: AT } })
    expect(row?.answer).toEqual({ verdict: 'declined', by: 'lead', at: AT, note: null })
    expect(row?.decided).toEqual({ by: 'lead', at: AT, note: null })
  })

  test('leaves out a task with a status it does not know, and says so in one line', () => {
    const read = readOf([served({ status: 'parked' }), served({ id: 'T8' })])
    expect(read.rows.map(row => row.id)).toEqual(['T8'])
    expect(read.problems).toEqual(['teamrig served 1 task the pane cannot read, T7 (status "parked"): update teamrig-pane'])
  })

  test('leaves out a task with an answer it does not know', () => {
    const read = readOf([served({ answer: { verdict: 'deferred', by: 'lead', at: AT, note: null } })])
    expect(read).toEqual({ rows: [], problems: ['teamrig served 1 task the pane cannot read, T7 (answer.verdict "deferred"): update teamrig-pane'] })
  })

  test('leaves out a task with a field of another type, naming the first', () => {
    const cases: readonly (readonly [JsonRecord, string])[] = [
      [{ title: 'Draw the list' }, 'title'],
      [{ title: { source: 'team' } }, 'title.text'],
      [{ description: 'plain' }, 'description'],
      [{ owner: null }, 'owner'],
      [{ priority: '2' }, 'priority'],
      [{ critical: 'no' }, 'critical'],
      [{ type: 3 }, 'type'],
      [{ status: null }, 'status'],
      [{ source: 'lead' }, 'source'],
      [{ source: { id: 'lead', name: 'the lead' } }, 'source.kind'],
      [{ ref: 'notes/plan.md:12' }, 'ref'],
      [{ ref: trackerRef(null, { connector: 'tracker' }) }, 'ref.connector'],
      [{ ref: trackerRef(null, { connector: { id: 'tracker' } }) }, 'ref.connector.name'],
      [{ ref: trackerRef(null, { id: null }) }, 'ref.id'],
      [{ ref: trackerRef(null, { url: 7 }) }, 'ref.url'],
      [{ goals: 'G2' }, 'goals'],
      [{ size: '1.5' }, 'size'],
      [{ waits: [{ kind: 'task' }] }, 'waits[0].id'],
      [{ waits: [{ kind: 'approval', who: 4 }] }, 'waits[0].who'],
      [{ waits: [{ kind: 'time' }] }, 'waits[0].at'],
      [{ waits: [{ who: 'lead' }] }, 'waits[0].kind'],
      [{ waits: ['lead'] }, 'waits[0]'],
      [{ waits: null }, 'waits'],
      [{ answer: { verdict: 'approved', at: AT } }, 'answer.by'],
      [{ decided: { by: 'lead' } }, 'decided.at'],
      [{ after: [3] }, 'after'],
    ]
    for (const [over, field] of cases) {
      expect(readOf([served(over)])).toEqual({ rows: [], problems: [`teamrig served 1 task the pane cannot read, T7 (${field}): update teamrig-pane`] })
    }
  })

  test('names a task with no id, and an entry that is no task, without one', () => {
    const read = readOf([without(served(), 'id'), 'T7', served({ id: 9, status: 'parked' }), null])
    expect(read.rows).toEqual([])
    expect(read.problems).toEqual(['teamrig served 4 tasks the pane cannot read, a task (id), an entry that is no task, a task (id) and 1 more: update teamrig-pane'])
  })

  test('orders the rows by the number in their id, an id spelled another way last in the order served', () => {
    const read = readOf(['T10', 'beta', 'T9', 'T100', 'alpha', 'T2'].map(id => served({ id })))
    expect(read.rows.map(row => row.id)).toEqual(['T2', 'T9', 'T10', 'T100', 'beta', 'alpha'])
    expect(read.problems).toEqual([])
  })

  test('reads a document with no tasks as none', () => {
    expect(readOf([])).toEqual({ rows: [], problems: [] })
  })

  test('cannot read a document with no task list, and names teamrig as the side to update', () => {
    const reason = "teamrig's tasks document holds no task list: update teamrig"
    expect(tasksOf(documentOf({}))).toEqual({ kind: 'unreadable', reason })
    expect(tasksOf(documentOf({ tasks: { T7: served() } }))).toEqual({ kind: 'unreadable', reason })
    expect(tasksOf(documentOf({ unchanged: true }))).toEqual({ kind: 'unreadable', reason })
  })
})
