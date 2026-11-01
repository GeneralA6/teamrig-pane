// The files a task's ref names, for a card's Reference row (card.ts) to open each as a page (file-page.ts). A part of
// a ref names a file with a word that has a folder and a file name with an extension (`notes/api/t26-findings.md`,
// `~/x/hook.cjs`, `C:\w\y.ts`), or a line after its name (`board.md:6`, `board/po:6`); the marks around it stay words:
// a `#section` anchor, a comma or a bracket. A web address is never a file, nor a bare name (`Node.js`), nor a time
// (`10:30`). A file is looked for where the card's quotes are (details.ts candidatePaths), and read whole: one over
// MAX_PAGE_BYTES, or not text, is named with why it is not shown.
import type { RefFile, RefFileRead } from '../types'
import { candidatePaths, lineRef, type RefPlaces } from './details'
import { messageOf } from './errors'
import type { Files } from './source'

/** The most of a file its page reads: a brief or a design note is far under it, and $.state keeps what was read. */
export const MAX_PAGE_BYTES = 256 * 1024
/** A file name's extension: a letter, then up to 7 letters or digits (`.md`, `.tsx`, `.json`; not the `.2` of `v1.2`). */
const EXTENSION = /\.[A-Za-z][A-Za-z0-9]{0,7}$/
/** Marks before a path that are not part of it: `(notes/x.md)`, `"x/y.md"`. */
const LEADING = /^[("'[`]+/
/** Marks after a path that are not part of it: `x/y.md,`, `x/y.md).` */
const TRAILING = /[,;.:)"'\]`]+$/

/** A ref part's words: runs of words, and the files among them. */
export type RefSegment = { kind: 'words'; text: string } | { kind: 'file'; file: RefFile }

/** A word that names a file: the marks before it, the file, and what follows it (an anchor, marks). */
type FileWord = { before: string; file: RefFile; after: string }

/** A word as a file, or null when it names none. */
function fileWord(word: string): FileWord | null {
  if (word.includes('://')) return null
  const before = LEADING.exec(word)?.[0] ?? ''
  const rest = word.slice(before.length)
  const anchorAt = rest.indexOf('#')
  const named = anchorAt < 0 ? rest : rest.slice(0, anchorAt)
  const marks = TRAILING.exec(named)?.[0] ?? ''
  const path = named.slice(0, named.length - marks.length)
  const after = `${marks}${anchorAt < 0 ? '' : rest.slice(anchorAt)}`
  const atLine = lineRef(path)
  const file = atLine?.file ?? path
  const name = file.slice(Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\')) + 1)
  const hasFolder = name !== file && name !== ''
  const hasExtension = EXTENSION.test(name)
  const isFile = (hasFolder && hasExtension) || (atLine !== null && (hasFolder || hasExtension))
  return isFile ? { before, file: { file, line: atLine?.lines[0] ?? null }, after } : null
}

/** A ref part as runs of words and the files among them, in order; the words as written, spaces kept. */
export function refSegments(part: string): RefSegment[] {
  const segments: RefSegment[] = []
  const words = (text: string) => {
    if (text === '') return
    const last = segments[segments.length - 1]
    if (last?.kind === 'words') segments[segments.length - 1] = { kind: 'words', text: last.text + text }
    else segments.push({ kind: 'words', text })
  }
  for (const word of part.split(/(\s+)/)) {
    const found = fileWord(word)
    if (found === null) {
      words(word)
      continue
    }
    words(found.before)
    segments.push({ kind: 'file', file: found.file })
    words(found.after)
  }
  return segments
}

/** `bytes` in whole KiB, rounded up, so a file just over the cap never reads as at it. */
export function kib(bytes: number): number {
  return Math.ceil(bytes / 1024)
}

/** Reads a reference file for its page, from the first place that holds it. */
export class RefFileReader {
  private readonly files: Files
  private readonly places: RefPlaces

  constructor(files: Files, places: RefPlaces) {
    this.files = files
    this.places = places
  }

  /** The file a ref writes as `file`: its text, the paths looked at when none holds it, or why it is not shown. */
  async read(file: string): Promise<RefFileRead> {
    const tried = candidatePaths(file, this.places)
    for (const path of tried) {
      try {
        const stamp = await this.files.stamp(path)
        if (stamp === null) continue
        if (stamp.size > MAX_PAGE_BYTES) return { kind: 'unreadable', path, reason: `${kib(stamp.size)} KiB, over the ${kib(MAX_PAGE_BYTES)} KiB a page shows` }
        const text = await this.files.read(path)
        return text.includes('\u0000') ? { kind: 'unreadable', path, reason: 'not text' } : { kind: 'read', path, text }
      } catch (error) {
        return { kind: 'unreadable', path, reason: messageOf(error) }
      }
    }
    return { kind: 'missing', tried }
  }
}
