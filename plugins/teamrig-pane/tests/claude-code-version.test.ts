// The dock's own requirement: the Claude Code version, over fake engine answers, alone and beside the git check.
import type { SessionVersion } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import { MIN_CLAUDE_CODE, claudeCodeCheck, claudeCodeOldLine } from '../hooks/claude-code-version'
import { gitCheck, requirementBlocks, requirementProblems, versionText } from '../hooks/requirements'

const running = (version: string) => async (): Promise<SessionVersion> => ({ version })

describe('claudeCodeCheck', () => {
  test('the oldest Claude Code the pane runs on is 2.1.295', () => {
    expect(versionText(MIN_CLAUDE_CODE)).toBe('2.1.295')
  })

  test('a Claude Code older than 2.1.295, a development build of one too', async () => {
    expect(await claudeCodeCheck(running('2.1.290'))()).toEqual({ kind: 'claude-code-old', running: { major: 2, minor: 1, patch: 290 } })
    expect(await claudeCodeCheck(running('2.1.294-dev.20260920.t101500.sha1a2b3c4'))()).toEqual({
      kind: 'claude-code-old',
      running: { major: 2, minor: 1, patch: 294 },
    })
  })

  test('finds nothing from 2.1.295 on', async () => {
    expect(await claudeCodeCheck(running('2.1.295'))()).toBeNull()
    expect(await claudeCodeCheck(running('2.1.300'))()).toBeNull()
    expect(await claudeCodeCheck(async () => ({ version: '3.0.0', base: '3.0.0', builtAt: '2026-10-01T10:00:00Z' }))()).toBeNull()
  })

  test('never calls a version it cannot read old', async () => {
    expect(await claudeCodeCheck(running('a build of my own'))()).toBeNull()
  })

  test('a version the engine cannot give is a failed check, never a rejection', async () => {
    expect(await claudeCodeCheck(() => Promise.reject(new Error('no session.version on this engine')))()).toEqual({
      kind: 'check-failed',
      requirement: 'Claude Code',
      reason: 'no session.version on this engine',
    })
  })
})

describe('the requirements of the dock', () => {
  test('Claude Code first, then git, each asked once; a failed version check still checks git', async () => {
    const calls: string[] = []
    const found = await requirementProblems([
      claudeCodeCheck(() => {
        calls.push('version')
        return Promise.reject(new Error('no session.version on this engine'))
      }),
      gitCheck(() => {
        calls.push('git')
        return Promise.reject('timed out')
      }),
    ])
    expect(found).toEqual([
      { kind: 'check-failed', requirement: 'Claude Code', reason: 'no session.version on this engine' },
      { kind: 'git-unstartable', reason: 'timed out' },
    ])
    expect(calls).toEqual(['version', 'git'])
  })

  test('a new enough Claude Code and a git that starts lack nothing', async () => {
    expect(await requirementProblems([claudeCodeCheck(running('2.1.300')), gitCheck(async () => ({ exitCode: 0 }))])).toEqual([])
  })
})

describe('the line', () => {
  test('says what runs and what the pane needs, then the fix', () => {
    expect(claudeCodeOldLine({ major: 2, minor: 1, patch: 290 })).toBe(
      'Claude Code 2.1.290 is older than teamrig-pane needs (2.1.295 or later): run claude update, then restart Claude Code.',
    )
  })

  test('is the WARN line the pane draws for a Claude Code too old', () => {
    const blocks = requirementBlocks([{ kind: 'claude-code-old', running: { major: 2, minor: 1, patch: 290 } }], claudeCodeOldLine)
    expect(blocks[0]?.rows[0]?.spans).toEqual([
      { text: 'WARN Claude Code 2.1.290 is older than teamrig-pane needs (2.1.295 or later): run claude update, then restart Claude Code.', color: 'warning' },
    ])
  })
})
