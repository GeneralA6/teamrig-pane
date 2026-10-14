// Where the register is, read once when the session starts. Each folder comes from the first of: its
// TEAMRIG_PANE_* variable, the pane's settings file, then where teamrig keeps the register of the
// session's team (`<kit home>/teams/<team>/state`, or the team config's `paths.state` and
// `paths.inbox`). The goals document comes from its variable or the settings file, else none.
import { asString, isRecord, pick } from './core/guards'
import { slashed, type Files, type RegisterDirs } from './source'

/** The variables the pane reads. */
export const PANE_ENV = {
  tasksDir: 'TEAMRIG_PANE_TASKS_DIR',
  inboxDir: 'TEAMRIG_PANE_INBOX_DIR',
  usageDir: 'TEAMRIG_PANE_USAGE_DIR',
  goalsDoc: 'TEAMRIG_PANE_GOALS_DOC',
  /** The settings file, in place of `<kit home>/pane.json`. */
  settings: 'TEAMRIG_PANE_SETTINGS',
} as const

/** teamrig's own variables: its kit home folder and the team a session runs for. */
export const TEAMRIG_ENV = { home: 'TEAMRIG_HOME', team: 'TEAMRIG_TEAM' } as const

/** Every variable the pane's places come from. */
export type PlaceVariable = (typeof PANE_ENV)[keyof typeof PANE_ENV] | (typeof TEAMRIG_ENV)[keyof typeof TEAMRIG_ENV]

/** The variables as the environment Claude Code runs in has them (the engine reads each by its literal name). */
export type PlacesEnv = Readonly<Partial<Record<PlaceVariable, string>>>

/** teamrig's pointer file: `{"team": "<id>"}` ties a project folder, and every folder below it, to a team. */
export const TEAM_POINTER = '.teamrig.json'

/** teamrig's rule for a team id, which becomes part of a path. */
const TEAM_ID = /^[a-z][a-z0-9-]{0,31}$/

/** What the settings file may set; every key is optional. */
const SETTING_KEYS = ['tasksDir', 'inboxDir', 'usageDir', 'goalsDoc'] as const
type SettingKey = (typeof SETTING_KEYS)[number]
type Settings = Partial<Record<SettingKey, string>>
type DirKey = Exclude<SettingKey, 'goalsDoc'>

/** The register's folders, or the problem the pane shows instead of tasks; the goals document either way. */
export type Places =
  | { found: true; dirs: RegisterDirs; goalsDoc: string | null }
  | { found: false; problem: string; goalsDoc: string | null }

export type PlacesInput = {
  env: PlacesEnv
  files: Pick<Files, 'stamp' | 'read'>
  /** The person's home folder (USERPROFILE or HOME), for `~/` and the default kit home. */
  home: string | null
  /** The session's folder, where the walk for teamrig's pointer file starts. */
  cwd: string | null
}

type Found<T> = { ok: true; value: T } | { ok: false; problem: string }

export async function findPlaces(input: PlacesInput): Promise<Places> {
  const home = input.home === null ? null : slashed(input.home)
  const variable = (name: PlaceVariable): string | undefined => input.env[name]?.trim() || undefined
  const kitVariable = variable(TEAMRIG_ENV.home)
  const kit = kitVariable === undefined ? (home === null ? null : `${home}/.teamrig`) : slashed(withHome(kitVariable, home))
  const fromEnv: Settings = {}
  for (const key of SETTING_KEYS) {
    const value = variable(PANE_ENV[key])
    if (value !== undefined) fromEnv[key] = key === 'goalsDoc' ? value : slashed(withHome(value, home))
  }
  const named = variable(PANE_ENV.settings)
  const settingsPath = named === undefined ? (kit === null ? null : `${kit}/pane.json`) : slashed(withHome(named, home))
  const settings: Found<Settings> = settingsPath === null ? { ok: true, value: {} } : await readSettings(input.files, settingsPath, named !== undefined, home)
  const goalsDoc = fromEnv.goalsDoc ?? (settings.ok ? settings.value.goalsDoc : undefined) ?? null
  if (!settings.ok) return { found: false, problem: settings.problem, goalsDoc }
  const chosen = (key: DirKey): string | undefined => fromEnv[key] ?? settings.value[key]
  const tasksDir = chosen('tasksDir')
  const inboxDir = chosen('inboxDir')
  const usageDir = chosen('usageDir')
  if (tasksDir !== undefined && inboxDir !== undefined && usageDir !== undefined) {
    return { found: true, dirs: { tasksDir, inboxDir, usageDir }, goalsDoc }
  }
  const team = await teamFolders(input, variable, kit, settingsPath)
  if (!team.ok) return { found: false, problem: team.problem, goalsDoc }
  return {
    found: true,
    dirs: {
      tasksDir: tasksDir ?? team.value.state,
      inboxDir: inboxDir ?? team.value.inbox,
      usageDir: usageDir ?? `${team.value.state}/token-usage`,
    },
    goalsDoc,
  }
}

/** `path` with a leading `~` made the home folder; as it is without one, or with no home known. */
function withHome(path: string, home: string | null): string {
  if (home === null || !/^~([/\\]|$)/.test(path)) return path
  return `${home}${path.slice(1)}`
}

/** A drive-rooted (`C:/`) or slash-rooted path, slashes already forward. */
function isAbsolute(path: string): boolean {
  return /^[A-Za-z]:(\/|$)/.test(path) || path.startsWith('/')
}

/** The settings file's values: none when the default file is not there; a problem when it is not usable. */
async function readSettings(files: PlacesInput['files'], path: string, isNamed: boolean, home: string | null): Promise<Found<Settings>> {
  const text = await readIfThere(files, path)
  if (!text.ok) return text
  if (text.value === null) {
    return isNamed ? { ok: false, problem: `${path} (${PANE_ENV.settings}) is not there` } : { ok: true, value: {} }
  }
  const parsed = parseJson(text.value)
  if (!isRecord(parsed)) return { ok: false, problem: `${path} is not a JSON object; expected {"tasksDir": "...", ...}` }
  const known: ReadonlyArray<string> = SETTING_KEYS
  const settings: Settings = {}
  for (const [key, raw] of Object.entries(parsed)) {
    const setting = SETTING_KEYS.find(name => name === key)
    if (setting === undefined) return { ok: false, problem: `${path}: unknown key "${key}" (known: ${known.join(', ')})` }
    const value = asString(raw)?.trim()
    if (!value) return { ok: false, problem: `${path}: "${key}" must be non-empty text` }
    if (setting === 'goalsDoc') {
      settings.goalsDoc = value
      continue
    }
    const dir = slashed(withHome(value, home))
    if (!isAbsolute(dir)) return { ok: false, problem: `${path}: "${key}" must be an absolute folder or start with ~/` }
    settings[setting] = dir
  }
  return { ok: true, value: settings }
}

/** The team's state and inbox folders as teamrig lays them out, or why they cannot be found. */
async function teamFolders(
  input: PlacesInput,
  variable: (name: PlaceVariable) => string | undefined,
  kit: string | null,
  settingsPath: string | null,
): Promise<Found<{ state: string; inbox: string }>> {
  const team = await findTeam(input, variable)
  if (!team.ok) return team
  if (team.value === null || kit === null) return { ok: false, problem: nothingNamed(settingsPath, kit === null) }
  const teamHome = `${kit}/teams/${team.value}`
  const configPath = `${teamHome}/config.json`
  const config = await readIfThere(input.files, configPath)
  if (!config.ok) return config
  const parsed = config.value === null ? {} : parseJson(config.value)
  if (!isRecord(parsed)) return { ok: false, problem: `${configPath} is not a JSON object` }
  const inTeamHome = (path: string | undefined): string | undefined => {
    if (path === undefined) return undefined
    const forward = slashed(path)
    return isAbsolute(forward) ? forward : `${teamHome}/${forward}`
  }
  const state = inTeamHome(asString(pick(parsed, 'paths', 'state'))) ?? `${teamHome}/state`
  return { ok: true, value: { state, inbox: inTeamHome(asString(pick(parsed, 'paths', 'inbox'))) ?? `${state}/inbox` } }
}

/** The session's team: `$TEAMRIG_TEAM`, else the nearest pointer file up from its folder; null for none. */
async function findTeam(input: PlacesInput, variable: (name: PlaceVariable) => string | undefined): Promise<Found<string | null>> {
  const named = variable(TEAMRIG_ENV.team)
  if (named !== undefined) return checkTeam(named, `$${TEAMRIG_ENV.team}`)
  if (input.cwd === null) return { ok: true, value: null }
  for (const dir of foldersUp(slashed(input.cwd))) {
    const path = `${dir}/${TEAM_POINTER}`
    const text = await readIfThere(input.files, path)
    if (!text.ok) return text
    if (text.value === null) continue
    const parsed = parseJson(text.value)
    if (parsed === undefined) return { ok: false, problem: `${path} is not JSON; expected {"team": "<id>"}` }
    const team = asString(pick(parsed, 'team'))
    return team === undefined ? { ok: false, problem: `${path} has no "team" text; expected {"team": "<id>"}` } : checkTeam(team, path)
  }
  return { ok: true, value: null }
}

function checkTeam(team: string, from: string): Found<string> {
  return TEAM_ID.test(team)
    ? { ok: true, value: team }
    : { ok: false, problem: `${from}: "${team}" is not a team id (a lowercase letter, then lowercase letters, digits or -, at most 32)` }
}

/** `dir` and each folder above it, up to its root (`C:` or the empty slash root), without a trailing slash. */
export function foldersUp(dir: string): string[] {
  const folders = [dir]
  for (let at = dir.lastIndexOf('/'); at >= 0; at = at === 0 ? -1 : dir.lastIndexOf('/', at - 1)) folders.push(dir.slice(0, at))
  return folders
}

/** The file's text, null when nothing is there, or the read's failure as a problem. */
async function readIfThere(files: PlacesInput['files'], path: string): Promise<Found<string | null>> {
  try {
    return { ok: true, value: (await files.stamp(path)) === null ? null : await files.read(path) }
  } catch (error) {
    return { ok: false, problem: `${path} cannot be read (${error instanceof Error ? error.message : String(error)})` }
  }
}

/** The parsed JSON, or undefined when the text is not JSON. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** What to set when nothing names the register: the variables, the settings file, or a teamrig project. */
function nothingNamed(settingsPath: string | null, isHomeless: boolean): string {
  const variables = `${PANE_ENV.tasksDir}, ${PANE_ENV.inboxDir} and ${PANE_ENV.usageDir}`
  const file = settingsPath === null ? `a settings file named by ${PANE_ENV.settings}` : settingsPath
  const team = isHomeless ? `set ${TEAMRIG_ENV.home} for teamrig's register` : `start the session in a teamrig team's project (${TEAM_POINTER})`
  return `no register found: set ${variables}, write them in ${file}, or ${team}`
}
