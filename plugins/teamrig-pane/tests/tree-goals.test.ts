import { describe, expect, test } from 'claude-code/testing'
import type { Snapshot } from '../types'
import type { TeamFiles } from '../hooks/places'
import { TaskRegisterSource, type RegisterPaths } from '../hooks/source'
import { TreeGoals } from '../hooks/tree-goals'
import { HOUR, MemoryFiles, NOW, S1, TEAM_SETTINGS, createLine, goalLine, goalRankLine, goalTitleLine, waitingLine, type CardFields } from './fixtures'

const PATHS: RegisterPaths = { events: 'R/tasks/events.jsonl', marks: 'R/tasks/inbox-marks.jsonl', goals: 'R/tasks/goals.jsonl', inboxDir: 'R/inbox', tasksWeek: 'R/tasks/usage/tasks.week.json' }
const WEB: TeamFiles = { team: 'web', dir: 'K/teams/web', teamsDir: 'K/teams', config: 'K/teams/web/config.json', renames: 'R/tasks/renames.jsonl', turnLog: null }
const ACME_GOALS = 'K/teams/acme/state/goals.jsonl'
const MID_GOALS = 'K/teams/mid/state/goals.jsonl'

/** A team's config text: its id, the team above it and where its state folder sits, when it names them. */
function configOf(id: string, parent: string | null = null, state: string | null = null): string {
  return JSON.stringify({
    team: { id, ...(parent === null ? {} : { parent }) },
    sessions: ['lead', 'api'],
    roles: { lead: 'lead' },
    ...(state === null ? {} : { paths: { state } }),
  })
}

const configPath = (team: string) => `K/teams/${team}/config.json`

/** One goal per tag in a goals file, ranked as given, or with no rank when given null. */
function goalsText(ranks: Readonly<Record<string, number | null>>): string {
  return Object.entries(ranks)
    .flatMap(([tag, rank]) => [goalLine(tag), ...(rank === null ? [] : [goalRankLine(tag, rank)])])
    .join('\n')
}

/** A disk with web under acme, each team's goals as given. */
function webUnderAcme(own: string, acme: string): MemoryFiles {
  const files = new MemoryFiles()
  files.write(WEB.config, configOf('web', 'acme'))
  files.write(configPath('acme'), configOf('acme'))
  files.write(PATHS.goals, own)
  files.write(ACME_GOALS, acme)
  return files
}

describe('TreeGoals', () => {
  test("reads the team's own goals: each tag's parent and rank, a goal with no rank as null", async () => {
    const files = new MemoryFiles()
    files.write(WEB.config, configOf('web'))
    files.write(PATHS.goals, [goalLine('A1'), goalRankLine('A1', 1), goalLine('A2', 'A1')].join('\n'))
    const goals = new TreeGoals(files, PATHS.goals, WEB)
    expect(await goals.refresh()).toBe(true)
    expect(goals.current).toEqual({ A1: { parent: null, rank: 1 }, A2: { parent: 'A1', rank: null } })
  })

  test('reads the goals of every team above, up to the root, and of no team beside it', async () => {
    const files = new MemoryFiles()
    files.write(WEB.config, configOf('web', 'mid'))
    files.write(configPath('mid'), configOf('mid', 'acme'))
    files.write(configPath('acme'), configOf('acme'))
    files.write(configPath('side'), configOf('side', 'acme'))
    files.write(PATHS.goals, goalsText({ A1: 1 }))
    files.write(MID_GOALS, goalsText({ A2: 2 }))
    files.write(ACME_GOALS, goalsText({ A3: 3 }))
    files.write('K/teams/side/state/goals.jsonl', goalsText({ A4: 4 }))
    const goals = new TreeGoals(files, PATHS.goals, WEB)
    await goals.refresh()
    expect(goals.current).toEqual({ A1: { parent: null, rank: 1 }, A2: { parent: null, rank: 2 }, A3: { parent: null, rank: 3 } })
  })

  test("a tag two teams hold reads as the nearest team's", async () => {
    const files = new MemoryFiles()
    files.write(WEB.config, configOf('web', 'mid'))
    files.write(configPath('mid'), configOf('mid', 'acme'))
    files.write(configPath('acme'), configOf('acme'))
    files.write(PATHS.goals, goalsText({ A1: 1 }))
    files.write(MID_GOALS, goalsText({ A1: 2, A2: 2 }))
    files.write(ACME_GOALS, goalsText({ A1: 3, A2: 3 }))
    const goals = new TreeGoals(files, PATHS.goals, WEB)
    await goals.refresh()
    expect(goals.current).toEqual({ A1: { parent: null, rank: 1 }, A2: { parent: null, rank: 2 } })
  })

  test('parents that go round a loop read as no tree above: only the own goals count', async () => {
    const files = webUnderAcme(goalsText({ A1: 1 }), goalsText({ A2: 2 }))
    files.write(configPath('acme'), configOf('acme', 'web'))
    const goals = new TreeGoals(files, PATHS.goals, WEB)
    await goals.refresh()
    expect(goals.current).toEqual({ A1: { parent: null, rank: 1 } })
  })

  test("a team above whose config moves its state folder is read there, also when the config moves it later", async () => {
    const files = webUnderAcme(goalsText({}), goalsText({ A1: 1 }))
    files.write('K/teams/acme/kept/goals.jsonl', goalsText({ A1: 2 }))
    const goals = new TreeGoals(files, PATHS.goals, WEB)
    await goals.refresh()
    expect(goals.current).toEqual({ A1: { parent: null, rank: 1 } })
    files.write(configPath('acme'), configOf('acme', null, 'kept'))
    expect(await goals.refresh()).toBe(true)
    expect(goals.current).toEqual({ A1: { parent: null, rank: 2 } })
  })

  test('a new title moves nothing a ranking reads; a new rank, a rank taken off and a removed file do', async () => {
    const lines = [goalLine('A1'), goalRankLine('A1', 1)]
    const files = webUnderAcme(lines.join('\n'), '')
    const goals = new TreeGoals(files, PATHS.goals, WEB)
    expect(await goals.refresh()).toBe(true)
    const retitled = [...lines, goalTitleLine('A1', 'a new title')]
    files.write(PATHS.goals, retitled.join('\n'))
    expect(await goals.refresh()).toBe(false)
    files.write(PATHS.goals, [...retitled, goalRankLine('A1', 2)].join('\n'))
    expect(await goals.refresh()).toBe(true)
    expect(goals.current).toEqual({ A1: { parent: null, rank: 2 } })
    files.write(PATHS.goals, [...retitled, goalRankLine('A1', null)].join('\n'))
    expect(await goals.refresh()).toBe(true)
    expect(goals.current).toEqual({ A1: { parent: null, rank: null } })
    files.remove(PATHS.goals)
    expect(await goals.refresh()).toBe(true)
    expect(goals.current).toEqual({})
  })

  test('a parent with no folder reads as nothing above, until it comes', async () => {
    const files = new MemoryFiles()
    files.write(WEB.config, configOf('web', 'acme'))
    files.write(PATHS.goals, goalsText({ A1: 1 }))
    const goals = new TreeGoals(files, PATHS.goals, WEB)
    await goals.refresh()
    expect(goals.current).toEqual({ A1: { parent: null, rank: 1 } })
    files.write(configPath('acme'), configOf('acme'))
    files.write(ACME_GOALS, goalsText({ A2: 2 }))
    expect(await goals.refresh()).toBe(true)
    expect(goals.current).toEqual({ A1: { parent: null, rank: 1 }, A2: { parent: null, rank: 2 } })
  })

  test('a register named with no team reads its own goals file alone', async () => {
    const files = webUnderAcme(goalsText({ A1: 1 }), goalsText({ A2: 2 }))
    const goals = new TreeGoals(files, PATHS.goals, null)
    await goals.refresh()
    expect(goals.current).toEqual({ A1: { parent: null, rank: 1 } })
    expect(files.reads).toEqual([PATHS.goals])
  })

  test('a refresh that finds no stamp moved reads no file', async () => {
    const files = webUnderAcme(goalsText({ A1: 1 }), goalsText({ A2: 2 }))
    const goals = new TreeGoals(files, PATHS.goals, WEB)
    await goals.refresh()
    const reads = files.reads.length
    expect(await goals.refresh()).toBe(false)
    expect(files.reads.length).toBe(reads)
  })
})

describe('TaskRegisterSource over the tree goals', () => {
  const GATED: CardFields = { question: 'Ship it?', options: ['A: now', 'B: next week'], recommend: 'A', byDefault: 'B', gate: 'product' }
  const POLL = { claudeSession: S1, pinned: 'etl', now: NOW }

  /** A Roadmap task on `goal`, waiting on the owner's decision. */
  const onGoal = (id: string, goal: string) => [
    createLine(id, { owner: 'po', by: 'lead', at: NOW - 3 * HOUR, goals: [goal], taskKeys: { workClass: 'Roadmap' } }),
    waitingLine(id, 'po', NOW - 2 * HOUR, [{ kind: 'decision', who: 'owner' }], null, GATED),
  ]

  const dueIds = (snap: Snapshot | null) => snap?.ownerCards['po']?.due.map(card => card.id)

  test('a goal rank moving alone gives a snapshot, its goals and the owner cards in their new order', async () => {
    const files = new MemoryFiles()
    files.write(PATHS.events, [...onGoal('T1', 'A1'), ...onGoal('T2', 'A2')].join('\n'))
    files.write(PATHS.goals, goalsText({ A1: 1, A2: 2 }))
    const source = new TaskRegisterSource(files, PATHS, TEAM_SETTINGS, null, new TreeGoals(files, PATHS.goals, null))
    expect(dueIds(await source.poll(POLL))).toEqual(['T1', 'T2'])
    expect(await source.poll(POLL)).toBe(null)
    files.write(PATHS.goals, goalsText({ A1: 2, A2: 1 }))
    const moved = await source.poll(POLL)
    expect(moved?.goals).toEqual({ A1: { parent: null, rank: 2 }, A2: { parent: null, rank: 1 } })
    expect(dueIds(moved)).toEqual(['T2', 'T1'])
  })

  // The usual case: a rank moves the rows' scores with no owner card to reorder, so nothing else asks for a snapshot.
  test('a goal rank moving with no owner card to reorder still gives a snapshot', async () => {
    const files = new MemoryFiles()
    files.write(PATHS.events, createLine('T1', { owner: 'api', by: 'lead', at: NOW - 3 * HOUR, goals: ['A1'], taskKeys: { workClass: 'Roadmap' } }))
    files.write(PATHS.goals, goalsText({ A1: 1 }))
    const source = new TaskRegisterSource(files, PATHS, TEAM_SETTINGS, null, new TreeGoals(files, PATHS.goals, null))
    expect(dueIds(await source.poll(POLL)) ?? []).toEqual([])
    expect(await source.poll(POLL)).toBe(null)
    files.write(PATHS.goals, goalsText({ A1: 2 }))
    const moved = await source.poll(POLL)
    expect(moved?.goals).toEqual({ A1: { parent: null, rank: 2 } })
    expect(dueIds(moved) ?? []).toEqual([])
  })
})
