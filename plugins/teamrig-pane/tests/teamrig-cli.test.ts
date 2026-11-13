// The teamrig CLI the pane runs (hooks/teamrig-cli.ts): Claude Code's plugin list under CLAUDE_CONFIG_DIR, else under
// the home's .claude; the first teamrig install whose dist/cli/main.js is there; else the one beside the teamrig command
// on the PATH (issue #119); why neither is, as one line.
import { describe, expect, test } from 'claude-code/testing'
import { cliArgv, findTeamrigCli, pathFolders, pluginListPath, teamrigInstalls, type CliFiles } from '../hooks/teamrig-cli'

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
    expect(pluginListPath({ configDir: 'D:\\claude\\', home: HOME, path: undefined })).toBe('D:/claude/plugins/installed_plugins.json')
    expect(pluginListPath({ configDir: '  ', home: HOME, path: undefined })).toBe(LIST)
    expect(pluginListPath({ configDir: undefined, home: HOME, path: undefined })).toBe(LIST)
    expect(pluginListPath({ configDir: undefined, home: ' ', path: undefined })).toBe(null)
  })
})

describe('pathFolders', () => {
  test('a Windows PATH splits on ; and keeps its drive letters; quotes, blanks and trailing slashes go', () => {
    expect(pathFolders('C:\\Windows;;"D:\\tools\\teamrig\\bin\\" ; E:\\x')).toEqual(['C:/Windows', 'D:/tools/teamrig/bin', 'E:/x'])
  })

  test('a one-folder Windows PATH is not split at its drive colon', () => {
    expect(pathFolders('D:\\tools\\bin')).toEqual(['D:/tools/bin'])
  })

  test('a Linux or macOS PATH splits on :', () => {
    expect(pathFolders('/usr/local/bin::/opt/teamrig/bin/')).toEqual(['/usr/local/bin', '/opt/teamrig/bin'])
  })

  test('no PATH, or a blank one, has no folders', () => {
    expect(pathFolders(undefined)).toEqual([])
    expect(pathFolders('  ')).toEqual([])
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
  const env = { configDir: undefined, home: HOME, path: undefined }
  const NOT_ON_PATH = 'no PATH to find the teamrig command on: install the teamrig plugin'
  // A plugin folder run with --plugin-dir: its bin on the PATH, its main.js beside it, no plugin list naming it.
  const DEV_BIN = 'D:\\src\\teamrig\\plugins\\teamrig\\bin'
  const DEV_MAIN = 'D:/src/teamrig/plugins/teamrig/dist/cli/main.js'
  const SYSTEM = 'D:\\windows'
  const onPath = { ...env, path: `${SYSTEM};${DEV_BIN}` }

  test("the first install whose CLI is there: an old install's emptied folder is passed over", async () => {
    const files = filesOf({ [LIST]: listOf({ 'teamrig@teamrig': [{ installPath: OLD }, { installPath: NEW }] }), [NEW_MAIN]: '' })
    expect(await findTeamrigCli(files, env)).toEqual({ kind: 'found', main: NEW_MAIN })
  })

  test('no home, no plugin list, or no install with its CLI, and no PATH: each says why', async () => {
    expect(await findTeamrigCli(filesOf({}), { configDir: undefined, home: undefined, path: undefined })).toEqual({
      kind: 'missing',
      problem: `no CLAUDE_CONFIG_DIR or home folder to find the teamrig plugin under, and ${NOT_ON_PATH}`,
    })
    expect(await findTeamrigCli(filesOf({}), env)).toEqual({ kind: 'missing', problem: `no plugin list at ${LIST}, and ${NOT_ON_PATH}` })
    expect(await findTeamrigCli(filesOf({ [LIST]: listOf({ 'teamrig@teamrig': [{ installPath: OLD }] }) }), env)).toEqual({
      kind: 'missing',
      problem: `no teamrig plugin with its CLI in ${LIST}, and ${NOT_ON_PATH}`,
    })
  })

  test('a list or install it cannot read is a problem, never a throw', async () => {
    expect(await findTeamrigCli(filesOf({ [LIST]: '' }, [LIST]), env)).toEqual({
      kind: 'missing',
      problem: `cannot find the teamrig plugin: EBUSY: ${LIST}, and ${NOT_ON_PATH}`,
    })
    const files = filesOf({ [LIST]: listOf({ 'teamrig@teamrig': [{ installPath: NEW }] }) }, [NEW_MAIN])
    expect(await findTeamrigCli(files, env)).toEqual({
      kind: 'missing',
      problem: `cannot find the teamrig plugin: EBUSY: ${NEW_MAIN}, and ${NOT_ON_PATH}`,
    })
  })

  test('with no plugin list, the main.js beside the teamrig command on the PATH (issue #119)', async () => {
    const files = filesOf({ 'D:/src/teamrig/plugins/teamrig/bin/teamrig': '', [DEV_MAIN]: '' })
    expect(await findTeamrigCli(files, onPath)).toEqual({ kind: 'found', main: DEV_MAIN })
  })

  test('the Windows teamrig.cmd alone is the command too', async () => {
    const files = filesOf({ 'D:/src/teamrig/plugins/teamrig/bin/teamrig.cmd': '', [DEV_MAIN]: '' })
    expect(await findTeamrigCli(files, onPath)).toEqual({ kind: 'found', main: DEV_MAIN })
  })

  test('a Linux or macOS PATH is read too', async () => {
    const files = filesOf({ '/opt/teamrig/bin/teamrig': '', '/opt/teamrig/dist/cli/main.js': '' })
    expect(await findTeamrigCli(files, { ...env, path: '/usr/bin:/opt/teamrig/bin' })).toEqual({ kind: 'found', main: '/opt/teamrig/dist/cli/main.js' })
  })

  test("the plugin list's install wins over the PATH's", async () => {
    const files = filesOf({
      [LIST]: listOf({ 'teamrig@teamrig': [{ installPath: NEW }] }),
      [NEW_MAIN]: '',
      'D:/src/teamrig/plugins/teamrig/bin/teamrig': '',
      [DEV_MAIN]: '',
    })
    expect(await findTeamrigCli(files, onPath)).toEqual({ kind: 'found', main: NEW_MAIN })
  })

  test('a list it cannot read still falls to the PATH', async () => {
    const files = filesOf({ [LIST]: '', 'D:/src/teamrig/plugins/teamrig/bin/teamrig': '', [DEV_MAIN]: '' }, [LIST])
    expect(await findTeamrigCli(files, onPath)).toEqual({ kind: 'found', main: DEV_MAIN })
  })

  test('a shim with no dist beside it (a link or an npm shim) is passed over for a later folder', async () => {
    const files = filesOf({
      'D:/windows/teamrig.cmd': '',
      'D:/src/teamrig/plugins/teamrig/bin/teamrig': '',
      [DEV_MAIN]: '',
    })
    expect(await findTeamrigCli(files, onPath)).toEqual({ kind: 'found', main: DEV_MAIN })
    expect(await findTeamrigCli(filesOf({ 'D:/windows/teamrig.cmd': '' }), onPath)).toEqual({
      kind: 'missing',
      problem: `no plugin list at ${LIST}, and no teamrig command on the PATH with its dist/cli/main.js beside it: install the teamrig plugin`,
    })
  })

  test('a PATH folder it cannot check is passed over, and named when nothing is found', async () => {
    const found = filesOf({ 'D:/src/teamrig/plugins/teamrig/bin/teamrig': '', [DEV_MAIN]: '' }, ['D:/windows/teamrig'])
    expect(await findTeamrigCli(found, onPath)).toEqual({ kind: 'found', main: DEV_MAIN })
    expect(await findTeamrigCli(filesOf({}, ['D:/windows/teamrig']), onPath)).toEqual({
      kind: 'missing',
      problem: `no plugin list at ${LIST}, and cannot look on the PATH: EBUSY: D:/windows/teamrig: install the teamrig plugin`,
    })
  })
})

describe('cliArgv', () => {
  test('runs the CLI with node', () => {
    expect(cliArgv(NEW_MAIN, ['meeting', 'list', '--json'])).toEqual(['node', NEW_MAIN, 'meeting', 'list', '--json'])
  })
})
