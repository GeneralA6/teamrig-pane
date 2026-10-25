// The Inbox view's lines (T772): the session's own inbox (`<inbox>/<area>.md`), whose lines teamrig writes as
// `- YYYY-MM-DD HH:MM <from>: <text>`, the stamp in UTC (teamrig's inbox/inbox.ts), each read as when it was posted,
// who sent it and its words. The view shows the lines of the last INBOX_WINDOW_HOURS, read ones too, and every line
// past the area's read mark whatever its age; a line with no stamp is left out. The snapshot holds them as the poll
// found them (source.ts), and a drawing keeps those still shown at its own now (inboxShown): the pane's clock moves on
// without a poll. Pure.
import type { InboxItem } from '../types'

/** How far back the Inbox view shows the lines already read. */
export const INBOX_WINDOW_HOURS = 24
const HOUR_MS = 3_600_000
/** A line's stamp, its day and its minute in UTC as teamrig writes it, then the rest of the line. */
const STAMPED = /^- (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) (.*)$/
/** Between the sender and the words: the first one after the stamp. */
const SENDER_END = ': '

/** The key of the file's line at `index` in the view: a line keeps it while no line above it is trimmed. */
export function inboxKey(index: number): string {
  return `inbox:${index}`
}

/** The file's line at `index` as the view reads it, `unread` when it lies past the read mark; null with no stamp. */
export function inboxItemOf(line: string, index: number, unread: boolean): InboxItem | null {
  const [, day, minute, rest] = STAMPED.exec(line) ?? []
  if (day === undefined || minute === undefined || rest === undefined) return null
  const at = Date.parse(`${day}T${minute}:00Z`)
  if (Number.isNaN(at)) return null
  const end = rest.indexOf(SENDER_END)
  const [from, text] = end <= 0 ? [null, rest] : [rest.slice(0, end), rest.slice(end + SENDER_END.length)]
  return { key: inboxKey(index), at, from, text, unread }
}

/**
 * The lines the view shows at `now`, in the file's order: those posted since INBOX_WINDOW_HOURS before it and every
 * unread one. `unreadFrom` is the index of the first line past the read mark; null when the area has no mark, whose
 * count is unknown (source.ts), so no line shows as unread.
 */
export function inboxItems(lines: readonly string[], unreadFrom: number | null, now: number): InboxItem[] {
  const items = lines.flatMap((line, index) => inboxItemOf(line, index, unreadFrom !== null && index >= unreadFrom) ?? [])
  return inboxShown(items, now)
}

/** The items still shown at `now`: the unread ones, and those posted since INBOX_WINDOW_HOURS before it. */
export function inboxShown(items: readonly InboxItem[], now: number): InboxItem[] {
  const since = now - INBOX_WINDOW_HOURS * HOUR_MS
  return items.filter(item => item.unread || item.at >= since)
}
