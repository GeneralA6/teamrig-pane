// The session title (T824): whose pane this is, so with several panes open across tabs a glance tells them apart.
// The pane's first line, in every view and page, names the session as the tab titles do (T937): its team once, in
// brackets, then its name on the team (from the team's config and rename log: source.ts) without the team's prefix,
// `[acme] tr-pane`, worded by teamrig's own sessionDisplay so the two cannot drift; the area id is left out (T935: it
// read as unclear). Docked, it heads the header that stays put while the body scrolls (frame.ts); the band above the
// prompt leads its banner with the name alone (banner.ts). A pinned area is the area the pane shows, so the title
// names it and says it is pinned.
// Pure: spans that register.tsx draws on one line, cut at the pane's width.
import type { Snapshot } from '../types'
import { sessionDisplay } from './core/read/index'
import type { Span } from './rows'

/** What the title reads from a snapshot. */
export type TitleNames = Pick<Snapshot, 'area' | 'areaSource' | 'areaName' | 'team'>

/** The title of a pane that found a team but no area for the session. */
export const NO_SESSION = 'no session'

/** The name teamrig messages `area` by (its `areaName` on the team), else the area's id when the team names it no other way. */
export function sessionName(area: string, areaName: string | null): string {
  return areaName ?? area
}

/**
 * `[acme] team-lead`, bold, where the pane found a team, the name alone where it found none; ` (pinned)` after it for a
 * pinned area. With no area, a dim `[acme] no session`; with neither, null: the pane draws no title.
 */
export function titleSpans(names: TitleNames): Span[] | null {
  if (names.area === null) return names.team === null ? null : [{ text: sessionDisplay(names.team, NO_SESSION), dim: true }]
  const name = sessionName(names.area, names.areaName)
  const pinned: Span[] = names.areaSource === 'pinned' ? [{ text: ' (pinned)', dim: true }] : []
  return [{ text: names.team === null ? name : sessionDisplay(names.team, name), bold: true }, ...pinned]
}
