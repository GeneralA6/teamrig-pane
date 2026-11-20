// The pane's state behind a port. The steps a press takes and the screen a drawing shows read and write the state
// (../types PaneState) through it and never name who keeps it, so any front end runs them: the Claude Code dock keeps
// the state in the engine's `$.state` (register.tsx atomStore), a front end with no engine, and the tests, in memory.
import type { PaneState } from '../types'

/** A key of the pane's state. */
export type PaneKey = keyof PaneState

/** Who keeps the pane's state. */
export interface PaneStore {
  /** The value `key` holds now. */
  read<K extends PaneKey>(key: K): Promise<PaneState[K]>
  /**
   * Writes what `change` makes of the value as last written, so a step written while this one runs is never lost;
   * resolves to the value written.
   */
  update<K extends PaneKey>(key: K, change: (current: PaneState[K]) => PaneState[K]): Promise<PaneState[K]>
}

/** The state kept in memory, from `initial` on. */
export class MemoryStore implements PaneStore {
  #state: PaneState

  constructor(initial: PaneState) {
    this.#state = initial
  }

  /** The whole state as it stands. */
  get state(): PaneState {
    return this.#state
  }

  read<K extends PaneKey>(key: K): Promise<PaneState[K]> {
    return Promise.resolve(this.#state[key])
  }

  update<K extends PaneKey>(key: K, change: (current: PaneState[K]) => PaneState[K]): Promise<PaneState[K]> {
    const next = change(this.#state[key])
    this.#state = { ...this.#state, [key]: next }
    return Promise.resolve(next)
  }
}
