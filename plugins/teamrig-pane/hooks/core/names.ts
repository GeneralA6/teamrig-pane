// Copied from the register's src/names.ts by scripts/sync-core.ts: change it there, then run the sync.
import { asString, isRecord } from './guards.ts';
import type { TaskEvent } from './events.ts';
import { accept, checkSession, LEAD_SESSION, reject, type Checked } from './model.ts';
import type { EventLog, EventRead } from './ports.ts';

/**
 * A session rename (`/rename`): `from`, the old name, now reaches `to`. Appended to `aliases.jsonl`; nothing
 * that names the old one (tasks, inbox files, marks) is moved or rewritten.
 */
export interface AliasRecord {
  from: string;
  to: string;
  at: string;
  by: string;
}

export function parseAlias(value: unknown): AliasRecord | null {
  if (!isRecord(value)) return null;
  const from = asString(value.from);
  const to = asString(value.to);
  const at = asString(value.at);
  const by = asString(value.by);
  if (from === undefined || to === undefined || by === undefined || from === to) return null;
  if (![from, to, by].every((name) => checkSession('name', name).ok)) return null;
  if (at === undefined || Number.isNaN(Date.parse(at))) return null;
  return { from, to, at, by };
}

/** Where the renames live (append-only, like the read marks). */
export interface AliasLog {
  read(): { records: AliasRecord[]; unreadable: number };
  append(record: AliasRecord): void;
}

/**
 * Session names after renames. Each record points an old name at a new one; the newest record per old name
 * wins, and recording `a → b` makes `b` a current name again (it drops `b → …`). A record's target thus never
 * leads anywhere, so no record can close a loop, and a chain of renames (a → b, then b → c) resolves to c.
 */
export class SessionNames {
  static readonly NONE = new SessionNames([]);

  private readonly next: ReadonlyMap<string, string>;

  constructor(records: readonly AliasRecord[]) {
    const next = new Map<string, string>();
    for (const r of records) {
      next.delete(r.to);
      next.set(r.from, r.to);
    }
    this.next = next;
  }

  /** The name a session goes by now: itself when it was never renamed. */
  current(name: string): string {
    const to = this.next.get(name);
    return to === undefined ? name : this.current(to);
  }

  /** Every name that reaches `name`'s session: its old names (sorted), then the current one last. */
  namesOf(name: string): string[] {
    const current = this.current(name);
    const old = [...this.next.keys()].filter((n) => this.current(n) === current).sort();
    return [...old, current];
  }

  /** The renames in force, as old name → current name. */
  renames(): { from: string; current: string }[] {
    return [...this.next.keys()].sort().map((from) => ({ from, current: this.current(from) }));
  }
}

/**
 * A rename to record. The lead may record any; a session only its own: it calls itself by the new name, and the
 * Claude session it runs in last read its inbox as the old one (`readAs`, from the read marks), so no session can
 * take over another's tasks and inbox by naming it. Refused when it would change nothing; renaming back (b → a
 * after a → b) is allowed and makes `a` the current name again.
 */
export function checkRename(
  names: SessionNames,
  input: { from: string; to: string; by: string; readAs: string | null; now: Date },
): Checked<AliasRecord> {
  const { from, to, by, readAs } = input;
  if (from === to) return reject('--from and --to are the same name');
  if (names.current(from) === to) return reject(`${from} already reaches ${to}`);
  const own = by === names.current(to) && readAs !== null && names.current(readAs) === names.current(from);
  if (!own && by !== LEAD_SESSION) {
    return reject(`only the lead, or ${to} in the Claude session that last ran "inbox read" as ${from}, records this rename`);
  }
  return accept({ from, to, at: input.now.toISOString(), by });
}

/** The event with every session it names (writer, owner, source, a waited-on session) under its current name. */
export function currentNames(event: TaskEvent, names: SessionNames): TaskEvent {
  const by = names.current(event.by);
  switch (event.type) {
    case 'create':
      return {
        ...event,
        by,
        task: { ...event.task, owner: names.current(event.task.owner), source: names.current(event.task.source), watchers: event.task.watchers.map((w) => names.current(w)) },
      };
    case 'update': {
      const changes = { ...event.changes };
      if (changes.owner !== undefined) changes.owner = names.current(changes.owner);
      if (changes.watchers !== undefined) changes.watchers = changes.watchers.map((w) => names.current(w));
      return { ...event, by, changes };
    }
    case 'status':
      return event.decidedBy === undefined ? { ...event, by } : { ...event, by, decidedBy: names.current(event.decidedBy) };
    case 'wait':
      return { ...event, by, what: event.on === 'session' ? names.current(event.what) : event.what };
    case 'link':
    case 'unlink':
    case 'resolve':
    case 'note':
      return { ...event, by };
  }
}

/** Reads the register with old names as current ones, so a renamed session keeps its tasks; writes pass through. */
export class CurrentNamesEventLog implements EventLog {
  private readonly inner: EventLog;
  private readonly names: SessionNames;

  constructor(inner: EventLog, names: SessionNames) {
    this.inner = inner;
    this.names = names;
  }

  read(): EventRead {
    const { events, unreadable } = this.inner.read();
    return { events: events.map((e) => currentNames(e, this.names)), unreadable };
  }

  append(event: TaskEvent): void {
    this.inner.append(event);
  }
}
