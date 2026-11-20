// The envelope of a `teamrig read` document (hooks/read-document.ts): the interface version read as major.minor, a
// document of the served major read at any minor with fields it does not know kept aside, one of another major refused
// with the side to update, a document the pane does not ask for passed over, its problems kept as lines the pane may
// draw, and a run's lines read one by one so a bad line never takes the others with it (T4742).
import { describe, expect, test } from 'claude-code/testing'
import { DOCUMENT_NAMES, SERVED_MAJOR, isDocumentName, isRecord, parseDocument, parseInterface, readAnswer } from '../hooks/read-document'
import { CONTROL_SHOWN } from '../hooks/shown-text'

const TASKS = { interface: '1.0', document: 'tasks', revision: 'r7', problems: [], tasks: [{ id: 'T1' }] }

describe('parseInterface', () => {
  test('reads major.minor', () => {
    expect(parseInterface('1.0')).toEqual({ major: 1, minor: 0 })
    expect(parseInterface('2.14')).toEqual({ major: 2, minor: 14 })
  })

  test('reads nothing else as a version', () => {
    for (const value of ['1', '1.0.0', 'v1.0', '1.x', ' 1.0', '', '-1.0', '1.', '1234567890.0', 1, 1.5, null, undefined, { major: 1 }]) {
      expect(parseInterface(value)).toBeNull()
    }
  })
})

describe('guards', () => {
  test('a record is an object that is no array and not null', () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord([])).toBe(false)
    expect(isRecord(null)).toBe(false)
    expect(isRecord('tasks')).toBe(false)
  })

  test('a document name is one the pane asks for', () => {
    for (const name of DOCUMENT_NAMES) expect(isDocumentName(name)).toBe(true)
    expect(isDocumentName('meetings')).toBe(false)
    expect(isDocumentName(1)).toBe(false)
  })
})

describe('parseDocument', () => {
  test('reads the envelope and keeps the whole object as the fields', () => {
    expect(parseDocument(TASKS)).toEqual({
      kind: 'document',
      document: { name: 'tasks', interface: { major: 1, minor: 0 }, revision: 'r7', isUnchanged: false, problems: [], fields: TASKS },
    })
  })

  test('reads a later minor, with the fields it does not know left in place', () => {
    const later = { ...TASKS, interface: `${SERVED_MAJOR}.9`, added: { by: 'a later teamrig' } }
    const read = parseDocument(later)
    expect(read.kind).toBe('document')
    if (read.kind !== 'document') return
    expect(read.document.interface).toEqual({ major: SERVED_MAJOR, minor: 9 })
    expect(read.document.fields['added']).toEqual({ by: 'a later teamrig' })
  })

  test('a document with no revision is read whole each time', () => {
    const read = parseDocument({ interface: '1.0', document: 'config' })
    expect(read).toEqual({
      kind: 'document',
      document: { name: 'config', interface: { major: 1, minor: 0 }, revision: null, isUnchanged: false, problems: [], fields: { interface: '1.0', document: 'config' } },
    })
  })

  test('an unchanged answer says so, and only for a true flag', () => {
    const unchanged = parseDocument({ interface: '1.0', document: 'inbox', revision: 'r3', unchanged: true })
    expect(unchanged.kind === 'document' && unchanged.document.isUnchanged).toBe(true)
    const worded = parseDocument({ interface: '1.0', document: 'inbox', revision: 'r3', unchanged: 'true' })
    expect(worded.kind === 'document' && worded.document.isUnchanged).toBe(false)
  })

  test('keeps the problems that are text', () => {
    const read = parseDocument({ ...TASKS, problems: ['team beta: its folder is locked', 4, null, 'one line skipped'] })
    expect(read.kind === 'document' ? read.document.problems : null).toEqual(['team beta: its folder is locked', 'one line skipped'])
    const none = parseDocument({ ...TASKS, problems: 'locked' })
    expect(none.kind === 'document' ? none.document.problems : null).toEqual([])
  })

  test('keeps a problem with nothing in it a terminal would act on', () => {
    const read = parseDocument({ ...TASKS, problems: ['team \u001b[31mbeta\u001b[0m: locked', 'T4 ‮enod'] })
    expect(read.kind === 'document' ? read.document.problems : null).toEqual([`team ${CONTROL_SHOWN}[31mbeta${CONTROL_SHOWN}[0m: locked`, 'T4 enod'])
  })

  test('a newer major is refused, naming the pane as the side to update', () => {
    expect(parseDocument({ ...TASKS, interface: '2.0' })).toEqual({
      kind: 'unreadable',
      reason: 'teamrig printed interface 2.0, newer than the pane reads: update teamrig-pane',
    })
  })

  test('an older major is refused, naming teamrig as the side to update', () => {
    expect(parseDocument({ ...TASKS, interface: '0.3' })).toEqual({
      kind: 'unreadable',
      reason: 'teamrig printed interface 0.3, older than the pane reads: update teamrig',
    })
  })

  test('another major is refused before its name is read', () => {
    expect(parseDocument({ interface: '2.0', document: 'meetings' }).kind).toBe('unreadable')
  })

  test('a document the pane does not ask for is passed over', () => {
    expect(parseDocument({ interface: '1.1', document: 'meetings', meetings: [] })).toEqual({ kind: 'passed-over' })
  })

  test('says what a value lacks', () => {
    expect(parseDocument(['tasks'])).toEqual({ kind: 'unreadable', reason: 'teamrig printed a line that is no document' })
    expect(parseDocument({ document: 'tasks' })).toEqual({ kind: 'unreadable', reason: 'teamrig printed a document with no interface version' })
    expect(parseDocument({ interface: 1, document: 'tasks' })).toEqual({ kind: 'unreadable', reason: 'teamrig printed a document with no interface version' })
    expect(parseDocument({ interface: '1.0' })).toEqual({ kind: 'unreadable', reason: 'teamrig printed a document with no name' })
  })
})

describe('readAnswer', () => {
  const INBOX = { interface: '1.0', document: 'inbox', revision: 'r2', lines: [] }

  test('reads a document per line, in the order printed', () => {
    const answer = readAnswer(`${JSON.stringify(TASKS)}\r\n\n${JSON.stringify(INBOX)}\n`)
    expect(answer.documents.map(document => document.name)).toEqual(['tasks', 'inbox'])
    expect(answer.unreadable).toEqual([])
  })

  test('a line it cannot read leaves the others read, and each reason is told once', () => {
    const answer = readAnswer(['not json', JSON.stringify(TASKS), '{"cut', JSON.stringify({ ...INBOX, interface: '2.0' }), JSON.stringify(INBOX)].join('\n'))
    expect(answer.documents.map(document => document.name)).toEqual(['tasks', 'inbox'])
    expect(answer.unreadable).toEqual(['teamrig printed a line that is no JSON', 'teamrig printed interface 2.0, newer than the pane reads: update teamrig-pane'])
  })

  test('passes over a document the pane does not ask for, with no problem', () => {
    expect(readAnswer(JSON.stringify({ interface: '1.2', document: 'meetings' }))).toEqual({ documents: [], unreadable: [] })
  })

  test('reads nothing from an empty answer', () => {
    expect(readAnswer('')).toEqual({ documents: [], unreadable: [] })
  })
})
