import { describe, expect, test } from 'claude-code/testing'
import { single, type Block } from '../hooks/rows'
import { countWords, EXCERPT_LEAD, excerpt, markedSpans, searchViewBlocks, type Noun, type SearchView } from '../hooks/search-view'

const NOTES: Noun = { one: 'note', many: 'notes' }
/** Two notes found, the hint and the nothing line in a notes search's words. */
const VIEW: SearchView = {
  key: 'notes',
  query: 'feed',
  hint: 'Type words to find a note.',
  nothing: 'No note matches.',
  noun: NOTES,
  results: [single('notes:1', [{ text: 'the feed' }]), single('notes:2', [{ text: 'feed it' }])],
  total: 2,
}
/** Each block's rows as text. */
const textOf = (blocks: readonly Block[]) => blocks.flatMap(block => block.rows.map(row => row.spans.map(span => span.text).join('')))

describe('search view', () => {
  test('marks split a text into plain and underlined spans in one style', async () => {
    expect(markedSpans('Load the feed', [{ start: 0, end: 4 }], { dim: true })).toEqual([
      { dim: true, text: 'Load', underline: true },
      { dim: true, text: ' the feed' },
    ])
    expect(markedSpans('the feed', [{ start: 4, end: 8 }], {})).toEqual([{ text: 'the ' }, { text: 'feed', underline: true }])
    expect(markedSpans('feed', [], {})).toEqual([{ text: 'feed' }])
  })

  test('a long field shows from a little before its first match, its marks moved with it', async () => {
    const note = 'x'.repeat(40) + ' the column'
    expect(excerpt(note, [{ start: 45, end: 51 }])).toEqual({ text: `…${note.slice(45 - EXCERPT_LEAD)}`, marks: [{ start: 21, end: 27 }] })
    expect(excerpt('short note', [{ start: 6, end: 10 }])).toEqual({ text: 'short note', marks: [{ start: 6, end: 10 }] })
    expect(excerpt('no marks', [])).toEqual({ text: 'no marks', marks: [] })
  })

  test('the count names one match, more, and past the cap how many are shown', async () => {
    expect(countWords(1, 1, NOTES)).toBe('1 note matches')
    expect(countWords(3, 3, NOTES)).toBe('3 notes match')
    expect(countWords(42, 30, NOTES)).toBe('42 notes match, 30 shown: add a word to narrow them')
  })

  test('the count leads the results; no word yet shows the hint; nothing matched says so', async () => {
    const blocks = searchViewBlocks(VIEW)
    expect(blocks.map(block => block.key)).toEqual(['notes-count', 'notes:1', 'notes:2'])
    expect(blocks[0]?.rows[0]?.spans).toEqual([{ text: '2 notes match', dim: true }])
    expect(textOf(searchViewBlocks({ ...VIEW, results: VIEW.results.slice(0, 1), total: 5 }))).toEqual([
      '5 notes match, 1 shown: add a word to narrow them',
      'the feed',
    ])
    expect(searchViewBlocks({ ...VIEW, query: '  ' })).toEqual([single('notes-hint', [{ text: 'Type words to find a note.', dim: true }])])
    expect(searchViewBlocks({ ...VIEW, results: [], total: 0 })).toEqual([single('notes-none', [{ text: 'No note matches.', dim: true }])])
  })
})
