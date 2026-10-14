// Copied from the register's src/pauses.ts by scripts/sync-core.ts: change it there, then run the sync.
import { asArray, asString, isRecord } from './guards.ts';
import { stringList, TASK_ID } from './events.ts';
import type { Task } from './fold.ts';
import { isLabel, isOrigin, isSession, isTier, LEAD_SESSION, type Origin, type Tier } from './model.ts';
import { SessionNames } from './names.ts';
import { isActive } from './relations.ts';
import type { Mutex } from './ports.ts';

/** The owner's rule: a token-saving task is never paused, unless the pause says `--except none`. */
export const DEFAULT_EXCEPT: readonly string[] = ['token-saving'];

const PAUSE_ID = /^P[1-9]\d*$/;

/**
 * A pause, in `pauses.jsonl`: every active task that matches each selector it sets (tiers, owners, tasks) and
 * carries none of its `except` labels shows as paused until an `unpause` of the same id. Only the lead writes
 * them (owner orders it relays); a budget cut is one record instead of a message per session.
 */
export interface PauseRecord {
  type: 'pause';
  id: string;
  at: string;
  by: string;
  tiers: Tier[];
  owners: string[];
  tasks: string[];
  except: string[];
  note: string;
  /** Set when no session's own CLI call wrote it: the v2 migration's pause over the budget-cut tasks. */
  origin?: Origin;
}

export interface UnpauseRecord {
  type: 'unpause';
  id: string;
  at: string;
  by: string;
  note: string;
}

export type PauseLogRecord = PauseRecord | UnpauseRecord;

function tierList(value: unknown): Tier[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const tiers = asArray(value).filter((v): v is Tier => typeof v === 'number' && isTier(v));
  return tiers.length === value.length ? tiers : null;
}

export function parsePauseRecord(value: unknown): PauseLogRecord | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  const at = asString(value.at);
  const by = asString(value.by);
  const note = asString(value.note);
  if (id === undefined || !PAUSE_ID.test(id) || by === undefined || !isSession(by)) return null;
  if (at === undefined || Number.isNaN(Date.parse(at)) || note === undefined || note.trim() === '') return null;
  if (value.type === 'unpause') return { type: 'unpause', id, at, by, note };
  if (value.type !== 'pause') return null;
  const tiers = tierList(value.tiers);
  const owners = stringList(value.owners, isSession);
  const tasks = stringList(value.tasks, (t) => TASK_ID.test(t));
  const except = stringList(value.except, isLabel);
  if (tiers === null || owners === null || tasks === null || except === null) return null;
  if (tiers.length + owners.length + tasks.length === 0) return null;
  if (value.origin === undefined) return { type: 'pause', id, at, by, tiers, owners, tasks, except, note };
  const origin = asString(value.origin);
  return origin !== undefined && isOrigin(origin) ? { type: 'pause', id, at, by, tiers, owners, tasks, except, note, origin } : null;
}

/** Where the pauses live (append-only, beside the renames). */
export interface PauseLog {
  read(): { records: PauseLogRecord[]; unreadable: number };
  append(record: PauseLogRecord): void;
}

/** A pause in force, its owners under their current names. */
export type PauseRule = Omit<PauseRecord, 'type'>;

/** The selectors a rule sets, for one line: `tiers 3,4; owners po; except token-saving`. */
export function ruleScope(rule: PauseRule): string {
  const parts = [
    rule.tiers.length > 0 ? `tiers ${rule.tiers.join(',')}` : '',
    rule.owners.length > 0 ? `owners ${rule.owners.join(',')}` : '',
    rule.tasks.length > 0 ? `tasks ${rule.tasks.join(',')}` : '',
    rule.except.length > 0 ? `except ${rule.except.join(',')}` : '',
  ];
  return parts.filter(Boolean).join('; ');
}

/** The pause log replayed: the rules in force, and the id the next pause gets (ids are never reused). */
export class PauseRules {
  static readonly NONE = new PauseRules([], SessionNames.NONE);

  private readonly inForce = new Map<string, PauseRule>();
  private readonly recorded = new Set<string>();
  private highest = 0;

  constructor(records: readonly PauseLogRecord[], names: SessionNames) {
    for (const r of records) {
      if (r.type === 'unpause') {
        this.inForce.delete(r.id);
        continue;
      }
      // A second pause under a used id is a hand edit: the first one stands.
      if (this.recorded.has(r.id)) continue;
      this.recorded.add(r.id);
      this.highest = Math.max(this.highest, Number(r.id.slice(1)));
      const { type: _type, ...rule } = r;
      this.inForce.set(r.id, { ...rule, owners: rule.owners.map((o) => names.current(o)) });
    }
  }

  /** The rules in force, oldest first. */
  rules(): PauseRule[] {
    return [...this.inForce.values()];
  }

  isRecorded(id: string): boolean {
    return this.recorded.has(id);
  }

  isInForce(id: string): boolean {
    return this.inForce.has(id);
  }

  nextId(): string {
    return `P${this.highest + 1}`;
  }

  /** The oldest rule in force that pauses the task, or null; closed and `verifying` (shipped) work is never paused. */
  pausing(task: Task): PauseRule | null {
    if (!isActive(task) || task.status === 'verifying') return null;
    return this.rules().find((rule) => matches(rule, task)) ?? null;
  }
}

function matches(rule: PauseRule, task: Task): boolean {
  if (rule.tiers.length > 0 && !rule.tiers.includes(task.tier)) return false;
  if (rule.owners.length > 0 && !rule.owners.includes(task.owner)) return false;
  if (rule.tasks.length > 0 && !rule.tasks.includes(task.id)) return false;
  return !task.labels.some((label) => rule.except.includes(label));
}

export interface PauseDeps {
  log: PauseLog;
  mutex: Mutex;
  now: () => Date;
  names: SessionNames;
}

export type PauseOutcome = { ok: true; record: PauseLogRecord } | { ok: false; reason: string };

export interface PauseInput {
  by: string;
  tiers: Tier[];
  owners: string[];
  tasks: string[];
  except: string[];
  note: string;
}

const LEAD_ONLY = 'only the lead records pauses (owner orders it relays)';

/** Records a pause under the next id; `isTask` says whether a selected task exists. */
export function recordPause(deps: PauseDeps, input: PauseInput, isTask: (id: string) => boolean): Promise<PauseOutcome> {
  if (input.by !== LEAD_SESSION) return Promise.resolve({ ok: false, reason: LEAD_ONLY });
  if (input.tiers.length + input.owners.length + input.tasks.length === 0) {
    return Promise.resolve({ ok: false, reason: 'pause needs --tiers, --owners or --tasks' });
  }
  const unknown = input.tasks.filter((id) => !isTask(id));
  if (unknown.length > 0) return Promise.resolve({ ok: false, reason: `no task ${unknown.join(', ')}` });
  return deps.mutex.run((): PauseOutcome => {
    const rules = new PauseRules(deps.log.read().records, deps.names);
    const record: PauseRecord = { type: 'pause', id: rules.nextId(), at: deps.now().toISOString(), ...input };
    deps.log.append(record);
    return { ok: true, record };
  });
}

/** Ends a pause in force. */
export function recordUnpause(deps: PauseDeps, input: { by: string; id: string; note: string }): Promise<PauseOutcome> {
  if (input.by !== LEAD_SESSION) return Promise.resolve({ ok: false, reason: LEAD_ONLY });
  return deps.mutex.run((): PauseOutcome => {
    const rules = new PauseRules(deps.log.read().records, deps.names);
    if (!rules.isRecorded(input.id)) return { ok: false, reason: `no pause ${input.id}` };
    if (!rules.isInForce(input.id)) return { ok: false, reason: `${input.id} is already unpaused` };
    const record: UnpauseRecord = { type: 'unpause', id: input.id, at: deps.now().toISOString(), by: input.by, note: input.note };
    deps.log.append(record);
    return { ok: true, record };
  });
}
