// What any search draws under its Find field (search-rows.ts draws the Tasks view's on it; the Inbox, Log and Changes
// searches, T772-T774, will too): the hint while the query has no word, one line that says so when nothing matches,
// else a dim line counting the matches, then one block per result shown. A result underlines the words that matched
// (markedSpans) and shows a long field from a little before its first match (excerpt). Pure: blocks of rows (rows.ts)
// that layout.ts wraps.
import { single, type Block, type Span } from './rows'
import { queryWords, type Mark } from './search'

/** A matched field's text starts at most this many characters before its first match, cut there with `…`. */
export const EXCERPT_LEAD = 20
const ELLIPSIS = '…'

/** What one result is called, and more than one: `task`, `tasks`. */
export type Noun = { one: string; many: string }

/** A search's body as drawn under its Find field. */
export type SearchView = {
  /** Its own lines' keys start with it: `<key>-hint`, `<key>-none`, `<key>-count`. */
  key: string
  query: string
  /** What an empty Find field shows. */
  hint: string
  /** What a query nothing matches shows. */
  nothing: string
  noun: Noun
  /** One block per result shown, in order, the search's cap already applied. */
  results: readonly Block[]
  /** How many results matched, those past the cap too. */
  total: number
}

/** `text` as spans in `style`, the `marks` runs underlined. */
export function markedSpans(text: string, marks: readonly Mark[], style: Omit<Span, 'text'>): Span[] {
  const spans: Span[] = []
  let at = 0
  for (const mark of marks) {
    spans.push({ ...style, text: text.slice(at, mark.start) }, { ...style, text: text.slice(mark.start, mark.end), underline: true })
    at = mark.end
  }
  spans.push({ ...style, text: text.slice(at) })
  return spans.filter(span => span.text !== '')
}

/** A field's text from EXCERPT_LEAD characters before its first match, `…` where it was cut, its marks moved with it. */
export function excerpt(text: string, marks: readonly Mark[]): { text: string; marks: Mark[] } {
  const first = marks[0]
  if (first === undefined || first.start <= EXCERPT_LEAD) return { text, marks: [...marks] }
  const cut = first.start - EXCERPT_LEAD
  const shift = ELLIPSIS.length - cut
  return { text: `${ELLIPSIS}${text.slice(cut)}`, marks: marks.map(mark => ({ start: mark.start + shift, end: mark.end + shift })) }
}

/** `1 task matches`, `3 tasks match`; with some past the cap, how many are shown and what narrows them. */
export function countWords(total: number, shown: number, noun: Noun): string {
  const matched = total === 1 ? `1 ${noun.one} matches` : `${total} ${noun.many} match`
  return shown < total ? `${matched}, ${shown} shown: add a word to narrow them` : matched
}

/** The search's body: the hint for a query with no word, the nothing line when none matched, else the count, then the results. */
export function searchViewBlocks(view: SearchView): Block[] {
  if (queryWords(view.query).length === 0) return [single(`${view.key}-hint`, [{ text: view.hint, dim: true }])]
  if (view.total === 0) return [single(`${view.key}-none`, [{ text: view.nothing, dim: true }])]
  return [single(`${view.key}-count`, [{ text: countWords(view.total, view.results.length, view.noun), dim: true }]), ...view.results]
}
