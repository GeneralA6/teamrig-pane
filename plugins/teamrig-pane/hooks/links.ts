// The links an open task's card draws (card.ts): the page of the tracker item its ref names, as teamrig served it
// (tasks-document.ts; the pane knows no tracker's refs or addresses), then each web address written in its
// description, ref, latest note, proof and evidence, in that order, each once. Pure: what a press on one opens is the
// surface's. A task id is no link here: card.ts makes each one the snapshot holds a press that opens that task's page (ids.ts).
import type { TaskRow } from '../types'

/** A card draws at most this many links; the rest stay in the text they are written in. */
export const MAX_LINKS = 5
/**
 * The engine refuses a whole tree holding a link whose address is longer than this, once the terminal
 * percent-encodes it (each byte past ASCII as `%XX`): such an address is left out.
 */
export const MAX_ADDRESS_CHARS = 2048
/** A web address as written: `http://` or `https://`, up to the next space. */
export const WEB_ADDRESS = /https?:\/\/\S+/gi
/** What ends a sentence or closes a bracket or a quote around an address, cut from its end. */
const TRAILING = /[.,;:)\]'"]+$/
/** An address with something after its `//`. */
const HAS_HOST = /^https?:\/\/\S/i

/** How long `address` is once each byte past ASCII is percent-encoded: three characters a byte. */
function encodedLength(address: string): number {
  let length = 0
  for (const character of address) {
    const point = character.codePointAt(0) ?? 0
    length += point < 0x80 ? 1 : point < 0x800 ? 6 : point < 0x10000 ? 9 : 12
  }
  return length
}

/** The web addresses written in `text`, in order, the punctuation around each cut from its end. */
export function addressesIn(text: string): string[] {
  return [...text.matchAll(WEB_ADDRESS)]
    .map(match => match[0].replace(TRAILING, ''))
    .filter(address => HAS_HOST.test(address) && encodedLength(address) <= MAX_ADDRESS_CHARS)
}

/**
 * A page address teamrig served, as the pane takes one for a link: `https://` only, and whole as an address written
 * in a text reads here (no space, no closing punctuation at its end, short enough to draw); null for any other, so a
 * served address is never trusted further than a written one.
 */
export function pageOf(url: string | null): string | null {
  if (url === null || !url.startsWith('https://')) return null
  return addressesIn(url)[0] === url ? url : null
}

/**
 * What a task's card links to: its tracker item's page, then the addresses in its description, ref, note, proof and
 * evidence; each once, at most MAX_LINKS.
 */
export function taskLinks(task: Pick<TaskRow, 'item' | 'description' | 'ref' | 'note' | 'proof' | 'evidence'>): string[] {
  const page = task.item?.url ?? null
  const written = [task.description, task.ref, task.note, task.proof, task.evidence].flatMap(text => (text === null ? [] : addressesIn(text)))
  return [...new Set([...(page === null ? [] : [page]), ...written])].slice(0, MAX_LINKS)
}
