import { describe, expect, test } from 'claude-code/testing'
import { USAGE } from '../hooks/command'
import type { TeamFiles } from '../hooks/places'
import { findSession, type TeamLookup } from '../hooks/sessions'

const TEAM = 'C:/Homes/a/.teamrig/teams/web'
const PATHS: TeamFiles = { team: 'web', config: `${TEAM}/config.json`, renames: `${TEAM}/state/renames.jsonl` }
const CONFIG = JSON.stringify({ sessions: ['lead', 'api', 'ui'], names: { api: 'web-backend' } })
/** api, first called web-backend by the config, was renamed web-api. */
const RENAMED = JSON.stringify({ v: 1, id: 'api', from: 'web-backend', to: 'web-api', at: '2026-10-15T08:00:00.000Z', by: 'api' })

/** The team's files by path, which a test may change between lookups; a path in `locked` throws as a locked file does. */
function team(files: Record<string, string>, locked: readonly string[] = []): { lookup: TeamLookup; reads: string[] } {
  const reads: string[] = []
  const lookup: TeamLookup = {
    paths: PATHS,
    files: {
      stamp: async path => {
        if (locked.includes(path)) throw new Error(`EBUSY: ${path}`)
        const text = files[path]
        return text === undefined ? null : { mtimeMs: 1, size: text.length }
      },
      read: async path => {
        reads.push(path)
        const text = files[path]
        if (text === undefined) throw new Error(`ENOENT: ${path}`)
        return text
      },
    },
  }
  return { lookup, reads }
}

describe('findSession', () => {
  test("finds a session by its id, its current name, or a former name, as teamrig's commands do", async () => {
    const { lookup } = team({ [PATHS.config]: CONFIG, [PATHS.renames]: `${RENAMED}\n` })
    expect(await findSession('api', lookup)).toEqual({ ok: true, id: 'api' })
    expect(await findSession('web-api', lookup)).toEqual({ ok: true, id: 'api' })
    expect(await findSession('web-backend', lookup)).toEqual({ ok: true, id: 'api' })
    expect(await findSession('web-ui', lookup)).toEqual({ ok: true, id: 'ui' })
  })

  test('a word that names no session pins nothing, and the answer lists every session by id and name', async () => {
    const { lookup } = team({ [PATHS.config]: CONFIG, [PATHS.renames]: `${RENAMED}\n` })
    expect(await findSession('web', lookup)).toEqual({
      ok: false,
      problem: 'Not pinned (team web): web is not a session on this team (sessions: lead (web-lead), api (web-api), ui (web-ui)).',
    })
    expect(await findSession('no such area!', lookup)).toEqual({
      ok: false,
      problem: 'Not pinned (team web): no such area! is not a session on this team (sessions: lead (web-lead), api (web-api), ui (web-ui)).',
    })
  })

  test('reads the config and the rename log again at each lookup, so a session renamed since the pane started is found', async () => {
    const files: Record<string, string> = { [PATHS.config]: CONFIG }
    const { lookup } = team(files)
    expect((await findSession('web-api', lookup)).ok).toBe(false)
    files[PATHS.renames] = `${RENAMED}\n`
    expect(await findSession('web-api', lookup)).toEqual({ ok: true, id: 'api' })
  })

  test('with no team, or a team with no config file, a word that can be an id is taken as the id', async () => {
    expect(await findSession('po', null)).toEqual({ ok: true, id: 'po' })
    expect(await findSession('no such area!', null)).toEqual({ ok: false, problem: `Not pinned: "no such area!" is not a session id. ${USAGE}` })
    const { lookup, reads } = team({ [PATHS.renames]: `${RENAMED}\n` })
    expect(await findSession('web-api', lookup)).toEqual({ ok: true, id: 'web-api' })
    expect(reads).toEqual([])
  })

  test('a config teamrig cannot read, or a file locked by a writer, is the answer, naming the file', async () => {
    const unreadable = team({ [PATHS.config]: '[1]' })
    expect(await findSession('api', unreadable.lookup)).toEqual({
      ok: false,
      problem: `Not pinned: ${PATHS.config}: expected a JSON object at the top level`,
    })
    const brokenField = team({ [PATHS.config]: JSON.stringify({ configVersion: 'two' }) })
    const answer = await findSession('api', brokenField.lookup)
    expect(answer.ok ? null : answer.problem).toMatch(/^Not pinned: C:\/Homes\/a\/\.teamrig\/teams\/web\/config\.json: configVersion: /)
    const lockedConfig = team({ [PATHS.config]: CONFIG }, [PATHS.config])
    expect(await findSession('api', lockedConfig.lookup)).toEqual({
      ok: false,
      problem: `Not pinned: ${PATHS.config} cannot be read (EBUSY: ${PATHS.config})`,
    })
    const lockedLog = team({ [PATHS.config]: CONFIG }, [PATHS.renames])
    expect(await findSession('api', lockedLog.lookup)).toEqual({
      ok: false,
      problem: `Not pinned: ${PATHS.renames} cannot be read (EBUSY: ${PATHS.renames})`,
    })
  })

  test('a read that fails with something other than an Error is still named', async () => {
    const { lookup } = team({ [PATHS.config]: CONFIG })
    const failing: TeamLookup = {
      ...lookup,
      files: {
        stamp: lookup.files.stamp,
        read: async () => {
          throw 'disk gone'
        },
      },
    }
    expect(await findSession('api', failing)).toEqual({ ok: false, problem: `Not pinned: ${PATHS.config} cannot be read (disk gone)` })
  })
})
