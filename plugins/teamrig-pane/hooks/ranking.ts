// How the pane ranks a tree: teamrig's one ranking builder (core register/ranking.ts) over what the pane can read, so a
// task sits at the same band and score here as on `teamrig list`.
import type { GoalRanks, RankFocus, TaskSpend } from '../types'
import { parseTasksWeek, storedSizing, treeRanking, type TreeRanking } from './core/read/index'

/** No spend read: every task sized by its own size alone, an unsized one by the default size. */
export const NO_SPEND: TaskSpend = { spentPct: {}, likeMedians: [] }

/**
 * The spend in a tasks' week file's text; a damaged file, or one of a format this pane cannot read, reads as none, so
 * the pane ranks as with no file until a hook writes it again.
 */
export function spendIn(text: string): TaskSpend {
  const summary = parseTasksWeek(text)
  return summary === undefined ? NO_SPEND : { spentPct: summary.spentPct, likeMedians: summary.likeMedians }
}

/**
 * `spend` with only the tasks `ids` names: what a snapshot carries, as the file holds every task the team spent on this
 * week, most of them long finished. The medians stay whole: an unsized task of any class and type is sized by them.
 */
export function spendFor(spend: TaskSpend, ids: Iterable<string>): TaskSpend {
  const spentPct: Record<string, number> = {}
  for (const id of ids) {
    const pct = spend.spentPct[id]
    if (pct !== undefined) spentPct[id] = pct
  }
  return { spentPct, likeMedians: spend.likeMedians }
}

/**
 * The ranking of a team whose config sets `focus`, whose owner reads as `ownerSource`, whose tree holds `goals`
 * (tree-goals.ts) and whose tasks have cost `spend`: a task is sized as `teamrig list` sizes it, its own size or its
 * like tasks' median less what it spent.
 */
export function rankingOf(focus: RankFocus, ownerSource: string, goals: GoalRanks, spend: TaskSpend): TreeRanking {
  return treeRanking({ focus, ownerSource, goals: new Map(Object.entries(goals)), sizing: storedSizing(spend, focus) })
}
