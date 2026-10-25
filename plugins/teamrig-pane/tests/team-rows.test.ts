// The Team tab as rows (hooks/team-rows.ts): a node a row, indented by its depth behind its open mark, a team's counts,
// a session's name, roles, leads, hire or retire and former names, a closed group's count, a press on each row that
// opens what lies under it or a session's card, a leader's two, and the notes for a tree it cannot show.
import { describe, expect, test } from 'claude-code/testing'
import type { TeamView } from '../types'
import { TimeZone } from '../hooks/core/read/index'
import type { Block } from '../hooks/rows'
import { cardKey, teamBlocks, toggledWith } from '../hooks/team-rows'
import { HOUR, JERUSALEM, NOW } from './fixtures'
import { ACME, TOOLS, configOf, hire, treeOf } from './team-fixtures'

const UTC = TimeZone.UTC
/** Each block as its key and its rows' words. */
const words = (blocks: Block[]): [string, string[]][] => blocks.map(block => [block.key, block.rows.map(row => row.spans.map(span => span.text).join(''))])
const TREE: TeamView = { kind: 'tree', root: treeOf([ACME, TOOLS], 'acme') }

function blockOf(blocks: Block[], key: string): Block {
  const block = blocks.find(found => found.key === key)
  if (block === undefined) throw new Error(`no block ${key}`)
  return block
}

describe('teamBlocks', () => {
  test('a row a node, depth first: each indented by its depth behind ▾ open, ▸ closed or blank, its words after', () => {
    expect(words(teamBlocks(TREE, [], UTC))).toEqual([
      ['team:acme', ['▾ acme · 5 active · 1 closed']],
      ['session:acme/lead', ['  ▾ ● lead  acme-lead · lead · leads 2']],
      ['session:acme/web', ['    ▾ ● web  acme-web · leads 2']],
      ['session:acme/api', ['        ● api  acme-backend · formerly acme-api']],
      ['session:acme/ui', ['        ● ui  acme-ui · hired Fri 10-09 · review 10-25']],
      ['session:acme/ops', ['      ● ops  acme-ops · security reviewer · rehired Sun 10-11 · review 10-25']],
      ['closed:acme', ['  ▸ closed (1)']],
      ['team:tools', ['  ▾ tools · 2 active · 0 closed']],
      ['session:tools/boss', ['    ▾ ● boss  tools-boss · lead · leads 1']],
      ['session:tools/dev', ['        ● dev  tools-dev']],
    ])
  })

  test("a team's or a leader's press opens or closes what lies under it, any other session's its card; its wrapped lines start under its words", () => {
    const blocks = teamBlocks(TREE, [], UTC)
    expect(blocks.map(block => block.folds)).toEqual([
      'team:acme',
      'session:acme/lead',
      'session:acme/web',
      cardKey('session:acme/api'),
      cardKey('session:acme/ui'),
      cardKey('session:acme/ops'),
      'closed:acme',
      'team:tools',
      'session:tools/boss',
      cardKey('session:tools/dev'),
    ])
    expect(blockOf(blocks, 'team:acme').rows[0]?.hang?.text).toBe('  ')
    expect(blockOf(blocks, 'session:acme/api').rows[0]?.hang?.text).toBe('        ')
    const holdsPresses = (block: Block) => block.rows.some(row => row.spans.some(span => span.toggles !== undefined))
    expect(blocks.filter(holdsPresses).map(block => block.key)).toEqual(['session:acme/lead', 'session:acme/web', 'session:tools/boss'])
  })

  test("a leader's row holds two presses, docked: its mark opens or closes the sessions it leads, its id its card", () => {
    const web = blockOf(teamBlocks(TREE, [], UTC), 'session:acme/web').rows[0]?.spans ?? []
    expect(web.filter(span => span.toggles !== undefined)).toEqual([
      { text: '▾ ', dim: true, toggles: 'session:acme/web' },
      { text: 'web', bold: true, toggles: cardKey('session:acme/web') },
    ])
  })

  test("a session's card follows its row while its key is toggled, each line behind a guide under the session's mark", () => {
    const shut = teamBlocks(TREE, [], UTC)
    expect(shut.some(block => block.card !== undefined)).toBe(false)
    const open = teamBlocks(TREE, [cardKey('session:acme/api'), cardKey('session:acme/web')], UTC)
    const api = blockOf(open, 'session:acme/api').card ?? []
    expect(api.map(row => row.spans[0])).toEqual(api.map(() => ({ text: '        │ ', dim: true })))
    expect(api.map(row => row.key)[0]).toBe('team-card:acme/api:role')
    expect(blockOf(open, 'session:acme/web').card?.[0]?.spans[0]).toEqual({ text: '      │ ', dim: true })
    // A card open under its leader's closed row is not drawn: the row is not there.
    expect(teamBlocks(TREE, [cardKey('session:acme/api'), 'session:acme/web'], UTC).some(block => block.key === 'session:acme/api')).toBe(false)
    // A closed session's card is its retire.
    const qa = blockOf(teamBlocks(TREE, ['closed:acme', cardKey('session:acme/qa')], UTC), 'session:acme/qa')
    expect(qa.folds).toBe(cardKey('session:acme/qa'))
    expect(qa.card?.map(row => row.key)[0]).toBe('team-card:acme/qa:retired')
  })

  test('the closed group opens on a toggle: a retired session dim behind ○, its retire day and its former names', () => {
    const blocks = teamBlocks(TREE, ['closed:acme'], UTC)
    expect(words(blocks).slice(6, 8)).toEqual([
      ['closed:acme', ['  ▾ closed (1)']],
      ['session:acme/qa', ['      ○ qa  acme-tester · retired Sun 10-11 · formerly acme-qa']],
    ])
    const [mark, id, name] = blockOf(blocks, 'session:acme/qa').rows[0]?.spans.slice(2) ?? []
    expect([mark, id, name]).toEqual([
      { text: '○ ', dim: true },
      { text: 'qa', dim: true },
      { text: '  acme-tester', dim: true },
    ])
    expect(blockOf(blocks, 'session:acme/lead').rows[0]?.spans.slice(2, 4)).toEqual([{ text: '● ' }, { text: 'lead', bold: true, toggles: cardKey('session:acme/lead') }])
  })

  test("days print on the team's clock", () => {
    const late = { ...ACME, hires: [hire('ui', Date.UTC(2026, 9, 11, 22, 30))] }
    const tree: TeamView = { kind: 'tree', root: treeOf([late], 'acme') }
    const ui = (zone: TimeZone) => words(teamBlocks(tree, [], zone)).find(([key]) => key === 'session:acme/ui')?.[1]
    expect(ui(UTC)).toEqual(['        ● ui  acme-ui · hired Sun 10-11 · review 10-25'])
    expect(ui(JERUSALEM)).toEqual(['        ● ui  acme-ui · hired Mon 10-12 · review 10-25'])
  })

  test('a session whose name is its id shows the id alone', () => {
    const named = { ...ACME, config: configOf({ team: { id: 'acme' }, sessions: ['lead'], roles: { lead: 'lead' } }), renames: [], hires: [] }
    const renamed = { ...named, renames: [{ v: 1, id: 'lead', from: 'acme-lead', to: 'lead', at: new Date(NOW - HOUR).toISOString(), by: 'lead' }] }
    expect(words(teamBlocks({ kind: 'tree', root: treeOf([renamed], 'acme') }, [], UTC))).toEqual([
      ['team:acme', ['▾ acme · 1 active · 0 closed']],
      ['session:acme/lead', ['    ● lead · lead · formerly acme-lead']],
    ])
  })

  test('the notes for a tree not read yet, no team, a read that failed and a team with no config', () => {
    expect(words(teamBlocks({ kind: 'reading' }, [], UTC))).toEqual([['team:note', ['Reading the team…']]])
    expect(words(teamBlocks({ kind: 'no-team' }, [], UTC))).toEqual([
      ['team:note', ["No team found: the Team tab shows the tree of teams the session's team is in."]],
    ])
    const failed = teamBlocks({ kind: 'failed', reason: 'EACCES: permission denied.' }, [], UTC)
    expect(failed[0]?.rows[0]?.spans).toEqual([{ text: 'The team could not be read: EACCES: permission denied.', color: 'warning' }])
    expect(words(teamBlocks({ kind: 'tree', root: null }, [], UTC))).toEqual([
      ['team:note', ['No team tree: the team has no config file teamrig can read, and the tree is read from it.']],
    ])
  })
})

describe('toggledWith', () => {
  test('a press adds a key not toggled and takes back one that is', () => {
    expect(toggledWith([], 'team:acme')).toEqual(['team:acme'])
    expect(toggledWith(['closed:acme', 'team:acme'], 'team:acme')).toEqual(['closed:acme'])
  })
})
