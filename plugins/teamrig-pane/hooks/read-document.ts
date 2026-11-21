// The envelope of a document `teamrig read` prints (T4742): the part every document shares, read before any of its own
// fields. teamrig's public interface has its own version, apart from the plugin's, and each document carries it as
// `interface`, the text `<major>.<minor>`. A minor adds documents and fields, which a reader passes over: a document
// or a field this file does not name is never a problem. A major changes meaning, so a document of another major is
// not read at all, and the pane says which side to update. `revision` is teamrig's opaque mark of what a document was
// built from: handed back on the next read, teamrig answers `unchanged` in the document's place and the pane keeps
// what it drew. One run prints a document per line, so one that cannot be read never takes the others with it. A
// document's `problems` are lines the pane shows, so they leave here as it may draw them (shown-text.ts).
// Parses text only; runs nothing.
import { shownText } from './shown-text'
import { linesOf } from './teamrig-cli'

export type JsonRecord = Readonly<Record<string, unknown>>

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isText(value: unknown): value is string {
  return typeof value === 'string'
}

/** The lines `problems` holds, each as the pane may draw it; an entry that is no text is passed over. */
function problemLines(problems: unknown): string[] {
  return Array.isArray(problems) ? problems.filter(isText).map(shownText) : []
}

/** The documents the pane asks for, by the name `teamrig read` takes and prints. */
export const DOCUMENT_NAMES = ['tasks', 'inbox', 'sessions', 'config'] as const
export type DocumentName = (typeof DOCUMENT_NAMES)[number]

export function isDocumentName(value: unknown): value is DocumentName {
  return DOCUMENT_NAMES.some(name => name === value)
}

/** The interface major whose documents the pane reads, at any minor. */
export const SERVED_MAJOR = 1

export type InterfaceVersion = { readonly major: number; readonly minor: number }

const VERSION = /^\d{1,9}\.\d{1,9}$/

/** The interface version `value` names, as `<major>.<minor>`; null for anything else. */
export function parseInterface(value: unknown): InterfaceVersion | null {
  if (typeof value !== 'string' || !VERSION.test(value)) return null
  const [major, minor] = value.split('.').map(Number)
  return major === undefined || minor === undefined ? null : { major, minor }
}

/** A document's envelope, with the object it came in. */
export type ReadDocument = {
  readonly name: DocumentName
  readonly interface: InterfaceVersion
  /** teamrig's mark of what the document was built from; null from a teamrig that prints none, read whole each time. */
  readonly revision: string | null
  /** True when teamrig answered that nothing changed since the revision asked with: `fields` then holds no document. */
  readonly isUnchanged: boolean
  /** What teamrig could not serve of this document, each a line to show. */
  readonly problems: readonly string[]
  /** The whole printed object: the document's own fields, read by that document's reader. */
  readonly fields: JsonRecord
}

/** One printed value read: a document, one the pane does not ask for (passed over), or why it cannot be read. */
export type DocumentRead =
  | { readonly kind: 'document'; readonly document: ReadDocument }
  | { readonly kind: 'passed-over' }
  | { readonly kind: 'unreadable'; readonly reason: string }

function unreadable(reason: string): DocumentRead {
  return { kind: 'unreadable', reason }
}

/** Why a document of another major is not read: the older side is the one to update. */
function otherMajor({ major, minor }: InterfaceVersion): string {
  const side = major > SERVED_MAJOR ? 'newer than the pane reads: update teamrig-pane' : 'older than the pane reads: update teamrig'
  return `teamrig printed interface ${major}.${minor}, ${side}`
}

/**
 * The document `value` is. The version is checked before the name: under another major even a known name may mean
 * something else.
 */
export function parseDocument(value: unknown): DocumentRead {
  if (!isRecord(value)) return unreadable('teamrig printed a line that is no document')
  const version = parseInterface(value['interface'])
  if (version === null) return unreadable('teamrig printed a document with no interface version')
  if (version.major !== SERVED_MAJOR) return unreadable(otherMajor(version))
  const { document: name, revision, unchanged, problems } = value
  if (typeof name !== 'string') return unreadable('teamrig printed a document with no name')
  if (!isDocumentName(name)) return { kind: 'passed-over' }
  return {
    kind: 'document',
    document: {
      name,
      interface: version,
      revision: typeof revision === 'string' ? revision : null,
      isUnchanged: unchanged === true,
      problems: problemLines(problems),
      fields: value,
    },
  }
}

/** What one run printed: its documents in the order printed, and why the other lines could not be read, each once. */
export type ReadAnswer = { readonly documents: readonly ReadDocument[]; readonly unreadable: readonly string[] }

function parsed(line: string): DocumentRead {
  try {
    const value: unknown = JSON.parse(line)
    return parseDocument(value)
  } catch {
    return unreadable('teamrig printed a line that is no JSON')
  }
}

/** The documents in `stdout`, one per line. */
export function readAnswer(stdout: string): ReadAnswer {
  const documents: ReadDocument[] = []
  const reasons = new Set<string>()
  for (const line of linesOf(stdout)) {
    const read = parsed(line)
    if (read.kind === 'document') documents.push(read.document)
    if (read.kind === 'unreadable') reasons.add(read.reason)
  }
  return { documents, unreadable: [...reasons] }
}
