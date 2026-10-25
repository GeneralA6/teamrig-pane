import { describe, expect, test } from 'claude-code/testing'
import type { TeamLeads } from '../types'
import { leadOf, sameLeads, teamLeads } from '../hooks/leads'
import { configOf } from './team-fixtures'

/** Team acme: lead over web and ops; web a sub-lead over api and ui. */
const ACME = { sessions: ['lead', 'web', 'api', 'ui', 'ops'], roles: { lead: 'lead' }, leads: { web: ['api', 'ui'] } }
const LEADS: TeamLeads = { lead: 'lead', leaderOf: { web: 'lead', api: 'web', ui: 'web', ops: 'lead' } }

describe('teamLeads', () => {
  test("each session's direct leader: the sub-lead that lists it, else the lead; the lead has none", () => {
    expect(teamLeads(configOf(ACME))).toEqual(LEADS)
  })

  test('a config with no sub-leads puts every session under the lead', () => {
    expect(teamLeads(configOf({ ...ACME, leads: {} }))).toEqual({ lead: 'lead', leaderOf: { web: 'lead', api: 'lead', ui: 'lead', ops: 'lead' } })
  })
})

describe('leadOf', () => {
  test("a member's sub-lead, a sub-lead's lead", () => {
    expect(leadOf('api', LEADS)).toBe('web')
    expect(leadOf('web', LEADS)).toBe('lead')
  })

  test("the lead's own tasks and an owner no longer on the team fall to the lead", () => {
    expect(leadOf('lead', LEADS)).toBe('lead')
    expect(leadOf('gone', LEADS)).toBe('lead')
  })

  test('none with no team config read', () => {
    expect(leadOf('api', null)).toBe(null)
  })
})

describe('sameLeads', () => {
  test('equal by fields, not by reference', () => {
    expect(sameLeads(LEADS, { lead: 'lead', leaderOf: { ...LEADS.leaderOf } })).toBe(true)
    expect(sameLeads(null, null)).toBe(true)
  })

  test('a moved member, an added session, another lead or a missing read differ', () => {
    expect(sameLeads(LEADS, { ...LEADS, leaderOf: { ...LEADS.leaderOf, ui: 'lead' } })).toBe(false)
    expect(sameLeads(LEADS, { ...LEADS, leaderOf: { ...LEADS.leaderOf, qa: 'lead' } })).toBe(false)
    expect(sameLeads(LEADS, { ...LEADS, lead: 'web' })).toBe(false)
    expect(sameLeads(LEADS, null)).toBe(false)
  })
})
