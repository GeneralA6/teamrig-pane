// The pane's search, for any kind of row (task-search.ts holds the Tasks view's): the rows a query names. Each word of
// the query must match, case aside, the row's id whole (`T52`, or its number `52`) when the spec gives rows an id, or
// the start of a word in one of the spec's fields. A word that starts with a mark (`.md`, `/docs`) matches anywhere in
// a field. Each hit keeps where its words matched so a drawing (search-view.ts) underlines them. One pass over the
// rows a query, each row's fields read once. Pure.

/** Where a word matched in a field's text: from `start` up to `end`, as string indexes. */
export type Mark = { start: number; end: number }
/** What a kind of row is searched by: its fields, each by name with its text (null when the row has none), and its id when it has one. */
export type SearchSpec<R, F extends string> = {
  fields: ReadonlyArray<{ name: F; text: (row: R) => string | null }>
  id?: (row: R) => string
}
/** A row the query names: whether a word named its id, and where words matched in each field, in order, none overlapping. */
export type Hit<R, F extends string> = { row: R; isId: boolean; marks: ReadonlyMap<F, readonly Mark[]> }

/** A letter or a digit: a word starts where one follows anything else. */
const WORD_CHAR = /[\p{L}\p{N}]/u

/** The query's words, lowercased; none for a blank query. */
export function queryWords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(word => word !== '')
}

/** Where words matched in the hit's `field`, in order; none when no word matched there. */
export function marksOf<R, F extends string>(hit: Hit<R, F>, field: F): readonly Mark[] {
  return hit.marks.get(field) ?? []
}

/** `word` names the id `id`: the id whole, or its number alone (`52` for `T52`). */
function namesId(id: string, word: string): boolean {
  const lower = id.toLowerCase()
  return lower === word || lower.replace(/^\D+/, '') === word
}

/** A word as a pattern that finds it case aside, its marks taken literally. */
function patternOf(word: string): RegExp {
  return new RegExp(word.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'), 'giu')
}

/** Where `pattern` (of `word`) matches in `text`: at the start of a word, or anywhere for a word that starts with a mark. */
function marksIn(text: string, word: string, pattern: RegExp): Mark[] {
  const anywhere = !WORD_CHAR.test(word.charAt(0))
  return Array.from(text.matchAll(pattern), match => ({ start: match.index, end: match.index + match[0].length })).filter(
    mark => anywhere || mark.start === 0 || !WORD_CHAR.test(text.charAt(mark.start - 1)),
  )
}

/** Marks in order, those that overlap or touch joined into one. */
function joined(marks: readonly Mark[]): Mark[] {
  const out: Mark[] = []
  for (const mark of [...marks].sort((a, b) => a.start - b.start || a.end - b.end)) {
    const last = out[out.length - 1]
    if (last !== undefined && mark.start <= last.end) out[out.length - 1] = { start: last.start, end: Math.max(last.end, mark.end) }
    else out.push(mark)
  }
  return out
}

/** A query word and the pattern that finds it. */
type Term = { word: string; pattern: RegExp }

/** The row as a hit when every term matches its id or one of its fields; null when one does not. */
function hitOf<R, F extends string>(row: R, terms: readonly Term[], spec: SearchSpec<R, F>): Hit<R, F> | null {
  const id = spec.id?.(row) ?? null
  const texts = spec.fields.map(field => ({ name: field.name, text: field.text(row) }))
  const found = new Map<F, Mark[]>()
  let isId = false
  for (const { word, pattern } of terms) {
    let isMatched = id !== null && namesId(id, word)
    isId ||= isMatched
    for (const { name, text } of texts) {
      const marks = text === null ? [] : marksIn(text, word, pattern)
      if (marks.length === 0) continue
      found.set(name, [...(found.get(name) ?? []), ...marks])
      isMatched = true
    }
    if (!isMatched) return null
  }
  return { row, isId, marks: new Map(Array.from(found, ([name, marks]) => [name, joined(marks)])) }
}

/** The rows `query` names, as hits in the rows' order; a blank query names none. */
export function matchRows<R, F extends string>(rows: readonly R[], query: string, spec: SearchSpec<R, F>): Hit<R, F>[] {
  const terms = queryWords(query).map((word): Term => ({ word, pattern: patternOf(word) }))
  if (terms.length === 0) return []
  const hits: Hit<R, F>[] = []
  for (const row of rows) {
    const hit = hitOf(row, terms, spec)
    if (hit !== null) hits.push(hit)
  }
  return hits
}
