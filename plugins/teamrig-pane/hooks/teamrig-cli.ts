// The teamrig CLI the pane runs (T1359): the installed teamrig plugin's `dist/cli/main.js`, found as teamrig's own
// status line finds it. Claude Code lists its installed plugins in `plugins/installed_plugins.json` under its config
// folder (CLAUDE_CONFIG_DIR, else ~/.claude): `{ plugins: { "teamrig@<marketplace>": [{ installPath, ... }] } }`. The
// first `teamrig@*` install whose main.js is there is the one run, with `node`, and a run's answer read as lines.
// Reads two files; runs nothing.
import { messageOf } from './errors'
import { slashed } from './source'

/** The plugin list's path under Claude Code's config folder, from that folder's root. */
const PLUGIN_LIST = 'plugins/installed_plugins.json'
/** The CLI's entry under a teamrig install. */
const CLI_MAIN = 'dist/cli/main.js'
const TEAMRIG_KEY = 'teamrig@'

/** The CLI found, or why there is none, as one line the pane shows. */
export type TeamrigCli = { readonly kind: 'found'; readonly main: string } | { readonly kind: 'missing'; readonly problem: string }

export type CliFiles = {
  exists: (path: string) => Promise<boolean>
  /** Rejects when the file cannot be read. */
  read: (path: string) => Promise<string>
}

/** Where to look: Claude Code's config folder variable and the user's home, as the session's environment holds them. */
export type CliEnv = { readonly configDir: string | undefined; readonly home: string | undefined }

type JsonRecord = Readonly<Record<string, unknown>>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Claude Code's plugin list: under CLAUDE_CONFIG_DIR when it is set, else under the home's `.claude`; null with neither. */
export function pluginListPath(env: CliEnv): string | null {
  const configDir = env.configDir?.trim()
  if (configDir !== undefined && configDir !== '') return `${slashed(configDir)}/${PLUGIN_LIST}`
  const home = env.home?.trim()
  return home === undefined || home === '' ? null : `${slashed(home)}/.claude/${PLUGIN_LIST}`
}

/** Each teamrig install's folder the plugin list names, in its order, slashes made forward; none in a list it cannot read. */
export function teamrigInstalls(text: string): string[] {
  let list: unknown
  try {
    list = JSON.parse(text)
  } catch {
    return []
  }
  const plugins = isRecord(list) ? list['plugins'] : undefined
  if (!isRecord(plugins)) return []
  const found: string[] = []
  for (const [key, installs] of Object.entries(plugins)) {
    if (!key.startsWith(TEAMRIG_KEY) || !Array.isArray(installs)) continue
    for (const install of installs) {
      const path = isRecord(install) ? install['installPath'] : undefined
      if (typeof path === 'string' && path.trim() !== '') found.push(slashed(path.trim()))
    }
  }
  return found
}

/** The first teamrig install whose CLI is there; else why none is. A failed read or check is a problem too, never a throw. */
export async function findTeamrigCli(files: CliFiles, env: CliEnv): Promise<TeamrigCli> {
  const listPath = pluginListPath(env)
  if (listPath === null) return { kind: 'missing', problem: 'no CLAUDE_CONFIG_DIR or home folder to find the teamrig plugin under' }
  try {
    if (!(await files.exists(listPath))) return { kind: 'missing', problem: `no plugin list at ${listPath}: install the teamrig plugin` }
    for (const install of teamrigInstalls(await files.read(listPath))) {
      const main = `${install}/${CLI_MAIN}`
      if (await files.exists(main)) return { kind: 'found', main }
    }
    return { kind: 'missing', problem: `no teamrig plugin with its CLI in ${listPath}: install the teamrig plugin` }
  } catch (error) {
    return { kind: 'missing', problem: `cannot find the teamrig plugin: ${messageOf(error)}` }
  }
}

/** The command line that runs the CLI with `args`. */
export function cliArgv(main: string, args: readonly string[]): string[] {
  return ['node', main, ...args]
}

/** What a CLI run answers: `$.process.run`'s result, the fields the pane reads. */
export type CliRun = { exitCode: number; stdout: string; stderr: string; isStdoutTruncated: boolean }

/** A run's non-empty lines of `text`, trimmed. */
export function linesOf(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line !== '')
}

/** Why a run of `teamrig <command>` failed: what it wrote to stderr, else its exit code. */
export function failureLines(run: CliRun, command: string): string[] {
  const said = linesOf(run.stderr)
  return said.length > 0 ? said : [`teamrig ${command} exited ${run.exitCode}`]
}
