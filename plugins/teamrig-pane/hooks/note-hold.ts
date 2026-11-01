// Holds what the pane draws still while the owner types a Note on a task's card (T1299, owner-acts.ts). The engine
// keeps the focus ring at an index among the pane's elements, not on an element: a register write that adds a task, a
// heading or a line above the card while the field is open would move the ring off the field, and the keys typed next
// onto the pane's hotkeys. So from the field's opening the pane draws the snapshot as it stood then, and the newest
// one again once the field closes (sent or cancelled). A new opening (a new round) takes the newest one.
import type { OwnerAct } from '../types'

/** The value drawn while the Note field of one round is open. */
type Held<T> = { readonly round: number; readonly value: T }

export class NoteHold<T> {
  private held: Held<T> | null = null

  /** What to draw of `newest` while the act stands at `act`: the value held since the Note field opened, else `newest`. */
  drawn(newest: T, act: OwnerAct | null): T {
    if (act?.kind !== 'noting') {
      this.held = null
      return newest
    }
    if (this.held === null || this.held.round !== act.round) this.held = { round: act.round, value: newest }
    return this.held.value
  }
}
