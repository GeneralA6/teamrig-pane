// Copied from the register's src/model.ts by scripts/sync-core.ts: change it there, then run the sync.
/**
 * The register's vocabulary: statuses, tiers, the fields a task carries, and
 * the checks every field passes before it is written.
 */

export const STATUSES = ['open', 'in-progress', 'blocked', 'verifying', 'done', 'dropped'] as const;
export type TaskStatus = (typeof STATUSES)[number];

/** Statuses that still need work: `check` and the default `list` look only at these. `verifying` = shipped, its evidence still due. */
export const ACTIVE_STATUSES: readonly TaskStatus[] = ['open', 'in-progress', 'blocked', 'verifying'];

export const CLOSED_STATUSES: readonly TaskStatus[] = ['done', 'dropped'];

export const TIERS = [1, 2, 3, 4, 5] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_NAMES: Readonly<Record<Tier, string>> = {
  1: 'host alive',
  2: 'validity',
  3: 'scalability',
  4: 'owner decisions of the week',
  5: 'if budget allows',
};

/** The one session that may reassign, re-tier, re-date and plan a task it does not own. */
export const LEAD_SESSION = 'lead';

/** A Claude Code session id, as the hook's stdin and $CLAUDE_CODE_SESSION_ID carry it (an event's `sid`, an inbox mark). */
export const CLAUDE_SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The source that marks an order from the human owner. */
export const OWNER_SOURCE = 'owner';

/** What an estimate is given in (design §14): session-days, messages, or W = cache-read tokens. */
export const ESTIMATE_UNITS = ['d', 'msg', 'W'] as const;
export type EstimateUnit = (typeof ESTIMATE_UNITS)[number];

export interface Estimate {
  value: number;
  unit: EstimateUnit;
}

export interface TaskFields {
  /** One line, no secrets: every session reads the register. */
  title: string;
  /** The session that does the work and records its status. */
  owner: string;
  /** Who asked: `owner` (the human owner), `lead`, or a session name. Fixed at creation. */
  source: string;
  /** Where the ask is written: `file:line`, or a short quote ref. */
  ref: string;
  tier: Tier;
  /** `YYYY-MM-DD` (due by the end of that UTC day) or `YYYY-MM-DD HH:MM` (UTC). */
  due: string | null;
  goals: readonly string[];
  /** The start date (`YYYY-MM-DD`) of the week plan the task belongs to. */
  week: string | null;
  /** Register v2 (an event written before v2 reads as none): `token-saving`, `owner-gated`, or free labels. */
  labels: readonly string[];
  kind: TaskKind | null;
  /** The planned start, a moment (`check` flags LATE-START once it passes and the task is still not started). */
  start: string | null;
  /**
   * The owner session's expected finish, a moment (design §12). Each revision is an update event, so every one is kept;
   * unset, `schedule.ts` computes one from the estimates and the owner's queue.
   */
  eta: string | null;
  /**
   * The work's size as the estimator gave it (design §14): session-days, messages, or W (a `%` of a fleet week is
   * turned into W when written, so it keeps the size meant then). Stored as `est`; the §4 `estimate` number reads as days.
   */
  est: Estimate | null;
  /** The ask and what done looks like, one line of up to MAX_TEXT characters: what the title cannot hold. */
  detail: string | null;
  /** Sessions told when the task closes. */
  watchers: readonly string[];
  /** The options an owner decision weighs; only with `kind: decision`. */
  decision: Decision | null;
  /** The same task in other tools, at most one per system (integration-ready, owner req 12). */
  externalRefs: readonly ExternalRef[];
}

export const KINDS = ['code', 'research', 'design', 'ops', 'decision', 'owner-action'] as const;
export type TaskKind = (typeof KINDS)[number];

export interface Decision {
  options: readonly string[];
  recommendation: string | null;
  /** The day (`YYYY-MM-DD`) of the owner meeting it goes to. */
  meeting: string | null;
}

/** The same task in another tool (written by a later sync adapter; none until then). */
export interface ExternalRef {
  /** The tool: `linear`, `jira`, `github`. */
  system: string;
  /** Its key there: `ENG-12`, `SOL-3`, `owner/repo#5`. */
  id: string;
  url: string | null;
}

export const MAX_EXTERNAL_ID = 80;

/** An `update` of a decision: each field given replaces the old one; the rest stay. */
export type DecisionPatch = Partial<Decision>;

/** The fields register v2 added (a v1 line reads them as V2_DEFAULTS). */
export type V2Fields = Pick<TaskFields, 'labels' | 'kind' | 'start' | 'eta' | 'est' | 'detail' | 'watchers' | 'decision' | 'externalRefs'>;

/** What a v2 task holds before anyone sets its v2 fields. */
export const V2_DEFAULTS: V2Fields = {
  labels: [],
  kind: null,
  start: null,
  eta: null,
  est: null,
  detail: null,
  watchers: [],
  decision: null,
  externalRefs: [],
};

/** Every field but `source`: who asked never changes. */
export type EditableField = Exclude<keyof TaskFields, 'source'>;
export type TaskChanges = Partial<Pick<TaskFields, EditableField>>;
export const EDITABLE_FIELDS: readonly EditableField[] = ['title', 'owner', 'ref', 'tier', 'due', 'goals', 'week', 'labels', 'kind', 'start', 'eta', 'est', 'detail', 'watchers', 'decision', 'externalRefs'];

/**
 * The planning fields the lead may change on a task it does not own (labels: it relays the owner's `token-saving` and
 * `owner-gated`; detail: it relays the ask, so it restates it when the owner does; start and eta: design §12, the
 * owner or the lead dates the work).
 */
export const LEAD_FIELDS: readonly EditableField[] = ['owner', 'tier', 'due', 'week', 'start', 'eta', 'labels', 'watchers', 'detail'];

export const MAX_TITLE = 140;
export const MAX_TEXT = 300;
/** One option of a decision. */
export const MAX_OPTION = 80;
export const MIN_ESTIMATE = 0.1;
export const MAX_ESTIMATE = 20;
/** An estimate's bounds in each unit: 0.1 to 20 session-days, 1 to 50,000 messages, 1 to 100 B tokens (whole messages and tokens). */
export const ESTIMATE_BOUNDS: Readonly<Record<EstimateUnit, { min: number; max: number }>> = {
  d: { min: MIN_ESTIMATE, max: MAX_ESTIMATE },
  msg: { min: 1, max: 50_000 },
  W: { min: 1, max: 100e9 },
};
/** `--est 1.5%`: a share of a fleet week, 0.01 to 100. */
export const MIN_SHARE = 0.01;
export const MAX_SHARE = 100;

export type Checked<T> = { ok: true; value: T } | { ok: false; reason: string };

export function accept<T>(value: T): Checked<T> {
  return { ok: true, value };
}

export function reject<T>(reason: string): Checked<T> {
  return { ok: false, reason };
}

export function isStatus(value: string): value is TaskStatus {
  return STATUSES.some((s) => s === value);
}

export function isTier(value: number): value is Tier {
  return TIERS.some((t) => t === value);
}

const SESSION = /^[a-z][a-z0-9-]{0,31}$/;
const GOAL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,23}$/;
const LABEL = /^[a-z][a-z0-9-]{0,23}$/;
/** A URI carrying user:password, or a `password=…`-style pair. */
const SECRET_LIKE: readonly RegExp[] = [
  /[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/i,
  /\b(?:password|passwd|secret|api[-_]?key)\s*[=:]\s*\S/i,
];

export function checkSession(label: string, text: string): Checked<string> {
  return SESSION.test(text) ? accept(text) : reject(`${label} "${text}" is not a session name (lowercase, e.g. ops, data, lead)`);
}

/** One line of at most `max` characters that looks like no credential. */
export function checkText(label: string, text: string, max: number): Checked<string> {
  const value = text.trim();
  if (value === '') return reject(`${label} is empty`);
  if (/[\r\n]/.test(value)) return reject(`${label} must be one line`);
  if (value.length > max) return reject(`${label} is ${value.length} characters (max ${max})`);
  if (SECRET_LIKE.some((re) => re.test(value))) return reject(`${label} looks like it holds a credential`);
  return accept(value);
}

export function checkTier(text: string): Checked<Tier> {
  const n = Number(text);
  return /^\d$/.test(text) && isTier(n) ? accept(n) : reject(`tier "${text}" is not 1-5`);
}

/** A calendar day `YYYY-MM-DD` as its UTC midnight; null when not a real day. */
export function parseDay(text: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return null;
  const [, y, mo, d] = m;
  const day = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return day.toISOString().slice(0, 10) === text ? day : null;
}

/** `YYYY-MM-DD` or `YYYY-MM-DD HH:MM` (UTC); null when it is neither. */
export function parseMoment(text: string): { at: Date; dateOnly: boolean } | null {
  const m = /^(\d{4}-\d{2}-\d{2})(?: (\d{2}):(\d{2}))?$/.exec(text);
  if (!m) return null;
  const [, date = '', hh, mm] = m;
  const day = parseDay(date);
  if (!day) return null;
  if (hh === undefined || mm === undefined) return { at: day, dateOnly: true };
  const h = Number(hh);
  const min = Number(mm);
  if (h > 23 || min > 59) return null;
  return { at: new Date(day.getTime() + (h * 60 + min) * 60_000), dateOnly: false };
}

/** When a due date passes: a bare day is due by the end of that UTC day. */
export function dueInstant(due: string): Date | null {
  const m = parseMoment(due);
  if (!m) return null;
  return m.dateOnly ? new Date(m.at.getTime() + 86_400_000 - 1) : m.at;
}

export function checkDue(text: string): Checked<string> {
  return parseMoment(text) ? accept(text) : reject(`due "${text}" is not YYYY-MM-DD or "YYYY-MM-DD HH:MM"`);
}

export function checkWeek(text: string): Checked<string> {
  return parseDay(text) ? accept(text) : reject(`week "${text}" is not YYYY-MM-DD`);
}

export function isGoal(text: string): boolean {
  return GOAL.test(text);
}

/** A comma-separated goal list (`G10.1g,G10.2a`); duplicates collapse. */
export function checkGoals(text: string): Checked<string[]> {
  const goals = [...new Set(text.split(',').map((g) => g.trim()).filter(Boolean))];
  const bad = goals.filter((g) => !isGoal(g));
  return bad.length ? reject(`goal tag(s) ${bad.join(', ')} not like G10.1g`) : accept(goals);
}

export function isSession(text: string): boolean {
  return SESSION.test(text);
}

export function isLabel(text: string): boolean {
  return LABEL.test(text);
}

export function isKind(value: string): value is TaskKind {
  return KINDS.some((k) => k === value);
}

/** Within its unit's bounds; messages and tokens are whole. */
export function isEstimate(e: Estimate): boolean {
  const { min, max } = ESTIMATE_BOUNDS[e.unit];
  return Number.isFinite(e.value) && e.value >= min && e.value <= max && (e.unit === 'd' || Number.isInteger(e.value));
}

export function sameEstimate(a: Estimate | null, b: Estimate | null): boolean {
  return a === b || (a !== null && b !== null && a.value === b.value && a.unit === b.unit);
}

export function isEstimateUnit(value: string): value is EstimateUnit {
  return ESTIMATE_UNITS.some((u) => u === value);
}

/** A comma-separated list, trimmed, duplicates collapsed. */
function listOf(text: string): string[] {
  return [...new Set(text.split(',').map((s) => s.trim()).filter(Boolean))];
}

/** `token-saving,owner-gated`; an empty text clears the labels. */
export function checkLabels(text: string): Checked<string[]> {
  const labels = listOf(text);
  const bad = labels.filter((l) => !isLabel(l));
  return bad.length ? reject(`label(s) ${bad.join(', ')} not like token-saving (a-z, 0-9, -; max 24)`) : accept(labels);
}

/** `ops,data`; an empty text clears the watchers. */
export function checkWatchers(text: string): Checked<string[]> {
  const watchers = listOf(text);
  const bad = watchers.filter((w) => !isSession(w));
  return bad.length ? reject(`watcher(s) ${bad.join(', ')} not session names`) : accept(watchers);
}

export function checkKind(text: string): Checked<TaskKind> {
  return isKind(text) ? accept(text) : reject(`kind "${text}" is not ${KINDS.join(' | ')}`);
}

/** `--estimate 1.5` (the §4 flag): session-days, as `--est 1.5d`. */
export function checkEstimate(text: string): Checked<Estimate> {
  const e: Estimate = { value: Number(text), unit: 'd' };
  return /^\d+(\.\d+)?$/.test(text) && isEstimate(e) ? accept(e) : reject(`estimate "${text}" is not ${MIN_ESTIMATE}-${MAX_ESTIMATE} session-days`);
}

/**
 * `--est 1.5d` (session-days), `300msg` (messages) or `1.5%` (of a fleet week, design §14). A % is turned into W with
 * `fleetWeek`, the cache-read tokens of a fleet week in the newest usage run; null (no run in the last 7 days) refuses it.
 */
export function checkEst(text: string, fleetWeek: number | null): Checked<Estimate> {
  const m = /^(\d+(?:\.\d+)?)(d|msg|%)$/.exec(text);
  const value = Number(m?.[1]);
  const unit = m?.[2];
  const wrong = reject<Estimate>(`--est "${text}" is not ${MIN_ESTIMATE}-${MAX_ESTIMATE}d, 1-${ESTIMATE_BOUNDS.msg.max}msg or ${MIN_SHARE}-${MAX_SHARE}%`);
  if (unit === '%') {
    if (!(value >= MIN_SHARE && value <= MAX_SHARE)) return wrong;
    if (fleetWeek === null) return reject(`--est ${text} needs a usage run from the last 7 days to turn a % into tokens: give d or msg`);
    const tokens: Estimate = { value: Math.round((value / 100) * fleetWeek), unit: 'W' };
    return isEstimate(tokens) ? accept(tokens) : reject(`--est ${text} is ${tokens.value} tokens of a ${fleetWeek}-token week: out of 1-${ESTIMATE_BOUNDS.W.max}`);
  }
  if (unit === undefined || !isEstimateUnit(unit)) return wrong;
  const e: Estimate = { value, unit };
  return isEstimate(e) ? accept(e) : wrong;
}

export function checkMoment(label: string, text: string): Checked<string> {
  return parseMoment(text) ? accept(text) : reject(`${label} "${text}" is not YYYY-MM-DD or "YYYY-MM-DD HH:MM"`);
}

/** `a|b|c`: two or more options, each one line of at most MAX_OPTION. */
export function checkOptions(text: string): Checked<string[]> {
  const options: string[] = [];
  for (const raw of text.split('|')) {
    const option = checkText('option', raw, MAX_OPTION);
    if (!option.ok) return option;
    options.push(option.value);
  }
  if (new Set(options).size !== options.length) return reject('an option is given twice');
  return options.length >= 2 ? accept(options) : reject('--options needs two or more, split by |');
}

/** Why a task's fields cannot stand together, or null: a decision belongs to a decision task; the external refs stand. */
export function fieldsRefusal(fields: TaskFields): string | null {
  const refs = externalRefsRefusal(fields.externalRefs);
  if (refs !== null) return refs;
  if (fields.decision === null) return null;
  if (fields.kind !== 'decision') return 'a decision (--options, --rec, --meeting) goes with --kind decision';
  return fields.decision.options.length >= 2 ? null : 'a decision needs --options "a|b" (two or more)';
}

/** Why the external refs cannot stand, or null: a slug system, one ref per system, a one-line key, an https link, no credential. */
export function externalRefsRefusal(refs: readonly ExternalRef[]): string | null {
  const systems = new Set<string>();
  for (const r of refs) {
    if (!SLUG.test(r.system)) return `external system "${r.system}" is 2 to 24 lower-case letters, digits or -`;
    if (systems.has(r.system)) return `one external ref per system: ${r.system} is given twice`;
    systems.add(r.system);
    const id = checkText('external id', r.id, MAX_EXTERNAL_ID);
    if (!id.ok) return id.reason;
    if (r.url === null) continue;
    const url = checkText('external url', r.url, MAX_TEXT);
    if (!url.ok) return url.reason;
    if (!r.url.startsWith('https://')) return `an external url starts with https://, not ${r.url}`;
  }
  return null;
}

/** `2026-10-15 18:00` → `10-15 18:00`: the register spans weeks, not years. */
export function shortDate(text: string): string {
  return text.slice(5);
}

/** How two tasks relate (register v2). */
export const RELATIONS = ['blocked-by', 'parent', 'relates-to', 'duplicate-of', 'superseded-by'] as const;
export type Relation = (typeof RELATIONS)[number];

/** Relations that hold one target: a new link replaces the old one. */
export const SINGLE_RELATIONS: readonly Relation[] = ['parent', 'duplicate-of', 'superseded-by'];

/** Relations whose links may never close a cycle. */
export const ACYCLIC_RELATIONS: readonly Relation[] = ['blocked-by', 'parent'];

/** Relations that say why a task was dropped: written with `set --status dropped`, never on an active task. */
export const CLOSING_RELATIONS = ['duplicate-of', 'superseded-by'] as const;
export type ClosingRelation = (typeof CLOSING_RELATIONS)[number];

/** What a task can wait on besides another task. */
export const WAIT_KINDS = ['owner', 'session', 'event', 'external'] as const;
export type WaitKind = (typeof WAIT_KINDS)[number];

/** A wait's `what`: a few words (the detail goes in its note). */
export const MAX_WAIT = 120;

/** `w` + a number, per task: `resolve T5 w2`. */
export const WAIT_KEY = /^w[1-9]\d*$/;

/** Marks the v2 migration's writes: they never count as a session touching the task. */
export const MIGRATION_ORIGIN: 'migration-v2' = 'migration-v2';
/** A team's or an external system's name: `acme`, `linear`, `jira`. */
export const SLUG = /^[a-z][a-z0-9-]{1,23}$/;

/** Who wrote an event when it is not a session's own CLI call: the v2 migration, or a later sync adapter (`sync:linear`). */
export type Origin = typeof MIGRATION_ORIGIN | `sync:${string}`;

export function isOrigin(value: string): value is Origin {
  return value === MIGRATION_ORIGIN || (value.startsWith('sync:') && SLUG.test(value.slice('sync:'.length)));
}

/** A task's id across teams and tools: `<teamId>:<ULID>` (identity.ts). */
export const UID = /^[a-z][a-z0-9-]{1,23}:[0-9A-HJKMNP-TV-Z]{26}$/;

/** A status's name in an external workflow (`In QA`): a few words. */
export const MAX_STATUS_NAME = 40;

export function isRelation(value: string): value is Relation {
  return RELATIONS.some((r) => r === value);
}

export function isClosingRelation(value: Relation): value is ClosingRelation {
  return CLOSING_RELATIONS.some((r) => r === value);
}

export function isWaitKind(value: string): value is WaitKind {
  return WAIT_KINDS.some((k) => k === value);
}
