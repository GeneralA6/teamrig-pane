// One team's sessions out of the `sessions` document (hooks/session-roster.ts): the lead tree in the served order,
// the name a session on the team goes by, and the session a `/teamrig-pane <session>` word names, with the refusals
// teamrig's own lookup gives; no file is read, so no document yet and a failed team folder are refusals too (T4742).
import { describe, expect, test } from 'claude-code/testing'
import { USAGE } from '../hooks/command'
import { leadOf, teamSessions } from '../hooks/leads'
import { leadsOf, lookupSession, nameOf } from '../hooks/session-roster'
import type { SessionRow, SessionsRead } from '../hooks/sessions-document'

/** A session on team web as the sessions reader hands it, under the lead unless `over` says otherwise. */
function session(id: string, over: Partial<SessionRow> = {}): SessionRow {
  return {
    team: 'web',
    id,
    name: `web-${id}`,
    formerNames: [],
    roles: [],
    leader: 'lead',
    ledBy: ['lead'],
    leads: 0,
    active: true,
    launch: null,
    hire: null,
    rehiredFrom: null,
    retire: null,
    unread: 0,
    state: null,
    ...over,
  }
}

/** A session retired from team web: its names and its retirement only. */
function retired(id: string, over: Partial<SessionRow> = {}): SessionRow {
  return session(id, { leader: null, ledBy: [], active: false, unread: null, retire: { at: 1, by: 'lead', reason: null, heir: null }, ...over })
}

const LEAD = session('lead', { leader: null, ledBy: [], leads: 2, roles: ['lead'] })

/**
 * Team web: lead over front and ops, front a sub-lead over api and ui; api, once web-backend, is web-api now; old,
 * once web-legacy, is retired. Team shop beside it holds an api of its own.
 */
const SESSIONS: readonly SessionRow[] = [
  LEAD,
  session('front', { leads: 2 }),
  session('api', { leader: 'front', ledBy: ['front', 'lead'], formerNames: ['web-backend'] }),
  session('ui', { leader: 'front', ledBy: ['front', 'lead'] }),
  session('ops'),
  retired('old', { formerNames: ['web-legacy'] }),
  session('boss', { team: 'shop', name: 'shop-boss', leader: null, ledBy: [] }),
  session('api', { team: 'shop', name: 'shop-api', leader: 'boss', ledBy: ['boss'] }),
]

function readOf(over: Partial<SessionsRead> = {}): SessionsRead {
  return {
    self: null,
    teams: [
      { id: 'web', parent: null, active: 5, retired: 1 },
      { id: 'shop', parent: null, active: 2, retired: 0 },
    ],
    sessions: SESSIONS,
    failures: [],
    ...over,
  }
}

const LISTED = 'lead (web-lead), front (web-front), api (web-api), ui (web-ui), ops (web-ops)'

describe('leadsOf', () => {
  test("the team's lead is the session served with no leader, each other one under the leader served for it", () => {
    expect(leadsOf(readOf(), 'web')).toEqual({ lead: 'lead', leaderOf: { front: 'lead', api: 'front', ui: 'front', ops: 'lead' } })
    expect(leadsOf(readOf(), 'shop')).toEqual({ lead: 'boss', leaderOf: { api: 'boss' } })
  })

  test("the team's sessions come out in the served order, the lead first wherever it is served", () => {
    const read = readOf({ sessions: [session('ops'), session('api'), LEAD] })
    const leads = leadsOf(read, 'web')
    expect(leads === null ? null : teamSessions(leads)).toEqual(['lead', 'ops', 'api'])
  })

  test('a retired session leads no one and is led by no one', () => {
    const leads = leadsOf(readOf(), 'web')
    expect(leads?.leaderOf['old']).toBe(undefined)
    expect(leadOf('old', leads)).toBe('lead')
  })

  test('a second session served with no leader answers to the lead', () => {
    expect(leadsOf(readOf({ sessions: [LEAD, session('stray', { leader: null, ledBy: [] })] }), 'web')).toEqual({ lead: 'lead', leaderOf: { stray: 'lead' } })
  })

  test('null for a team the document holds no lead of', () => {
    expect(leadsOf(readOf(), 'nowhere')).toBe(null)
    expect(leadsOf(readOf({ sessions: [retired('old')] }), 'web')).toBe(null)
  })
})

describe('nameOf', () => {
  test("a session's current name on its own team", () => {
    expect(nameOf(readOf(), 'web', 'api')).toBe('web-api')
    expect(nameOf(readOf(), 'shop', 'api')).toBe('shop-api')
  })

  test('null for an id not on the team now: an unknown one, a retired one', () => {
    expect(nameOf(readOf(), 'web', 'boss')).toBe(null)
    expect(nameOf(readOf(), 'web', 'old')).toBe(null)
  })
})

describe('lookupSession', () => {
  test("finds a session by its id, its current name, or a former name, as teamrig's commands do", () => {
    expect(lookupSession('api', 'web', readOf())).toEqual({ ok: true, id: 'api' })
    expect(lookupSession('web-api', 'web', readOf())).toEqual({ ok: true, id: 'api' })
    expect(lookupSession('web-backend', 'web', readOf())).toEqual({ ok: true, id: 'api' })
    expect(lookupSession('web-ui', 'web', readOf())).toEqual({ ok: true, id: 'ui' })
  })

  test('a current name wins over a former one', () => {
    const read = readOf({ sessions: [LEAD, session('api', { formerNames: ['web-ui'] }), session('ui')] })
    expect(lookupSession('web-ui', 'web', read)).toEqual({ ok: true, id: 'ui' })
  })

  test("refuses a word that names no session of the team, another team's session too, listing the team's sessions", () => {
    expect(lookupSession('web', 'web', readOf())).toEqual({ ok: false, problem: `Not pinned (team web): web is not a session on this team (sessions: ${LISTED}).` })
    expect(lookupSession('shop-boss', 'web', readOf())).toEqual({
      ok: false,
      problem: `Not pinned (team web): shop-boss is not a session on this team (sessions: ${LISTED}).`,
    })
  })

  test('refuses a current name two sessions share, naming both ids', () => {
    const read = readOf({ sessions: [LEAD, session('api', { name: 'web-twin' }), session('ui', { name: 'web-twin' })] })
    expect(lookupSession('web-twin', 'web', read)).toEqual({
      ok: false,
      problem: 'Not pinned (team web): web-twin is the name of 2 sessions (api, ui); use the id.',
    })
  })

  test('refuses the id and every name of a session no longer on the team', () => {
    expect(lookupSession('web-old', 'web', readOf())).toEqual({
      ok: false,
      problem: `Not pinned (team web): web-old was the name of old, which is no longer on this team (sessions: ${LISTED}).`,
    })
    expect(lookupSession('web-legacy', 'web', readOf())).toEqual({
      ok: false,
      problem: `Not pinned (team web): web-legacy was the name of old, which is no longer on this team (sessions: ${LISTED}).`,
    })
    expect(lookupSession('old', 'web', readOf())).toEqual({ ok: false, problem: `Not pinned (team web): old is not a session on this team (sessions: ${LISTED}).` })
  })

  test('with no team, or a team the document does not hold, the word is the id itself when it can be one', () => {
    expect(lookupSession('po', null, null)).toEqual({ ok: true, id: 'po' })
    expect(lookupSession('no such area!', null, readOf())).toEqual({ ok: false, problem: `Not pinned: "no such area!" is not a session id. ${USAGE}` })
    expect(lookupSession('web-api', 'fresh', readOf())).toEqual({ ok: true, id: 'web-api' })
    expect(lookupSession('no such area!', 'fresh', readOf())).toEqual({ ok: false, problem: `Not pinned: "no such area!" is not a session id. ${USAGE}` })
  })

  test('refuses with no sessions document read yet, and never takes the word as an id then', () => {
    expect(lookupSession('api', 'web', null)).toEqual({ ok: false, problem: "Not pinned: team web's sessions are not read yet." })
  })

  test('refuses for a team whose folder teamrig could not serve, with its reason', () => {
    const read = readOf({ teams: [], sessions: [], failures: [{ team: 'web', reason: 'config.json is no JSON' }] })
    expect(lookupSession('api', 'web', read)).toEqual({ ok: false, problem: 'Not pinned: team web cannot be read (config.json is no JSON).' })
  })
})
