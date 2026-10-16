// The Done page's rows (done.ts pages the finished tasks a week at a time): a head naming whose tasks and the week,
// with how many were done and dropped; then each day, newest first, a dim line and its tasks, `✓ T4  title    14:02`
// (in the all view the owner before the time), each a press that opens the task's page, as a search result does;
// past MAX_DONE_ROWS a dim line counts the rest. The oldest week ends with where the pane stops holding finished
// tasks and the command that lists older ones (teamrig's `list --status done` reads the register's whole history).
// register.tsx draws the week steps (‹ prev, next ›) over it. Pure.
import type { Snapshot, TaskRow, ViewMode } from '../types'
import { doneWeek, type DoneWeek } from './done'
import { dayWords } from './meta'
import { GLYPH, GLYPH_COLOR, indentOf, problemBlocks, readingBlock, single, TITLE_GAP, type Block, type Row } from './rows'

/** The command that lists the finished tasks the pane no longer holds. */
export const OLDER_DONE_COMMAND = 'teamrig list --status done,dropped'

/** `Mon 10-12`: the words a week goes by, its Monday's. */
export function weekWords(week: string): string {
  return dayWords(Date.parse(week))
}

/** `✓ T4  title    14:02`: a finished task, dim, on one line with when it closed (`po 14:02` naming its owner). */
function doneRow(task: TaskRow, showOwner: boolean): Block {
  const key = `done-page:${task.id}`
  const color = GLYPH_COLOR[task.status]
  const time = task.statusAt.slice(11, 16)
  const row: Row = {
    key,
    spans: [color === undefined ? { text: GLYPH[task.status], dim: true } : { text: GLYPH[task.status], color }, { text: ` ${task.id}${TITLE_GAP}${task.title}`, dim: true }],
    hang: indentOf(task),
    end: { text: showOwner ? `${task.owner} ${time}` : time, dim: true },
    maxLines: 1,
  }
  return { key, opens: task.id, rows: [row] }
}

/** `Done · po`, bold, and ` · 3 done · 1 dropped`, dim; the week is drawn over it, with its steps (register.tsx). */
function headBlock(who: string, week: DoneWeek): Block {
  return single('done-head', [{ text: `Done · ${who}`, bold: true }, { text: ` · ${week.done} done · ${week.dropped} dropped`, dim: true }])
}

/** What the pane holds of the finished tasks before `heldFrom`: none, and the command that lists them. */
export function heldText(heldFrom: number): string {
  const at = new Date(heldFrom).toISOString().slice(11, 16)
  return `The pane holds tasks finished since ${dayWords(heldFrom)} ${at}; ${OLDER_DONE_COMMAND} lists older ones.`
}

/**
 * The Done page for `week`: the area's finished tasks in the mine view (every owner's when the session has no area),
 * every owner's in the all view.
 */
export function doneBlocks(snap: Snapshot, mode: ViewMode, week: string): Block[] {
  const reading = readingBlock(snap)
  if (reading !== null) return [reading]
  const owner = mode === 'mine' ? snap.area : null
  const shown = doneWeek(snap.tasks, owner, week, snap.now)
  const blocks: Block[] = [...problemBlocks(snap), headBlock(owner ?? 'all', shown)]
  shown.days.forEach((day, i) => {
    // Each day after the first opens a section of its own.
    blocks.push({ ...single(`done-day:${day.day}`, [{ text: day.words, dim: true }]), opensSection: i > 0 })
    blocks.push(...day.tasks.map(task => doneRow(task, owner === null)))
  })
  if (shown.days.length === 0) blocks.push(single('done-none', [{ text: 'Nothing finished this week.', dim: true }]))
  if (shown.more > 0) blocks.push(single('done-more', [{ text: `${shown.more} more this week: search finds them`, dim: true }]))
  if (shown.heldFrom !== null) blocks.push({ ...single('done-held', [{ text: heldText(shown.heldFrom), dim: true }]), opensSection: true })
  return blocks
}
