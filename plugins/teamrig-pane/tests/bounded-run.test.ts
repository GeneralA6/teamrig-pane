// The pane's own bound on a process run (hooks/bounded-run.ts): a run the engine never settles rejects once its
// timeout and a grace pass, and the bound's timer stops at the first answer.
import { describe, expect, test } from 'claude-code/testing'
import { RUN_GRACE_MS, bounded, type Every } from '../hooks/bounded-run'

/** A repeating timer the test fires by hand, recording the period it was started with and whether it was cancelled. */
function handClock(): { every: Every; fire: () => void; periods: number[]; isCancelled: () => boolean } {
  const periods: number[] = []
  let fire = (): void => undefined
  let isCancelled = false
  return {
    every: (ms, fn) => {
      periods.push(ms)
      fire = () => {
        if (!isCancelled) fn()
      }
      return {
        cancel: () => {
          isCancelled = true
        },
      }
    },
    fire: () => fire(),
    periods,
    isCancelled: () => isCancelled,
  }
}

const NEVER = new Promise<string>(() => undefined)

/** What `run` rejected with, as its message; null when it answered. */
async function rejection(run: Promise<unknown>): Promise<string | null> {
  return run.then(
    () => null,
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  )
}

describe('bounded', () => {
  test('a run that never settles rejects once its timeout and the grace pass; the timer stops', async () => {
    const clock = handClock()
    const run = bounded(NEVER, 30_000, clock.every)
    clock.fire()
    expect(await rejection(run)).toBe(`no answer in ${(30_000 + RUN_GRACE_MS) / 1000} s`)
    expect([clock.periods, clock.isCancelled()]).toEqual([[30_000 + RUN_GRACE_MS], true])
  })

  test("a run's answer or its own rejection passes through and stops the timer; a later fire changes nothing", async () => {
    const answered = handClock()
    const ok = bounded(Promise.resolve('listed'), 1_000, answered.every)
    expect(await ok).toBe('listed')
    answered.fire()
    expect(answered.isCancelled()).toBe(true)

    const refused = handClock()
    expect(await rejection(bounded(Promise.reject(new Error('timed out')), 1_000, refused.every))).toBe('timed out')
    expect(refused.isCancelled()).toBe(true)
  })
})
