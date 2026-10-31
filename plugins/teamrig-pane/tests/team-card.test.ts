// A session's card on the Teams tab (hooks/team-card.ts): its role, leaders, launch, hire, tasks in progress and unread
// inbox lines, or its retire, a labelled row a fact, each only when it has a value, its task ids, inbox count and
// handover presses of their own.
import { describe, expect, test } from 'claude-code/testing'
import { TimeZone } from '../hooks/core/read/index'
import { LABEL_CELLS } from '../hooks/card'
import type { Row, Span } from '../hooks/rows'
import { sessionKey, teamRows, type SessionFacts } from '../hooks/team'
import { roleWords, sessionCard } from '../hooks/team-card'
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
  test("an area owner's card: its role, its leaders nearest first, its launch, its task in progress, its cards on the owner and its unread lines", () => {
    const card = sessionCard(sessionOf('acme', 'api'), GUIDE, UTC)
    expect(words(card)).toEqual([
      line('Role', 'area owner'),
      line('Led by', 'web, then lead'),
      line('Launch', 'the default model and effort'),
      line('Now', 'T1 Add the route'),
      line('Decisions', 'T4 Pick the database'),
      line('Inbox', '2 unread'),
    ])
    expect(card.map(row => row.key)).toEqual(['role', 'led-by', 'launch', 'now', 'decisions', 'inbox'].map(field => `team-card:acme/api:${field}`))
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
      line('Inbox', '0 unread'),
    ])
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
    ])
    expect(words(sessionCard(sessionOf('acme', 'ops'), GUIDE, UTC)).slice(0, 4)).toEqual([
      line('Role', 'security reviewer'),
      line('Led by', 'lead'),
      line('Launch', 'the default model and effort'),
      line('Rehired', 'Sun 10-11 by lead · review Sun 10-25'),
    ])
  })

  test("a leader's Role row says how many sessions it leads, one in the singular, after its roles or alone", () => {
    expect(words(sessionCard(sessionOf('tools', 'boss'), GUIDE, UTC))[0]).toBe(line('Role', 'lead · leads 1 session'))
    expect(words(sessionCard(sessionOf('acme', 'web'), GUIDE, UTC))[0]).toBe(line('Role', 'leads 2 sessions'))
    expect(roleWords(sessionOf('acme', 'web'))).toEqual([])
  })

  test("each role a team config gives reads in teamrig's words, the delivery owner too", () => {
    const ops = sessionOf('acme', 'ops')
    expect(roleWords({ ...ops, roles: ['lead', 'deliveryOwner', 'securityReviewer'] })).toEqual(['lead', 'delivery owner', 'security reviewer'])
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
