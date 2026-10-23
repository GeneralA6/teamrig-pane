// The pane on a rotated register: it folds the snapshot, the segments it does not cover and the tail,
// exactly as teamrig's working-set read does, and reads a segment only when the snapshot cannot be used.
import { describe, expect, test } from 'claude-code/testing'
import type { JsonRecord } from '../hooks/core/core/guards'
import { toJsonlLine } from '../hooks/core/core/jsonl'
import { layoutPaths, readWorkingSet, type LayoutFiles, type SnapshotHeader } from '../hooks/core/read/index'
import { snapshotHeaderRecord } from '../hooks/core/register/layout'
import { markerRecord } from '../hooks/core/register/marker'
import { MAX_READ_BYTES, TaskRegisterSource, type RegisterPaths } from '../hooks/source'
import { HOUR, MemoryFiles, NOW, S1, TEAM_SETTINGS, createLine, iso, statusLine } from './fixtures'

const DAY = 24 * HOUR
const PATHS: RegisterPaths = { events: 'R/tasks/events.jsonl', marks: 'R/tasks/inbox-marks.jsonl', inboxDir: 'R/inbox' }
const LAYOUT = layoutPaths(PATHS.events)
const SEGMENT = LAYOUT.segment(1)

const lines = (...texts: string[]) => texts.map(text => `${text}\n`).join('')

/** T1 finished a month ago (a compaction retires it), T2 open, T3 done within the day. */
const T1_CREATE = createLine('T1', { owner: 'po', by: 'po', at: NOW - 40 * DAY })
const T1_DONE = statusLine('T1', 'po', NOW - 30 * DAY, 'done', 'shipped', 'abc1234', 'none')
const T2_CREATE = createLine('T2', { owner: 'po', by: 'po', at: NOW - 20 * DAY })
const T3_CREATE = createLine('T3', { owner: 'po', by: 'po', at: NOW - 2 * DAY })
const T3_DONE = statusLine('T3', 'po', NOW - HOUR, 'done', 'shipped', 'abc1234', 'none')
const T2_STARTED = statusLine('T2', 'po', NOW - HOUR, 'in-progress')

function header(changes: Partial<SnapshotHeader> = {}): SnapshotHeader {
  return {
    covered: 1,
    events: 1,
    nextId: 'T3',
    orphans: 0,
    unreadable: 0,
    newer: 0,
    newestVersion: 2,
    retired: 1,
    retiredLastWeek: '2026-10-13',
    at: iso(NOW - 10 * DAY),
    ...changes,
  }
}

/**
 * The files a rotation leaves: segment 1 holds the first three lines, the snapshot keeps T2 (T1 is
 * retired), and the tail starts with the marker naming segment 1, then T3's lines.
 */
function rotated(snapshot: string | null = toJsonlLine(snapshotHeaderRecord(header())) + lines(T2_CREATE)): MemoryFiles {
  const files = new MemoryFiles()
  files.write(SEGMENT, lines(T1_CREATE, T1_DONE, T2_CREATE))
  if (snapshot !== null) files.write(LAYOUT.snapshot, snapshot)
  files.write(PATHS.events, toJsonlLine(markerRecord(1, iso(NOW - 10 * DAY))) + lines(T3_CREATE, T3_DONE))
  return files
}

/** A snapshot torn in its header line. */
const DAMAGED = '{"v":3,"type":"snapshot"\n'

/** teamrig's own working-set read of the files: given a copy, so the pane's read counts stay its own. */
function teamrigRead(files: MemoryFiles) {
  const layoutFiles: LayoutFiles = {
    read: async path => ((await files.stamp(path)) === null ? undefined : files.read(path)),
  }
  return readWorkingSet(layoutFiles, LAYOUT)
}

const poll = (source: TaskRegisterSource) => source.poll({ claudeSession: S1, pinned: 'po', now: NOW })

/** The rejection's message, or 'resolved'. */
const failureOf = (answer: Promise<unknown>) =>
  answer.then(
    () => 'resolved',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  )

describe('a rotated register', () => {
  test("folds the snapshot then the tail as teamrig's working-set read does, reading the snapshot first and no segment", async () => {
    const files = rotated()
    const snap = await poll(new TaskRegisterSource(files, PATHS, TEAM_SETTINGS, null))
    const register = await teamrigRead(rotated())
    expect([...register.state.tasks.keys()]).toEqual(['T2', 'T3'])
    expect(snap?.tasks.map(task => [task.id, task.status])).toEqual([
      ['T2', 'open'],
      ['T3', 'done'],
    ])
    expect(snap?.problem).toBe(null)
    expect(files.reads).toEqual([LAYOUT.snapshot, PATHS.events])
  })

  test('an append to the tail re-reads the tail alone', async () => {
    const files = rotated()
    const source = new TaskRegisterSource(files, PATHS, TEAM_SETTINGS, null)
    await poll(source)
    const before = files.reads.length
    files.write(PATHS.events, toJsonlLine(markerRecord(1, iso(NOW - 10 * DAY))) + lines(T3_CREATE, T3_DONE, T2_STARTED))
    const snap = await poll(source)
    expect(snap?.tasks.find(task => task.id === 'T2')?.status).toBe('in-progress')
    expect(files.reads.slice(before)).toEqual([PATHS.events])
  })

  test('a snapshot it cannot use is counted as teamrig counts it, and the segments are folded instead, each read once', async () => {
    const files = rotated(DAMAGED)
    const source = new TaskRegisterSource(files, PATHS, TEAM_SETTINGS, null)
    const snap = await poll(source)
    const register = await teamrigRead(rotated(DAMAGED))
    expect(snap?.tasks.map(task => task.id)).toEqual(['T2', 'T3'])
    expect([register.read.unreadable, register.state.tasks.size]).toEqual([1, 3])
    expect(snap?.problem).toBe('events.jsonl: 1 unreadable line(s), 0 line(s) from a newer teamrig, 0 event(s) naming no task')
    files.write(PATHS.events, toJsonlLine(markerRecord(1, iso(NOW - 10 * DAY))) + lines(T3_CREATE, T3_DONE, T2_STARTED))
    expect((await poll(source))?.tasks.find(task => task.id === 'T2')?.status).toBe('in-progress')
    expect(files.reads.filter(path => path === SEGMENT).length).toBe(1)
  })

  test('a snapshot from a newer teamrig is counted as a newer line, and the history read instead', async () => {
    const files = rotated(`${JSON.stringify({ v: 9, type: 'snapshot' })}\n`)
    const snap = await poll(new TaskRegisterSource(files, PATHS, TEAM_SETTINGS, null))
    expect(snap?.tasks.map(task => task.id)).toEqual(['T2', 'T3'])
    expect(snap?.problem).toBe('events.jsonl: 0 unreadable line(s), 1 line(s) from a newer teamrig, 0 event(s) naming no task')
  })

  test('a register a writer laid out at layout 4 folds as one at layout 3: the snapshot and the tail, no problem and no segment read (T1034)', async () => {
    // Layout 4 holds layout 3's records under a higher version, so a teamrig that reads 3 at most leaves the files
    // alone (teamrig T971); the pane reads both.
    const atLayout4 = (record: JsonRecord): JsonRecord => ({ ...record, v: 4 })
    const files = new MemoryFiles()
    files.write(SEGMENT, lines(T1_CREATE, T1_DONE, T2_CREATE))
    files.write(LAYOUT.snapshot, toJsonlLine(atLayout4(snapshotHeaderRecord(header()))) + lines(T2_CREATE))
    files.write(PATHS.events, toJsonlLine(atLayout4(markerRecord(1, iso(NOW - 10 * DAY)))) + lines(T3_CREATE, T3_DONE))
    const snap = await poll(new TaskRegisterSource(files, PATHS, TEAM_SETTINGS, null))
    expect(snap?.tasks.map(task => [task.id, task.status])).toEqual([
      ['T2', 'open'],
      ['T3', 'done'],
    ])
    expect(snap?.problem).toBe(null)
    expect(files.reads).toEqual([LAYOUT.snapshot, PATHS.events])
  })

  test('a missing segment is named and fails the poll; the next poll retries though no file moved', async () => {
    const files = new MemoryFiles()
    const tail = toJsonlLine(markerRecord(1, iso(NOW - 10 * DAY))) + lines(T3_CREATE)
    files.write(PATHS.events, tail)
    const source = new TaskRegisterSource(files, PATHS, TEAM_SETTINGS, null)
    expect(await failureOf(poll(source))).toBe(`${SEGMENT} is missing: the register's archive is incomplete, so its tasks cannot be read`)
    files.write(SEGMENT, lines(T1_CREATE, T2_CREATE))
    expect((await poll(source))?.tasks.map(task => task.id)).toEqual(['T1', 'T2', 'T3'])
    expect(await poll(source)).toBe(null)
  })

  test('a segment over the 4 MiB one read allows is named with its size and never read', async () => {
    const files = rotated(null)
    files.write(SEGMENT, ' '.repeat(MAX_READ_BYTES + 2 ** 19))
    expect(await failureOf(poll(new TaskRegisterSource(files, PATHS, TEAM_SETTINGS, null)))).toBe(
      'events-000001.jsonl is 4.50 MiB, over the 4 MiB a pane can read at once: it needs rotating',
    )
    expect(files.reads.includes(SEGMENT)).toBe(false)
  })

  test('a register never rotated is its tail alone, with no snapshot or segment read', async () => {
    const files = new MemoryFiles()
    files.write(PATHS.events, lines(T1_CREATE, T1_DONE, T2_CREATE))
    const snap = await poll(new TaskRegisterSource(files, PATHS, TEAM_SETTINGS, null))
    expect(snap?.tasks.map(task => task.id)).toEqual(['T2'])
    expect(files.reads).toEqual([PATHS.events])
  })
})
