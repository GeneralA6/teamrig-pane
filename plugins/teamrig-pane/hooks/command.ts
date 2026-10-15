// The /teamrig-pane command: its name and its argument, parsed apart from the engine so every form is testable.
import type { CommandPresentation } from 'claude-code'
import type { ViewMode } from '../types'

/** The slash command the pane registers, kept apart from /teamrig, which the teamrig plugin itself uses. */
export const COMMAND = 'teamrig-pane'

/** What the command takes; `<session>` is a session's id or name. */
export const ARGUMENT_HINT = '[mine | all | auto | <session>]'

export const USAGE = `usage: /${COMMAND} ${ARGUMENT_HINT}`

/**
 * open: show the pane; mode: switch the view; auto: drop this session's pin and follow its
 * `inbox read` again; pin: show the session `word` names (an id or a name, looked up by sessions.ts) in
 * this session from now on. The keywords come first, so a session named mine, all or auto is pinned by its id.
 */
export type PaneCommand = { kind: 'open' } | { kind: 'mode'; mode: ViewMode } | { kind: 'auto' } | { kind: 'pin'; word: string }

export function parsePaneArgs(args: string): PaneCommand {
  const word = args.trim().toLowerCase()
  if (word === '') return { kind: 'open' }
  if (word === 'mine' || word === 'all') return { kind: 'mode', mode: word }
  if (word === 'auto') return { kind: 'auto' }
  return { kind: 'pin', word }
}

/** The fullscreen layout docks a pane beside the transcript from this width (engine: `CommandPresentation`). */
export const DOCK_MIN_COLUMNS = 110

/** Why the pane will sit above the prompt instead of docking on the right, or null when it docks. */
export function inlineReason(presentation: CommandPresentation): string | null {
  if (!presentation.isFullscreen)
    return 'Shown above the prompt: this session runs on the main screen. The side dock needs the fullscreen layout ("tui": "fullscreen" in ~/.claude/settings.json, then restart or resume the session).'
  if (presentation.columns < DOCK_MIN_COLUMNS)
    return `Shown above the prompt: the terminal is ${presentation.columns} columns wide and the side dock needs ${DOCK_MIN_COLUMNS}. Widen or maximize the window, then /${COMMAND} again.`
  return null
}
