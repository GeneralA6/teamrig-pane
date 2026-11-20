// The Claude Code dock's own requirement: a Claude Code new enough for every call the pane makes. The engine's
// version answer, the oldest release and the `claude update` fix live here, so the requirements check itself
// (requirements.ts) names no engine.
import type { SessionVersion } from 'claude-code'
import type { Version } from '../types'
import { messageOf } from './errors'
import { PLUGIN, isOlder, parseVersion, versionText, type RequirementCheck } from './requirements'

/**
 * The oldest Claude Code the pane runs on: 2.1.295 added strings and `Text` as the children of a mod's
 * `Button`, which every task row is drawn with. Mods came in 2.1.287, so an older one never loads the pane.
 */
export const MIN_CLAUDE_CODE: Version = { major: 2, minor: 1, patch: 295 }

/**
 * Claude Code too old; null when it is new enough or its version is not spelled as a release, as an unknown
 * version is never called old. `version` answers as `$.session.version()` does; a version the engine cannot
 * give (its `$.session.version` is not proven before 2.1.295) is a failed check.
 */
export function claudeCodeCheck(version: () => Promise<SessionVersion>): RequirementCheck {
  return async () => {
    try {
      const running = parseVersion((await version()).version)
      return running !== null && isOlder(running, MIN_CLAUDE_CODE) ? { kind: 'claude-code-old', running } : null
    } catch (error) {
      return { kind: 'check-failed', requirement: 'Claude Code', reason: messageOf(error) }
    }
  }
}

/** The line for a Claude Code too old: what runs, what the pane needs, then the fix. */
export function claudeCodeOldLine(running: Version): string {
  return `Claude Code ${versionText(running)} is older than ${PLUGIN} needs (${versionText(MIN_CLAUDE_CODE)} or later): run claude update, then restart Claude Code.`
}
