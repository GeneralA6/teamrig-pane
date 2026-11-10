import { describe, expect, test } from 'claude-code/testing'
import type { TeamFiles } from '../hooks/places'
import type { FileStamp, Files } from '../hooks/source'
import { TreeRegisters } from '../hooks/tree-registers'
import { HOUR, MemoryFiles, NOW, createLine } from './fixtures'

const WEB: TeamFiles = { team: 'web', dir: 'K/teams/web', teamsDir: 'K/teams', config: 'K/teams/web/config.json', renames: 'R/tasks/renames.jsonl', turnLog: null }
const AT = NOW - HOUR

/** A team's config text: its id, the team above it and where its state folder sits, when it names them. */
function configOf(id: string, parent: string | null = null, state: string | null = null): string {
  return JSON.stringify({
    team: { id, ...(parent === null ? {} : { parent }) },
    sessions: ['lead', 'api'],
    roles: { lead: 'lead' },
    ...(state === null ? {} : { paths: { state } }),
  })
}

const configPath = (team: string) => `K/teams/${team}/config.json`
const eventsOf = (team: string) => `K/teams/${team}/state/events.jsonl`
const registerOf = (ids: readonly string[]) => ids.map(id => createLine(id, { owner: 'api', by: 'lead', at: AT })).join('\n')
const ALL_FOLDERS = async () => ['acme', 'web', 'api']

/** A disk with acme the root and api and web under it, each register holding the tasks given. */
function acmeTree(registers: Readonly<Record<string, readonly string[]>>): MemoryFiles {
  const disk = new MemoryFiles()
  disk.write(configPath('acme'), configOf('acme'))
  disk.write(configPath('api'), configOf('api', 'acme'))
  disk.write(WEB.config, configOf('web', 'acme'))
  for (const [team, ids] of Object.entries(registers)) disk.write(eventsOf(team), registerOf(ids))
  return disk
}

/** What the source holds: each task id with the team holding it, in the order held. */
const held = (source: TreeRegisters) => [...source.current.values()].map(({ team, task }) => `${team}:${task.id}`)

/** A disk whose reads of the `locked` paths fail, as of a file a writer holds. */
class LockedFiles implements Files {
  readonly locked = new Set<string>()
  private readonly disk: MemoryFiles

  constructor(disk: MemoryFiles) {
    this.disk = disk
  }

  stamp(path: string): Promise<FileStamp | null> {
    return this.disk.stamp(path)
  }

  async read(path: string): Promise<string> {
    if (this.locked.has(path)) throw new Error(`EBUSY: ${path}`)
    return this.disk.read(path)
  }
}

describe('TreeRegisters', () => {
  test("reads the tree's other registers from its root, the own one left out and never read", async () => {
    const disk = acmeTree({ acme: ['T1'], api: ['T2'], web: ['T3'] })
    const source = new TreeRegisters(disk, WEB, ALL_FOLDERS)
    expect(await source.refresh()).toBe(true)
    expect(held(source)).toEqual(['acme:T1', 'api:T2'])
    expect(source.problem).toBe(null)
    expect(disk.reads.includes(eventsOf('web'))).toBe(false)
  })

  test('an id two registers hold reads as the first in walk order', async () => {
    const source = new TreeRegisters(acmeTree({ acme: ['T5'], api: ['T5', 'T6'] }), WEB, ALL_FOLDERS)
    await source.refresh()
    expect(held(source)).toEqual(['acme:T5', 'api:T6'])
  })

  test('reads nothing when the parents go round a loop, as teamrig reads no tree', async () => {
    const disk = acmeTree({ acme: ['T1'], api: ['T2'] })
    disk.write(configPath('acme'), configOf('acme', 'web'))
    const source = new TreeRegisters(disk, WEB, ALL_FOLDERS)
    expect(await source.refresh()).toBe(false)
    expect(held(source)).toEqual([])
    expect(source.problem).toBe(null)
  })

  test('leaves out a team folder with no config, and one not named as a team', async () => {
    const disk = acmeTree({ acme: ['T1'], api: ['T2'] })
    disk.remove(configPath('api'))
    const source = new TreeRegisters(disk, WEB, async () => ['acme', 'web', 'api', 'Notes'])
    await source.refresh()
    expect(held(source)).toEqual(['acme:T1'])
  })

  test('reads a register in the state folder its config names, and again where a moved one names', async () => {
    const disk = acmeTree({ acme: ['T1'], api: ['T2'] })
    disk.write('K/teams/api/kept/events.jsonl', registerOf(['T8']))
    const source = new TreeRegisters(disk, WEB, ALL_FOLDERS)
    await source.refresh()
    expect(held(source)).toEqual(['acme:T1', 'api:T2'])
    disk.write(configPath('api'), configOf('api', 'acme', 'kept'))
    expect(await source.refresh()).toBe(true)
    expect(held(source)).toEqual(['acme:T1', 'api:T8'])
  })

  test('names a register it cannot read, leaving it out until a read comes through', async () => {
    const files = new LockedFiles(acmeTree({ acme: ['T1'], api: ['T2'] }))
    files.locked.add(eventsOf('api'))
    const source = new TreeRegisters(files, WEB, ALL_FOLDERS)
    await source.refresh()
    expect(held(source)).toEqual(['acme:T1'])
    expect(source.problem).toBe(`api's register: EBUSY: ${eventsOf('api')}`)
    files.locked.clear()
    expect(await source.refresh()).toBe(true)
    expect(held(source)).toEqual(['acme:T1', 'api:T2'])
    expect(source.problem).toBe(null)
  })

  test('keeps the last good read of a register a later read fails on, and names it', async () => {
    const disk = acmeTree({ acme: ['T1'], api: ['T2'] })
    const files = new LockedFiles(disk)
    const source = new TreeRegisters(files, WEB, ALL_FOLDERS)
    await source.refresh()
    disk.write(eventsOf('api'), registerOf(['T2', 'T7']))
    files.locked.add(eventsOf('api'))
    expect(await source.refresh()).toBe(true)
    expect(held(source)).toEqual(['acme:T1', 'api:T2'])
    expect(source.problem).toBe(`api's register: EBUSY: ${eventsOf('api')}`)
  })

  test('keeps the teams last listed when the folders cannot be listed, and names why', async () => {
    const disk = acmeTree({ acme: ['T1'], api: ['T2'] })
    let listing: () => Promise<string[]> = ALL_FOLDERS
    const source = new TreeRegisters(disk, WEB, () => listing())
    await source.refresh()
    listing = async () => {
      throw new Error('EACCES: K/teams')
    }
    disk.write(eventsOf('acme'), registerOf(['T1', 'T4']))
    expect(await source.refresh()).toBe(true)
    expect(held(source)).toEqual(['acme:T1', 'acme:T4', 'api:T2'])
    expect(source.problem).toBe('team folders: EACCES: K/teams')
  })

  test('a team left out of a later listing takes its tasks away', async () => {
    const disk = acmeTree({ acme: ['T1'], api: ['T2'] })
    let listing: () => Promise<string[]> = ALL_FOLDERS
    const source = new TreeRegisters(disk, WEB, () => listing())
    await source.refresh()
    listing = async () => ['acme', 'web']
    expect(await source.refresh()).toBe(true)
    expect(held(source)).toEqual(['acme:T1'])
  })

  test('a poll that finds nothing moved, or only the own register moved, says so', async () => {
    const disk = acmeTree({ acme: ['T1'], api: ['T2'], web: ['T3'] })
    const source = new TreeRegisters(disk, WEB, ALL_FOLDERS)
    await source.refresh()
    expect(await source.refresh()).toBe(false)
    disk.write(eventsOf('web'), registerOf(['T3', 'T9']))
    expect(await source.refresh()).toBe(false)
    expect(held(source)).toEqual(['acme:T1', 'api:T2'])
  })
})
