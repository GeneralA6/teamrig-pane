// The Team tab as blocks of rows (rows.ts): the team tree (team.ts) a node a row, depth first, each indented by its
// depth behind a mark that says whether it is open (▾), closed (▸) or has nothing under it. A team's row counts its
// active and retired sessions; a session's row is its mark (● on the team, ○ dim once retired), its id, its name where
// it differs, how many sessions it leads in brackets (T1244), its roles, its hire or its retire, how many of its cards wait on the owner now with a
// [Meet] press that runs `teamrig meet` on it (T1297) and when the next card the owner put off comes back; a retired
// group's row counts its sessions. A press on a team's or a retired group's row opens or closes what lies under it
// (`folds`). A press on a session's row opens or closes its card (team-card.ts) under it; a
// leader's row, and docked a row with a [Meet], holds its presses instead, a leader's mark opening or closing the
// sessions it leads and the id its card (`toggles`), and inline, where a row is one press, its row does the first.
// While the Find field holds a query, the tab draws its search (team-search.ts) on the shared search view
// (search-view.ts) instead: the count, then the sessions it names under their teams and leaders (team.ts foundRows),
// the words that matched underlined, a matched hire scope on a dim line under its row, and a press on any session's
// row opening or closing its card. What the last [Meet] press answered leads the tab. Days print on the team's clock
// (meta.ts dayWords). Pure.
import type { MeetAnswer, TeamView } from '../types'
import type { TimeZone } from './core/read/index'
import { dayWords } from './meta'
import { META_LINES, SEPARATOR, single, type Block, type Row, type Span } from './rows'
import { marksOf, type Mark } from './search'
import { excerpt, markedSpans, resultKey, searchViewBlocks, type Noun } from './search-view'
import { foundRows, teamRows, type SessionFacts, type SessionNode, type TeamRow, type TeamTreeNode } from './team'
import { roleWords, sessionCard } from './team-card'
import { TEAM_SEARCH_VIEW, teamFieldText, type SessionHit, type TeamSearchedField } from './team-search'

const TAB = 'team'
/** The cells each level of the tree indents its rows by, and the open mark's: a child's mark stands under its parent's text. */
const STEP = 2
/** What an empty Find field shows on the Team tab. */
export const TEAM_SEARCH_HINT = 'Type words to find a session by its id, name, role or hire scope.'
/** What a query no session matches shows. */
export const TEAM_NOTHING_FOUND = 'Nothing matches. The Teams tab searches every session in the tree, retired ones too.'
/** A Team search counts sessions. */
const SESSION_NOUN: Noun = { one: 'session', many: 'sessions' }
/** The press on a session's row that brings the owner its cards (`teamrig meet`). */
export const MEET_TEXT = '[Meet]'

/** The Find field's query on the Team tab and the sessions it names (team-search.ts searchTeam), in the tree's order. */
export type TeamSearch = { query: string; hits: readonly SessionHit[] }

/** Where a search's words matched in each of a session's fields. */
type Marks = (field: TeamSearchedField) => readonly Mark[]
/** Outside a search, or on a row a search draws only to lead to a match, nothing is underlined. */
const NO_MARKS: Marks = () => []

/** The key a session's card is open under among the toggled keys: its node's, as a card's. */
export function cardKey(key: string): string {
  return `card:${key}`
}

function note(key: string, text: string): Block {
  return single(key, [{ text, dim: true }])
}

/** `cells` blank cells. */
function blank(cells: number): Span {
  return { text: ' '.repeat(cells) }
}

/** `▾` open, `▸` closed, blank for a node with nothing under it, so the rows' text lines up. */
function foldMark(open: boolean | null): Span {
  return { text: open === null ? ' '.repeat(STEP) : open ? '▾ ' : '▸ ', dim: true }
}

/** The `marks` of a text that fall from `from` for `length` characters, cut there and counted from `from`. */
function within(marks: readonly Mark[], from: number, length: number): Mark[] {
  return marks.flatMap(mark => {
    const start = Math.max(mark.start, from) - from
    const end = Math.min(mark.end, from + length) - from
    return start < end ? [{ start, end }] : []
  })
}

/** `prefix` then `text`, the `marks` runs of `text` underlined, all in `style`. */
function prefixedSpans(prefix: string, text: string, marks: readonly Mark[], style: Omit<Span, 'text'>): Span[] {
  return markedSpans(`${prefix}${text}`, marks.map(mark => ({ start: mark.start + prefix.length, end: mark.end + prefix.length })), style)
}

/** Its roles, a part each behind the separator, the role `marks` (of the parts joined as teamFieldText joins them) underlined. */
function roleSpans(session: SessionFacts, marks: readonly Mark[]): Span[] {
  const spans: Span[] = []
  let at = 0
  for (const part of roleWords(session)) {
    spans.push(SEPARATOR, ...markedSpans(part, within(marks, at, part.length), { dim: true }))
    at += part.length + SEPARATOR.text.length
  }
  return spans
}

/** How it came to the team: its hire and the day it is reviewed, or its retire. */
function tenureWords(session: SessionFacts, zone: TimeZone): string[] {
  if (session.retire !== null) return [`retired ${dayWords(session.retire.at, zone)}`]
  if (session.hire === null) return []
  return [`${session.rehiredFrom === null ? 'hired' : 'rehired'} ${dayWords(session.hire.at, zone)}`, `review ${session.hire.reviewBy.slice(5)}`]
}

/** Whether the session's row holds a [Meet] press: a card of it waits on the owner now. */
function meetsOwner(session: SessionFacts): boolean {
  return (session.decisions?.due.length ?? 0) > 0
}

/**
 * Its cards on the owner: how many wait now, in the Log's colour for the owner, and the [Meet] press; then when the
 * next one the owner put off comes back, dim. Nothing for none, or a team whose register the pane does not read.
 */
function decisionSpans(session: SessionFacts): Span[] {
  const decisions = session.decisions
  if (decisions === null) return []
  const spans: Span[] = []
  const due = decisions.due.length
  if (due > 0) {
    spans.push(SEPARATOR, { text: `? ${due} ${due === 1 ? 'decision' : 'decisions'}`, color: 'suggestion' }, { text: ' ' })
    spans.push({ text: MEET_TEXT, color: 'suggestion', meets: session.id })
  }
  const next = decisions.later[0]
  if (next !== undefined) spans.push(SEPARATOR, { text: `later ${next.until}`, dim: true })
  return spans
}

/**
 * A session's row: its mark, its id (bold on the team, a press that opens or closes its card when `card` names it),
 * its name where it is not the id, how many sessions it leads in brackets, dim, its roles, its hire or retire, its
 * cards on the owner; where `marks` says a search's words matched, underlined.
 */
function sessionSpans(session: SessionFacts, zone: TimeZone, card: string | null, marks: Marks): Span[] {
  const isRetired = !session.active
  const idStyle: Omit<Span, 'text'> = isRetired ? { dim: true } : { bold: true }
  const spans: Span[] = [isRetired ? { text: '○ ', dim: true } : { text: '● ' }, ...markedSpans(session.id, marks('id'), card === null ? idStyle : { ...idStyle, toggles: card })]
  const name = teamFieldText(session, 'name')
  if (name !== null) spans.push(...prefixedSpans('  ', name, marks('name'), { dim: isRetired }))
  if (session.leads > 0) spans.push({ text: ` (${session.leads})`, dim: true })
  if (session.retire === null) spans.push(...roleSpans(session, marks('role')))
  for (const part of tenureWords(session, zone)) spans.push(SEPARATOR, { text: part, dim: true })
  spans.push(...decisionSpans(session))
  return spans
}

/** A team's or a retired group's own words: the team and its counts, or the group and its count. */
function groupSpans(node: Exclude<TeamTreeNode, { kind: 'session' }>): Span[] {
  switch (node.kind) {
    case 'team':
      return [
        { text: node.team.team, bold: true },
        SEPARATOR,
        { text: `${node.team.active} active`, dim: true },
        SEPARATOR,
        { text: `${node.team.retired} retired`, dim: true },
      ]
    case 'retired':
      return [{ text: `retired (${node.children.length})`, dim: true }]
  }
}

/** A row's lead: the blank its depth indents it by, and where its wrapped lines start, under its words. */
function leadOf(depth: number): { before: Span[]; hang: Span } {
  const indent = depth * STEP
  return { before: indent === 0 ? [] : [blank(indent)], hang: blank(indent + STEP) }
}

/** The session's card while `toggled` holds its key, each line behind a guide under its mark; else nothing. */
function openCard(node: SessionNode, hang: Span, toggled: ReadonlySet<string>, zone: TimeZone): Pick<Block, 'card'> {
  return toggled.has(cardKey(node.key)) ? { card: sessionCard(node.session, { text: `${hang.text}│ `, dim: true }, zone) } : {}
}

/**
 * The press a session's id holds on a row that is one press: none, or its card's key when the row holds a [Meet],
 * since docked a row whose line holds a press draws as its pieces and drops its own press (layout.ts dockLayout).
 */
function idPress(session: SessionFacts, card: string): string | null {
  return meetsOwner(session) ? card : null
}

/**
 * One row of the tree: indented by its depth, its open mark, its words; its wrapped lines start under its words. A
 * session's card, while `toggled` holds its key, follows its row.
 */
function rowBlock({ node, depth, open }: TeamRow, toggled: ReadonlySet<string>, zone: TimeZone): Block {
  const { before, hang } = leadOf(depth)
  if (node.kind !== 'session') {
    const block = single(node.key, [...before, foldMark(open), ...groupSpans(node)], hang)
    return open === null ? block : { ...block, folds: node.key }
  }
  const card = cardKey(node.key)
  const opened = openCard(node, hang, toggled, zone)
  if (open === null) {
    const spans = [...before, foldMark(open), ...sessionSpans(node.session, zone, idPress(node.session, card), NO_MARKS)]
    return { ...single(node.key, spans, hang), folds: card, ...opened }
  }
  const spans = [...before, { ...foldMark(open), toggles: node.key }, ...sessionSpans(node.session, zone, card, NO_MARKS)]
  return { ...single(node.key, spans, hang), folds: node.key, ...opened }
}

/**
 * One row a search draws: a team or a retired group, open over what it leads to, no press; a session the search names,
 * keyed as its result, its matched words underlined and its matched scope on a dim line under it; a session drawn only
 * to lead to one. A session's row is one press that opens or closes its card, which follows it while open (docked,
 * its id is, on a row that holds a [Meet]).
 */
function foundBlock({ node, depth, open }: TeamRow, hits: ReadonlyMap<string, SessionHit>, toggled: ReadonlySet<string>, zone: TimeZone): Block {
  const { before, hang } = leadOf(depth)
  if (node.kind !== 'session') return single(node.key, [...before, foldMark(open), ...groupSpans(node)], hang)
  const hit = hits.get(node.key)
  const marks: Marks = hit === undefined ? NO_MARKS : field => marksOf(hit, field)
  const key = hit === undefined ? node.key : resultKey(TEAM_SEARCH_VIEW, node.key)
  const rows: Row[] = [{ key, spans: [...before, foldMark(open), ...sessionSpans(node.session, zone, idPress(node.session, cardKey(node.key)), marks)], hang }]
  const scope = teamFieldText(node.session, 'scope')
  if (scope !== null && marks('scope').length > 0) {
    const shown = excerpt(scope, marks('scope'))
    const spans = [hang, { text: 'scope ', dim: true }, ...markedSpans(shown.text, shown.marks, { dim: true })]
    rows.push({ key: `${TEAM_SEARCH_VIEW}-scope:${node.key}`, spans, hang, maxLines: META_LINES })
  }
  return { key, rows, folds: cardKey(node.key), ...openCard(node, hang, toggled, zone) }
}

/** The search's body over the tree: the hint, the line that says nothing matched, or the count and the found rows. */
function foundBlocks(root: TeamTreeNode, search: TeamSearch, toggled: ReadonlySet<string>, zone: TimeZone): Block[] {
  const hits = new Map(search.hits.map(hit => [hit.row.key, hit]))
  const results = foundRows(root, new Set(hits.keys())).map(row => foundBlock(row, hits, toggled, zone))
  const total = search.hits.length
  return searchViewBlocks({ key: TEAM_SEARCH_VIEW, query: search.query, hint: TEAM_SEARCH_HINT, nothing: TEAM_NOTHING_FOUND, noun: SESSION_NOUN, results, shown: total, total })
}

/** What the last [Meet] press answered: asking, asked with what teamrig did, or why it refused. */
function meetBlock(answer: MeetAnswer): Block {
  const key = `${TAB}:meet`
  const style: Omit<Span, 'text'> = answer.outcome === 'refused' ? { color: 'warning' } : { dim: true }
  const lines = answer.lines.map((line, i): Row => ({ key: `${key}:${i}`, spans: [{ ...style, text: `  ${line}` }], hang: { text: '    ' } }))
  switch (answer.outcome) {
    case 'asking':
      return single(key, [{ text: `Asking ${answer.session} for its cards…`, dim: true }])
    case 'asked':
      return { key, rows: [{ key, spans: [{ text: `Asked ${answer.session} for its cards:`, color: 'success' }] }, ...lines] }
    case 'refused':
      return { key, rows: [{ key, spans: [{ text: `${answer.session} was not asked:`, color: 'warning' }] }, ...lines] }
  }
}

/** The tree's body: the search's while `search` holds a query, else the tree's rows. */
function treeBlocks(root: TeamTreeNode, toggled: readonly string[], zone: TimeZone, search: TeamSearch | null): Block[] {
  const keys = new Set(toggled)
  if (search !== null) return foundBlocks(root, search, keys, zone)
  return teamRows(root, keys).map(row => rowBlock(row, keys, zone))
}

/**
 * The Team tab: the tree's rows, with the nodes in `toggled` opened or closed against their default and the sessions
 * whose card key (cardKey) it holds showing their cards, or why none show; while `search` holds the Find field's
 * query, the search's body instead; what the last [Meet] press answered (`meet`) leads either.
 */
export function teamBlocks(view: TeamView, toggled: readonly string[], zone: TimeZone, search: TeamSearch | null = null, meet: MeetAnswer | null = null): Block[] {
  switch (view.kind) {
    case 'reading':
      return [note(`${TAB}:note`, 'Reading the team…')]
    case 'no-team':
      return [note(`${TAB}:note`, "No team found: the Teams tab shows the tree of teams the session's team is in.")]
    case 'failed':
      return [single(`${TAB}:note`, [{ text: `The team could not be read: ${view.reason.replace(/\.$/, '')}.`, color: 'warning' }])]
    case 'tree': {
      if (view.root === null) return [note(`${TAB}:note`, 'No team tree: the team has no config file teamrig can read, and the tree is read from it.')]
      return [...(meet === null ? [] : [meetBlock(meet)]), ...treeBlocks(view.root, toggled, zone, search)]
    }
  }
}

/** `toggled` with `key` flipped: a press on a node opens a closed one and closes an open one. */
export function toggledWith(toggled: readonly string[], key: string): string[] {
  return toggled.includes(key) ? toggled.filter(shown => shown !== key) : [...toggled, key]
}

/** `toggled` with `key` in it: Enter on a search's one match opens its card, and never closes one. */
export function openedWith(toggled: readonly string[], key: string): string[] {
  return toggled.includes(key) ? [...toggled] : [...toggled, key]
}
