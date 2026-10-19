// A reference file's page (nav.ts): a file a card's Reference row names (ref-file.ts), as it was read when the page
// opened. Its name and the path it was read at over its text, one block per paragraph, so the window draws only the
// paragraphs in sight (window.ts) and the gap between blocks stands for the blank lines; a run of over BLOCK_LINES
// lines with no blank line splits too, a gap at each split. Tabs draw as two spaces, and a wrapped line keeps its
// indent. The line its ref points at is bold, and the page lands on its paragraph (lineBlockKey). A file not found
// names each path looked at; one not shown says why. Pure: blocks that layout.ts wraps and register.tsx draws under
// the page's back, forward and trail.
import type { RefFile, RefFileRead } from '../types'
import { fileLabel } from './details'
import { single, type Block, type Row } from './rows'

/** The most lines a block of the page holds: a longer run with no blank line splits, so the window never lays out a whole file at once. */
export const BLOCK_LINES = 50
const KEY = 'file-page'
const NOTE = `${KEY}:note`
/** What a tab draws as. */
const TAB = '  '

/** A run of lines with no blank line, from line `first` (1 is the file's first). */
type Paragraph = { first: number; lines: string[] }

/** `text`'s paragraphs: its lines as drawn (tabs as TAB, no trailing spaces) between blank lines, none over BLOCK_LINES. */
function paragraphs(text: string): Paragraph[] {
  const found: Paragraph[] = []
  let open: Paragraph | null = null
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.replaceAll('\t', TAB).trimEnd()
    if (line === '') {
      open = null
      continue
    }
    if (open === null || open.lines.length === BLOCK_LINES) {
      open = { first: i + 1, lines: [] }
      found.push(open)
    }
    open.lines.push(line)
  }
  return found
}

function paragraphKey(paragraph: Paragraph): string {
  return `${KEY}:para:${paragraph.first}`
}

/** The page's head: the file's folder and name, bold, over where it was read (as the ref writes it when it was not) and the line its ref points at. */
function titleBlock(file: RefFile, path: string | null): Block {
  const where = [path ?? file.file, ...(file.line === null ? [] : [`line ${file.line}`])].join(' · ')
  return { key: KEY, rows: [{ key: KEY, spans: [{ text: fileLabel(file.file), bold: true }] }, { key: `${KEY}:path`, spans: [{ text: where, dim: true }] }] }
}

/** A paragraph's lines, line `line` bold, each wrapping under its own indent. */
function paragraphBlock(paragraph: Paragraph, line: number | null): Block {
  const rows = paragraph.lines.map((text, i): Row => {
    const at = paragraph.first + i
    const indent = text.slice(0, text.length - text.trimStart().length)
    return { key: `${KEY}:line:${at}`, spans: [{ text, ...(at === line ? { bold: true } : {}) }], hang: indent === '' ? undefined : { text: indent } }
  })
  return { key: paragraphKey(paragraph), rows }
}

/** The body of `file`'s page, `read` what was read for it when it opened (none when the pane lost it, as a reload of an older pane does). */
export function filePageBlocks(file: RefFile, read: RefFileRead | undefined): Block[] {
  if (read === undefined) return [titleBlock(file, null), single(NOTE, [{ text: "Not read: open it again from its task's card.", dim: true }])]
  switch (read.kind) {
    case 'missing': {
      if (read.tried.length === 0) return [titleBlock(file, null), single(NOTE, [{ text: 'Not found: the pane knows no folder to look in.' }])]
      const tried = read.tried.map((path, i): Row => ({ key: `${KEY}:tried:${i}`, spans: [{ text: path, dim: true }] }))
      return [titleBlock(file, null), { key: NOTE, rows: [{ key: NOTE, spans: [{ text: 'Not found. Looked for it at:' }] }, ...tried] }]
    }
    case 'unreadable':
      return [titleBlock(file, read.path), single(NOTE, [{ text: `Not shown: ${read.reason.replace(/\.$/, '')}.` }])]
    case 'read': {
      const found = paragraphs(read.text)
      if (found.length === 0) return [titleBlock(file, read.path), single(NOTE, [{ text: 'Empty.', dim: true }])]
      return [titleBlock(file, read.path), ...found.map(paragraph => paragraphBlock(paragraph, file.line))]
    }
  }
}

/**
 * The key of the block `file`'s page lands on: the paragraph holding the line its ref points at, the next one when
 * that line is blank, the last when the file ends before it. Null when it points at none, or nothing was read.
 */
export function lineBlockKey(file: RefFile, read: RefFileRead | undefined): string | null {
  const line = file.line
  if (line === null || read?.kind !== 'read') return null
  const found = paragraphs(read.text)
  const holding = found.find(paragraph => paragraph.first + paragraph.lines.length - 1 >= line) ?? found.at(-1)
  return holding === undefined ? null : paragraphKey(holding)
}
