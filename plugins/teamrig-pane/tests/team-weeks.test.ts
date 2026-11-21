// The Teams tab's week files (hooks/team-weeks.ts): each asked team's week from the state folder its config names,
// re-read only when a stamp moves; a team with no folder listed in the kit home never read, whatever its id says; a
// failed read or listing serving the weeks last read; a team no longer listed, or one whose config teamrig refuses,
// with no week.
import { describe, expect, test } from 'claude-code/testing'
import { TEAM_WEEK_FORMAT, type TeamWeekSummary } from '../hooks/core/read/index'
import { TeamWeeks } from '../hooks/team-weeks'
import { MemoryFiles } from './fixtures'
import { weekFile } from './team-fixtures'

const TEAMS = 'K/teams'
const ACME_HOME = `${TEAMS}/acme`
const TOOLS_HOME = `${TEAMS}/tools`
const ACME_CONFIG_PATH = `${ACME_HOME}/config.json`
const TOOLS_CONFIG_PATH = `${TOOLS_HOME}/config.json`
const ACME_WEEK_PATH = `${ACME_HOME}/state/usage/team.week.json`
const TOOLS_WEEK_PATH = `${TOOLS_HOME}/state/usage/team.week.json`

const ACME_CONFIG = { team: { id: 'acme' }, sessions: ['lead', 'api'], roles: { lead: 'lead' } }
const TOOLS_CONFIG = { team: { id: 'tools', parent: 'acme' }, sessions: ['boss', 'dev'], roles: { lead: 'boss' } }
const ACME_WEEK = weekFile(35.28, 51.91)
const ACME_LATER = weekFile(40.5, 53)
const TOOLS_WEEK = weekFile(12.5, 20)
const BUSY = 'EBUSY: resource busy or locked'

/** A week file's text as teamrig's budget hooks write it: its format, then the summary's fields. */
const weekText = (week: TeamWeekSummary) => JSON.stringify({ v: TEAM_WEEK_FORMAT, ...week })

/** acme and tools, each with its config and its week file in the default state folder. */
function teamsDisk(): MemoryFiles {
  const disk = new MemoryFiles()
  disk.write(ACME_CONFIG_PATH, JSON.stringify(ACME_CONFIG))
  disk.write(ACME_WEEK_PATH, weekText(ACME_WEEK))
  disk.write(TOOLS_CONFIG_PATH, JSON.stringify(TOOLS_CONFIG))
  disk.write(TOOLS_WEEK_PATH, weekText(TOOLS_WEEK))
  return disk
}

/** The kit home's folders, which a test may change or make unlistable. */
class Folders {
  names: readonly string[]
  failure: string | null = null
  readonly asked: string[] = []

  constructor(names: readonly string[]) {
    this.names = names
  }

  readonly list = async (dir: string): Promise<readonly string[]> => {
    this.asked.push(dir)
    if (this.failure !== null) throw new Error(this.failure)
    return this.names
  }
}

describe('TeamWeeks', () => {
  test("reads each asked team's week through its config's state folder, by team id, and again only the files whose stamp moved", async () => {
    const disk = teamsDisk()
    const folders = new Folders(['acme', 'tools'])
    const weeks = new TeamWeeks(disk, TEAMS, folders.list)

    expect([...(await weeks.read(['acme', 'tools']))]).toEqual([
      ['acme', ACME_WEEK],
      ['tools', TOOLS_WEEK],
    ])
    expect(disk.reads).toEqual([ACME_CONFIG_PATH, ACME_WEEK_PATH, TOOLS_CONFIG_PATH, TOOLS_WEEK_PATH])
    expect(folders.asked).toEqual([TEAMS])

    disk.reads.length = 0
    expect([...(await weeks.read(['acme', 'tools']))]).toEqual([
      ['acme', ACME_WEEK],
      ['tools', TOOLS_WEEK],
    ])
    expect(disk.reads).toEqual([])

    disk.write(ACME_WEEK_PATH, weekText(ACME_LATER))
    expect((await weeks.read(['acme', 'tools'])).get('acme')).toEqual(ACME_LATER)
    expect(disk.reads).toEqual([ACME_WEEK_PATH])
  })

  test('a team not asked for is not read, and one with no week file has no week', async () => {
    const disk = teamsDisk()
    disk.remove(TOOLS_WEEK_PATH)
    const weeks = new TeamWeeks(disk, TEAMS, new Folders(['acme', 'tools']).list)

    expect([...(await weeks.read(['tools']))]).toEqual([])
    expect(disk.reads.filter(path => path.startsWith(ACME_HOME))).toEqual([])
  })

  test('an id the kit home lists no folder of is never read, one that is no team id neither', async () => {
    const disk = teamsDisk()
    disk.write(`${TEAMS}/ghost/config.json`, JSON.stringify({ ...ACME_CONFIG, team: { id: 'ghost' } }))
    disk.write(`${TEAMS}/ghost/state/usage/team.week.json`, weekText(TOOLS_WEEK))
    // A name the kit home does list, which is no team id: the folder above the teams.
    const folders = new Folders(['acme', '..'])
    const weeks = new TeamWeeks(disk, TEAMS, folders.list)

    expect([...(await weeks.read(['acme', 'ghost', '..', '../teams/tools']))]).toEqual([['acme', ACME_WEEK]])
    expect(disk.reads).toEqual([ACME_CONFIG_PATH, ACME_WEEK_PATH])
  })

  test("a config that moves the state folder moves the week file read, a relative one under the team's folder", async () => {
    const disk = teamsDisk()
    const weeks = new TeamWeeks(disk, TEAMS, new Folders(['acme']).list)
    await weeks.read(['acme'])

    const kept = `${ACME_HOME}/kept/usage/team.week.json`
    disk.write(ACME_CONFIG_PATH, JSON.stringify({ ...ACME_CONFIG, paths: { state: 'kept' } }))
    disk.write(kept, weekText(ACME_LATER))
    disk.reads.length = 0

    expect([...(await weeks.read(['acme']))]).toEqual([['acme', ACME_LATER]])
    expect(disk.reads).toEqual([ACME_CONFIG_PATH, kept])
  })

  test('a damaged week file, or one in a format the pane cannot read, has no week', async () => {
    const disk = teamsDisk()
    const weeks = new TeamWeeks(disk, TEAMS, new Folders(['acme']).list)

    disk.write(ACME_WEEK_PATH, '{ not json')
    expect([...(await weeks.read(['acme']))]).toEqual([])
    disk.write(ACME_WEEK_PATH, JSON.stringify({ v: TEAM_WEEK_FORMAT + 1, ...ACME_WEEK }))
    expect([...(await weeks.read(['acme']))]).toEqual([])
    disk.write(ACME_WEEK_PATH, weekText(ACME_WEEK))
    expect([...(await weeks.read(['acme']))]).toEqual([['acme', ACME_WEEK]])
  })

  test('a read that fails keeps the week last read, and the next read tries the file again', async () => {
    const disk = teamsDisk()
    const weeks = new TeamWeeks(disk, TEAMS, new Folders(['acme']).list)
    await weeks.read(['acme'])

    disk.write(ACME_WEEK_PATH, weekText(ACME_LATER))
    disk.failNextRead = BUSY
    expect([...(await weeks.read(['acme']))]).toEqual([['acme', ACME_WEEK]])

    disk.reads.length = 0
    expect([...(await weeks.read(['acme']))]).toEqual([['acme', ACME_LATER]])
    expect(disk.reads).toEqual([ACME_WEEK_PATH])
  })

  test('a first read that fails has no week', async () => {
    const disk = teamsDisk()
    const weeks = new TeamWeeks(disk, TEAMS, new Folders(['acme']).list)

    disk.failNextRead = BUSY
    expect([...(await weeks.read(['acme']))]).toEqual([])
    expect([...(await weeks.read(['acme']))]).toEqual([['acme', ACME_WEEK]])
  })

  test('when the folders cannot be listed, serves the weeks last read and reads no file; none before a first listing', async () => {
    const disk = teamsDisk()
    const folders = new Folders(['acme', 'tools'])
    const weeks = new TeamWeeks(disk, TEAMS, folders.list)

    folders.failure = BUSY
    expect([...(await weeks.read(['acme', 'tools']))]).toEqual([])
    expect(disk.reads).toEqual([])

    folders.failure = null
    await weeks.read(['acme'])
    disk.write(ACME_WEEK_PATH, weekText(ACME_LATER))
    disk.reads.length = 0
    folders.failure = BUSY

    expect([...(await weeks.read(['acme', 'tools']))]).toEqual([['acme', ACME_WEEK]])
    expect(disk.reads).toEqual([])

    folders.failure = null
    expect([...(await weeks.read(['acme', 'tools']))]).toEqual([
      ['acme', ACME_LATER],
      ['tools', TOOLS_WEEK],
    ])
  })

  test('a team whose folder is no longer listed is dropped, and read anew once it is listed again', async () => {
    const disk = teamsDisk()
    const folders = new Folders(['acme', 'tools'])
    const weeks = new TeamWeeks(disk, TEAMS, folders.list)
    await weeks.read(['acme', 'tools'])

    folders.names = ['acme']
    disk.reads.length = 0
    expect([...(await weeks.read(['acme', 'tools']))]).toEqual([['acme', ACME_WEEK]])
    expect(disk.reads).toEqual([])

    // Unlistable right after: the dropped team has no held week to serve.
    folders.failure = BUSY
    expect([...(await weeks.read(['acme', 'tools']))]).toEqual([['acme', ACME_WEEK]])

    folders.failure = null
    folders.names = ['acme', 'tools']
    expect((await weeks.read(['acme', 'tools'])).get('tools')).toEqual(TOOLS_WEEK)
    expect(disk.reads).toEqual([TOOLS_CONFIG_PATH, TOOLS_WEEK_PATH])
  })

  test('no config, or one teamrig refuses, gives no week, and drops the one read before', async () => {
    const disk = teamsDisk()
    disk.remove(TOOLS_CONFIG_PATH)
    const weeks = new TeamWeeks(disk, TEAMS, new Folders(['acme', 'tools']).list)
    expect([...(await weeks.read(['acme', 'tools']))]).toEqual([['acme', ACME_WEEK]])
    expect(disk.reads.includes(TOOLS_WEEK_PATH)).toBe(false)

    disk.write(ACME_CONFIG_PATH, '{ not json')
    expect([...(await weeks.read(['acme']))]).toEqual([])

    disk.write(ACME_CONFIG_PATH, JSON.stringify(ACME_CONFIG))
    expect([...(await weeks.read(['acme']))]).toEqual([['acme', ACME_WEEK]])
  })
})
