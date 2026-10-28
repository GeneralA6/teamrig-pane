// Who leads whom, for the card's Lead row (card.ts): teamrig's lead tree (core config/lead-tree.ts, T781) read once per
// config change into plain data the pane's state can hold (source.ts), the lead a task's owner answers to, and the
// team's sessions a tab tied to none lists (rows.ts noSessionBlock).
import type { TeamLeads } from '../types'
import { LeadTree, type KitConfig } from './core/read/index'

/** Each session's direct leader under `config`'s lead tree: the sub-lead that lists it, else `roles.lead`; the lead has none. */
export function teamLeads(config: Pick<KitConfig, 'sessions' | 'roles' | 'leads'>): TeamLeads {
  const tree = new LeadTree(config)
  const leaderOf: Record<string, string> = {}
  for (const id of config.sessions) {
    const leader = tree.leaderOf(id)
    if (leader !== undefined) leaderOf[id] = leader
  }
  return { lead: tree.lead, leaderOf }
}

/** The team's sessions: its lead first, then the others in the config's order. */
export function teamSessions(leads: TeamLeads): string[] {
  return [leads.lead, ...Object.keys(leads.leaderOf)]
}

/**
 * The lead who answers for `owner`'s tasks: its direct leader, else the lead, so the lead's own tasks and an owner no
 * longer on the team fall to the lead, as teamrig's approvals do (LeadTree approversOf); null with no team config read.
 */
export function leadOf(owner: string, leads: TeamLeads | null): string | null {
  if (leads === null) return null
  return leads.leaderOf[owner] ?? leads.lead
}

/** Whether two reads name the same lead tree, field by field: a snapshot's state is a copy, never the read itself. */
export function sameLeads(a: TeamLeads | null, b: TeamLeads | null): boolean {
  if (a === null || b === null) return a === b
  const ids = Object.keys(a.leaderOf)
  return a.lead === b.lead && ids.length === Object.keys(b.leaderOf).length && ids.every(id => a.leaderOf[id] === b.leaderOf[id])
}
