// The Teams view's teams and sessions from teamrig's `sessions` document (hooks/sessions-document.ts): a served team,
// session and failed folder each read into a plain row, moments as milliseconds; a retired session holds its names
// and retirement; a role or state the pane does not know is passed over; an entry with a field the pane cannot read
// is left out and told in one line each kind; a document with a `self` that is no place, or without one of its three
// lists, is unreadable (T4742).
import { describe, expect, test } from 'claude-code/testing'
import { parseDocument, type JsonRecord, type ReadDocument } from '../hooks/read-document'
import { sessionsOf, type SessionRow, type SessionsRead } from '../hooks/sessions-document'
import { CONTROL_SHOWN } from '../hooks/shown-text'

const HIRED = '2026-03-02T09:00:00.000Z'
const HIRED_MS = Date.UTC(2026, 2, 2, 9, 0, 0)
const BURST = '2026-03-01T00:00:00.000Z'
const BURST_MS = Date.UTC(2026, 2, 1)
const RETIRED = '2026-02-20T18:30:00.000Z'
const RETIRED_MS = Date.UTC(2026, 1, 20, 18, 30, 0)

/** A team as interface 1.0 serves it (teamrig src/interface/sessions.ts ServedTeam). */
function team(over: JsonRecord = {}): JsonRecord {
  return { id: 'shop', parent: null, active: 2, retired: 1, ...over }
}

function hire(over: JsonRecord = {}): JsonRecord {
  return { at: HIRED, by: 'lead', scope: 'the checkout', reason: 'a second pair of hands', reviewBy: '2026-03-16', approvedBy: 'owner', burst: BURST, ...over }
}

function retire(over: JsonRecord = {}): JsonRecord {
  return { at: RETIRED, by: 'lead', reason: 'the burst is over', heir: 'api', ...over }
}

/** A session on a team as interface 1.0 serves it (ServedSession), every field named. */
function session(over: JsonRecord = {}): JsonRecord {
  return {
    team: 'shop',
    id: 'api',
    name: 'shop-api',
    formerNames: ['shop-backend'],
    roles: ['securityReviewer'],
    leader: 'lead',
    ledBy: ['lead'],
    leads: 0,
    active: true,
    launch: { model: 'large', effort: 'high', text: 'large, high effort' },
    hire: hire(),
    rehiredFrom: retire(),
    retire: null,
    unread: 3,
    state: 'busy',
    ask: null,
    since: HIRED,
    host: { id: 'claude-code', name: 'Claude Code' },
    conversation: 'c-1',
    ...over,
  }
}

/** A retired session as served: its names and retirement, the rest empty. */
function retired(over: JsonRecord = {}): JsonRecord {
  return session({
    id: 'old',
    name: 'shop-old',
    formerNames: [],
    roles: [],
    leader: null,
    ledBy: [],
    active: false,
    launch: null,
    hire: null,
    rehiredFrom: null,
    retire: retire(),
    unread: null,
    state: null,
    since: null,
    host: null,
    conversation: null,
    ...over,
  })
}

/** A `sessions` document holding `over` in place of the fields it names. */
function documentOf(over: JsonRecord = {}): ReadDocument {
  const read = parseDocument({
    interface: '1.0',
    document: 'sessions',
    revision: 'r4',
    problems: [],
    self: { team: 'shop', session: 'api' },
    teams: [team()],
    sessions: [session()],
    failures: [],
    cuts: [],
    ...over,
  })
  if (read.kind !== 'document') throw new Error(`no document: ${read.kind}`)
  return read.document
}

function valueOf(document: ReadDocument): SessionsRead | null {
  const read = sessionsOf(document)
  return read.kind === 'read' ? read.value : null
}

function rowsOf(document: ReadDocument): readonly SessionRow[] | null {
  return valueOf(document)?.sessions ?? null
}

function problemsOf(document: ReadDocument): readonly string[] | null {
  const read = sessionsOf(document)
  return read.kind === 'read' ? read.problems : null
}

describe('sessionsOf', () => {
  test('reads who asks, each team, each session and each failed folder into plain rows, moments as milliseconds', () => {
    const read = sessionsOf(documentOf({ teams: [team(), team({ id: 'shop-web', parent: 'shop', active: 0, retired: 0 })], failures: [{ team: 'shop-ops', reason: 'config.json cannot be read' }] }))
    expect(read).toEqual({
      kind: 'read',
      value: {
        self: { team: 'shop', session: 'api' },
        teams: [
          { id: 'shop', parent: null, active: 2, retired: 1 },
          { id: 'shop-web', parent: 'shop', active: 0, retired: 0 },
        ],
        sessions: [
          {
            team: 'shop',
            id: 'api',
            name: 'shop-api',
            formerNames: ['shop-backend'],
            roles: ['securityReviewer'],
            leader: 'lead',
            ledBy: ['lead'],
            leads: 0,
            active: true,
            launch: { model: 'large', effort: 'high', text: 'large, high effort' },
            hire: { at: HIRED_MS, by: 'lead', scope: 'the checkout', reason: 'a second pair of hands', reviewBy: '2026-03-16', approvedBy: 'owner', burst: BURST_MS },
            rehiredFrom: { at: RETIRED_MS, by: 'lead', reason: 'the burst is over', heir: 'api' },
            retire: null,
            unread: 3,
            state: 'busy',
          },
        ],
        failures: [{ team: 'shop-ops', reason: 'config.json cannot be read' }],
      },
      problems: [],
    })
  })

  test('reads no asker when none was asked', () => {
    expect(valueOf(documentOf({ self: null }))?.self).toBeNull()
  })

  test("reads a team's lead, a session with no hire, and one of a team whose words are not served", () => {
    const lead = session({ id: 'lead', name: 'shop-lead', formerNames: [], roles: ['lead', 'deliveryOwner'], leader: null, ledBy: [], leads: 1, hire: null, rehiredFrom: null, unread: null, state: null })
    const other = session({
      team: 'shop-web',
      launch: { model: null, effort: null, text: null },
      hire: hire({ scope: null, reason: null, approvedBy: null, burst: null }),
      rehiredFrom: retire({ reason: null, heir: null }),
    })
    const rows = rowsOf(documentOf({ sessions: [lead, other] }))
    expect(rows?.[0]).toEqual({
      team: 'shop',
      id: 'lead',
      name: 'shop-lead',
      formerNames: [],
      roles: ['lead', 'deliveryOwner'],
      leader: null,
      ledBy: [],
      leads: 1,
      active: true,
      launch: { model: 'large', effort: 'high', text: 'large, high effort' },
      hire: null,
      rehiredFrom: null,
      retire: null,
      unread: null,
      state: null,
    })
    expect(rows?.[1]?.launch).toEqual({ model: null, effort: null, text: null })
    expect(rows?.[1]?.hire).toEqual({ at: HIRED_MS, by: 'lead', scope: null, reason: null, reviewBy: '2026-03-16', approvedBy: null, burst: null })
    expect(rows?.[1]?.rehiredFrom).toEqual({ at: RETIRED_MS, by: 'lead', reason: null, heir: null })
  })

  test('reads a retired session as its names and its retirement', () => {
    expect(rowsOf(documentOf({ sessions: [retired({ formerNames: ['shop-first'] })] }))).toEqual([
      {
        team: 'shop',
        id: 'old',
        name: 'shop-old',
        formerNames: ['shop-first'],
        roles: [],
        leader: null,
        ledBy: [],
        leads: 0,
        active: false,
        launch: null,
        hire: null,
        rehiredFrom: null,
        retire: { at: RETIRED_MS, by: 'lead', reason: 'the burst is over', heir: 'api' },
        unread: null,
        state: null,
      },
    ])
  })

  test('passes over a role and a state the pane does not know, keeping the session', () => {
    const document = documentOf({ sessions: [session({ roles: ['treasurer', 'lead', 'constructor'], state: 'napping' }), session({ id: 'web', state: 'asking' }), session({ id: 'db', state: 'idle' })] })
    expect(rowsOf(document)?.map(row => [row.id, row.roles, row.state])).toEqual([
      ['api', ['lead'], null],
      ['web', ['securityReviewer'], 'asking'],
      ['db', ['securityReviewer'], 'idle'],
    ])
    expect(problemsOf(document)).toEqual([])
  })

  test('leaves out a session with a field it cannot read, naming it by its team and id and the first such field', () => {
    const sessions = [
      session({ id: 'a', hire: hire({ at: 'last spring' }) }),
      'a bare session',
      session({ id: 7 }),
      session({ id: 'd', retire: retire({ at: null }) }),
      session({ id: 'e', roles: 'lead' }),
      session({ id: 'kept' }),
    ]
    const document = documentOf({ sessions })
    expect(rowsOf(document)?.map(row => row.id)).toEqual(['kept'])
    expect(problemsOf(document)).toEqual([
      'teamrig served 5 sessions the pane cannot read, shop/a (hire.at), an entry that is no session, a session (id) and 2 more: update teamrig-pane',
    ])
  })

  test('leaves out a team and a failed folder it cannot read, each kind told in its own line', () => {
    const document = documentOf({
      teams: [team({ id: 'shop-web', active: 'two' }), team({ id: null }), 4, team()],
      sessions: [session({ team: 9 })],
      failures: [{ team: 'shop-ops' }, { reason: 'gone' }, 'shop-web', { team: 'shop-old', reason: 'no folder' }],
    })
    expect(valueOf(document)).toEqual({
      self: { team: 'shop', session: 'api' },
      teams: [{ id: 'shop', parent: null, active: 2, retired: 1 }],
      sessions: [],
      failures: [{ team: 'shop-old', reason: 'no folder' }],
    })
    expect(problemsOf(document)).toEqual([
      'teamrig served 3 teams the pane cannot read, shop-web (active), a team (id), an entry that is no team: update teamrig-pane',
      'teamrig served 1 session the pane cannot read, a session (team): update teamrig-pane',
      'teamrig served 3 failures the pane cannot read, shop-ops (reason), a failure (team), an entry that is no failure: update teamrig-pane',
    ])
  })

  test('answers every text with nothing in it a terminal would act on', () => {
    const document = documentOf({
      self: { team: 'sh\u001bop', session: 'api' },
      teams: [team({ id: 'shop\u0007' })],
      sessions: [session({ name: 'shop‮-api', hire: hire({ scope: '\u009b2Jwiped' }), launch: { model: 'large', effort: null, text: 'large\u001b[31m' } })],
      failures: [{ team: 'shop-ops', reason: 'no\u001b[2J folder' }],
    })
    const value = valueOf(document)
    expect(value?.self?.team).toBe(`sh${CONTROL_SHOWN}op`)
    expect(value?.teams[0]?.id).toBe(`shop${CONTROL_SHOWN}`)
    expect(value?.sessions[0]?.name).toBe('shop-api')
    expect(value?.sessions[0]?.hire?.scope).toBe(`${CONTROL_SHOWN}2Jwiped`)
    expect(value?.sessions[0]?.launch?.text).toBe(`large${CONTROL_SHOWN}[31m`)
    expect(value?.failures[0]?.reason).toBe(`no${CONTROL_SHOWN}[2J folder`)
  })

  test('reads a tree with no team, session or failed folder', () => {
    expect(sessionsOf(documentOf({ self: null, teams: [], sessions: [], failures: [] }))).toEqual({ kind: 'read', value: { self: null, teams: [], sessions: [], failures: [] }, problems: [] })
  })

  test('a document whose asker is no place is unreadable, naming the field', () => {
    expect(sessionsOf(documentOf({ self: 'shop/api' }))).toEqual({ kind: 'unreadable', reason: "teamrig's sessions document cannot be read (self): update teamrig" })
    expect(sessionsOf(documentOf({ self: { team: 'shop' } }))).toEqual({ kind: 'unreadable', reason: "teamrig's sessions document cannot be read (self.session): update teamrig" })
  })

  test('a document without its team, session or failure list is unreadable', () => {
    expect(sessionsOf(documentOf({ teams: null }))).toEqual({ kind: 'unreadable', reason: "teamrig's sessions document holds no team list: update teamrig" })
    expect(sessionsOf(documentOf({ sessions: {} }))).toEqual({ kind: 'unreadable', reason: "teamrig's sessions document holds no session list: update teamrig" })
    expect(sessionsOf(documentOf({ failures: 'none' }))).toEqual({ kind: 'unreadable', reason: "teamrig's sessions document holds no failure list: update teamrig" })
  })
})
