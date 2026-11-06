// The Teams tab as rows (hooks/team-rows.ts): a node a row, indented by its depth behind its open mark, a team's counts
// and its week bar, a session's name, how many it leads, roles in their colours (never a name it no longer runs under,
// nor a hire or retire day: its card has them), a retired group's count, a press on each row that opens what lies under
// it or a session's card, a leader's two, the [Stats] press that ends a team's and a session's row, the notes for a tree
// it cannot show, and a WARN line for each team folder it could not read.
import { describe, expect, test } from 'claude-code/testing'
import type { MeetAnswer, TeamFolderFailure, TeamView } from '../types'
import { TimeZone } from '../hooks/core/read/index'
import { dockLayout, inlineLayout } from '../hooks/layout'
import { SEPARATOR, type Block, type Span } from '../hooks/rows'
import { sessionKey, type TeamTreeNode } from '../hooks/team'
import { MEET_TEXT, OWN_MARK, STATS_TEXT, TEAM_NOTHING_FOUND, TEAM_SEARCH_HINT, WEEK_CELLS, cardKey, openedWith, teamBlocks, toggledWith } from '../hooks/team-rows'
import { searchTeam } from '../hooks/team-search'
import { cells } from '../hooks/width'
import { HOUR, JERUSALEM, NOW } from './fixtures'
import { ACME, TOOLS, configOf, hire, rename, treeOf, weekFile } from './team-fixtures'

const UTC = TimeZone.UTC
/** Each block as its key and its rows' words. */
const words = (blocks: Block[]): [string, string[]][] => blocks.map(block => [block.key, block.rows.map(row => row.spans.map(span => span.text).join(''))])
const ROOT = treeOf([ACME, TOOLS], 'acme')
const TREE: TeamView = { kind: 'tree', root: ROOT, failures: [] }

function blockOf(blocks: Block[], key: string): Block {
  const block = blocks.find(found => found.key === key)
  if (block === undefined) throw new Error(`no block ${key}`)
  return block
}

describe('teamBlocks', () => {
  test('a row a node, depth first: each indented by its depth behind ▾ open, ▸ closed or blank, its words after', () => {
    expect(words(teamBlocks(TREE, [], UTC))).toEqual([
      ['team:acme', ['▾ acme · 5 active · 1 retired [Stats]']],
      ['session:acme/lead', ['  ▾ ● acme-lead (2) · lead [Stats]']],
      ['session:acme/web', ['    ▾ ● acme-web (2) · sub-lead · later Mon 11-02 [Stats]']],
      ['session:acme/api', ['        ● acme-backend · ? 1 decision [Meet] [Stats]']],
      ['session:acme/ui', ['        ● acme-ui [Stats]']],
      ['session:acme/ops', ['      ● acme-ops · security reviewer [Stats]']],
      ['retired:acme', ['  ▸ retired (1)']],
      ['team:tools', ['  ▾ tools · 2 active · 0 retired [Stats]']],
      ['session:tools/boss', ['    ▾ ● tools-boss (1) · lead [Stats]']],
      ['session:tools/dev', ['        ● tools-dev [Stats]']],
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
      'retired:acme',
      'team:tools',
      'session:tools/boss',
      cardKey('session:tools/dev'),
    ])
    expect(blockOf(blocks, 'team:acme').rows[0]?.hang?.text).toBe('  ')
    expect(blockOf(blocks, 'session:acme/api').rows[0]?.hang?.text).toBe('        ')
    const holdsPresses = (block: Block) => block.rows.some(row => row.spans.some(span => span.toggles !== undefined))
    // Docked its [Stats] leaves a row no press of its own, so its words hold them (see below); a retired group has no [Stats].
    expect(blocks.filter(block => !holdsPresses(block)).map(block => block.key)).toEqual(['retired:acme'])
  })

  test("a leader's row counts the sessions it leads in brackets after its name, dim; one that leads none shows none", () => {
    const blocks = teamBlocks(TREE, [], UTC)
    expect(blockOf(blocks, 'session:acme/web').rows[0]?.spans.slice(3, 5)).toEqual([{ text: 'acme-web', bold: true, toggles: cardKey('session:acme/web') }, { text: ' (2)', dim: true }])
    expect(blockOf(blocks, 'session:acme/ui').rows[0]?.spans.some(span => span.text.startsWith(' ('))).toBe(false)
  })

  test("a session's row counts its cards waiting on the owner, with a [Meet] press, and names when the next put off comes back", () => {
    const blocks = teamBlocks(TREE, [], UTC)
    const api = blockOf(blocks, 'session:acme/api').rows[0]?.spans ?? []
    expect(api.slice(-6, -2)).toEqual([SEPARATOR, { text: '? 1 decision', color: 'suggestion' }, { text: ' ' }, { text: MEET_TEXT, color: 'suggestion', meets: 'api' }])
    expect(blockOf(blocks, 'session:acme/web').rows[0]?.spans.slice(-4, -2)).toEqual([SEPARATOR, { text: 'later Mon 11-02', dim: true }])
    const two = { ...ACME, ownerCards: { api: { due: [{ id: 'T4', title: 'Pick the database' }, { id: 'T7', title: 'Pick the queue' }], later: [] } } }
    const twice = teamBlocks({ kind: 'tree', root: treeOf([two], 'acme'), failures: [] }, [], UTC)
    expect(words(twice).find(([key]) => key === 'session:acme/api')?.[1]).toEqual(['        ● acme-backend · ? 2 decisions [Meet] [Stats]'])
    // A team whose register the pane does not read shows no cards, and no [Meet].
    expect(blocks.some(block => block.key.startsWith('session:tools/') && block.rows.some(row => row.spans.some(span => span.meets !== undefined)))).toBe(false)
  })

  test('docked, a row with a [Meet] draws its name as the press that opens its card and the [Meet] and [Stats] as presses of their own', () => {
    const [drawn] = dockLayout([blockOf(teamBlocks(TREE, [], UTC), 'session:acme/api')], 80)
    const pieces = drawn?.parts?.flatMap(part => (part.kind === 'line' ? part.pieces : [])) ?? []
    const stats = { kind: 'open', scope: { kind: 'session', team: 'acme', session: 'api' }, row: 'session:acme/api' } as const
    expect(pieces.filter(piece => piece.kind !== 'words')).toEqual([
      { kind: 'toggle', span: { text: 'acme-backend', bold: true, toggles: cardKey('session:acme/api') }, toggles: cardKey('session:acme/api') },
      { kind: 'meet', span: { text: MEET_TEXT, color: 'suggestion', meets: 'api' }, meets: 'api' },
      { kind: 'stats', span: { text: STATS_TEXT, dim: true, stats }, stats },
    ])
  })

  test("a team's and a session's row end in a [Stats] press on it, a retired session's too; a retired group's holds none", () => {
    const blocks = teamBlocks(TREE, ['retired:acme'], UTC)
    const pressOf = (key: string) => blockOf(blocks, key).rows[0]?.spans.at(-1)
    expect(pressOf('team:tools')).toEqual({ text: STATS_TEXT, dim: true, stats: { kind: 'open', scope: { kind: 'team', team: 'tools' }, row: 'team:tools' } })
    expect(pressOf('session:tools/dev')?.stats).toEqual({ kind: 'open', scope: { kind: 'session', team: 'tools', session: 'dev' }, row: 'session:tools/dev' })
    expect(pressOf('session:acme/qa')?.stats).toEqual({ kind: 'open', scope: { kind: 'session', team: 'acme', session: 'qa' }, row: 'session:acme/qa' })
    expect(blockOf(blocks, 'retired:acme').rows[0]?.spans.some(span => span.stats !== undefined)).toBe(false)
  })

  test("docked, a team's mark and name hold the press that opens or closes it, its [Stats] one of its own; a retired group's row stays one press", () => {
    const blocks = teamBlocks(TREE, [], UTC)
    const [team] = dockLayout([blockOf(blocks, 'team:acme')], 80)
    const pieces = team?.parts?.flatMap(part => (part.kind === 'line' ? part.pieces : [])) ?? []
    expect(pieces.filter(piece => piece.kind !== 'words').map(piece => (piece.kind === 'toggle' ? piece.toggles : piece.kind))).toEqual(['team:acme', 'team:acme', 'stats'])
    const [group] = dockLayout([blockOf(blocks, 'retired:acme')], 80)
    expect(group?.parts).toBeUndefined()
    expect(group?.folds).toBe('retired:acme')
  })

  test('inline a row is one press, its fold or its card, and its [Stats] is words', () => {
    const blocks = teamBlocks(TREE, [], UTC)
    const [team] = inlineLayout([blockOf(blocks, 'team:acme')], 10)
    expect(team?.parts).toBeUndefined()
    expect(team?.folds).toBe('team:acme')
    const [session] = inlineLayout([blockOf(blocks, 'session:acme/ui')], 10)
    expect(session?.parts).toBeUndefined()
    expect(session?.folds).toBe(cardKey('session:acme/ui'))
  })

  test('a team with nothing under it holds no fold, and still its [Stats]', () => {
    const alone: TeamTreeNode = { key: 'team:solo', kind: 'team', team: { team: 'solo', parent: null, active: 0, retired: 0, week: null }, children: [] }
    const [block] = teamBlocks({ kind: 'tree', root: alone, failures: [] }, [], UTC)
    expect(block?.folds).toBeUndefined()
    expect(block?.rows[0]?.spans.some(span => span.toggles !== undefined)).toBe(false)
    expect(block?.rows[0]?.spans.at(-1)?.stats).toEqual({ kind: 'open', scope: { kind: 'team', team: 'solo' }, row: 'team:solo' })
  })

  test('what the last [Meet] press answered leads the tab: asking, asked with what teamrig printed, or why it was refused', () => {
    const led = (answer: MeetAnswer) => teamBlocks(TREE, [], UTC, { meet: answer })[0]
    const asking = led({ session: 'api', outcome: 'asking', lines: [] })
    expect(asking === undefined ? [] : words([asking])).toEqual([['team:meet', ['Asking api for its cards…']]])
    const asked = led({ session: 'api', outcome: 'asked', lines: ['WOKE acme-backend (session api)'] })
    expect(asked === undefined ? [] : words([asked])).toEqual([['team:meet', ['Asked api for its cards:', '  WOKE acme-backend (session api)']]])
    expect(asked?.rows.map(row => row.key)).toEqual(['team:meet', 'team:meet:0'])
    expect(asked?.rows[0]?.spans).toEqual([{ text: 'Asked api for its cards:', color: 'success' }])
    const refused = led({ session: 'api', outcome: 'refused', lines: ['api has no card waiting on owner now'] })
    expect(refused?.rows.map(row => row.spans)).toEqual([
      [{ text: 'api was not asked:', color: 'warning' }],
      [{ text: '  api has no card waiting on owner now', color: 'warning' }],
    ])
    // It leads a search too, and the tree follows it.
    const searched = teamBlocks(TREE, [], UTC, { search: { query: 'api', hits: searchTeam(ROOT, 'api') }, meet: { session: 'api', outcome: 'asking', lines: [] } })
    expect(searched.map(block => block.key).slice(0, 2)).toEqual(['team:meet', 'team-search-count'])
    expect(teamBlocks(TREE, [], UTC, { search: null, meet: null })[0]?.key).toBe('team:acme')
  })

  test("a leader's row holds two presses, docked: its mark opens or closes the sessions it leads, its name its card", () => {
    const web = blockOf(teamBlocks(TREE, [], UTC), 'session:acme/web').rows[0]?.spans ?? []
    expect(web.filter(span => span.toggles !== undefined)).toEqual([
      { text: '▾ ', dim: true, toggles: 'session:acme/web' },
      { text: 'acme-web', bold: true, toggles: cardKey('session:acme/web') },
    ])
  })

  test("a session's card follows its row while its key is toggled, each line behind a guide under the session's mark", () => {
    const shut = teamBlocks(TREE, [], UTC)
    expect(shut.some(block => block.card !== undefined)).toBe(false)
    const open = teamBlocks(TREE, [cardKey('session:acme/api'), cardKey('session:acme/web')], UTC)
    const api = blockOf(open, 'session:acme/api').card ?? []
    expect(api.map(row => row.spans[0])).toEqual(api.map(() => ({ text: '        │ ', dim: true })))
    expect(api.map(row => row.key)[0]).toBe('team-card:acme/api:id')
    expect(blockOf(open, 'session:acme/web').card?.[0]?.spans[0]).toEqual({ text: '      │ ', dim: true })
    // A card open under its leader's closed row is not drawn: the row is not there.
    expect(teamBlocks(TREE, [cardKey('session:acme/api'), 'session:acme/web'], UTC).some(block => block.key === 'session:acme/api')).toBe(false)
    // A retired session's card is its retire.
    const qa = blockOf(teamBlocks(TREE, ['retired:acme', cardKey('session:acme/qa')], UTC), 'session:acme/qa')
    expect(qa.folds).toBe(cardKey('session:acme/qa'))
    expect(qa.card?.map(row => row.key).slice(0, 2)).toEqual(['team-card:acme/qa:id', 'team-card:acme/qa:retired'])
  })

  test('the retired group opens on a toggle: a retired session dim behind ○ under its last name, its retire day on its card', () => {
    const blocks = teamBlocks(TREE, ['retired:acme'], UTC)
    expect(words(blocks).slice(6, 8)).toEqual([
      ['retired:acme', ['  ▾ retired (1)']],
      ['session:acme/qa', ['      ○ acme-tester [Stats]']],
    ])
    const [mark, name] = blockOf(blocks, 'session:acme/qa').rows[0]?.spans.slice(2) ?? []
    expect([mark, name]).toEqual([
      { text: '○ ', dim: true },
      { text: 'acme-tester', dim: true, toggles: cardKey('session:acme/qa') },
    ])
    expect(blockOf(blocks, 'session:acme/lead').rows[0]?.spans.slice(2, 4)).toEqual([{ text: '● ' }, { text: 'acme-lead', bold: true, toggles: cardKey('session:acme/lead') }])
  })

  test("a row's roles each in its role's colour, a leader not the lead a sub-lead; an area owner's row shows no role", () => {
    const blocks = teamBlocks(TREE, [], UTC)
    const spansOf = (key: string) => blockOf(blocks, key).rows[0]?.spans ?? []
    expect(spansOf('session:acme/lead').slice(-4, -2)).toEqual([SEPARATOR, { text: 'lead', color: 'claude' }])
    expect(spansOf('session:acme/web').slice(-6, -4)).toEqual([SEPARATOR, { text: 'sub-lead', color: 'warning' }])
    expect(spansOf('session:acme/ops').slice(-4, -2)).toEqual([SEPARATOR, { text: 'security reviewer', color: 'error' }])
    expect(spansOf('session:acme/ui').some(span => span.color !== undefined)).toBe(false)
  })

  test("a card under its row prints its days on the team's clock; the row prints none", () => {
    const late = { ...ACME, hires: [hire('ui', Date.UTC(2026, 9, 11, 22, 30))] }
    const tree: TeamView = { kind: 'tree', root: treeOf([late], 'acme'), failures: [] }
    const ui = (zone: TimeZone) => blockOf(teamBlocks(tree, [cardKey('session:acme/ui')], zone), 'session:acme/ui')
    expect(words([ui(UTC)])[0]?.[1]).toEqual(['        ● acme-ui [Stats]'])
    const hired = (zone: TimeZone) => ui(zone).card?.find(row => row.key === 'team-card:acme/ui:hire')?.spans.map(span => span.text).join('')
    expect(hired(UTC)).toContain('Sun 10-11 by lead')
    expect(hired(JERUSALEM)).toContain('Mon 10-12 by lead')
  })

  test('a session whose name is its id shows the id alone, and none of the names it ran under before', () => {
    const named = { ...ACME, config: configOf({ team: { id: 'acme' }, sessions: ['lead'], roles: { lead: 'lead' } }), renames: [], hires: [] }
    const renamed = { ...named, renames: [{ v: 1, id: 'lead', from: 'acme-lead', to: 'lead', at: new Date(NOW - HOUR).toISOString(), by: 'lead' }] }
    expect(words(teamBlocks({ kind: 'tree', root: treeOf([renamed], 'acme'), failures: [] }, [], UTC))).toEqual([
      ['team:acme', ['▾ acme · 1 active · 0 retired [Stats]']],
      ['session:acme/lead', ['    ● lead · lead [Stats]']],
    ])
  })

  test("the row of the session whose pane it is starts with a green ▶ in its indent's first cell; no other row has it", () => {
    const blocks = teamBlocks(TREE, [], UTC, { own: sessionKey('acme', 'web') })
    const marked = (shown: Block[]) => shown.filter(block => block.rows.some(row => row.spans.includes(OWN_MARK))).map(block => block.key)
    expect(marked(blocks)).toEqual(['session:acme/web'])
    expect(blockOf(blocks, 'session:acme/web').rows[0]?.spans.slice(0, 2)).toEqual([OWN_MARK, { text: '   ' }])
    expect(words(blocks).find(([key]) => key === 'session:acme/web')?.[1]).toEqual(['\u{25b6}\u{fe0e}   ▾ ● acme-web (2) · sub-lead · later Mon 11-02 [Stats]'])
    // The words stay where an unmarked row has them, and its wrapped lines and card under them.
    expect(blockOf(blocks, 'session:acme/web').rows[0]?.hang?.text).toBe('      ')
    // At the top level of sessions, the lead's, the mark still leaves a blank before the open mark.
    expect(words(teamBlocks(TREE, [], UTC, { own: sessionKey('acme', 'lead') }))[1]).toEqual(['session:acme/lead', ['\u{25b6}\u{fe0e} ▾ ● acme-lead (2) · lead [Stats]']])
    // A session of another team, a retired one, or none: the mark follows its key, and no key marks nothing.
    expect(marked(teamBlocks(TREE, [], UTC, { own: sessionKey('tools', 'dev') }))).toEqual(['session:tools/dev'])
    expect(marked(teamBlocks(TREE, [], UTC, { own: sessionKey('acme', 'nobody') }))).toEqual([])
    expect(marked(teamBlocks(TREE, [], UTC))).toEqual([])
  })

  test('the own mark is the equal-sided ▶ in its text form, one cell and never an emoji, and draws first both docked and inline', () => {
    // ▶ (U+25B6), not the flat pointer ► (U+25BA); VS15 asks a terminal that could draw it as an emoji for its text.
    expect(OWN_MARK.text).toBe('\u{25b6}\u{fe0e}')
    expect(cells(OWN_MARK.text)).toBe(1)
    expect(/\p{Emoji_Presentation}|\u{fe0f}/u.test(OWN_MARK.text)).toBe(false)
    const chars = [...OWN_MARK.text]
    expect(chars.every((char, i) => !/\p{Extended_Pictographic}/u.test(char) || chars[i + 1] === '\u{fe0e}')).toBe(true)
    // Docked a session's row draws as its pieces, inline as one text.
    for (const area of ['ui', 'web']) {
      const row = blockOf(teamBlocks(TREE, [], UTC, { own: sessionKey('acme', area) }), sessionKey('acme', area))
      const first = dockLayout([row], 80)[0]?.parts?.flatMap(part => (part.kind === 'line' ? part.pieces : []))[0]
      expect(first?.kind === 'words' ? first.spans[0] : first).toEqual(OWN_MARK)
      expect(inlineLayout([row], 10)[0]?.spans[0]).toEqual(OWN_MARK)
    }
  })

  test('the notes for a tree not read yet, no team, a read that failed and a team with no config', () => {
    expect(words(teamBlocks({ kind: 'reading' }, [], UTC))).toEqual([['team:note', ['Reading the team…']]])
    expect(words(teamBlocks({ kind: 'no-team' }, [], UTC))).toEqual([
      ['team:note', ["No team found: the Teams tab shows the tree of teams the session's team is in."]],
    ])
    const failed = teamBlocks({ kind: 'failed', reason: 'EACCES: permission denied.' }, [], UTC)
    expect(failed[0]?.rows[0]?.spans).toEqual([{ text: 'The team could not be read: EACCES: permission denied.', color: 'warning' }])
    expect(words(teamBlocks({ kind: 'tree', root: null, failures: [] }, [], UTC))).toEqual([
      ['team:note', ['No team tree: the team has no config file teamrig can read, and the tree is read from it.']],
    ])
  })

  test('a WARN line for each team folder the last read could not read, after the [Meet] answer and before the tree, its search or the no-tree note', () => {
    const tools: TeamFolderFailure = { team: 'tools', reason: 'EBUSY: resource busy or locked.', isLastRead: true }
    const docs: TeamFolderFailure = { team: 'docs', reason: 'EACCES: permission denied', isLastRead: false }
    const warned: TeamView = { kind: 'tree', root: ROOT, failures: [tools, docs] }
    const blocks = teamBlocks(warned, [], UTC, { meet: { session: 'api', outcome: 'asking', lines: [] } })
    expect(words(blocks).slice(0, 4)).toEqual([
      ['team:meet', ['Asking api for its cards…']],
      ['team:failure:tools', ['WARN team tools could not be read: EBUSY: resource busy or locked; it shows as last read.']],
      ['team:failure:docs', ['WARN team docs could not be read: EACCES: permission denied; it is left out.']],
      ['team:acme', ['▾ acme · 5 active · 1 retired [Stats]']],
    ])
    const line = blockOf(blocks, 'team:failure:docs').rows[0]
    expect(line?.spans.map(span => span.color)).toEqual(['warning'])
    expect(line?.hang?.text).toBe('  ')
    // A search draws under them too.
    const searched = teamBlocks(warned, [], UTC, { search: { query: 'api', hits: searchTeam(ROOT, 'api') } })
    expect(searched.map(block => block.key).slice(0, 3)).toEqual(['team:failure:tools', 'team:failure:docs', 'team-search-count'])
    // With no tree, the no-tree note follows them.
    expect(teamBlocks({ kind: 'tree', root: null, failures: [docs] }, [], UTC).map(block => block.key)).toEqual(['team:failure:docs', 'team:note'])
  })
})

describe("a team's week on its row", () => {
  /** The rows with acme's week file at `used` and `planned` percent of the account's week, 57% of the week gone (pace 6 cells). */
  const weekBlocks = (used: number, planned: number) => teamBlocks({ kind: 'tree', root: treeOf([{ ...ACME, week: weekFile(used, planned) }, TOOLS], 'acme'), failures: [] }, [], UTC)
  const acmeRow = (used: number, planned: number): readonly Span[] => blockOf(weekBlocks(used, planned), 'team:acme').rows[0]?.spans.slice(0, -2) ?? []
  const textOf = (spans: readonly Span[]) => spans.map(span => span.text).join('')
  const pcts = (used: string, planned: string): Span => ({ text: ` ${used} of ${planned}`, dim: true })
  const WEEK_WORD: Span = { text: 'week ', dim: true }

  test('ahead of its plan: its planned part filled as far as it used it, green to how far the week is, amber past it, then the used and planned percents', () => {
    const spans = acmeRow(35.28, 51.91)
    expect(textOf(spans)).toBe('▾ acme · 5 active · 1 retired · week ███████░░░ 35% of 52%')
    expect(spans.slice(-6)).toEqual([SEPARATOR, WEEK_WORD, { text: '██████', color: 'success' }, { text: '█', color: 'warning' }, { text: '░░░', dim: true }, pcts('35%', '52%')])
    expect(cells(textOf(spans.slice(-4, -1)))).toBe(WEEK_CELLS)
  })

  test('on its pace all green; past its whole plan every cell, amber past the pace', () => {
    expect(acmeRow(30, 50).slice(-4)).toEqual([WEEK_WORD, { text: '██████', color: 'success' }, { text: '░░░░', dim: true }, pcts('30%', '50%')])
    expect(acmeRow(60, 50).slice(-4)).toEqual([WEEK_WORD, { text: '██████', color: 'success' }, { text: '████', color: 'warning' }, pcts('60%', '50%')])
  })

  test('behind its plan: a dim │ in the cell the pace reaches; none used yet draws no green', () => {
    expect(acmeRow(20, 50).slice(-4)).toEqual([WEEK_WORD, { text: '████', color: 'success' }, { text: '░│░░░░', dim: true }, pcts('20%', '50%')])
    expect(acmeRow(0, 50).slice(-3)).toEqual([WEEK_WORD, { text: '░░░░░│░░░░', dim: true }, pcts('0%', '50%')])
  })

  test('a team planned no part of the week has no pace: empty until it uses some, then all amber', () => {
    expect(acmeRow(0, 0).slice(-3)).toEqual([WEEK_WORD, { text: '░░░░░░░░░░', dim: true }, pcts('0%', '0%')])
    expect(acmeRow(0.26, 0).slice(-3)).toEqual([WEEK_WORD, { text: '██████████', color: 'warning' }, pcts('0.3%', '0%')])
  })

  test('a percent to a tenth below 10, whole from 10; a team with no week file this week draws no week', () => {
    expect(textOf(acmeRow(5.66, 9.96))).toMatch(/ 5\.7% of 10%$/)
    expect(textOf(acmeRow(0.26, 3.84))).toMatch(/ 0\.3% of 3\.8%$/)
    expect(words([blockOf(weekBlocks(35.28, 51.91), 'team:tools')])).toEqual([['team:tools', ['  ▾ tools · 2 active · 0 retired [Stats]']]])
  })
})

describe('teamBlocks with a search', () => {
  const searched = (query: string, toggled: readonly string[] = []) => teamBlocks(TREE, toggled, UTC, { search: { query, hits: searchTeam(ROOT, query) } })

  test('the count, then each session it names under its team and leaders, whatever is toggled, its matched words underlined', () => {
    const blocks = searched('api', ['team:acme', 'session:acme/web'])
    expect(words(blocks)).toEqual([
      ['team-search-count', ['1 session matches']],
      ['team:acme', ['▾ acme · 5 active · 1 retired [Stats]']],
      ['session:acme/lead', ['  ▾ ● acme-lead (2) · lead [Stats]']],
      ['session:acme/web', ['    ▾ ● acme-web (2) · sub-lead · later Mon 11-02 [Stats]']],
      ['team-search:session:acme/api', ['        ● acme-backend · ? 1 decision [Meet] [Stats]', '        id api']],
    ])
    const api = blockOf(blocks, 'team-search:session:acme/api').rows[0]?.spans ?? []
    // Its name is the press that opens its card, docked; the words that matched its id are on the line under it.
    expect(api.filter(span => span.toggles !== undefined)).toEqual([{ text: 'acme-backend', bold: true, toggles: cardKey('session:acme/api') }])
    expect(api.some(span => span.underline === true)).toBe(false)
    const web = blockOf(blocks, 'session:acme/web').rows[0]?.spans ?? []
    expect(web.some(span => span.underline === true)).toBe(false)
    // Its [Stats] names the tree's row, never the result's: back lands on the tree, as the tab's switch closes the search.
    expect(api.at(-1)?.stats).toEqual({ kind: 'open', scope: { kind: 'session', team: 'acme', session: 'api' }, row: 'session:acme/api' })
    expect(blockOf(blocks, 'team:acme').rows[0]?.spans.at(-1)?.stats).toEqual({ kind: 'open', scope: { kind: 'team', team: 'acme' }, row: 'team:acme' })
  })

  test('its name and role words underlined where they matched; a query no one session holds every word of names none', () => {
    expect(searched('reviewer backend').map(block => block.key)).toEqual(['team-search-none'])
    const ops = blockOf(searched('reviewer'), 'team-search:session:acme/ops').rows[0]?.spans ?? []
    expect(ops.filter(span => span.underline === true)).toEqual([{ text: 'reviewer', color: 'error', underline: true }])
    expect(ops.slice(4, 7)).toEqual([SEPARATOR, { text: 'security ', color: 'error' }, { text: 'reviewer', color: 'error', underline: true }])
    const named = blockOf(searched('backend'), 'team-search:session:acme/api').rows[0]?.spans ?? []
    expect(named.filter(span => span.underline === true)).toEqual([{ text: 'backend', bold: true, underline: true, toggles: cardKey('session:acme/api') }])
  })

  test('a session found by an id its name does not hold shows the id on a dim line under its row, its words underlined', () => {
    const api = blockOf(searched('api'), 'team-search:session:acme/api')
    expect(api.rows.map(row => row.key)).toEqual(['team-search:session:acme/api', 'team-search-id:session:acme/api'])
    expect(api.rows[1]?.spans).toEqual([{ text: '        ' }, { text: 'id ', dim: true }, { text: 'api', dim: true, underline: true }])
    // A search that matched only the name leaves the id out.
    expect(blockOf(searched('backend'), 'team-search:session:acme/api').rows).toHaveLength(1)
  })

  test('an id its name holds draws no line: the row underlines the same words, as most names are <team>-<id>', () => {
    const web = blockOf(searched('web'), 'team-search:session:acme/web')
    expect(web.rows).toHaveLength(1)
    expect(web.rows[0]?.spans.filter(span => span.underline === true)).toEqual([{ text: 'web', bold: true, underline: true, toggles: cardKey('session:acme/web') }])
  })

  test('a session whose name is its id underlines it on its row and draws no id line', () => {
    const root = treeOf([{ ...ACME, renames: [rename('api', 'acme-api', 'api')] }], 'acme')
    const blocks = teamBlocks({ kind: 'tree', root, failures: [] }, [], UTC, { search: { query: 'api', hits: searchTeam(root, 'api') } })
    const api = blockOf(blocks, 'team-search:session:acme/api')
    expect(api.rows).toHaveLength(1)
    expect(api.rows[0]?.spans.filter(span => span.underline === true)).toEqual([{ text: 'api', bold: true, underline: true, toggles: cardKey('session:acme/api') }])
  })

  test('a session found by its hire scope shows the scope on a dim line under its row, its words underlined', () => {
    const ops = blockOf(searched('again'), 'team-search:session:acme/ops')
    expect(ops.rows.map(row => row.key)).toEqual(['team-search:session:acme/ops', 'team-search-scope:session:acme/ops'])
    expect(ops.rows[1]?.spans).toEqual([
      { text: '      ' },
      { text: 'scope ', dim: true },
      { text: 'ops ', dim: true },
      { text: 'again', dim: true, underline: true },
    ])
    expect(blockOf(searched('reviewer'), 'team-search:session:acme/ops').rows).toHaveLength(1)
  })

  test("a retired session shows in its open retired group; each session's row is one press that opens its card, which follows it", () => {
    expect(searched('tester').map(block => block.key)).toEqual(['team-search-count', 'team:acme', 'retired:acme', 'team-search:session:acme/qa'])
    const blocks = searched('lead', [cardKey('session:acme/lead')])
    expect(blocks.map(block => block.folds)).toEqual([
      undefined,
      undefined,
      cardKey('session:acme/lead'),
      cardKey('session:acme/web'),
      undefined,
      cardKey('session:tools/boss'),
    ])
    // Docked the names hold those presses, a name its search split as parts of one press; a found team's row keeps no fold.
    const held = blocks.flatMap(block => block.rows.flatMap(row => row.spans.flatMap(span => span.toggles ?? [])))
    expect([...new Set(held)]).toEqual([cardKey('session:acme/lead'), cardKey('session:acme/web'), cardKey('session:tools/boss')])
    expect(blockOf(blocks, 'team-search:session:acme/lead').card?.[0]?.key).toBe('team-card:acme/lead:id')
    expect(blocks[0]?.rows[0]?.spans[0]?.text).toBe('3 sessions match')
  })

  test('the session whose pane it is keeps its mark on its row among the results', () => {
    const blocks = teamBlocks(TREE, [], UTC, { search: { query: 'api', hits: searchTeam(ROOT, 'api') }, own: sessionKey('acme', 'api') })
    expect(words(blocks).find(([key]) => key === 'team-search:session:acme/api')?.[1]).toEqual(['\u{25b6}\u{fe0e}       ● acme-backend · ? 1 decision [Meet] [Stats]', '        id api'])
    expect(blockOf(blocks, 'team-search:session:acme/api').rows[0]?.spans[0]).toEqual(OWN_MARK)
  })

  test('the hint for a query with no word, the nothing line for one that names no session, the notes before a tree', () => {
    expect(words(searched(' '))).toEqual([['team-search-hint', [TEAM_SEARCH_HINT]]])
    expect(words(searched('nobody'))).toEqual([['team-search-none', [TEAM_NOTHING_FOUND]]])
    expect(words(teamBlocks({ kind: 'reading' }, [], UTC, { search: { query: 'api', hits: [] } }))).toEqual([['team:note', ['Reading the team…']]])
  })
})

describe('toggledWith', () => {
  test('a press adds a key not toggled and takes back one that is', () => {
    expect(toggledWith([], 'team:acme')).toEqual(['team:acme'])
    expect(toggledWith(['retired:acme', 'team:acme'], 'team:acme')).toEqual(['retired:acme'])
  })
})

describe('openedWith', () => {
  test('adds a key not toggled, and keeps one that is', () => {
    expect(openedWith([], cardKey('session:acme/api'))).toEqual([cardKey('session:acme/api')])
    expect(openedWith(['team:acme', cardKey('session:acme/api')], cardKey('session:acme/api'))).toEqual(['team:acme', cardKey('session:acme/api')])
  })
})
