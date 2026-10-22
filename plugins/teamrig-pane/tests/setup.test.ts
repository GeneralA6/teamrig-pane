// The watch a project teamrig is not set up for runs (hooks/setup.ts): it writes the setup, looks again every
// POLL_MS, writes what a look changed and a problem over the last setup, and once a look finds the register it binds
// it, clears the setup and ends. A failed look, bind or write is tried again at the next poll.
import { describe, expect, test } from 'claude-code/testing'
import { POLL_MS } from '../hooks/live'
import { teamSettings, type Places } from '../hooks/places'
import { SetupWatch, type FoundPlaces, type SetupPorts } from '../hooks/setup'
import type { ProjectSetup, SetupView } from '../types'

const SETUP: ProjectSetup = { project: 'C:/w/app', teams: [] }
const FOUND: FoundPlaces = {
  kind: 'found',
  dirs: { tasksDir: 'C:/Homes/a/.teamrig/teams/web/state', inboxDir: 'C:/Homes/a/.teamrig/teams/web/inbox' },
  team: null,
  settings: teamSettings(null, 'UTC'),
  goalsDoc: null,
}

/**
 * Ports over a look's answer the test sets (an error to reject with), a write and a bind that fail while told to;
 * `calls` lists each port call in order, `shown` each view written, `bound` each places bound.
 */
function fakePorts(first: Places | Error) {
  let answer = first
  let isShowFailing = false
  let isBindFailing = false
  const calls: string[] = []
  const shown: Array<SetupView | null> = []
  const bound: FoundPlaces[] = []
  const ports: SetupPorts = {
    find: async () => {
      calls.push('find')
      if (answer instanceof Error) throw answer
      return answer
    },
    show: async view => {
      calls.push(view === null ? 'clear' : 'show')
      if (isShowFailing) throw new Error('store is down')
      shown.push(view)
    },
    bind: async places => {
      calls.push('bind')
      if (isBindFailing) throw new Error('EACCES: C:/Homes/a/.teamrig/teams/web/state')
      bound.push(places)
    },
  }
  return {
    ports,
    calls,
    shown,
    bound,
    answer: (next: Places | Error) => {
      answer = next
    },
    failShows: (isFailing: boolean) => {
      isShowFailing = isFailing
    },
    failBinds: (isFailing: boolean) => {
      isBindFailing = isFailing
    },
  }
}

/** Starts `watch`'s timers on a fake clock: each timer's period and whether it was cancelled. */
function timersOf(watch: SetupWatch) {
  const timers: { ms: number; isCancelled: boolean }[] = []
  watch.startTimers(ms => {
    const timer = { ms, isCancelled: false }
    timers.push(timer)
    return {
      cancel: () => {
        timer.isCancelled = true
      },
    }
  })
  return timers
}

describe('SetupWatch', () => {
  test('writes the setup it starts with, and looks again every POLL_MS until it stops', async () => {
    const fake = fakePorts({ kind: 'unset', setup: SETUP })
    const watch = new SetupWatch(fake.ports, SETUP)
    await watch.show()
    expect(fake.shown).toEqual([{ setup: SETUP, problem: null }])

    const timers = timersOf(watch)
    expect(timers).toEqual([{ ms: POLL_MS, isCancelled: false }])
    watch.stop()
    expect(timers[0]?.isCancelled).toBe(true)
  })

  test('a look that finds the project still not set up writes only a change: a team made on the machine lists it', async () => {
    const fake = fakePorts({ kind: 'unset', setup: SETUP })
    const watch = new SetupWatch(fake.ports, SETUP)
    await watch.show()
    await watch.look()
    expect(fake.shown.length).toBe(1)

    const withTeam: ProjectSetup = { ...SETUP, teams: ['web'] }
    fake.answer({ kind: 'unset', setup: withTeam })
    await watch.look()
    expect(fake.shown.at(-1)).toEqual({ setup: withTeam, problem: null })
  })

  test('a look that finds a problem writes it over the last setup, once, and the next look that finds none clears it', async () => {
    const problem = 'C:/w/app/.teamrig.json has no "team" text; expected {"team": "<id>"}'
    const fake = fakePorts({ kind: 'problem', problem, goalsDoc: null })
    const watch = new SetupWatch(fake.ports, SETUP)
    await watch.show()
    await watch.look()
    await watch.look()
    expect(fake.shown).toEqual([
      { setup: SETUP, problem: null },
      { setup: SETUP, problem },
    ])

    fake.answer({ kind: 'unset', setup: SETUP })
    await watch.look()
    expect(fake.shown.at(-1)).toEqual({ setup: SETUP, problem: null })
  })

  test('a look that fails shows why over the setup, and the next look tries again', async () => {
    const fake = fakePorts(new Error('EACCES: C:/w/app'))
    const watch = new SetupWatch(fake.ports, SETUP)
    await watch.show()
    await watch.look()
    expect(fake.shown.at(-1)).toEqual({ setup: SETUP, problem: 'EACCES: C:/w/app' })

    fake.answer(FOUND)
    await watch.look()
    expect(fake.bound).toEqual([FOUND])
  })

  test('a look that finds the register binds it, clears the setup and ends the watch, in that order', async () => {
    const fake = fakePorts({ kind: 'unset', setup: SETUP })
    const watch = new SetupWatch(fake.ports, SETUP)
    await watch.show()
    const timers = timersOf(watch)

    fake.answer(FOUND)
    await watch.look()
    expect(fake.calls).toEqual(['show', 'find', 'bind', 'clear'])
    expect(fake.bound).toEqual([FOUND])
    expect(fake.shown.at(-1)).toBeNull()
    expect(timers[0]?.isCancelled).toBe(true)
  })

  test('a bind that fails keeps the setup and the watch, shows why, and the next look binds again', async () => {
    const fake = fakePorts(FOUND)
    const watch = new SetupWatch(fake.ports, SETUP)
    await watch.show()
    const timers = timersOf(watch)

    fake.failBinds(true)
    await watch.look()
    expect(fake.shown.at(-1)).toEqual({ setup: SETUP, problem: 'EACCES: C:/Homes/a/.teamrig/teams/web/state' })
    expect(timers[0]?.isCancelled).toBe(false)

    fake.failBinds(false)
    await watch.look()
    expect(fake.bound).toEqual([FOUND])
    expect(fake.shown.at(-1)).toBeNull()
    expect(timers[0]?.isCancelled).toBe(true)
  })

  test('a write that failed is written again at the next look, though nothing changed', async () => {
    const fake = fakePorts({ kind: 'unset', setup: SETUP })
    const watch = new SetupWatch(fake.ports, SETUP)
    fake.failShows(true)
    await watch.show()
    expect(fake.shown).toEqual([])

    fake.failShows(false)
    await watch.look()
    expect(fake.shown).toEqual([{ setup: SETUP, problem: null }])
  })

  test('a look asked while one runs is skipped', async () => {
    const fake = fakePorts({ kind: 'unset', setup: SETUP })
    const watch = new SetupWatch(fake.ports, SETUP)
    await Promise.all([watch.look(), watch.look()])
    expect(fake.calls.filter(call => call === 'find')).toEqual(['find'])
  })
})
