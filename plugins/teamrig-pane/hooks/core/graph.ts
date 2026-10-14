// Copied from the register's src/graph.ts by scripts/sync-core.ts: change it there, then run the sync.
import type { GraphEvent } from './events.ts';
import { SINGLE_RELATIONS, type Relation, type WaitKind } from './model.ts';

/** Something a task waits on besides another task: the owner, a session, an event, an outside party. */
export interface Wait {
  /** `w1`, `w2`, …: allocated per task, so `resolve T5 w2` names it. */
  key: string;
  on: WaitKind;
  what: string;
  /** When the wait should be over; null = no date. */
  until: string | null;
  /** When the wait was opened, and by whom. */
  since: string;
  by: string;
  note: string | null;
  /** Null while the task still waits. */
  resolved: { at: string; by: string; note: string | null } | null;
}

export interface TaskNote {
  at: string;
  by: string;
  text: string;
}

export interface Link {
  from: string;
  rel: Relation;
  to: string;
}

/** The relations, waits and notes the v2 events leave: read-only for views, checks and write rules. */
export interface Graph {
  /** The tasks `id` links to by `rel`, oldest first. */
  targets(id: string, rel: Relation): readonly string[];
  /** The tasks that link to `id` by `rel` (the other direction). */
  sources(id: string, rel: Relation): readonly string[];
  waits(id: string): readonly Wait[];
  notes(id: string): readonly TaskNote[];
  /** Every link, for the checks that walk them all. */
  links(): Link[];
}

type Index = Map<string, Map<Relation, string[]>>;

function bucket(index: Index, id: string, rel: Relation): string[] {
  let byRel = index.get(id);
  if (!byRel) {
    byRel = new Map();
    index.set(id, byRel);
  }
  let ids = byRel.get(rel);
  if (!ids) {
    ids = [];
    byRel.set(rel, ids);
  }
  return ids;
}

function remove(ids: string[], id: string): void {
  const i = ids.indexOf(id);
  if (i >= 0) ids.splice(i, 1);
}

/** Built by the fold, one event at a time; both directions are indexed, so a lookup never scans every link. */
export class GraphBuilder implements Graph {
  private readonly out: Index = new Map();
  private readonly in: Index = new Map();
  private readonly waitsById = new Map<string, Wait[]>();
  private readonly notesById = new Map<string, TaskNote[]>();

  /** Applies one event; false when it changes nothing (a hand edit: a link twice, a missing link or wait). */
  apply(e: GraphEvent): boolean {
    switch (e.type) {
      case 'link':
        return this.link(e.id, e.rel, e.target);
      case 'unlink':
        return this.unlink(e.id, e.rel, e.target);
      case 'wait': {
        const waits = this.waitsById.get(e.id) ?? [];
        if (waits.some((w) => w.key === e.key)) return false;
        waits.push({ key: e.key, on: e.on, what: e.what, until: e.until, since: e.at, by: e.by, note: e.note, resolved: null });
        this.waitsById.set(e.id, waits);
        return true;
      }
      case 'resolve': {
        const waits = this.waitsById.get(e.id) ?? [];
        const i = waits.findIndex((w) => w.key === e.key && w.resolved === null);
        const wait = waits[i];
        if (wait === undefined) return false;
        waits[i] = { ...wait, resolved: { at: e.at, by: e.by, note: e.note } };
        return true;
      }
      case 'note': {
        const notes = this.notesById.get(e.id) ?? [];
        notes.push({ at: e.at, by: e.by, text: e.text });
        this.notesById.set(e.id, notes);
        return true;
      }
    }
  }

  targets(id: string, rel: Relation): readonly string[] {
    return this.out.get(id)?.get(rel) ?? [];
  }

  sources(id: string, rel: Relation): readonly string[] {
    return this.in.get(id)?.get(rel) ?? [];
  }

  waits(id: string): readonly Wait[] {
    return this.waitsById.get(id) ?? [];
  }

  notes(id: string): readonly TaskNote[] {
    return this.notesById.get(id) ?? [];
  }

  links(): Link[] {
    return [...this.out].flatMap(([from, byRel]) => [...byRel].flatMap(([rel, tos]) => tos.map((to) => ({ from, rel, to }))));
  }

  /** A single-target relation (parent, duplicate-of, superseded-by) replaces the old target. */
  private link(from: string, rel: Relation, to: string): boolean {
    const targets = bucket(this.out, from, rel);
    if (targets.includes(to)) return false;
    if (SINGLE_RELATIONS.includes(rel)) {
      for (const old of targets.splice(0)) remove(bucket(this.in, old, rel), from);
    }
    targets.push(to);
    bucket(this.in, to, rel).push(from);
    return true;
  }

  private unlink(from: string, rel: Relation, to: string): boolean {
    const targets = bucket(this.out, from, rel);
    if (!targets.includes(to)) return false;
    remove(targets, to);
    remove(bucket(this.in, to, rel), from);
    return true;
  }
}

/**
 * A graph plus links not written yet: the migration checks each proposed link against the ones it accepted before
 * it, so a cycle or a second parent among them is caught before anything is written. A pending link only adds: the
 * migration refuses a single relation that already has a target, so it never replaces one.
 */
export class OverlayGraph implements Graph {
  private readonly base: Graph;
  private readonly out: Index = new Map();
  private readonly in: Index = new Map();

  constructor(base: Graph) {
    this.base = base;
  }

  add(link: Link): void {
    bucket(this.out, link.from, link.rel).push(link.to);
    bucket(this.in, link.to, link.rel).push(link.from);
  }

  targets(id: string, rel: Relation): readonly string[] {
    return [...this.base.targets(id, rel), ...(this.out.get(id)?.get(rel) ?? [])];
  }

  sources(id: string, rel: Relation): readonly string[] {
    return [...this.base.sources(id, rel), ...(this.in.get(id)?.get(rel) ?? [])];
  }

  waits(id: string): readonly Wait[] {
    return this.base.waits(id);
  }

  notes(id: string): readonly TaskNote[] {
    return this.base.notes(id);
  }

  links(): Link[] {
    const pending = [...this.out].flatMap(([from, byRel]) => [...byRel].flatMap(([rel, tos]) => tos.map((to) => ({ from, rel, to }))));
    return [...this.base.links(), ...pending];
  }
}
