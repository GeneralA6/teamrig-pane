import { describe, expect, test } from 'claude-code/testing'
import { foundRows, sessionKey, teamRows, teamTree, type SessionFacts, type TeamRead, type TeamRow, type TeamTreeNode } from '../hooks/team'
import { HOUR, NOW } from './fixtures'
import { ACME, ACME_COUNTS, OTHER, TOOLS, WEEK_RESET, configOf, treeOf, weekFile } from './team-fixtures'

/** One line per row: indented by depth, ▾ open, ▸ closed, · nothing under it, then the node. */
function outline(rows: readonly TeamRow[]): string[] {
  return rows.map(({ node, depth, open }) => {
    const mark = open === null ? '·' : open ? '▾' : '▸'
    const label = node.kind === 'team' ? `team ${node.team.team}` : node.kind === 'retired' ? 'retired' : node.session.id
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
  test('the root team over its lead, each session under its leader, the retired group (closed), then the child team', () => {
    expect(outline(teamRows(treeOf([ACME, TOOLS, OTHER], 'acme'), NONE))).toEqual([
      '▾ team acme',
      '  ▾ lead',
      '    ▾ web',
      '      · api',
      '      · ui',
      '    · ops',
      '  ▸ retired',
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
    expect(root.kind === 'team' ? root.team : null).toEqual({ team: 'acme', parent: null, active: 5, retired: 1, week: null })
    const tools = root.children.find(node => node.key === 'team:tools')
    expect(tools?.kind === 'team' ? tools.team : null).toEqual({ team: 'tools', parent: 'acme', active: 2, retired: 0, week: null })
  })

  test("a session's name, roles, the sessions it leads and its leaders, its launch, tasks in progress and counted, unread lines and cards on the owner", () => {
    const root = treeOf([ACME], 'acme')
    expect(sessionOf(root, 'acme', 'api')).toEqual({
      team: 'acme',
      id: 'api',
      name: 'acme-backend',
      active: true,
      roles: [],
      leads: 0,
      ledBy: ['web', 'lead'],
      launch: {},
      hire: null,
      rehiredFrom: null,
      retire: null,
      now: [{ id: 'T1', title: 'Add the route' }],
      tasks: { done: 1, verifying: 1, total: 4, archived: false },
      unread: 2,
      decisions: { due: [{ id: 'T4', title: 'Pick the database' }], later: [] },
    })
    expect(sessionOf(root, 'acme', 'lead')).toMatchObject({
      name: 'acme-lead',
      roles: ['lead'],
      leads: 2,
      ledBy: [],
      now: [],
      tasks: { done: 0, verifying: 0, total: 0, archived: false },
      unread: 0,
      decisions: { due: [], later: [] },
    })
    expect(sessionOf(root, 'acme', 'web')).toMatchObject({
      leads: 2,
      ledBy: ['lead'],
      now: [{ id: 'T3', title: 'Plan the page' }],
      tasks: { done: 0, verifying: 0, total: 1, archived: false },
      decisions: { due: [], later: [{ id: 'T5', title: 'Name the release', until: 'Mon 11-02' }] },
    })
  })

  test("the launch teamrig starts a session on: its own entry, the lead's defaults under the keys it leaves unset", () => {
    const root = treeOf([ACME], 'acme')
    expect(sessionOf(root, 'acme', 'ui')).toMatchObject({ launch: { model: 'claude-opus-5-5', effort: 'xhigh' }, unread: null })
    expect(sessionOf(root, 'acme', 'lead').launch).toEqual({ model: 'opus', effort: 'xhigh' })
  })

  test('a hired session carries its hire; one hired again also the retire it came back from', () => {
    const root = treeOf([ACME], 'acme')
    expect(sessionOf(root, 'acme', 'ui')).toMatchObject({ hire: ACME.hires[0], rehiredFrom: null })
    expect(sessionOf(root, 'acme', 'ops')).toMatchObject({ active: true, roles: ['securityReviewer'], hire: ACME.hires[5], rehiredFrom: ACME.hires[3], retire: null })
  })

  test('the retired group opens on a toggle: a retired session under its last name, with its retire and no roles, leaders, launch, tasks, unread lines or cards on the owner', () => {
    const root = treeOf([ACME], 'acme')
    expect(outline(teamRows(root, new Set(['retired:acme']))).slice(-2)).toEqual(['  ▾ retired', '    · qa'])
    expect(sessionOf(root, 'acme', 'qa')).toEqual({
      team: 'acme',
      id: 'qa',
      name: 'acme-tester',
      active: false,
      roles: [],
      leads: 0,
      ledBy: [],
      launch: null,
      hire: null,
      rehiredFrom: null,
      retire: ACME.hires[4],
      now: [],
      tasks: null,
      unread: null,
      decisions: { due: [], later: [] },
    })
  })

  test("a team whose register and inbox the pane does not read knows no session's tasks, unread lines or cards on the owner", () => {
    expect(sessionOf(treeOf([ACME, TOOLS], 'acme'), 'tools', 'dev')).toMatchObject({ now: null, tasks: null, unread: null, decisions: null })
  })

  test("a register a compaction rotated marks each session's counts archived, as it misses the tasks finished long ago", () => {
    const root = treeOf([{ ...ACME, taskCounts: { ...ACME_COUNTS, archived: true } }], 'acme')
    expect(sessionOf(root, 'acme', 'api').tasks).toEqual({ done: 1, verifying: 1, total: 4, archived: true })
    expect(sessionOf(root, 'acme', 'ui').tasks).toEqual({ done: 0, verifying: 0, total: 0, archived: true })
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
    expect(teamTree([TOOLS], 'acme', NOW)).toBe(null)
    expect(teamRows(null, NONE)).toEqual([])
  })
})

/** The week of the team `team` in the tree. */
function weekIn(root: TeamTreeNode, team: string): unknown {
  const find = (node: TeamTreeNode): TeamTreeNode | undefined => (node.key === `team:${team}` ? node : node.children.map(find).find(found => found !== undefined))
  const found = find(root)
  if (found?.kind !== 'team') throw new Error(`no team ${team}`)
  return found.team.week
}

describe("a team's week", () => {
  test("a team's own week file with its child teams', summed to hundredths; how far the week is, in whole percent", () => {
    const root = treeOf([{ ...ACME, week: weekFile(35.28, 51.91) }, { ...TOOLS, week: weekFile(3.84, 5.66) }], 'acme')
    // The week began 96 hours before NOW, of 168: 57%.
    expect(weekIn(root, 'acme')).toEqual({ usedPct: 39.12, plannedPct: 57.57, elapsedPct: 57 })
    expect(weekIn(root, 'tools')).toEqual({ usedPct: 3.84, plannedPct: 5.66, elapsedPct: 57 })
    const tenths = treeOf([{ ...ACME, week: weekFile(0.1, 0.1) }, { ...TOOLS, week: weekFile(0.2, 0.2) }], 'acme')
    expect(weekIn(tenths, 'acme')).toEqual({ usedPct: 0.3, plannedPct: 0.3, elapsedPct: 57 })
  })

  test("a child team's file on another reset is another week: its parent leaves it out, its own row shows it", () => {
    const later = WEEK_RESET + 48 * HOUR
    const root = treeOf([{ ...ACME, week: weekFile(35.28, 51.91) }, { ...TOOLS, week: weekFile(3.84, 5.66, later) }], 'acme')
    expect(weekIn(root, 'acme')).toEqual({ usedPct: 35.28, plannedPct: 51.91, elapsedPct: 57 })
    expect(weekIn(root, 'tools')).toEqual({ usedPct: 3.84, plannedPct: 5.66, elapsedPct: 29 })
  })

  test("a child team's file on another account is another week, on one reset too: its parent leaves it out, its own row shows it", () => {
    const root = treeOf([{ ...ACME, week: weekFile(35.28, 51.91) }, { ...TOOLS, week: weekFile(3.84, 5.66, WEEK_RESET, 'tools-account') }], 'acme')
    expect(weekIn(root, 'acme')).toEqual({ usedPct: 35.28, plannedPct: 51.91, elapsedPct: 57 })
    expect(weekIn(root, 'tools')).toEqual({ usedPct: 3.84, plannedPct: 5.66, elapsedPct: 57 })
  })

  test('a format 1 file names no account, so its reset alone decides: summed on the same reset, left out on another', () => {
    const named = weekFile(35.28, 51.91)
    const unnamed = { ...weekFile(3.84, 5.66), account: undefined }
    const sum = { usedPct: 39.12, plannedPct: 57.57, elapsedPct: 57 }
    expect(weekIn(treeOf([{ ...ACME, week: named }, { ...TOOLS, week: unnamed }], 'acme'), 'acme')).toEqual(sum)
    expect(weekIn(treeOf([{ ...ACME, week: { ...named, account: undefined } }, { ...TOOLS, week: weekFile(3.84, 5.66) }], 'acme'), 'acme')).toEqual(sum)
    const later = { ...unnamed, resetsAt: WEEK_RESET + 48 * HOUR }
    expect(weekIn(treeOf([{ ...ACME, week: named }, { ...TOOLS, week: later }], 'acme'), 'acme')).toEqual({ usedPct: 35.28, plannedPct: 51.91, elapsedPct: 57 })
  })

  test("a file from a week gone by is left out: the team's week is its child teams', or none", () => {
    const root = treeOf([{ ...ACME, week: weekFile(80, 90, NOW - HOUR) }, { ...TOOLS, week: weekFile(3.84, 5.66) }], 'acme')
    expect(weekIn(root, 'acme')).toEqual({ usedPct: 3.84, plannedPct: 5.66, elapsedPct: 57 })
    expect(weekIn(treeOf([{ ...ACME, week: weekFile(80, 90, NOW) }], 'acme'), 'acme')).toBe(null)
  })

  test('no week file in the team or under it: no week', () => {
    const root = treeOf([ACME, { ...TOOLS, week: weekFile(3.84, 5.66) }], 'acme')
    expect(weekIn(treeOf([ACME, TOOLS], 'acme'), 'acme')).toBe(null)
    expect(weekIn(treeOf([{ ...ACME, week: weekFile(1, 2) }, TOOLS], 'acme'), 'tools')).toBe(null)
    expect(weekIn(root, 'acme')).toEqual({ usedPct: 3.84, plannedPct: 5.66, elapsedPct: 57 })
  })

  test("how far the week is stays within 0 and 100: a file whose reset is over a week off reads 0; at its reset's eve, 100", () => {
    expect(weekIn(treeOf([{ ...ACME, week: weekFile(0, 10, NOW + 200 * HOUR) }], 'acme'), 'acme')).toEqual({ usedPct: 0, plannedPct: 10, elapsedPct: 0 })
    expect(weekIn(treeOf([{ ...ACME, week: weekFile(10, 10, NOW + 1) }], 'acme'), 'acme')).toEqual({ usedPct: 10, plannedPct: 10, elapsedPct: 100 })
  })
})

describe('teamRows', () => {
  test('a toggled team or leader closes, hiding what is under it; the keys hold across reads', () => {
    const toggled = new Set(['session:acme/web', 'team:tools'])
    expect(outline(teamRows(treeOf([ACME, TOOLS], 'acme'), toggled))).toEqual(['▾ team acme', '  ▾ lead', '    ▸ web', '    · ops', '  ▸ retired', '  ▸ team tools'])
    expect(outline(teamRows(treeOf([ACME], 'acme'), new Set(['team:acme'])))).toEqual(['▸ team acme'])
  })

  test('a toggle on a node with nothing under it changes nothing', () => {
    expect(teamRows(treeOf([ACME], 'acme'), new Set(['session:acme/api']))).toEqual(teamRows(treeOf([ACME], 'acme'), NONE))
  })
})

describe('foundRows', () => {
  test('a shown session under its team and leaders, each open over the rows drawn under it, whatever is toggled', () => {
    const root = treeOf([ACME, TOOLS], 'acme')
    expect(outline(foundRows(root, new Set([sessionKey('acme', 'api')])))).toEqual(['▾ team acme', '  ▾ lead', '    ▾ web', '      · api'])
    expect(outline(foundRows(root, new Set([sessionKey('acme', 'qa'), sessionKey('tools', 'dev')])))).toEqual([
      '▾ team acme',
      '  ▾ retired',
      '    · qa',
      '  ▾ team tools',
      '    ▾ boss',
      '      · dev',
    ])
  })

  test('a shown leader with none of its sessions shown has nothing under it; one with some, only those', () => {
    const root = treeOf([ACME, TOOLS], 'acme')
    const shown = new Set([sessionKey('acme', 'lead'), sessionKey('acme', 'web'), sessionKey('tools', 'boss')])
    expect(outline(foundRows(root, shown))).toEqual(['▾ team acme', '  ▾ lead', '    · web', '  ▾ team tools', '    · boss'])
  })

  test('nothing shown, or no tree: no rows', () => {
    expect(foundRows(treeOf([ACME], 'acme'), NONE)).toEqual([])
    expect(foundRows(null, new Set([sessionKey('acme', 'api')]))).toEqual([])
  })
})
