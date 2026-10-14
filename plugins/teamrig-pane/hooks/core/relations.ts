// Copied from the register's src/relations.ts by scripts/sync-core.ts: change it there, then run the sync.
import type { Register, Task } from './fold.ts';
import type { Graph, Wait } from './graph.ts';
import { ACTIVE_STATUSES, ACYCLIC_RELATIONS, isClosingRelation, type Relation } from './model.ts';

/** What still holds a task back: an active task it is blocked by, or an open wait. */
export type Blocker = { kind: 'task'; id: string } | { kind: 'wait'; wait: Wait };

export function isActive(task: Task): boolean {
  return ACTIVE_STATUSES.includes(task.status);
}

/** Its active `blocked-by` targets (a closed or unknown one no longer blocks), then its open waits. */
export function openBlockers(register: Register, id: string): Blocker[] {
  const tasks = register.graph.targets(id, 'blocked-by').flatMap((to): Blocker[] => {
    const target = register.tasks.get(to);
    return target !== undefined && isActive(target) ? [{ kind: 'task', id: to }] : [];
  });
  const waits = register.graph.waits(id).flatMap((wait): Blocker[] => (wait.resolved === null ? [{ kind: 'wait', wait }] : []));
  return [...tasks, ...waits];
}

/** The active tasks whose parent is `id`. */
export function activeChildren(register: Register, id: string): Task[] {
  return register.graph.sources(id, 'parent').flatMap((child) => {
    const task = register.tasks.get(child);
    return task !== undefined && isActive(task) ? [task] : [];
  });
}

/** Whether a `from → to` link by `rel` would close a cycle: `to` already reaches `from` by `rel`. */
export function closesCycle(graph: Graph, from: string, rel: Relation, to: string): boolean {
  const seen = new Set<string>();
  const stack = [to];
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    if (id === from) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...graph.targets(id, rel));
  }
  return false;
}

/**
 * Why `from` may not link to `to` by `rel`, or null when it may. Permission is the
 * caller's check; this one keeps the graph meaningful: no self or unknown target,
 * no link twice, no blocker that can never clear, no cycle.
 */
export function linkRefusal(register: Register, from: Task, rel: Relation, to: string): string | null {
  if (to === from.id) return `${from.id} cannot link to itself`;
  const target = register.tasks.get(to);
  if (!target) return `no task ${to}`;
  if (register.graph.targets(from.id, rel).includes(to)) return `${from.id} already has ${rel} ${to}`;
  if (isClosingRelation(rel) && isActive(from)) return `${rel} closes a task: set ${from.id} --status dropped --${rel} ${to}`;
  if (rel === 'blocked-by' && !isActive(target)) return `${to} is ${target.status}: it cannot block ${from.id}`;
  if (rel === 'parent' && isActive(from) && !isActive(target)) return `${to} is ${target.status}: an active task cannot join it`;
  if (ACYCLIC_RELATIONS.includes(rel) && closesCycle(register.graph, from.id, rel, to)) {
    return `${rel} ${to} would close a cycle: ${to} already reaches ${from.id}`;
  }
  return null;
}

/** The next free wait key of a task: one past the highest ever used, so a key is never reused. */
export function nextWaitKey(waits: readonly Wait[]): string {
  const highest = Math.max(0, ...waits.map((w) => Number(w.key.slice(1))));
  return `w${highest + 1}`;
}
