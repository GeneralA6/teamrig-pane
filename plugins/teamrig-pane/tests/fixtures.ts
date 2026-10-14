// Register lines shaped as the task register writes them, and an in-memory `Files`.
import type { FileStamp, Files, ListedFile } from '../hooks/source'

export const NOW = Date.UTC(2026, 9, 13, 14, 0)
export const HOUR = 3_600_000

export function iso(ms: number): string {
  return new Date(ms).toISOString()
}

type CreateOptions = {
  owner: string
  by: string
  at: number
  tier?: number
  due?: string | null
  title?: string
  source?: string
  ref?: string
  goals?: string[]
  /** The register's `--detail`; left off the line when absent, as a task without one is written. */
  detail?: string
  /** Keys a later register version adds, on the line and in its task; this reader knows none of them. */
  lineKeys?: Record<string, unknown>
  taskKeys?: Record<string, unknown>
}

export function createLine(id: string, o: CreateOptions): string {
  return JSON.stringify({
    type: 'create',
    id,
    at: iso(o.at),
    by: o.by,
    task: {
      title: o.title ?? `task ${id}`,
      owner: o.owner,
      source: o.source ?? 'owner',
      ref: o.ref ?? 'docs/x.md',
      tier: o.tier ?? 3,
      due: o.due ?? null,
      goals: o.goals ?? ['G10.2'],
      week: '2026-10-13',
      ...(o.detail === undefined ? {} : { detail: o.detail }),
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
  /** v2 keys a status may carry, such as a verifying task's `evidenceDue`. */
  extras: Record<string, unknown> = {},
): string {
  return JSON.stringify({ type: 'status', id, at: iso(at), by, status, note, evidence, ...extras })
}

/** A usage run's JSON (usage-report.mjs): one Claude session's cache reads and messages on each given day. */
export function usageRunJson(perDay: Record<string, { cr: number; msgs: number }>): string {
  return JSON.stringify([{ file: 'C:/Homes/a/.claude/projects/p/00000000-0000-4000-8000-000000000001.jsonl', perDay }])
}

export function updateLine(id: string, by: string, at: number, changes: Record<string, unknown>): string {
  return JSON.stringify({ type: 'update', id, at: iso(at), by, changes, note: null })
}

/** A v2 `link`: `id` is held by, a child of, … `target`. */
export function linkLine(id: string, by: string, at: number, rel: string, target: string): string {
  return JSON.stringify({ v: 2, type: 'link', id, at: iso(at), by, rel, target, note: null })
}

/** A v2 progress `note`. */
export function noteLine(id: string, by: string, at: number, text: string): string {
  return JSON.stringify({ v: 2, type: 'note', id, at: iso(at), by, text })
}

/** A v2 `wait` on someone or something outside the register. */
export function waitLine(id: string, by: string, at: number, on: string, what: string): string {
  return JSON.stringify({ v: 2, type: 'wait', id, at: iso(at), by, key: 'w1', on, what, until: null, note: null })
}

/** A pause record (pauses.jsonl) over the given tiers. */
export function pauseLine(id: string, at: number, tiers: number[], note: string): string {
  return JSON.stringify({ type: 'pause', id, at: iso(at), by: 'lead', tiers, owners: [], tasks: [], except: ['token-saving'], note })
}

/** A session rename record (aliases.jsonl). */
export function aliasLine(from: string, to: string, at: number): string {
  return JSON.stringify({ from, to, at: iso(at), by: 'lead' })
}

export function markLine(area: string, line: number, claudeSession: string, at: number): string {
  return JSON.stringify({ area, line, at: iso(at), claudeSession })
}

/** A fake disk: `write` moves the stamp the way an append does; reads are counted. */
export class MemoryFiles implements Files {
  private readonly content = new Map<string, string>()
  private readonly stamps = new Map<string, FileStamp>()
  readonly reads: string[] = []
  readonly lists: string[] = []
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

  async list(dir: string): Promise<ListedFile[]> {
    this.lists.push(dir)
    const prefix = `${dir}/`
    return [...this.stamps].flatMap(([path, stamp]) => {
      const name = path.slice(prefix.length)
      return path.startsWith(prefix) && !name.includes('/') ? [{ name, ...stamp }] : []
    })
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
    lines.push(createLine(id, { owner, by: 'lead', at, title: `Task ${n} with a title of a usual length for the register`, detail: 'what done looks like, in a sentence or two' }))
    lines.push(statusLine(id, owner, at + HOUR, 'in-progress'))
    lines.push(noteLine(id, owner, at + 2 * HOUR, 'a progress note of usual length'))
    lines.push(updateLine(id, owner, at + 3 * HOUR, { eta: '2026-10-20' }))
    if (n % FLEET.length !== 0) lines.push(statusLine(id, owner, at + 4 * HOUR, 'done', 'shipped', 'abc1234'))
  }
  return lines.slice(0, events)
}
