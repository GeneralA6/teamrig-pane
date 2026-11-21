// The pane's state with its writes told: the app draws again when a press, a reader or the wheel changed what the
// screen shows, and no step has to say that it did. A write that leaves a key's value the one it held (the same
// value, not an equal one) is not told, so a drawing that writes back what it read never asks for another drawing.
import type { PaneKey, PaneStore } from '../hooks/pane-store'
import type { PaneState } from '../types'

/** `store`, telling `changed` of each key a write gave another value. */
export function watched(store: PaneStore, changed: (key: PaneKey) => void): PaneStore {
  return {
    read: key => store.read(key),
    async update<K extends PaneKey>(key: K, change: (current: PaneState[K]) => PaneState[K]): Promise<PaneState[K]> {
      let isSame = false
      const next = await store.update(key, current => {
        const made = change(current)
        isSame = Object.is(made, current)
        return made
      })
      if (!isSame) changed(key)
      return next
    },
  }
}
