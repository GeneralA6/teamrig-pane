// One run of `teamrig read` for the documents a poll needs (T4742). Starting the CLI costs far more than a file stamp
// (about half a second here, before any work), so a poll asks for all its documents in one run and hands back the
// revision it holds of each: teamrig answers `unchanged` for those without building them. The run's answer is all or
// nothing where the pane could be misled: a failed run, or one whose output the engine cut (teamrig-cli.ts CliRun), is
// a failure with its reason, never documents read from part of it. Past that each document stands alone: one that is
// missing or cannot be read is named as a problem and the others are served, so the pane keeps what it last drew of
// the missing one. A failure's reason may quote what the run wrote to stderr or how it broke: that is another
// program's text as much as a document is, so every reason leaves here as the pane may draw it (shown-text.ts).
// Runs the CLI only; no model calls.
import { messageOf } from './errors'
import { readAnswer, type DocumentName, type ReadDocument } from './read-document'
import { shownText } from './shown-text'
import { cliArgv, failureLines, type CliRun, type TeamrigCli } from './teamrig-cli'

/** A read takes no lock: far under this, unless the machine is swamped. */
export const READ_TIMEOUT_MS = 30_000

/** A document to read, and the revision the caller still holds of it (null: none, so it is read whole). */
export type ReadAsk = { readonly name: DocumentName; readonly held: string | null }

/**
 * Who a read asks as. `session` is the area the pane draws (the CLI's `--session`): named whenever it is known, so
 * the tab's own session variable never picks another inbox than the one drawn; with null the CLI finds the asker
 * itself, by that variable and then by the conversation. `conversation` is the host's id of the conversation the
 * pane runs in, which teamrig answers the `sessions` document's `self` by.
 */
export type ReadAsker = { readonly session: string | null; readonly conversation: string }

export type ReadPorts = {
  /** Runs `argv`, the teamrig CLI and its words (teamrig-cli.ts cliArgv); rejects when it cannot start or outlasts `timeoutMs`. */
  run: (argv: readonly string[], timeoutMs: number) => Promise<CliRun>
}

/** A conversation id teamrig's `--conversation` takes; it refuses the whole run for any other. */
const CONVERSATION = /^[A-Za-z0-9_.:-]{1,128}$/

/** What a read answered: the documents it could read with what it could not, as lines to show; or why it read none. */
export type ReadResult =
  | { readonly kind: 'read'; readonly documents: ReadonlyMap<DocumentName, ReadDocument>; readonly problems: readonly string[] }
  | { readonly kind: 'failed'; readonly reason: string }

const NOTHING_READ: ReadResult = { kind: 'read', documents: new Map(), problems: [] }

function failed(reason: string): ReadResult {
  return { kind: 'failed', reason: shownText(reason) }
}

/**
 * The CLI's words for one read of `asks` as `asker`. The revisions held go in one `--unless`, a comma list: teamrig's
 * parser refuses a flag given twice. A conversation id teamrig would refuse the run for is left out, so the documents
 * are still read, with no `self`.
 */
export function readWords(asks: readonly ReadAsk[], asker: ReadAsker): string[] {
  const words = ['read', ...asks.map(ask => ask.name), '--json']
  const held = asks.flatMap(ask => (ask.held === null ? [] : [`${ask.name}=${ask.held}`]))
  if (held.length > 0) words.push('--unless', held.join(','))
  if (asker.session !== null) words.push('--session', asker.session)
  if (CONVERSATION.test(asker.conversation)) words.push('--conversation', asker.conversation)
  return words
}

/** What `run` answered to `asks`. */
export function readResult(run: CliRun, asks: readonly ReadAsk[]): ReadResult {
  if (run.exitCode !== 0) return failed(failureLines(run, 'read').join(' '))
  if (run.isStdoutTruncated) return failed('teamrig read printed more than the pane can take in one run')
  const answer = readAnswer(run.stdout)
  const documents = new Map<DocumentName, ReadDocument>()
  const problems = [...answer.unreadable]
  const asked = new Map(asks.map(ask => [ask.name, ask]))
  /** The documents asked for whose problem is already told. */
  const told = new Set<DocumentName>()
  for (const document of answer.documents) {
    const ask = asked.get(document.name)
    if (ask === undefined) continue
    if (document.isUnchanged && ask.held === null) {
      // Unchanged from nothing held leaves nothing to draw: it is told as a problem, never taken as a document.
      problems.push(`teamrig read answered ${document.name} as unchanged to a read that held none of it`)
      told.add(document.name)
    } else {
      documents.set(document.name, document)
    }
  }
  if (documents.size === 0) {
    return failed(problems.length > 0 ? problems.join('; ') : 'teamrig read printed no document the pane can read: update teamrig')
  }
  for (const ask of asks) {
    if (!documents.has(ask.name) && !told.has(ask.name)) problems.push(`teamrig read printed no ${ask.name} document`)
  }
  return { kind: 'read', documents, problems }
}

/** Reads `asks` as `asker` in one run of `cli`; with none to read it runs nothing. A run that cannot finish is a failure, never a throw. */
export async function readDocuments(cli: TeamrigCli, ports: ReadPorts, asks: readonly ReadAsk[], asker: ReadAsker): Promise<ReadResult> {
  if (asks.length === 0) return NOTHING_READ
  if (cli.kind === 'missing') return failed(cli.problem)
  try {
    return readResult(await ports.run(cliArgv(cli.main, readWords(asks, asker)), READ_TIMEOUT_MS), asks)
  } catch (error) {
    return failed(`teamrig read did not finish: ${messageOf(error)}`)
  }
}
