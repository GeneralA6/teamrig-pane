// How wide the pane's text draws, in terminal cells, counted per grapheme: what a reader sees as one
// character (a letter with its accents, a flag, an emoji ZWJ sequence such as a family). An emoji in
// emoji presentation and an East Asian wide or fullwidth character take two cells; marks, joiners,
// variation selectors and other format characters none; anything else one. Wrapping (layout.ts) and
// cutting (details.ts) both count with it, so a line never runs past the pane's edge and a cut never
// splits a character.

/** Splits text into graphemes; null where the runtime has no Intl.Segmenter, which `graphemes` covers. */
const SEGMENTER: Intl.Segmenter | null =
  typeof Intl === 'object' && typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null

/** Printable ASCII: one cell a character, the common case counted without segmenting. */
const ASCII = /^[\x20-\x7e]*$/
const ZWJ = '\u{200d}'
/** Joins the grapheme before it: a mark (variation selectors and the keycap are marks), a skin tone, a joiner or a tag. */
const EXTENDS = /^[\p{M}\p{Emoji_Modifier}\u{200d}\u{e0020}-\u{e007f}]$/u
const REGIONAL = /^\p{Regional_Indicator}$/u
/** No cells: a grapheme of marks, format characters (joiners, zero-width space) or controls alone. */
const ZERO_WIDTH = /^[\p{M}\p{Cf}\p{Cc}]+$/u
/** Two cells as an emoji: emoji presentation by default, or asked for by VS16, a skin tone or a flag's letters. */
const EMOJI = /\p{Emoji_Presentation}|\u{fe0f}|\p{Emoji_Modifier}|\p{Regional_Indicator}/u
/** VS15: the emoji before it drawn as text, one cell. */
const TEXT_STYLE = '\u{fe0e}'
/**
 * East Asian wide and fullwidth (Unicode's EastAsianWidth W and F, the blocks the register's text
 * can hold): Hangul, CJK punctuation, kana and ideographs, Yi, fullwidth forms. Halfwidth kana
 * (U+FF61..) stays one cell.
 */
const EAST_ASIAN_WIDE = new RegExp(
  `^[${[
    '\\u{1100}-\\u{115f}', // Hangul Jamo initials
    '\\u{2e80}-\\u{303e}', // CJK radicals, Kangxi, ideographic description, CJK symbols and punctuation
    '\\u{3041}-\\u{33ff}', // kana, Bopomofo, Hangul compatibility Jamo, Kanbun, enclosed CJK, CJK compatibility
    '\\u{3400}-\\u{4dbf}', // CJK extension A
    '\\u{4e00}-\\u{9fff}', // CJK unified ideographs
    '\\u{a000}-\\u{a4cf}', // Yi
    '\\u{a960}-\\u{a97f}', // Hangul Jamo extended A
    '\\u{ac00}-\\u{d7a3}', // Hangul syllables
    '\\u{f900}-\\u{faff}', // CJK compatibility ideographs
    '\\u{fe10}-\\u{fe19}', // vertical forms
    '\\u{fe30}-\\u{fe6f}', // CJK compatibility forms, small form variants
    '\\u{ff00}-\\u{ff60}', // fullwidth forms
    '\\u{ffe0}-\\u{ffe6}', // fullwidth signs
    '\\u{1b000}-\\u{1b2ff}', // kana supplement and extensions, Nushu
    '\\u{1f200}-\\u{1f2ff}', // enclosed ideographic supplement
    '\\u{20000}-\\u{2fffd}', // CJK extensions B to F, compatibility supplement
    '\\u{30000}-\\u{3fffd}', // CJK extensions G and H
  ].join('')}]`,
  'u',
)

/**
 * `text` split into graphemes: by `segmenter` when there is one, else joined by hand, each mark,
 * skin tone, joiner or tag onto the grapheme before it, a code point after a joiner onto its sequence,
 * and two regional flag letters (U+1F1E6 to U+1F1FF) into a flag.
 */
export function graphemes(text: string, segmenter: Intl.Segmenter | null = SEGMENTER): string[] {
  if (segmenter !== null) return Array.from(segmenter.segment(text), part => part.segment)
  const out: string[] = []
  for (const char of text) {
    const last = out[out.length - 1]
    if (last !== undefined && (EXTENDS.test(char) || last.endsWith(ZWJ) || (REGIONAL.test(char) && REGIONAL.test(last))))
      out[out.length - 1] = last + char
    else out.push(char)
  }
  return out
}

/** One grapheme's width in cells: 0, 1 or 2. */
export function graphemeCells(grapheme: string): number {
  if (ZERO_WIDTH.test(grapheme)) return 0
  if (!grapheme.includes(TEXT_STYLE) && EMOJI.test(grapheme)) return 2
  return EAST_ASIAN_WIDE.test(grapheme) ? 2 : 1
}

/** How many non-ASCII texts' widths cells keeps; past it, it starts over. */
export const KEPT_WIDTHS = 4_096
/** Non-ASCII texts' widths: the pane's glyphs and separators recur in every row, and segmenting them is the cost. */
const widths = new Map<string, number>()

/** A text's width in cells, as the terminal draws it. */
export function cells(text: string): number {
  if (ASCII.test(text)) return text.length
  const known = widths.get(text)
  if (known !== undefined) return known
  let width = 0
  for (const grapheme of graphemes(text)) width += graphemeCells(grapheme)
  if (widths.size >= KEPT_WIDTHS) widths.clear()
  widths.set(text, width)
  return width
}
