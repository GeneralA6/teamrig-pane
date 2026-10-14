// Copied from the register's src/rates.ts by scripts/sync-core.ts: change it there, then run the sync.
// Token rates (register v2 design §14): turns an estimate given in session-days or messages into cache-read tokens
// (W) and a share of a fleet week, from the newest usage run (the token-usage folder's `usage-*.json`, written by
// usage-report.mjs) and the newest status-line snapshot. Pure: usage-store.ts reads the files.
import { asNumber, asString, isRecord } from './guards.ts';
import type { TaskEvent } from './events.ts';
import { CLAUDE_SESSION_ID, parseDay, type Estimate } from './model.ts';

/** A usage run older than this many days is stale: estimates show in their own unit only (`check` says so). */
export const RATES_MAX_AGE_DAYS = 7;
/** The days a fleet week sums (design §14: "the cache reads over the last 7 days in the file"). */
export const WEEK_DAYS = 7;

const DAY_MS = 86_400_000;

/** One session's use on one UTC day: cache-read tokens and assistant messages. */
export interface DayUsage {
  cr: number;
  msgs: number;
}

/** A usage run: the day it ran, and each Claude session's use per day (its subagents' transcripts included). */
export interface UsageRun {
  date: string;
  sessions: ReadonlyMap<string, ReadonlyMap<string, DayUsage>>;
}

/** The weekly limit as the newest status-line snapshot read it: the % used, and when the week resets (epoch ms). */
export interface WeekReading {
  used: number;
  resetsAt: number;
}

/** What the usage files hold: the newest run and the newest weekly reading, each null when there is none. */
export interface Usage {
  run: UsageRun | null;
  week: WeekReading | null;
}

/**
 * The Claude session a usage row belongs to: the first segment of its transcript path that is a session id, so a
 * subagent's transcript (`<project>\<sid>\subagents\agent-x.jsonl`) counts under the session that spawned it.
 */
export function sessionOfFile(file: string): string | null {
  for (const part of file.split(/[\\/]/)) {
    const sid = part.endsWith('.jsonl') ? part.slice(0, -'.jsonl'.length) : part;
    if (CLAUDE_SESSION_ID.test(sid)) return sid;
  }
  return null;
}

function dayUsage(value: unknown): DayUsage | null {
  if (!isRecord(value)) return null;
  const cr = asNumber(value.cr);
  const msgs = asNumber(value.msgs);
  return cr !== undefined && msgs !== undefined && cr >= 0 && msgs >= 0 ? { cr, msgs } : null;
}

/**
 * A usage run's rows (`[{file, perDay: {"YYYY-MM-DD": {cr, msgs, …}}}]`), summed per session and day; a row with no
 * session id in its path, and a day that is not a well-formed count, are skipped. null when the file is not a list.
 */
export function parseUsageRun(date: string, json: unknown): UsageRun | null {
  if (!Array.isArray(json)) return null;
  const sessions = new Map<string, Map<string, DayUsage>>();
  for (const row of json) {
    if (!isRecord(row) || !isRecord(row.perDay)) continue;
    const sid = sessionOfFile(asString(row.file) ?? '');
    if (sid === null) continue;
    const days = sessions.get(sid) ?? new Map<string, DayUsage>();
    for (const [day, value] of Object.entries(row.perDay)) {
      const use = dayUsage(value);
      if (use === null || !parseDay(day)) continue;
      const sum = days.get(day) ?? { cr: 0, msgs: 0 };
      days.set(day, { cr: sum.cr + use.cr, msgs: sum.msgs + use.msgs });
    }
    sessions.set(sid, days);
  }
  return { date, sessions };
}

/**
 * The weekly reading of the newest snapshot that has one, as usage-status.mjs picks it (newest `ts` first); null when
 * none has. A snapshot that is not an object, or has no parsable `ts`, is skipped.
 */
export function newestWeek(snapshots: readonly unknown[]): WeekReading | null {
  let best: { ts: number; week: WeekReading } | null = null;
  for (const s of snapshots) {
    if (!isRecord(s) || !isRecord(s.rate_limits) || !isRecord(s.rate_limits.seven_day)) continue;
    const ts = Date.parse(asString(s.ts) ?? '');
    const used = asNumber(s.rate_limits.seven_day.used_percentage);
    const resets = asNumber(s.rate_limits.seven_day.resets_at);
    if (Number.isNaN(ts) || used === undefined || resets === undefined) continue;
    if (best === null || ts > best.ts) best = { ts, week: { used, resetsAt: resets * 1000 } };
  }
  return best?.week ?? null;
}

/** A session's pace: messages per active day and cache-read tokens per message (design §14: their product is a session-day). */
export interface Rate {
  msgsPerDay: number;
  tokensPerMsg: number;
}

function rateOf(days: Iterable<DayUsage>): Rate | null {
  let cr = 0;
  let msgs = 0;
  let active = 0;
  for (const d of days) {
    if (d.msgs === 0) continue;
    cr += d.cr;
    msgs += d.msgs;
    active += 1;
  }
  return active === 0 ? null : { msgsPerDay: msgs / active, tokensPerMsg: cr / msgs };
}

/** The middle value (the mean of the middle two for an even count); 0 for none. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[mid - 1] ?? upper) + upper) / 2;
}

/**
 * The rates read from a fresh usage run: each register session's own pace (its Claude sessions, matched by the `sid`
 * its events carry, design §13), the fleet median for a session with none, the fleet week's tokens, and the weekly
 * budget left.
 */
export class TokenRates {
  /** The usage run's date. */
  readonly runDate: string;
  /** A fleet week's cache-read tokens: the run's last 7 days, scaled up to 7 when the run covers fewer. */
  readonly fleetWeek: number;
  /** The calendar days the fleet week was read from (7, or fewer for a short run). */
  readonly coveredDays: number;
  /** 100 − the weekly % used, from the newest snapshot; null when there is none, or the week has reset since. */
  readonly left: number | null;
  private readonly own: ReadonlyMap<string, Rate>;
  private readonly fleet: Rate;

  constructor(parts: { runDate: string; fleetWeek: number; coveredDays: number; left: number | null; own: ReadonlyMap<string, Rate>; fleet: Rate }) {
    this.runDate = parts.runDate;
    this.fleetWeek = parts.fleetWeek;
    this.coveredDays = parts.coveredDays;
    this.left = parts.left;
    this.own = parts.own;
    this.fleet = parts.fleet;
  }

  /** The owner's pace, or the fleet median when no Claude session of it is in the run. */
  rateFor(owner: string): Rate {
    return this.own.get(owner) ?? this.fleet;
  }

  /** The estimate in cache-read tokens, at its owner's pace. */
  tokens(est: Estimate, owner: string): number {
    const r = this.rateFor(owner);
    if (est.unit === 'W') return est.value;
    return est.unit === 'msg' ? est.value * r.tokensPerMsg : est.value * r.msgsPerDay * r.tokensPerMsg;
  }

  /** The estimate in session-days, at its owner's pace. */
  days(est: Estimate, owner: string): number {
    const r = this.rateFor(owner);
    if (est.unit === 'd') return est.value;
    return est.unit === 'msg' ? est.value / r.msgsPerDay : est.value / (r.msgsPerDay * r.tokensPerMsg);
  }

  /** Tokens as a % of a fleet week. */
  share(tokens: number): number {
    return (tokens / this.fleetWeek) * 100;
  }
}

/** What the rates are: none (no usage run), stale (older than RATES_MAX_AGE_DAYS), or fresh. */
export type RatesState = { kind: 'none' } | { kind: 'stale'; runDate: string } | { kind: 'fresh'; rates: TokenRates };

/** The Claude sessions of each register session: the sids its events carry (the latest writer of a sid wins). */
function sessionsOf(events: readonly TaskEvent[]): Map<string, string[]> {
  const ownerOf = new Map<string, string>();
  for (const e of events) if (e.sid !== undefined) ownerOf.set(e.sid, e.by);
  const out = new Map<string, string[]>();
  for (const [sid, by] of ownerOf) out.set(by, [...(out.get(by) ?? []), sid]);
  return out;
}

/**
 * The rates from the usage files, for the register's `events` (names as the reader shows them). A run with no
 * session that sent a message, or no cache reads, counts as none; one more than RATES_MAX_AGE_DAYS old is stale.
 */
export function tokenRates(usage: Usage, events: readonly TaskEvent[], now: Date): RatesState {
  const run = usage.run;
  if (run === null) return { kind: 'none' };
  // Its age runs from the end of its day: the file name gives the day only.
  if (now.getTime() - (Date.parse(run.date) + DAY_MS) > RATES_MAX_AGE_DAYS * DAY_MS) return { kind: 'stale', runDate: run.date };
  const perSid = new Map<string, Rate>();
  for (const [sid, days] of run.sessions) {
    const rate = rateOf(days.values());
    if (rate !== null) perSid.set(sid, rate);
  }
  if (perSid.size === 0) return { kind: 'none' };
  const fleet: Rate = { msgsPerDay: median([...perSid.values()].map((r) => r.msgsPerDay)), tokensPerMsg: median([...perSid.values()].map((r) => r.tokensPerMsg)) };
  const own = new Map<string, Rate>();
  for (const [owner, sids] of sessionsOf(events)) {
    const rate = rateOf(sids.flatMap((sid) => [...(run.sessions.get(sid)?.values() ?? [])]));
    if (rate !== null) own.set(owner, rate);
  }
  const { tokens, days } = fleetWeekOf(run);
  if (tokens === 0) return { kind: 'none' };
  const week = usage.week;
  const left = week === null || week.resetsAt <= now.getTime() ? null : Math.max(0, 100 - week.used);
  return { kind: 'fresh', rates: new TokenRates({ runDate: run.date, fleetWeek: (tokens * WEEK_DAYS) / days, coveredDays: days, left, own, fleet }) };
}

/**
 * The cache reads of the run's last WEEK_DAYS days, and how many calendar days of them the run covers (1 to 7; a run
 * of usage-report.mjs over fewer days covers fewer). Called with at least one day in the run.
 */
function fleetWeekOf(run: UsageRun): { tokens: number; days: number } {
  const perDay = new Map<number, number>();
  for (const days of run.sessions.values()) for (const [day, use] of days) perDay.set(Date.parse(day), (perDay.get(Date.parse(day)) ?? 0) + use.cr);
  const last = Math.max(...perDay.keys());
  const from = Math.max(last - (WEEK_DAYS - 1) * DAY_MS, Math.min(...perDay.keys()));
  let tokens = 0;
  for (const [day, cr] of perDay) if (day >= from) tokens += cr;
  return { tokens, days: Math.round((last - from) / DAY_MS) + 1 };
}

/**
 * The `check` line on the rates: `RATES stale (usage run 10-02): …` (design §14), or `RATES partial …` when the run
 * covers fewer than WEEK_DAYS days and its fleet week is scaled up; null when they are fresh and whole, or there is no run.
 */
export function ratesLine(state: RatesState): string | null {
  if (state.kind === 'stale') return `RATES stale (usage run ${state.runDate}): estimates show in their own unit until usage-report.mjs runs again`;
  if (state.kind === 'none' || state.rates.coveredDays >= WEEK_DAYS) return null;
  const { runDate, coveredDays } = state.rates;
  return `RATES partial (usage run ${runDate} covers ${coveredDays} day(s)): a fleet week is its cache reads ×${(WEEK_DAYS / coveredDays).toFixed(1)}`;
}
