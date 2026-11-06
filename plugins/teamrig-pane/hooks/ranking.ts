// How the pane ranks a tree: teamrig's one ranking builder (core register/ranking.ts) over what the pane can read, so a
// task sits at the same band and score here as on `teamrig list`.
import type { GoalRanks, RankFocus } from '../types'
import { ownSizing, treeRanking, type TreeRanking } from './core/read/index'

/**
 * The ranking of a team whose config sets `focus`, whose owner reads as `ownerSource` and whose tree holds `goals`
 * (tree-goals.ts). stopgap T2093: a task is sized by its own size alone, with no spend behind it, until the pane reads
 * the per-task spend file.
 */
export function rankingOf(focus: RankFocus, ownerSource: string, goals: GoalRanks): TreeRanking {
  return treeRanking({ focus, ownerSource, goals: new Map(Object.entries(goals)), sizing: ownSizing })
}
