// One run of `teamrig read` for the documents a poll needs (T4742). Starting the CLI costs far more than a file stamp
// (about half a second here, before any work), so a poll asks for all its documents in one run and hands back the
// revision it holds of each: teamrig answers `unchanged` for those without building them. The run's answer is all or
// nothing where the pane could be misled: a failed run, or one whose output the engine cut (teamrig-cli.ts CliRun), is
// a failure with its reason, never documents read from part of it. Past that each document stands alone: one that is
// missing or cannot be read is named as a problem and the others are served, so the pane keeps what it last drew of
// the missing one. Runs the CLI only; no model calls.
import { messageOf } from './errors'
import { readAnswer, type DocumentName, type ReadDocument } from './read-document'
import { cliArgv, failureLines, type CliRun, type TeamrigCli } from './teamrig-cli'

/** A read takes no lock: far under this, unless the machine is swamped. */
export const READ_TIMEOUT_MS = 30_000

/** A document to read, and the revision the caller still holds of it (null: none, so it is read whole). */
export type ReadAsk = { readonly name: DocumentName; readonly held: string | null }

export type ReadPorts = {
  /** Runs `argv`, the teamrig CLI and its words (teamrig-cli.ts cliArgv); rejects when it cannot start or outlasts `timeoutMs`. */
  run: (argv: readonly string[], timeoutMs: number) => Promise<CliRun>
  /** The session the CLI runs as (its `--session`); null when the tab knows none, and the CLI asks its own variable. */
  caller: () => Promise<string | null>
}

/** What a read answered: the documents it could read with what it could not, as lines to show; or why it read none. */
export type ReadResult =
  | { readonly kind: 'read'; readonly documents: ReadonlyMap<DocumentName, ReadDocument>; readonly problems: readonly string[] }
  | { readonly kind: 'failed'; readonly reason: string }

const NOTHING_READ: ReadResult = { kind: 'read', documents: new Map(), problems: [] }

/**
 * The CLI's words for one read of `asks`, as `caller` when the tab knows one. The revisions held go in one `--unless`,
 * a comma list: teamrig's parser refuses a flag given twice.
 */
export function readWords(asks: readonly ReadAsk[], caller: string | null): string[] {
  const words = ['read', ...asks.map(ask => ask.name), '--json']
  const held = asks.flatMap(ask => (ask.held === null ? [] : [`${ask.name}=${ask.held}`]))
  if (held.length > 0) words.push('--unless', held.join(','))
  return caller === null ? words : [...words, '--session', caller]
}

/** What `run` answered to `asks`. */
export function readResult(run: CliRun, asks: readonly ReadAsk[]): ReadResult {
  if (run.exitCode !== 0) return { kind: 'failed', reason: failureLines(run, 'read').join(' ') }
  if (run.isStdoutTruncated) return { kind: 'failed', reason: 'teamrig read printed more than the pane can take in one run' }
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
    return { kind: 'failed', reason: problems.length > 0 ? problems.join('; ') : 'teamrig read printed no document the pane can read: update teamrig' }
  }
  for (const ask of asks) {
    if (!documents.has(ask.name) && !told.has(ask.name)) problems.push(`teamrig read printed no ${ask.name} document`)
  }
  return { kind: 'read', documents, problems }
}

/** Reads `asks` in one run of `cli`; with none to read it runs nothing. A run that cannot finish is a failure, never a throw. */
export async function readDocuments(cli: TeamrigCli, ports: ReadPorts, asks: readonly ReadAsk[]): Promise<ReadResult> {
  if (asks.length === 0) return NOTHING_READ
  if (cli.kind === 'missing') return { kind: 'failed', reason: cli.problem }
  try {
    const words = readWords(asks, await ports.caller())
    return readResult(await ports.run(cliArgv(cli.main, words), READ_TIMEOUT_MS), asks)
  } catch (error) {
    return { kind: 'failed', reason: `teamrig read did not finish: ${messageOf(error)}` }
  }
}
