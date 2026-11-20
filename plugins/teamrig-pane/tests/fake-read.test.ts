// The fake teamrig the whole-pane specs read through (tests/fake-read.ts): that each document it prints from a
// register's files is one the pane's own readers take whole, saying what the pane's fold of those files says; whom
// it serves an inbox; what a held revision answers; and what it refuses, a run at a time (T4742).
import { describe, expect, test } from 'claude-code/testing'
import { configOf } from '../hooks/config-document'
import type { BodyRead } from '../hooks/document-fields'
import { inboxOf } from '../hooks/inbox-document'
import { findPlaces } from '../hooks/places'
import { readAnswer, type DocumentName, type ReadDocument } from '../hooks/read-document'
import { sessionsOf } from '../hooks/sessions-document'
import { registerPaths, TaskRegisterSource } from '../hooks/source'
import { tasksOf } from '../hooks/tasks-document'
import type { CliRun } from '../hooks/teamrig-cli'
import type { Snapshot } from '../types'
import { fakeRead, type FakeDisk } from './fake-read'
import { HOUR, INBOX_LINES, MemoryFiles, NO_TREE_GOALS, NOW, S1, S2, TEAM_SETTINGS, createLine, markLine, statusLine } from './fixtures'

const HOME = '/Homes/tester'
const TEAMS = `${HOME}/.teamrig/teams`
const STATE = `${TEAMS}/web/state`
const PATHS = registerPaths({ tasksDir: STATE, inboxDir: `${STATE}/inbox` })

const CONFIG = {
  team: { id: 'web' },
  sessions: ['lead', 'po', 'api', 'ui'],
  names: { api: 'backend' },
  roles: { lead: 'lead' },
  leads: { po: ['api'] },
}

const EVENTS = [
  createLine('T1', { at: NOW - 5 * HOUR, by: 'lead', owner: 'po', title: 'Plan the page', description: 'What it is for' }),
  statusLine('T1', 'po', NOW - 4 * HOUR, 'in-progress'),
  createLine('T2', { at: NOW - 3 * HOUR, by: 'po', owner: 'api', title: 'Add the route', source: 'po', ref: null }),
]

/** Team web's files: the session started in /work is po's (its `inbox read` mark names S1), three inbox lines read. */
function teamDisk(): { files: MemoryFiles; disk: FakeDisk } {
  const files = new MemoryFiles()
  files.write('/work/.teamrig.json', JSON.stringify({ team: 'web' }))
  files.write(`${TEAMS}/web/config.json`, JSON.stringify(CONFIG))
  files.write(PATHS.events, EVENTS.join('\n'))
  files.write(PATHS.marks, markLine('po', 3, S1, NOW - HOUR, INBOX_LINES[2] ?? null))
  files.write(`${PATHS.inboxDir}/po.md`, INBOX_LINES.join('\n'))
  return { files, disk: diskOf(files, '/work') }
}

function diskOf(files: MemoryFiles, cwd: string): FakeDisk {
  return { env: {}, files, folders: async path => (path === TEAMS ? ['web', 'ops'] : []), home: HOME, cwd, machineZone: 'UTC' }
}

/** The pane's own fold of the team's files, tied to `pinned`. */
async function foldOf(files: MemoryFiles, pinned: string | null): Promise<Snapshot> {
  const snapshot = await new TaskRegisterSource(files, PATHS, TEAM_SETTINGS, null, NO_TREE_GOALS).poll({ claudeSession: S1, pinned, now: NOW, force: true })
  if (snapshot === null) throw new Error('the fold read nothing')
  return snapshot
}

function documentOf(run: CliRun, name: DocumentName): ReadDocument {
  const answer = readAnswer(run.stdout)
  const document = answer.documents.find(one => one.name === name)
  if (document === undefined) throw new Error(`no ${name} document: exit ${run.exitCode} ${run.stderr} ${answer.unreadable.join('; ')}`)
  return document
}

/** What the pane's reader makes of the `name` document of `run`, with nothing left out of it. */
function readOf<T>(run: CliRun, name: DocumentName, reader: (document: ReadDocument) => BodyRead<T>): T {
  const read = reader(documentOf(run, name))
  if (read.kind !== 'read') throw new Error(read.reason)
  expect(read.problems).toEqual([])
  return read.value
}

function words(documents: string, ...flags: string[]): string[] {
  return ['read', ...documents.split(' '), '--json', ...flags]
}

describe('the fake teamrig read', () => {
  test('serves the tasks the fold holds, each as a row the tasks reader takes whole', async () => {
    const { files, disk } = teamDisk()
    const run = await fakeRead(disk, () => NOW)(words('tasks', '--conversation', S1))
    const rows = readOf(run, 'tasks', tasksOf)
    expect(rows).toEqual((await foldOf(files, null)).tasks.map(row => ({ ...row, descriptionCut: null })))
    expect(rows.map(row => [row.id, row.title, row.description, row.status, row.source, row.ref])).toEqual([
      ['T1', 'Plan the page', 'What it is for', 'in-progress', 'owner', 'docs/x.md'],
      ['T2', 'Add the route', null, 'open', 'po', null],
    ])
  })

  test('takes the whole argv of a run, the node and main words too', async () => {
    const { disk } = teamDisk()
    const run = await fakeRead(disk, () => NOW)(['node', 'K/teamrig/dist/cli/main.js', ...words('tasks')])
    expect(readOf(run, 'tasks', tasksOf).length).toBe(2)
  })

  test("serves the config's sessions under their names and leaders, and the conversation's own session", async () => {
    const { disk } = teamDisk()
    const read = readOf(await fakeRead(disk, () => NOW)(words('sessions', '--conversation', S1)), 'sessions', sessionsOf)
    expect(read.self).toEqual({ team: 'web', session: 'po' })
    expect(read.teams).toEqual([{ id: 'web', parent: null, active: 4, retired: 0 }])
    expect(read.failures).toEqual([])
    expect(read.sessions.map(row => [row.id, row.name, row.leader, row.ledBy, row.leads, row.roles])).toEqual([
      ['lead', 'web-lead', null, [], 2, ['lead']],
      ['po', 'web-po', 'lead', ['lead'], 1, []],
      ['api', 'backend', 'po', ['po', 'lead'], 0, []],
      ['ui', 'web-ui', 'lead', ['lead'], 0, []],
    ])
  })

  test('names no session of its own for a conversation no mark names, or for a run that names none', async () => {
    const { disk } = teamDisk()
    const teamrig = fakeRead(disk, () => NOW)
    expect(readOf(await teamrig(words('sessions', '--conversation', S2)), 'sessions', sessionsOf).self).toBe(null)
    expect(readOf(await teamrig(words('sessions')), 'sessions', sessionsOf).self).toBe(null)
  })

  test("serves the asked session's inbox as the fold windows it, by id or by name", async () => {
    const { files, disk } = teamDisk()
    files.write(`${PATHS.inboxDir}/api.md`, '- 2026-10-13 13:30 po: one for the backend')
    const teamrig = fakeRead(disk, () => NOW)
    const fold = await foldOf(files, 'po')
    const read = readOf(await teamrig(words('inbox', '--session', 'po', '--conversation', S1)), 'inbox', inboxOf)
    expect(read.session).toEqual({ id: 'po', name: 'web-po' })
    expect(read.unread).toBe(2)
    expect(read.unread).toBe(fold.unreadInbox)
    expect(read.items).toEqual(fold.inbox)
    const named = readOf(await teamrig(words('inbox', '--session', 'backend')), 'inbox', inboxOf)
    expect(named.session).toEqual({ id: 'api', name: 'backend' })
    expect(named.items.map(item => [item.from, item.text])).toEqual([['po', 'one for the backend']])
  })

  test('serves the settings the pane found in the team config', async () => {
    const { files, disk } = teamDisk()
    files.write(`${TEAMS}/web/config.json`, JSON.stringify({ ...CONFIG, timeZone: 'Asia/Jerusalem', register: { ownerSource: 'boss' } }))
    const places = await findPlaces(disk)
    if (places.kind !== 'found') throw new Error(`no team found: ${places.kind}`)
    const read = readOf(await fakeRead(disk, () => NOW)(words('config')), 'config', configOf)
    if (read.kind !== 'team') throw new Error(`no team served: ${read.kind}`)
    expect(read.team).toBe('web')
    // The document serves only the settings the pane draws with; the found focus also holds the rest of the config's.
    expect(places.settings).toMatchObject(read.settings)
    expect([places.settings.timeZone, places.settings.ownerSource]).toEqual(['Asia/Jerusalem', 'boss'])
  })

  test('prints a line per document asked, in the order asked', async () => {
    const { disk } = teamDisk()
    const run = await fakeRead(disk, () => NOW)(words('config sessions tasks inbox', '--session', 'po', '--conversation', S1))
    expect(run.exitCode).toBe(0)
    expect(readAnswer(run.stdout).documents.map(document => document.name)).toEqual(['config', 'sessions', 'tasks', 'inbox'])
  })

  test('answers unchanged for a document asked with the revision it is at, and the document once its files moved', async () => {
    const { files, disk } = teamDisk()
    const teamrig = fakeRead(disk, () => NOW)
    const first = await teamrig(words('tasks config'))
    const [tasks, config] = [documentOf(first, 'tasks').revision, documentOf(first, 'config').revision]
    const again = await teamrig(words('tasks config', '--unless', `tasks=${tasks},config=${config}`))
    expect(readAnswer(again.stdout).documents.map(document => [document.name, document.isUnchanged, document.revision])).toEqual([
      ['tasks', true, tasks],
      ['config', true, config],
    ])
    files.write(PATHS.events, [...EVENTS, statusLine('T2', 'api', NOW - HOUR, 'in-progress')].join('\n'))
    const moved = await teamrig(words('tasks config', '--unless', `tasks=${tasks},config=${config}`))
    expect(documentOf(moved, 'config').isUnchanged).toBe(true)
    expect(documentOf(moved, 'tasks').isUnchanged).toBe(false)
    expect(documentOf(moved, 'tasks').revision === tasks).toBe(false)
    expect(readOf(moved, 'tasks', tasksOf).map(row => row.status)).toEqual(['in-progress', 'in-progress'])
  })

  test('refuses the whole run for an inbox of a session the config does not hold, or of none', async () => {
    const { disk } = teamDisk()
    const teamrig = fakeRead(disk, () => NOW)
    const other = await teamrig(words('tasks inbox', '--session', 'qa'))
    expect([other.exitCode, other.stdout]).toEqual([2, ''])
    expect(other.stderr.startsWith('REFUSED ')).toBe(true)
    expect(await teamrig(words('tasks inbox'))).toEqual({ exitCode: 2, stdout: '', stderr: 'REFUSED inbox needs --session', isStdoutTruncated: false })
  })

  test('refuses a run that asks no document, or one it does not serve', async () => {
    const { disk } = teamDisk()
    const teamrig = fakeRead(disk, () => NOW)
    const refusal = { exitCode: 2, stdout: '', stderr: 'REFUSED read serves tasks, inbox, sessions, config', isStdoutTruncated: false }
    expect(await teamrig(words('tasks goals'))).toEqual(refusal)
    expect(await teamrig(['read', '--json'])).toEqual(refusal)
  })

  test("refuses every document of a team whose config is missing or cannot be read, and tells the pane's own problem", async () => {
    const { files, disk } = teamDisk()
    const teamrig = fakeRead(disk, () => NOW)
    files.remove(`${TEAMS}/web/config.json`)
    expect((await teamrig(words('config'))).stderr).toBe('REFUSED team web has no config')
    files.write(`${TEAMS}/web/config.json`, '{ no json')
    const places = await findPlaces(disk)
    if (places.kind !== 'problem') throw new Error(`a broken config is no problem: ${places.kind}`)
    expect((await teamrig(words('config'))).stderr).toBe(`REFUSED ${places.problem}`)
  })

  test('with no team serves the config document alone: the teams of the machine, and no setting', async () => {
    const files = new MemoryFiles()
    const disk = diskOf(files, '/elsewhere')
    const places = await findPlaces(disk)
    if (places.kind !== 'unset') throw new Error(`a team or a problem was found: ${places.kind}`)
    const teamrig = fakeRead(disk, () => NOW)
    expect(readOf(await teamrig(words('config')), 'config', configOf)).toEqual({ kind: 'no-team', teams: places.setup.teams, timeZone: 'UTC' })
    expect(places.setup.teams.length).toBe(2)
    expect(await teamrig(words('config tasks'))).toEqual({ exitCode: 2, stdout: '', stderr: 'REFUSED no team here: tasks needs one', isStdoutTruncated: false })
  })

  test('refuses the run with the problem the pane itself would show for a file it cannot read', async () => {
    const { files, disk } = teamDisk()
    files.failNextRead = 'EBUSY: the disk is locked'
    const run = await fakeRead(disk, () => NOW)(words('tasks'))
    expect([run.exitCode, run.stdout]).toEqual([2, ''])
    expect(run.stderr).toBe('REFUSED /work/.teamrig.json cannot be read (EBUSY: the disk is locked)')
  })
})
