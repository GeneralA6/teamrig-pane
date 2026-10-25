// The Team tab as blocks of rows (rows.ts): the team tree (team.ts) a node a row, depth first, each indented by its
// depth behind a mark that says whether it is open (▾), closed (▸) or has nothing under it. A team's row counts its
// active and closed sessions; a session's row is its mark (● on the team, ○ dim once retired), its id, its name where
// it differs, its roles, how many it leads, its hire or its retire, and its former names, dim; a closed group's row
// counts its sessions. A press on a row with rows under it opens or closes it (`folds`). Days print on the team's
// clock (meta.ts dayWords). Pure.
import type { TeamView } from '../types'
import type { TimeZone } from './core/read/index'
import { dayWords } from './meta'
import { SEPARATOR, single, type Block, type Span } from './rows'
import { teamRows, type Role, type SessionFacts, type TeamRow, type TeamTreeNode } from './team'

const TAB = 'team'
/** The cells each level of the tree indents its rows by, and the open mark's: a child's mark stands under its parent's text. */
const STEP = 2

/** How a row names each role a team config gives. */
const ROLE_WORDS: Readonly<Record<Role, string>> = { lead: 'lead', coordinatorOwner: 'coordinator', securityReviewer: 'security reviewer' }

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
  const parts = session.roles.map(role => ROLE_WORDS[role])
  if (session.leads > 0) parts.push(`leads ${session.leads}`)
  if (session.hire !== null) {
    parts.push(`${session.rehiredFrom === null ? 'hired' : 'rehired'} ${dayWords(session.hire.at, zone)}`, `review ${session.hire.reviewBy.slice(5)}`)
  }
  return parts
}

/** A session's row: its mark, its id (bold on the team), its name where it is not the id, what it does, its former names. */
function sessionSpans(session: SessionFacts, zone: TimeZone): Span[] {
  const isClosed = !session.active
  const spans: Span[] = [
    isClosed ? { text: '○ ', dim: true } : { text: '● ' },
    isClosed ? { text: session.id, dim: true } : { text: session.id, bold: true },
  ]
  if (session.name !== session.id) spans.push({ text: `  ${session.name}`, dim: isClosed })
  for (const part of doesWords(session, zone)) spans.push(SEPARATOR, { text: part, dim: true })
  if (session.formerNames.length > 0) spans.push(SEPARATOR, { text: `formerly ${session.formerNames.join(', ')}`, dim: true })
  return spans
}

/** A node's own words: a team and its counts, a session (sessionSpans), or a closed group and its count. */
function nodeSpans(node: TeamTreeNode, zone: TimeZone): Span[] {
  switch (node.kind) {
    case 'team':
      return [
        { text: node.team.team, bold: true },
        SEPARATOR,
        { text: `${node.team.active} active`, dim: true },
        SEPARATOR,
        { text: `${node.team.closed} closed`, dim: true },
      ]
    case 'session':
      return sessionSpans(node.session, zone)
    case 'closed':
      return [{ text: `closed (${node.children.length})`, dim: true }]
  }
}

/** One row of the tree: indented by its depth, its open mark, its words; its wrapped lines start under its words. */
function rowBlock({ node, depth, open }: TeamRow, zone: TimeZone): Block {
  const indent = depth * STEP
  const spans = [...(indent === 0 ? [] : [blank(indent)]), foldMark(open), ...nodeSpans(node, zone)]
  const block = single(node.key, spans, blank(indent + STEP))
  return open === null ? block : { ...block, folds: node.key }
}

/** The Team tab: the tree's rows, with the nodes in `toggled` opened or closed against their default, or why none show. */
export function teamBlocks(view: TeamView, toggled: readonly string[], zone: TimeZone): Block[] {
  switch (view.kind) {
    case 'reading':
      return [note(`${TAB}:note`, 'Reading the team…')]
    case 'no-team':
      return [note(`${TAB}:note`, "No team found: the Team tab shows the tree of teams the session's team is in.")]
    case 'failed':
      return [single(`${TAB}:note`, [{ text: `The team could not be read: ${view.reason.replace(/\.$/, '')}.`, color: 'warning' }])]
    case 'tree':
      if (view.root === null) return [note(`${TAB}:note`, 'No team tree: the team has no config file teamrig can read, and the tree is read from it.')]
      return teamRows(view.root, new Set(toggled)).map(row => rowBlock(row, zone))
  }
}

/** `toggled` with `key` flipped: a press on a node opens a closed one and closes an open one. */
export function toggledWith(toggled: readonly string[], key: string): string[] {
  return toggled.includes(key) ? toggled.filter(shown => shown !== key) : [...toggled, key]
}
