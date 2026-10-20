import { describe, expect, test } from 'claude-code/testing'
import { marksOf, matchRows, queryWords, type SearchSpec } from '../hooks/search'

/** A row of another kind than a task: an inbox line, by who sent it, its words and where it points. */
type Line = { from: string; text: string; ref: string | null }
type LineField = 'from' | 'text' | 'ref'

const LINES: readonly Line[] = [
  { from: 'etl', text: 'Loaded the feed for 10-20', ref: 'docs/feed.md:12' },
  { from: 'lead', text: 'Review the pages', ref: null },
  { from: 'po', text: 'The feed broke at 03:00', ref: null },
]
const LINE_SEARCH: SearchSpec<Line, LineField> = {
  fields: [
    { name: 'from', text: line => line.from },
    { name: 'text', text: line => line.text },
    { name: 'ref', text: line => line.ref },
  ],
}

/** A spec on a line's text alone that counts how many times it read one. */
function countingSpec(): { spec: SearchSpec<Line, 'text'>; read: { count: number } } {
  const read = { count: 0 }
  const text = (line: Line): string => {
    read.count += 1
    return line.text
  }
  return { spec: { fields: [{ name: 'text', text }] }, read }
}

/** Who sent the lines `query` names, in the lines' order. */
const senders = (query: string) => matchRows(LINES, query, LINE_SEARCH).map(hit => hit.row.from)

describe('search over any rows', () => {
  test("names the rows every word matches the start of a word in, in the rows' order, case aside", async () => {
    expect(senders('feed')).toEqual(['etl', 'po'])
    expect(senders('FEED broke')).toEqual(['po'])
    expect(senders('eed')).toEqual([])
    expect(senders('lead pages')).toEqual(['lead'])
    expect(senders('lead feed')).toEqual([])
  })

  test('a word led by a mark matches anywhere in a field; a field with no text is skipped', async () => {
    expect(senders('.md:12')).toEqual(['etl'])
    expect(senders(':00')).toEqual(['po'])
    const [hit] = matchRows(LINES, '.md', LINE_SEARCH)
    expect(hit === undefined ? null : marksOf(hit, 'ref')).toEqual([{ start: 9, end: 12 }])
  })

  test('keeps where words matched in each field, joined where they overlap; none for a field no word matched', async () => {
    const [hit] = matchRows(LINES, 'fee feed lo docs', LINE_SEARCH)
    expect(hit?.row.from).toBe('etl')
    expect(hit === undefined ? null : [marksOf(hit, 'text'), marksOf(hit, 'ref'), marksOf(hit, 'from')]).toEqual([
      [
        { start: 0, end: 2 },
        { start: 11, end: 15 },
      ],
      [
        { start: 0, end: 4 },
        { start: 5, end: 9 },
      ],
      [],
    ])
  })

  test('without an id in the spec, no word names an id; with one, a word names it whole or by its number', async () => {
    type Keyed = { key: string; title: string }
    const rows: readonly Keyed[] = [{ key: 'T52', title: 'Draw the pages' }]
    const byTitle: SearchSpec<Keyed, 'title'> = { fields: [{ name: 'title', text: row => row.title }] }
    expect(matchRows(rows, '52', byTitle)).toEqual([])
    const byKey: SearchSpec<Keyed, 'title'> = { ...byTitle, id: row => row.key }
    expect(matchRows(rows, '52 draw', byKey).map(hit => [hit.row.key, hit.isId])).toEqual([['T52', true]])
    expect(matchRows(rows, 't52', byKey).map(hit => hit.isId)).toEqual([true])
    expect(matchRows(rows, 'draw', byKey).map(hit => hit.isId)).toEqual([false])
    expect(matchRows(rows, 'T5', byKey)).toEqual([])
  })

  test("reads each row's fields once a query, however many words it has", async () => {
    const { spec, read } = countingSpec()
    matchRows(LINES, 'the feed for', spec)
    expect(read.count).toBe(LINES.length)
  })

  test('a blank query names nothing and reads no row', async () => {
    const { spec, read } = countingSpec()
    expect(matchRows(LINES, ' \t ', spec)).toEqual([])
    expect(read.count).toBe(0)
    expect(queryWords(' Load  the\tfeed ')).toEqual(['load', 'the', 'feed'])
  })
})
