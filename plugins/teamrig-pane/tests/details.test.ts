import { describe, expect, test } from 'claude-code/testing'
import {
  MAX_QUOTE_CHARS,
  MAX_QUOTED_LINES,
  TaskDetails,
  candidatePaths,
  coversGoal,
  fileLabel,
  datedLines,
  anchoredLines,
  goalItem,
  governingGoal,
  lineRef,
  plainText,
  refParts,
} from '../hooks/details'
import { graphemes } from '../hooks/width'
import { readRegister } from '../hooks/core/read/index'
import { rowOf } from '../hooks/log'
import { MemoryFiles, NOW, createLine } from './fixtures'

const CREATED = '2026-10-13T12:00:00.000Z'
const PLACES = { inboxDir: 'R/inbox', home: 'C:/Homes/a', cwd: 'C:/w/api', teamDir: 'C:/kit/teams/web', goalsDoc: 'docs/R.md' }

/** A slice of the roadmap: goal items, their sub-bullets, a plain item, a week plan, and S-items and task lines under headings. */
const ROADMAP = [
  '## G10 — Foundations',
  '  - [~] G10.1b Clean error-rate gauge — `analytics`. Evidence: a weekly report with CI.',
  '  - [~] G10.1g **Release checklist: CONFIRMED** (dashboards study).',
  '    - Benchmark page load by region.',
  '    - Fix design: `analytics` leads with `dashboards` → **owner decision**.',
  '  - Notes on the gauges:',
  '    - a note held by a plain item',
  '  - [ ] G10.2c Assembly checklist',
  '',
  '## Week plan',
  '  2. Quality: G10.1g formula → G10.1d rebuild.',
  '## Scalability',
  '  - S4 Caching — `release speed upgrades`, after S3.',
  '    - S4 design 10-13: the store row.',
  '  - T9 owner: pick the formula.',
  '  - T90 owner: another task.',
].join('\n')

function taskWith(ref: string, goals: string[] = ['G10.2']) {
  const task = readRegister(createLine('T9', { owner: 'po', by: 'lead', at: NOW, ref, goals })).state.tasks.get('T9')
  if (task === undefined) throw new Error('the fixture task did not read')
  return rowOf(task, [])
}

describe('details', () => {
  test('splits a ref on semicolons, dropping empty parts', async () => {
    expect(refParts('~/a/inbox/po.md:1; docs/x.md:5;  ;quote')).toEqual(['~/a/inbox/po.md:1', 'docs/x.md:5', 'quote'])
  })

  test('reads a line, a capped range or two lines', async () => {
    expect(lineRef('docs/R.md:21')).toEqual({ file: 'docs/R.md', lines: [21] })
    expect(lineRef('C:\\a\\inbox\\etl.md:5-6')).toEqual({ file: 'C:\\a\\inbox\\etl.md', lines: [5, 6] })
    expect(lineRef('x/inbox/po.md:6,8')?.lines).toEqual([6, 8])
    expect(lineRef('x/po.md:1-40')?.lines.length).toBe(MAX_QUOTED_LINES)
    expect(lineRef('x/po.md:9-3')).toBeNull()
    expect(lineRef('owner, in the meeting')).toBeNull()
  })

  test('finds inboxes in the inbox folder, ~/ under home, and a relative ref up from the session folder, then in the team folder', async () => {
    expect(candidatePaths('~/team-notes/board/inbox/po.md', PLACES)).toEqual(['R/inbox/po.md'])
    expect(candidatePaths('~/team-notes/board/po.md', PLACES)).toEqual(['C:/Homes/a/team-notes/board/po.md'])
    expect(candidatePaths('D:\\x\\y.md', PLACES)).toEqual(['D:/x/y.md'])
    expect(candidatePaths('docs/R.md', PLACES)).toEqual(['C:/w/api/docs/R.md', 'C:/w/docs/R.md', 'C:/docs/R.md', 'C:/kit/teams/web/docs/R.md'])
    expect(candidatePaths('notes\\api\\t26.md', { ...PLACES, cwd: null })).toEqual(['C:/kit/teams/web/notes/api/t26.md'])
    expect(candidatePaths('docs/R.md', { ...PLACES, cwd: null, teamDir: null })).toEqual([])
    expect(candidatePaths('~/x.md', { ...PLACES, home: null })).toEqual([])
  })

  test('a file reads as its folder and name', () => {
    expect(fileLabel('~/.teamrig/teams/web/notes/api/t26-findings.md')).toBe('api/t26-findings.md')
    expect(fileLabel('C:\\w\\README.md')).toBe('w/README.md')
    expect(fileLabel('README.md')).toBe('README.md')
  })

  test('quotes as plain text, a long line cut', async () => {
    expect(plainText('  - [~] G10.1g **Window** `analytics`')).toBe('G10.1g Window analytics')
    expect(plainText('- 2026-10-13 lead: ask')).toBe('2026-10-13 lead: ask')
    const cut = plainText('x'.repeat(MAX_QUOTE_CHARS + 50))
    expect(cut.length).toBe(MAX_QUOTE_CHARS)
    expect(cut.endsWith('…')).toBe(true)
  })

  test('cuts a long quote between characters, never inside an emoji or a ZWJ sequence', async () => {
    const thumbs = plainText('👍'.repeat(MAX_QUOTE_CHARS + 50))
    expect(/[\ud800-\udbff](?![\udc00-\udfff])/.test(thumbs)).toBe(false)
    expect(graphemes(thumbs)).toHaveLength(MAX_QUOTE_CHARS)
    const families = plainText('👨‍👩‍👧'.repeat(MAX_QUOTE_CHARS + 1))
    expect(graphemes(families).slice(0, -1).every(part => part === '👨‍👩‍👧')).toBe(true)
    expect(families.endsWith('👨‍👩‍👧…')).toBe(true)
  })

  test('quotes inbox lines dated up to a day after creation', async () => {
    const inbox = ['- 2026-10-12 09:30 lead: rotate the URI', '- 2026-10-14 08:00 po: done', '- 2026-10-20 po: later', 'undated'].join('\r\n')
    expect(datedLines(inbox, [1], CREATED)).toEqual(['2026-10-12 09:30 lead: rotate the URI'])
    expect(datedLines(inbox, [1, 2], CREATED)).toEqual(['2026-10-12 09:30 lead: rotate the URI', '2026-10-14 08:00 po: done'])
    expect(datedLines('2026-10-12 12:05 UTC, from etl: no bullet', [1], CREATED)).toEqual(['2026-10-12 12:05 UTC, from etl: no bullet'])
    expect(datedLines(inbox, [3], CREATED)).toBeNull()
    expect(datedLines(inbox, [1, 3], CREATED)).toBeNull()
    expect(datedLines(inbox, [4], CREATED)).toBeNull()
    expect(datedLines(inbox, [9], CREATED)).toBeNull()
  })

  test('a doc line belongs to its own goal item or the goal item holding it, never across a plain item or a heading', async () => {
    const lines = ROADMAP.split('\n')
    expect(governingGoal(lines, 2)).toBe('G10.1g')
    expect(governingGoal(lines, 4)).toBe('G10.1g')
    expect(governingGoal(lines, 6)).toBeNull()
    expect(governingGoal(lines, 7)).toBe('G10.2c')
    expect(governingGoal(lines, 10)).toBeNull()
    expect(governingGoal(lines, 12)).toBe('S4')
    expect(governingGoal(lines, 14)).toBeNull()
    expect(coversGoal('G10.2', 'G10.2c')).toBe(true)
    expect(coversGoal('G10', 'G10.2c')).toBe(true)
    expect(coversGoal('G10.1', 'G10.10')).toBe(false)
    expect(coversGoal('G10.1g', 'G10.1')).toBe(false)
    expect(coversGoal('S4', 'S40')).toBe(false)
  })

  test('quotes doc lines inside one of the task goals or naming the task, and drops a ref that drifted out of them', async () => {
    const g01g = { id: 'T9', goals: ['G10.1g'] }
    expect(anchoredLines(ROADMAP, [3, 5], g01g)).toEqual([
      'G10.1g Release checklist: CONFIRMED (dashboards study).',
      'Fix design: analytics leads with dashboards → owner decision.',
    ])
    expect(anchoredLines(ROADMAP, [8], { id: 'T9', goals: ['G10.2'] })).toEqual(['G10.2c Assembly checklist'])
    expect(anchoredLines(ROADMAP, [13, 14], { id: 'T9', goals: ['S4'] })).toEqual([
      'S4 Caching — release speed upgrades, after S3.',
      'S4 design 10-13: the store row.',
    ])
    expect(anchoredLines(ROADMAP, [15], { id: 'T9', goals: [] })).toEqual(['T9 owner: pick the formula.'])
    expect(anchoredLines(ROADMAP, [16], { id: 'T9', goals: [] })).toBeNull()
    expect(anchoredLines(ROADMAP, [5], { id: 'T9', goals: ['G10.1b'] })).toBeNull()
    expect(anchoredLines(ROADMAP, [11], g01g)).toBeNull()
    expect(anchoredLines(ROADMAP, [9], { id: 'T9', goals: ['G10.2'] })).toBeNull()
    expect(anchoredLines(ROADMAP, [3, 7], g01g)).toBeNull()
    expect(anchoredLines(ROADMAP, [40], g01g)).toBeNull()
  })

  test('finds a goal item by its id, wherever it sits, as plain words', async () => {
    expect(goalItem(ROADMAP, 'G10.1g')).toBe('G10.1g Release checklist: CONFIRMED (dashboards study).')
    expect(goalItem(ROADMAP, 'S4')).toBe('S4 Caching — release speed upgrades, after S3.')
    expect(goalItem(ROADMAP, 'G10.1')).toBeNull()
    expect(goalItem(ROADMAP, 'G19')).toBeNull()
  })

  test('loads the quotable parts of a ref, then the items of the goals they did not quote', async () => {
    const files = new MemoryFiles()
    files.write('C:/w/docs/R.md', ROADMAP)
    files.write('R/inbox/po.md', ['- 2026-10-12 lead: first', '- 2026-10-13 dashboards: pin the Docker digest'].join('\n'))
    const ref = 'docs/R.md:5; docs/R.md:11; ~/team-notes/board/inbox/po.md:2; ~/team-notes/board/po.md:6; docs/gone.md:1'
    const detail = await new TaskDetails(files, PLACES).load(taskWith(ref, ['G10.1g', 'S4', 'G19']))
    expect(detail).toEqual({
      ref,
      quotes: [
        { ref: 'docs/R.md:5', lines: ['Fix design: analytics leads with dashboards → owner decision.'] },
        { ref: '~/team-notes/board/inbox/po.md:2', lines: ['2026-10-13 dashboards: pin the Docker digest'] },
      ],
      goals: [
        { goal: 'G10.1g', text: 'G10.1g Release checklist: CONFIRMED (dashboards study).' },
        { goal: 'S4', text: 'S4 Caching — release speed upgrades, after S3.' },
      ],
    })
  })

  test('quotes a goal item once when a ref already points at it, and none without a goals doc', async () => {
    const files = new MemoryFiles()
    files.write('C:/w/docs/R.md', ROADMAP)
    const pointed = await new TaskDetails(files, PLACES).load(taskWith('docs/R.md:3', ['G10.1g']))
    expect(pointed.quotes).toEqual([{ ref: 'docs/R.md:3', lines: ['G10.1g Release checklist: CONFIRMED (dashboards study).'] }])
    expect(pointed.goals).toEqual([])
    const noDoc = await new TaskDetails(files, { ...PLACES, goalsDoc: null }).load(taskWith('board/po.md:6', ['G10.1g']))
    expect([noDoc.quotes, noDoc.goals]).toEqual([[], []])
  })
})
