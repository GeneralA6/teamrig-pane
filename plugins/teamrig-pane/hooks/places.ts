// Where the register is, read once when the session starts; in a project teamrig is not set up for (no team, no
// folder named), read again at each poll until it is (setup.ts). Each folder comes from the first of: its
// TEAMRIG_PANE_* variable, the pane's settings file, then where teamrig keeps the register of the
// session's team (`<kit home>/teams/<team>/state`, or the team config's `paths.state` and
// `paths.inbox`, read by teamrig's own reader). The goals document comes from its variable or the
// settings file, else none. The team's config and rename log, read again by sessions.ts at each
// `/teamrig-pane <session>`, name its sessions. The team config also sets how long a task may stand untouched by its
// owner before it reads NOT PICKED UP, the team's zone (its `timeZone`, else the machine's, as teamrig resolves it)
// and how many hours teamrig keeps its turn log, the Log view's window.
import type { ProjectSetup, TeamSettings } from '../types'
import { DEFAULT_REGISTER, parseConfigText, TimeZone, type ConfigRead, type KitConfig } from './core/read/index'
import { slashed, type Files, type RegisterDirs } from './source'
import type { TurnLogPlace } from './turn-log'

/** The variables the pane reads. */
export const PANE_ENV = {
  tasksDir: 'TEAMRIG_PANE_TASKS_DIR',
  inboxDir: 'TEAMRIG_PANE_INBOX_DIR',
  goalsDoc: 'TEAMRIG_PANE_GOALS_DOC',
  /** The settings file, in place of `<kit home>/pane.json`. */
  settings: 'TEAMRIG_PANE_SETTINGS',
} as const

/** teamrig's own variables: its kit home folder and the team a session runs for. */
export const TEAMRIG_ENV = { home: 'TEAMRIG_HOME', team: 'TEAMRIG_TEAM' } as const

/** Every variable the pane's places come from. */
export type PlaceVariable = (typeof PANE_ENV)[keyof typeof PANE_ENV] | (typeof TEAMRIG_ENV)[keyof typeof TEAMRIG_ENV]

/**
 * The variables as the environment Claude Code runs in has them (the engine reads each by its literal name): one
 * that is not set is absent, or undefined as `$.env.get` answers it.
 */
export type PlacesEnv = Readonly<Partial<Record<PlaceVariable, string | undefined>>>

/** teamrig's pointer file: `{"team": "<id>"}` ties a project folder, and every folder below it, to a team. */
export const TEAM_POINTER = '.teamrig.json'

/** teamrig's rule for a team id, which becomes part of a path. */
const TEAM_ID = /^[a-z][a-z0-9-]{0,31}$/

/** What the settings file may set; every key is optional. */
const SETTING_KEYS = ['tasksDir', 'inboxDir', 'goalsDoc'] as const
type SettingKey = (typeof SETTING_KEYS)[number]
type Settings = Partial<Record<SettingKey, string>>
type DirKey = Exclude<SettingKey, 'goalsDoc'>

/**
 * The session's team and where teamrig keeps it: its folder (which holds the team's notes, read for a card's
 * reference files), the kit home's teams folder that holds it and its peers (the Team tab, team-source.ts), the files
 * that name its sessions, its config and its rename log, and its sessions' turn log (turn-log.ts): its folder and the
 * config's `turnLog.keepHours`, null with no config file, a team teamrig refuses and writes no turn log for; any file
 * may not be there.
 */
export type TeamFiles = { team: string; dir: string; teamsDir: string; config: string; renames: string; turnLog: TurnLogPlace | null }

/**
 * The register's folders, the session's team's files (null when no team was found) and its settings (teamSettings:
 * the team config's, else teamrig's defaults), or the problem the pane shows instead of tasks, the goals document
 * with either; or, with no team and no folder named, the project's setup.
 */
export type Places =
  | { kind: 'found'; dirs: RegisterDirs; team: TeamFiles | null; settings: TeamSettings; goalsDoc: string | null }
  | { kind: 'problem'; problem: string; goalsDoc: string | null }
  | { kind: 'unset'; setup: ProjectSetup }

export type PlacesInput = {
  env: PlacesEnv
  files: Pick<Files, 'stamp' | 'read'>
  /** The names of the folders right under a folder; none when it is not there. It rejects when it cannot list one. */
  folders: (path: string) => Promise<string[]>
  /** The person's home folder (USERPROFILE or HOME), for `~/` and the default kit home. */
  home: string | null
  /** The session's folder, where the walk for teamrig's pointer file starts. */
  cwd: string | null
  /** The machine's IANA zone as teamrig reads it (zone.ts machineZoneOf): the team's when its config sets none. */
  machineZone: string
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
  if (!settings.ok) return { kind: 'problem', problem: settings.problem, goalsDoc }
  const chosen = (key: DirKey): string | undefined => fromEnv[key] ?? settings.value[key]
  const tasksDir = chosen('tasksDir')
  const inboxDir = chosen('inboxDir')
  const team = await teamFolders(input, variable, kit, settingsPath)
  // Both folders named: the team is looked for only for its files and its settings, so a team that cannot be found
  // or read leaves no files and teamrig's defaults instead of a problem.
  if (tasksDir !== undefined && inboxDir !== undefined) {
    const teamFound = team.ok ? team.value : null
    return {
      kind: 'found',
      dirs: { tasksDir, inboxDir },
      team: teamFound === null ? null : teamFound.files,
      settings: teamFound === null ? teamSettings(null, input.machineZone) : teamFound.settings,
      goalsDoc,
    }
  }
  if (!team.ok) return { kind: 'problem', problem: team.problem, goalsDoc }
  if (team.value === null) {
    // No team and no folder named is a project teamrig is not set up for; one folder named, or no session folder to
    // write a pointer in, is a setup left half done.
    if (tasksDir !== undefined || inboxDir !== undefined || input.cwd === null || kit === null || settingsPath === null) {
      return { kind: 'problem', problem: nothingNamed(settingsPath, kit === null), goalsDoc }
    }
    return { kind: 'unset', setup: { project: slashed(input.cwd), teams: await kitTeams(input.folders, `${kit}/teams`) } }
  }
  return {
    kind: 'found',
    dirs: { tasksDir: tasksDir ?? team.value.state, inboxDir: inboxDir ?? team.value.inbox },
    team: team.value.files,
    settings: team.value.settings,
    goalsDoc,
  }
}

/**
 * What a team config (null: none read) sets for the pane, as teamrig reads it: the `register.check` NOT PICKED UP
 * hours, else teamrig's default; the zone named by `timeZone`, else the machine's, else UTC (TimeZone.resolve).
 */
export function teamSettings(config: KitConfig | null, machineZone: string): TeamSettings {
  return {
    notPickedUpAfterHours: (config?.register ?? DEFAULT_REGISTER).check.notPickedUpAfterHours,
    timeZone: TimeZone.resolve(config?.timeZone, machineZone).name,
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

/**
 * What a team's config sets for the pane: the team's state and inbox folders, the files naming its sessions, and its
 * settings (teamSettings).
 */
type TeamFolders = { state: string; inbox: string; files: TeamFiles; settings: TeamSettings }

/** Why teamrig cannot read a config: where in it, then what. */
type ConfigIssue = Extract<ConfigRead, { status: 'unreadable' }>['issue']

/**
 * The team's state and inbox folders as teamrig lays them out, and its settings, null when the session has no team,
 * or why they cannot be found. A team with no config file keeps the folders under its home and teamrig's defaults,
 * as teamrig reads it.
 */
async function teamFolders(
  input: PlacesInput,
  variable: (name: PlaceVariable) => string | undefined,
  kit: string | null,
  settingsPath: string | null,
): Promise<Found<TeamFolders | null>> {
  const team = await findTeam(input, variable)
  if (!team.ok) return team
  if (kit === null) return { ok: false, problem: nothingNamed(settingsPath, true) }
  if (team.value === null) return { ok: true, value: null }
  const teamsDir = `${kit}/teams`
  const teamHome = `${teamsDir}/${team.value}`
  const configPath = `${teamHome}/config.json`
  const config = await readIfThere(input.files, configPath)
  if (!config.ok) return config
  const read = config.value === null ? null : parseConfigText(config.value)
  if (read?.status === 'unreadable') return { ok: false, problem: `${configPath}: ${issueText(read.issue)}` }
  const state = teamStateDir(teamHome, read?.config ?? null)
  const turnLog = read === null ? null : { dir: `${state}/turn-log`, keepHours: read.config.turnLog.keepHours }
  return {
    ok: true,
    value: {
      state,
      inbox: inTeamHome(teamHome, read?.config.paths.inbox) ?? `${state}/inbox`,
      files: { team: team.value, dir: teamHome, teamsDir, config: configPath, renames: `${state}/renames.jsonl`, turnLog },
      settings: teamSettings(read?.config ?? null, input.machineZone),
    },
  }
}

/** A path a team config names, as teamrig takes it: an absolute one as written, else under the team's home. */
function inTeamHome(teamHome: string, path: string | undefined): string | undefined {
  if (path === undefined) return undefined
  const forward = slashed(path)
  return isAbsolute(forward) ? forward : `${teamHome}/${forward}`
}

/** The team's state folder: its config's `paths.state` (inTeamHome), else `state` in the team's home. */
export function teamStateDir(teamHome: string, config: KitConfig | null): string {
  return inTeamHome(teamHome, config?.paths.state) ?? `${teamHome}/state`
}

/** Why teamrig cannot read a config, as one line: where in it, then what. */
export function issueText(issue: ConfigIssue): string {
  return issue.path === '' ? issue.message : `${issue.path}: ${issue.message}`
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
    const team = isRecord(parsed) ? asString(parsed['team']) : undefined
    return team === undefined ? { ok: false, problem: `${path} has no "team" text; expected {"team": "<id>"}` } : checkTeam(team, path)
  }
  return { ok: true, value: null }
}

function checkTeam(team: string, from: string): Found<string> {
  return TEAM_ID.test(team)
    ? { ok: true, value: team }
    : { ok: false, problem: `${from}: "${team}" is not a team id (a lowercase letter, then lowercase letters, digits or -, at most 32)` }
}

/**
 * The teams in the kit home's teams folder, by id, sorted: its folders named as teamrig names a team. A folder that
 * cannot be listed lists none, as the list only offers a team to join and the rest of the setup still shows.
 */
async function kitTeams(folders: PlacesInput['folders'], teamsDir: string): Promise<string[]> {
  try {
    return teamIds(await folders(teamsDir))
  } catch {
    return []
  }
}

/** The folder names that name a team, as teamrig names one, sorted. */
export function teamIds(names: readonly string[]): string[] {
  return names.filter(name => TEAM_ID.test(name)).sort()
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
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
  const variables = `${PANE_ENV.tasksDir} and ${PANE_ENV.inboxDir}`
  const file = settingsPath === null ? `a settings file named by ${PANE_ENV.settings}` : settingsPath
  const team = isHomeless ? `set ${TEAMRIG_ENV.home} for teamrig's register` : `start the session in a teamrig team's project (${TEAM_POINTER})`
  return `no register found: set ${variables}, write them in ${file}, or ${team}`
}
