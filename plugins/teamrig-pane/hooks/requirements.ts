// What the pane needs beyond the fullscreen layout, checked once when a session starts: a Claude Code new
// enough for every call the pane makes, and a git it can start for the Changes view. Each problem is drawn
// as one WARN line with its fix above the pane's body (register.tsx); a check that fails becomes a short
// line of its own and never stops the pane.
import type { ProcessResult, SessionVersion } from 'claude-code'
import type { RequirementProblem, Version } from '../types'
import { messageOf } from './errors'
import { single, type Block } from './rows'

/**
 * The oldest Claude Code the pane runs on: 2.1.295 added strings and `Text` as the children of a mod's
 * `Button`, which every task row is drawn with. Mods came in 2.1.287, so an older one never loads the pane.
 */
export const MIN_CLAUDE_CODE: Version = { major: 2, minor: 1, patch: 295 }

const PLUGIN = 'teamrig-pane'

/** What the check asks the engine. */
export interface RequirementPorts {
  /** The running Claude Code's version, as `$.session.version()` answers it. */
  version(): Promise<SessionVersion>
  /** Runs `git --version`; it rejects when git cannot be started. */
  gitVersion(): Promise<ProcessResult>
}

/** The version a text starts with: `2.1.300`, or `2.1.300-dev.<date>.<sha>` for a development build; null for any other text. */
export function parseVersion(text: string): Version | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:$|[-+])/.exec(text.trim())
  if (match === null) return null
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

export function isOlder(version: Version, than: Version): boolean {
  if (version.major !== than.major) return version.major < than.major
  if (version.minor !== than.minor) return version.minor < than.minor
  return version.patch < than.patch
}

export function versionText(version: Version): string {
  return `${version.major}.${version.minor}.${version.patch}`
}

/**
 * Claude Code too old; null when it is new enough or its version is not spelled as a release, as an unknown
 * version is never called old. A version the engine cannot give (its `$.session.version` is not proven
 * before 2.1.295) is a failed check.
 */
async function claudeCodeProblem(ports: RequirementPorts): Promise<RequirementProblem | null> {
  try {
    const running = parseVersion((await ports.version()).version)
    return running !== null && isOlder(running, MIN_CLAUDE_CODE) ? { kind: 'claude-code-old', running } : null
  } catch (error) {
    return { kind: 'check-failed', requirement: 'Claude Code', reason: messageOf(error) }
  }
}

/**
 * Git that cannot be started: not installed, not on the PATH, denied or timed out, which a rejection does
 * not tell apart, so the line gives its reason. Any exit code means git started.
 */
async function gitProblem(ports: RequirementPorts): Promise<RequirementProblem | null> {
  try {
    await ports.gitVersion()
    return null
  } catch (error) {
    return { kind: 'git-unstartable', reason: messageOf(error) }
  }
}

/** Every problem the pane finds, Claude Code first; each check runs on its own, and this never rejects. */
export async function requirementProblems(ports: RequirementPorts): Promise<RequirementProblem[]> {
  const found = await Promise.all([claudeCodeProblem(ports), gitProblem(ports)])
  return found.filter((problem): problem is RequirementProblem => problem !== null)
}

/** One plain line: what is missing, then the fix. */
export function describeRequirement(problem: RequirementProblem): string {
  switch (problem.kind) {
    case 'claude-code-old':
      return `Claude Code ${versionText(problem.running)} is older than ${PLUGIN} needs (${versionText(MIN_CLAUDE_CODE)} or later): run claude update, then restart Claude Code.`
    case 'git-unstartable':
      return `git could not be started (${problem.reason}): install it from git-scm.com, then restart Claude Code. The Changes view needs it.`
    case 'check-failed':
      return `The ${PLUGIN} check for ${problem.requirement} failed (${problem.reason}).`
  }
}

/** The problems as the first blocks of the pane's body, one WARN line each. */
export function requirementBlocks(problems: readonly RequirementProblem[]): Block[] {
  return problems.map(problem => single(`requirement-${problem.kind}`, [{ text: `WARN ${describeRequirement(problem)}`, color: 'warning' }], { text: '  ' }))
}

/** Whether the Changes view has no git to read with. */
export function isGitMissing(problems: readonly RequirementProblem[]): boolean {
  return problems.some(problem => problem.kind === 'git-unstartable')
}
