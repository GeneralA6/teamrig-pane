import { describe, expect, test } from 'claude-code/testing'
import type { Snapshot, TaskRow } from '../types'
import { priorityText, readMarks, readRegister, showStored, waitsText, type TaskTree } from '../hooks/core/read/index'
import { rowOf } from '../hooks/log'
import { rankWords, treeOf, whenWords, type PaneTree } from '../hooks/meta'
import { findPlaces } from '../hooks/places'
import { paneBlocks, type Block } from '../hooks/rows'
import { registerPaths, skippedText, TaskRegisterSource } from '../hooks/source'
import { TreeGoals } from '../hooks/tree-goals'
import { clockOf } from '../hooks/zone'
import {
  clockAt,
  GOLDEN_CLOCK_VARIABLE,
  GOLDEN_ROOT,
  GOLDEN_SESSION,
  GOLDEN_START,
  GOLDEN_TIME_ZONE,
  fixedDate,
  GoldenClock,
  goldenModule,
  realClockReads,
  underGoldenRoot,
  type GoldenRegister,
} from '../scripts/golden-format'
import { MemoryFiles } from './fixtures'
import { GOLDEN } from './golden-register'

// The pane against what the real teamrig CLI wrote and printed at the pinned commit (scripts/golden.ts).

const KIT = `${GOLDEN_ROOT}/kit`
const STATE = 'kit/teams/demo/state'
const PATHS = registerPaths({ tasksDir: `${KIT}/teams/demo/state`, inboxDir: `${KIT}/teams/demo/state/inbox` })

/**
 * A row in the words of `teamrig list --all` (formatTask, src/register/views.ts): each fact it prints, from the pane's
 * row and the tree of the rows read with it, each stored time in the tree's zone (showStored): a due a task takes from a task that needs it reads `due 10-20 (from T4)`,
 * and an active task another session's task needs ends `· needed by T8 (beta, due 10-22)` (neededByText), the due
 * left out when the row's own `(from T8)` names it.
 */
function listLine(row: TaskRow, tree: PaneTree): string {
  const rank = rankWords(row, tree)
  const ranked = rank === null ? [] : [rank.workClass, ...(rank.score === null ? [] : [`score ${rank.score}`])]
  const parts = [`${row.id} ${row.status}`, ...ranked, priorityText(row.priority), `owner ${row.owner}`]
  const due = tree.effectiveDue(row.id)
  if (due !== undefined && due.from !== null) parts.push(`due ${showStored(due.due, tree.zone)} (from ${due.from})`)
  else if (row.due !== null) parts.push(`due ${showStored(row.due, tree.zone)}`)
  if (row.after.length > 0) parts.push(`after ${row.after.join(',')}`)
  if (row.week !== null) parts.push(`week ${showStored(row.week, tree.zone)}`)
  parts.push(`from ${row.source}`)
  if (row.goals.length > 0) parts.push(`goals ${row.goals.join(',')}`)
  const said = row.status === 'waiting' ? [row.waits.length > 0 ? waitsText(row.waits, tree.zone, tree.context) : null, row.note].filter(part => part !== null) : []
  const waiting = said.length > 0 ? ` (waiting: ${said.join('; ')})` : ''
  return `${parts.join(', ')} | ${row.title}${waiting}${neededBy(row, tree)}`
}

/** ` · needed by T8 (beta, due 10-22) +1`, as listLine's row ends; empty when no other session's task needs it. */
function neededBy(row: TaskRow, tree: TaskTree<TaskRow>): string {
  const [first, ...rest] = tree.neededByOthers(row.id)
  if (first === undefined) return ''
  const due = tree.effectiveDue(first.id)
  const shown = due !== undefined && tree.effectiveDue(row.id)?.from === (due.from ?? first.id)
  const facts = due === undefined || shown ? [first.owner] : [first.owner, `due ${showStored(due.due, tree.zone)}`]
  return ` · needed by ${first.id} (${facts.join(', ')})${rest.length > 0 ? ` +${rest.length}` : ''}`
}

/**
 * The task lines teamrig printed, sorted as the test sorts the pane's. Each loses the ` · ahead: due` tail (aheadText):
 * why the row sorts before the next in teamrig's plan order, a fact of the list's order, not of the task, which the
 * pane never draws.
 */
const linesOf = (printed: string) =>
  printed
    .split('\n')
    .filter(line => line !== '')
    .map(line => line.replace(/ · ahead: [^·]*$/, ''))
    .sort()

/** teamrig's WARN line as the pane words it, the file named by its name alone; '' when teamrig printed none. */
const warnOf = (printed: string) => printed.trim().replace(/^WARN .*[\\/](events\.jsonl: )/, 'WARN $1')

/** The unread count `teamrig inbox status` printed for the area; null when it printed none. */
function unreadIn(status: string): number | null {
  const count = /^\S+ (\d+) unread/.exec(status)?.[1]
  return count === undefined ? null : Number(count)
}

/** The words of the drawn row under `key`, its spans joined. */
function rowText(blocks: readonly Block[], key: string): string | undefined {
  return blocks
    .flatMap(block => block.rows)
    .find(row => row.key === key)
    ?.spans.map(span => span.text)
    .join('')
}

/** The golden files under GOLDEN_ROOT, with `changes` (by path under it) laid over them. */
function goldenFiles(changes: Record<string, string> = {}): MemoryFiles {
  const files = new MemoryFiles()
  for (const [path, text] of Object.entries({ ...GOLDEN.files, ...changes })) files.write(`${GOLDEN_ROOT}/${path}`, text)
  return files
}

/** The pane's first snapshot, the register found as the pane finds it: the project's pointer file, then the team config. */
async function paneSnapshot(files: MemoryFiles): Promise<Snapshot> {
  // The machine's zone is UTC: the team config's, as teamrig read it, must win over it. The project's pointer names its
  // team, so the kit home's teams are never listed.
  const places = await findPlaces({
    env: { TEAMRIG_HOME: KIT },
    files,
    folders: async () => [],
    home: null,
    cwd: `${GOLDEN_ROOT}/proj`,
    machineZone: 'UTC',
  })
  if (places.kind !== 'found') throw new Error(places.kind === 'problem' ? places.problem : 'no team found')
  const paths = registerPaths(places.dirs)
  const snap = await new TaskRegisterSource(files, paths, places.settings, places.team, new TreeGoals(files, paths.goals, places.team)).poll({
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
    expect(snap.timeZone).toBe(GOLDEN_TIME_ZONE)
    // The lead's T1 that team create opens, and alpha's and beta's seven.
    expect(linesOf(GOLDEN.list).length).toBe(8)
    const tree = treeOf(snap)
    expect(snap.tasks.map(row => listLine(row, tree)).sort()).toEqual(linesOf(GOLDEN.list))
    // teamrig printed them in plan order: fed the same rows, the pane's tree must rank them the same.
    const printed = GOLDEN.list.split('\n').filter(line => line !== '').map(line => line.split(' ')[0])
    expect(tree.inPlanOrder(snap.tasks).map(row => row.id)).toEqual(printed)
    expect(`WARN ${snap.problem}`).toBe(warnOf(GOLDEN.warn))
  })

  test('keeps what list does not print: a ref cleared or never given, the evidence', async () => {
    const tasks = new Map((await paneSnapshot(goldenFiles())).tasks.map(task => [task.id, task]))
    expect([tasks.get('T2')?.ref, tasks.get('T3')?.ref, tasks.get('T4')?.ref]).toEqual([null, null, 'doc:1'])
    expect(tasks.get('T5')?.evidence).toBe('sha abc')
  })

  test('draws its rows from what teamrig wrote: a waiting task\'s typed reasons and note, an open one\'s unfinished after', async () => {
    const snap = await paneSnapshot(goldenFiles())
    const blocks = paneBlocks(snap, 'mine')
    // Since when T2 works and T3 waits is the moment the capture ran.
    const since = (id: string) => whenWords(snap.tasks.find(task => task.id === id)?.statusAt ?? '', clockOf(snap))
    expect(rowText(blocks, 'working:T2')).toBe('◐ T2  First task with ref')
    // T4 comes after T2, so T2 works to T4's date, as teamrig's list says it; beta's T8 needs it too, by a later date.
    expect(rowText(blocks, 'working-meta:T2')).toBe(`      Improvements · score 5 · p1 · due Tue 10-20 (from T4) · in progress since ${since('T2')} · needed by T8 (beta, due Thu 10-22)`)
    expect(rowText(blocks, 'waiting-meta:T3')).toBe(`      Improvements · score 3.33 · p2 · waiting since ${since('T3')}: decision owner, until Wed 01-09 12:00 IST; waiting on beta`)
    expect(rowText(blocks, 'next:T4')).toBe('○ T4  Goals task renamed')
    expect(rowText(blocks, 'next-meta:T4')).toBe('      Improvements · score 3.33 · p1 · due Tue 10-20 · after T2 · asked by lead')
  })

  test('finds the session area from the mark teamrig inbox read wrote for the session', async () => {
    const snap = await paneSnapshot(goldenFiles())
    expect([snap.area, snap.areaSource]).toEqual(['alpha', 'inbox-read'])
    // The config names no session, so alpha has the team's default name, as teamrig's Roster gives it.
    expect([snap.team, snap.areaName]).toEqual(['demo', 'demo-alpha'])
  })

  test('counts unread inbox lines as teamrig inbox status does: after a read, a trim from the top and a rewrite', async () => {
    expect(GOLDEN.inbox.map(state => unreadIn(state.status))).toEqual([1, 1, 2])
    for (const state of GOLDEN.inbox) {
      const snap = await paneSnapshot(goldenFiles({ [`${STATE}/inbox/alpha.md`]: state.inbox, [`${STATE}/inbox-marks.jsonl`]: state.marks }))
      expect({ state: state.label, unread: snap.unreadInbox }).toEqual({ state: state.label, unread: unreadIn(state.status) })
    }
  })

  test("reads teamrig's own register fixtures as teamrig lists them, with the lines it skips counted alike", async () => {
    expect(GOLDEN.fixtures.map(fixture => fixture.name)).toEqual(['events-v0.jsonl', 'events-v1.jsonl', 'events-v2.jsonl'])
    // teamrig listed each with the demo team's config, so its settings, zone and leads.
    const { notPickedUpAfterHours, timeZone, leads, focus, ownerSource, goals } = await paneSnapshot(goldenFiles())
    for (const fixture of GOLDEN.fixtures) {
      const register = readRegister(fixture.events)
      const rows = [...register.state.tasks.values()].map(task => rowOf(task))
      const tree = treeOf({ tasks: rows, now: GOLDEN.generatedAt, notPickedUpAfterHours, timeZone, leads, focus, ownerSource, goals })
      const lines = rows.map(row => listLine(row, tree)).sort()
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

  test('gives each CLI run the next fixed instant, a minute apart from the same start on every capture', () => {
    const clock = new GoldenClock()
    expect([clock.next(), clock.next(), clock.next()]).toEqual([GOLDEN_START, GOLDEN_START + 60_000, GOLDEN_START + 120_000])
    expect(new GoldenClock().next()).toBe(GOLDEN_START)
  })

  test("reads a run's fixed instant from its variable, and refuses one missing or not a whole ms", () => {
    expect(clockAt('1792235559957')).toBe(1792235559957)
    for (const value of [undefined, '', ' ', 'soon', '1.5', '1e400']) expect(() => clockAt(value)).toThrow(GOLDEN_CLOCK_VARIABLE)
  })

  test("fixes a run's Date clock however teamrig reads it, and leaves a Date of a given instant or fields as it is", () => {
    const realNow = Date.now
    const FixedDate = fixedDate(GOLDEN_START, Date)
    expect(FixedDate.now()).toBe(GOLDEN_START)
    expect(new FixedDate().getTime()).toBe(GOLDEN_START)
    expect(FixedDate()).toBe(new Date(GOLDEN_START).toString())
    expect([new FixedDate() instanceof Date, new Date(0) instanceof FixedDate]).toEqual([true, true])
    expect(new FixedDate(0).getTime()).toBe(0)
    expect(new FixedDate('2030-01-09T10:00:00Z').getTime()).toBe(Date.UTC(2030, 0, 9, 10))
    expect(new FixedDate(2030, 0, 9).getFullYear()).toBe(2030)
    expect(FixedDate.UTC(2030, 0, 9)).toBe(Date.UTC(2030, 0, 9))
    // The Date it wraps keeps the real clock.
    expect(Date.now).toBe(realNow)
  })

  test('names the lines of teamrig source that read a timer clock, which the Date one does not fix', () => {
    expect(realClockReads('const at = Date.now()\nconst d = new Date()\nconst s = Date()\nconst e = x.toDate()')).toEqual([])
    expect(realClockReads('a\nconst t = performance.now()\nprocess.hrtime.bigint()')).toEqual([2, 3])
  })
})
