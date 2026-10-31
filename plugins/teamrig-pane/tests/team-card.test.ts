// A session's card on the Teams tab (hooks/team-card.ts): its roles in their colours, leaders, launch, hire, tasks in progress and counted, and unread
// inbox lines, or its retire, a labelled row a fact, each only when it has a value, its task ids, inbox count and
// handover presses of their own.
import { describe, expect, test } from 'claude-code/testing'
import { TimeZone } from '../hooks/core/read/index'
import { LABEL_CELLS } from '../hooks/card'
import { SEPARATOR, type Row, type Span } from '../hooks/rows'
import { sessionKey, teamRows, type SessionFacts } from '../hooks/team'
import { ROLE_COLORS, roleSpans, roleWords, sessionCard } from '../hooks/team-card'
import { HOUR, JERUSALEM, NOW } from './fixtures'
import { ACME, TOOLS, retire, treeOf } from './team-fixtures'

const UTC = TimeZone.UTC
const GUIDE: Span = { text: '    │ ', dim: true }

/** The facts the tree holds for `team`'s session `id`, the retired group open so a retired one is there too. */
function sessionOf(team: string, id: string): SessionFacts {
  const row = teamRows(treeOf([ACME, TOOLS], 'acme'), new Set(['retired:acme'])).find(({ node }) => node.key === sessionKey(team, id))
  if (row?.node.kind !== 'session') throw new Error(`no session ${team}/${id}`)
  return row.node.session
}

/** Each row's words. */
const words = (rows: readonly Row[]): string[] => rows.map(row => row.spans.map(span => span.text).join(''))
/** A card line as drawn: the guide, the label in its column, the value. */
const line = (label: string, value: string) => `${GUIDE.text}${label.padEnd(LABEL_CELLS)}${value}`

/** The spans of the card's row `key` after its guide and label. */
function valueOf(rows: readonly Row[], key: string): Span[] {
  const row = rows.find(found => found.key === key)
  if (row === undefined) throw new Error(`no row ${key}`)
  return row.spans.slice(2)
}

describe('sessionCard', () => {
  test("an area owner's card: its role, its leaders nearest first, its launch, its task in progress, its tasks counted, its cards on the owner and its unread lines", () => {
    const card = sessionCard(sessionOf('acme', 'api'), GUIDE, UTC)
    expect(words(card)).toEqual([
      line('Role', 'area owner'),
      line('Led by', 'web, then lead'),
      line('Launch', 'the default model and effort'),
      line('Now', 'T1 Add the route'),
      line('Tasks', '1 done of 4 · 1 verifying'),
      line('Decisions', 'T4 Pick the database'),
      line('Inbox', '2 unread'),
    ])
    expect(card.map(row => row.key)).toEqual(['role', 'led-by', 'launch', 'now', 'tasks', 'decisions', 'inbox'].map(field => `team-card:acme/api:${field}`))
    expect(card[0]?.hang).toEqual({ text: `${GUIDE.text}${' '.repeat(LABEL_CELLS)}`, dim: true })
  })

  test('the cards the owner put off show under Later with when each comes back; each card id opens its task’s page', () => {
    const web = sessionCard(sessionOf('acme', 'web'), GUIDE, UTC)
    expect(words(web).filter(text => text.includes('T5'))).toEqual([line('Later', 'T5 Name the release until Mon 11-02')])
    expect(web.some(row => row.key === 'team-card:acme/web:decisions')).toBe(false)
    expect(valueOf(web, 'team-card:acme/web:later')).toEqual([{ text: 'T5', task: 'T5' }, { text: ' Name the release' }, { text: ' until Mon 11-02', dim: true }])
    expect(valueOf(sessionCard(sessionOf('acme', 'api'), GUIDE, UTC), 'team-card:acme/api:decisions')).toEqual([{ text: 'T4', task: 'T4' }, { text: ' Pick the database' }])
    // A retired session's card is its retire: a card left on the owner from before shows nowhere.
    expect(words(sessionCard(sessionOf('acme', 'qa'), GUIDE, UTC)).some(text => text.includes('T6'))).toBe(false)
  })

  test("its task id opens the task's page, its count the session's inbox at the first unread line", () => {
    const card = sessionCard(sessionOf('acme', 'api'), GUIDE, UTC)
    expect(valueOf(card, 'team-card:acme/api:now')).toEqual([{ text: 'T1', task: 'T1' }, { text: ' Add the route' }])
    expect(valueOf(card, 'team-card:acme/api:inbox')).toEqual([{ text: '2 unread', color: 'warning', inbox: { area: 'api', unread: 2 } }])
    const lead = sessionCard(sessionOf('acme', 'lead'), GUIDE, UTC)
    expect(valueOf(lead, 'team-card:acme/lead:inbox')).toEqual([{ text: '0 unread', color: 'subtle', inbox: { area: 'lead', unread: 0 } }])
  })

  test("the lead's card: its roles and the sessions it leads, no leaders, the lead's launch defaults, nothing in progress", () => {
    expect(words(sessionCard(sessionOf('acme', 'lead'), GUIDE, UTC))).toEqual([
      line('Role', 'lead · leads 2 sessions'),
      line('Launch', 'model opus at xhigh effort'),
      line('Now', 'nothing in progress'),
      line('Tasks', 'no tasks'),
      line('Inbox', '0 unread'),
    ])
  })

  test('its Tasks row: how many it finished of all it owns, how many wait on their proof when any do, and a dim note when the old ones were archived', () => {
    const web = sessionOf('acme', 'web')
    expect(valueOf(sessionCard(web, GUIDE, UTC), 'team-card:acme/web:tasks')).toEqual([{ text: '0 done of 1' }])
    const api = sessionOf('acme', 'api')
    expect(valueOf(sessionCard(api, GUIDE, UTC), 'team-card:acme/api:tasks')).toEqual([{ text: '1 done of 4' }, SEPARATOR, { text: '1 verifying' }])
    const rotated = { ...web, tasks: { done: 0, verifying: 0, total: 1, archived: true } }
    expect(valueOf(sessionCard(rotated, GUIDE, UTC), 'team-card:acme/web:tasks')).toEqual([{ text: '0 done of 1' }, SEPARATOR, { text: 'older ones archived', dim: true }])
    // One that owns none on a rotated register may have had some archived, so it gives the count and the note.
    const none = { ...web, tasks: { done: 0, verifying: 0, total: 0, archived: true } }
    expect(words(sessionCard(none, GUIDE, UTC))).toContain(line('Tasks', '0 done of 0 · older ones archived'))
    expect(valueOf(sessionCard(sessionOf('acme', 'lead'), GUIDE, UTC), 'team-card:acme/lead:tasks')).toEqual([{ text: 'no tasks', dim: true }])
  })

  test("a hired session's card: its hire's day, who hired it and its review day, its job and why; rehired once retired", () => {
    expect(words(sessionCard(sessionOf('acme', 'ui'), GUIDE, UTC))).toEqual([
      line('Role', 'area owner'),
      line('Led by', 'web, then lead'),
      line('Launch', 'model claude-opus-5-5 at xhigh effort'),
      line('Hired', 'Fri 10-09 by lead · review Sun 10-25'),
      line('Scope', "ui's job"),
      line('Reason', 'more hands'),
      line('Now', 'nothing in progress'),
      line('Tasks', 'no tasks'),
    ])
    expect(words(sessionCard(sessionOf('acme', 'ops'), GUIDE, UTC)).slice(0, 4)).toEqual([
      line('Role', 'security reviewer'),
      line('Led by', 'lead'),
      line('Launch', 'the default model and effort'),
      line('Rehired', 'Sun 10-11 by lead · review Sun 10-25'),
    ])
  })

  test("a leader's Role row says how many sessions it leads, one in the singular, after its roles; one not the lead is a sub-lead", () => {
    expect(words(sessionCard(sessionOf('tools', 'boss'), GUIDE, UTC))[0]).toBe(line('Role', 'lead · leads 1 session'))
    expect(words(sessionCard(sessionOf('acme', 'web'), GUIDE, UTC))[0]).toBe(line('Role', 'sub-lead · leads 2 sessions'))
    expect(roleWords(sessionOf('acme', 'web'))).toEqual(['sub-lead'])
    expect(roleWords(sessionOf('acme', 'api'))).toEqual([])
  })

  test("each role a team config gives reads in teamrig's words, the delivery owner too; a sub-lead's word comes first", () => {
    const ops = sessionOf('acme', 'ops')
    expect(roleWords({ ...ops, roles: ['lead', 'deliveryOwner', 'securityReviewer'] })).toEqual(['lead', 'delivery owner', 'security reviewer'])
    expect(roleWords({ ...ops, leads: 1 })).toEqual(['sub-lead', 'security reviewer'])
  })

  test('each role in a colour of its own, on the Role row too; how many it leads and an area owner in plain text', () => {
    const ops = sessionOf('acme', 'ops')
    expect(roleSpans({ ...ops, leads: 1, roles: ['deliveryOwner', 'securityReviewer'] })).toEqual([
      { text: 'sub-lead', color: 'warning' },
      { text: 'delivery owner', color: 'success' },
      { text: 'security reviewer', color: 'error' },
    ])
    const colors = Object.values(ROLE_COLORS)
    expect(new Set(colors).size).toBe(colors.length)
    expect(valueOf(sessionCard(sessionOf('acme', 'lead'), GUIDE, UTC), 'team-card:acme/lead:role')).toEqual([{ text: 'lead', color: 'claude' }, SEPARATOR, { text: 'leads 2 sessions' }])
    expect(valueOf(sessionCard(sessionOf('acme', 'api'), GUIDE, UTC), 'team-card:acme/api:role')).toEqual([{ text: 'area owner' }])
  })

  test("a retired session's card is its retire: the day and who retired it, why, its heir and its handover, a press", () => {
    const qa = sessionOf('acme', 'qa')
    const card = sessionCard(qa, GUIDE, UTC)
    expect(words(card)).toEqual([line('Retired', 'Sun 10-11 by lead'), line('Reason', 'its job is done'), line('Heir', 'web'), line('Handover', 'handover/qa.md')])
    expect(valueOf(card, 'team-card:acme/qa:handover')).toEqual([{ text: 'handover/qa.md', file: { file: 'handover/qa.md', line: null } }])

    const none = { ...qa, retire: retire('qa', NOW - 60 * HOUR, { noHandover: 'its job left no state' }) }
    expect(words(sessionCard(none, GUIDE, UTC))).toEqual([line('Retired', 'Sun 10-11 by lead'), line('Reason', 'its job is done'), line('Handover', 'none: its job left no state')])
    expect(words(sessionCard({ ...qa, retire: retire('qa', NOW - 60 * HOUR) }, GUIDE, UTC))).toEqual([line('Retired', 'Sun 10-11 by lead'), line('Reason', 'its job is done')])
  })

  test("a peer team's session shows no tasks or unread lines: the pane reads neither its register nor its inbox", () => {
    expect(words(sessionCard(sessionOf('tools', 'dev'), GUIDE, UTC))).toEqual([line('Role', 'area owner'), line('Led by', 'boss'), line('Launch', 'the default model and effort')])
  })

  test("days print on the team's clock", () => {
    const late = { ...sessionOf('acme', 'qa'), retire: retire('qa', Date.UTC(2026, 9, 11, 22, 30)) }
    expect(words(sessionCard(late, GUIDE, UTC))[0]).toBe(line('Retired', 'Sun 10-11 by lead'))
    expect(words(sessionCard(late, GUIDE, JERUSALEM))[0]).toBe(line('Retired', 'Mon 10-12 by lead'))
  })
})
