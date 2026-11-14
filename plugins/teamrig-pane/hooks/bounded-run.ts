// Every process run the pane makes (the teamrig CLI, git) also ends by the pane's own clock, a grace past the timeout
// it asks the engine for. The readers hold a latch while a run is out (meetings.ts isReading, session-acts.ts and
// owner-acts.ts isRunning, changes.ts isReading), so one run the engine never settles would hold its view or its
// presses for the tab's life: an owner's Meetings view stayed on "Reading the meetings…" (T2807). Past the bound the
// run rejects, which each reader already shows as a run that did not finish; a late answer is dropped.
import type { Timer } from './live'

/** How long past its own timeout a run may take before the pane stops waiting for it. */
export const RUN_GRACE_MS = 5_000

/** A repeating timer, as `$.clock.every` starts one: the bound cancels it at its first fire. */
export type Every = (ms: number, fn: () => void) => Timer

/** `work`'s answer, or a rejection once `timeoutMs` and RUN_GRACE_MS pass without one. */
export function bounded<T>(work: Promise<T>, timeoutMs: number, every: Every): Promise<T> {
  const limitMs = timeoutMs + RUN_GRACE_MS
  return new Promise<T>((resolve, reject) => {
    let isSettled = false
    const finish = (settle: () => void): void => {
      if (isSettled) return
      isSettled = true
      timer.cancel()
      settle()
    }
    const timer = every(limitMs, () => finish(() => reject(new Error(`no answer in ${Math.round(limitMs / 1000)} s`))))
    work.then(
      value => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    )
  })
}
