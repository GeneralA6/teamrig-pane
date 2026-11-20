// The Claude Code dock's colors: the engine's theme key each tone (tone.ts) draws in. The one place the rows' tones
// meet the engine's theme, so a file that builds rows never names a theme key.
import type { ThemeKey } from 'claude-code'
import type { Tone } from './tone'

/** Each tone's theme key; a Record, so a tone added with no key fails the typecheck. */
export const THEME: Readonly<Record<Tone, ThemeKey>> = {
  warning: 'warning',
  error: 'error',
  success: 'success',
  suggestion: 'suggestion',
  subtle: 'subtle',
  accent: 'claude',
}

/** The theme key a span's tone draws in; none for a span with no tone, which takes the theme's text color. */
export function themeOf(tone: Tone | undefined): ThemeKey | undefined {
  return tone === undefined ? undefined : THEME[tone]
}
