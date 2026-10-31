// The Team tab's search (hooks/team-search.ts): the sessions of the team tree a query names by the start of a word in
// their id, name, role words or hire scope, retired ones too, every match in the tree's order; a name a session no
// longer runs under names none.
import { describe, expect, test } from 'claude-code/testing'
import { SEPARATOR } from '../hooks/rows'
import { marksOf } from '../hooks/search'
import { sessionKey, type SessionFacts, type TeamTreeNode } from '../hooks/team'
import { searchTeam, teamFieldText, type SessionHit } from '../hooks/team-search'
import { ACME, TOOLS, rename, treeOf } from './team-fixtures'

const ROOT = treeOf([ACME, TOOLS], 'acme')

/** Each hit's node key. */
function keysOf(hits: readonly SessionHit[]): string[] {
  return hits.map(hit => hit.row.key)
}

/** The hit for `key`, failing the test when the search found no such session. */
function hitOf(hits: readonly SessionHit[], key: string): SessionHit {
  const hit = hits.find(found => found.row.key === key)
  if (hit === undefined) throw new Error(`no hit for ${key}`)
  return hit
}

/** The session at `key` in the tree, failing the test when there is none. */
function sessionAt(root: TeamTreeNode, key: string): SessionFacts {
  const find = (node: TeamTreeNode): SessionFacts | undefined =>
    node.kind === 'session' && node.key === key ? node.session : node.children.map(find).find(found => found !== undefined)
  const found = find(root)
  if (found === undefined) throw new Error(`no session ${key}`)
  return found
}

describe('teamFieldText', () => {
  test("a session's fields as its row draws them: no name when it is the id, role words joined by the row's separator", () => {
    const lead = sessionAt(ROOT, sessionKey('acme', 'lead'))
    expect(teamFieldText(lead, 'id')).toBe('lead')
    expect(teamFieldText(lead, 'name')).toBe('acme-lead')
    expect(teamFieldText(lead, 'role')).toBe(`lead${SEPARATOR.text}leads 2`)
    expect(teamFieldText(lead, 'scope')).toBeNull()
    const named = sessionAt(treeOf([{ ...ACME, renames: [rename('lead', 'acme-lead', 'lead')] }], 'acme'), sessionKey('acme', 'lead'))
    expect(teamFieldText(named, 'name')).toBeNull()
    expect(teamFieldText(sessionAt(ROOT, sessionKey('acme', 'api')), 'role')).toBeNull()
    expect(teamFieldText(sessionAt(ROOT, sessionKey('acme', 'qa')), 'name')).toBe('acme-tester')
    expect(teamFieldText(sessionAt(ROOT, sessionKey('acme', 'ops')), 'scope')).toBe('ops again')
  })
})

describe('searchTeam', () => {
  test('a session by its name, marked where the word matched; a name it ran under before names none', () => {
    const byName = searchTeam(ROOT, 'backend')
    expect(keysOf(byName)).toEqual([sessionKey('acme', 'api')])
    expect(marksOf(hitOf(byName, sessionKey('acme', 'api')), 'name')).toEqual([{ start: 5, end: 12 }])
    const renamed = treeOf([{ ...ACME, renames: [...ACME.renames, rename('ui', 'acme-legacy', 'acme-ui')] }], 'acme')
    expect(keysOf(searchTeam(renamed, 'acme-ui'))).toEqual([sessionKey('acme', 'ui')])
    expect(searchTeam(renamed, 'legacy')).toEqual([])
  })

  test('a session by its role words or its hire scope, each word of the query in some field', () => {
    expect(keysOf(searchTeam(ROOT, 'reviewer'))).toEqual([sessionKey('acme', 'ops')])
    const ops = hitOf(searchTeam(ROOT, 'ops again'), sessionKey('acme', 'ops'))
    expect(marksOf(ops, 'id')).toEqual([{ start: 0, end: 3 }])
    expect(marksOf(ops, 'scope')).toEqual([{ start: 0, end: 3 }, { start: 4, end: 9 }])
    expect(searchTeam(ROOT, 'ops nobody')).toEqual([])
  })

  test('every session it names, in the tree order, retired ones and the child team too', () => {
    expect(keysOf(searchTeam(ROOT, 'lead'))).toEqual([sessionKey('acme', 'lead'), sessionKey('acme', 'web'), sessionKey('tools', 'boss')])
    expect(keysOf(searchTeam(ROOT, 'qa'))).toEqual([sessionKey('acme', 'qa')])
    expect(keysOf(searchTeam(ROOT, 'tester'))).toEqual([sessionKey('acme', 'qa')])
  })

  test('a word matches the start of a word only, never inside one', () => {
    expect(searchTeam(ROOT, 'end')).toEqual([])
  })

  test('a blank query, or no tree: no sessions', () => {
    expect(searchTeam(ROOT, '  ')).toEqual([])
    expect(searchTeam(null, 'api')).toEqual([])
  })
})
