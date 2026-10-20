// A task's page (nav.ts): the task as its open card in the list shows it (card.ts), given the whole body. Its title
// whole, under its status mark and id, then the card's rows with no guide, the labels at the body's edge, each id the
// snapshot holds a press that opens that task's own page. A task the snapshot no longer holds (it closed before
// today) draws one dim line saying so, and back still leads off it. Pure: blocks that layout.ts wraps and
// register.tsx draws under the page's back, forward and trail.
import type { PageDetails, Snapshot } from '../types'
import { cardRows } from './card'
import { HELD_DAYS } from './done'
import { treeOf } from './meta'
import { problemBlocks, readingBlock, single, titleRow, type Block } from './rows'

/**
 * The body of task `id`'s page: the register's problem, if any, then the task's title and card, `details` holding
 * what was read for it (its refs named unquoted, its goals by id, when nothing was).
 */
export function pageBlocks(snap: Snapshot, id: string, details: PageDetails): Block[] {
  const reading = readingBlock(snap)
  if (reading !== null) return [reading]
  const key = `page:${id}`
  const task = snap.tasks.find(each => each.id === id)
  if (task === undefined) return [...problemBlocks(snap), single(key, [{ text: `${id} left the pane's tasks: it closed over ${HELD_DAYS} days ago.`, dim: true }])]
  const detail = details[id] ?? { ref: task.ref, quotes: [], goals: [] }
  const card = cardRows('page', task, detail, treeOf(snap), null)
  return [...problemBlocks(snap), { key, rows: [titleRow(key, task)], card }]
}
