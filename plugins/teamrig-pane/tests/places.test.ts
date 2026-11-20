import { describe, expect, test } from 'claude-code/testing'
import { findPlaces, foldersUp, teamIds, teamStateDir, type Places, type PlacesEnv, type PlacesInput, type TeamFiles } from '../hooks/places'
import { TEAM_SETTINGS } from './fixtures'
import { configOf } from './team-fixtures'

const KIT = 'C:/Homes/a/.teamrig'
const SETTINGS = `${KIT}/pane.json`
const POINTER = 'C:/w/app/.teamrig.json'
const STATE = `${KIT}/teams/web/state`
const CONFIG = `${KIT}/teams/web/config.json`
const TEAM_RULE = 'a lowercase letter, then lowercase letters, digits or -, at most 32'
/** The pointer file tying the session's folder to the web team. */
const WEB_POINTER = { [POINTER]: JSON.stringify({ team: 'web' }) }
/**
 * The files naming the web team's sessions: its config and, in its state folder, its rename log. With no config file
 * teamrig refuses the team and writes no turn log, so it has none.
 */
const WEB_FILES: TeamFiles = { team: 'web', dir: `${KIT}/teams/web`, teamsDir: `${KIT}/teams`, config: CONFIG, renames: `${STATE}/renames.jsonl`, turnLog: null }
/** The web team's files with a config file: its turn log, kept the config's turnLog.keepHours, teamrig's 24 by default. */
const WEB_LOGGED: TeamFiles = { ...WEB_FILES, turnLog: { dir: `${STATE}/turn-log`, keepHours: 24 } }
/** The web team's folders where teamrig keeps them with no config file. */
const TEAM_FOUND: Places = {
  kind: 'found',
  dirs: { tasksDir: STATE, inboxDir: `${STATE}/inbox` },
  team: WEB_FILES,
  settings: TEAM_SETTINGS,
  goalsDoc: null,
}

/**
 * Files by forward-slash path, a folder being there while a file lies under it; a path in `locked` throws as a locked
 * file or folder does, and `reads` records each read.
 */
function fakeFiles(files: Readonly<Record<string, string>>, locked: readonly string[]) {
  const reads: string[] = []
  const port: PlacesInput['files'] = {
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
  }
  const folders: PlacesInput['folders'] = async path => {
    if (locked.includes(path)) throw new Error(`EACCES: ${path}`)
    const under = Object.keys(files).flatMap(file => (file.startsWith(`${path}/`) ? [file.slice(path.length + 1).split('/')] : []))
    return [...new Set(under.flatMap(([name = '', ...deeper]) => (deeper.length > 0 ? [name] : [])))]
  }
  return { port, folders, reads }
}

/** `machineZone`: the zone the machine runs in, UTC unless given. */
type Options = { home?: string | null; cwd?: string | null; locked?: readonly string[]; machineZone?: string }

/**
 * Finds the places over `env` and `files`, from home C:/Homes/a and the folder C:/w/app/src on a UTC machine unless
 * `options` say otherwise.
 */
async function places(env: PlacesEnv, files: Readonly<Record<string, string>> = {}, options: Options = {}) {
  const fake = fakeFiles(files, options.locked ?? [])
  const found = await findPlaces({
    env,
    files: fake.port,
    folders: fake.folders,
    home: options.home === undefined ? 'C:\\Homes\\a\\' : options.home,
    cwd: options.cwd === undefined ? 'C:\\w\\app\\src' : options.cwd,
    machineZone: options.machineZone ?? 'UTC',
  })
  return { found, reads: fake.reads }
}

/** The problem a search found instead of the register, or null when it found the register. */
function problemOf(found: Places): string | null {
  return found.kind === 'problem' ? found.problem : null
}

const json = (value: unknown): string => JSON.stringify(value)

describe('places', () => {
  test('the goals document comes from its variable, else the settings file in the kit home; the register stays the team’s', async () => {
    const settings = json({ goalsDoc: ' docs/R.md ' })
    expect((await places({}, { ...WEB_POINTER, [SETTINGS]: settings })).found).toEqual({ ...TEAM_FOUND, goalsDoc: 'docs/R.md' })
    const env = { TEAMRIG_PANE_GOALS_DOC: ' docs/G.md ' }
    expect((await places(env, { ...WEB_POINTER, [SETTINGS]: settings })).found).toEqual({ ...TEAM_FOUND, goalsDoc: 'docs/G.md' })
    expect((await places(env, WEB_POINTER)).found).toEqual({ ...TEAM_FOUND, goalsDoc: 'docs/G.md' })
  })

  test('$TEAMRIG_HOME moves the kit home, and with it the team’s register and the default settings file', async () => {
    const { found } = await places({ TEAMRIG_HOME: ' D:\\kit ' }, { ...WEB_POINTER, 'D:/kit/pane.json': json({ goalsDoc: 'docs/R.md' }) })
    expect(found).toEqual({
      kind: 'found',
      dirs: { tasksDir: 'D:/kit/teams/web/state', inboxDir: 'D:/kit/teams/web/state/inbox' },
      team: { team: 'web', dir: 'D:/kit/teams/web', teamsDir: 'D:/kit/teams', config: 'D:/kit/teams/web/config.json', renames: 'D:/kit/teams/web/state/renames.jsonl', turnLog: null },
      settings: TEAM_SETTINGS,
      goalsDoc: 'docs/R.md',
    })
  })

  test('$TEAMRIG_PANE_SETTINGS names another settings file, which must then be there', async () => {
    const env = { TEAMRIG_PANE_SETTINGS: '~/pane.json' }
    const elsewhere = await places(env, { ...WEB_POINTER, 'C:/Homes/a/pane.json': json({ goalsDoc: 'docs/R.md' }) })
    expect(elsewhere.found).toEqual({ ...TEAM_FOUND, goalsDoc: 'docs/R.md' })
    expect((await places(env, { ...WEB_POINTER, [SETTINGS]: json({ goalsDoc: 'docs/R.md' }) })).found).toEqual({
      kind: 'problem',
      problem: 'C:/Homes/a/pane.json (TEAMRIG_PANE_SETTINGS) is not there',
      goalsDoc: null,
    })
  })

  test('a settings file it cannot use is the problem, naming the file and what is wrong; a folder key is no longer one it knows', async () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['not json', `${SETTINGS} is not a JSON object; expected {"goalsDoc": "..."}`],
      ['[1]', `${SETTINGS} is not a JSON object; expected {"goalsDoc": "..."}`],
      [json({ goalDoc: 'docs/G.md' }), `${SETTINGS}: unknown key "goalDoc" (known: goalsDoc)`],
      [json({ tasksDir: 'D:/t' }), `${SETTINGS}: unknown key "tasksDir" (known: goalsDoc)`],
      [json({ inboxDir: 'D:/i' }), `${SETTINGS}: unknown key "inboxDir" (known: goalsDoc)`],
      [json({ goalsDoc: 3 }), `${SETTINGS}: "goalsDoc" must be non-empty text`],
      [json({ goalsDoc: ' ' }), `${SETTINGS}: "goalsDoc" must be non-empty text`],
    ]
    for (const [text, problem] of cases) {
      expect((await places({}, { ...WEB_POINTER, [SETTINGS]: text })).found).toEqual({ kind: 'problem', problem, goalsDoc: null })
    }
    const withGoals = { TEAMRIG_PANE_GOALS_DOC: 'docs/G.md' }
    expect((await places(withGoals, { ...WEB_POINTER, [SETTINGS]: 'not json' })).found).toEqual({
      kind: 'problem',
      problem: `${SETTINGS} is not a JSON object; expected {"goalsDoc": "..."}`,
      goalsDoc: 'docs/G.md',
    })
  })

  test('a locked settings file is a problem, never read as no file', async () => {
    const { found, reads } = await places({}, { ...WEB_POINTER, [SETTINGS]: json({ goalsDoc: 'docs/R.md' }) }, { locked: [SETTINGS] })
    expect(found).toEqual({ kind: 'problem', problem: `${SETTINGS} cannot be read (EBUSY: ${SETTINGS})`, goalsDoc: null })
    expect(reads).toEqual([])
  })

  test('it reads where teamrig keeps the register of the nearest pointer file’s team', async () => {
    expect((await places({}, { [POINTER]: json({ team: 'web' }) })).found).toEqual(TEAM_FOUND)
    expect((await places({}, { 'C:/w/.teamrig.json': json({ team: 'web' }) })).found).toEqual(TEAM_FOUND)
    expect((await places({}, { 'C:/.teamrig.json': json({ team: 'web' }) })).found).toEqual(TEAM_FOUND)
    const nearest = { [POINTER]: json({ team: 'web' }), 'C:/w/.teamrig.json': json({ team: 'ops' }) }
    expect((await places({}, nearest)).found).toEqual(TEAM_FOUND)
  })

  test('$TEAMRIG_TEAM wins over the pointer file, as it does for teamrig', async () => {
    const { found, reads } = await places({ TEAMRIG_TEAM: 'ops' }, { [POINTER]: json({ team: 'web' }) })
    expect(found).toEqual({
      kind: 'found',
      dirs: { tasksDir: `${KIT}/teams/ops/state`, inboxDir: `${KIT}/teams/ops/state/inbox` },
      team: { team: 'ops', dir: `${KIT}/teams/ops`, teamsDir: `${KIT}/teams`, config: `${KIT}/teams/ops/config.json`, renames: `${KIT}/teams/ops/state/renames.jsonl`, turnLog: null },
      settings: TEAM_SETTINGS,
      goalsDoc: null,
    })
    expect(reads).toEqual([])
  })

  test("the team config's paths move the state and inbox folders, a relative one under the team's folder", async () => {
    const both = await places({}, { [POINTER]: json({ team: 'web' }), [CONFIG]: json({ paths: { state: 'data', inbox: 'D:\\inbox' } }) })
    expect(both.found).toEqual({
      kind: 'found',
      dirs: { tasksDir: `${KIT}/teams/web/data`, inboxDir: 'D:/inbox' },
      team: { ...WEB_FILES, renames: `${KIT}/teams/web/data/renames.jsonl`, turnLog: { dir: `${KIT}/teams/web/data/turn-log`, keepHours: 24 } },
      settings: TEAM_SETTINGS,
      goalsDoc: null,
    })
    const stateOnly = await places({}, { [POINTER]: json({ team: 'web' }), [CONFIG]: json({ paths: { state: '/srv/state' } }) })
    expect(stateOnly.found).toEqual({
      kind: 'found',
      dirs: { tasksDir: '/srv/state', inboxDir: '/srv/state/inbox' },
      team: { ...WEB_FILES, renames: '/srv/state/renames.jsonl', turnLog: { dir: '/srv/state/turn-log', keepHours: 24 } },
      settings: TEAM_SETTINGS,
      goalsDoc: null,
    })
  })

  test("the team config's register.check.notPickedUpAfterHours is when a task reads NOT PICKED UP", async () => {
    const files = { [POINTER]: json({ team: 'web' }), [CONFIG]: json({ register: { check: { notPickedUpAfterHours: 48 } } }) }
    const settings = { ...TEAM_SETTINGS, notPickedUpAfterHours: 48 }
    expect((await places({}, files)).found).toEqual({ ...TEAM_FOUND, team: WEB_LOGGED, settings })
  })

  test("the team config's register.ownerSource and requireDecisionCard decide the owner's cards; with none set, teamrig's defaults", async () => {
    const files = { [POINTER]: json({ team: 'web' }), [CONFIG]: json({ register: { ownerSource: 'boss', requireDecisionCard: false } }) }
    const settings = { ...TEAM_SETTINGS, ownerSource: 'boss', requireDecisionCard: false }
    expect((await places({}, files)).found).toEqual({ ...TEAM_FOUND, team: WEB_LOGGED, settings })
    expect(TEAM_SETTINGS).toMatchObject({ ownerSource: 'owner', requireDecisionCard: true })
    expect((await places({}, { [POINTER]: json({ team: 'web' }) })).found).toEqual(TEAM_FOUND)
  })

  test("the team config's turnLog.keepHours is how long its turn log is kept, the Log view's window", async () => {
    const files = { [POINTER]: json({ team: 'web' }), [CONFIG]: json({ turnLog: { keepHours: 2 } }) }
    const team = { ...WEB_FILES, turnLog: { dir: `${STATE}/turn-log`, keepHours: 2 } }
    expect((await places({}, files)).found).toEqual({ ...TEAM_FOUND, team })
  })

  test("the team config's timeZone is the team's zone; with none set, the machine's", async () => {
    const machine = { machineZone: 'Europe/Berlin' }
    const zoned = { [POINTER]: json({ team: 'web' }), [CONFIG]: json({ timeZone: 'Asia/Jerusalem' }) }
    const jerusalem = { ...TEAM_SETTINGS, timeZone: 'Asia/Jerusalem' }
    expect((await places({}, zoned, machine)).found).toEqual({ ...TEAM_FOUND, team: WEB_LOGGED, settings: jerusalem })
    const berlin = { ...TEAM_SETTINGS, timeZone: 'Europe/Berlin' }
    expect((await places({}, { [POINTER]: json({ team: 'web' }) }, machine)).found).toEqual({ ...TEAM_FOUND, settings: berlin })
  })

  test('a machine zone the system does not know reads as UTC, as teamrig resolves it', async () => {
    expect((await places({}, WEB_POINTER, { machineZone: 'Not/A_Zone' })).found).toEqual(TEAM_FOUND)
  })

  test('a team config teamrig cannot read is the problem, naming the file, where in it and what is wrong', async () => {
    const team = { [POINTER]: json({ team: 'web' }) }
    expect((await places({}, { ...team, [CONFIG]: '[1]' })).found).toEqual({
      kind: 'problem',
      problem: `${CONFIG}: expected a JSON object at the top level`,
      goalsDoc: null,
    })
    expect(problemOf((await places({}, { ...team, [CONFIG]: '{' })).found)).toMatch(/^C:\/Homes\/a\/\.teamrig\/teams\/web\/config\.json: not valid JSON: /)
    expect(problemOf((await places({}, { ...team, [CONFIG]: json({ configVersion: 'two' }) })).found)).toMatch(
      /^C:\/Homes\/a\/\.teamrig\/teams\/web\/config\.json: configVersion: /,
    )
    expect((await places({}, { ...team, [CONFIG]: '{}' }, { locked: [CONFIG] })).found).toEqual({
      kind: 'problem',
      problem: `${CONFIG} cannot be read (EBUSY: ${CONFIG})`,
      goalsDoc: null,
    })
  })

  test('a broken pointer or team id is the problem, naming where it was found', async () => {
    const cases: ReadonlyArray<readonly [PlacesEnv, Readonly<Record<string, string>>, string]> = [
      [{}, { [POINTER]: 'nope' }, `${POINTER} is not JSON; expected {"team": "<id>"}`],
      [{}, { [POINTER]: json({ name: 'web' }) }, `${POINTER} has no "team" text; expected {"team": "<id>"}`],
      [{}, { [POINTER]: json({ team: 'Web' }) }, `${POINTER}: "Web" is not a team id (${TEAM_RULE})`],
      [{ TEAMRIG_TEAM: '../x' }, {}, `$TEAMRIG_TEAM: "../x" is not a team id (${TEAM_RULE})`],
    ]
    for (const [env, files, problem] of cases) {
      expect((await places(env, files)).found).toEqual({ kind: 'problem', problem, goalsDoc: null })
    }
    const locked = await places({}, { [POINTER]: json({ team: 'web' }) }, { locked: [POINTER] })
    expect(locked.found).toEqual({ kind: 'problem', problem: `${POINTER} cannot be read (EBUSY: ${POINTER})`, goalsDoc: null })
  })

  test('with no team, the project is not set up: its folder and the kit home’s teams', async () => {
    const { found, reads } = await places({})
    expect(found).toEqual({ kind: 'unset', setup: { project: 'C:/w/app/src', teams: [] } })
    expect(reads).toEqual([])
    // A folder named as teamrig names a team is one; a file, or a folder no team id names, is not.
    const kit = { [CONFIG]: '{}', [`${KIT}/teams/ops/state/events.jsonl`]: '', [`${KIT}/teams/Old/config.json`]: '{}', [`${KIT}/teams/notes.md`]: '' }
    expect((await places({}, kit)).found).toEqual({ kind: 'unset', setup: { project: 'C:/w/app/src', teams: ['ops', 'web'] } })
    // A teams folder it cannot list leaves the teams out, never the setup.
    const locked = await places({}, kit, { locked: [`${KIT}/teams`] })
    expect(locked.found).toEqual({ kind: 'unset', setup: { project: 'C:/w/app/src', teams: [] } })
  })

  test('a project not set up follows the kit home its variable moves, and a settings file leaves it unset', async () => {
    const moved = await places({ TEAMRIG_HOME: 'D:\\kit' }, { 'D:/kit/teams/web/config.json': '{}', [CONFIG]: '{}' })
    expect(moved.found).toEqual({ kind: 'unset', setup: { project: 'C:/w/app/src', teams: ['web'] } })
    const named = await places({ TEAMRIG_PANE_SETTINGS: '~/pane.json' }, { 'C:/Homes/a/pane.json': json({ goalsDoc: 'docs/G.md' }) })
    expect(named.found).toEqual({ kind: 'unset', setup: { project: 'C:/w/app/src', teams: [] } })
  })

  test('with no session folder or no home folder, it says what to set: a teamrig project or team, or the kit home', async () => {
    const project = "no register found: start the session in a teamrig team's project (.teamrig.json) or set TEAMRIG_TEAM"
    expect((await places({}, {}, { cwd: null })).found).toEqual({ kind: 'problem', problem: project, goalsDoc: null })
    // $TEAMRIG_TEAM names the team with no session folder to walk up from.
    expect((await places({ TEAMRIG_TEAM: 'web' }, {}, { cwd: null })).found).toEqual(TEAM_FOUND)
    const homeless = "no register found: set TEAMRIG_HOME for teamrig's register"
    expect((await places({}, WEB_POINTER, { home: null })).found).toEqual({ kind: 'problem', problem: homeless, goalsDoc: null })
    expect((await places({}, {}, { home: null, cwd: null })).found).toEqual({ kind: 'problem', problem: homeless, goalsDoc: null })
    expect((await places({ TEAMRIG_HOME: 'D:/kit' }, {}, { home: null })).found).toEqual({ kind: 'unset', setup: { project: 'C:/w/app/src', teams: [] } })
  })

  test('the pointer walk climbs to the root of a drive or of a slash path', async () => {
    expect(foldersUp('C:/w/app')).toEqual(['C:/w/app', 'C:/w', 'C:'])
    expect(foldersUp('/srv/app')).toEqual(['/srv/app', '/srv', ''])
    expect(foldersUp('C:')).toEqual(['C:'])
    const { found } = await places({}, { '/.teamrig.json': json({ team: 'web' }) }, { cwd: '/srv/app' })
    expect(found).toEqual(TEAM_FOUND)
  })

  test("a team's state folder: its config's paths.state, a relative one under the team's folder, else state there", () => {
    const home = `${KIT}/teams/web`
    const withState = (state: string) => configOf({ team: { id: 'web' }, sessions: ['lead'], roles: { lead: 'lead' }, paths: { state } })
    expect(teamStateDir(home, null)).toBe(STATE)
    expect(teamStateDir(home, configOf({ team: { id: 'web' }, sessions: ['lead'], roles: { lead: 'lead' } }))).toBe(STATE)
    expect(teamStateDir(home, withState('kept\\here'))).toBe(`${home}/kept/here`)
    expect(teamStateDir(home, withState('D:\\kept'))).toBe('D:/kept')
  })

  test('the folder names that name a team, sorted; the rest left out', () => {
    expect(teamIds(['web', 'Notes', '.git', 'api', 'a-1', '1st'])).toEqual(['a-1', 'api', 'web'])
  })
})
