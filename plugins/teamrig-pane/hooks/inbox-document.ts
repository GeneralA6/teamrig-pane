// The Inbox view's lines from teamrig's `inbox` document (T4742): each served line read field by field into the item
// the view already draws (types/index.d.ts InboxItem), so nothing downstream changes with where a line came from. The
// document serves a line's words as marked text; an item keeps the words. Its key is the one teamrig serves, which a
// line keeps while the file holds it, where the file fold could only count lines from the top. A line teamrig serves
// with no date is passed over, as the file fold left out a line with no stamp: the view orders and windows its lines
// by when they were posted. A line with a field the pane cannot read is left out, and the left-out lines are told in
// one line rather than drawn wrong. For a session that never read its inbox teamrig serves `unread: null` and every
// line as unread; the pane draws none of them as unread, as it did from the file: a count nobody knows is not
// everything, and the view would otherwise show the whole file as new. The document holds the read lines of the hours
// teamrig was asked for, not the pane's own window, so the view still keeps those it shows at its own now (inbox.ts
// inboxShown). An `unchanged` answer holds no lines, so it is never handed here. Pure.
import type { InboxItem } from '../types'
import { Fields, isList, leftOutLine, type BodyRead } from './document-fields'
import { isRecord, type ReadDocument } from './read-document'

/** What the `inbox` document says of one session's inbox. */
export type InboxRead = {
  /** The session whose inbox it is: the one the read ran as. */
  readonly session: { readonly id: string; readonly name: string }
  /** How many lines the session has not read; null when it never read its inbox. */
  readonly unread: number | null
  /** The served lines that carry a date, in the file's order. */
  readonly items: readonly InboxItem[]
}

type LineRead = { readonly kind: 'item'; readonly item: InboxItem } | { readonly kind: 'undated' } | { readonly kind: 'left-out'; readonly why: string }

/**
 * The item of one served line, none for a line with no date, or which line was left out and the first field that
 * could not be read. `counted` is false for a session that never read its inbox, whose lines draw as read.
 */
function lineOf(value: unknown, counted: boolean): LineRead {
  if (!isRecord(value)) return { kind: 'left-out', why: 'an entry that is no line' }
  const line = new Fields(value)
  const key = line.text('key')
  const at = line.momentOrNull('at')
  const from = line.textOrNull('from')
  const text = line.part('text').text('text')
  const unread = line.flag('unread')
  const bad = line.bad
  const [first] = bad
  if (first !== undefined) return { kind: 'left-out', why: `${bad.includes('key') ? 'a line' : key} (${first})` }
  return at === null ? { kind: 'undated' } : { kind: 'item', item: { key, at, from, text, unread: counted && unread } }
}

/**
 * The inbox `document` serves, with the lines left out told in one line; unreadable with no session, no count or no
 * line list, which every `inbox` document of this major holds.
 */
export function inboxOf(document: ReadDocument): BodyRead<InboxRead> {
  const head = new Fields(document.fields)
  const who = head.part('session')
  const session = { id: who.text('id'), name: who.text('name') }
  const unread = head.numberOrNull('unread')
  const [missing] = head.bad
  if (missing !== undefined) return { kind: 'unreadable', reason: `teamrig's inbox document cannot be read (${missing}): update teamrig` }
  const served = document.fields['lines']
  if (!isList(served)) return { kind: 'unreadable', reason: "teamrig's inbox document holds no line list: update teamrig" }
  const items: InboxItem[] = []
  const left: string[] = []
  for (const read of served.map(value => lineOf(value, unread !== null))) {
    if (read.kind === 'item') items.push(read.item)
    if (read.kind === 'left-out') left.push(read.why)
  }
  return { kind: 'read', value: { session, unread, items }, problems: left.length === 0 ? [] : [leftOutLine('line', left)] }
}
