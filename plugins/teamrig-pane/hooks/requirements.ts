// What the pane needs, checked once when a session starts. Each problem is drawn as one WARN line with its
// fix above the pane's body (register.tsx); a check that fails becomes a short line of its own and never stops
// the pane. This file names no engine: the git check is every surface's, and a surface adds the check of its
// own host (the dock's: claude-code-version.ts), with the line only it can word.
import type { RequirementProblem, Version } from '../types'
import { messageOf } from './errors'
import { single, type Block } from './rows'

export const PLUGIN = 'teamrig-pane'

/** What a program that started answers. The git check reads none of it: any exit code means git started. */
export interface RunResult {
  readonly exitCode: number
}

/** One requirement's check: its problem, or null when the requirement is met. It never rejects. */
export type RequirementCheck = () => Promise<RequirementProblem | null>

/** The line for a host too old, worded by the surface: it knows the version it needs and how its host is updated. */
export type HostOldLine = (running: Version) => string

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
 * Git that cannot be started: not installed, not on the PATH, denied or timed out, which a rejection does
 * not tell apart, so the line gives its reason. `gitVersion` runs `git --version` and rejects when git
 * cannot be started; any exit code means it started.
 */
export function gitCheck(gitVersion: () => Promise<RunResult>): RequirementCheck {
  return async () => {
    try {
      await gitVersion()
      return null
    } catch (error) {
      return { kind: 'git-unstartable', reason: messageOf(error) }
    }
  }
}

/** Every problem the checks find, in the checks' order; each check runs on its own, and this never rejects. */
export async function requirementProblems(checks: readonly RequirementCheck[]): Promise<RequirementProblem[]> {
  const found = await Promise.all(checks.map(check => check()))
  return found.filter((problem): problem is RequirementProblem => problem !== null)
}

/** One plain line: what is missing, then the fix. */
export function describeRequirement(problem: RequirementProblem, hostOld: HostOldLine): string {
  switch (problem.kind) {
    case 'claude-code-old':
      return hostOld(problem.running)
    case 'git-unstartable':
      return `git could not be started (${problem.reason}): install it from git-scm.com, then restart Claude Code. The Changes view needs it.`
    case 'check-failed':
      return `The ${PLUGIN} check for ${problem.requirement} failed (${problem.reason}).`
  }
}

/** The problems as the first blocks of the pane's body, one WARN line each. */
export function requirementBlocks(problems: readonly RequirementProblem[], hostOld: HostOldLine): Block[] {
  return problems.map(problem =>
    single(`requirement-${problem.kind}`, [{ text: `WARN ${describeRequirement(problem, hostOld)}`, color: 'warning' }], { text: '  ' }),
  )
}

/** Whether the Changes view has no git to read with. */
export function isGitMissing(problems: readonly RequirementProblem[]): boolean {
  return problems.some(problem => problem.kind === 'git-unstartable')
}
