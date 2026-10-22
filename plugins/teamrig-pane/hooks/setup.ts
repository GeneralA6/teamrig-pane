// A project teamrig is not set up for (places.ts: no team, no folder named) shows how to set it up in place of
// tasks (setup-rows.ts), and the pane looks for its register again every POLL_MS: a team made in the project, or a
// pointer file written there, starts the register (register.tsx bind) with no restart. A look that finds a problem,
// such as a pointer file that names no team, shows it over the steps and looks again; the look that finds the
// register ends the watch. Each look stats the pointer files up from the session's folder and the settings file,
// and lists the kit home's teams. The engine allows $ only at its call sites in a hook, so session.start hands this
// class ports built from $ calls rather than $ itself. Its timer never rejects: a failed look or write is tried again
// at the next poll.
import { messageOf } from './errors'
import { POLL_MS, type Timer } from './live'
import type { ProjectSetup, SetupView } from '../types'
import type { Places } from './places'


/** Places that name the register: what a look must find to end the watch. */
export type FoundPlaces = Extract<Places, { kind: 'found' }>

export type SetupPorts = {
  /** Looks for the register again, as the session's start did (places.ts findPlaces). */
  find: () => Promise<Places>
  /** Writes what the tasks view shows in place of tasks; null once the register is found. */
  show: (view: SetupView | null) => Promise<void>
  /** Starts reading the register a look found, in place of any started before (register.tsx). */
  bind: (places: FoundPlaces) => Promise<void>
}

/** Whether two views draw the same: the same folders, teams and problem. */
function isSameSetup(a: SetupView, b: SetupView): boolean {
  return (
    a.problem === b.problem &&
    a.setup.project === b.setup.project &&
    a.setup.settingsPath === b.setup.settingsPath &&
    a.setup.teams.join('\n') === b.setup.teams.join('\n')
  )
}

export class SetupWatch {
  private timers: Timer[] = []
  private isLooking = false
  /** The view it last wrote, or the first, which `show` writes. */
  private shown: SetupView
  /** Set when a write failed, so the next look writes even a view that did not change. */
  private mustShow = true
  private readonly ports: SetupPorts

  constructor(ports: SetupPorts, setup: ProjectSetup) {
    this.ports = ports
    this.shown = { setup, problem: null }
  }

  /** Writes the setup the session started with; a failed write is left to the next look. */
  async show(): Promise<void> {
    await this.write(this.shown)
  }

  /** Looks again every POLL_MS on the engine's clock; the look never rejects. */
  startTimers(every: (ms: number, fn: () => void) => Timer): void {
    this.stop()
    this.timers = [every(POLL_MS, () => void this.look())]
  }

  stop(): void {
    for (const timer of this.timers) timer.cancel()
    this.timers = []
  }

  /**
   * Looks for the register: found, it starts the register, clears the setup and ends the watch, in that order, so a
   * failed step looks again at the next poll; not set up still, it writes the setup when it changed; a problem, it
   * writes it over the last setup.
   */
  async look(): Promise<void> {
    if (this.isLooking) return
    this.isLooking = true
    try {
      const places = await this.ports.find()
      if (places.kind === 'found') {
        await this.ports.bind(places)
        await this.ports.show(null)
        this.stop()
        return
      }
      const next: SetupView = places.kind === 'unset' ? { setup: places.setup, problem: null } : { setup: this.shown.setup, problem: places.problem }
      if (!this.mustShow && isSameSetup(next, this.shown)) return
      await this.write(next)
    } catch (error) {
      await this.write({ setup: this.shown.setup, problem: messageOf(error) })
    } finally {
      this.isLooking = false
    }
  }

  /** Writes `view`, remembering it only once the write landed; a failed one is left to the next look. */
  private async write(view: SetupView): Promise<void> {
    try {
      await this.ports.show(view)
      this.shown = view
      this.mustShow = false
    } catch {
      this.mustShow = true
    }
  }
}
