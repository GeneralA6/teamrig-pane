// The Inbox view's lines from teamrig's `inbox` document (hooks/inbox-document.ts): a served line reads into the item
// the view draws, its words from the marked text and its key as served; a line with no date is passed over; a line
// with a field the pane cannot read is left out and told in one line; a session that never read its inbox has no line
// drawn as unread; a document with no session, count or line list is unreadable (T4742).
import { describe, expect, test } from 'claude-code/testing'
import { inboxOf } from '../hooks/inbox-document'
import { parseDocument, type JsonRecord, type ReadDocument } from '../hooks/read-document'
import { CONTROL_SHOWN } from '../hooks/shown-text'

const AT = '2026-03-02T09:00:00.000Z'
const AT_MS = Date.UTC(2026, 2, 2, 9, 0, 0)

/** A line as interface 1.0 serves it (teamrig src/interface/inbox.ts ServedLine), every field named. */
function line(over: JsonRecord = {}): JsonRecord {
  return { key: 'a1b2c3', at: AT, from: 'lead', text: { text: 'T7 is yours', source: 'team' }, unread: true, ...over }
}

/** An `inbox` document holding `over` in place of the fields it names. */
function documentOf(over: JsonRecord = {}): ReadDocument {
  const read = parseDocument({
    interface: '1.0',
    document: 'inbox',
    revision: 'r2',
    problems: [],
    session: { id: 'api', name: 'team-api' },
    unread: 1,
    lines: [line()],
    cuts: [],
    ...over,
  })
  if (read.kind !== 'document') throw new Error(`no document: ${read.kind}`)
  return read.document
}

describe('inboxOf', () => {
  test('reads the session, its count and each line into the item the view draws', () => {
    const read = inboxOf(documentOf({ lines: [line({ key: 'k1', unread: false }), line({ key: 'k1-2', from: null, text: { text: 'no sender', source: 'outside' } })] }))
    expect(read).toEqual({
      kind: 'read',
      value: {
        session: { id: 'api', name: 'team-api' },
        unread: 1,
        items: [
          { key: 'k1', at: AT_MS, from: 'lead', text: 'T7 is yours', unread: false },
          { key: 'k1-2', at: AT_MS, from: null, text: 'no sender', unread: true },
        ],
      },
      problems: [],
    })
  })

  test('passes over a line with no date, with no problem', () => {
    const read = inboxOf(documentOf({ lines: [line({ key: 'k1', at: null, from: null }), line({ key: 'k2' })] }))
    expect(read.kind === 'read' ? read.value.items.map(item => item.key) : null).toEqual(['k2'])
    expect(read.kind === 'read' ? read.problems : null).toEqual([])
  })

  test('a session that never read its inbox has a count nobody knows, and no line drawn as unread', () => {
    const read = inboxOf(documentOf({ unread: null, lines: [line({ key: 'k1' }), line({ key: 'k2' })] }))
    expect(read.kind === 'read' ? read.value.unread : 0).toBeNull()
    expect(read.kind === 'read' ? read.value.items.map(item => item.unread) : null).toEqual([false, false])
  })

  test('leaves out a line with a field it cannot read, naming it by its key and the first such field', () => {
    const lines = [line({ key: 'k1', at: 'yesterday' }), 'a bare line', line({ key: 7 }), line({ key: 'k4', text: 'plain' }), line({ key: 'k5' })]
    const read = inboxOf(documentOf({ lines }))
    expect(read.kind === 'read' ? read.value.items.map(item => item.key) : null).toEqual(['k5'])
    expect(read.kind === 'read' ? read.problems : null).toEqual([
      'teamrig served 4 lines the pane cannot read, k1 (at), an entry that is no line, a line (key) and 1 more: update teamrig-pane',
    ])
  })

  test('answers every text with nothing in it a terminal would act on', () => {
    const read = inboxOf(documentOf({ session: { id: 'api', name: 'team\u001b-api' }, lines: [line({ from: 'le‮ad', text: { text: '\u009b2Jwiped', source: 'team' } })] }))
    expect(read.kind === 'read' ? read.value.session.name : null).toBe(`team${CONTROL_SHOWN}-api`)
    expect(read.kind === 'read' ? read.value.items : null).toEqual([{ key: 'a1b2c3', at: AT_MS, from: 'lead', text: `${CONTROL_SHOWN}2Jwiped`, unread: true }])
  })

  test('reads an inbox with no lines', () => {
    expect(inboxOf(documentOf({ unread: 0, lines: [] }))).toEqual({ kind: 'read', value: { session: { id: 'api', name: 'team-api' }, unread: 0, items: [] }, problems: [] })
  })

  test('a document with no session, or a count that is no number, is unreadable, naming the field', () => {
    expect(inboxOf(documentOf({ session: null }))).toEqual({ kind: 'unreadable', reason: "teamrig's inbox document cannot be read (session): update teamrig" })
    expect(inboxOf(documentOf({ session: { id: 'api' } }))).toEqual({ kind: 'unreadable', reason: "teamrig's inbox document cannot be read (session.name): update teamrig" })
    expect(inboxOf(documentOf({ unread: 'many' }))).toEqual({ kind: 'unreadable', reason: "teamrig's inbox document cannot be read (unread): update teamrig" })
  })

  test('a document with no line list is unreadable', () => {
    expect(inboxOf(documentOf({ lines: null }))).toEqual({ kind: 'unreadable', reason: "teamrig's inbox document holds no line list: update teamrig" })
  })
})
