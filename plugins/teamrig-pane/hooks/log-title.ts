// A Log conversation's title, which the Log view's list and page draw (log-rows.ts) and its search reads: the tasks
// its session worked while it ran (work.ts: its own events on its own tasks, from the conversation's first line until
// the session's next conversation began), each id bold before its title, else how it opened. Pure.
import type { LogConversation, Snapshot } from '../types'
import { SEPARATOR, type Span } from './rows'
import { graphemes } from './width'

/** The most characters of each task's title in the title of a conversation that worked several. */
const SHARED_TITLE_CHARS = 48
/** What titles a conversation with no task worked and no prompt or reply. */
const UNTITLED: Span = { text: 'no prompt or reply', dim: true }

/** What titles a conversation: each session's work on its own tasks, and the tasks it names. */
export type Worked = Pick<Snapshot, 'work' | 'tasks'>

/** `text` cut to `max` characters, counted in graphemes so a character is never split, ending in `…` when cut. */
function cut(text: string, max: number): string {
  const parts = graphemes(text)
  return parts.length <= max ? text : `${parts.slice(0, max - 1).join('').trimEnd()}…`
}

/** The tasks the conversation's session worked from its first line until its next conversation began, in the order first worked. */
function tasksOf(conversation: LogConversation, work: Worked['work']): string[] {
  const until = conversation.nextAt ?? Number.POSITIVE_INFINITY
  const worked = work.filter(mark => mark.session === conversation.session && mark.at >= conversation.firstAt && mark.at < until)
  return [...new Set(worked.map(mark => mark.task))]
}

/**
 * A conversation's title: each task it worked, its id bold before its title (cut when it worked several; the id
 * alone for a task the snapshot does not hold), else how it opened, the owner's words plain and Claude's dim; null
 * for one with neither.
 */
export function titleOf(conversation: LogConversation, { work, tasks }: Worked): Span[] | null {
  const ids = tasksOf(conversation, work)
  if (ids.length === 0) {
    const opening = conversation.opening
    if (opening === null) return null
    return [opening.by === 'owner' ? { text: opening.line } : { text: opening.line, dim: true }]
  }
  const titles = new Map(tasks.map(task => [task.id, task.title]))
  return ids.flatMap((id, i): Span[] => {
    const title = titles.get(id)
    const words: Span[] = title === undefined ? [] : [{ text: ` ${ids.length === 1 ? title : cut(title, SHARED_TITLE_CHARS)}` }]
    return [...(i === 0 ? [] : [SEPARATOR]), { text: id, bold: true }, ...words]
  })
}

/** A conversation's title as drawn: titleOf, else a dim line that it has no prompt or reply. */
export function titleSpans(conversation: LogConversation, worked: Worked): Span[] {
  return titleOf(conversation, worked) ?? [UNTITLED]
}
