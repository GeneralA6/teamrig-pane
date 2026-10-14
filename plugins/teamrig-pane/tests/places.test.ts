import { describe, expect, test } from 'claude-code/testing'
import { findPlaces, foldersUp, type PlacesEnv, type PlacesInput } from '../hooks/places'

const KIT = 'C:/Homes/a/.teamrig'
const SETTINGS = `${KIT}/pane.json`
const POINTER = 'C:/w/app/.teamrig.json'
const STATE = `${KIT}/teams/web/state`
const TEAM_RULE = 'a lowercase letter, then lowercase letters, digits or -, at most 32'
const ALL_DIRS = { tasksDir: 'D:/t', inboxDir: 'D:/i', usageDir: 'D:/u' }
/** The three folders as variables, so the settings file is the only thing left to fail. */
const ALL_DIRS_ENV = { TEAMRIG_PANE_TASKS_DIR: 'D:/t', TEAMRIG_PANE_INBOX_DIR: 'D:/i', TEAMRIG_PANE_USAGE_DIR: 'D:/u' }

/** Files by forward-slash path; a path in `locked` throws as a locked file does, and `reads` records each read. */
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
  return { port, reads }
}

type Options = { home?: string | null; cwd?: string | null; locked?: readonly string[] }

/** Finds the places over `env` and `files`, from home C:/Homes/a and the folder C:/w/app/src unless `options` say otherwise. */
async function places(env: PlacesEnv, files: Readonly<Record<string, string>> = {}, options: Options = {}) {
  const fake = fakeFiles(files, options.locked ?? [])
  const found = await findPlaces({
    env,
    files: fake.port,
    home: options.home === undefined ? 'C:\\Homes\\a\\' : options.home,
    cwd: options.cwd === undefined ? 'C:\\w\\app\\src' : options.cwd,
  })
  return { found, reads: fake.reads }
}

const json = (value: unknown): string => JSON.stringify(value)

describe('places', () => {
  test('the variables name the folders, ~/ under the home folder and slashes made forward', async () => {
    const { found, reads } = await places({
      TEAMRIG_PANE_TASKS_DIR: 'D:\\team\\tasks\\',
      TEAMRIG_PANE_INBOX_DIR: ' D:/team/inbox ',
      TEAMRIG_PANE_USAGE_DIR: '~/usage',
      TEAMRIG_PANE_GOALS_DOC: 'docs/GOALS.md',
    })
    expect(found).toEqual({
      found: true,
      dirs: { tasksDir: 'D:/team/tasks', inboxDir: 'D:/team/inbox', usageDir: 'C:/Homes/a/usage' },
      goalsDoc: 'docs/GOALS.md',
    })
    expect(reads).toEqual([])
  })

  test('the settings file in the kit home fills what the variables leave unset, and a variable wins over it', async () => {
    const settings = json({ tasksDir: '~/team/tasks', inboxDir: '~\\team\\inbox', usageDir: 'E:\\usage', goalsDoc: 'docs/R.md' })
    expect((await places({}, { [SETTINGS]: settings })).found).toEqual({
      found: true,
      dirs: { tasksDir: 'C:/Homes/a/team/tasks', inboxDir: 'C:/Homes/a/team/inbox', usageDir: 'E:/usage' },
      goalsDoc: 'docs/R.md',
    })
    const env = { TEAMRIG_PANE_TASKS_DIR: 'D:/t', TEAMRIG_PANE_GOALS_DOC: 'docs/G.md' }
    expect((await places(env, { [SETTINGS]: settings })).found).toEqual({
      found: true,
      dirs: { tasksDir: 'D:/t', inboxDir: 'C:/Homes/a/team/inbox', usageDir: 'E:/usage' },
      goalsDoc: 'docs/G.md',
    })
  })

  test('$TEAMRIG_HOME moves the kit home, and with it the default settings file', async () => {
    const { found } = await places({ TEAMRIG_HOME: ' D:\\kit ' }, { 'D:/kit/pane.json': json(ALL_DIRS) })
    expect(found).toEqual({ found: true, dirs: ALL_DIRS, goalsDoc: null })
  })

  test('$TEAMRIG_PANE_SETTINGS names another settings file, which must then be there', async () => {
    const env = { TEAMRIG_PANE_SETTINGS: '~/pane.json' }
    expect((await places(env, { 'C:/Homes/a/pane.json': json(ALL_DIRS) })).found).toEqual({ found: true, dirs: ALL_DIRS, goalsDoc: null })
    expect((await places(env, { [SETTINGS]: json(ALL_DIRS) })).found).toEqual({
      found: false,
      problem: 'C:/Homes/a/pane.json (TEAMRIG_PANE_SETTINGS) is not there',
      goalsDoc: null,
    })
  })

  test('a settings file it cannot use is the problem, naming the file and what is wrong', async () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['not json', `${SETTINGS} is not a JSON object; expected {"tasksDir": "...", ...}`],
      ['[1]', `${SETTINGS} is not a JSON object; expected {"tasksDir": "...", ...}`],
      [json({ taskDir: 'D:/t' }), `${SETTINGS}: unknown key "taskDir" (known: tasksDir, inboxDir, usageDir, goalsDoc)`],
      [json({ tasksDir: 3 }), `${SETTINGS}: "tasksDir" must be non-empty text`],
      [json({ goalsDoc: ' ' }), `${SETTINGS}: "goalsDoc" must be non-empty text`],
      [json({ usageDir: 'team/usage' }), `${SETTINGS}: "usageDir" must be an absolute folder or start with ~/`],
    ]
    for (const [text, problem] of cases) {
      expect((await places(ALL_DIRS_ENV, { [SETTINGS]: text })).found).toEqual({ found: false, problem, goalsDoc: null })
    }
    const withGoals = { ...ALL_DIRS_ENV, TEAMRIG_PANE_GOALS_DOC: 'docs/G.md' }
    expect((await places(withGoals, { [SETTINGS]: 'not json' })).found).toEqual({
      found: false,
      problem: `${SETTINGS} is not a JSON object; expected {"tasksDir": "...", ...}`,
      goalsDoc: 'docs/G.md',
    })
  })

  test('a locked settings file is a problem, never read as no file', async () => {
    const { found, reads } = await places({}, { [SETTINGS]: json(ALL_DIRS) }, { locked: [SETTINGS] })
    expect(found).toEqual({ found: false, problem: `${SETTINGS} cannot be read (EBUSY: ${SETTINGS})`, goalsDoc: null })
    expect(reads).toEqual([])
  })

  test('with no folder named, it reads where teamrig keeps the register of the nearest pointer file’s team', async () => {
    const team = { found: true, dirs: { tasksDir: STATE, inboxDir: `${STATE}/inbox`, usageDir: `${STATE}/token-usage` }, goalsDoc: null }
    expect((await places({}, { [POINTER]: json({ team: 'web' }) })).found).toEqual(team)
    expect((await places({}, { 'C:/w/.teamrig.json': json({ team: 'web' }) })).found).toEqual(team)
    expect((await places({}, { 'C:/.teamrig.json': json({ team: 'web' }) })).found).toEqual(team)
    const nearest = { [POINTER]: json({ team: 'web' }), 'C:/w/.teamrig.json': json({ team: 'ops' }) }
    expect((await places({}, nearest)).found).toEqual(team)
  })

  test('$TEAMRIG_TEAM wins over the pointer file, as it does for teamrig', async () => {
    const { found, reads } = await places({ TEAMRIG_TEAM: 'ops' }, { [POINTER]: json({ team: 'web' }) })
    expect(found).toEqual({
      found: true,
      dirs: { tasksDir: `${KIT}/teams/ops/state`, inboxDir: `${KIT}/teams/ops/state/inbox`, usageDir: `${KIT}/teams/ops/state/token-usage` },
      goalsDoc: null,
    })
    expect(reads).toEqual([])
  })

  test("the team config's paths move the state and inbox folders, a relative one under the team's folder", async () => {
    const config = `${KIT}/teams/web/config.json`
    const both = await places({}, { [POINTER]: json({ team: 'web' }), [config]: json({ paths: { state: 'data', inbox: 'D:\\inbox' } }) })
    expect(both.found).toEqual({
      found: true,
      dirs: { tasksDir: `${KIT}/teams/web/data`, inboxDir: 'D:/inbox', usageDir: `${KIT}/teams/web/data/token-usage` },
      goalsDoc: null,
    })
    const stateOnly = await places({}, { [POINTER]: json({ team: 'web' }), [config]: json({ paths: { state: '/srv/state' } }) })
    expect(stateOnly.found).toEqual({
      found: true,
      dirs: { tasksDir: '/srv/state', inboxDir: '/srv/state/inbox', usageDir: '/srv/state/token-usage' },
      goalsDoc: null,
    })
    const broken = await places({}, { [POINTER]: json({ team: 'web' }), [config]: '{' })
    expect(broken.found).toEqual({ found: false, problem: `${config} is not a JSON object`, goalsDoc: null })
  })

  test('a variable or setting still wins over the team default, folder by folder', async () => {
    const { found } = await places({ TEAMRIG_PANE_INBOX_DIR: 'D:/i' }, { [POINTER]: json({ team: 'web' }), [SETTINGS]: json({ usageDir: 'D:/u' }) })
    expect(found).toEqual({ found: true, dirs: { tasksDir: STATE, inboxDir: 'D:/i', usageDir: 'D:/u' }, goalsDoc: null })
  })

  test('a broken pointer or team id is the problem, naming where it was found', async () => {
    const cases: ReadonlyArray<readonly [PlacesEnv, Readonly<Record<string, string>>, string]> = [
      [{}, { [POINTER]: 'nope' }, `${POINTER} is not JSON; expected {"team": "<id>"}`],
      [{}, { [POINTER]: json({ name: 'web' }) }, `${POINTER} has no "team" text; expected {"team": "<id>"}`],
      [{}, { [POINTER]: json({ team: 'Web' }) }, `${POINTER}: "Web" is not a team id (${TEAM_RULE})`],
      [{ TEAMRIG_TEAM: '../x' }, {}, `$TEAMRIG_TEAM: "../x" is not a team id (${TEAM_RULE})`],
    ]
    for (const [env, files, problem] of cases) {
      expect((await places(env, files)).found).toEqual({ found: false, problem, goalsDoc: null })
    }
    const locked = await places({}, { [POINTER]: json({ team: 'web' }) }, { locked: [POINTER] })
    expect(locked.found).toEqual({ found: false, problem: `${POINTER} cannot be read (EBUSY: ${POINTER})`, goalsDoc: null })
  })

  test('with nothing to go on, it says what to set: the variables, the settings file or a teamrig project', async () => {
    const variables = 'TEAMRIG_PANE_TASKS_DIR, TEAMRIG_PANE_INBOX_DIR and TEAMRIG_PANE_USAGE_DIR'
    const project = `no register found: set ${variables}, write them in ${SETTINGS}, or start the session in a teamrig team's project (.teamrig.json)`
    expect((await places({ TEAMRIG_PANE_TASKS_DIR: 'D:/t' })).found).toEqual({ found: false, problem: project, goalsDoc: null })
    expect((await places({}, {}, { cwd: null })).found).toEqual({ found: false, problem: project, goalsDoc: null })
    const homeless = `no register found: set ${variables}, write them in a settings file named by TEAMRIG_PANE_SETTINGS, or set TEAMRIG_HOME for teamrig's register`
    expect((await places({}, { [POINTER]: json({ team: 'web' }) }, { home: null })).found).toEqual({ found: false, problem: homeless, goalsDoc: null })
    expect((await places({ TEAMRIG_PANE_USAGE_DIR: '~/u' }, {}, { home: null, cwd: null })).found).toEqual({ found: false, problem: homeless, goalsDoc: null })
  })

  test('the pointer walk climbs to the root of a drive or of a slash path', async () => {
    expect(foldersUp('C:/w/app')).toEqual(['C:/w/app', 'C:/w', 'C:'])
    expect(foldersUp('/srv/app')).toEqual(['/srv/app', '/srv', ''])
    expect(foldersUp('C:')).toEqual(['C:'])
    const { found } = await places({}, { '/.teamrig.json': json({ team: 'web' }) }, { cwd: '/srv/app' })
    expect(found).toEqual({ found: true, dirs: { tasksDir: STATE, inboxDir: `${STATE}/inbox`, usageDir: `${STATE}/token-usage` }, goalsDoc: null })
  })
})
