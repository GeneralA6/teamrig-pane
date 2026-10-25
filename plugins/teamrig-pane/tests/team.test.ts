import { describe, expect, test } from 'claude-code/testing'
import { sessionKey, teamRows, teamTree, type SessionFacts, type TeamRead, type TeamRow, type TeamTreeNode } from '../hooks/team'
import { ACME, OTHER, TOOLS, configOf, treeOf } from './team-fixtures'

/** One line per row: indented by depth, ▾ open, ▸ closed, · nothing under it, then the node. */
function outline(rows: readonly TeamRow[]): string[] {
  return rows.map(({ node, depth, open }) => {
    const mark = open === null ? '·' : open ? '▾' : '▸'
    const label = node.kind === 'team' ? `team ${node.team.team}` : node.kind === 'closed' ? 'closed' : node.session.id
    return `${'  '.repeat(depth)}${mark} ${label}`
  })
}

function sessionOf(root: TeamTreeNode, team: string, id: string): SessionFacts {
  const find = (node: TeamTreeNode): SessionFacts | undefined =>
    node.kind === 'session' && node.key === sessionKey(team, id) ? node.session : node.children.map(find).find(found => found !== undefined)
  const found = find(root)
  if (found === undefined) throw new Error(`no session ${team}/${id}`)
  return found
}

const NONE: ReadonlySet<string> = new Set()

describe('teamTree', () => {
  test('the root team over its lead, each session under its leader, the closed group (closed), then the child team', () => {
    expect(outline(teamRows(treeOf([ACME, TOOLS, OTHER], 'acme'), NONE))).toEqual([
      '▾ team acme',
      '  ▾ lead',
      '    ▾ web',
      '      · api',
      '      · ui',
      '    · ops',
      '  ▸ closed',
      '  ▾ team tools',
      '    ▾ boss',
      '      · dev',
    ])
  })

  test('a pane in a child team sees the whole tree from its root; another root team is left out', () => {
    expect(outline(teamRows(treeOf([OTHER, TOOLS, ACME], 'tools'), NONE))).toEqual(outline(teamRows(treeOf([ACME, TOOLS, OTHER], 'acme'), NONE)))
    expect(outline(teamRows(treeOf([ACME, TOOLS, OTHER], 'other'), NONE))).toEqual(['▾ team other', '  · lead'])
  })

  test("a team's counts: the sessions on its config, the retired ones no longer on it, and its parent", () => {
    const root = treeOf([ACME, TOOLS], 'acme')
    expect(root.kind === 'team' ? root.team : null).toEqual({ team: 'acme', parent: null, active: 5, closed: 1 })
    const tools = root.children.find(node => node.key === 'team:tools')
    expect(tools?.kind === 'team' ? tools.team : null).toEqual({ team: 'tools', parent: 'acme', active: 2, closed: 0 })
  })

  test("a session's name, former names, roles, the sessions it leads and its tasks in progress", () => {
    const root = treeOf([ACME], 'acme')
    expect(sessionOf(root, 'acme', 'api')).toEqual({
      team: 'acme',
      id: 'api',
      name: 'acme-backend',
      formerNames: ['acme-api'],
      active: true,
      roles: [],
      leads: 0,
      hire: null,
      rehiredFrom: null,
      retire: null,
      now: [{ id: 'T1', title: 'Add the route' }],
    })
    expect(sessionOf(root, 'acme', 'lead')).toMatchObject({ name: 'acme-lead', roles: ['lead'], leads: 2, now: [] })
    expect(sessionOf(root, 'acme', 'web')).toMatchObject({ leads: 2, now: [{ id: 'T3', title: 'Plan the page' }] })
  })

  test('a hired session carries its hire; one hired again also the retire it came back from', () => {
    const root = treeOf([ACME], 'acme')
    expect(sessionOf(root, 'acme', 'ui')).toMatchObject({ hire: ACME.hires[0], rehiredFrom: null })
    expect(sessionOf(root, 'acme', 'ops')).toMatchObject({ active: true, roles: ['securityReviewer'], hire: ACME.hires[5], rehiredFrom: ACME.hires[3], retire: null })
  })

  test('the closed group opens on a toggle: a retired session under its last name, with its retire and no roles or tasks', () => {
    const root = treeOf([ACME], 'acme')
    expect(outline(teamRows(root, new Set(['closed:acme']))).slice(-2)).toEqual(['  ▾ closed', '    · qa'])
    expect(sessionOf(root, 'acme', 'qa')).toEqual({
      team: 'acme',
      id: 'qa',
      name: 'acme-tester',
      formerNames: ['acme-qa'],
      active: false,
      roles: [],
      leads: 0,
      hire: null,
      rehiredFrom: null,
      retire: ACME.hires[4],
      now: [],
    })
  })

  test("a team with no register read lists no session's tasks", () => {
    expect(sessionOf(treeOf([ACME, TOOLS], 'acme'), 'tools', 'dev').now).toEqual([])
  })

  test('a parent with no config: the team is the root of its own tree, its parent still named', () => {
    const root = treeOf([TOOLS], 'tools')
    expect(outline(teamRows(root, NONE))).toEqual(['▾ team tools', '  ▾ boss', '    · dev'])
    expect(root.kind === 'team' ? root.team.parent : null).toBe('acme')
  })

  test('teams whose parents go round a loop: the tree starts at the own team and walks each team once', () => {
    const a: TeamRead = { ...OTHER, team: 'a', config: configOf({ team: { id: 'a', parent: 'b' }, sessions: ['lead'], roles: { lead: 'lead' } }) }
    const b: TeamRead = { ...OTHER, team: 'b', config: configOf({ team: { id: 'b', parent: 'a' }, sessions: ['lead'], roles: { lead: 'lead' } }) }
    expect(outline(teamRows(treeOf([a, b], 'a'), NONE))).toEqual(['▾ team a', '  · lead', '  ▾ team b', '    · lead'])
  })

  test('no config read for the own team: no tree, and no rows', () => {
    expect(teamTree([TOOLS], 'acme')).toBe(null)
    expect(teamRows(null, NONE)).toEqual([])
  })
})

describe('teamRows', () => {
  test('a toggled team or leader closes, hiding what is under it; the keys hold across reads', () => {
    const toggled = new Set(['session:acme/web', 'team:tools'])
    expect(outline(teamRows(treeOf([ACME, TOOLS], 'acme'), toggled))).toEqual(['▾ team acme', '  ▾ lead', '    ▸ web', '    · ops', '  ▸ closed', '  ▸ team tools'])
    expect(outline(teamRows(treeOf([ACME], 'acme'), new Set(['team:acme'])))).toEqual(['▸ team acme'])
  })

  test('a toggle on a node with nothing under it changes nothing', () => {
    expect(teamRows(treeOf([ACME], 'acme'), new Set(['session:acme/api']))).toEqual(teamRows(treeOf([ACME], 'acme'), NONE))
  })
})
