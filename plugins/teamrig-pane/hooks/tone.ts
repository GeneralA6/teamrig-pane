// The tones a span may wear, named for what they say and for no host's theme: the rows are the same data for every
// surface that draws them (the Claude Code dock, the dedicated UI), and each surface picks the color a tone gets
// (the dock in theme.ts). No tone at all draws in the surface's text color.

/**
 * Every tone: `accent` marks the reader's own or the picked one (their owner group, the meeting on now, the choice
 * shown), `suggestion` a press or code, `subtle` a value worth no attention; the other three say what they name.
 */
export const TONES = ['warning', 'error', 'success', 'suggestion', 'subtle', 'accent'] as const

export type Tone = (typeof TONES)[number]
