import { describe, expect, test } from 'claude-code/testing'
import { NO_SESSION, sessionName, titleSpans, type TitleNames } from '../hooks/session-title'
import { SEPARATOR } from '../hooks/rows'

const NAMED: TitleNames = { area: 'tr-pane', areaSource: 'inbox-read', areaName: 'acme-tr-pane', team: 'acme' }

describe('sessionName', () => {
  test('the name the team gives the area, else the area id', () => {
    expect(sessionName('tr-pane', 'acme-tr-pane')).toBe('acme-tr-pane')
    expect(sessionName('tr-pane', null)).toBe('tr-pane')
  })
})

describe('titleSpans', () => {
  test('the name bold, then its area and team dim between dots', () => {
    expect(titleSpans(NAMED)).toEqual([
      { text: 'acme-tr-pane', bold: true },
      SEPARATOR,
      { text: 'area tr-pane', dim: true },
      SEPARATOR,
      { text: 'team acme', dim: true },
    ])
  })

  test('an area the team names no other way, or names by its id, is named once', () => {
    const expected = [{ text: 'tr-pane', bold: true }, SEPARATOR, { text: 'team acme', dim: true }]
    expect(titleSpans({ ...NAMED, areaName: null })).toEqual(expected)
    expect(titleSpans({ ...NAMED, areaName: 'tr-pane' })).toEqual(expected)
  })

  test('a pinned area says so after its name', () => {
    expect(titleSpans({ ...NAMED, areaSource: 'pinned' })?.slice(0, 2)).toEqual([
      { text: 'acme-tr-pane', bold: true },
      { text: ' (pinned)', dim: true },
    ])
  })

  test('no team: the area alone; no area: a dim no session before the team; neither: no title', () => {
    expect(titleSpans({ ...NAMED, areaName: null, team: null })).toEqual([{ text: 'tr-pane', bold: true }])
    expect(titleSpans({ area: null, areaSource: null, areaName: null, team: 'acme' })).toEqual([
      { text: NO_SESSION, dim: true },
      SEPARATOR,
      { text: 'team acme', dim: true },
    ])
    expect(titleSpans({ area: null, areaSource: null, areaName: null, team: null })).toBeNull()
  })
})
