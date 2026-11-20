// The pane's requirements check with no engine: versions, the git check, the checks run together and the lines.
import { describe, expect, test } from 'claude-code/testing'
import type { RequirementProblem, Version } from '../types'
import {
  describeRequirement,
  gitCheck,
  isGitMissing,
  isOlder,
  parseVersion,
  requirementBlocks,
  requirementProblems,
  versionText,
  type RequirementCheck,
  type RunResult,
} from '../hooks/requirements'

const GIT_RAN: RunResult = { exitCode: 0 }
const FLOOR: Version = { major: 2, minor: 1, patch: 295 }

/** A surface's line for its host too old, as a stand-in words it. */
const hostOld = (running: Version): string => `the host ${versionText(running)} is too old: update it.`

describe('a version', () => {
  test('reads a release and a development build, and nothing else', () => {
    expect(parseVersion('2.1.300')).toEqual({ major: 2, minor: 1, patch: 300 })
    expect(parseVersion(' 2.1.295-dev.20260920.t101500.sha1a2b3c4\n')).toEqual({ major: 2, minor: 1, patch: 295 })
    expect(parseVersion('2.1.300+local')).toEqual({ major: 2, minor: 1, patch: 300 })
    for (const text of ['', 'dev', '2.1', '2.1.300x', 'v2.1.300']) expect(parseVersion(text)).toBeNull()
  })

  test('compares by major, then minor, then patch', () => {
    expect(isOlder({ major: 2, minor: 1, patch: 294 }, FLOOR)).toBe(true)
    expect(isOlder({ major: 2, minor: 0, patch: 999 }, FLOOR)).toBe(true)
    expect(isOlder({ major: 1, minor: 9, patch: 999 }, FLOOR)).toBe(true)
    expect(isOlder(FLOOR, FLOOR)).toBe(false)
    expect(isOlder({ major: 2, minor: 2, patch: 0 }, FLOOR)).toBe(false)
    expect(isOlder({ major: 3, minor: 0, patch: 0 }, FLOOR)).toBe(false)
    expect(versionText(FLOOR)).toBe('2.1.295')
  })
})

describe('gitCheck', () => {
  test('finds nothing when git starts, whatever its exit code', async () => {
    expect(await gitCheck(async () => GIT_RAN)()).toBeNull()
    expect(await gitCheck(async () => ({ exitCode: 129 }))()).toBeNull()
  })

  test('a git that cannot be started, with the reason of an error or of a bare text', async () => {
    expect(await gitCheck(() => Promise.reject(new Error('spawn git ENOENT')))()).toEqual({ kind: 'git-unstartable', reason: 'spawn git ENOENT' })
    expect(await gitCheck(() => Promise.reject('timed out'))()).toEqual({ kind: 'git-unstartable', reason: 'timed out' })
  })
})

describe('requirementProblems', () => {
  /** Checks that answer in turn, each recording its call. */
  function checks(...answers: readonly (RequirementProblem | null)[]) {
    const calls: number[] = []
    const made: RequirementCheck[] = answers.map((answer, index) => async () => {
      calls.push(index)
      return answer
    })
    return { made, calls }
  }

  test('finds nothing when every requirement is met, and asks each check once', async () => {
    const { made, calls } = checks(null, null)
    expect(await requirementProblems(made)).toEqual([])
    expect(calls).toEqual([0, 1])
  })

  test('keeps the problems in the order of their checks, and a problem never stops the checks after it', async () => {
    const old: RequirementProblem = { kind: 'claude-code-old', running: { major: 2, minor: 1, patch: 290 } }
    const git: RequirementProblem = { kind: 'git-unstartable', reason: 'ENOENT' }
    const { made, calls } = checks(old, null, git)
    expect(await requirementProblems(made)).toEqual([old, git])
    expect(calls).toEqual([0, 1, 2])
  })

  test('with no check there is nothing to lack', async () => {
    expect(await requirementProblems([])).toEqual([])
  })
})

describe('the lines', () => {
  test('say what is missing in plain words, then the fix; the host too old in the words of its surface', () => {
    expect(describeRequirement({ kind: 'claude-code-old', running: { major: 2, minor: 1, patch: 290 } }, hostOld)).toBe('the host 2.1.290 is too old: update it.')
    expect(describeRequirement({ kind: 'git-unstartable', reason: 'spawn git ENOENT' }, hostOld)).toBe(
      'git could not be started (spawn git ENOENT): install it from git-scm.com, then restart Claude Code. The Changes view needs it.',
    )
    expect(describeRequirement({ kind: 'check-failed', requirement: 'Claude Code', reason: 'denied' }, hostOld)).toBe('The teamrig-pane check for Claude Code failed (denied).')
  })

  test('are drawn as one WARN block each, in order, and only a git problem empties the Changes view', () => {
    const old: RequirementProblem = { kind: 'claude-code-old', running: { major: 2, minor: 1, patch: 290 } }
    const git: RequirementProblem = { kind: 'git-unstartable', reason: 'ENOENT' }
    const blocks = requirementBlocks([old, git], hostOld)
    expect(blocks.map(block => block.key)).toEqual(['requirement-claude-code-old', 'requirement-git-unstartable'])
    expect(blocks[0]?.rows[0]?.spans).toEqual([{ text: 'WARN the host 2.1.290 is too old: update it.', color: 'warning' }])
    expect(blocks[1]?.rows[0]?.spans).toEqual([{ text: `WARN ${describeRequirement(git, hostOld)}`, color: 'warning' }])
    expect(requirementBlocks([], hostOld)).toEqual([])
    expect(isGitMissing([old, git])).toBe(true)
    expect(isGitMissing([old])).toBe(false)
  })
})
