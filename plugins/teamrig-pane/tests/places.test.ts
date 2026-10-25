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
const ALL_DIRS = { tasksDir: 'D:/t', inboxDir: 'D:/i' }
/** Both folders as variables, so the settings file is the only thing left to fail. */
const ALL_DIRS_ENV = { TEAMRIG_PANE_TASKS_DIR: 'D:/t', TEAMRIG_PANE_INBOX_DIR: 'D:/i' }
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
  test('the variables name the folders, ~/ under the home folder and slashes made forward; with no team found, no team files', async () => {
    const { found, reads } = await places({
      TEAMRIG_PANE_TASKS_DIR: 'D:\\team\\tasks\\',
      TEAMRIG_PANE_INBOX_DIR: ' ~/inbox ',
      TEAMRIG_PANE_GOALS_DOC: 'docs/GOALS.md',
    })
    expect(found).toEqual({
      kind: 'found',
      dirs: { tasksDir: 'D:/team/tasks', inboxDir: 'C:/Homes/a/inbox' },
      team: null,
      settings: TEAM_SETTINGS,
      goalsDoc: 'docs/GOALS.md',
    })
    expect(reads).toEqual([])
  })

  test('the settings file in the kit home fills what the variables leave unset, and a variable wins over it', async () => {
    const settings = json({ tasksDir: '~/team/tasks', inboxDir: '~\\team\\inbox', goalsDoc: 'docs/R.md' })
    expect((await places({}, { [SETTINGS]: settings })).found).toEqual({
      kind: 'found',
      dirs: { tasksDir: 'C:/Homes/a/team/tasks', inboxDir: 'C:/Homes/a/team/inbox' },
      team: null,
      settings: TEAM_SETTINGS,
      goalsDoc: 'docs/R.md',
    })
    const env = { TEAMRIG_PANE_TASKS_DIR: 'D:/t', TEAMRIG_PANE_GOALS_DOC: 'docs/G.md' }
    expect((await places(env, { [SETTINGS]: settings })).found).toEqual({
      kind: 'found',
      dirs: { tasksDir: 'D:/t', inboxDir: 'C:/Homes/a/team/inbox' },
      team: null,
      settings: TEAM_SETTINGS,
      goalsDoc: 'docs/G.md',
    })
  })

  test('$TEAMRIG_HOME moves the kit home, and with it the default settings file', async () => {
    const { found } = await places({ TEAMRIG_HOME: ' D:\\kit ' }, { 'D:/kit/pane.json': json(ALL_DIRS) })
    expect(found).toEqual({ kind: 'found', dirs: ALL_DIRS, team: null, settings: TEAM_SETTINGS, goalsDoc: null })
  })

  test('$TEAMRIG_PANE_SETTINGS names another settings file, which must then be there', async () => {
    const env = { TEAMRIG_PANE_SETTINGS: '~/pane.json' }
    expect((await places(env, { 'C:/Homes/a/pane.json': json(ALL_DIRS) })).found).toEqual({
      kind: 'found',
      dirs: ALL_DIRS,
      team: null,
      settings: TEAM_SETTINGS,
      goalsDoc: null,
    })
    expect((await places(env, { [SETTINGS]: json(ALL_DIRS) })).found).toEqual({
      kind: 'problem',
      problem: 'C:/Homes/a/pane.json (TEAMRIG_PANE_SETTINGS) is not there',
      goalsDoc: null,
    })
  })

  test('a settings file it cannot use is the problem, naming the file and what is wrong', async () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['not json', `${SETTINGS} is not a JSON object; expected {"tasksDir": "...", ...}`],
      ['[1]', `${SETTINGS} is not a JSON object; expected {"tasksDir": "...", ...}`],
      [json({ taskDir: 'D:/t' }), `${SETTINGS}: unknown key "taskDir" (known: tasksDir, inboxDir, goalsDoc)`],
      [json({ usageDir: 'D:/u' }), `${SETTINGS}: unknown key "usageDir" (known: tasksDir, inboxDir, goalsDoc)`],
      [json({ tasksDir: 3 }), `${SETTINGS}: "tasksDir" must be non-empty text`],
      [json({ goalsDoc: ' ' }), `${SETTINGS}: "goalsDoc" must be non-empty text`],
      [json({ inboxDir: 'team/inbox' }), `${SETTINGS}: "inboxDir" must be an absolute folder or start with ~/`],
    ]
    for (const [text, problem] of cases) {
      expect((await places(ALL_DIRS_ENV, { [SETTINGS]: text })).found).toEqual({ kind: 'problem', problem, goalsDoc: null })
    }
    const withGoals = { ...ALL_DIRS_ENV, TEAMRIG_PANE_GOALS_DOC: 'docs/G.md' }
    expect((await places(withGoals, { [SETTINGS]: 'not json' })).found).toEqual({
      kind: 'problem',
      problem: `${SETTINGS} is not a JSON object; expected {"tasksDir": "...", ...}`,
      goalsDoc: 'docs/G.md',
    })
  })

  test('a locked settings file is a problem, never read as no file', async () => {
    const { found, reads } = await places({}, { [SETTINGS]: json(ALL_DIRS) }, { locked: [SETTINGS] })
    expect(found).toEqual({ kind: 'problem', problem: `${SETTINGS} cannot be read (EBUSY: ${SETTINGS})`, goalsDoc: null })
    expect(reads).toEqual([])
  })

  test('with no folder named, it reads where teamrig keeps the register of the nearest pointer file’s team', async () => {
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

  test('with both folders named, the session’s team is still looked for, for its files, and a team it cannot find or read leaves none', async () => {
    // A config whose priorities teamrig cannot use still names the team: its files stay found for session lookups.
    const cases: ReadonlyArray<readonly [Readonly<Record<string, string>>, Options, TeamFiles | null]> = [
      [{ [POINTER]: json({ team: 'web' }), [CONFIG]: '{}' }, {}, WEB_LOGGED],
      [{}, {}, null],
      [{ [POINTER]: 'nope' }, {}, null],
      [{ [POINTER]: json({ team: 'web' }), [CONFIG]: json({ register: { priorities: 'none' } }) }, {}, WEB_LOGGED],
      [{ [POINTER]: json({ team: 'web' }) }, { locked: [CONFIG] }, null],
      [{}, { home: null }, null],
    ]
    for (const [files, options, team] of cases) {
      const found = (await places(ALL_DIRS_ENV, files, options)).found
      expect(found).toEqual({ kind: 'found', dirs: ALL_DIRS, team, settings: TEAM_SETTINGS, goalsDoc: null })
    }
  })

  test("the team config's register.check.notPickedUpAfterHours is when a task reads NOT PICKED UP, folders named or not", async () => {
    const files = { [POINTER]: json({ team: 'web' }), [CONFIG]: json({ register: { check: { notPickedUpAfterHours: 48 } } }) }
    const settings = { ...TEAM_SETTINGS, notPickedUpAfterHours: 48 }
    expect((await places({}, files)).found).toEqual({ ...TEAM_FOUND, team: WEB_LOGGED, settings })
    const named = (await places(ALL_DIRS_ENV, files)).found
    expect(named).toEqual({ kind: 'found', dirs: ALL_DIRS, team: WEB_LOGGED, settings, goalsDoc: null })
  })

  test("the team config's turnLog.keepHours is how long its turn log is kept, the Log view's window, folders named or not", async () => {
    const files = { [POINTER]: json({ team: 'web' }), [CONFIG]: json({ turnLog: { keepHours: 2 } }) }
    const team = { ...WEB_FILES, turnLog: { dir: `${STATE}/turn-log`, keepHours: 2 } }
    expect((await places({}, files)).found).toEqual({ ...TEAM_FOUND, team })
    expect((await places(ALL_DIRS_ENV, files)).found).toEqual({ kind: 'found', dirs: ALL_DIRS, team, settings: TEAM_SETTINGS, goalsDoc: null })
  })

  test("the team config's timeZone is the team's zone, folders named or not; with none set, the machine's", async () => {
    const machine = { machineZone: 'Europe/Berlin' }
    const zoned = { [POINTER]: json({ team: 'web' }), [CONFIG]: json({ timeZone: 'Asia/Jerusalem' }) }
    const jerusalem = { ...TEAM_SETTINGS, timeZone: 'Asia/Jerusalem' }
    expect((await places({}, zoned, machine)).found).toEqual({ ...TEAM_FOUND, team: WEB_LOGGED, settings: jerusalem })
    expect((await places(ALL_DIRS_ENV, zoned, machine)).found).toEqual({ kind: 'found', dirs: ALL_DIRS, team: WEB_LOGGED, settings: jerusalem, goalsDoc: null })
    const berlin = { ...TEAM_SETTINGS, timeZone: 'Europe/Berlin' }
    expect((await places({}, { [POINTER]: json({ team: 'web' }) }, machine)).found).toEqual({ ...TEAM_FOUND, settings: berlin })
    expect((await places(ALL_DIRS_ENV, {}, machine)).found).toEqual({ kind: 'found', dirs: ALL_DIRS, team: null, settings: berlin, goalsDoc: null })
  })

  test('a machine zone the system does not know reads as UTC, as teamrig resolves it', async () => {
    const found = (await places(ALL_DIRS_ENV, {}, { machineZone: 'Not/A_Zone' })).found
    expect(found).toEqual({ kind: 'found', dirs: ALL_DIRS, team: null, settings: TEAM_SETTINGS, goalsDoc: null })
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

  test('a variable or setting still wins over the team default, folder by folder', async () => {
    const { found } = await places({ TEAMRIG_PANE_INBOX_DIR: 'D:/i' }, { [POINTER]: json({ team: 'web' }), [SETTINGS]: json({ inboxDir: 'E:/i' }) })
    expect(found).toEqual({ kind: 'found', dirs: { tasksDir: STATE, inboxDir: 'D:/i' }, team: WEB_FILES, settings: TEAM_SETTINGS, goalsDoc: null })
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

  test('with no team and no folder named, the project is not set up: its folder and the kit home’s teams', async () => {
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

  test('a project not set up follows the kit home its variable moves, and a settings file naming no folder leaves it unset', async () => {
    const moved = await places({ TEAMRIG_HOME: 'D:\\kit' }, { 'D:/kit/teams/web/config.json': '{}', [CONFIG]: '{}' })
    expect(moved.found).toEqual({ kind: 'unset', setup: { project: 'C:/w/app/src', teams: ['web'] } })
    // A settings file that names no folder leaves the project as unset as no file does.
    const named = await places({ TEAMRIG_PANE_SETTINGS: '~/pane.json' }, { 'C:/Homes/a/pane.json': json({ goalsDoc: 'docs/G.md' }) })
    expect(named.found).toEqual({ kind: 'unset', setup: { project: 'C:/w/app/src', teams: [] } })
  })

  test('with one folder named or no session folder, it says what to set: the variables, the settings file or a teamrig project', async () => {
    const variables = 'TEAMRIG_PANE_TASKS_DIR and TEAMRIG_PANE_INBOX_DIR'
    const project = `no register found: set ${variables}, write them in ${SETTINGS}, or start the session in a teamrig team's project (.teamrig.json)`
    expect((await places({ TEAMRIG_PANE_TASKS_DIR: 'D:/t' })).found).toEqual({ kind: 'problem', problem: project, goalsDoc: null })
    expect((await places({}, { [SETTINGS]: json({ inboxDir: 'D:/i' }) })).found).toEqual({ kind: 'problem', problem: project, goalsDoc: null })
    expect((await places({}, {}, { cwd: null })).found).toEqual({ kind: 'problem', problem: project, goalsDoc: null })
    const homeless = `no register found: set ${variables}, write them in a settings file named by TEAMRIG_PANE_SETTINGS, or set TEAMRIG_HOME for teamrig's register`
    expect((await places({}, { [POINTER]: json({ team: 'web' }) }, { home: null })).found).toEqual({ kind: 'problem', problem: homeless, goalsDoc: null })
    expect((await places({ TEAMRIG_PANE_INBOX_DIR: '~/i' }, {}, { home: null, cwd: null })).found).toEqual({ kind: 'problem', problem: homeless, goalsDoc: null })
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
