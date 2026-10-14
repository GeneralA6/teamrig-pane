// Copied from the register's src/fold.ts by scripts/sync-core.ts: change it there, then run the sync.
import type { TaskEvent } from './events.ts';
import { GraphBuilder, type Graph } from './graph.ts';
import { dueInstant, MIGRATION_ORIGIN, type Estimate, type TaskFields, type TaskStatus, type WaitKind } from './model.ts';

/** A task as the events written so far leave it. */
export interface Task extends TaskFields {
  id: string;
  status: TaskStatus;
  createdAt: string;
  createdBy: string;
  /** The uid its create carried (a sync adapter's); null = derived from the create (identity.ts). */
  uid: string | null;
  /** The newest event of any kind but the migration's: `check` flags an active task whose newest event is old. */
  updatedAt: string;
  updatedBy: string;
  /** The newest status event's note (why it is blocked or dropped, what was done). */
  note: string | null;
  /** The newest evidence recorded (a sha or a path). */
  evidence: string | null;
  /** When the current owner got the task: its create, or the newest handoff. */
  assignedAt: string;
  /**
   * The owner before the newest handoff (null = never handed off), and how many handoffs followed the create
   * (design §13; PING-PONG at 3). Names are read through the rename log, so a rename is not a handoff, nor is a
   * migration fix.
   */
  previousOwner: string | null;
  reassigns: number;
  /** The current owner's newest event since then; null = it has not touched the task yet. */
  ownerSeenAt: string | null;
  /** From the newest status event (register v2): when a `verifying` task's proof is due, */
  evidenceDue: string | null;
  /** what a manual `blocked` waits on, */
  blockedReason: WaitKind | null;
  /** and who decided a `dropped`. */
  decidedBy: string | null;
  /** The newest status's name in an external workflow (`In QA`), from a sync adapter. */
  statusName: string | null;
  /** The actuals (design §12): the first status event to in-progress, */
  startedAt: string | null;
  /** and the one that made it done (null while it is not done, so a reopen clears it). */
  doneAt: string | null;
  /** How often the due and the eta changed after their first value (REDATED at 3). */
  dueRevisions: number;
  etaRevisions: number;
  /** The first estimate given (design §14: `est` is the latest, re-estimated at `set in-progress`); null until one is. */
  estInitial: Estimate | null;
}

/** How many times a field changed after its first value: setting it from none the first time is not a revision. */
function revisions(count: number, before: string | null, after: string | null): number {
  if (after === before) return count;
  return before !== null || count > 0 ? count + 1 : count;
}

export interface Register {
  tasks: ReadonlyMap<string, Task>;
  /** Links, waits and notes (register v2). */
  graph: Graph;
  /** Events naming no created task, creating one twice, or changing nothing (hand edits, corruption). */
  orphans: number;
  /** The highest task number any event names, so a new id never reuses one. */
  maxNumber: number;
}

/** Replays the events in write order (the register appends under its lock). */
export function fold(events: readonly TaskEvent[]): Register {
  const tasks = new Map<string, Task>();
  const graph = new GraphBuilder();
  let orphans = 0;
  let maxNumber = 0;
  for (const e of events) {
    maxNumber = Math.max(maxNumber, Number(e.id.slice(1)));
    const current = tasks.get(e.id);
    if (e.type === 'create') {
      if (current) {
        orphans++;
        continue;
      }
      tasks.set(e.id, {
        ...e.task,
        id: e.id,
        status: 'open',
        createdAt: e.at,
        createdBy: e.by,
        updatedAt: e.at,
        updatedBy: e.by,
        note: null,
        evidence: null,
        assignedAt: e.at,
        previousOwner: null,
        reassigns: 0,
        ownerSeenAt: e.by === e.task.owner ? e.at : null,
        evidenceDue: null,
        blockedReason: null,
        decidedBy: null,
        uid: e.uid ?? null,
        statusName: null,
        startedAt: null,
        doneAt: null,
        dueRevisions: 0,
        etaRevisions: 0,
        estInitial: e.task.est,
      });
      continue;
    }
    if (!current) {
      orphans++;
      continue;
    }
    if (e.type === 'status' && e.origin === MIGRATION_ORIGIN) {
      // The migration only types a manual blocked's reason: every v1 field folds as before.
      tasks.set(e.id, { ...current, blockedReason: e.reason ?? current.blockedReason });
      continue;
    }
    if (e.type === 'update' && e.origin === MIGRATION_ORIGIN) {
      // Like its links and waits, the migration's field fixes are not a session working on the task, nor a re-date.
      tasks.set(e.id, { ...current, ...e.changes });
      continue;
    }
    const touched = { updatedAt: e.at, updatedBy: e.by };
    if (e.type === 'status' || e.type === 'update') {
      const next: Task =
        e.type === 'status'
          ? {
              ...current,
              ...touched,
              status: e.status,
              note: e.note,
              evidence: e.evidence ?? current.evidence,
              evidenceDue: e.evidenceDue ?? null,
              blockedReason: e.reason ?? null,
              decidedBy: e.decidedBy ?? null,
              statusName: e.name ?? null,
              startedAt: current.startedAt ?? (e.status === 'in-progress' ? e.at : null),
              // A done set again (progress on a closed task) keeps the moment it closed.
              doneAt: e.status !== 'done' ? null : current.status === 'done' ? current.doneAt : e.at,
            }
          : {
              ...current,
              ...e.changes,
              ...touched,
              dueRevisions: e.changes.due === undefined ? current.dueRevisions : revisions(current.dueRevisions, current.due, e.changes.due),
              etaRevisions: e.changes.eta === undefined ? current.etaRevisions : revisions(current.etaRevisions, current.eta, e.changes.eta),
              estInitial: current.estInitial ?? e.changes.est ?? null,
            };
      const handedOff = next.owner !== current.owner;
      tasks.set(e.id, {
        ...next,
        assignedAt: handedOff ? e.at : current.assignedAt,
        previousOwner: handedOff ? current.owner : current.previousOwner,
        reassigns: handedOff ? current.reassigns + 1 : current.reassigns,
        ownerSeenAt: e.by === next.owner ? e.at : handedOff ? null : current.ownerSeenAt,
      });
      continue;
    }
    if (!graph.apply(e)) {
      orphans++;
      continue;
    }
    // The migration's links and waits are not a session working on the task: STALE and NOT-PICKED-UP keep their clocks.
    if (e.origin === MIGRATION_ORIGIN) continue;
    tasks.set(e.id, { ...current, ...touched, ownerSeenAt: e.by === current.owner ? e.at : current.ownerSeenAt });
  }
  return { tasks, graph, orphans, maxNumber };
}

export function nextId(register: Register): string {
  return `T${register.maxNumber + 1}`;
}

/** Tier first, then the earliest due (undated last), then the oldest id. */
export function byPlanOrder(a: Task, b: Task): number {
  if (a.tier !== b.tier) return a.tier - b.tier;
  const ad = dueTime(a);
  const bd = dueTime(b);
  if (ad !== bd) return ad - bd;
  return Number(a.id.slice(1)) - Number(b.id.slice(1));
}

function dueTime(task: Task): number {
  return (task.due === null ? null : dueInstant(task.due))?.getTime() ?? Number.POSITIVE_INFINITY;
}
