import { describe, expect, test } from 'claude-code/testing'
import type { Snapshot, TaskRow } from '../types'
import { priorityText, readMarks, readRegister } from '../hooks/core/read/index'
import { rowOf } from '../hooks/log'
import { findPlaces } from '../hooks/places'
import { registerPaths, skippedText, TaskRegisterSource } from '../hooks/source'
import { GOLDEN_ROOT, GOLDEN_SESSION, goldenModule, underGoldenRoot, type GoldenRegister } from '../scripts/golden-format'
import { MemoryFiles } from './fixtures'
import { GOLDEN } from './golden-register'

// The pane against what the real teamrig CLI wrote and printed at the pinned commit (scripts/golden.ts).

const KIT = `${GOLDEN_ROOT}/kit`
const STATE = 'kit/teams/demo/state'
const PATHS = registerPaths({ tasksDir: `${KIT}/teams/demo/state`, inboxDir: `${KIT}/teams/demo/state/inbox` })

/** `MM-DD` or `MM-DD HH:MM`, as teamrig's shortUtc shortens a date. */
const shortUtc = (text: string) => text.slice(5).replace('T', ' ')

/** A row in the words of `teamrig list` (formatTask, src/register/views.ts): each fact it prints, from the pane's row. */
function listLine(row: TaskRow): string {
  const parts = [`${row.id} ${row.status}`, priorityText(row.priority), `owner ${row.owner}`]
  if (row.due !== null) parts.push(`due ${shortUtc(row.due)}`)
  if (row.week !== null) parts.push(`week ${shortUtc(row.week)}`)
  parts.push(`from ${row.source}`)
  if (row.goals.length > 0) parts.push(`goals ${row.goals.join(',')}`)
  const blocked = row.status === 'blocked' && row.note !== null ? ` (blocked: ${row.note})` : ''
  return `${parts.join(', ')} | ${row.title}${blocked}`
}

/** The task lines teamrig printed, sorted as the test sorts the pane's. */
const linesOf = (printed: string) => printed.split('\n').filter(line => line !== '').sort()

/** teamrig's WARN line as the pane words it, the file named by its name alone; '' when teamrig printed none. */
const warnOf = (printed: string) => printed.trim().replace(/^WARN .*[\\/](events\.jsonl: )/, 'WARN $1')

/** The unread count `teamrig inbox status` printed for the area; null when it printed none. */
function unreadIn(status: string): number | null {
  const count = /^\S+ (\d+) unread/.exec(status)?.[1]
  return count === undefined ? null : Number(count)
}

/** The golden files under GOLDEN_ROOT, with `changes` (by path under it) laid over them. */
function goldenFiles(changes: Record<string, string> = {}): MemoryFiles {
  const files = new MemoryFiles()
  for (const [path, text] of Object.entries({ ...GOLDEN.files, ...changes })) files.write(`${GOLDEN_ROOT}/${path}`, text)
  return files
}

/** The pane's first snapshot, the register found as the pane finds it: the project's pointer file, then the team config. */
async function paneSnapshot(files: MemoryFiles): Promise<Snapshot> {
  const places = await findPlaces({ env: { TEAMRIG_HOME: KIT }, files, home: null, cwd: `${GOLDEN_ROOT}/proj` })
  if (!places.found) throw new Error(places.problem)
  const snap = await new TaskRegisterSource(files, registerPaths(places.dirs), places.priorities).poll({
    claudeSession: GOLDEN_SESSION,
    pinned: null,
    now: GOLDEN.generatedAt,
  })
  if (snap === null) throw new Error('the first poll drew nothing')
  return snap
}

describe('golden', () => {
  test('draws every task teamrig lists, field for field, and counts the lines it skips as its WARN line does', async () => {
    const snap = await paneSnapshot(goldenFiles())
    expect(linesOf(GOLDEN.list).length).toBe(6)
    expect(snap.tasks.map(listLine).sort()).toEqual(linesOf(GOLDEN.list))
    expect(`WARN ${snap.problem}`).toBe(warnOf(GOLDEN.warn))
  })

  test('keeps what list does not print: a ref cleared or never given, the evidence, a priority named by the team config', async () => {
    const tasks = new Map((await paneSnapshot(goldenFiles())).tasks.map(task => [task.id, task]))
    expect([tasks.get('T1')?.ref, tasks.get('T2')?.ref, tasks.get('T3')?.ref]).toEqual([null, null, 'doc:1'])
    expect(tasks.get('T4')?.evidence).toBe('sha abc')
    expect(tasks.get('T2')?.priorityName).toBe('correctness')
    expect(tasks.get('T6')?.priorityName).toBe('icebox')
  })

  test('finds the session area from the mark teamrig inbox read wrote for the session', async () => {
    const snap = await paneSnapshot(goldenFiles())
    expect([snap.area, snap.areaSource]).toEqual(['alpha', 'inbox-read'])
  })

  test('counts unread inbox lines as teamrig inbox status does: after a read, a trim from the top and a rewrite', async () => {
    expect(GOLDEN.inbox.map(state => unreadIn(state.status))).toEqual([1, 1, 2])
    for (const state of GOLDEN.inbox) {
      const snap = await paneSnapshot(goldenFiles({ [`${STATE}/inbox/alpha.md`]: state.inbox, [`${STATE}/inbox-marks.jsonl`]: state.marks }))
      expect({ state: state.label, unread: snap.unreadInbox }).toEqual({ state: state.label, unread: unreadIn(state.status) })
    }
  })

  test("reads teamrig's own register fixtures as teamrig lists them, with the lines it skips counted alike", () => {
    expect(GOLDEN.fixtures.map(fixture => fixture.name)).toEqual(['events-v0.jsonl', 'events-v1.jsonl', 'events-v2.jsonl'])
    for (const fixture of GOLDEN.fixtures) {
      const register = readRegister(fixture.events)
      const lines = [...register.state.tasks.values()].map(task => listLine(rowOf(task, []))).sort()
      expect({ fixture: fixture.name, lines }).toEqual({ fixture: fixture.name, lines: linesOf(fixture.list) })
      const skipped = skippedText(PATHS, register, readMarks(''))
      expect({ fixture: fixture.name, warn: skipped === null ? '' : `WARN ${skipped}` }).toEqual({ fixture: fixture.name, warn: warnOf(fixture.warn) })
    }
  })
})

describe('golden capture', () => {
  test('moves the scratch folder, spelled with either slash, under the golden root', () => {
    const root = 'C:\\Temp\\teamrig-golden-x'
    expect(underGoldenRoot('WARN C:\\Temp\\teamrig-golden-x\\kit\\a.jsonl; C:/Temp/teamrig-golden-x/proj', root)).toBe(
      `WARN ${GOLDEN_ROOT}\\kit\\a.jsonl; ${GOLDEN_ROOT}/proj`,
    )
  })

  test('writes the capture as one typed constant under a header naming the teamrig commit', () => {
    const golden: GoldenRegister = { pin: 'a'.repeat(40), generatedAt: 1, files: { 'proj/.teamrig.json': '{}\n' }, list: '', warn: '', inbox: [], fixtures: [] }
    const text = goldenModule(golden)
    expect(text.split('\n')[0]).toBe(`// Written by scripts/golden.ts from teamrig ${'a'.repeat(40)}: rerun it after a sync, never edit it by hand.`)
    expect(text).toContain(`export const GOLDEN: GoldenRegister = ${JSON.stringify(golden, null, 2)}\n`)
  })
})
