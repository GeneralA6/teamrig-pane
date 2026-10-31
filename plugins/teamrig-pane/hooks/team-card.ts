// The card a session's row opens on the Team tab (team-rows.ts, T780): what the team's files say of the session, one
// labelled row per fact (card.ts labelled), each only when it has a value. Role: its roles and how many sessions it
// leads, or the area it owns. Led by: its leaders, nearest first. Launch: the model and effort teamrig starts it on
// (describeLaunch). Hired or Rehired: the day, who hired it and the day its hire is reviewed; Scope and Reason: its job
// and why. Now: its tasks in progress, each id a press that opens the task's page, when the pane reads its team's
// register. Decisions: its cards waiting on the owner now, and Later: those the owner put off, each with when it comes
// back, soonest first (owner-cards.ts), each id a press that opens the task's page, when the pane reads its team's
// register and it has any (T1297). Inbox: its unread lines, a press that opens its inbox at the first of them, when
// the pane reads its team's inbox and it ever marked it read. A closed session's card is its retire instead: the day
// and who retired it, why, the session its tasks went to (Heir), and its Handover, a press that opens the file, or why
// it left none. Each line starts with the guide its row hands it. Days print on the team's clock (meta.ts dayWords).
// Pure.
import { describeLaunch, type TimeZone } from './core/read/index'
import { joined, labelled, textLines, type Lines } from './card'
import { fileLabel } from './details'
import { dayWords, storedDayWords } from './meta'
import type { Row, Span } from './rows'
import type { Role, SessionFacts } from './team'

/** A fact a session's card shows on its labelled row, named as its row's key ends. */
export type TeamCardField = 'role' | 'led-by' | 'launch' | 'hire' | 'scope' | 'reason' | 'now' | 'decisions' | 'later' | 'inbox' | 'retired' | 'heir' | 'handover'

/** How the tab names each role a team config gives. */
const ROLE_WORDS: Readonly<Record<Role, string>> = { lead: 'lead', deliveryOwner: 'delivery owner', securityReviewer: 'security reviewer' }

/** A card names no task by its words: its tasks are the Now row's, each a span of its own. */
const NO_IDS = (): boolean => false

/** A session's roles in the tab's words; none for a session the team config gives no role. */
export function roleWords(session: SessionFacts): string[] {
  return session.roles.map(role => ROLE_WORDS[role])
}

/** Its Role row's parts: its roles, then how many sessions it leads when it leads any. */
function roleParts(session: SessionFacts): string[] {
  const parts = roleWords(session)
  if (session.leads > 0) parts.push(`leads ${session.leads} ${session.leads === 1 ? 'session' : 'sessions'}`)
  return parts
}

/** Its tasks in progress, an id a press each; a dim note for none; nothing when its team's register is not read. */
function nowLines(now: SessionFacts['now']): Lines {
  if (now === null) return []
  if (now.length === 0) return [[{ text: 'nothing in progress', dim: true }]]
  return now.map(task => [{ text: task.id, task: task.id }, { text: ` ${task.title}` }])
}

/** Its cards waiting on the owner now, an id a press each; nothing for none or when its team's register is not read. */
function decisionLines(decisions: SessionFacts['decisions']): Lines {
  return (decisions?.due ?? []).map(card => [{ text: card.id, task: card.id }, { text: ` ${card.title}` }])
}

/** The cards the owner put off, soonest back first, an id a press each and when it comes back; nothing for none. */
function laterLines(decisions: SessionFacts['decisions']): Lines {
  return (decisions?.later ?? []).map(card => [{ text: card.id, task: card.id }, { text: ` ${card.title}` }, { text: ` until ${card.until}`, dim: true }])
}

/** Its unread inbox lines as a press that opens its inbox at the first of them; nothing when the count is unknown. */
function inboxLines(session: SessionFacts): Lines {
  const unread = session.unread
  if (unread === null) return []
  return [[{ text: `${unread} unread`, color: unread > 0 ? 'warning' : 'subtle', inbox: { area: session.id, unread } }]]
}

/** The handover a retired session left, a press that opens it, or why it left none. */
function handoverLines(retire: NonNullable<SessionFacts['retire']>): Lines {
  if (retire.handover !== undefined) return [[{ text: fileLabel(retire.handover), file: { file: retire.handover, line: null } }]]
  if (retire.noHandover !== undefined) return [[{ text: `none: ${retire.noHandover}`, dim: true }]]
  return []
}

/** A session's card rows, keyed `team-card:<team>/<id>:<row>`, each line behind `guide`. */
export function sessionCard(session: SessionFacts, guide: Span, zone: TimeZone): Row[] {
  const field = (row: TeamCardField, label: string, lines: Lines) => labelled(`team-card:${session.team}/${session.id}:${row}`, label, lines, NO_IDS, guide)
  const retire = session.retire
  if (retire !== null) {
    return [
      ...field('retired', 'Retired', [[{ text: `${dayWords(retire.at, zone)} by ${retire.by}` }]]),
      ...field('reason', 'Reason', textLines(retire.reason)),
      ...field('heir', 'Heir', textLines(retire.heir ?? null)),
      ...field('handover', 'Handover', handoverLines(retire)),
    ]
  }
  const roles = roleParts(session)
  const hire = session.hire
  return [
    ...field('role', 'Role', [roles.length === 0 ? [{ text: 'area owner' }] : joined(roles.map(text => ({ text })))]),
    ...field('led-by', 'Led by', session.ledBy.length === 0 ? [] : [[{ text: session.ledBy.join(', then ') }]]),
    ...field('launch', 'Launch', session.launch === null ? [] : [[{ text: describeLaunch(session.launch) }]]),
    ...(hire === null
      ? []
      : [
          ...field('hire', session.rehiredFrom === null ? 'Hired' : 'Rehired', [
            joined([{ text: `${dayWords(hire.at, zone)} by ${hire.by}` }, { text: `review ${storedDayWords(hire.reviewBy) ?? hire.reviewBy}` }]),
          ]),
          ...field('scope', 'Scope', textLines(hire.scope)),
          ...field('reason', 'Reason', textLines(hire.reason)),
        ]),
    ...field('now', 'Now', nowLines(session.now)),
    ...field('decisions', 'Decisions', decisionLines(session.decisions)),
    ...field('later', 'Later', laterLines(session.decisions)),
    ...field('inbox', 'Inbox', inboxLines(session)),
  ]
}
