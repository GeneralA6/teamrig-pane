// Teams as teamrig's readers hand them to the Team tab's model (hooks/team.ts): a root team with a sub-lead, hires,
// retires and renames, its child team, and another root team.
import type { TaskRow } from '../types'
import { parseConfigText, readRegister, type HireRecord, type KitConfig, type Rename, type RetireRecord } from '../hooks/core/read/index'
import { rowOf } from '../hooks/log'
import { teamTree, type TeamRead, type TeamTreeNode } from '../hooks/team'
import { HOUR, NOW, createLine, iso, statusLine } from './fixtures'

/** The config teamrig's parser reads from `json`, failing the test on any issue it finds. */
export function configOf(json: object): KitConfig {
  const read = parseConfigText(JSON.stringify(json))
  if (read.status !== 'loaded' || read.issues.length > 0) throw new Error(`teamrig refuses the config: ${JSON.stringify(read)}`)
  return read.config
}

export function hire(session: string, at: number, extra: Partial<HireRecord> = {}): HireRecord {
  return { kind: 'hire', session, scope: `${session}'s job`, reason: 'more hands', reviewBy: '2026-10-25', by: 'lead', at, ...extra }
}

export function retire(session: string, at: number, extra: Partial<RetireRecord> = {}): RetireRecord {
  return { kind: 'retire', session, reason: 'its job is done', by: 'lead', at, ...extra }
}

export function rename(id: string, from: string, to: string): Rename {
  return { v: 1, id, from, to, at: iso(NOW - 48 * HOUR), by: id }
}

/** The register's tasks after `lines`, as the pane lists them. */
export function tasksOf(...lines: string[]): TaskRow[] {
  return [...readRegister(lines.join('\n')).state.tasks.values()].map(task => rowOf(task))
}

/**
 * Team acme: lead over web and ops, web a sub-lead over api and ui; ops the security reviewer. ui was hired, and
 * launches on its own model and effort; qa was hired, renamed and retired; ops was hired, retired and hired again. api
 * was renamed acme-backend. api has 2 unread inbox lines, lead none, ui never marked its inbox read.
 */
export const ACME: TeamRead = {
  team: 'acme',
  config: configOf({
    team: { id: 'acme' },
    sessions: ['lead', 'web', 'api', 'ui', 'ops'],
    roles: { lead: 'lead', securityReviewer: 'ops' },
    leads: { web: ['api', 'ui'] },
    launch: { ui: { model: 'claude-opus-5-5', effort: 'xhigh' } },
  }),
  renames: [rename('api', 'acme-api', 'acme-backend'), rename('qa', 'acme-qa', 'acme-tester')],
  hires: [
    hire('ui', NOW - 96 * HOUR, { model: 'claude-opus-5-5', effort: 'xhigh' }),
    hire('qa', NOW - 90 * HOUR),
    hire('ops', NOW - 80 * HOUR),
    retire('ops', NOW - 70 * HOUR, { handover: 'handover/ops.md' }),
    retire('qa', NOW - 60 * HOUR, { handover: 'handover/qa.md', heir: 'web' }),
    hire('ops', NOW - 50 * HOUR, { scope: 'ops again' }),
  ],
  tasks: tasksOf(
    createLine('T1', { at: NOW - 10 * HOUR, by: 'lead', owner: 'api', title: 'Add the route' }),
    statusLine('T1', 'api', NOW - 9 * HOUR, 'in-progress'),
    createLine('T2', { at: NOW - 10 * HOUR, by: 'lead', owner: 'api', title: 'Open, not started' }),
    createLine('T3', { at: NOW - 10 * HOUR, by: 'lead', owner: 'web', title: 'Plan the page' }),
    statusLine('T3', 'web', NOW - 8 * HOUR, 'in-progress'),
  ),
  unread: new Map([
    ['api', 2],
    ['lead', 0],
    ['qa', 1],
  ]),
}

/** Team tools, a child team of acme: boss over dev. */
export const TOOLS: TeamRead = {
  team: 'tools',
  config: configOf({ team: { id: 'tools', parent: 'acme' }, sessions: ['boss', 'dev'], roles: { lead: 'boss' } }),
  renames: [],
  hires: [],
  tasks: null,
  unread: null,
}

/** Another root team on the machine: another project. */
export const OTHER: TeamRead = {
  team: 'other',
  config: configOf({ team: { id: 'other' }, sessions: ['lead'], roles: { lead: 'lead' } }),
  renames: [],
  hires: [],
  tasks: null,
  unread: null,
}

/** The tree that holds `own`, failing the test when there is none. */
export function treeOf(reads: readonly TeamRead[], own: string): TeamTreeNode {
  const tree = teamTree(reads, own)
  if (tree === null) throw new Error(`no tree for ${own}`)
  return tree
}
