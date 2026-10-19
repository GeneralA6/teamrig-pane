// Register lines shaped as teamrig writes them (events v2, inbox marks v1), and an in-memory `Files`.
import { DEFAULT_REGISTER, EVENT_VERSION, MARK_VERSION } from '../hooks/core/read/index'
import { lineHash } from '../hooks/line-hash'
import { treeOf, type PaneTree } from '../hooks/meta'
import type { FileStamp, Files } from '../hooks/source'
import type { TaskRow, WaitRow } from '../types'

export const NOW = Date.UTC(2026, 9, 13, 14, 0)
export const HOUR = 3_600_000
/** teamrig's default hours before an untouched task reads NOT PICKED UP, for a team whose config sets none. */
export const NOT_PICKED_UP_HOURS = DEFAULT_REGISTER.check.notPickedUpAfterHours

/** The tree of `tasks` at `now`, for a team whose config sets `notPickedUpAfterHours` (teamrig's default when unset). */
export function treeAt(tasks: readonly TaskRow[], now: number, notPickedUpAfterHours = NOT_PICKED_UP_HOURS): PaneTree {
  return treeOf({ tasks, now, notPickedUpAfterHours })
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

/** A status line to `waiting` with its typed reasons, as `teamrig set --waits` writes it. */
export function waitingLine(id: string, by: string, at: number, waits: readonly WaitRow[], note: string | null = null): string {
  return JSON.stringify({ v: EVENT_VERSION, type: 'status', id, at: iso(at), by, status: 'waiting', note, evidence: null, skill: null, waits })
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
