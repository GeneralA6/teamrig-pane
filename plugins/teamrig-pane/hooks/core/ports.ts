// Copied from the register's src/ports.ts by scripts/sync-core.ts: change it there, then run the sync.
// The register's storage ports: what the pure modules read and lock through. store.ts holds the
// file-backed implementations; a reader with no file system (the task pane) needs only these types.
import type { TaskEvent } from './events.ts';
import type { Usage } from './rates.ts';

export interface EventRead {
  events: TaskEvent[];
  /** Lines that are not a well-formed event (a torn or hand-edited line). */
  unreadable: number;
}

/** Where the events live. Reads need no lock: every append is one whole line. */
export interface EventLog {
  read(): EventRead;
  append(event: TaskEvent): void;
}

/** Serializes the register's read-check-append steps across processes. */
export interface Mutex {
  run<T>(fn: () => T): Promise<T>;
}

/** The token-usage files (rates.ts): read once per command, never written. */
export interface UsageSource {
  read(): Usage;
}
