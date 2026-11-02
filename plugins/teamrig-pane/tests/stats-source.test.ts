// The Stats tab's source (hooks/stats-source.ts): teamrig's stats fold and Health tiles over the scope the tab picks,
// in the tree of teams that holds the pane's team; the own register at the pane's register, a peer's in its state
// folder, each read once a scope takes it in; folded again only when a history, the scope, the range or the minute
// moves; the scope's week; written only when it changed, read only while the tab shows; a press during a read reads
// again after it; a folder or register whose read fails drawn as it last read, or left out before one, and named.
import { describe, expect, test } from 'claude-code/testing'
import type { StatsView } from '../types'
import { TEAM_WEEK_FORMAT, TimeZone, readEvents, registerHealth, registerStats, type StatsRange, type StatsScope, type StatsTeam, type TeamWeekSummary } from '../hooks/core/read/index'
import { POLL_MS, TICK_MS } from '../hooks/live'
import type { TeamFiles } from '../hooks/places'
import type { FileStamp, Files } from '../hooks/source'
import { LiveStats, type StatsPick, type StatsSettings } from '../hooks/stats-source'
import { weekOf } from '../hooks/team'
import { HOUR, MemoryFiles, NOW, createLine, statusLine, waitingLine } from './fixtures'
import { weekFile } from './team-fixtures'

const DAY = 24 * HOUR
const TEAMS = 'K/teams'
const ACME_HOME = `${TEAMS}/acme`
const TOOLS_HOME = `${TEAMS}/tools`
const FILES: TeamFiles = { team: 'acme', dir: ACME_HOME, teamsDir: TEAMS, config: `${ACME_HOME}/config.json`, renames: `${ACME_HOME}/state/renames.jsonl`, turnLog: null }
/** The pane's register: the own team's events, outside its state folder. */
const OWN_EVENTS = 'K/tasks/events.jsonl'
const TOOLS_EVENTS = `${TOOLS_HOME}/state/events.jsonl`
const OTHER_EVENTS = `${TEAMS}/other/state/events.jsonl`
const SETTINGS: StatsSettings = { events: OWN_EVENTS, zone: TimeZone.UTC, ownerMarker: 'owner' }
const BUSY = 'EBUSY: resource busy or locked'
const DENIED = 'EPERM: operation not permitted'

const ACME_CONFIG = { team: { id: 'acme' }, sessions: ['lead', 'api'], roles: { lead: 'lead' } }
const TOOLS_CONFIG = { team: { id: 'tools', parent: 'acme' }, sessions: ['boss', 'dev'], roles: { lead: 'boss' } }
/** A root team of its own: not in the tree that holds acme. */
const OTHER_CONFIG = { team: { id: 'other' }, sessions: ['solo'], roles: { lead: 'solo' } }

/** acme: api works T1; lead's T2 waits on the owner's decision. */
const ACME_LINES = [
  createLine('T1', { at: NOW - 3 * DAY, by: 'lead', owner: 'api', title: 'Add the route' }),
  statusLine('T1', 'api', NOW - 2 * DAY, 'in-progress'),
  createLine('T2', { at: NOW - 2 * DAY, by: 'lead', owner: 'lead', title: 'Pick the database' }),
  waitingLine('T2', 'lead', NOW - DAY, [{ kind: 'decision', who: 'owner' }]),
]
/** tools: dev fixed T3. */
const TOOLS_LINES = [
  createLine('T3', { at: NOW - 4 * DAY, by: 'boss', owner: 'dev', title: 'Fix the build' }),
  statusLine('T3', 'dev', NOW - DAY, 'done', 'fixed', 'abc1234', 'none'),
]
const T4_CREATE = createLine('T4', { at: NOW - HOUR, by: 'boss', owner: 'dev', title: 'Speed up the build' })

const text = (lines: readonly string[]) => lines.map(line => `${line}\n`).join('')
const ACME: StatsTeam = { team: 'acme', lead: 'lead', events: readEvents(text(ACME_LINES)).events }
const TOOLS: StatsTeam = { team: 'tools', lead: 'boss', events: readEvents(text(TOOLS_LINES)).events }

const TREE: StatsPick = { scope: { kind: 'tree' }, range: '7d' }
const ACME_WEEK = weekFile(20, 30)
const TOOLS_WEEK = weekFile(10, 15)
const weekText = (week: TeamWeekSummary) => JSON.stringify({ v: TEAM_WEEK_FORMAT, ...week })

/** The view teamrig's fold gives `teams` in the tree of acme and tools at `at`, with no week and no failure. */
function folded(teams: readonly StatsTeam[], pick: StatsPick, at = NOW, session?: StatsScope): StatsView {
  const stats = registerStats({ teams, range: pick.range, now: new Date(at), zone: TimeZone.UTC, ownerMarker: 'owner', ...(session === undefined ? {} : { session }) })
  return { kind: 'stats', scope: pick.scope, range: pick.range, teams: ['acme', 'tools'], stats, health: registerHealth(stats), week: null, failures: [] }
}

/** The fake disk with each path whose next reads fail, by path, until the test clears it. */
class FailingFiles implements Files {
  readonly disk: MemoryFiles
  readonly failing = new Map<string, string>()

  constructor(disk: MemoryFiles) {
    this.disk = disk
  }

  stamp(path: string): Promise<FileStamp | null> {
    return this.disk.stamp(path)
  }

  async read(path: string): Promise<string> {
    const failure = this.failing.get(path)
    if (failure !== undefined) throw new Error(failure)
    return this.disk.read(path)
  }
}

/** acme's and tools' configs and registers, and other's config and register beside their tree. */
function teamsDisk(): MemoryFiles {
  const disk = new MemoryFiles()
  disk.write(FILES.config, JSON.stringify(ACME_CONFIG))
  disk.write(`${TOOLS_HOME}/config.json`, JSON.stringify(TOOLS_CONFIG))
  disk.write(`${TEAMS}/other/config.json`, JSON.stringify(OTHER_CONFIG))
  disk.write(OWN_EVENTS, text(ACME_LINES))
  disk.write(TOOLS_EVENTS, text(TOOLS_LINES))
  disk.write(OTHER_EVENTS, text([createLine('T9', { at: NOW - DAY, by: 'solo', owner: 'solo' })]))
  return disk
}

/**
 * A LiveStats over the fake disk and a fake folder list, with whether the tab shows, the tab's pick and the clock's now
 * set by the test, and each write it made. A closed gate holds `choice` (after it took the pick) until it opens.
 */
function fakeStats(disk: MemoryFiles) {
  const files = new FailingFiles(disk)
  const shown = { tab: true }
  const clock = { now: NOW }
  const pick: { value: StatsPick } = { value: TREE }
  const listed: { names: readonly string[]; failure: string | null } = { names: ['acme', 'other', 'tools'], failure: null }
  const gate: { held: Promise<void> | null } = { held: null }
  const views: StatsView[] = []
  const writes = { fail: false }
  const live = new LiveStats(files, FILES, SETTINGS, {
    folders: async dir => {
      if (listed.failure !== null) throw new Error(listed.failure)
      return dir === TEAMS ? listed.names : []
    },
    isShown: async () => shown.tab,
    choice: async () => {
      const value = pick.value
      if (gate.held !== null) await gate.held
      return value
    },
    publish: async view => {
      if (writes.fail) throw new Error('write refused')
      views.push(view)
    },
    now: async () => clock.now,
  })
  return { live, files, shown, clock, pick, listed, gate, views, writes }
}

describe('LiveStats', () => {
  test("folds the own register at the pane's register and a child team's in its state folder, never a team outside the tree; a refresh with nothing moved reads and writes nothing", async () => {
    const disk = teamsDisk()
    const { live, views } = fakeStats(disk)
    await live.refresh()
    expect(views).toEqual([folded([ACME, TOOLS], TREE)])
    expect(disk.reads).toContain(OWN_EVENTS)
    expect(disk.reads).toContain(TOOLS_EVENTS)
    expect(disk.reads).not.toContain(`${ACME_HOME}/state/events.jsonl`)
    expect(disk.reads).not.toContain(OTHER_EVENTS)

    disk.reads.length = 0
    await live.refresh()
    expect([disk.reads, views.length]).toEqual([[], 1])

    disk.write(TOOLS_EVENTS, text([...TOOLS_LINES, T4_CREATE]))
    await live.refresh()
    expect(disk.reads).toEqual([TOOLS_EVENTS])
    expect(views.at(-1)).toEqual(folded([ACME, { ...TOOLS, events: readEvents(text([...TOOLS_LINES, T4_CREATE])).events }], TREE))
  })

  test("a team's scope folds it and the teams under it, reading only their registers; a session's folds its tasks in its team", async () => {
    const disk = teamsDisk()
    const { live, pick, views } = fakeStats(disk)
    pick.value = { scope: { kind: 'team', team: 'tools' }, range: '30d' }
    await live.refresh()
    expect(views).toEqual([folded([TOOLS], pick.value)])
    expect(disk.reads).not.toContain(OWN_EVENTS)

    pick.value = { scope: { kind: 'team', team: 'acme' }, range: 'all' }
    await live.refresh()
    expect(views.at(-1)).toEqual(folded([ACME, TOOLS], pick.value))

    pick.value = { scope: { kind: 'session', team: 'acme', session: 'api' }, range: '14d' }
    disk.reads.length = 0
    await live.refresh()
    expect(views.at(-1)).toEqual(folded([ACME], pick.value, NOW, { team: 'acme', session: 'api' }))
    expect(disk.reads).toEqual([])
  })

  test('a scope naming a team not in the tree folds the whole tree', async () => {
    const disk = teamsDisk()
    const { live, pick, views } = fakeStats(disk)
    pick.value = { scope: { kind: 'team', team: 'other' }, range: '7d' }
    await live.refresh()
    pick.value = { scope: { kind: 'session', team: 'gone', session: 'dev' }, range: '7d' }
    await live.refresh()
    expect(views).toEqual([folded([ACME, TOOLS], TREE)])
    expect(disk.reads).not.toContain(OTHER_EVENTS)
  })

  test("folds again only when the minute moves, so a waiting owner's days move once a minute, not at every poll", async () => {
    const disk = teamsDisk()
    const { live, clock, views } = fakeStats(disk)
    await live.refresh()
    clock.now = NOW + TICK_MS - 1
    await live.refresh()
    expect(views.length).toBe(1)

    clock.now = NOW + TICK_MS
    await live.refresh()
    const later = folded([ACME, TOOLS], TREE, NOW + TICK_MS)
    expect(views).toEqual([folded([ACME, TOOLS], TREE), later])
    expect(later.kind === 'stats' ? [later.health.ownerDecisions.count, later.stats.waits.ownerDecisions.oldestDays] : []).toEqual([1, (DAY + TICK_MS) / DAY])
  })

  test("the scope's week sums its teams' week files, a session's its team's", async () => {
    const disk = teamsDisk()
    disk.write(`${ACME_HOME}/state/usage/team.week.json`, weekText(ACME_WEEK))
    disk.write(`${TOOLS_HOME}/state/usage/team.week.json`, weekText(TOOLS_WEEK))
    const { live, pick, views } = fakeStats(disk)
    await live.refresh()
    pick.value = { scope: { kind: 'session', team: 'tools', session: 'dev' }, range: '7d' }
    await live.refresh()
    const weeks = views.map(view => (view.kind === 'stats' ? view.week : undefined))
    expect(weeks).toEqual([weekOf([ACME_WEEK, TOOLS_WEEK], NOW), weekOf([TOOLS_WEEK], NOW)])
    expect(weeks[0]).not.toEqual(weeks[1])
  })

  test("a state folder the peer's config moves reads its register from there; a team folder no longer listed is read anew when listed again", async () => {
    const disk = teamsDisk()
    const { live, listed, views } = fakeStats(disk)
    await live.refresh()
    disk.write(`${TOOLS_HOME}/config.json`, JSON.stringify({ ...TOOLS_CONFIG, paths: { state: 'kept' } }))
    disk.write(`${TOOLS_HOME}/kept/events.jsonl`, text([T4_CREATE]))
    await live.refresh()
    expect(views.at(-1)).toEqual(folded([ACME, { ...TOOLS, events: readEvents(text([T4_CREATE])).events }], TREE))

    listed.names = ['acme']
    await live.refresh()
    listed.names = ['acme', 'tools']
    disk.reads.length = 0
    await live.refresh()
    expect(disk.reads).toEqual([`${TOOLS_HOME}/config.json`, `${TOOLS_HOME}/kept/events.jsonl`])
  })

  test("a folder list, the own team's folder or the own register that fails before any read of it worked fails the view; no config is no team", async () => {
    const disk = teamsDisk()
    const { live, files, listed, views } = fakeStats(disk)
    listed.failure = 'EACCES: permission denied, scandir K/teams'
    await live.refresh()
    listed.failure = null
    disk.failNextRead = BUSY
    await live.refresh()
    files.failing.set(OWN_EVENTS, DENIED)
    await live.refresh()
    expect(views).toEqual([
      { kind: 'failed', reason: 'EACCES: permission denied, scandir K/teams' },
      { kind: 'failed', reason: BUSY },
      { kind: 'failed', reason: DENIED },
    ])

    files.failing.clear()
    await live.refresh()
    expect(views.at(-1)).toEqual(folded([ACME, TOOLS], TREE))

    disk.remove(FILES.config)
    await live.refresh()
    expect(views.at(-1)).toEqual({ kind: 'no-team' })
  })

  test("a register whose read fails is left out before a read of it worked, else folded as it last read, named with why; the next read that works clears it", async () => {
    const disk = teamsDisk()
    const { live, files, views } = fakeStats(disk)
    files.failing.set(TOOLS_EVENTS, BUSY)
    await live.refresh()
    expect(views).toEqual([{ ...folded([ACME], TREE), failures: [{ team: 'tools', reason: BUSY, isLastRead: false }] }])

    files.failing.clear()
    await live.refresh()
    expect(views.at(-1)).toEqual(folded([ACME, TOOLS], TREE))

    disk.write(TOOLS_EVENTS, text([...TOOLS_LINES, T4_CREATE]))
    disk.write(OWN_EVENTS, text([...ACME_LINES, T4_CREATE]))
    files.failing.set(TOOLS_EVENTS, BUSY)
    files.failing.set(OWN_EVENTS, BUSY)
    await live.refresh()
    const failures = [
      { team: 'acme', reason: BUSY, isLastRead: true },
      { team: 'tools', reason: BUSY, isLastRead: true },
    ]
    expect(views.at(-1)).toEqual({ ...folded([ACME, TOOLS], TREE), failures })
  })

  test('a peer folder whose read fails is left out before a read of it worked, named with why', async () => {
    const disk = teamsDisk()
    const { live, files, views } = fakeStats(disk)
    files.failing.set(`${TOOLS_HOME}/config.json`, BUSY)
    await live.refresh()
    expect(views).toEqual([{ ...folded([ACME], TREE), teams: ['acme'], failures: [{ team: 'tools', reason: BUSY, isLastRead: false }] }])
  })

  test('a poll reads only while the tab shows; a write that failed is made by the next refresh', async () => {
    const disk = teamsDisk()
    const { live, shown, views, writes } = fakeStats(disk)
    shown.tab = false
    await live.poll()
    expect([views.length, disk.reads.length]).toEqual([0, 0])

    shown.tab = true
    writes.fail = true
    await live.poll()
    expect(views.length).toBe(0)

    writes.fail = false
    await live.refresh()
    expect(views).toEqual([folded([ACME, TOOLS], TREE)])
  })

  test('a refresh asked while one reads runs again after it, so a press during a poll is not lost', async () => {
    const disk = teamsDisk()
    const { live, pick, gate, views } = fakeStats(disk)
    let open = () => {}
    gate.held = new Promise<void>(resolve => {
      open = resolve
    })
    const first = live.refresh()
    const tools: StatsPick = { scope: { kind: 'team', team: 'tools' }, range: '7d' }
    pick.value = tools
    gate.held = null
    await live.refresh()
    expect(views).toEqual([])

    open()
    await first
    expect(views).toEqual([folded([ACME, TOOLS], TREE), folded([TOOLS], tools)])
  })

  test('its timer polls every POLL_MS until stopped', async () => {
    const disk = teamsDisk()
    const { live, views } = fakeStats(disk)
    const timers: { ms: number; fn: () => void; cancelled: boolean }[] = []
    live.startTimers((ms, fn) => {
      const timer = { ms, fn, cancelled: false }
      timers.push(timer)
      return { cancel: () => (timer.cancelled = true) }
    })
    expect(timers.map(timer => timer.ms)).toEqual([POLL_MS])
    timers[0]?.fn()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(views.length).toBe(1)
    live.stop()
    expect(timers[0]?.cancelled).toBe(true)
  })
})
