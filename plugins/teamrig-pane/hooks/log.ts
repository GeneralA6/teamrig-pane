// Read side of the task register: its append-only files are
// parsed, renamed and folded by the register's own modules, copied into ./core by
// scripts/sync-core.ts, so every event type and status the register writes reads here too (T217).
// This file only maps a folded task to the row the pane draws, and reads the inbox read marks.
// Lines the register itself cannot read (a torn or hand-edited line) are counted and skipped.
import type { Cut, NoteLine, RelatedTask, ShownStatus, TaskKind, TaskRow, TaskStatus } from '../types'
import { sizeFactText, sizeOf } from './core/estimates'
import { asString, isRecord } from './core/guards'
import type { TaskEvent } from './core/events'
import { fold, type Task } from './core/fold'
import { isSession, type TaskKind as CoreKind, type TaskStatus as CoreStatus } from './core/model'
import { currentNames, SessionNames, type AliasRecord } from './core/names'
import { PauseRules, type PauseLogRecord } from './core/pauses'
import { tokenRates, type UsageRun } from './core/rates'
import { markers, shown, type ShownStatus as CoreShown, type View } from './core/shown'

/** True only when A and B are the same union. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
// The plugin contract (types/index.d.ts) cannot import, so it spells the status and kind unions out:
// these fail a typecheck (an editor, tsc) the day the register adds a value the contract does not
// have, or drops one. `claude plugin test` does not typecheck, so tests/logic.test.ts checks the
// statuses at run time.
export const STATUS_CONTRACT_MATCHES: Same<TaskStatus, CoreStatus> = true
export const SHOWN_CONTRACT_MATCHES: Same<ShownStatus, CoreShown> = true
export const KIND_CONTRACT_MATCHES: Same<TaskKind, CoreKind> = true

/** Most progress notes an expanded task shows, newest first: the register's `show` has the rest. */
export const NOTES_SHOWN = 3
/** Most sub-tasks an expanded task names, one line each. */
export const CHILDREN_SHOWN = 8

/** One `inbox read`: which Claude session read which area's inbox up to which line. */
export type InboxMark = { area: string; line: number; at: string; claudeSession: string | null }

export type Parsed<T> = { records: T[]; skipped: number }

/** The register's logs as parsed: the events, the session renames and the pauses; and the newest usage run (usage.ts). */
export type RegisterLogs = {
  events: readonly TaskEvent[]
  aliases: readonly AliasRecord[]
  pauses: readonly PauseLogRecord[]
  usage: UsageRun | null
}

/** null for null/absent, undefined for a wrong type. */
function nullableText(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null
  return asString(value)
}

export function parseMark(raw: unknown): InboxMark | null {
  if (!isRecord(raw)) return null
  const area = asString(raw.area)
  const at = asString(raw.at)
  const line = raw.line
  const claudeSession = nullableText(raw.claudeSession)
  if (area === undefined || !isSession(area) || at === undefined || claudeSession === undefined) return null
  if (typeof line !== 'number' || !Number.isInteger(line) || line < 0) return null
  return { area, line, at, claudeSession }
}

/** Splits JSONL text and keeps the lines `parse` accepts; blank lines are not counted. */
export function parseJsonl<T>(content: string, parse: (raw: unknown) => T | null): Parsed<T> {
  const records: T[] = []
  let skipped = 0
  for (const line of content.split('\n')) {
    if (line.trim() === '') continue
    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch {
      skipped++
      continue
    }
    const record = parse(raw)
    if (record === null) skipped++
    else records.push(record)
  }
  return { records, skipped }
}

function cut<T>(items: readonly T[], max: number): Cut<T> {
  return { items: items.slice(0, max), more: Math.max(0, items.length - max) }
}

/** The tasks with these ids, by task number, each with its shown status; an id naming no task is left out. */
function related(view: View, ids: readonly string[]): RelatedTask[] {
  return ids
    .flatMap(id => {
      const task = view.register.tasks.get(id)
      return task === undefined ? [] : [{ id, shown: shown(view, task).status, title: task.title }]
    })
    .sort((a, b) => taskNumber(a) - taskNumber(b))
}

/** A task as the pane draws it: the folded task, its shown status and list markers as the register's `list` gives them. */
function rowOf(view: View, task: Task): TaskRow {
  const seen = shown(view, task)
  const { graph } = view.register
  const newestFirst = [...graph.notes(task.id)].reverse().map((n): NoteLine => ({ at: n.at, by: n.by, text: n.text }))
  const parentId = graph.targets(task.id, 'parent')[0]
  return {
    id: task.id,
    title: task.title,
    owner: task.owner,
    tier: task.tier,
    due: task.due,
    status: task.status,
    shown: seen.status,
    markers: markers(view, task, seen),
    holds: seen.blockers.map(b => (b.kind === 'task' ? b.id : `${b.wait.on}: ${b.wait.what}`)),
    pause: seen.pause === null ? null : `${seen.pause.id}: ${seen.pause.note}`,
    note: task.note,
    evidence: task.evidence,
    notes: cut(newestFirst, NOTES_SHOWN),
    detail: task.detail,
    source: task.source,
    ref: task.ref,
    goals: task.goals,
    createdBy: task.createdBy,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    assignedAt: task.assignedAt,
    ownerSeenAt: task.ownerSeenAt,
    kind: task.kind,
    labels: task.labels,
    start: task.start,
    eta: task.eta,
    dueRevisions: task.dueRevisions,
    etaRevisions: task.etaRevisions,
    startedAt: task.startedAt,
    doneAt: task.doneAt,
    estimate: sizeFactText(sizeOf(view, task), task.estInitial),
    evidenceDue: task.evidenceDue,
    parent: parentId === undefined ? null : (related(view, [parentId])[0] ?? null),
    children: cut(related(view, graph.sources(task.id, 'parent')), CHILDREN_SHOWN),
    blockedBy: related(view, graph.targets(task.id, 'blocked-by')),
    waits: graph.waits(task.id).flatMap(w => (w.resolved === null ? [{ on: w.on, what: w.what }] : [])),
  }
}

/**
 * The register folded as its own read commands fold it: old session names read as current ones, the pauses in force
 * applied, each estimate also a share of a fleet week when the usage run is fresh at `now`; ordered by task number.
 */
export function readTasks(logs: RegisterLogs, now: number): TaskRow[] {
  const names = new SessionNames(logs.aliases)
  const events = logs.events.map(e => currentNames(e, names))
  const register = fold(events)
  // A stale or missing run leaves rates null: each estimate reads in its own unit (register v2 design §14). The pane
  // reads no status-line snapshot, so the weekly % left is unknown: no estimate text uses it.
  const rates = tokenRates({ run: logs.usage, week: null }, events, new Date(now))
  const view: View = { register, pauses: new PauseRules(logs.pauses, names), rates: rates.kind === 'fresh' ? rates.rates : null }
  return [...register.tasks.values()].map(task => rowOf(view, task)).sort((a, b) => taskNumber(a) - taskNumber(b))
}

export function taskNumber(task: Pick<TaskRow, 'id'>): number {
  return Number(task.id.slice(1))
}

/** The area this Claude session last ran `inbox read` for (the register's inbox hook binds the same way). */
export function areaOfSession(marks: readonly InboxMark[], claudeSession: string): string | null {
  let area: string | null = null
  for (const mark of marks) if (mark.claudeSession === claudeSession) area = mark.area
  return area
}

/** The area's newest read-to line; undefined when it never ran `inbox read`. */
export function readTo(marks: readonly InboxMark[], area: string): number | undefined {
  let line: number | undefined
  for (const mark of marks) if (mark.area === area) line = mark.line
  return line
}

/** Inbox lines as inbox-store.ts counts them: non-empty lines. */
export function countInboxLines(content: string): number {
  return content.split('\n').filter(l => l.trim() !== '').length
}

/** Unread lines past the mark; a file shorter than its mark was rewritten, so all of it is unread. */
export function unreadLines(lines: number, mark: number | undefined): number | null {
  if (mark === undefined) return null
  return lines < mark ? lines : lines - mark
}
