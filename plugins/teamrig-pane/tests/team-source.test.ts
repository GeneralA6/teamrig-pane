// The Teams tab's source (hooks/team-source.ts). TeamFolder: a team folder's config and, in the state folder it names,
// its rename and hire logs and its week file, each re-read only when its stamp moves. LiveTeam: the tree of teamrig's
// `sessions` document as the pane holds it, at the clock's now, written only when it changed and read only while the
// tab shows; reading, before a document; the own team's tasks and cards on the owner with it, a peer's none; each
// team's week from the weeks port; a team teamrig could not serve left out and named with teamrig's reason.
import { describe, expect, test } from 'claude-code/testing'
import type { SessionOwnerCards, Snapshot, TeamView } from '../types'
import { TEAM_WEEK_FORMAT, type TeamWeekSummary } from '../hooks/core/read/index'
import { POLL_MS } from '../hooks/live'
import type { SessionsRead } from '../hooks/sessions-document'
import { teamTree, type TeamRead, type TeamRegister, type TeamWeek } from '../hooks/team'
import { LiveTeam, TeamFolder, type OwnReads } from '../hooks/team-source'
import { HOUR, MemoryFiles, NOW, createLine, iso, statusLine } from './fixtures'
import { WEEK_RESET, configOf, countsOf, hire, rename, sessionsReadOf, tasksOf, treeInput, weekFile } from './team-fixtures'

const TEAMS = 'K/teams'
const ACME_HOME = `${TEAMS}/acme`
const ACME_STATE = `${ACME_HOME}/state`
const ACME_CONFIG_PATH = `${ACME_HOME}/config.json`
const TOOLS_CONFIG_PATH = `${TEAMS}/tools/config.json`

const ACME_CONFIG = { team: { id: 'acme' }, sessions: ['lead', 'api'], roles: { lead: 'lead' } }
const TOOLS_CONFIG = { team: { id: 'tools', parent: 'acme' }, sessions: ['boss', 'dev'], roles: { lead: 'boss' } }
const API_RENAME = rename('api', 'acme-api', 'acme-backend')
const API_HIRE = hire('api', NOW - 2 * HOUR)
/** The hire as teamrig writes it to hires.jsonl: its format, and its time as an ISO string. */
const API_HIRE_LINE = JSON.stringify({ v: 2, ...API_HIRE, at: iso(API_HIRE.at) })

/** api works T1 on the own team; dev's T2 is the peer team's work, in no register the pane reads. */
const REGISTER = [
  createLine('T1', { at: NOW - 3 * HOUR, by: 'lead', owner: 'api', title: 'Add the route' }),
  statusLine('T1', 'api', NOW - 2 * HOUR, 'in-progress'),
  createLine('T2', { at: NOW - 3 * HOUR, by: 'boss', owner: 'dev', title: 'Fix the build' }),
  statusLine('T2', 'dev', NOW - 2 * HOUR, 'in-progress'),
]
const TASKS = tasksOf(...REGISTER)
/** The own team's register counted by owner. */
const TASK_COUNTS = countsOf(...REGISTER)
/** api's card on the owner, on the own team's register. */
const OWNER_CARDS: Readonly<Record<string, SessionOwnerCards>> = { api: { due: [{ id: 'T3', title: 'Pick the database' }], later: [] } }

/** acme's config and its rename and hire logs in its state folder; tools' config, with no logs. */
function teamsDisk(): MemoryFiles {
  const disk = new MemoryFiles()
  disk.write(ACME_CONFIG_PATH, JSON.stringify(ACME_CONFIG))
  disk.write(`${ACME_STATE}/renames.jsonl`, `${JSON.stringify(API_RENAME)}\n`)
  disk.write(`${ACME_STATE}/hires.jsonl`, `${API_HIRE_LINE}\n`)
  disk.write(TOOLS_CONFIG_PATH, JSON.stringify(TOOLS_CONFIG))
  return disk
}

const ACME_READ: TeamRead = {
  team: 'acme',
  config: configOf(ACME_CONFIG),
  renames: [API_RENAME],
  hires: [API_HIRE],
  week: null,
  tasks: TASKS,
  ownerCards: OWNER_CARDS,
  taskCounts: TASK_COUNTS,
}
const TOOLS_READ: TeamRead = { team: 'tools', config: configOf(TOOLS_CONFIG), renames: [], hires: [], week: null, tasks: null, ownerCards: null, taskCounts: null }
/** acme's week as teamrig's budget hooks write it. */
const ACME_WEEK = weekFile(35.28, 51.91)
/** A week file's text: its format, then the summary's fields. */
const weekText = (format: number) => JSON.stringify({ v: format, ...ACME_WEEK })
/** What the pane reads of acme beside its folder. */
const OWN: OwnReads = { tasks: TASKS, ownerCards: OWNER_CARDS, taskCounts: TASK_COUNTS }
/** The own register later: api took T4 too, and its card on the owner was answered. */
const GROWN_REGISTER = [...REGISTER, createLine('T4', { at: NOW - HOUR, by: 'lead', owner: 'api', title: 'Test the route' })]
const GROWN_PARTS: Pick<Snapshot, 'tasks' | 'ownerCards' | 'taskCounts'> = { tasks: tasksOf(...GROWN_REGISTER), ownerCards: {}, taskCounts: countsOf(...GROWN_REGISTER) }
const GROWN: OwnReads = GROWN_PARTS
const BUSY = 'EBUSY: resource busy or locked'

/** The message `run` rejects with. */
async function failure(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
    return 'no failure'
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

describe('TeamFolder', () => {
  test("reads the config, then the rename and hire logs in its state folder; again only the files whose stamp moved; a peer's read has no tasks or cards", async () => {
    const disk = teamsDisk()
    const folder = new TeamFolder(disk, TEAMS, 'acme')
    expect(await folder.read(OWN)).toEqual(ACME_READ)
    expect(disk.reads).toEqual([ACME_CONFIG_PATH, `${ACME_STATE}/renames.jsonl`, `${ACME_STATE}/hires.jsonl`])

    disk.reads.length = 0
    expect(await folder.read(OWN)).toEqual(ACME_READ)
    expect(disk.reads).toEqual([])

    disk.write(`${ACME_STATE}/hires.jsonl`, '')
    const peer = await folder.read(null)
    expect([peer?.hires, peer?.tasks, peer?.ownerCards, peer?.taskCounts]).toEqual([[], null, null, null])
    expect(disk.reads).toEqual([`${ACME_STATE}/hires.jsonl`])
  })

  test("a config that names another state folder reads the logs from there, a relative one under the team's folder", async () => {
    const disk = teamsDisk()
    const folder = new TeamFolder(disk, TEAMS, 'acme')
    await folder.read(null)
    disk.write(ACME_CONFIG_PATH, JSON.stringify({ ...ACME_CONFIG, paths: { state: 'kept' } }))
    disk.write(`${ACME_HOME}/kept/hires.jsonl`, `${API_HIRE_LINE}\n`)
    disk.reads.length = 0

    const read = await folder.read(null)
    expect(disk.reads).toEqual([ACME_CONFIG_PATH, `${ACME_HOME}/kept/hires.jsonl`])
    expect([read?.renames, read?.hires]).toEqual([[], [API_HIRE]])
  })

  test("reads the week file in its state folder, again only when its stamp moves, from the new state folder when the config moves it; a damaged one, or one in a format it cannot read, as none", async () => {
    const disk = teamsDisk()
    const week = `${ACME_STATE}/usage/team.week.json`
    disk.write(week, weekText(TEAM_WEEK_FORMAT))
    const folder = new TeamFolder(disk, TEAMS, 'acme')
    expect((await folder.read(null))?.week).toEqual(ACME_WEEK)
    expect(disk.reads).toContain(week)

    disk.reads.length = 0
    expect((await folder.read(null))?.week).toEqual(ACME_WEEK)
    expect(disk.reads).toEqual([])

    disk.write(week, '{ not json')
    expect((await folder.read(null))?.week).toBe(null)
    disk.write(week, weekText(TEAM_WEEK_FORMAT + 1))
    expect((await folder.read(null))?.week).toBe(null)

    disk.write(ACME_CONFIG_PATH, JSON.stringify({ ...ACME_CONFIG, paths: { state: 'kept' } }))
    disk.write(`${ACME_HOME}/kept/usage/team.week.json`, weekText(TEAM_WEEK_FORMAT))
    expect((await folder.read(null))?.week).toEqual(ACME_WEEK)
  })

  test("reads a format 3 week file with where the week counts from, a format 2 one with its account and limits and no start, and a format 1 one as naming no account and no stretch", async () => {
    const disk = teamsDisk()
    const week = `${ACME_STATE}/usage/team.week.json`
    const limits = [{ start: NOW - 2 * HOUR, end: NOW - HOUR }]
    disk.write(week, JSON.stringify({ v: 3, ...ACME_WEEK, limits }))
    const folder = new TeamFolder(disk, TEAMS, 'acme')
    expect((await folder.read(null))?.week).toEqual({ ...ACME_WEEK, limits })

    const { account, usedPct, plannedPct, accountUsedPct, resetsAt, at } = ACME_WEEK
    disk.write(week, JSON.stringify({ v: 2, account, usedPct, plannedPct, accountUsedPct, resetsAt, at, limits }))
    expect((await folder.read(null))?.week).toEqual({ ...ACME_WEEK, start: undefined, limits })

    disk.write(week, JSON.stringify({ v: 1, usedPct, plannedPct, accountUsedPct, resetsAt, at }))
    expect((await folder.read(null))?.week).toEqual({ ...ACME_WEEK, account: undefined, start: undefined })
  })

  test('no config file, or one teamrig refuses, reads as no team; a read that fails throws, and the next one tries again', async () => {
    const disk = new MemoryFiles()
    const folder = new TeamFolder(disk, TEAMS, 'acme')
    expect(await folder.read(null)).toBeNull()
    expect(disk.reads).toEqual([])

    disk.write(ACME_CONFIG_PATH, '{ not json')
    expect(await folder.read(null)).toBeNull()

    disk.write(ACME_CONFIG_PATH, JSON.stringify(ACME_CONFIG))
    disk.failNextRead = 'EBUSY: resource busy or locked'
    expect(await failure(() => folder.read(null))).toBe('EBUSY: resource busy or locked')
    expect((await folder.read(null))?.config).toEqual(configOf(ACME_CONFIG))
  })

  test('its last read that worked, for a failed read to fall back on: none before one, its own parts as given now, none once its config is refused', async () => {
    const disk = teamsDisk()
    const folder = new TeamFolder(disk, TEAMS, 'acme')
    expect(folder.lastRead(OWN)).toBeNull()
    await folder.read(OWN)

    disk.write(ACME_CONFIG_PATH, JSON.stringify({ ...ACME_CONFIG, sessions: ['lead'] }))
    disk.failNextRead = BUSY
    expect(await failure(() => folder.read(OWN))).toBe(BUSY)
    expect(folder.lastRead(GROWN)).toEqual({ ...ACME_READ, ...GROWN_PARTS })
    expect(folder.lastRead(null)).toEqual({ ...ACME_READ, tasks: null, ownerCards: null, taskCounts: null })

    disk.write(ACME_CONFIG_PATH, '{ not json')
    expect(await folder.read(OWN)).toBeNull()
    expect(folder.lastRead(OWN)).toBeNull()
  })
})

/** The week of a written tree's root team; undefined for a view that holds no team tree. */
function rootWeek(view: TeamView | undefined): TeamWeek | null | undefined {
  if (view?.kind !== 'tree' || view.root?.kind !== 'team') return undefined
  return view.root.team.week
}

/** The view of the tree teamrig serves an acme pane over `reads`, each read's register and week with it. */
function treeView(reads: readonly TeamRead[], now = NOW): TeamView {
  return { kind: 'tree', root: teamTree(treeInput(reads, 'acme', now)), failures: [] }
}

/**
 * A LiveTeam of team acme over ports the test sets: the `sessions` document held (teamrig's over acme and tools, or
 * none yet), each team's week, the register's answer, whether the tab shows and the clock's now; with each write it
 * made, the teams whose weeks it asked for, and how often it read the register.
 */
function fakeTeam(first: SessionsRead | null = sessionsReadOf([ACME_READ, TOOLS_READ], 'acme')) {
  const held: { read: SessionsRead | null } = { read: first }
  const weeks: { byTeam: ReadonlyMap<string, TeamWeekSummary>; failure: string | null; asked: (readonly string[])[] } = { byTeam: new Map(), failure: null, asked: [] }
  const register: { answer: TeamRegister; failure: string | null; reads: number } = { answer: { tasks: TASKS, ownerCards: OWNER_CARDS, taskCounts: TASK_COUNTS }, failure: null, reads: 0 }
  const shown = { tab: true }
  const clock = { now: NOW }
  const views: TeamView[] = []
  let failWrites = false
  const live = new LiveTeam('acme', {
    sessions: () => held.read,
    weeks: async teams => {
      weeks.asked.push(teams)
      if (weeks.failure !== null) throw new Error(weeks.failure)
      return weeks.byTeam
    },
    register: async () => {
      register.reads += 1
      if (register.failure !== null) throw new Error(register.failure)
      return register.answer
    },
    isShown: async () => shown.tab,
    publish: async view => {
      if (failWrites) throw new Error('write refused')
      views.push(view)
    },
    now: async () => clock.now,
  })
  const setFailWrites = (fails: boolean) => {
    failWrites = fails
  }
  return { live, held, weeks, register, shown, clock, views, failWrites: setFailWrites }
}

describe('LiveTeam', () => {
  test('before a sessions document is held it says the tab is reading, and reads no register or week; then it writes the tree of the document', async () => {
    const { live, held, weeks, register, views } = fakeTeam(null)
    await live.refresh()
    expect(views).toEqual([{ kind: 'reading' }])
    expect([register.reads, weeks.asked]).toEqual([0, []])

    held.read = sessionsReadOf([ACME_READ, TOOLS_READ], 'acme')
    await live.refresh()
    expect(views.at(-1)).toEqual(treeView([ACME_READ, TOOLS_READ]))
    expect(views.length).toBe(2)
  })

  test("a refresh writes the tree of the document held, the own team's tasks and cards on the owner with it, a peer's none; again only when it changed", async () => {
    const { live, held, views } = fakeTeam()
    await live.refresh()
    await live.refresh()
    expect(views).toEqual([treeView([ACME_READ, TOOLS_READ])])

    const grown: TeamRead = { ...TOOLS_READ, config: configOf({ ...TOOLS_CONFIG, sessions: ['boss', 'dev', 'qa'] }) }
    held.read = sessionsReadOf([ACME_READ, grown], 'acme')
    await live.refresh()
    expect(views.at(-1)).toEqual(treeView([ACME_READ, grown]))
    expect(views.length).toBe(2)
  })

  test('a document that does not serve the own team writes a view with no tree', async () => {
    const { live, views } = fakeTeam(sessionsReadOf([TOOLS_READ], 'acme'))
    await live.refresh()
    expect(views).toEqual([{ kind: 'tree', root: null, failures: [] }])
  })

  test("a team teamrig could not serve is left out and named with teamrig's reason, never as a last read; a document without the failure clears it", async () => {
    const failed: SessionsRead = { ...sessionsReadOf([ACME_READ], 'acme'), failures: [{ team: 'tools', reason: BUSY }] }
    const { live, held, views } = fakeTeam(failed)
    await live.refresh()
    expect(views).toEqual([{ ...treeView([ACME_READ]), failures: [{ team: 'tools', reason: BUSY, isLastRead: false }] }])

    held.read = sessionsReadOf([ACME_READ, TOOLS_READ], 'acme')
    await live.refresh()
    expect(views.at(-1)).toEqual(treeView([ACME_READ, TOOLS_READ]))
  })

  test('the tree carries the register as read now: a task taken and a card answered write it again', async () => {
    const { live, register, views } = fakeTeam()
    await live.refresh()
    register.answer = GROWN_PARTS
    await live.refresh()
    expect(views.at(-1)).toEqual(treeView([{ ...ACME_READ, ...GROWN_PARTS }, TOOLS_READ]))
    expect(views.length).toBe(2)
  })

  test('a register or a weeks read that fails shows why; the next read that works shows the tree again', async () => {
    const { live, register, weeks, views } = fakeTeam()
    register.failure = BUSY
    await live.refresh()
    expect(views).toEqual([{ kind: 'failed', reason: BUSY }])

    register.failure = null
    weeks.failure = 'EACCES: permission denied, scandir K/teams'
    await live.refresh()
    expect(views.at(-1)).toEqual({ kind: 'failed', reason: 'EACCES: permission denied, scandir K/teams' })

    weeks.failure = null
    await live.refresh()
    expect(views.at(-1)).toEqual(treeView([ACME_READ, TOOLS_READ]))
  })

  test("asks the weeks of every team the document serves, and gives the tree each team's week at the clock's now; once the clock reaches the week's reset, the next refresh writes the tree without it", async () => {
    const { live, weeks, clock, views } = fakeTeam()
    weeks.byTeam = new Map([['acme', ACME_WEEK]])
    await live.refresh()
    expect(weeks.asked).toEqual([['acme', 'tools']])
    expect(views).toEqual([treeView([{ ...ACME_READ, week: ACME_WEEK }, TOOLS_READ])])
    expect(rootWeek(views[0])).toEqual({ usedPct: 35.28, plannedPct: 51.91, elapsedPct: 57 })

    clock.now = WEEK_RESET
    await live.refresh()
    expect(views.length).toBe(2)
    expect(rootWeek(views[1])).toBe(null)
  })

  test('a poll while the tab is hidden reads nothing; once it shows, it reads', async () => {
    const { live, shown, register, weeks, views } = fakeTeam()
    shown.tab = false
    await live.poll()
    expect([register.reads, weeks.asked]).toEqual([0, []])
    expect(views).toEqual([])

    shown.tab = true
    await live.poll()
    expect(views.length).toBe(1)
  })

  test('a failed write never rejects and is written by the next poll; two refreshes at once read once', async () => {
    const { live, register, views, failWrites } = fakeTeam()
    failWrites(true)
    await live.poll()
    expect(views).toEqual([])
    failWrites(false)
    await live.poll()
    expect(views.length).toBe(1)

    register.reads = 0
    await Promise.all([live.refresh(), live.refresh()])
    expect(register.reads).toBe(1)
  })

  test('polls every POLL_MS from its start until it stops', () => {
    const { live } = fakeTeam()
    const timers: { ms: number; isCancelled: boolean }[] = []
    live.startTimers(ms => {
      const timer = { ms, isCancelled: false }
      timers.push(timer)
      return {
        cancel: () => {
          timer.isCancelled = true
        },
      }
    })
    expect(timers).toEqual([{ ms: POLL_MS, isCancelled: false }])
    live.stop()
    expect(timers[0]?.isCancelled).toBe(true)
  })
})

