import { describe, expect, test } from 'claude-code/testing'
import { DEFAULT_FOCUS, DEFAULT_REGISTER, TASKS_WEEK_FORMAT } from '../hooks/core/read/index'
import type { TreeTask } from '../hooks/core/register/tree'
import { NO_SPEND, rankingOf, spendFor, spendIn } from '../hooks/ranking'
import { LIKE_MEDIANS, NOW, tasksWeekText } from './fixtures'

describe('rankingOf', () => {
  /** An open task preparing slice `slice` of goal A1. */
  const prepTask = (slice: number): TreeTask => ({ id: 'T1', status: 'open', owner: 'po', priority: 2, due: null, after: [], waits: [], prepares: { goal: 'A1', slice } })
  const standing = (slice: number, open: number | null) =>
    rankingOf(DEFAULT_FOCUS, DEFAULT_REGISTER.ownerSource, { A1: { parent: null, rank: 1, slice: open } }, NO_SPEND).prepOf(prepTask(slice))?.standing

  // The goal's open slice reaches the core ranking: a marker on it or the next stands near, ranked right after expedite.
  test("a prep marker stands near by its goal's open slice, and lapses once the goal opens none or moves past it", async () => {
    expect(standing(2, 2)).toBe('near')
    expect(standing(3, 2)).toBe('near')
    expect(standing(1, 2)).toBe('lapsed')
    expect(standing(2, null)).toBe('lapsed')
  })
})

describe('spendIn', () => {
  test("reads each task's spend and the like tasks' medians from the file teamrig's budget hooks write", async () => {
    const spend = { spentPct: { T1: 0.4, T2: 1 }, likeMedians: LIKE_MEDIANS }
    expect(spendIn(tasksWeekText(spend))).toEqual(spend)
  })

  test('a damaged file, or one in a format this pane cannot read, reads as no spend: the pane ranks as with no file', async () => {
    const stored = { at: NOW, spentPct: { T1: 0.4 }, likeMedians: LIKE_MEDIANS }
    expect(spendIn('')).toEqual(NO_SPEND)
    expect(spendIn('{"v":2,')).toEqual(NO_SPEND)
    expect(spendIn(JSON.stringify({ v: TASKS_WEEK_FORMAT - 1, ...stored }))).toEqual(NO_SPEND)
    expect(spendIn(JSON.stringify({ v: TASKS_WEEK_FORMAT + 1, ...stored }))).toEqual(NO_SPEND)
    expect(spendIn(JSON.stringify({ v: TASKS_WEEK_FORMAT, ...stored, spentPct: { T1: 'much' } }))).toEqual(NO_SPEND)
  })
})

describe('spendFor', () => {
  test('keeps the spend of the tasks it names and every median: an unsized task of any kind is sized by them', async () => {
    const spend = { spentPct: { T1: 0.4, T2: 1, T9: 3 }, likeMedians: LIKE_MEDIANS }
    expect(spendFor(spend, ['T1', 'T2', 'T5'])).toEqual({ spentPct: { T1: 0.4, T2: 1 }, likeMedians: LIKE_MEDIANS })
    expect(spendFor(spend, [])).toEqual({ spentPct: {}, likeMedians: LIKE_MEDIANS })
  })
})
