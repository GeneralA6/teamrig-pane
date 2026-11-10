// The Teams tab as blocks of rows (rows.ts): the team tree (team.ts) a node a row, depth first, each indented by its
// depth behind a mark that says whether it is open (▾), closed (▸) or has nothing under it. A team's row counts its
// active and retired sessions, then its week with its child teams' (T1713): a bar of its planned part filled as far as
// it used it, green up to how far the week is, amber past it (ahead of plan), a │ marking that point when it is behind,
// and the used and planned percents of the account's week. A session's row is its mark (● on the team, ○ dim once
// retired), its name alone, its id staying on its card (T1795), how many sessions it leads in brackets (T1244), its
// roles each in its role's colour (team-card.ts
// ROLE_COLORS, T1245), how many of its cards wait on the owner now with a [Meet] press that runs `teamrig meet` on it
// (T1297, session-acts.ts), which once pressed answers in its place, where the owner pressed (T2206): Asking…, then Asked and when, with
// no press, so no second ask; a refused one keeps the press and says it was not asked. Then when the next card the
// owner put off comes back; its hire and retire days are its card's. An active session's row, but for the one whose
// pane it is (the owner types in that tab), holds a [Wake] press that runs `teamrig owner wake` on it (T2298) and
// answers in its place the same way: Waking…, then Woke and when, or not woken. A retired
// group's row counts its sessions. The row of the session whose pane it is starts with a green ▶ in the indent's first
// cell (T1281), so the viewer finds itself at a glance. A team's and a session's row end in a [Stats] press that opens
// the Stats tab on it (T1714). A press on a team's or a retired group's row opens or closes what lies under it
// (`folds`), a press on a session's row its card (team-card.ts) under it, or for a leader the sessions it leads. Docked,
// a row whose line holds a press draws as its pieces and drops its own, so the row's presses sit on its words
// (`toggles`): a team's mark and name open or close what lies under it, a leader's mark the sessions it leads, a
// session's name its card. Inline a row is one press, its `folds`, and [Stats], [Meet] and [Wake] are words.
// While the Find field holds a query, the tab draws its search (team-search.ts) on the shared search view
// (search-view.ts) instead: the count, then the sessions it names under their teams and leaders (team.ts foundRows),
// the words that matched underlined, a matched id or hire scope on a dim line under its row, and a press on any
// session's row, docked its name, opening or closing its card. What the last session act answered, with the lines the
// CLI printed, leads the tab, then a WARN line
// for each team folder the last read could not read (T1234). A card prints its days on the team's clock. Pure.
import type { SessionAct, SessionAnswer, SessionPress, StatsChoice, TeamFolderFailure, TeamView } from '../types'
import type { TimeZone } from './core/read/index'
import { META_LINES, SEPARATOR, single, type Block, type Row, type Span } from './rows'
import { marksOf, type Mark } from './search'
import { excerpt, markedSpans, resultKey, searchViewBlocks, type Noun } from './search-view'
import { foundRows, teamRows, type RetiredNode, type SessionFacts, type SessionNode, type TeamNode, type TeamRow, type TeamTreeNode, type TeamWeek } from './team'
import { roleSpans, sessionCard } from './team-card'
import { TEAM_SEARCH_VIEW, teamFieldText, type SessionHit, type TeamSearchedField } from './team-search'

const TAB = 'team'
/** The cells each level of the tree indents its rows by, and the open mark's: a child's mark stands under its parent's text. */
const STEP = 2
/** What an empty Find field shows on the Teams tab. */
export const TEAM_SEARCH_HINT = 'Type words to find a session by its id, name, role or hire scope.'
/** What a query no session matches shows. */
export const TEAM_NOTHING_FOUND = 'Nothing matches. The Teams tab searches every session in the tree, retired ones too.'
/** A Team search counts sessions. */
const SESSION_NOUN: Noun = { one: 'session', many: 'sessions' }
/** The press on a session's row that brings the owner its cards (`teamrig meet`). */
export const MEET_TEXT = '[Meet]'
/** What stands in the [Meet] press's place while its run asks the session. */
export const MEET_ASKING = 'Asking…'
/** The press on an active session's row that wakes it by hand (`teamrig owner wake`). */
export const WAKE_TEXT = '[Wake]'

/**
 * How a session act (session-acts.ts) draws: its press and the press's style; on its row, what stands in the press's
 * place while it runs, the word before when it did it, and what follows the press after a refusal; and the top line
 * of the tab, about the session, while it runs, once done and after a refusal.
 */
type ActLook = {
  readonly press: string
  readonly style: Omit<Span, 'text'>
  readonly running: string
  readonly done: string
  readonly refused: string
  readonly runningHead: (session: string) => string
  readonly doneHead: (session: string) => string
  readonly refusedHead: (session: string) => string
}

const ACT_LOOKS: { readonly [act in SessionAct]: ActLook } = {
  meet: {
    press: MEET_TEXT,
    style: { color: 'suggestion' },
    running: MEET_ASKING,
    done: 'Asked',
    refused: ' not asked',
    runningHead: session => `Asking ${session} for its cards…`,
    doneHead: session => `Asked ${session} for its cards:`,
    refusedHead: session => `${session} was not asked:`,
  },
  wake: {
    press: WAKE_TEXT,
    style: { dim: true },
    running: 'Waking…',
    done: 'Woke',
    refused: ' not woken',
    runningHead: session => `Waking ${session}…`,
    doneHead: session => `Woke ${session}:`,
    refusedHead: session => `${session} was not woken:`,
  },
}
/** The press that ends a team's and a session's row: the Stats tab on it, its sub-teams rolled in for a team. */
export const STATS_TEXT = '[Stats]'
/**
 * The mark before the row of the session whose pane it is: one cell of plain text in the success colour, a triangle as
 * tall as it is wide (T1793). ▶ (U+25B6) is that triangle, and an emoji in some terminals, so VS15 (U+FE0E) asks for
 * its text form. ► (U+25BA), the mark before, is a pointer drawn half as tall as wide (JetBrains Mono: 610 by 300
 * units, where ▶ is 610 by 620).
 */
export const OWN_MARK: Span = { text: '\u{25b6}\u{fe0e}', color: 'success' }

/** The Find field's query on the Teams tab and the sessions it names (team-search.ts searchTeam), in the tree's order. */
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

/** Its roles, each behind the separator in its role's colour, the role `marks` (of the words joined as teamFieldText joins them) underlined. */
function markedRoles(session: SessionFacts, marks: readonly Mark[]): Span[] {
  const spans: Span[] = []
  let at = 0
  for (const { text, color } of roleSpans(session)) {
    spans.push(SEPARATOR, ...markedSpans(text, within(marks, at, text.length), { color }))
    at += text.length + SEPARATOR.text.length
  }
  return spans
}

/** The [Stats] press that ends the row of tree node `row`, opening the Stats tab on `scope`. */
function statsSpans(row: string, scope: StatsChoice): Span[] {
  return [{ text: ' ' }, { text: STATS_TEXT, dim: true, stats: { kind: 'open', scope, row } }]
}

/** Whether `answer` is to `press`: the same act on the same session of the same team. */
function isAnswerTo(answer: SessionAnswer, press: SessionPress): boolean {
  return answer.act === press.act && answer.team === press.team && answer.session === press.session
}

/**
 * The `act` press on `session`'s row, or in its place what the last press of it answered (`answer`), so the answer
 * shows where the owner pressed: dim while it runs ([Meet]: Asking…); the word and when on the team's clock once
 * teamrig did it (Asked), with no press until the answer clears, as a second press would only do it again; the press
 * again after a refusal, saying it was not done (not asked; the tab's top line says why).
 */
function actSpans(act: SessionAct, session: SessionFacts, answer: SessionAnswer | null, zone: TimeZone): Span[] {
  const look = ACT_LOOKS[act]
  const sessionAct: SessionPress = { act, team: session.team, session: session.id }
  const press: Span = { text: look.press, ...look.style, sessionAct }
  if (answer === null || !isAnswerTo(answer, sessionAct)) return [press]
  switch (answer.outcome) {
    case 'running':
      return [{ text: look.running, dim: true }]
    case 'done':
      return [{ text: `${look.done} ${zone.clock(new Date(answer.at))}`, color: 'success' }]
    case 'refused':
      return [press, { text: look.refused, color: 'warning' }]
  }
}

/**
 * Its cards on the owner: how many wait now, in the Log's colour for the owner, and the [Meet] press or what it
 * answered (actSpans); then when the next one the owner put off comes back, dim. Nothing for none, or a team whose
 * register the pane does not read.
 */
function decisionSpans(session: SessionFacts, { answer, zone }: Pick<Drawing, 'answer' | 'zone'>): Span[] {
  const decisions = session.decisions
  if (decisions === null) return []
  const spans: Span[] = []
  const due = decisions.due.length
  if (due > 0) {
    spans.push(SEPARATOR, { text: `? ${due} ${due === 1 ? 'decision' : 'decisions'}`, color: 'suggestion' }, { text: ' ' })
    spans.push(...actSpans('meet', session, answer, zone))
  }
  const next = decisions.later[0]
  if (next !== undefined) spans.push(SEPARATOR, { text: `later ${next.until}`, dim: true })
  return spans
}

/**
 * A session's row: its mark, its name (bold on the team, the press that opens or closes its card), how many sessions
 * it leads in brackets, dim, its roles in their colours, its cards on the owner, its [Wake] while it is active and the
 * pane is not its own, its [Stats]; where `marks` says a search's words matched, underlined. Its id, hire and retire
 * are its card's. A name that is the id is searched as the id (teamFieldText), so its marks are the id's.
 */
function sessionSpans({ key, session }: SessionNode, marks: Marks, drawing: Drawing): Span[] {
  const isRetired = !session.active
  const nameStyle: Omit<Span, 'text'> = isRetired ? { dim: true } : { bold: true }
  const matched = marks(teamFieldText(session, 'name') === null ? 'id' : 'name')
  const spans: Span[] = [isRetired ? { text: '○ ', dim: true } : { text: '● ' }, ...markedSpans(session.name, matched, { ...nameStyle, toggles: cardKey(key) })]
  if (session.leads > 0) spans.push({ text: ` (${session.leads})`, dim: true })
  spans.push(...markedRoles(session, marks('role')), ...decisionSpans(session, drawing))
  if (!isRetired && drawing.own !== key) spans.push({ text: ' ' }, ...actSpans('wake', session, drawing.answer, drawing.zone))
  spans.push(...statsSpans(key, { kind: 'session', team: session.team, session: session.id }))
  return spans
}

/** The cells of a team's week bar: its whole planned part, a cell a tenth of it. */
export const WEEK_CELLS = 10

/** A percent of the account's week as a row prints it: whole from 10, else to a tenth (0.3%, 5.7%, 35%). */
export function weekPct(pct: number): string {
  const tenths = Math.round(pct * 10) / 10
  return `${tenths >= 10 ? Math.round(pct) : tenths}%`
}

/** `count` cells of `cell` in `style`; none for none, so a row holds no empty span. */
function cellRun(cell: string, count: number, style: Omit<Span, 'text'>): Span[] {
  return count > 0 ? [{ text: cell.repeat(count), ...style }] : []
}

/**
 * A team's week: its bar of WEEK_CELLS cells, its planned part, filled as far as it used it; green up to how far the
 * week is (its pace), amber past that, as it is ahead of its plan; while it is behind, a dim │ ends the pace's cells.
 * A team planned no part of the week has no pace: its bar is empty until it uses some, then all amber. Then the used
 * and planned percents. Nothing when no week file holds this week.
 */
function weekSpans(week: TeamWeek | null): Span[] {
  if (week === null) return []
  const hasPlan = week.plannedPct > 0
  const usedOfPlan = hasPlan ? Math.min(1, week.usedPct / week.plannedPct) : week.usedPct > 0 ? 1 : 0
  const filled = Math.round(usedOfPlan * WEEK_CELLS)
  const pace = hasPlan ? Math.round(week.elapsedPct / (100 / WEEK_CELLS)) : 0
  const bar =
    filled >= pace
      ? [...cellRun('█', pace, { color: 'success' }), ...cellRun('█', filled - pace, { color: 'warning' }), ...cellRun('░', WEEK_CELLS - filled, { dim: true })]
      : [...cellRun('█', filled, { color: 'success' }), { text: `${'░'.repeat(pace - 1 - filled)}│${'░'.repeat(WEEK_CELLS - pace)}`, dim: true }]
  return [SEPARATOR, { text: 'week ', dim: true }, ...bar, { text: ` ${weekPct(week.usedPct)} of ${weekPct(week.plannedPct)}`, dim: true }]
}

/** A team's own words: the team, holding `press`, its counts, its week and its [Stats]. */
function teamSpans({ key, team }: TeamNode, press: Pick<Span, 'toggles'>): Span[] {
  return [
    { text: team.team, bold: true, ...press },
    SEPARATOR,
    { text: `${team.active} active`, dim: true },
    SEPARATOR,
    { text: `${team.retired} retired`, dim: true },
    ...weekSpans(team.week),
    ...statsSpans(key, { kind: 'team', team: team.team }),
  ]
}

/** A retired group's own words: the group and its count. */
function retiredSpan({ children }: RetiredNode): Span {
  return { text: `retired (${children.length})`, dim: true }
}

/**
 * A row's lead: the blank its depth indents it by, the own mark in its first cell on the row of the session whose pane
 * it is (`own`), and where its wrapped lines start, under its words. A session sits a level under its team at least,
 * so its indent has the cell.
 */
function leadOf(depth: number, own = false): { before: Span[]; hang: Span } {
  const indent = depth * STEP
  const mark = own ? [OWN_MARK] : []
  const rest = indent - mark.length
  return { before: [...mark, ...(rest > 0 ? [blank(rest)] : [])], hang: blank(indent + STEP) }
}

/**
 * What every row of a drawing reads besides its node: the nodes opened or closed against their default and the cards
 * open (`toggled`), the team's clock, the node key of the session whose pane it is (`own`, null for none), and what
 * the last session act answered (`answer`, null before one), drawn on the row of the session it names.
 */
type Drawing = { readonly toggled: ReadonlySet<string>; readonly zone: TimeZone; readonly own: string | null; readonly answer: SessionAnswer | null }

/** Whether `node` is the session whose pane it is. */
function isOwn(node: TeamTreeNode, own: string | null): boolean {
  return node.kind === 'session' && node.key === own
}

/** The session's card while `toggled` holds its key, each line behind a guide under its mark; else nothing. */
function openCard(node: SessionNode, hang: Span, toggled: ReadonlySet<string>, zone: TimeZone): Pick<Block, 'card'> {
  return toggled.has(cardKey(node.key)) ? { card: sessionCard(node.session, { text: `${hang.text}│ `, dim: true }, zone) } : {}
}

/**
 * One row of the tree: indented by its depth, its open mark, its words; its wrapped lines start under its words. A
 * session's card, while `toggled` holds its key, follows its row. A team's mark and name, and a leader's mark, hold the
 * press that opens or closes what lies under it, as docked its [Stats] leaves the row no press of its own.
 */
function rowBlock({ node, depth, open }: TeamRow, drawing: Drawing): Block {
  const { toggled, zone, own } = drawing
  const { before, hang } = leadOf(depth, isOwn(node, own))
  const folded = open === null ? {} : { folds: node.key }
  const press = open === null ? {} : { toggles: node.key }
  switch (node.kind) {
    case 'team':
      return { ...single(node.key, [...before, { ...foldMark(open), ...press }, ...teamSpans(node, press)], hang), ...folded }
    case 'retired':
      return { ...single(node.key, [...before, foldMark(open), retiredSpan(node)], hang), ...folded }
    case 'session': {
      const spans = [...before, { ...foldMark(open), ...press }, ...sessionSpans(node, NO_MARKS, drawing)]
      return { ...single(node.key, spans, hang), folds: open === null ? cardKey(node.key) : node.key, ...openCard(node, hang, toggled, zone) }
    }
  }
}

/**
 * One row a search draws: a team or a retired group, open over what it leads to, no fold; a session the search names,
 * keyed as its result, its matched words underlined and a matched id or scope on a dim line under it, as its row does
 * not draw them; a session drawn only to lead to one. A session's row is one press that opens or closes its card, which
 * follows it while open (docked, its name is).
 */
function foundBlock({ node, depth, open }: TeamRow, hits: ReadonlyMap<string, SessionHit>, drawing: Drawing): Block {
  const { toggled, zone, own } = drawing
  const { before, hang } = leadOf(depth, isOwn(node, own))
  if (node.kind === 'team') return single(node.key, [...before, foldMark(open), ...teamSpans(node, {})], hang)
  if (node.kind === 'retired') return single(node.key, [...before, foldMark(open), retiredSpan(node)], hang)
  const hit = hits.get(node.key)
  const marks: Marks = hit === undefined ? NO_MARKS : field => marksOf(hit, field)
  const key = hit === undefined ? node.key : resultKey(TEAM_SEARCH_VIEW, node.key)
  const rows: Row[] = [{ key, spans: [...before, foldMark(open), ...sessionSpans(node, marks, drawing)], hang }]
  // A name that holds the id, as most `<team>-<id>` names do, shows it on the row, where a line would only repeat it.
  const unshown: readonly TeamSearchedField[] = node.session.name.includes(node.session.id) ? ['scope'] : ['id', 'scope']
  for (const field of unshown) {
    const text = teamFieldText(node.session, field)
    if (text === null || marks(field).length === 0) continue
    const shown = excerpt(text, marks(field))
    const spans = [hang, { text: `${field} `, dim: true }, ...markedSpans(shown.text, shown.marks, { dim: true })]
    rows.push({ key: `${TEAM_SEARCH_VIEW}-${field}:${node.key}`, spans, hang, maxLines: META_LINES })
  }
  return { key, rows, folds: cardKey(node.key), ...openCard(node, hang, toggled, zone) }
}

/** The search's body over the tree: the hint, the line that says nothing matched, or the count and the found rows. */
function foundBlocks(root: TeamTreeNode, search: TeamSearch, drawing: Drawing): Block[] {
  const hits = new Map(search.hits.map(hit => [hit.row.key, hit]))
  const results = foundRows(root, new Set(hits.keys())).map(row => foundBlock(row, hits, drawing))
  const total = search.hits.length
  return searchViewBlocks({ key: TEAM_SEARCH_VIEW, query: search.query, hint: TEAM_SEARCH_HINT, nothing: TEAM_NOTHING_FOUND, noun: SESSION_NOUN, results, shown: total, total })
}

/** What the last session act answered: that it runs, what teamrig did, or why it refused; keyed `team:<act>`. */
function answerBlock(answer: SessionAnswer): Block {
  const look = ACT_LOOKS[answer.act]
  const key = `${TAB}:${answer.act}`
  const style: Omit<Span, 'text'> = answer.outcome === 'refused' ? { color: 'warning' } : { dim: true }
  const lines = answer.lines.map((line, i): Row => ({ key: `${key}:${i}`, spans: [{ ...style, text: `  ${line}` }], hang: { text: '    ' } }))
  switch (answer.outcome) {
    case 'running':
      return single(key, [{ text: look.runningHead(answer.session), dim: true }])
    case 'done':
      return { key, rows: [{ key, spans: [{ text: look.doneHead(answer.session), color: 'success' }] }, ...lines] }
    case 'refused':
      return { key, rows: [{ key, spans: [{ text: look.refusedHead(answer.session), color: 'warning' }] }, ...lines] }
  }
}

/**
 * A team folder the last read could not read, on the `view` tab (the Teams or the Stats tab): a WARN line naming it,
 * why, and whether the tab draws it as last read.
 */
export function failureBlock(view: string, failure: TeamFolderFailure): Block {
  const shown = failure.isLastRead ? 'it shows as last read' : 'it is left out'
  const text = `WARN team ${failure.team} could not be read: ${failure.reason.replace(/\.$/, '')}; ${shown}.`
  return single(`${view}:failure:${failure.team}`, [{ text, color: 'warning' }], { text: '  ' })
}

/** What the tab draws besides the tree: the Find field's search, and what the last session act answered. */
export type TeamExtras = {
  /** The Find field's query and the sessions it names; null or absent outside a search. */
  readonly search?: TeamSearch | null
  /** What the last session act answered; null or absent before one. */
  readonly answer?: SessionAnswer | null
  /** The node key (team.ts sessionKey) of the session whose pane it is, its row marked; null or absent for none. */
  readonly own?: string | null
}

/** The tree's body: the search's while `search` holds a query, else the tree's rows; the `own` session's row marked. */
function treeBlocks(root: TeamTreeNode, search: TeamSearch | null, drawing: Drawing): Block[] {
  if (search !== null) return foundBlocks(root, search, drawing)
  return teamRows(root, drawing.toggled).map(row => rowBlock(row, drawing))
}

/**
 * The Teams tab: the tree's rows, with the nodes in `toggled` opened or closed against their default and the sessions
 * whose card key (cardKey) it holds showing their cards, or why none show; while the `extras` search holds the Find
 * field's query, the search's body instead; what the last session act answered (`answer`) leads either, and stands in
 * its press's place on the row of the session it names, then a WARN line for each team folder the last read could not
 * read, the no-tree note's too. The row of the `own` session, the one whose pane it is, starts with OWN_MARK.
 */
export function teamBlocks(view: TeamView, toggled: readonly string[], zone: TimeZone, { search = null, answer = null, own = null }: TeamExtras = {}): Block[] {
  switch (view.kind) {
    case 'reading':
      return [note(`${TAB}:note`, 'Reading the team…')]
    case 'no-team':
      return [note(`${TAB}:note`, "No team found: the Teams tab shows the tree of teams the session's team is in.")]
    case 'failed':
      return [single(`${TAB}:note`, [{ text: `The team could not be read: ${view.reason.replace(/\.$/, '')}.`, color: 'warning' }])]
    case 'tree': {
      const failures = view.failures.map(failure => failureBlock(TAB, failure))
      if (view.root === null) return [...failures, note(`${TAB}:note`, 'No team tree: the team has no config file teamrig can read, and the tree is read from it.')]
      return [...(answer === null ? [] : [answerBlock(answer)]), ...failures, ...treeBlocks(view.root, search, { toggled: new Set(toggled), zone, own, answer })]
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
