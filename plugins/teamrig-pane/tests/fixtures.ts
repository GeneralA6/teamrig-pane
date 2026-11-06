// Register lines shaped as teamrig writes them (events v2, inbox marks v1), and an in-memory `Files`.
import { DEFAULT_FOCUS, DEFAULT_REGISTER, EVENT_VERSION, MARK_VERSION, TimeZone } from '../hooks/core/read/index'
import { GOAL_RECORD_VERSION } from '../hooks/core/register/goals'
import { lineHash } from '../hooks/line-hash'
import { treeOf, type PaneTree } from '../hooks/meta'
import type { FileStamp, Files, GoalSource } from '../hooks/source'
import { NO_TASK_COUNTS } from '../hooks/task-counts'
import { zoneNamed, type Clock } from '../hooks/zone'
import type { DrawnSettings, GoalRanks, Snapshot, TaskRow, TeamLeads, TeamSettings, WaitRow } from '../types'

export const NOW = Date.UTC(2026, 9, 13, 14, 0)
export const HOUR = 3_600_000
/** teamrig's default hours before an untouched task reads NOT PICKED UP, for a team whose config sets none. */
export const NOT_PICKED_UP_HOURS = DEFAULT_REGISTER.check.notPickedUpAfterHours

/** What a snapshot carries of a team config that sets neither the hours, a zone nor an owner marker, on a machine whose zone is UTC. */
export const SNAPSHOT_SETTINGS: DrawnSettings = {
  notPickedUpAfterHours: NOT_PICKED_UP_HOURS,
  timeZone: TimeZone.UTC.name,
  ownerSource: DEFAULT_REGISTER.ownerSource,
  focus: DEFAULT_FOCUS,
}
/** What a team whose config sets none of the pane's settings reads with, on a machine whose zone is UTC. */
export const TEAM_SETTINGS: TeamSettings = { ...SNAPSHOT_SETTINGS, requireDecisionCard: DEFAULT_REGISTER.requireDecisionCard }
/**
 * A snapshot's team fields when the pane found no team, on an empty register: no team name, no session name, no leads,
 * no work marks, no goals, no cards on the owner and no tasks counted.
 */
export const NO_TEAM: Pick<Snapshot, 'team' | 'areaName' | 'leads' | 'work' | 'goals' | 'ownerCards' | 'taskCounts'> = {
  team: null,
  areaName: null,
  leads: null,
  work: [],
  goals: {},
  ownerCards: {},
  taskCounts: NO_TASK_COUNTS,
}

/** A tree that holds no goals and never moves: a source whose test is not about them. */
export const NO_TREE_GOALS: GoalSource = { refresh: async () => false, current: {} }

/** A goal's first record, as `teamrig goal add` writes it. */
export function goalLine(tag: string, parent: string | null = null): string {
  return JSON.stringify({ v: GOAL_RECORD_VERSION, type: 'goal-add', at: iso(NOW), by: 'lead', tag, title: `goal ${tag}`, start: '2026-10-01', target: '2026-12-01', parent })
}

/** A goal's new title, as `teamrig goal set` writes it: the target stays. */
export function goalTitleLine(tag: string, title: string): string {
  return JSON.stringify({ v: GOAL_RECORD_VERSION, type: 'goal-set', at: iso(NOW), by: 'lead', tag, target: null, title, note: 'renamed' })
}

/** A goal's rank, as `teamrig goal rank` writes it; null takes it off the ranking. */
export function goalRankLine(tag: string, rank: number | null): string {
  return JSON.stringify({ v: GOAL_RECORD_VERSION, type: 'goal-rank', at: iso(NOW), by: 'lead', tag, rank })
}

/** A team zone ahead of UTC, three hours on NOW (Israel's summer time, `IDT`): what a UTC clock cannot tell apart. */
export const JERUSALEM = zoneNamed('Asia/Jerusalem')

/**
 * An inbox file (hooks/inbox.ts) read up to INBOX_UNREAD_FROM: on NOW, a read line past the last 24 hours, a read line
 * and a line with no sender inside them, an unread line of the day before and an unread line of the last hour.
 */
export const INBOX_LINES: readonly string[] = [
  '- 2026-10-12 09:00 lead: read a day ago',
  '- 2026-10-13 10:00 docs: read today',
  '- 2026-10-13 12:30 a note with no sender',
  '- 2026-10-12 11:00 qa: unread since yesterday',
  '- 2026-10-13 13:00 lead: ship T772: the Inbox view',
]
/** The index of INBOX_LINES' first line past the read mark. */
export const INBOX_UNREAD_FROM = 3

/**
 * The tree of `tasks` at `now`, for a team whose config sets `notPickedUpAfterHours` (teamrig's default when unset)
 * and the zone named `timeZone` (UTC unless given), with `leads` and `goals` (none read unless given).
 */
export function treeAt(
  tasks: readonly TaskRow[],
  now: number,
  notPickedUpAfterHours = NOT_PICKED_UP_HOURS,
  timeZone = TimeZone.UTC.name,
  leads: TeamLeads | null = null,
  goals: GoalRanks = {},
): PaneTree {
  return treeOf({ tasks, now, notPickedUpAfterHours, timeZone, leads, focus: DEFAULT_FOCUS, ownerSource: DEFAULT_REGISTER.ownerSource, goals })
}

/** The clock at `now` in `zone`, UTC unless given. */
export function clockAt(now: number, zone: TimeZone = TimeZone.UTC): Clock {
  return { now, zone }
}

export function iso(ms: number): string {
  return new Date(ms).toISOString()
}

/** Claude session ids, as teamrig records them on an inbox mark: a mark naming anything else is unreadable. */
export const S1 = '00000000-0000-4000-8000-000000000001'
export const S2 = '00000000-0000-4000-8000-000000000002'
export const S3 = '00000000-0000-4000-8000-000000000003'

type CreateOptions = {
  owner: string
  by: string
  at: number
  priority?: number
  due?: string | null
  title?: string
  /** What the task is and why (`--description`); left off the line when not given, as teamrig leaves a null one. */
  description?: string
  source?: string
  /** null: a task with no ref (`--ref none`). */
  ref?: string | null
  goals?: string[]
  /** null: a task planned for no week. */
  week?: string | null
  /** Keys a later teamrig adds, on the line and in its task; this reader knows none of them. */
  lineKeys?: Record<string, unknown>
  taskKeys?: Record<string, unknown>
}

export function createLine(id: string, o: CreateOptions): string {
  return JSON.stringify({
    v: EVENT_VERSION,
    type: 'create',
    id,
    at: iso(o.at),
    by: o.by,
    task: {
      title: o.title ?? `task ${id}`,
      ...(o.description === undefined ? {} : { description: o.description }),
      owner: o.owner,
      source: o.source ?? 'owner',
      ref: o.ref === undefined ? 'docs/x.md' : o.ref,
      priority: o.priority ?? 3,
      due: o.due ?? null,
      goals: o.goals ?? ['G10.2'],
      week: o.week === undefined ? '2026-10-13' : o.week,
      ...o.taskKeys,
    },
    ...o.lineKeys,
  })
}

export function statusLine(
  id: string,
  by: string,
  at: number,
  status: string,
  note: string | null = null,
  evidence: string | null = null,
  skill: string | null = null,
): string {
  return JSON.stringify({ v: EVENT_VERSION, type: 'status', id, at: iso(at), by, status, note, evidence, skill })
}

/** A status line to `verifying` with what proves it, as `teamrig set --status verifying --proof` writes it. */
export function verifyingLine(id: string, by: string, at: number, proof: string, note: string | null = null, evidence: string | null = null): string {
  return JSON.stringify({ v: EVENT_VERSION, type: 'status', id, at: iso(at), by, status: 'verifying', note, evidence, skill: null, proof })
}

/** A decision card as `teamrig set --question --options --recommend --default [--gate]` writes it beside a wait. */
export type CardFields = { question: string; options: readonly string[]; recommend: string; byDefault: string; gate?: string }

/** A status line to `waiting` with its typed reasons, as `teamrig set --waits` writes it, with its card when given. */
export function waitingLine(id: string, by: string, at: number, waits: readonly WaitRow[], note: string | null = null, card: CardFields | null = null): string {
  return JSON.stringify({ v: EVENT_VERSION, type: 'status', id, at: iso(at), by, status: 'waiting', note, evidence: null, skill: null, waits, ...(card === null ? {} : { card }) })
}

export function updateLine(id: string, by: string, at: number, changes: Record<string, unknown>, note: string | null = null): string {
  return JSON.stringify({ v: EVENT_VERSION, type: 'update', id, at: iso(at), by, changes, note })
}

/** An `inbox read` mark: `line` lines read, the last of them `lastLine` (null: a mark that read none). */
export function markLine(area: string, line: number, claudeSession: string, at: number, lastLine: string | null = null): string {
  const lastLineHash = lastLine === null ? null : lineHash(lastLine)
  return JSON.stringify({ v: MARK_VERSION, area, line, at: iso(at), claudeSession, lastLineHash })
}

/** A fake disk: `write` moves the stamp the way an append does; reads are counted. */
export class MemoryFiles implements Files {
  private readonly content = new Map<string, string>()
  private readonly stamps = new Map<string, FileStamp>()
  readonly reads: string[] = []
  /** When set, the next read throws this message (a locked or half-written file). */
  failNextRead: string | null = null
  private clock = 1

  write(path: string, text: string): void {
    this.content.set(path, text)
    this.stamps.set(path, { mtimeMs: this.clock++, size: text.length })
  }

  /** The file deleted: it stamps null and its read throws. */
  remove(path: string): void {
    this.content.delete(path)
    this.stamps.delete(path)
  }

  async stamp(path: string): Promise<FileStamp | null> {
    return this.stamps.get(path) ?? null
  }

  async read(path: string): Promise<string> {
    this.reads.push(path)
    const failure = this.failNextRead
    this.failNextRead = null
    if (failure !== null) throw new Error(failure)
    const text = this.content.get(path)
    if (text === undefined) throw new Error(`ENOENT: ${path}`)
    return text
  }
}

const FLEET = ['po', 'lead', 'etl', 'security', 'analytics', 'symbols', 'toolchain', 'teamrig', 'api', 'webstore']

/**
 * A register of `events` lines as a month of a ten-session fleet leaves it: each task created, started,
 * noted and re-dated, nine in ten then done. The tenth left active falls to `po`, so its area is the
 * biggest list a pane draws (a tenth of the tasks).
 */
export function bigRegister(events: number): string[] {
  const lines: string[] = []
  for (let n = 1; lines.length < events; n++) {
    const id = `T${n}`
    const owner = FLEET[n % FLEET.length] ?? 'po'
    const at = NOW - 30 * 24 * HOUR + n * 60_000
    lines.push(createLine(id, { owner, by: 'lead', at, title: `Task ${n} with a title of a usual length for the register`, ref: 'board/inbox/po.md:12' }))
    lines.push(statusLine(id, owner, at + HOUR, 'in-progress'))
    lines.push(statusLine(id, owner, at + 2 * HOUR, 'in-progress', 'a progress note of usual length'))
    lines.push(updateLine(id, owner, at + 3 * HOUR, { due: '2026-10-20' }))
    if (n % FLEET.length !== 0) lines.push(statusLine(id, owner, at + 4 * HOUR, 'done', 'shipped', 'abc1234', 'none'))
  }
  return lines.slice(0, events)
}
