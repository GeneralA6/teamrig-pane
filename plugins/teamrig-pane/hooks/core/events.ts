// Copied from the register's src/events.ts by scripts/sync-core.ts: change it there, then run the sync.
import { asArray, asNumber, asString, isRecord } from './guards.ts';
import {
  CLAUDE_SESSION_ID,
  isEstimate,
  isEstimateUnit,
  isGoal,
  isKind,
  isLabel,
  isSession,
  isStatus,
  isRelation,
  isTier,
  isOrigin,
  isWaitKind,
  MAX_STATUS_NAME,
  parseDay,
  parseMoment,
  SLUG,
  UID,
  WAIT_KEY,
  type Decision,
  type Estimate,
  type ExternalRef,
  type Origin,
  type Relation,
  type WaitKind,
  type TaskChanges,
  type TaskFields,
  type TaskStatus,
  type V2Fields,
} from './model.ts';

/** `T` + a number the register allocates under its lock: short, and never reused. */
export const TASK_ID = /^T[1-9]\d*$/;

interface EventBase {
  id: string;
  /** ISO timestamp of the write. */
  at: string;
  /** The session that wrote the event. */
  by: string;
  /** Set when not a session's own CLI call: the v2 migration's writes, or a later sync adapter's. */
  origin?: Origin;
  /**
   * The Claude Code session that wrote it ($CLAUDE_CODE_SESSION_ID, design §13), absent when unset and on every line
   * written before it existed. `by` stays the declared area; `sid` makes it checkable and survives renames.
   */
  sid?: string;
}

export interface CreateEvent extends EventBase {
  type: 'create';
  task: TaskFields;
  /** Set when the task came from another tool (a sync adapter); otherwise its uid is derived from this event (identity.ts). */
  uid?: string;
}

export interface StatusEvent extends EventBase {
  type: 'status';
  status: TaskStatus;
  note: string | null;
  /** A sha or a path that proves the status (required on `done`). */
  evidence: string | null;
  /** On `done` (required since 10-13): the skill written or updated, or `none` for a one-off. Null on the other statuses. */
  skill: string | null;
  /** Register v2, each present only when set (a v1 line never has them). With `verifying`: when its evidence is due. */
  evidenceDue?: string;
  /** With a manual `blocked`: what it waits on. */
  reason?: WaitKind;
  /** With `dropped`: who decided (a session, or `owner`). */
  decidedBy?: string;
  /** The status's name in an external workflow (`In QA` on verifying), from a sync adapter. */
  name?: string;
}

export interface UpdateEvent extends EventBase {
  type: 'update';
  changes: TaskChanges;
  note: string | null;
}

interface V2Base extends EventBase {
  /** Register v2 (relations, waits, notes); an event without `v` is v1. */
  v: 2;
}

/** `id` relates to `target` by `rel`: blocked by it, part of it, a duplicate of it, … */
export interface LinkEvent extends V2Base {
  type: 'link';
  rel: Relation;
  target: string;
  note: string | null;
}

export interface UnlinkEvent extends V2Base {
  type: 'unlink';
  rel: Relation;
  target: string;
  note: string | null;
}

/** `id` waits on something that is not a task; the wait's `since` is the event's `at`. */
export interface WaitEvent extends V2Base {
  type: 'wait';
  key: string;
  on: WaitKind;
  what: string;
  until: string | null;
  note: string | null;
}

export interface ResolveEvent extends V2Base {
  type: 'resolve';
  key: string;
  note: string | null;
}

/** An append-only progress note: it changes no status. */
export interface NoteEvent extends V2Base {
  type: 'note';
  text: string;
}

/** The v2 events: they build the graph and leave the v1 fields of a task as they were. */
export type GraphEvent = LinkEvent | UnlinkEvent | WaitEvent | ResolveEvent | NoteEvent;

export type TaskEvent = CreateEvent | StatusEvent | UpdateEvent | GraphEvent;

/** A string, null for a missing or null value, undefined for anything else. */
function optionalString(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  return asString(value);
}

function optionalDue(value: unknown): string | null | undefined {
  const s = optionalString(value);
  return typeof s === 'string' && !parseMoment(s) ? undefined : s;
}

function optionalWeek(value: unknown): string | null | undefined {
  const s = optionalString(value);
  return typeof s === 'string' && !parseDay(s) ? undefined : s;
}

function goalList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const goals = asArray(value).flatMap((g) => {
    const s = asString(g);
    return s !== undefined && isGoal(s) ? [s] : [];
  });
  return goals.length === value.length ? goals : null;
}

export function stringList(value: unknown, valid: (s: string) => boolean): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const items = asArray(value).flatMap((v) => {
    const s = asString(v);
    return s !== undefined && valid(s) ? [s] : [];
  });
  return items.length === value.length ? items : null;
}

/** null when missing, undefined when malformed. */
function optionalKind(value: unknown): TaskFields['kind'] | undefined {
  const s = optionalString(value);
  return s === null ? null : s !== undefined && isKind(s) ? s : undefined;
}

/**
 * The estimate (design §14): `est: {value, unit}` as written since T211, else the §4 `estimate` number read as days
 * (`est` is a new key, so an older reader skips it instead of losing the line). null when neither is set, undefined
 * when the one given is malformed.
 */
function optionalEst(value: Record<string, unknown>): Estimate | null | undefined {
  if ('est' in value) {
    if (value.est === undefined || value.est === null) return null;
    if (!isRecord(value.est)) return undefined;
    const n = asNumber(value.est.value);
    const unit = asString(value.est.unit);
    if (n === undefined || unit === undefined || !isEstimateUnit(unit)) return undefined;
    const e: Estimate = { value: n, unit };
    return isEstimate(e) ? e : undefined;
  }
  if (value.estimate === undefined || value.estimate === null) return null;
  const days = asNumber(value.estimate);
  if (days === undefined) return undefined;
  const e: Estimate = { value: days, unit: 'd' };
  return isEstimate(e) ? e : undefined;
}

function optionalDecision(value: unknown): Decision | null | undefined {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) return undefined;
  const options = stringList(value.options, (s) => s.trim() !== '');
  const recommendation = optionalString(value.recommendation);
  const meeting = optionalWeek(value.meeting);
  if (options === null || recommendation === undefined || meeting === undefined) return undefined;
  return { options, recommendation, meeting };
}

/** Each ref well formed (a slug system, a key, an optional url); null when one is not. */
function externalRefList(value: unknown): ExternalRef[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const refs = asArray(value).flatMap((v): ExternalRef[] => {
    if (!isRecord(v)) return [];
    const system = asString(v.system);
    const id = filled(v.id);
    const url = optionalString(v.url);
    return system !== undefined && SLUG.test(system) && id !== undefined && url !== undefined ? [{ system, id, url }] : [];
  });
  return refs.length === value.length ? refs : null;
}

/** The v2 task fields, defaulted when missing (a v1 line); null when one is malformed. */
function parseV2Fields(value: Record<string, unknown>): V2Fields | null {
  const labels = stringList(value.labels, isLabel);
  const kind = optionalKind(value.kind);
  const start = optionalDue(value.start);
  const eta = optionalDue(value.eta);
  const est = optionalEst(value);
  const detail = optionalString(value.detail);
  const watchers = stringList(value.watchers, isSession);
  const decision = optionalDecision(value.decision);
  const externalRefs = externalRefList(value.externalRefs);
  if (labels === null || kind === undefined || start === undefined || eta === undefined || est === undefined || detail === undefined || watchers === null || decision === undefined || externalRefs === null) {
    return null;
  }
  return { labels, kind, start, eta, est, detail, watchers, decision, externalRefs };
}

function parseFields(value: unknown): TaskFields | null {
  if (!isRecord(value)) return null;
  const title = asString(value.title);
  const owner = asString(value.owner);
  const source = asString(value.source);
  const ref = asString(value.ref);
  const tier = asNumber(value.tier);
  const due = optionalDue(value.due);
  const week = optionalWeek(value.week);
  const goals = goalList(value.goals ?? []);
  if (title === undefined || owner === undefined || source === undefined || ref === undefined) return null;
  if (tier === undefined || !isTier(tier) || due === undefined || week === undefined || goals === null) return null;
  const v2 = parseV2Fields(value);
  return v2 === null ? null : { title, owner, source, ref, tier, due, goals, week, ...v2 };
}

/** The changed fields; null when one is malformed or none is present. */
function parseChanges(value: unknown): TaskChanges | null {
  if (!isRecord(value)) return null;
  const changes: TaskChanges = {};
  for (const key of ['title', 'owner', 'ref'] as const) {
    if (!(key in value)) continue;
    const s = asString(value[key]);
    if (s === undefined) return null;
    changes[key] = s;
  }
  if ('tier' in value) {
    const tier = asNumber(value.tier);
    if (tier === undefined || !isTier(tier)) return null;
    changes.tier = tier;
  }
  if ('due' in value) {
    const due = optionalDue(value.due);
    if (due === undefined) return null;
    changes.due = due;
  }
  if ('week' in value) {
    const week = optionalWeek(value.week);
    if (week === undefined) return null;
    changes.week = week;
  }
  if ('goals' in value) {
    const goals = goalList(value.goals);
    if (goals === null) return null;
    changes.goals = goals;
  }
  const v2 = parseV2Fields(value);
  if (v2 === null) return null;
  if ('labels' in value) changes.labels = v2.labels;
  if ('kind' in value) changes.kind = v2.kind;
  if ('start' in value) changes.start = v2.start;
  if ('eta' in value) changes.eta = v2.eta;
  if ('est' in value || 'estimate' in value) changes.est = v2.est;
  if ('detail' in value) changes.detail = v2.detail;
  if ('watchers' in value) changes.watchers = v2.watchers;
  if ('decision' in value) changes.decision = v2.decision;
  if ('externalRefs' in value) changes.externalRefs = v2.externalRefs;
  return Object.keys(changes).length > 0 ? changes : null;
}

function filled(value: unknown): string | undefined {
  const s = asString(value);
  return s === undefined || s.trim() === '' ? undefined : s;
}

/** A v2 line (`v: 2`); null when malformed or of a type this reader does not know. */
function parseGraphEvent(value: Record<string, unknown>, base: EventBase): GraphEvent | null {
  if (value.v !== 2) return null;
  const note = optionalString(value.note);
  if (note === undefined) return null;
  switch (value.type) {
    case 'link':
    case 'unlink': {
      const rel = asString(value.rel);
      const target = asString(value.target);
      if (rel === undefined || !isRelation(rel) || target === undefined || !TASK_ID.test(target)) return null;
      const event: LinkEvent | UnlinkEvent =
        value.type === 'link' ? { type: 'link', ...base, v: 2, rel, target, note } : { type: 'unlink', ...base, v: 2, rel, target, note };
      return event;
    }
    case 'wait': {
      const key = asString(value.key);
      const on = asString(value.on);
      const what = filled(value.what);
      const until = optionalDue(value.until);
      if (key === undefined || !WAIT_KEY.test(key) || on === undefined || !isWaitKind(on) || what === undefined || until === undefined) return null;
      return { type: 'wait', ...base, v: 2, key, on, what, until, note };
    }
    case 'resolve': {
      const key = asString(value.key);
      if (key === undefined || !WAIT_KEY.test(key)) return null;
      return { type: 'resolve', ...base, v: 2, key, note };
    }
    case 'note': {
      const text = filled(value.text);
      return text === undefined ? null : { type: 'note', ...base, v: 2, text };
    }
    default:
      return null;
  }
}

type StatusExtras = Pick<StatusEvent, 'evidenceDue' | 'reason' | 'decidedBy' | 'name'>;

/** The v2 status fields that are present and well formed; null when one is malformed. */
function parseStatusExtras(value: Record<string, unknown>): StatusExtras | null {
  const extras: StatusExtras = {};
  if (value.evidenceDue !== undefined) {
    const due = asString(value.evidenceDue);
    if (due === undefined || !parseMoment(due)) return null;
    extras.evidenceDue = due;
  }
  if (value.reason !== undefined) {
    const reason = asString(value.reason);
    if (reason === undefined || !isWaitKind(reason)) return null;
    extras.reason = reason;
  }
  if (value.decidedBy !== undefined) {
    const who = asString(value.decidedBy);
    if (who === undefined || !isSession(who)) return null;
    extras.decidedBy = who;
  }
  if (value.name !== undefined) {
    const name = filled(value.name);
    if (name === undefined || name.length > MAX_STATUS_NAME) return null;
    extras.name = name;
  }
  return extras;
}

/** `{}` when absent, `{origin}` when well formed, null when malformed. */
function parseOrigin(value: unknown): Pick<EventBase, 'origin'> | null {
  if (value === undefined) return {};
  const s = asString(value);
  return s !== undefined && isOrigin(s) ? { origin: s } : null;
}

/** `{}` when absent, `{sid}` when a Claude Code session id, null when malformed. */
function parseSid(value: unknown): Pick<EventBase, 'sid'> | null {
  if (value === undefined) return {};
  const s = asString(value);
  return s !== undefined && CLAUDE_SESSION_ID.test(s) ? { sid: s } : null;
}

/** `{}` when absent, `{uid}` when well formed, null when malformed. */
function optionalUid(value: unknown): Pick<CreateEvent, 'uid'> | null {
  if (value === undefined) return {};
  const s = asString(value);
  return s !== undefined && UID.test(s) ? { uid: s } : null;
}

/** One register line, shape-checked; null when it is not a well-formed event. */
export function parseEvent(value: unknown): TaskEvent | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  const at = asString(value.at);
  const by = asString(value.by);
  if (id === undefined || !TASK_ID.test(id) || at === undefined || Number.isNaN(Date.parse(at)) || by === undefined) {
    return null;
  }
  const origin = parseOrigin(value.origin);
  const sid = parseSid(value.sid);
  if (origin === null || sid === null) return null;
  const base: EventBase = { id, at, by, ...origin, ...sid };
  switch (value.type) {
    case 'create': {
      const task = parseFields(value.task);
      const uid = optionalUid(value.uid);
      return task && uid !== null ? { type: 'create', ...base, task, ...uid } : null;
    }
    case 'status': {
      const status = asString(value.status);
      const note = optionalString(value.note);
      const evidence = optionalString(value.evidence);
      const skill = optionalString(value.skill);
      if (status === undefined || !isStatus(status) || note === undefined || evidence === undefined || skill === undefined) return null;
      const extras = parseStatusExtras(value);
      return extras === null ? null : { type: 'status', ...base, status, note, evidence, skill, ...extras };
    }
    case 'update': {
      const changes = parseChanges(value.changes);
      const note = optionalString(value.note);
      if (changes === null || note === undefined) return null;
      return { type: 'update', ...base, changes, note };
    }
    default:
      return parseGraphEvent(value, base);
  }
}
