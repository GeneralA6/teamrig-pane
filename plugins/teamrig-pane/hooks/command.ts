// The /teamrig command's argument, parsed apart from the engine so every form is testable.
import type { CommandPresentation } from 'claude-code'
import type { ViewMode } from '../types'
import { SESSION_NAME } from './core/read/index'

export const USAGE = 'usage: /teamrig [mine | all | auto | <area>]'

/**
 * open: show the pane; mode: switch the view; auto: drop this session's pin and follow its
 * `inbox read` again; pin: show <area> in this session from now on; usage: unknown argument.
 */
export type PaneCommand =
  | { kind: 'open' }
  | { kind: 'mode'; mode: ViewMode }
  | { kind: 'auto' }
  | { kind: 'pin'; area: string }
  | { kind: 'usage' }

export function parsePaneArgs(args: string): PaneCommand {
  const word = args.trim().toLowerCase()
  if (word === '') return { kind: 'open' }
  if (word === 'mine' || word === 'all') return { kind: 'mode', mode: word }
  if (word === 'auto') return { kind: 'auto' }
  return SESSION_NAME.test(word) ? { kind: 'pin', area: word } : { kind: 'usage' }
}

/** The fullscreen layout docks a pane beside the transcript from this width (engine: `CommandPresentation`). */
export const DOCK_MIN_COLUMNS = 110

/** Why the pane will sit above the prompt instead of docking on the right, or null when it docks. */
export function inlineReason(presentation: CommandPresentation): string | null {
  if (!presentation.isFullscreen)
    return 'Shown above the prompt: this session runs on the main screen. The side dock needs the fullscreen layout ("tui": "fullscreen" in ~/.claude/settings.json, then restart or resume the session).'
  if (presentation.columns < DOCK_MIN_COLUMNS)
    return `Shown above the prompt: the terminal is ${presentation.columns} columns wide and the side dock needs ${DOCK_MIN_COLUMNS}. Widen or maximize the window, then /teamrig again.`
  return null
}
