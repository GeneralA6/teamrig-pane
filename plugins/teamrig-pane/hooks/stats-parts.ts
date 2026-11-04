// The pieces the Stats tab's sections share (stats-rows.ts draws Health and Flow, stats-sections.ts the sections
// after Flow): the indents, a section's foldable header, and the words for a number, a duration and a range. Pure.
import { joined } from './card'
import type { StatsRange } from './core/read/index'
import { FOLDED_MARK, type Block, type Row, type Span } from './rows'

/** The Stats tab's view name, which leads each of its block keys. */
export const VIEW = 'stats'
/** Leads a section's rows. */
export const INDENT: Span = { text: '  ' }
/** Leads a wrapped line of a row INDENT leads. */
export const HANG: Span = { text: '    ' }
/** Leads an open section's header, as FOLDED_MARK leads a folded one. */
export const OPEN_MARK: Span = { text: '▾ ', dim: true }

/** `value` with its sign: `+3`, `-2`, `0`. */
export function signed(value: number): string {
  return value > 0 ? `+${value}` : `${value}`
}

/** A duration in days to a tenth: `1.5 d`. */
export function daysText(value: number): string {
  return `${value.toFixed(1)} d`
}

/** A range as its press reads, its count apart from its unit: `7 d`, `1 y`, `all`. */
export function rangeLabel(range: StatsRange): string {
  return range === 'all' ? 'all' : `${range.slice(0, -1)} ${range.slice(-1)}`
}

/**
 * A foldable section under `key`: its header the `parts` after the fold mark, a press on it opening or closing the
 * section (`folds`); while open (`card` not null) its rows drawn under the header as the block's card.
 */
export function sectionBlock(key: string, parts: readonly Span[], card: Row[] | null): Block {
  const head: Row = { key, spans: [card === null ? FOLDED_MARK : OPEN_MARK, ...joined(parts)], hang: INDENT }
  const block: Block = { key, rows: [head], folds: key, opensSection: true }
  return card === null ? block : { ...block, card }
}
