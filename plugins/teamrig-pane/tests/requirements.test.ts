// The pane's requirements check: the Claude Code version and git, over fake engine answers.
import type { ProcessResult, SessionVersion } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { RequirementProblem } from '../types'
import {
  MIN_CLAUDE_CODE,
  describeRequirement,
  isGitMissing,
  isOlder,
  parseVersion,
  requirementBlocks,
  requirementProblems,
  versionText,
  type RequirementPorts,
} from '../hooks/requirements'

const GIT_RAN: ProcessResult = { exitCode: 0, stdout: 'git version 2.47.1\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

/** Ports that answer `version` as the engine and run git as `git` does; each records its calls. */
function ports(version: () => Promise<SessionVersion>, git: () => Promise<ProcessResult> = async () => GIT_RAN) {
  const calls: string[] = []
  const answered: RequirementPorts = {
    version: () => {
      calls.push('version')
      return version()
    },
    gitVersion: () => {
      calls.push('git')
      return git()
    },
  }
  return { answered, calls }
}

const running = (version: string) => async (): Promise<SessionVersion> => ({ version })

describe('the Claude Code version', () => {
  test('reads a release and a development build, and nothing else', () => {
    expect(parseVersion('2.1.300')).toEqual({ major: 2, minor: 1, patch: 300 })
    expect(parseVersion(' 2.1.295-dev.20260920.t101500.sha1a2b3c4\n')).toEqual({ major: 2, minor: 1, patch: 295 })
    expect(parseVersion('2.1.300+local')).toEqual({ major: 2, minor: 1, patch: 300 })
    for (const text of ['', 'dev', '2.1', '2.1.300x', 'v2.1.300']) expect(parseVersion(text)).toBeNull()
  })

  test('compares by major, then minor, then patch', () => {
    expect(isOlder({ major: 2, minor: 1, patch: 294 }, MIN_CLAUDE_CODE)).toBe(true)
    expect(isOlder({ major: 2, minor: 0, patch: 999 }, MIN_CLAUDE_CODE)).toBe(true)
    expect(isOlder({ major: 1, minor: 9, patch: 999 }, MIN_CLAUDE_CODE)).toBe(true)
    expect(isOlder(MIN_CLAUDE_CODE, MIN_CLAUDE_CODE)).toBe(false)
    expect(isOlder({ major: 2, minor: 2, patch: 0 }, MIN_CLAUDE_CODE)).toBe(false)
    expect(isOlder({ major: 3, minor: 0, patch: 0 }, MIN_CLAUDE_CODE)).toBe(false)
    expect(versionText(MIN_CLAUDE_CODE)).toBe('2.1.295')
  })
})

describe('requirementProblems', () => {
  test('finds nothing when Claude Code is new enough and git starts, and asks each once', async () => {
    const { answered, calls } = ports(running('2.1.300'))
    expect(await requirementProblems(answered)).toEqual([])
    expect([...calls].sort()).toEqual(['git', 'version'])
  })

  test('a Claude Code older than 2.1.295, a development build of one too', async () => {
    expect(await requirementProblems(ports(running('2.1.290')).answered)).toEqual([{ kind: 'claude-code-old', running: { major: 2, minor: 1, patch: 290 } }])
    expect(await requirementProblems(ports(running('2.1.294-dev.20260920.t101500.sha1a2b3c4')).answered)).toEqual([
      { kind: 'claude-code-old', running: { major: 2, minor: 1, patch: 294 } },
    ])
    expect(await requirementProblems(ports(running('2.1.295')).answered)).toEqual([])
  })

  test('never calls a version it cannot read old', async () => {
    expect(await requirementProblems(ports(running('a build of my own')).answered)).toEqual([])
  })

  test('a git that cannot be started, with the reason; any exit code means it started', async () => {
    const missing = ports(running('2.1.300'), () => Promise.reject(new Error('spawn git ENOENT')))
    expect(await requirementProblems(missing.answered)).toEqual([{ kind: 'git-unstartable', reason: 'spawn git ENOENT' }])
    const failing = ports(running('2.1.300'), async () => ({ ...GIT_RAN, exitCode: 129, stdout: '' }))
    expect(await requirementProblems(failing.answered)).toEqual([])
  })

  test('a version the engine cannot give is a failed check, and git is still checked', async () => {
    const { answered, calls } = ports(() => Promise.reject(new Error('no session.version on this engine')), () => Promise.reject('timed out'))
    expect(await requirementProblems(answered)).toEqual([
      { kind: 'check-failed', requirement: 'Claude Code', reason: 'no session.version on this engine' },
      { kind: 'git-unstartable', reason: 'timed out' },
    ])
    expect(calls).toContain('git')
  })
})

describe('the lines', () => {
  test('say what is missing in plain words, then the fix', () => {
    expect(describeRequirement({ kind: 'claude-code-old', running: { major: 2, minor: 1, patch: 290 } })).toBe(
      'Claude Code 2.1.290 is older than teamrig-pane needs (2.1.295 or later): run claude update, then restart Claude Code.',
    )
    expect(describeRequirement({ kind: 'git-unstartable', reason: 'spawn git ENOENT' })).toBe(
      'git could not be started (spawn git ENOENT): install it from git-scm.com, then restart Claude Code. The Changes view needs it.',
    )
    expect(describeRequirement({ kind: 'check-failed', requirement: 'Claude Code', reason: 'denied' })).toBe('The teamrig-pane check for Claude Code failed (denied).')
  })

  test('are drawn as one WARN block each, in order, and only a git problem empties the Changes view', () => {
    const old: RequirementProblem = { kind: 'claude-code-old', running: { major: 2, minor: 1, patch: 290 } }
    const git: RequirementProblem = { kind: 'git-unstartable', reason: 'ENOENT' }
    const blocks = requirementBlocks([old, git])
    expect(blocks.map(block => block.key)).toEqual(['requirement-claude-code-old', 'requirement-git-unstartable'])
    expect(blocks[1]?.rows[0]?.spans).toEqual([{ text: `WARN ${describeRequirement(git)}`, color: 'warning' }])
    expect(requirementBlocks([])).toEqual([])
    expect(isGitMissing([old, git])).toBe(true)
    expect(isGitMissing([old])).toBe(false)
  })
})
