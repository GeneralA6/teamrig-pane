// Copied from the register's src/shown.ts by scripts/sync-core.ts: change it there, then run the sync.
import type { Register, Task } from './fold.ts';
import { shortDate, type TaskStatus } from './model.ts';
import type { PauseRule, PauseRules } from './pauses.ts';
import type { TokenRates } from './rates.ts';
import { openBlockers, type Blocker } from './relations.ts';

/** What the read commands see: the folded register, the pauses in force, and the token rates (design §14). */
export interface View {
  register: Register;
  pauses: PauseRules;
  /** From a usage run of the last 7 days (rates.ts); null shows each estimate in its own unit. */
  rates: TokenRates | null;
}

/** The status a reader sees: the stored one, or `blocked`/`paused` derived from links, waits and pauses. */
export type ShownStatus = TaskStatus | 'paused';

/** What a tracker maps a status to: ours, chosen to map onto Linear's workflow types and Jira's status categories (review → started / In Progress). */
export type StatusCategory = 'backlog' | 'todo' | 'started' | 'review' | 'done' | 'cancelled';

const CATEGORY: Readonly<Record<ShownStatus, StatusCategory>> = {
  open: 'todo',
  'in-progress': 'started',
  blocked: 'started',
  verifying: 'review',
  done: 'done',
  dropped: 'cancelled',
  paused: 'backlog',
};

export function categoryOf(status: ShownStatus): StatusCategory {
  return CATEGORY[status];
}

export interface Shown {
  status: ShownStatus;
  /** What holds an active task back, whether or not it decides the status. */
  blockers: Blocker[];
  pause: PauseRule | null;
}

/**
 * The first that holds: stored done, dropped or verifying (shipped work is never hidden); blocked while an
 * active blocked-by target or an open wait remains, or stored `blocked` (a manual block names what it waits on,
 * which a pause must not hide); paused by the oldest matching pause; the stored status.
 */
export function shown(view: View, task: Task): Shown {
  if (task.status === 'done' || task.status === 'dropped' || task.status === 'verifying') {
    return { status: task.status, blockers: [], pause: null };
  }
  const blockers = openBlockers(view.register, task.id);
  const pause = view.pauses.pausing(task);
  const status: ShownStatus = blockers.length > 0 || task.status === 'blocked' ? 'blocked' : pause !== null ? 'paused' : task.status;
  return { status, blockers, pause };
}

/** How a closed task ended: a drop with a `duplicate-of` or `superseded-by` link says which. */
export type Resolution = 'done' | 'duplicate' | 'superseded' | 'dropped';

export function resolution(register: Register, task: Task): Resolution | null {
  if (task.status === 'done') return 'done';
  if (task.status !== 'dropped') return null;
  if (register.graph.targets(task.id, 'duplicate-of').length > 0) return 'duplicate';
  if (register.graph.targets(task.id, 'superseded-by').length > 0) return 'superseded';
  return 'dropped';
}

/** A parent's progress: done children of those not dropped (a dropped child is no longer work). */
export function childProgress(register: Register, id: string): { done: number; total: number } | null {
  const children = register.graph.sources(id, 'parent').flatMap((c) => {
    const child = register.tasks.get(c);
    return child === undefined || child.status === 'dropped' ? [] : [child];
  });
  if (children.length === 0) return null;
  return { done: children.filter((c) => c.status === 'done').length, total: children.length };
}

/** The list markers: `⛔T194` blocker, `⏳owner` open wait, `↑T205` parent, `⏸P1` paused, `✓3/5` children done, `🔍10-15 06:00` proof due. */
export function markers(view: View, task: Task, seen: Shown = shown(view, task)): string[] {
  const out = seen.blockers.map((b) => (b.kind === 'task' ? `⛔${b.id}` : `⏳${b.wait.on}`));
  const parent = view.register.graph.targets(task.id, 'parent')[0];
  if (parent !== undefined) out.push(`↑${parent}`);
  if (seen.pause !== null) out.push(`⏸${seen.pause.id}`);
  const progress = childProgress(view.register, task.id);
  if (progress !== null) out.push(`✓${progress.done}/${progress.total}`);
  if (task.status === 'verifying' && task.evidenceDue !== null) out.push(`🔍${shortDate(task.evidenceDue)}`);
  return out;
}
