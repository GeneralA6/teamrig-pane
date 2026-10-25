// The Team tab's search (T780): the sessions of the team tree (team.ts) a query names, on the shared search
// (search.ts). A word matches the start of a word in a session's id, its name, a former name, its role words as its
// row draws them (team-card.ts roleWords) or its hire's scope. Every session ever on a team of the tree is searched,
// the retired ones too, and every match is kept, in the tree's order: a roster is small enough to show whole. Pure.
import { SEPARATOR } from './rows'
import { matchRows, type Hit, type SearchSpec } from './search'
import type { SessionFacts, SessionNode, TeamTreeNode } from './team'
import { roleWords } from './team-card'

/** The Team search's key: its results are keyed `team-search:<node key>`, its own lines `team-search-count` and the like. */
export const TEAM_SEARCH_VIEW = 'team-search'

/** The fields a word can match the start of a word in. */
export const TEAM_SEARCHED = ['id', 'name', 'former', 'role', 'scope'] as const
export type TeamSearchedField = (typeof TEAM_SEARCHED)[number]

/**
 * A field's text as it is searched and drawn: the former names joined by `, `, the role words by the row's separator;
 * null when the session has none, and for the name when it is the id, which its row does not repeat.
 */
export function teamFieldText(session: SessionFacts, field: TeamSearchedField): string | null {
  switch (field) {
    case 'id':
      return session.id
    case 'name':
      return session.name === session.id ? null : session.name
    case 'former':
      return session.formerNames.length === 0 ? null : session.formerNames.join(', ')
    case 'role': {
      const words = roleWords(session)
      return words.length === 0 ? null : words.join(SEPARATOR.text)
    }
    case 'scope':
      return session.hire?.scope ?? null
  }
}

/** A session's node is searched by the TEAM_SEARCHED fields. No id: a spec's id matches whole ids only, and a session's id matches as a field does, by the start of its words. */
const TEAM_SEARCH: SearchSpec<SessionNode, TeamSearchedField> = {
  fields: TEAM_SEARCHED.map(name => ({ name, text: (node: SessionNode) => teamFieldText(node.session, name) })),
}

/** A session the query names, with where its words matched. */
export type SessionHit = Hit<SessionNode, TeamSearchedField>

/** The session nodes under `node`, it too, depth first: the tree's order. */
function sessionsOf(node: TeamTreeNode): SessionNode[] {
  const below = node.children.flatMap(sessionsOf)
  return node.kind === 'session' ? [node, ...below] : below
}

/** The sessions of the tree `query` names, in the tree's order; none for a blank query or no tree. */
export function searchTeam(root: TeamTreeNode | null, query: string): SessionHit[] {
  return root === null ? [] : matchRows(sessionsOf(root), query, TEAM_SEARCH)
}
