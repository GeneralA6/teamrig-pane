import { describe, expect, test } from 'claude-code/testing'
import { NO_SESSION, sessionName, titleSpans, type TitleNames } from '../hooks/session-title'

const NAMED: TitleNames = { area: 'tr-pane', areaSource: 'inbox-read', areaName: 'acme-tr-pane', team: 'acme' }

describe('sessionName', () => {
  test('the name the team gives the area, else the area id', () => {
    expect(sessionName('tr-pane', 'acme-tr-pane')).toBe('acme-tr-pane')
    expect(sessionName('tr-pane', null)).toBe('tr-pane')
  })
})

describe('titleSpans', () => {
  test('the team in brackets, then the name without its team prefix, bold, as the tab titles read; never the area id', () => {
    expect(titleSpans(NAMED)).toEqual([{ text: '[acme] tr-pane', bold: true }])
    expect(titleSpans({ ...NAMED, area: 'lead', areaName: 'acme-boss' })).toEqual([{ text: '[acme] boss', bold: true }])
  })

  test('a name that does not lead with its team stays whole after the team', () => {
    expect(titleSpans({ ...NAMED, area: 'lead', areaName: 'team-lead' })).toEqual([{ text: '[acme] team-lead', bold: true }])
    // A name that only starts with the team's letters does not lead with the team.
    expect(titleSpans({ ...NAMED, areaName: 'acmes-tr-pane' })).toEqual([{ text: '[acme] acmes-tr-pane', bold: true }])
  })

  test('an area the team names no other way, or names by its id, is named once', () => {
    const expected = [{ text: '[acme] tr-pane', bold: true }]
    expect(titleSpans({ ...NAMED, areaName: null })).toEqual(expected)
    expect(titleSpans({ ...NAMED, areaName: 'tr-pane' })).toEqual(expected)
  })

  test('a pinned area says so after its name', () => {
    expect(titleSpans({ ...NAMED, areaSource: 'pinned' })).toEqual([
      { text: '[acme] tr-pane', bold: true },
      { text: ' (pinned)', dim: true },
    ])
  })

  test('no team: the name alone; no area: a dim no session under the team; neither: no title', () => {
    expect(titleSpans({ ...NAMED, team: null })).toEqual([{ text: 'acme-tr-pane', bold: true }])
    expect(titleSpans({ ...NAMED, areaName: null, team: null })).toEqual([{ text: 'tr-pane', bold: true }])
    expect(titleSpans({ area: null, areaSource: null, areaName: null, team: 'acme' })).toEqual([{ text: `[acme] ${NO_SESSION}`, dim: true }])
    expect(titleSpans({ area: null, areaSource: null, areaName: null, team: null })).toBeNull()
  })
})
