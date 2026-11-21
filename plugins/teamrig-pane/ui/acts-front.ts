// A front with the acts on it: the owner's Note and Next on a task's card (hooks/owner-acts.ts) and the Teams tab's
// Meet and Wake (hooks/session-acts.ts), the dock's own classes run through the UI's process port and telling the
// UI's store. They are made once, on the first drawing: an act keeps where it stands (the open Note's round and
// draft, a run under way) between drawings, and the app's focus, which the owner's acts move the ring with, is the
// same at each.
import { OwnerActs } from '../hooks/owner-acts'
import type { PaneStore } from '../hooks/pane-store'
import { SessionActs } from '../hooks/session-acts'
import type { CliRun, TeamrigCli } from '../hooks/teamrig-cli'
import type { Focus, Front } from './app'

export type ActsDeps = {
  readonly cli: TeamrigCli
  /** Runs `argv` in the team's folder, where the CLI finds the team; rejects when it cannot start or outlasts `timeoutMs`. */
  readonly run: (argv: readonly string[], timeoutMs: number) => Promise<CliRun>
  readonly store: PaneStore
  /** The time now, epoch ms. */
  readonly now: () => number
}

/** `under` with the owner's and the sessions' acts in place of its own, and the Note field typed into the owner's. */
export function withActs(under: Front, deps: ActsDeps): (focus: Focus) => Front {
  let made: Front | null = null
  return focus => {
    if (made !== null) return made
    const acting = new OwnerActs(deps.cli, {
      run: deps.run,
      tell: async act => {
        await deps.store.update('ownerAct', () => act)
      },
      focus,
    })
    const pressing = new SessionActs(deps.cli, {
      run: deps.run,
      tell: async answer => {
        await deps.store.update('sessionAnswer', () => answer)
      },
      now: () => Promise.resolve(deps.now()),
    })
    made = {
      ports: { ...under.ports, acting, pressing },
      noting: { typed: text => acting.typed(text), send: (task, text) => acting.sendNote(task, text) },
    }
    return made
  }
}
