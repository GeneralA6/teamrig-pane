// A register's whole history for the Stats tab (hooks/register-history.ts): every archive segment, then the tail, in
// write order; the tail re-read only when its stamp moves, each segment once; a failed read retried on the next refresh.
import { describe, expect, test } from 'claude-code/testing'
import { toJsonlLine } from '../hooks/core/core/jsonl'
import { layoutPaths, readEvents } from '../hooks/core/read/index'
import { markerRecord } from '../hooks/core/register/marker'
import { RegisterHistory } from '../hooks/register-history'
import { HOUR, MemoryFiles, NOW, createLine, iso, statusLine } from './fixtures'

const DAY = 24 * HOUR
const EVENTS = 'R/tasks/events.jsonl'
const LAYOUT = layoutPaths(EVENTS)

const lines = (...texts: string[]) => texts.map(text => `${text}\n`).join('')
/** A tail a rotation left: its marker naming the last segment, then `texts`. */
const tailAfter = (segment: number, ...texts: string[]) => toJsonlLine(markerRecord(segment, iso(NOW - 10 * DAY))) + lines(...texts)

const T1_CREATE = createLine('T1', { owner: 'po', by: 'po', at: NOW - 40 * DAY })
const T1_DONE = statusLine('T1', 'po', NOW - 30 * DAY, 'done', 'shipped', 'abc1234', 'none')
const T2_CREATE = createLine('T2', { owner: 'po', by: 'po', at: NOW - 20 * DAY })
const T2_STARTED = statusLine('T2', 'po', NOW - 2 * DAY, 'in-progress')
const T3_CREATE = createLine('T3', { owner: 'po', by: 'po', at: NOW - HOUR })

/** The events teamrig parses from `texts`, in order. */
const parsed = (...texts: string[]) => readEvents(lines(...texts)).events

/** The message `run` rejects with, or 'resolved'. */
const failureOf = (answer: Promise<unknown>) =>
  answer.then(
    () => 'resolved',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  )

describe('RegisterHistory', () => {
  test('a register never rotated is its tail; a refresh with nothing moved reads nothing, an append re-reads the tail and moves the version', async () => {
    const files = new MemoryFiles()
    files.write(EVENTS, lines(T1_CREATE, T1_DONE))
    const history = new RegisterHistory(files, EVENTS)
    expect([history.events, history.version]).toEqual([[], 0])

    expect(await history.refresh()).toBe(true)
    expect([history.events, history.version]).toEqual([parsed(T1_CREATE, T1_DONE), 1])
    files.reads.length = 0
    expect(await history.refresh()).toBe(false)
    expect([files.reads, history.version]).toEqual([[], 1])

    files.write(EVENTS, lines(T1_CREATE, T1_DONE, T2_CREATE))
    expect(await history.refresh()).toBe(true)
    expect([history.events, history.version, files.reads]).toEqual([parsed(T1_CREATE, T1_DONE, T2_CREATE), 2, [EVENTS]])
  })

  test('a rotated register is every segment the tail names, then the tail, the snapshot never read; each segment read once, a new one alone after a rotation', async () => {
    const files = new MemoryFiles()
    files.write(LAYOUT.segment(1), lines(T1_CREATE, T1_DONE))
    files.write(LAYOUT.snapshot, 'never read')
    files.write(EVENTS, tailAfter(1, T2_CREATE))
    const history = new RegisterHistory(files, EVENTS)
    await history.refresh()
    expect(history.events).toEqual(parsed(T1_CREATE, T1_DONE, T2_CREATE))
    expect(files.reads).toEqual([EVENTS, LAYOUT.segment(1)])

    files.reads.length = 0
    files.write(EVENTS, tailAfter(1, T2_CREATE, T2_STARTED))
    await history.refresh()
    expect(files.reads).toEqual([EVENTS])

    files.write(LAYOUT.segment(2), lines(T2_CREATE, T2_STARTED))
    files.write(EVENTS, tailAfter(2, T3_CREATE))
    files.reads.length = 0
    await history.refresh()
    expect(history.events).toEqual(parsed(T1_CREATE, T1_DONE, T2_CREATE, T2_STARTED, T3_CREATE))
    expect(files.reads).toEqual([EVENTS, LAYOUT.segment(2)])
  })

  test('a missing segment fails the refresh and keeps the last history; the next refresh tries again though no file moved', async () => {
    const files = new MemoryFiles()
    files.write(EVENTS, lines(T1_CREATE))
    const history = new RegisterHistory(files, EVENTS)
    await history.refresh()
    files.write(EVENTS, tailAfter(1, T2_CREATE))
    expect(await failureOf(history.refresh())).toBe(`${LAYOUT.segment(1)} is missing: the register's archive is incomplete, so its tasks cannot be read`)
    expect([history.events, history.version]).toEqual([parsed(T1_CREATE), 1])

    files.write(LAYOUT.segment(1), lines(T1_CREATE, T1_DONE))
    expect(await history.refresh()).toBe(true)
    expect([history.events, history.version]).toEqual([parsed(T1_CREATE, T1_DONE, T2_CREATE), 2])
  })
})
