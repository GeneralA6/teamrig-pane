// A teamrig that answers `read` from a register's files, for the specs that run the whole pane (pane.test.ts): the
// pane draws its tasks, inbox, sessions and settings from `teamrig read` alone (T4742), so a test that writes a
// register's files needs a teamrig that serves them. It finds the team as the pane does (hooks/places.ts), folds the
// register with the pane's own fold (hooks/source.ts) and prints each document as interface 1.0 serves it. Its
// `sessions` document is the tree of the kit home's team folders that holds the team (served-sessions.ts), each
// team's sessions from its config, rename log and hire log, the asking team's with their unread inbox lines. What it
// does not do as teamrig does: a session's row carries no state, ask, host or conversation, and a peer team's no
// unread count; the inbox is the day's lines and the unread ones, as the fold windows them; a team folder it cannot
// read fails the run instead of being named; a revision is the hash of the document's own text.
import { indexMarks, inboxLines, parseConfigText, readHiringLog, readMarks, readRenames, Roster, unreadOf, type KitConfig } from '../hooks/core/read/index'
import { lineHash } from '../hooks/line-hash'
import { findPlaces, teamIds, teamStateDir, type Places, type PlacesInput, type TeamFiles } from '../hooks/places'
import { DOCUMENT_NAMES, isDocumentName, type DocumentName, type JsonRecord } from '../hooks/read-document'
import { registerPaths, TaskRegisterSource, type Files, type RegisterDirs } from '../hooks/source'
import type { CliRun } from '../hooks/teamrig-cli'
import type { Snapshot, TaskRow, TeamSettings } from '../types'
import { NO_TREE_GOALS } from './fixtures'
import { askedOf, printed, refused, settingRows, type Asked } from './served-documents'
import { servedSessions, type TeamSessions } from './served-sessions'

/** Where the fake finds the register: what the pane's own search takes, over files the fold can read. */
export type FakeDisk = Omit<PlacesInput, 'files'> & { readonly files: Files }

/** One run of the fake: the words after `node <main>`, or the whole argv. */
export type FakeRead = (argv: readonly string[]) => Promise<CliRun>

/** Why a run serves nothing, as teamrig's `REFUSED` line tells it. */
class Refusal extends Error {}

type Team = { readonly files: TeamFiles; readonly dirs: RegisterDirs; readonly settings: TeamSettings; readonly config: KitConfig; readonly roster: Roster }

/** The team's config and names, read from its folder; a team whose config cannot be read serves nothing. */
async function teamOf(disk: FakeDisk, files: TeamFiles, dirs: RegisterDirs, settings: TeamSettings): Promise<Team> {
  if ((await disk.files.stamp(files.config)) === null) throw new Refusal(`team ${files.team} has no config`)
  const read = parseConfigText(await disk.files.read(files.config))
  if (read.status !== 'loaded') throw new Refusal(`team ${files.team}'s config cannot be read`)
  const renames = (await disk.files.stamp(files.renames)) === null ? [] : readRenames(await disk.files.read(files.renames)).renames
  return { files, dirs, settings, config: read.config, roster: new Roster(read.config, files.team, renames) }
}

/** The register as the pane's fold reads it now, for `conversation`, or tied to `pinned`. */
async function foldOf(disk: FakeDisk, team: Team, pinned: string | null, conversation: string | null, now: number): Promise<Snapshot> {
  const source = new TaskRegisterSource(disk.files, registerPaths(team.dirs), team.settings, team.files, NO_TREE_GOALS)
  const snapshot = await source.poll({ claudeSession: conversation ?? '', pinned, now, force: true })
  if (snapshot === null) throw new Refusal(`team ${team.files.team}'s register cannot be read`)
  return snapshot
}

/** The fake's one tracker, named as teamrig's GitHub connector names itself (teamrig's src/github/connector.ts). */
const GITHUB = { id: 'github', name: 'GitHub' }
/** A ref that connector knows as an issue: `gh:<owner>/<repo>#<number>`. */
const GITHUB_REF = /^gh:([\w.-]+\/[\w.-]+)#([1-9]\d*)$/

/** A ref as the `tasks` document serves it: its text, and the issue's connector, id, label and page when it names one. */
function servedRef(ref: string): JsonRecord {
  const [, repo, number] = GITHUB_REF.exec(ref) ?? []
  if (repo === undefined || number === undefined) return { text: ref, connector: null, id: null, label: null, url: null }
  const id = `${repo}#${number}`
  return { text: ref, connector: GITHUB, id, label: { text: id, source: 'outside' }, url: `https://github.com/${repo}/issues/${number}` }
}

/** A source as the `tasks` document serves it: the owner's marker first, then the tracker, any other a session's. */
function servedSource(source: string, team: Team): JsonRecord {
  if (source === team.settings.ownerSource) return { kind: 'owner', id: source, name: source }
  if (source === GITHUB.id) return { kind: 'connector', ...GITHUB }
  return { kind: 'session', id: source, name: team.roster.nameOf(source) ?? source }
}

/** A task as the `tasks` document serves it: the fold's row, its texts marked as the team's, its source and ref as data. */
function servedTask(row: TaskRow, team: Team): JsonRecord {
  const { descriptionCut: _notServed, item: _servedInRef, isImported: _servedInSource, title, description, source, ref, ...served } = row
  return {
    ...served,
    title: { text: title, source: 'team' },
    description: description === null ? null : { text: description, source: 'team' },
    source: servedSource(source, team),
    ref: ref === null ? null : servedRef(ref),
  }
}

/** A file's text; null when it is not there. */
async function textOf(files: Files, path: string): Promise<string | null> {
  return (await files.stamp(path)) === null ? null : await files.read(path)
}

/** The unread inbox lines of each of the team's sessions that ever marked its inbox read, by id, as teamrig counts them. */
async function unreadCounts(disk: FakeDisk, team: Team): Promise<ReadonlyMap<string, number>> {
  const paths = registerPaths(team.dirs)
  const marks = await textOf(disk.files, paths.marks)
  const { byArea } = indexMarks(marks === null ? [] : readMarks(marks).marks)
  const counts = new Map<string, number>()
  for (const id of team.config.sessions) {
    const mark = byArea.get(id)
    if (mark === undefined) continue
    const inbox = await textOf(disk.files, `${paths.inboxDir}/${id}.md`)
    counts.set(id, unreadOf(id, inbox === null ? [] : inboxLines(inbox), mark, lineHash).lines.length)
  }
  return counts
}

/**
 * Every team in the kit home's teams folder whose config teamrig takes, as its files say: its config and, in the
 * state folder that names, its rename and hire logs; the asking team's unread counts with it.
 */
async function machineTeams(disk: FakeDisk, own: Team): Promise<TeamSessions[]> {
  const { teamsDir } = own.files
  const teams: TeamSessions[] = []
  for (const id of teamIds(await disk.folders(teamsDir))) {
    const home = `${teamsDir}/${id}`
    const text = await textOf(disk.files, `${home}/config.json`)
    const read = text === null ? null : parseConfigText(text)
    if (read?.status !== 'loaded') continue
    const state = teamStateDir(home, read.config)
    const renames = await textOf(disk.files, `${state}/renames.jsonl`)
    const hires = await textOf(disk.files, `${state}/hires.jsonl`)
    teams.push({
      team: id,
      config: read.config,
      renames: renames === null ? [] : readRenames(renames).renames,
      hires: hires === null ? [] : readHiringLog(hires).records,
      unread: id === own.files.team ? await unreadCounts(disk, own) : null,
    })
  }
  return teams
}

/** Each config key the pane draws with, at the value the team's settings hold. */
function servedSettings(settings: TeamSettings): (readonly [string, unknown])[] {
  const { focus } = settings
  const { score, expedite } = focus
  return [
    ['register.ownerSource', settings.ownerSource],
    ['register.requireDecisionCard', settings.requireDecisionCard],
    ['register.check.notPickedUpAfterHours', settings.notPickedUpAfterHours],
    ['focus.defaultClass', focus.defaultClass],
    ['focus.roadmapClass', focus.roadmapClass],
    ['focus.maintenanceClass', focus.maintenanceClass],
    ['focus.parkAfterDays', focus.parkAfterDays],
    ['focus.score.rankValues', score.rankValues],
    ['focus.score.roadmapUnranked', score.roadmapUnranked],
    ['focus.score.maintenanceValue', score.maintenanceValue],
    ['focus.score.maintenanceBug', score.maintenanceBug],
    ['focus.score.maintenanceCritical', score.maintenanceCritical],
    ['focus.score.improvementsValue', score.improvementsValue],
    ['focus.score.overdueValue', score.overdueValue],
    ['focus.score.dueSoonValue', score.dueSoonValue],
    ['focus.score.dueSoonDays', score.dueSoonDays],
    ['focus.score.unblocksShare', score.unblocksShare],
    ['focus.score.ownerOrderValues', score.ownerOrderValues],
    ['focus.score.defaultSizePct', score.defaultSizePct],
    ['focus.score.minSizePct', score.minSizePct],
    ['focus.expedite.critical', expedite.critical],
    ['focus.expedite.ownerP1', expedite.ownerP1],
  ]
}

/** The session whose inbox is served: one the team has now, by id or by a name it has had; any other refuses the run. */
function inboxSession(team: Team, asker: string | null): string {
  if (asker === null) throw new Refusal('inbox needs --session')
  const found = team.roster.lookup(asker)
  if (!found.ok) throw new Refusal(found.error)
  return found.id
}

/** What one document of a team says, without its envelope. */
async function teamBody(name: DocumentName, disk: FakeDisk, team: Team, asked: Asked, now: number): Promise<JsonRecord> {
  switch (name) {
    case 'tasks': {
      const fold = await foldOf(disk, team, null, asked.conversation, now)
      return { tasks: fold.tasks.map(row => servedTask(row, team)) }
    }
    case 'sessions': {
      const area = asked.conversation === null ? null : (await foldOf(disk, team, null, asked.conversation, now)).area
      const self = area === null || !team.roster.ids.includes(area) ? null : { team: team.files.team, session: area }
      return servedSessions(await machineTeams(disk, team), team.files.team, self)
    }
    case 'inbox': {
      const id = inboxSession(team, asked.session)
      const fold = await foldOf(disk, team, id, asked.conversation, now)
      return {
        session: { id, name: team.roster.nameOf(id) ?? id },
        unread: fold.unreadInbox,
        lines: fold.inbox.map(line => ({ ...line, at: new Date(line.at).toISOString(), text: { text: line.text, source: 'team' } })),
      }
    }
    case 'config':
      return { team: team.files.team, teams: [], timeZone: team.settings.timeZone, settings: settingRows(servedSettings(team.settings)) }
  }
}

/** With no team only the `config` document is served: the machine's teams to join one of; any other refuses the run. */
function teamlessBody(name: DocumentName, places: Exclude<Places, { kind: 'problem' }>, machineZone: string): JsonRecord {
  if (name !== 'config') throw new Refusal(`no team here: ${name} needs one`)
  return { team: null, teams: places.kind === 'unset' ? places.setup.teams : [], timeZone: machineZone, settings: [] }
}

/** The revision each document was asked `--unless` it is at (`tasks=<revision>,inbox=<revision>`). */
function heldOf(unless: string | null): ReadonlyMap<string, string> {
  const held = new Map<string, string>()
  for (const entry of unless === null ? [] : unless.split(',')) {
    const [name, revision] = entry.split('=')
    if (name !== undefined && revision !== undefined) held.set(name, revision)
  }
  return held
}

/** The document as it is printed: `unchanged` alone when the asker holds its revision, else the body in its envelope. */
function enveloped(name: DocumentName, body: JsonRecord, held: string | undefined): JsonRecord {
  const revision = lineHash(JSON.stringify(body))
  if (held === revision) return { interface: '1.0', document: name, revision, unchanged: true }
  return { interface: '1.0', document: name, revision, problems: [], ...body, cuts: [] }
}

async function answer(disk: FakeDisk, asked: Asked, now: number): Promise<CliRun> {
  const names = asked.documents.filter(isDocumentName)
  if (names.length === 0 || names.length !== asked.documents.length) throw new Refusal(`read serves ${DOCUMENT_NAMES.join(', ')}`)
  const places = await findPlaces(disk)
  if (places.kind === 'problem') throw new Refusal(places.problem)
  const team = places.kind === 'found' && places.team !== null ? await teamOf(disk, places.team, places.dirs, places.settings) : null
  const held = heldOf(asked.unless)
  const documents: JsonRecord[] = []
  for (const name of names) {
    const body = team === null ? teamlessBody(name, places, disk.machineZone) : await teamBody(name, disk, team, asked, now)
    documents.push(enveloped(name, body, held.get(name)))
  }
  return printed(...documents)
}

/**
 * A teamrig answering `read <documents> --json [--unless ...] [--session ...] [--conversation ...]` from the files
 * of `disk` at `now()`: a line per document asked, or, as teamrig does, nothing but a `REFUSED` line when any of
 * them cannot be served.
 */
export function fakeRead(disk: FakeDisk, now: () => number): FakeRead {
  return async argv => {
    try {
      return await answer(disk, askedOf(argv), now())
    } catch (error) {
      if (error instanceof Refusal) return refused(error.message)
      throw error
    }
  }
}
