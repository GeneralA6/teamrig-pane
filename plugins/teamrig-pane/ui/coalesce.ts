// Many asks, one run: a burst of writes (a press that changes four keys, a reader's refresh) asks for a drawing each
// time, and the screen is drawn once for them, a tick later. A run is never started while one is under way: asks
// heard meanwhile are answered by one more run once it ends, so the last drawing always shows the last write.

/** Runs `step` later: the next tick for the app, at once or by hand in a test. */
export type Defer = (step: () => void) => void

/**
 * An ask for `work` that any number of calls may make: `work` runs once for all the asks heard before it starts,
 * through `defer`, and one more time for those heard while it ran. A run that throws tells `failed` and asks stay
 * answered.
 */
export function coalesced(work: () => Promise<void>, defer: Defer, failed: (error: unknown) => void): () => void {
  let isAsked = false
  let isRunning = false
  const step = (): void => {
    isAsked = false
    isRunning = true
    void work()
      .catch(failed)
      .finally(() => {
        isRunning = false
        if (isAsked) defer(step)
      })
  }
  return () => {
    if (isAsked) return
    isAsked = true
    if (!isRunning) defer(step)
  }
}
