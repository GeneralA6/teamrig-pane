// The session title (T824): whose pane this is, so with several panes open across tabs a glance tells them apart.
// The pane's first line, in every view and page, names the session as teamrig messages it (its name on the team, from
// the team's config and rename log: source.ts), then dim its team where the name does not lead with it; the area id is
// left out (T935: it read as unclear). The band above the prompt leads its banner with the name alone
// (banner.ts), the one line that stays in view while the pane's body scrolls, as the engine keeps no pane row fixed. A
// pinned area is the area the pane shows, so the title names it and says it is pinned.
// Pure: spans that register.tsx draws on one line, cut at the pane's width.
import type { Snapshot } from '../types'
import { SEPARATOR, type Span } from './rows'

/** What the title reads from a snapshot. */
export type TitleNames = Pick<Snapshot, 'area' | 'areaSource' | 'areaName' | 'team'>

/** The title of a pane that found a team but no area for the session. */
export const NO_SESSION = 'no session'

/** The name teamrig messages `area` by (its `areaName` on the team), else the area's id when the team names it no other way. */
export function sessionName(area: string, areaName: string | null): string {
  return areaName ?? area
}

/**
 * `team-lead · team acme`: the name bold, then the team dim, only where the pane found one and the name does not lead
 * with it (`acme-tr-pane` stands alone); ` (pinned)` after the name of a pinned area. With no area, a dim `no session`
 * before the team; with neither, null: the pane draws no title.
 */
export function titleSpans(names: TitleNames): Span[] | null {
  if (names.area === null) return names.team === null ? null : [{ text: NO_SESSION, dim: true }, ...teamSpans(names.team)]
  const name = sessionName(names.area, names.areaName)
  const pinned: Span[] = names.areaSource === 'pinned' ? [{ text: ' (pinned)', dim: true }] : []
  const team = names.team !== null && name.startsWith(`${names.team}-`) ? [] : teamSpans(names.team)
  return [{ text: name, bold: true }, ...pinned, ...team]
}

/** ` · team acme`, dim; none when the pane found no team. */
function teamSpans(team: string | null): Span[] {
  return team === null ? [] : [SEPARATOR, { text: `team ${team}`, dim: true }]
}
