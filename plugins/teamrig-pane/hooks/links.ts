// The links an open task's card draws (card.ts): the GitHub issue a task came in from, then each web address
// written in its ref, its latest note and its evidence, in that order, each once. Pure: what a press on one
// opens is the surface's. A task id is no link here: card.ts makes each one the snapshot holds a press that opens that task's page (ids.ts).
import type { TaskRow } from '../types'

/** A card draws at most this many links; the rest stay in the text they are written in. */
export const MAX_LINKS = 5
/**
 * The engine refuses a whole tree holding a link whose address is longer than this, once the terminal
 * percent-encodes it (each byte past ASCII as `%XX`): such an address is left out.
 */
export const MAX_ADDRESS_CHARS = 2048
/** teamrig's source for a task a GitHub issue opened (teamrig's src/register/policy.ts GITHUB_SOURCE). */
const GITHUB_SOURCE = 'github'
/**
 * The ref teamrig writes for that task, `gh:<owner>/<repo>#<number>` (teamrig's src/github/map.ts issueRef),
 * the repo spelled as its config check allows one (src/config/parse.ts). Any other ref links to no issue.
 */
const ISSUE_REF = /^gh:([a-z0-9][a-z0-9-]{0,38}\/[a-z0-9._-]{1,100})#([1-9]\d*)$/i
/** A web address as written: `http://` or `https://`, up to the next space. */
export const WEB_ADDRESS = /https?:\/\/\S+/gi
/** What ends a sentence or closes a bracket or a quote around an address, cut from its end. */
const TRAILING = /[.,;:)\]'"]+$/
/** An address with something after its `//`. */
const HAS_HOST = /^https?:\/\/\S/i

/** The issue page of a task teamrig opened from a GitHub issue; null for any other task, or a ref teamrig did not write. */
export function issueUrl(task: Pick<TaskRow, 'source' | 'ref'>): string | null {
  if (task.source !== GITHUB_SOURCE || task.ref === null) return null
  const [, repo, number] = ISSUE_REF.exec(task.ref.trim()) ?? []
  return repo === undefined || number === undefined ? null : `https://github.com/${repo}/issues/${number}`
}

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

/** What a task's card links to: its issue, then the addresses in its ref, note and evidence; each once, at most MAX_LINKS. */
export function taskLinks(task: Pick<TaskRow, 'source' | 'ref' | 'note' | 'evidence'>): string[] {
  const issue = issueUrl(task)
  const written = [task.ref, task.note, task.evidence].flatMap(text => (text === null ? [] : addressesIn(text)))
  return [...new Set([...(issue === null ? [] : [issue]), ...written])].slice(0, MAX_LINKS)
}
