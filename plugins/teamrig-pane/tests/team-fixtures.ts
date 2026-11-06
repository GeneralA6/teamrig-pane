// Teams as teamrig's readers hand them to the Teams tab's model (hooks/team.ts): a root team with a sub-lead, hires,
// retires and renames, its child team, and another root team; none with a week file, which weekFile makes.
import type { TaskCounts, TaskRow } from '../types'
import { parseConfigText, readRegister, type HireRecord, type KitConfig, type Rename, type RetireRecord, type TeamWeekSummary } from '../hooks/core/read/index'
import { rowOf } from '../hooks/log'
import { taskCountsOf } from '../hooks/task-counts'
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

/** The account's week resets three days after NOW, so NOW is 4 days into it: 57% of the week. */
export const WEEK_RESET = NOW + 72 * HOUR

/**
 * A team's week file: its used and planned part of `account`'s week, for the week that resets at `resetsAt`. A default
 * parameter fires on undefined, so a format 1 file, which names no account, is `{ ...weekFile(1, 2), account: undefined }`.
 */
export function weekFile(usedPct: number, plannedPct: number, resetsAt = WEEK_RESET, account = 'acme-account'): TeamWeekSummary {
  return { account, usedPct, plannedPct, accountUsedPct: 70, resetsAt, at: NOW - HOUR, limits: [] }
}

/** The register's tasks after `lines`, as the pane lists them. */
export function tasksOf(...lines: string[]): TaskRow[] {
  return [...readRegister(lines.join('\n')).state.tasks.values()].map(task => rowOf(task))
}

/** The register's tasks after `lines`, counted by owner as the pane's snapshot counts them, none archived. */
export function countsOf(...lines: string[]): TaskCounts {
  return taskCountsOf(readRegister(lines.join('\n')).state.tasks.values(), false)
}

/** acme's register: api works T1, has T2 open, finished T8 and shipped T9; web works T3; T10 was web's, dropped. */
const ACME_REGISTER = [
  createLine('T1', { at: NOW - 10 * HOUR, by: 'lead', owner: 'api', title: 'Add the route' }),
  statusLine('T1', 'api', NOW - 9 * HOUR, 'in-progress'),
  createLine('T2', { at: NOW - 10 * HOUR, by: 'lead', owner: 'api', title: 'Open, not started' }),
  createLine('T3', { at: NOW - 10 * HOUR, by: 'lead', owner: 'web', title: 'Plan the page' }),
  statusLine('T3', 'web', NOW - 8 * HOUR, 'in-progress'),
  createLine('T8', { at: NOW - 20 * HOUR, by: 'lead', owner: 'api', title: 'Set up the repo' }),
  statusLine('T8', 'api', NOW - 18 * HOUR, 'done'),
  createLine('T9', { at: NOW - 20 * HOUR, by: 'lead', owner: 'api', title: 'Ship the login' }),
  statusLine('T9', 'api', NOW - 17 * HOUR, 'verifying'),
  createLine('T10', { at: NOW - 20 * HOUR, by: 'lead', owner: 'web', title: 'An old idea' }),
  statusLine('T10', 'web', NOW - 19 * HOUR, 'dropped'),
]

/** acme's register counted by owner: api 1 done and 1 verifying of 4, web 1, its dropped one counted nowhere. */
export const ACME_COUNTS = countsOf(...ACME_REGISTER)

/**
 * Team acme: lead over web and ops, web a sub-lead over api and ui; ops the security reviewer. ui was hired, and
 * launches on its own model and effort; qa was hired, renamed and retired; ops was hired, retired and hired again. api
 * was renamed acme-backend. api owns 4 tasks, web 1 and a dropped one (ACME_REGISTER). api has 2 unread inbox lines,
 * lead none, ui never marked its inbox read. api has a card due on the owner, web one put off; qa's card stays from
 * before its retire.
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
  week: null,
  tasks: tasksOf(...ACME_REGISTER),
  unread: new Map([
    ['api', 2],
    ['lead', 0],
    ['qa', 1],
  ]),
  ownerCards: {
    api: { due: [{ id: 'T4', title: 'Pick the database' }], later: [] },
    web: { due: [], later: [{ id: 'T5', title: 'Name the release', until: 'Mon 11-02' }] },
    qa: { due: [{ id: 'T6', title: 'Keep the old tests' }], later: [] },
  },
  taskCounts: ACME_COUNTS,
}

/** Team tools, a child team of acme: boss over dev. */
export const TOOLS: TeamRead = {
  team: 'tools',
  config: configOf({ team: { id: 'tools', parent: 'acme' }, sessions: ['boss', 'dev'], roles: { lead: 'boss' } }),
  renames: [],
  hires: [],
  week: null,
  tasks: null,
  unread: null,
  ownerCards: null,
  taskCounts: null,
}

/** Another root team on the machine: another project. */
export const OTHER: TeamRead = {
  team: 'other',
  config: configOf({ team: { id: 'other' }, sessions: ['lead'], roles: { lead: 'lead' } }),
  renames: [],
  hires: [],
  week: null,
  tasks: null,
  unread: null,
  ownerCards: null,
  taskCounts: null,
}

/** The tree that holds `own` at `now`, failing the test when there is none. */
export function treeOf(reads: readonly TeamRead[], own: string, now = NOW): TeamTreeNode {
  const tree = teamTree(reads, own, now)
  if (tree === null) throw new Error(`no tree for ${own}`)
  return tree
}
