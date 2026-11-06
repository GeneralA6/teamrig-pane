// How the pane ranks a tree: teamrig's one ranking builder (core register/ranking.ts) over what the pane can read, so a
// task sits at the same band and score here as on `teamrig list`.
import type { RankFocus } from '../types'
import { NO_GOALS, ownSizing, treeRanking, type TreeRanking } from './core/read/index'

/**
 * The ranking of a team whose config sets `focus` and whose owner reads as `ownerSource`. stopgap T2093: a task is sized
 * by its own size alone, with no spend behind it, until the pane reads the per-task spend file. stopgap T2098: no goals
 * are read, which changes no score while the core serves no ranked goal.
 */
export function rankingOf(focus: RankFocus, ownerSource: string): TreeRanking {
  return treeRanking({ focus, ownerSource, goals: NO_GOALS.goals, sizing: ownSizing })
}
