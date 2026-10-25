// The Team tab's source (hooks/team-source.ts): each team folder's config and, in the state folder it names, its rename
// and hire logs, each re-read only when its stamp moves; the tree of the folders a team id names, written only when it
// changed and read only while the tab shows; the own team's tasks and unread inbox lines with it, a peer's none.
import { describe, expect, test } from 'claude-code/testing'
import type { TeamView } from '../types'
import { POLL_MS } from '../hooks/live'
import type { TeamFiles } from '../hooks/places'
import { teamTree, type TeamRead } from '../hooks/team'
import type { InboxPaths } from '../hooks/team-inboxes'
import { LiveTeam, TeamFolder } from '../hooks/team-source'
import { HOUR, MemoryFiles, NOW, S1, createLine, iso, markLine, statusLine } from './fixtures'
import { configOf, hire, rename, tasksOf } from './team-fixtures'

const TEAMS = 'K/teams'
const ACME_HOME = `${TEAMS}/acme`
const ACME_STATE = `${ACME_HOME}/state`
const ACME_CONFIG_PATH = `${ACME_HOME}/config.json`
const TOOLS_CONFIG_PATH = `${TEAMS}/tools/config.json`
const FILES: TeamFiles = { team: 'acme', dir: ACME_HOME, teamsDir: TEAMS, config: ACME_CONFIG_PATH, renames: `${ACME_STATE}/renames.jsonl`, turnLog: null }
/** The own team's register: its inbox read marks and its inbox folder. */
const INBOX: InboxPaths = { marks: 'K/tasks/inbox-marks.jsonl', inboxDir: 'K/inbox' }

const ACME_CONFIG = { team: { id: 'acme' }, sessions: ['lead', 'api'], roles: { lead: 'lead' } }
const TOOLS_CONFIG = { team: { id: 'tools', parent: 'acme' }, sessions: ['boss', 'dev'], roles: { lead: 'boss' } }
const API_RENAME = rename('api', 'acme-api', 'acme-backend')
const API_HIRE = hire('api', NOW - 2 * HOUR)
/** The hire as teamrig writes it to hires.jsonl: its format, and its time as an ISO string. */
const API_HIRE_LINE = JSON.stringify({ v: 2, ...API_HIRE, at: iso(API_HIRE.at) })

/** api works T1 on the own team; dev's T2 is the peer team's work, in no register the pane reads. */
const TASKS = tasksOf(
  createLine('T1', { at: NOW - 3 * HOUR, by: 'lead', owner: 'api', title: 'Add the route' }),
  statusLine('T1', 'api', NOW - 2 * HOUR, 'in-progress'),
  createLine('T2', { at: NOW - 3 * HOUR, by: 'boss', owner: 'dev', title: 'Fix the build' }),
  statusLine('T2', 'dev', NOW - 2 * HOUR, 'in-progress'),
)

/** acme's config and its rename and hire logs in its state folder; tools' config, with no logs. */
function teamsDisk(): MemoryFiles {
  const disk = new MemoryFiles()
  disk.write(ACME_CONFIG_PATH, JSON.stringify(ACME_CONFIG))
  disk.write(`${ACME_STATE}/renames.jsonl`, `${JSON.stringify(API_RENAME)}\n`)
  disk.write(`${ACME_STATE}/hires.jsonl`, `${API_HIRE_LINE}\n`)
  disk.write(TOOLS_CONFIG_PATH, JSON.stringify(TOOLS_CONFIG))
  return disk
}

const ACME_READ: TeamRead = { team: 'acme', config: configOf(ACME_CONFIG), renames: [API_RENAME], hires: [API_HIRE], tasks: TASKS, unread: null }
const TOOLS_READ: TeamRead = { team: 'tools', config: configOf(TOOLS_CONFIG), renames: [], hires: [], tasks: null, unread: null }

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
  test('reads the config, then the rename and hire logs in its state folder; again only the files whose stamp moved', async () => {
    const disk = teamsDisk()
    const folder = new TeamFolder(disk, TEAMS, 'acme')
    expect(await folder.read({ tasks: TASKS, inboxes: null })).toEqual(ACME_READ)
    expect(disk.reads).toEqual([ACME_CONFIG_PATH, `${ACME_STATE}/renames.jsonl`, `${ACME_STATE}/hires.jsonl`])

    disk.reads.length = 0
    expect(await folder.read({ tasks: TASKS, inboxes: null })).toEqual(ACME_READ)
    expect(disk.reads).toEqual([])

    disk.write(`${ACME_STATE}/hires.jsonl`, '')
    expect((await folder.read(null))?.hires).toEqual([])
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
})

/**
 * A LiveTeam over the fake disk and a fake folder list, with whether the tab shows set by the test, and each write it
 * made; it counts the own team's inboxes at `inbox`, none when null (a pane that found no register).
 */
function fakeTeam(disk: MemoryFiles, inbox: InboxPaths | null = null) {
  const shown = { tab: true }
  const listed: { names: readonly string[]; failure: string | null } = { names: ['acme', 'tools'], failure: null }
  const views: TeamView[] = []
  let failWrites = false
  const live = new LiveTeam(disk, FILES, {
    folders: async dir => {
      if (listed.failure !== null) throw new Error(listed.failure)
      return dir === TEAMS ? listed.names : []
    },
    tasks: async () => TASKS,
    isShown: async () => shown.tab,
    publish: async view => {
      if (failWrites) throw new Error('write refused')
      views.push(view)
    },
  }, inbox)
  const setFailWrites = (fails: boolean) => {
    failWrites = fails
  }
  return { live, shown, listed, views, failWrites: setFailWrites }
}

describe('LiveTeam', () => {
  test("a refresh writes the tree of the team folders, the own team's tasks with it, a peer's none; again only when it changed", async () => {
    const disk = teamsDisk()
    const { live, views } = fakeTeam(disk)
    await live.refresh()
    await live.refresh()
    expect(views).toEqual([{ kind: 'tree', root: teamTree([ACME_READ, TOOLS_READ], 'acme') }])

    const grown = { ...TOOLS_CONFIG, sessions: ['boss', 'dev', 'qa'] }
    disk.write(TOOLS_CONFIG_PATH, JSON.stringify(grown))
    await live.refresh()
    expect(views.at(-1)).toEqual({ kind: 'tree', root: teamTree([ACME_READ, { ...TOOLS_READ, config: configOf(grown) }], 'acme') })
    expect(views.length).toBe(2)
  })

  test("the own team's sessions carry their unread inbox lines, a peer team's none; a pane with no register counts none", async () => {
    const disk = teamsDisk()
    disk.write(INBOX.marks, `${markLine('api', 0, S1, NOW)}\n`)
    disk.write(`${INBOX.inboxDir}/api.md`, 'lead: add the route\nlead: by noon\n')
    disk.write(`${INBOX.inboxDir}/dev.md`, 'boss: fix the build\n')
    const { live, views } = fakeTeam(disk, INBOX)
    await live.refresh()
    expect(views).toEqual([{ kind: 'tree', root: teamTree([{ ...ACME_READ, unread: new Map([['api', 2]]) }, TOOLS_READ], 'acme') }])
    expect(disk.reads).not.toContain(`${INBOX.inboxDir}/dev.md`)

    const alone = fakeTeam(disk)
    await alone.live.refresh()
    expect(alone.views).toEqual([{ kind: 'tree', root: teamTree([ACME_READ, TOOLS_READ], 'acme') }])
  })

  test('a folder that names no team is never read; one no longer listed leaves the tree, and one listed again is read anew', async () => {
    const disk = teamsDisk()
    disk.write(`${TEAMS}/Notes/config.json`, JSON.stringify(TOOLS_CONFIG))
    const { live, listed, views } = fakeTeam(disk)
    listed.names = ['Notes', 'acme', '.git', 'tools']
    await live.refresh()
    expect(disk.reads.filter(path => !path.startsWith(ACME_HOME))).toEqual([TOOLS_CONFIG_PATH])

    listed.names = ['acme']
    await live.refresh()
    expect(views.at(-1)).toEqual({ kind: 'tree', root: teamTree([ACME_READ], 'acme') })

    listed.names = ['acme', 'tools']
    disk.reads.length = 0
    await live.refresh()
    expect(disk.reads).toEqual([TOOLS_CONFIG_PATH])
    expect(views.at(-1)).toEqual({ kind: 'tree', root: teamTree([ACME_READ, TOOLS_READ], 'acme') })
  })

  test('a folder list or a file read that fails shows why; the next read that works shows the tree again', async () => {
    const disk = teamsDisk()
    const { live, listed, views } = fakeTeam(disk)
    listed.failure = 'EACCES: permission denied, scandir K/teams'
    await live.refresh()
    expect(views).toEqual([{ kind: 'failed', reason: 'EACCES: permission denied, scandir K/teams' }])

    listed.failure = null
    disk.failNextRead = 'EBUSY: resource busy or locked'
    await live.refresh()
    expect(views.at(-1)).toEqual({ kind: 'failed', reason: 'EBUSY: resource busy or locked' })

    await live.refresh()
    expect(views.at(-1)).toEqual({ kind: 'tree', root: teamTree([ACME_READ, TOOLS_READ], 'acme') })
  })

  test('a poll while the tab is hidden reads nothing; once it shows, it reads', async () => {
    const disk = teamsDisk()
    const { live, shown, views } = fakeTeam(disk)
    shown.tab = false
    await live.poll()
    expect(disk.reads).toEqual([])
    expect(views).toEqual([])

    shown.tab = true
    await live.poll()
    expect(views.length).toBe(1)
  })

  test('a failed write never rejects and is written by the next poll; two refreshes at once read once', async () => {
    const disk = teamsDisk()
    const { live, views, failWrites } = fakeTeam(disk)
    failWrites(true)
    await live.poll()
    expect(views).toEqual([])
    failWrites(false)
    await live.poll()
    expect(views.length).toBe(1)

    disk.write(TOOLS_CONFIG_PATH, JSON.stringify({ ...TOOLS_CONFIG, sessions: ['boss'] }))
    disk.reads.length = 0
    await Promise.all([live.refresh(), live.refresh()])
    expect(disk.reads).toEqual([TOOLS_CONFIG_PATH])
  })

  test('polls every POLL_MS from its start until it stops', () => {
    const { live } = fakeTeam(new MemoryFiles())
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
