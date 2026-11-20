// The documents of `teamrig read` as interface 1.0 serves them, for the specs of what reads them
// (document-source.test.ts) and for the fake teamrig that answers a run from a register's files (fake-read.ts): one
// builder per document and per row, the words a run was asked with, and a run's answer or refusal (T4742).
import type { JsonRecord } from '../hooks/read-document'
import type { CliRun } from '../hooks/teamrig-cli'
import { HOUR, NOW } from './fixtures'

export const AN_HOUR_AGO = new Date(NOW - HOUR).toISOString()

/** A task as interface 1.0 serves it, open and owned by api. */
export function task(id: string, over: JsonRecord = {}): JsonRecord {
  return {
    id,
    title: { text: `Title of ${id}`, source: 'team' },
    description: null,
    owner: 'api',
    priority: 2,
    type: 'task',
    critical: false,
    due: null,
    status: 'open',
    note: null,
    proof: null,
    evidence: null,
    skill: null,
    statusAt: AN_HOUR_AGO,
    source: { kind: 'session', id: 'lead', name: 'shop-lead' },
    ref: null,
    goals: [],
    week: null,
    size: null,
    pin: null,
    workClass: null,
    createdBy: 'lead',
    createdAt: AN_HOUR_AGO,
    updatedAt: AN_HOUR_AGO,
    updatedBy: 'lead',
    priorityAt: AN_HOUR_AGO,
    assignedAt: AN_HOUR_AGO,
    ownerSeenAt: null,
    waits: [],
    answer: null,
    decided: null,
    after: [],
    ...over,
  }
}

export function tasksDocument(revision: string, tasks: readonly JsonRecord[], over: JsonRecord = {}): JsonRecord {
  return { interface: '1.0', document: 'tasks', revision, problems: [], tasks, cuts: [], ...over }
}

/** A session of team shop as interface 1.0 serves it, led by `leader`. */
export function session(id: string, leader: string | null, over: JsonRecord = {}): JsonRecord {
  return {
    team: 'shop',
    id,
    name: `shop-${id}`,
    formerNames: [],
    roles: leader === null ? ['lead'] : [],
    leader,
    ledBy: leader === null ? [] : [leader],
    leads: leader === null ? 2 : 0,
    active: true,
    launch: null,
    hire: null,
    rehiredFrom: null,
    retire: null,
    unread: 0,
    state: 'idle',
    ask: null,
    since: AN_HOUR_AGO,
    host: null,
    conversation: null,
    ...over,
  }
}

export const TEAM_SESSIONS = [session('lead', null), session('api', 'lead'), session('web', 'lead')]

export function sessionsDocument(revision: string, over: JsonRecord = {}): JsonRecord {
  return {
    interface: '1.0',
    document: 'sessions',
    revision,
    problems: [],
    self: { team: 'shop', session: 'api' },
    teams: [{ id: 'shop', parent: null, active: 3, retired: 0 }],
    sessions: TEAM_SESSIONS,
    failures: [],
    cuts: [],
    ...over,
  }
}

export function inboxDocument(revision: string, id: string, over: JsonRecord = {}): JsonRecord {
  return {
    interface: '1.0',
    document: 'inbox',
    revision,
    problems: [],
    session: { id, name: `shop-${id}` },
    unread: 1,
    lines: [{ key: `${id}-1`, at: AN_HOUR_AGO, from: 'lead', text: { text: `a line for ${id}`, source: 'team' }, unread: true }],
    cuts: [],
    ...over,
  }
}

/** Every setting the pane draws with, each with a value the fold's settings do not hold. */
export const SERVED_SETTINGS: readonly (readonly [string, unknown])[] = [
  ['register.ownerSource', 'boss'],
  ['register.requireDecisionCard', false],
  ['register.check.notPickedUpAfterHours', 36],
  ['focus.defaultClass', 'Improvements'],
  ['focus.roadmapClass', 'Roadmap'],
  ['focus.maintenanceClass', 'Upkeep'],
  ['focus.parkAfterDays', 9],
  ['focus.score.rankValues', [100, 80, 60]],
  ['focus.score.roadmapUnranked', 41],
  ['focus.score.maintenanceValue', 42],
  ['focus.score.maintenanceBug', 43],
  ['focus.score.maintenanceCritical', 44],
  ['focus.score.improvementsValue', 45],
  ['focus.score.overdueValue', 46],
  ['focus.score.dueSoonValue', 47],
  ['focus.score.dueSoonDays', 3],
  ['focus.score.unblocksShare', 0.25],
  ['focus.score.ownerOrderValues', [140, 120]],
  ['focus.score.defaultSizePct', 2.5],
  ['focus.score.minSizePct', 0.5],
  ['focus.expedite.critical', true],
  ['focus.expedite.ownerP1', false],
]

/** The `config` document's rows for `settings`, each key at its own value with no problem. */
export function settingRows(settings: readonly (readonly [string, unknown])[]): JsonRecord[] {
  return settings.map(([path, value]) => ({ path, value, default: value, problem: null }))
}

export function configDocument(revision: string, over: JsonRecord = {}): JsonRecord {
  return {
    interface: '1.0',
    document: 'config',
    revision,
    problems: [],
    team: 'shop',
    teams: [],
    timeZone: 'Asia/Jerusalem',
    settings: settingRows(SERVED_SETTINGS),
    cuts: [],
    ...over,
  }
}

/** One run as the fake teamrig was asked it. */
export type Asked = { documents: readonly string[]; session: string | null; unless: string | null; conversation: string | null }

export function askedOf(argv: readonly string[]): Asked {
  const words = argv.slice(argv.indexOf('read') + 1)
  const flag = (name: string): string | null => {
    const at = words.indexOf(name)
    return at < 0 ? null : (words[at + 1] ?? null)
  }
  return { documents: words.slice(0, words.indexOf('--json')), session: flag('--session'), unless: flag('--unless'), conversation: flag('--conversation') }
}

export function printed(...documents: readonly JsonRecord[]): CliRun {
  return { exitCode: 0, stdout: documents.map(document => JSON.stringify(document)).join('\n'), stderr: '', isStdoutTruncated: false }
}

export function refused(why: string): CliRun {
  return { exitCode: 2, stdout: '', stderr: `REFUSED ${why}`, isStdoutTruncated: false }
}
