// The teamrig CLI the pane runs (hooks/teamrig-cli.ts): Claude Code's plugin list under CLAUDE_CONFIG_DIR, else under
// the home's .claude; the first teamrig install whose dist/cli/main.js is there; why none is, as one line.
import { describe, expect, test } from 'claude-code/testing'
import { cliArgv, findTeamrigCli, pluginListPath, teamrigInstalls, type CliFiles } from '../hooks/teamrig-cli'

const HOME = 'D:\\profile'
const LIST = 'D:/profile/.claude/plugins/installed_plugins.json'
const OLD = 'D:\\profile\\.claude\\plugins\\cache\\teamrig\\teamrig\\0.1.0'
const NEW = 'D:\\profile\\.claude\\plugins\\cache\\teamrig\\teamrig\\0.2.0'
const NEW_MAIN = 'D:/profile/.claude/plugins/cache/teamrig/teamrig/0.2.0/dist/cli/main.js'

/** Files by path; `failing` paths reject a read and an exists. */
function filesOf(paths: Record<string, string>, failing: readonly string[] = []): CliFiles & { asked: string[] } {
  const asked: string[] = []
  const check = (path: string): void => {
    asked.push(path)
    if (failing.includes(path)) throw new Error(`EBUSY: ${path}`)
  }
  return {
    asked,
    exists: async path => {
      check(path)
      return path in paths
    },
    read: async path => {
      check(path)
      const text = paths[path]
      if (text === undefined) throw new Error(`ENOENT: ${path}`)
      return text
    },
  }
}

function listOf(plugins: Record<string, unknown>): string {
  return JSON.stringify({ version: 2, plugins })
}

describe('pluginListPath', () => {
  test('CLAUDE_CONFIG_DIR wins over the home; slashes are made forward and a blank one is no folder', () => {
    expect(pluginListPath({ configDir: 'D:\\claude\\', home: HOME })).toBe('D:/claude/plugins/installed_plugins.json')
    expect(pluginListPath({ configDir: '  ', home: HOME })).toBe(LIST)
    expect(pluginListPath({ configDir: undefined, home: HOME })).toBe(LIST)
    expect(pluginListPath({ configDir: undefined, home: ' ' })).toBe(null)
  })
})

describe('teamrigInstalls', () => {
  test("each teamrig@ install's folder in order, another plugin's skipped, slashes made forward", () => {
    const text = listOf({
      'teamrig-pane@teamrig-pane': [{ installPath: 'C:\\pane' }],
      'teamrig@teamrig': [{ scope: 'user', installPath: OLD }, { installPath: NEW }],
    })
    expect(teamrigInstalls(text)).toEqual(['D:/profile/.claude/plugins/cache/teamrig/teamrig/0.1.0', 'D:/profile/.claude/plugins/cache/teamrig/teamrig/0.2.0'])
  })

  test('a list it cannot read names none: torn JSON, no plugins object, installs that are no list, paths that are no text', () => {
    expect(teamrigInstalls('{"plugins": {')).toEqual([])
    expect(teamrigInstalls('[]')).toEqual([])
    expect(teamrigInstalls(JSON.stringify({ plugins: [] }))).toEqual([])
    expect(teamrigInstalls(listOf({ 'teamrig@teamrig': { installPath: NEW } }))).toEqual([])
    expect(teamrigInstalls(listOf({ 'teamrig@teamrig': [null, { installPath: 3 }, { installPath: ' ' }] }))).toEqual([])
  })
})

describe('findTeamrigCli', () => {
  const env = { configDir: undefined, home: HOME }

  test("the first install whose CLI is there: an old install's emptied folder is passed over", async () => {
    const files = filesOf({ [LIST]: listOf({ 'teamrig@teamrig': [{ installPath: OLD }, { installPath: NEW }] }), [NEW_MAIN]: '' })
    expect(await findTeamrigCli(files, env)).toEqual({ kind: 'found', main: NEW_MAIN })
  })

  test('no home, no plugin list, or no install with its CLI: each says why', async () => {
    expect(await findTeamrigCli(filesOf({}), { configDir: undefined, home: undefined })).toEqual({
      kind: 'missing',
      problem: 'no CLAUDE_CONFIG_DIR or home folder to find the teamrig plugin under',
    })
    expect(await findTeamrigCli(filesOf({}), env)).toEqual({ kind: 'missing', problem: `no plugin list at ${LIST}: install the teamrig plugin` })
    expect(await findTeamrigCli(filesOf({ [LIST]: listOf({ 'teamrig@teamrig': [{ installPath: OLD }] }) }), env)).toEqual({
      kind: 'missing',
      problem: `no teamrig plugin with its CLI in ${LIST}: install the teamrig plugin`,
    })
  })

  test('a list or install it cannot read is a problem, never a throw', async () => {
    expect(await findTeamrigCli(filesOf({ [LIST]: '' }, [LIST]), env)).toEqual({ kind: 'missing', problem: `cannot find the teamrig plugin: EBUSY: ${LIST}` })
    const files = filesOf({ [LIST]: listOf({ 'teamrig@teamrig': [{ installPath: NEW }] }) }, [NEW_MAIN])
    expect(await findTeamrigCli(files, env)).toEqual({ kind: 'missing', problem: `cannot find the teamrig plugin: EBUSY: ${NEW_MAIN}` })
  })
})

describe('cliArgv', () => {
  test('runs the CLI with node', () => {
    expect(cliArgv(NEW_MAIN, ['meeting', 'list', '--json'])).toEqual(['node', NEW_MAIN, 'meeting', 'list', '--json'])
  })
})
