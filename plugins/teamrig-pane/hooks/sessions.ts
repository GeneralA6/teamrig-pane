// The session a `/teamrig-pane <session>` argument names, found as teamrig's own commands find one: by its id, its
// current name, or a former name whose session is still on the team (teamrig's Roster over the team's config and
// rename log). Both files are read again at each command, so a session added or renamed since the pane started counts.
// With no team, or a team with no config file, the word is taken as the id itself.
import { USAGE } from './command'
import { parseConfigText, readRenames, Roster, SESSION_NAME } from './core/read/index'
import { issueText, type TeamFiles } from './places'
import type { Files } from './source'

/** The team a word is looked up in: the files port and where its files are. */
export type TeamLookup = { files: Pick<Files, 'stamp' | 'read'>; paths: TeamFiles }

/** The session's id, or the answer the command gives instead: why no session was pinned. */
export type SessionFound = { ok: true; id: string } | { ok: false; problem: string }

type Text = { ok: true; text: string | null } | { ok: false; problem: string }

export async function findSession(word: string, team: TeamLookup | null): Promise<SessionFound> {
  if (team === null) return asId(word)
  const config = await readIfThere(team.files, team.paths.config)
  if (!config.ok) return { ok: false, problem: `Not pinned: ${config.problem}` }
  if (config.text === null) return asId(word)
  const read = parseConfigText(config.text)
  if (read.status === 'unreadable') return { ok: false, problem: `Not pinned: ${team.paths.config}: ${issueText(read.issue)}` }
  const log = await readIfThere(team.files, team.paths.renames)
  if (!log.ok) return { ok: false, problem: `Not pinned: ${log.problem}` }
  const renames = log.text === null ? [] : readRenames(log.text).renames
  const found = new Roster(read.config, team.paths.team, renames).lookup(word)
  return found.ok ? { ok: true, id: found.id } : { ok: false, problem: `Not pinned (team ${team.paths.team}): ${found.error}.` }
}

/** The word as the id itself, when it can be one. */
function asId(word: string): SessionFound {
  return SESSION_NAME.test(word) ? { ok: true, id: word } : { ok: false, problem: `Not pinned: "${word}" is not a session id. ${USAGE}` }
}

/** The file's text, null when nothing is there, or the read's failure naming the file. */
async function readIfThere(files: TeamLookup['files'], path: string): Promise<Text> {
  try {
    return { ok: true, text: (await files.stamp(path)) === null ? null : await files.read(path) }
  } catch (error) {
    return { ok: false, problem: `${path} cannot be read (${error instanceof Error ? error.message : String(error)})` }
  }
}
