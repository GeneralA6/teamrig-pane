// Copied from the register's src/estimates.ts by scripts/sync-core.ts: change it there, then run the sync.
// How big a task is (register v2 design §14): its own estimate plus its sub-tasks', in session-days, cache-read
// tokens and a share of a fleet week once rates.ts has a fresh usage run; in the estimate's own unit when it has none.
import type { Task } from './fold.ts';
import { sameEstimate, type Estimate } from './model.ts';
import type { View } from './shown.ts';

/** `1.5d`, `300msg`, or tokens as `tokenText` writes them. */
export function estimateText(e: Estimate): string {
  if (e.unit === 'W') return tokenText(e.value);
  return e.unit === 'msg' ? `${e.value}msg` : `${e.value}d`;
}

/** `0.16B` from 10M tokens up, `2.5M` below. */
export function tokenText(tokens: number): string {
  return tokens >= 1e7 ? `${(tokens / 1e9).toFixed(2)}B` : `${(tokens / 1e6).toFixed(1)}M`;
}

/** `2.1%`, or `<0.1%` for a share that would print as nothing. */
export function shareText(pct: number): string {
  return pct > 0 && pct < 0.05 ? '<0.1%' : `${pct.toFixed(1)}%`;
}

function daysText(days: number): string {
  return days > 0 && days < 0.05 ? '<0.1d' : `${Number(days.toFixed(1))}d`;
}

/** A task's size: its own estimate and those of its sub-tasks (any depth, dropped ones left out). */
export interface Size {
  own: Estimate | null;
  /** How many sub-tasks have an estimate. */
  parts: number;
  /** The whole in session-days, tokens and % of a fleet week; null when a part does not convert (no fresh rates). */
  days: number | null;
  tokens: number | null;
  share: number | null;
}

/** The task's own estimate in session-days: as given, or at its owner's pace; null with none, or no rates to convert it. */
export function ownDays(view: View, task: Task): number | null {
  if (task.est === null) return null;
  if (task.est.unit === 'd') return task.est.value;
  return view.rates?.days(task.est, task.owner) ?? null;
}

/** The task's own estimate in cache-read tokens: as given, or at its owner's pace; null with none, or no rates to convert it. */
export function ownTokens(view: View, task: Task): number | null {
  if (task.est === null) return null;
  if (task.est.unit === 'W') return task.est.value;
  return view.rates?.tokens(task.est, task.owner) ?? null;
}

/** The estimated sub-tasks under `id`, any depth, dropped ones (and theirs) left out; each once, so a cycle ends. */
function estimatedBelow(view: View, id: string, seen: Set<string>): Task[] {
  const out: Task[] = [];
  for (const childId of view.register.graph.sources(id, 'parent')) {
    const child = view.register.tasks.get(childId);
    if (child === undefined || child.status === 'dropped' || seen.has(childId)) continue;
    seen.add(childId);
    if (child.est !== null) out.push(child);
    out.push(...estimatedBelow(view, childId, seen));
  }
  return out;
}

/** The sum, or null when any value is unknown. */
function total(values: readonly (number | null)[]): number | null {
  let sum = 0;
  for (const v of values) {
    if (v === null) return null;
    sum += v;
  }
  return sum;
}

/** The task's size (design §14: a parent shows the sum and its own part); null when neither it nor a sub-task has an estimate. */
export function sizeOf(view: View, task: Task): Size | null {
  const below = estimatedBelow(view, task.id, new Set([task.id]));
  const all = task.est !== null ? [task, ...below] : below;
  if (all.length === 0) return null;
  const tokens = total(all.map((t) => ownTokens(view, t)));
  return {
    own: task.est,
    parts: below.length,
    days: total(all.map((t) => ownDays(view, t))),
    tokens,
    share: tokens !== null && view.rates !== null ? view.rates.share(tokens) : null,
  };
}

/** The size's head: a lone estimate as given, else the whole in days (or tokens, when only those add up); null when the parts do not add up. */
function wholeText(size: Size): string | null {
  if (size.parts === 0 && size.own !== null) return estimateText(size.own);
  if (size.days !== null) return daysText(size.days);
  return size.tokens !== null ? tokenText(size.tokens) : null;
}

/** A parent's note: `own 1d`, `sub-tasks` with no own estimate, or `+2 sub-task(s)` when the parts do not add up. */
function partsNote(size: Size, adds: boolean): string | null {
  if (size.parts === 0) return null;
  if (!adds) return `+${size.parts} sub-task(s)`;
  return size.own !== null ? `own ${estimateText(size.own)}` : 'sub-tasks';
}

/** The `list` part: `est 1.5d 2.1%`, a parent's `est 4d 5.6% (own 1d)`, `est 1d (+2 sub-task(s))` without rates; null with no estimate. */
export function sizeListText(size: Size | null): string | null {
  if (size === null) return null;
  const whole = wholeText(size);
  const head = whole ?? (size.own !== null ? estimateText(size.own) : null);
  const share = size.share !== null ? ` ${shareText(size.share)}` : '';
  const note = partsNote(size, whole !== null);
  return `est${head !== null ? ` ${head}` : ''}${share}${note !== null ? ` (${note})` : ''}`;
}

/** The `show` fact: `est 1.5d (initial 1d) ≈ 0.16B = 2.1% of a fleet week`, a parent's with `own 1d` in the brackets; null with no estimate. */
export function sizeFactText(size: Size | null, initial: Estimate | null): string | null {
  if (size === null) return null;
  const whole = wholeText(size);
  const head = whole ?? (size.own !== null ? estimateText(size.own) : null);
  const changed = initial !== null && size.own !== null && !sameEstimate(initial, size.own) ? `initial ${estimateText(initial)}` : null;
  const notes = [partsNote(size, whole !== null), changed].filter((n) => n !== null);
  const tokens = size.tokens !== null && tokenText(size.tokens) !== whole ? ` ≈ ${tokenText(size.tokens)}` : '';
  const share = size.share !== null ? ` = ${shareText(size.share)} of a fleet week` : '';
  return `est${head !== null ? ` ${head}` : ''}${notes.length > 0 ? ` (${notes.join(', ')})` : ''}${tokens}${share}`;
}
