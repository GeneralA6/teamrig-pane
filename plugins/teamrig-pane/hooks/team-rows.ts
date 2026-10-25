// The Team tab as blocks of rows (rows.ts): the team tree (team.ts) a node a row, depth first, each indented by its
// depth behind a mark that says whether it is open (▾), closed (▸) or has nothing under it. A team's row counts its
// active and closed sessions; a session's row is its mark (● on the team, ○ dim once retired), its id, its name where
// it differs, its roles, how many it leads, its hire or its retire, and its former names, dim; a closed group's row
// counts its sessions. A press on a team's or a closed group's row opens or closes what lies under it (`folds`). A
// press on a session's row opens or closes its card (team-card.ts) under it; a leader's row holds two presses instead,
// its mark opening or closing the sessions it leads and its id its card (`toggles`), and inline, where a row is one
// press, its row does the first. Days print on the team's clock (meta.ts dayWords). Pure.
import type { TeamView } from '../types'
import type { TimeZone } from './core/read/index'
import { dayWords } from './meta'
import { SEPARATOR, single, type Block, type Span } from './rows'
import { teamRows, type SessionFacts, type TeamRow, type TeamTreeNode } from './team'
import { roleWords, sessionCard } from './team-card'

const TAB = 'team'
/** The cells each level of the tree indents its rows by, and the open mark's: a child's mark stands under its parent's text. */
const STEP = 2

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

/** What a session does on the team: its roles, how many it leads, its hire and the day it is reviewed, or its retire. */
function doesWords(session: SessionFacts, zone: TimeZone): string[] {
  if (session.retire !== null) return [`retired ${dayWords(session.retire.at, zone)}`]
  const parts = roleWords(session)
  if (session.hire !== null) {
    parts.push(`${session.rehiredFrom === null ? 'hired' : 'rehired'} ${dayWords(session.hire.at, zone)}`, `review ${session.hire.reviewBy.slice(5)}`)
  }
  return parts
}

/**
 * A session's row: its mark, its id (bold on the team, a press that opens or closes its card when `card` names it),
 * its name where it is not the id, what it does, its former names.
 */
function sessionSpans(session: SessionFacts, zone: TimeZone, card: string | null): Span[] {
  const isClosed = !session.active
  const id: Span = isClosed ? { text: session.id, dim: true } : { text: session.id, bold: true }
  const spans: Span[] = [isClosed ? { text: '○ ', dim: true } : { text: '● ' }, card === null ? id : { ...id, toggles: card }]
  if (session.name !== session.id) spans.push({ text: `  ${session.name}`, dim: isClosed })
  for (const part of doesWords(session, zone)) spans.push(SEPARATOR, { text: part, dim: true })
  if (session.formerNames.length > 0) spans.push(SEPARATOR, { text: `formerly ${session.formerNames.join(', ')}`, dim: true })
  return spans
}

/** A team's or a closed group's own words: the team and its counts, or the group and its count. */
function groupSpans(node: Exclude<TeamTreeNode, { kind: 'session' }>): Span[] {
  switch (node.kind) {
    case 'team':
      return [
        { text: node.team.team, bold: true },
        SEPARATOR,
        { text: `${node.team.active} active`, dim: true },
        SEPARATOR,
        { text: `${node.team.closed} closed`, dim: true },
      ]
    case 'closed':
      return [{ text: `closed (${node.children.length})`, dim: true }]
  }
}

/**
 * One row of the tree: indented by its depth, its open mark, its words; its wrapped lines start under its words. A
 * session's card, while `toggled` holds its key, follows its row, each line behind a guide under its mark.
 */
function rowBlock({ node, depth, open }: TeamRow, toggled: ReadonlySet<string>, zone: TimeZone): Block {
  const indent = depth * STEP
  const before = indent === 0 ? [] : [blank(indent)]
  const hang = blank(indent + STEP)
  if (node.kind !== 'session') {
    const block = single(node.key, [...before, foldMark(open), ...groupSpans(node)], hang)
    return open === null ? block : { ...block, folds: node.key }
  }
  const card = cardKey(node.key)
  const opened = toggled.has(card) ? { card: sessionCard(node.session, { text: `${hang.text}│ `, dim: true }, zone) } : {}
  if (open === null) return { ...single(node.key, [...before, foldMark(open), ...sessionSpans(node.session, zone, null)], hang), folds: card, ...opened }
  const spans = [...before, { ...foldMark(open), toggles: node.key }, ...sessionSpans(node.session, zone, card)]
  return { ...single(node.key, spans, hang), folds: node.key, ...opened }
}

/**
 * The Team tab: the tree's rows, with the nodes in `toggled` opened or closed against their default and the sessions
 * whose card key (cardKey) it holds showing their cards, or why none show.
 */
export function teamBlocks(view: TeamView, toggled: readonly string[], zone: TimeZone): Block[] {
  switch (view.kind) {
    case 'reading':
      return [note(`${TAB}:note`, 'Reading the team…')]
    case 'no-team':
      return [note(`${TAB}:note`, "No team found: the Team tab shows the tree of teams the session's team is in.")]
    case 'failed':
      return [single(`${TAB}:note`, [{ text: `The team could not be read: ${view.reason.replace(/\.$/, '')}.`, color: 'warning' }])]
    case 'tree': {
      if (view.root === null) return [note(`${TAB}:note`, 'No team tree: the team has no config file teamrig can read, and the tree is read from it.')]
      const keys = new Set(toggled)
      return teamRows(view.root, keys).map(row => rowBlock(row, keys, zone))
    }
  }
}

/** `toggled` with `key` flipped: a press on a node opens a closed one and closes an open one. */
export function toggledWith(toggled: readonly string[], key: string): string[] {
  return toggled.includes(key) ? toggled.filter(shown => shown !== key) : [...toggled, key]
}
