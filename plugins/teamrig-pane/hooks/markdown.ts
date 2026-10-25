// Markdown as rows' spans (rows.ts), for the Log page (log-rows.ts): its marks drawn as styles, never shown as
// characters. `**bold**` is bold, `` `code` `` the code color, `[words](https://…)` a link on its words, a `#`
// heading bold, a `-`, `*` or `+` item a bullet and a numbered item its number, each wrapping under its words; a `>`
// quote and a fenced block's lines behind a dim bar (a block's lines as written, its fences dropped), a `---` line a
// rule, and a table's cells between dim bars, its head bold and its `|---|` line dropped. Paragraphs split as a file
// page's do (file-page.ts), each line keeping its number in the text. Pure.
import { paragraphs } from './file-page'
import type { Span } from './rows'

/** A line as drawn: its number in the text (1 is the first), its spans, what its wrapped lines start with, and whether it is a rule. */
export type MarkLine = { readonly at: number; readonly spans: Span[]; readonly hang: Span | undefined; readonly rule: boolean }

/** A paragraph's lines as drawn; `first` is its first line's number. */
export type MarkParagraph = { readonly first: number; readonly lines: MarkLine[] }

/** What a quote's and a fenced block's lines are drawn behind. */
const BAR = '│ '
/** What a table's cells are drawn between. */
const CELL_BAR: Span = { text: ' │ ', dim: true }
const BULLET = '• '
const CODE_COLOR = 'suggestion'
const INLINE = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g
const FENCE = /^\s*(```|~~~)/
const HEADING = /^\s*#{1,6}\s+(.*?)(?:\s+#+)?$/
const RULE = /^\s*([-*_])(?:\s*\1){2,}$/
const ITEM = /^(\s*)[-*+]\s+(.*)$/
const NUMBERED = /^(\s*)(\d+[.)])\s+(.*)$/
const QUOTE = /^(\s*)>(?: (.*))?$/
const TABLE_ROW = /^\s*\|.*\|$/
const TABLE_RULE = /^[\s|:-]*-[\s|:-]*$/

/** `text` with its inline marks as styles. */
export function inlineSpans(text: string): Span[] {
  const spans: Span[] = []
  const plain = (from: number, to: number) => {
    if (to > from) spans.push({ text: text.slice(from, to) })
  }
  let at = 0
  for (const match of text.matchAll(INLINE)) {
    plain(at, match.index)
    const [, bold, code, words, href] = match
    if (bold !== undefined) spans.push({ text: bold, bold: true })
    else if (code !== undefined) spans.push({ text: code, color: CODE_COLOR })
    else if (words !== undefined && href !== undefined) spans.push({ text: words, href })
    at = match.index + match[0].length
  }
  plain(at, text.length)
  return spans
}

function bolded(spans: readonly Span[]): Span[] {
  return spans.map(span => ({ ...span, bold: true }))
}

function indentOf(line: string): string {
  return line.slice(0, line.length - line.trimStart().length)
}

/** A table row's cells as spans between bars, bold for its head. */
function tableSpans(line: string, isHead: boolean): Span[] {
  const cells = line.trim().slice(1, -1).split('|').map(cell => inlineSpans(cell.trim()))
  return cells.flatMap((cell, i) => [...(i === 0 ? [] : [CELL_BAR]), ...(isHead ? bolded(cell) : cell)])
}

/** A line outside a fenced block as drawn; `next` is the line after it in its paragraph. */
function markLine(at: number, line: string, next: string | undefined): MarkLine | null {
  const drawn = (spans: Span[], hang: Span | undefined): MarkLine => ({ at, spans, hang, rule: false })
  if (TABLE_ROW.test(line)) {
    if (TABLE_RULE.test(line)) return null
    return drawn(tableSpans(line, next !== undefined && TABLE_ROW.test(next) && TABLE_RULE.test(next)), undefined)
  }
  if (RULE.test(line)) return { at, spans: [], hang: undefined, rule: true }
  const heading = HEADING.exec(line)
  if (heading !== null) return drawn(bolded(inlineSpans(heading[1] ?? '')), undefined)
  const item = ITEM.exec(line)
  if (item !== null) {
    const indent = item[1] ?? ''
    return drawn([{ text: `${indent}${BULLET}` }, ...inlineSpans(item[2] ?? '')], { text: `${indent}${' '.repeat(BULLET.length)}` })
  }
  const numbered = NUMBERED.exec(line)
  if (numbered !== null) {
    const lead = `${numbered[1] ?? ''}${numbered[2] ?? ''} `
    return drawn([{ text: lead }, ...inlineSpans(numbered[3] ?? '')], { text: ' '.repeat(lead.length) })
  }
  const quote = QUOTE.exec(line)
  if (quote !== null) {
    const indent = quote[1] ?? ''
    return drawn([...(indent === '' ? [] : [{ text: indent }]), { text: BAR, dim: true }, ...inlineSpans(quote[2] ?? '')], { text: `${indent}${BAR}`, dim: true })
  }
  const indent = indentOf(line)
  return drawn(inlineSpans(line), indent === '' ? undefined : { text: indent })
}

/** A fenced block's line as written, behind a dim bar. */
function codeLine(at: number, line: string): MarkLine {
  return { at, spans: [{ text: BAR, dim: true }, { text: line }], hang: { text: `${BAR}${indentOf(line)}`, dim: true }, rule: false }
}

/** `text`'s paragraphs as drawn: a paragraph whose every line is a mark of its own (a fence, a table's rule) is left out. */
export function markdownParagraphs(text: string): MarkParagraph[] {
  let isCode = false
  return paragraphs(text).flatMap(paragraph => {
    const lines = paragraph.lines.flatMap((line, i): MarkLine[] => {
      const at = paragraph.first + i
      if (FENCE.test(line)) {
        isCode = !isCode
        return []
      }
      if (isCode) return [codeLine(at, line)]
      const drawn = markLine(at, line, paragraph.lines[i + 1])
      return drawn === null ? [] : [drawn]
    })
    const first = lines[0]
    return first === undefined ? [] : [{ first: first.at, lines }]
  })
}
