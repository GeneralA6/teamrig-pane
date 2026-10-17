import { describe, expect, test } from 'claude-code/testing'
import type { Snapshot, TaskRow } from '../types'
import { readRegister } from '../hooks/core/read/index'
import { rowOf } from '../hooks/log'
import { treeOf } from '../hooks/meta'
import type { Block, Span } from '../hooks/rows'
import { MAX_RESULTS, NO_RESULTS, queryWords, searchTasks, topResult, type Hit } from '../hooks/search'
import { EXCERPT_LEAD, excerpt, markedSpans, NOTHING_FOUND, SEARCH_HINT, searchBlocks } from '../hooks/search-rows'
import { HOUR, NOW, createLine, statusLine } from './fixtures'

/** The rows teamrig's reader folds from event lines. */
function rowsOf(lines: readonly string[]): TaskRow[] {
  return [...readRegister(lines.join('\n')).state.tasks.values()].map(task => rowOf(task, []))
}

/** po's pages, etl's feed and source, two of them finished today, one dropped. */
const TASKS = rowsOf([
  createLine('T52', { owner: 'po', by: 'lead', at: NOW - 3 * HOUR, title: 'Draw the pages', source: 'lead', goals: ['G11.4'], week: '2026-10-12', priority: 2 }),
  createLine('T50', { owner: 'etl', by: 'lead', at: NOW - 3 * HOUR, title: 'Load the feed', ref: 'docs/feed.md:12' }),
  createLine('T58', { owner: 'etl', by: 'lead', at: NOW - 3 * HOUR, title: 'Read the source', priority: 1 }),
  createLine('T7', { owner: 'etl', by: 'etl', at: NOW - 5 * HOUR, title: 'Fix the loader' }),
  statusLine('T7', 'etl', NOW - 2 * HOUR, 'done', 'fed the loader its new column', 'abc1234'),
  createLine('T9', { owner: 'po', by: 'po', at: NOW - 5 * HOUR, title: 'Feed the pages' }),
  statusLine('T9', 'po', NOW - HOUR, 'dropped', 'folded into the feed'),
])
const SNAP: Snapshot = { tasks: TASKS, area: 'po', areaSource: null, unreadInbox: null, problem: null, now: NOW }

/** What `query` finds among `tasks`, the active ones in plan order on their tree's effective dues. */
const search = (tasks: readonly TaskRow[], query: string) => searchTasks(tasks, query, treeOf(tasks, NOW))

/** The ids `query` finds, the active ones, then `|`, then the finished ones. */
function found(query: string, tasks: readonly TaskRow[] = TASKS): string[] {
  const results = search(tasks, query)
  return [...results.active.map(hit => hit.task.id), '|', ...results.done.map(hit => hit.task.id)]
}

/** The one hit `query` finds. */
function hitOf(query: string): Hit {
  const [hit, ...rest] = [...search(TASKS, query).active, ...search(TASKS, query).done]
  if (hit === undefined || rest.length > 0) throw new Error(`${query} finds ${rest.length + (hit === undefined ? 0 : 1)} tasks`)
  return hit
}

/** A row's words, the underlined ones in brackets: what a search draws, as text. */
const marked = (spans: readonly Span[]) => spans.map(span => (span.underline === true ? `[${span.text}]` : span.text)).join('')
const rowsIn = (blocks: readonly Block[]) => blocks.flatMap(block => block.rows.map(row => marked(row.spans)))

describe('search', () => {
  test('finds a task by its id, written whole or as its number, case aside; a part of an id is no match', async () => {
    expect(found('T52')).toEqual(['T52', '|'])
    expect(found('52')).toEqual(['T52', '|'])
    expect(found('t52')).toEqual(['T52', '|'])
    expect(found('T5')).toEqual(['|'])
    expect(hitOf('52').isId).toBe(true)
    expect(hitOf('draw').isId).toBe(false)
  })

  test('every word must match: a word of the title, case aside, from its start', async () => {
    expect(found('load feed')).toEqual(['T50', '|'])
    expect(found('LOAD Feed')).toEqual(['T50', '|'])
    expect(found('LOAD')).toEqual(['T50', '|', 'T7'])
    expect(found('load pages')).toEqual(['|'])
    expect(found('oad')).toEqual(['|'])
  })

  test('matches the owner, who asked, the goals, the week, the note, the evidence and the ref', async () => {
    expect(found('etl')).toEqual(['T58', 'T50', '|', 'T7'])
    expect(found('lead')).toEqual(['T52', '|'])
    expect(found('g11.4')).toEqual(['T52', '|'])
    expect(found('10-12')).toEqual(['T52', '|'])
    expect(found('column')).toEqual(['|', 'T7'])
    expect(found('abc12')).toEqual(['|', 'T7'])
    expect(found('docs/feed')).toEqual(['T50', '|'])
  })

  test('a word led by a mark matches anywhere in a field', async () => {
    expect(found('.md:12')).toEqual(['T50', '|'])
    expect(hitOf('.md:12').marks.ref).toEqual([{ start: 9, end: 15 }])
    expect(found('.md').length).toBe(TASKS.length + 1)
  })

  test('the active matches first in plan order, then the finished ones newest first', async () => {
    expect(found('the')).toEqual(['T58', 'T52', 'T50', '|', 'T9', 'T7'])
    expect(topResult(search(TASKS, 'the'))?.id).toBe('T58')
    expect(topResult(search(TASKS, 'column'))?.id).toBe('T7')
    expect(topResult(search(TASKS, 'nothing-here'))).toBe(null)
  })

  test('plan order reads the effective due: an undated task a dated one needs comes first', async () => {
    const tasks = rowsOf([
      createLine('T1', { owner: 'po', by: 'po', at: NOW, title: 'Draw the chart', due: '2026-10-20' }),
      createLine('T2', { owner: 'po', by: 'po', at: NOW, title: 'Draw the axis' }),
      createLine('T3', { owner: 'etl', by: 'etl', at: NOW, title: 'Ship the report', due: '2026-10-15', taskKeys: { after: ['T2'] } }),
    ])
    expect(found('draw', tasks)).toEqual(['T2', 'T1', '|'])
  })

  test("keeps where each word matched, in order, overlapping ones joined; the id's match is its own flag", async () => {
    const hit = hitOf('fee lo feed')
    expect(hit.marks.title).toEqual([
      { start: 0, end: 2 },
      { start: 9, end: 13 },
    ])
    expect(hit.marks.ref).toEqual([{ start: 5, end: 9 }])
    expect(hit.marks.owner).toEqual([])
  })

  test(`keeps at most ${MAX_RESULTS} matches, the active first, and counts the rest`, async () => {
    const lines = Array.from({ length: 34 }, (_, i) => createLine(`T${100 + i}`, { owner: 'bulk', by: 'po', at: NOW - 5 * HOUR }))
    const finished = Array.from({ length: 3 }, (_, i) => statusLine(`T${100 + i}`, 'bulk', NOW - HOUR, 'done', 'shipped', 'abc'))
    const results = search(rowsOf([...lines, ...finished]), 'bulk')
    expect([results.active.length, results.done.length, results.more]).toEqual([MAX_RESULTS, 0, 4])
    const few = search(rowsOf([...lines.slice(0, 28), ...finished]), 'bulk')
    expect([few.active.length, few.done.length, few.more]).toEqual([25, 3, 0])
    const over = search(rowsOf([...lines.slice(0, 31), ...finished]), 'bulk')
    expect([over.active.length, over.done.length, over.more]).toEqual([28, 2, 1])
  })

  test('a blank query names nothing', async () => {
    expect(search(TASKS, '  ')).toBe(NO_RESULTS)
    expect(queryWords(' Load  the\tfeed ')).toEqual(['load', 'the', 'feed'])
  })
})

describe('search rows', () => {
  test('an active result is its title row, then whose it is and the fields a word matched in, the matches underlined', async () => {
    const blocks = searchBlocks(SNAP, 'load etl')
    expect(blocks.map(block => [block.key, block.opens])).toEqual([
      ['search:T50', 'T50'],
      ['search:T7', 'T7'],
    ])
    expect(rowsIn(blocks)).toEqual(['○ T50  [Load] the feed', '       on [etl]', '✓ T7  Fix the [load]er'])
    expect(rowsIn(searchBlocks(SNAP, 'docs/feed'))).toEqual(['○ T50  Load the feed', '       on etl · ref [docs/feed].md:12'])
    expect(rowsIn(searchBlocks(SNAP, '10-12 g11.4 lead'))).toEqual([
      '○ T52  Draw the pages',
      '       on po · asked by [lead] · goals [G11.4] · week 2026-[10-12]',
    ])
  })

  test('a finished result is one dim line with when it closed; a dropped one has a dim mark', async () => {
    const [block] = searchBlocks(SNAP, 'T9')
    const row = block?.rows[0]
    expect(row?.spans.every(span => span.dim === true)).toBe(true)
    expect(marked(row?.spans ?? [])).toBe('✗ [T9]  Feed the pages')
    expect([row?.end?.text, row?.maxLines]).toEqual(['13:00', 1])
  })

  test('the id a word named is underlined, the title row bold on it', async () => {
    const [block] = searchBlocks(SNAP, '52 draw')
    expect(rowsIn(block === undefined ? [] : [block])).toEqual(['○ [T52]  [Draw] the pages', '       on po'])
    expect(block?.rows[0]?.spans.find(span => span.text === 'T52')).toEqual({ text: 'T52', bold: true, underline: true })
  })

  test('a long field shows from a little before its match', async () => {
    const [, meta] = searchBlocks(SNAP, 'column')[0]?.rows ?? []
    expect(meta).toBeUndefined()
    const note = 'x'.repeat(40) + ' the column'
    expect(excerpt(note, [{ start: 45, end: 51 }])).toEqual({ text: `…${note.slice(45 - EXCERPT_LEAD)}`, marks: [{ start: 21, end: 27 }] })
    expect(excerpt('short note', [{ start: 6, end: 10 }])).toEqual({ text: 'short note', marks: [{ start: 6, end: 10 }] })
    expect(excerpt('no marks', [])).toEqual({ text: 'no marks', marks: [] })
  })

  test('a note match on an active task names the note, cut before its match', async () => {
    const tasks = rowsOf([
      createLine('T3', { owner: 'po', by: 'po', at: NOW - HOUR, title: 'Ship it' }),
      statusLine('T3', 'po', NOW - HOUR, 'in-progress', 'waiting for the second review from the owner'),
    ])
    const [block] = searchBlocks({ ...SNAP, tasks }, 'owner')
    expect(rowsIn(block === undefined ? [] : [block])).toEqual(['◐ T3  Ship it', '      on po · asked by [owner] · note …ond review from the [owner]'])
  })

  test('marks split a text into plain and underlined spans in one style', async () => {
    expect(markedSpans('Load the feed', [{ start: 0, end: 4 }], { dim: true })).toEqual([
      { dim: true, text: 'Load', underline: true },
      { dim: true, text: ' the feed' },
    ])
    expect(markedSpans('feed', [], {})).toEqual([{ text: 'feed' }])
  })

  test(`past the cap a dim line asks for another word; nothing matched says so; no word yet shows the hint`, async () => {
    const lines = Array.from({ length: 33 }, (_, i) => createLine(`T${100 + i}`, { owner: 'bulk', by: 'po', at: NOW - HOUR }))
    const blocks = searchBlocks({ ...SNAP, tasks: rowsOf(lines) }, 'bulk')
    expect(blocks.length).toBe(MAX_RESULTS + 1)
    expect(rowsIn(blocks.slice(-1))).toEqual(['3 more: add a word'])
    expect(rowsIn(searchBlocks(SNAP, 'nothing-here'))).toEqual([NOTHING_FOUND])
    expect(rowsIn(searchBlocks(SNAP, ' '))).toEqual([SEARCH_HINT])
  })

  test("leads with the register's problem, and says it is reading before the first read", async () => {
    expect(searchBlocks({ ...SNAP, problem: 'events.jsonl: locked' }, 'feed').map(block => block.key)).toEqual(['problem', 'search:T50', 'search:T9'])
    expect(searchBlocks({ ...SNAP, problem: 'events.jsonl: locked' }, '').map(block => block.key)).toEqual(['problem', 'search-hint'])
    expect(searchBlocks({ ...SNAP, problem: 'locked' }, 'nothing-here').map(block => block.key)).toEqual(['problem', 'search-none'])
    expect(searchBlocks({ ...SNAP, now: 0 }, 'feed').map(block => block.key)).toEqual(['reading'])
  })
})
