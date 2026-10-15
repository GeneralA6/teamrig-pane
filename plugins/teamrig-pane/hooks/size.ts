// Whether the pane is open or minimized to its one-row strip. The engine draws a close mark (✕) on
// every pane and gives a mod no way to hide it; the person's close (the ✕, ctrl+x x) is refused in
// register.tsx and minimizes the pane instead, so a stray click never loses it. The size is drawn
// from $.state (it outlives a hot reload) and kept in $.store under one key for the whole plugin, so
// the next session, after a restart too, opens at the size the person left it.
import type { PaneCloseOrigin } from 'claude-code'
import type { PaneSize } from '../types'

/** The $.store key: one for the plugin, not per session, so a new session opens as the last one was left. */
export const SIZE_KEY = 'paneSize'

/** A stored size; anything else (nothing stored, an older value) is `open`, the pane in full. */
export function storedSize(value: unknown): PaneSize {
  return value === 'minimized' ? 'minimized' : 'open'
}

export type SizePorts = {
  /** The stored size, as $.store.get answers it. */
  load: () => Promise<unknown>
  /** Keeps the size for later sessions. */
  save: (size: PaneSize) => Promise<void>
  /** Writes the size atom (each write redraws the pane). */
  show: (size: PaneSize) => Promise<void>
}

export class PaneSizer {
  private readonly ports: SizePorts

  constructor(ports: SizePorts) {
    this.ports = ports
  }

  /** Draws the size the store kept: `open` when none is kept or the store cannot be read. */
  async restore(): Promise<PaneSize> {
    const size = storedSize(await this.ports.load().catch(() => undefined))
    await this.ports.show(size).catch(() => undefined)
    return size
  }

  /**
   * Whether the pane's close is refused, minimizing it instead: the person's is (the ✕, ctrl+x x);
   * the plugin's own and the engine's unload go through.
   */
  async refusesClose(origin: PaneCloseOrigin): Promise<boolean> {
    if (origin.kind !== 'person') return false
    await this.set('minimized')
    return true
  }

  /**
   * Draws `size` at once, then keeps it. Never rejects, so the close hook always answers its refusal. A
   * failed save only means the next session opens at the size kept before.
   */
  async set(size: PaneSize): Promise<void> {
    await this.ports.show(size).catch(() => undefined)
    await this.ports.save(size).catch(() => undefined)
  }
}
