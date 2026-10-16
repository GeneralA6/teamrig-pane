// The task ids in an open card's words (card.ts): each id the snapshot holds becomes a span of its own, marked
// with the task it names, which register.tsx draws underlined and a press on opens as that task's page. An id
// the snapshot does not hold (a task finished over HELD_DAYS ago, done.ts, or one never made) stays in the words, as written,
// and so does one inside a web address (links.ts draws those). teamrig spells an id `T` and a number from 1 (its
// register's TASK_ID), a word of its own: `T6,`, `(T6)` and `T6-T9` hold ids; `T06`, `T6a`, `AT6` and `T6_x`
// none. Pure.
import { WEB_ADDRESS } from './links'
import type { Span } from './rows'

/** An id as a whole word, where a word is what `\b` bounds: letters, digits and `_`. */
const ID = /\bT[1-9]\d*\b/g

/**
 * `span` split around each id `isKnown` holds outside a web address, those spans marked with their task (`task`),
 * every span in its style. A span with no such id comes back alone, as it was.
 */
export function idSpans(span: Span, isKnown: (id: string) => boolean): Span[] {
  const addresses = [...span.text.matchAll(WEB_ADDRESS)].map(match => ({ from: match.index, to: match.index + match[0].length }))
  const isInAddress = (at: number) => addresses.some(address => at >= address.from && at < address.to)
  const out: Span[] = []
  let from = 0
  for (const match of span.text.matchAll(ID)) {
    const id = match[0]
    if (!isKnown(id) || isInAddress(match.index)) continue
    if (match.index > from) out.push({ ...span, text: span.text.slice(from, match.index) })
    out.push({ ...span, text: id, task: id })
    from = match.index + id.length
  }
  if (from === 0) return [span]
  if (from < span.text.length) out.push({ ...span, text: span.text.slice(from) })
  return out
}
