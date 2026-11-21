// Asks coalesced into runs: one run for a burst, one more for the asks heard while it ran, none lost to a throw.
import { describe, expect, test } from 'claude-code/testing'
import { coalesced } from '../ui/coalesce'

/** Deferred steps run by hand, and a work whose every run ends when the test says. */
function bench() {
  const steps: (() => void)[] = []
  const ends: (() => void)[] = []
  const fails: ((error: unknown) => void)[] = []
  const failures: unknown[] = []
  let runs = 0
  const ask = coalesced(
    () =>
      new Promise<void>((resolve, reject) => {
        runs += 1
        ends.push(resolve)
        fails.push(reject)
      }),
    step => steps.push(step),
    error => failures.push(error),
  )
  const tick = (): void => {
    for (const step of steps.splice(0)) step()
  }
  const settled = (): Promise<void> => new Promise(resolve => setImmediate(resolve))
  return { ask, tick, settled, ends, fails, failures, steps, runs: () => runs }
}

describe('asks coalesced into runs', () => {
  test('nothing runs before the deferred step', () => {
    const { ask, runs, steps } = bench()
    ask()
    expect(runs()).toBe(0)
    expect(steps).toHaveLength(1)
  })

  test('a burst of asks is one run', () => {
    const { ask, tick, runs, steps } = bench()
    ask()
    ask()
    ask()
    expect(steps).toHaveLength(1)
    tick()
    expect(runs()).toBe(1)
  })

  test('asks heard while a run is under way are one more run, started only once it ends', async () => {
    const { ask, tick, settled, ends, runs, steps } = bench()
    ask()
    tick()
    ask()
    ask()
    expect(steps).toHaveLength(0)
    expect(runs()).toBe(1)
    ends[0]?.()
    await settled()
    expect(steps).toHaveLength(1)
    tick()
    expect(runs()).toBe(2)
  })

  test('a run that ends with no ask heard starts no other', async () => {
    const { ask, tick, settled, ends, runs, steps } = bench()
    ask()
    tick()
    ends[0]?.()
    await settled()
    expect(steps).toHaveLength(0)
    expect(runs()).toBe(1)
  })

  test('an ask after a run ended runs again', async () => {
    const { ask, tick, settled, ends, runs } = bench()
    ask()
    tick()
    ends[0]?.()
    await settled()
    ask()
    tick()
    expect(runs()).toBe(2)
  })

  test('a run that throws is told, and the next ask still runs', async () => {
    const { ask, tick, settled, fails, failures, runs } = bench()
    const error = new Error('no screen')
    ask()
    tick()
    fails[0]?.(error)
    await settled()
    expect(failures).toEqual([error])
    ask()
    tick()
    expect(runs()).toBe(2)
  })
})
