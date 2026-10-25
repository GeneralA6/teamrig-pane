// Who said a turn log line's words, and the words without the harness's tags, for the Log page (log-rows.ts). A
// prompt Claude Code hands a session can carry the harness's own words in tags, around or instead of the person's: a
// background command's or a monitor's notice (<task-notification>), a hook's or the harness's reminder
// (<system-reminder>), another session's message (<cross-session-message>) and a subagent's report
// (<agent-message>). Each becomes a part of its own: a notice its summary over its event, its ids, status and
// output-file path dropped; a reminder its words, a Stop hook's named by its command; a message its words under its
// sender's name; a report its words without the harness's frame or indent. The words outside the tags are the
// person's, and a reply is Claude's. A tag it does not know stays as written. Pure.

/** Who a part's words are from: the person at the tab, Claude, the harness, another session by its name, or a subagent. */
export type Speaker =
  | { readonly kind: 'owner' }
  | { readonly kind: 'claude' }
  | { readonly kind: 'system' }
  | { readonly kind: 'session'; readonly name: string }
  | { readonly kind: 'subagent' }

/** One speaker's words in a line: trimmed, never empty. */
export type TurnPart = { readonly speaker: Speaker; readonly text: string }

const OWNER: Speaker = { kind: 'owner' }
const SYSTEM: Speaker = { kind: 'system' }
/** A tag the harness wraps its own words in, its attributes and what it holds. */
const HARNESS_TAG = /<(task-notification|system-reminder|cross-session-message|agent-message)(\s[^>]*)?>([\s\S]*?)<\/\1>/g
const ATTRIBUTE = /([a-z-]+)="([^"]*)"/g
/** The notice that only heads the Stop hook's reminder after it, which says what the hook said. */
const STOP_HOOK_FEEDBACK = 'Stop hook feedback'
/** How the harness frames what a Stop hook's command answered: its command, then its words. */
const STOP_HOOK_FRAME = /^Stop hook blocking error from command "([^"]*)":\s*/
/** The first line of the harness's frame above a subagent's report. */
const REPORT_FRAME = /^\[Subagent hand-back\][^\n]*\n/

/** `inner`'s `<name>` field, trimmed; undefined for none. */
function field(inner: string, name: string): string | undefined {
  return new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(inner)?.[1]?.trim()
}

function attributes(text: string): Map<string, string> {
  return new Map([...text.matchAll(ATTRIBUTE)].map(([, name = '', value = '']) => [name, value]))
}

/** `text`'s lines without the indent they all share. */
function dedent(text: string): string {
  const lines = text.split('\n')
  const indents = lines.filter(line => line.trim() !== '').map(line => line.length - line.trimStart().length)
  const shared = indents.length === 0 ? 0 : Math.min(...indents)
  return lines.map(line => line.slice(Math.min(shared, line.length - line.trimStart().length))).join('\n')
}

/** What a notice says: its summary over its event; the tags' text when it has neither; null when it only heads the reminder after it. */
function noticeText(inner: string): string | null {
  const summary = field(inner, 'summary')
  const event = field(inner, 'event')
  if (summary === STOP_HOOK_FEEDBACK && event === undefined) return null
  if (summary === undefined && event === undefined) return inner.replace(/<[^>]*>/g, '').trim()
  return [summary, event].filter(part => part !== undefined && part !== '').join('\n')
}

/** The part a harness tag holds, or null for one that says nothing. */
function tagPart(tag: string, attrs: string, inner: string): TurnPart | null {
  switch (tag) {
    case 'task-notification': {
      const text = noticeText(inner)
      return text === null ? null : { speaker: SYSTEM, text }
    }
    case 'system-reminder':
      return { speaker: SYSTEM, text: inner.trim().replace(STOP_HOOK_FRAME, (_, command: string) => `Stop hook "${command}": `) }
    case 'cross-session-message': {
      const found = attributes(attrs)
      return { speaker: { kind: 'session', name: found.get('from-name') ?? found.get('from') ?? 'another session' }, text: inner.trim() }
    }
    case 'agent-message':
      return { speaker: { kind: 'subagent' }, text: dedent(inner.replace(/^\s*\n/, '').replace(REPORT_FRAME, '')).trim() }
    default:
      return null
  }
}

/** A prompt's parts in order: each harness tag's own, and the person's words between them. */
function promptParts(text: string): TurnPart[] {
  const parts: TurnPart[] = []
  const words = (from: number, to: number) => {
    const said = text.slice(from, to).trim()
    if (said !== '') parts.push({ speaker: OWNER, text: said })
  }
  let at = 0
  for (const match of text.matchAll(HARNESS_TAG)) {
    words(at, match.index)
    const part = tagPart(match[1] ?? '', match[2] ?? '', match[3] ?? '')
    if (part !== null && part.text !== '') parts.push(part)
    at = match.index + match[0].length
  }
  words(at, text.length)
  return parts
}

/** A prompt's or reply's parts, who said each and its words; none for an empty text. */
export function turnParts(kind: 'prompt' | 'reply', text: string): TurnPart[] {
  if (kind === 'prompt') return promptParts(text)
  const said = text.trim()
  return said === '' ? [] : [{ speaker: { kind: 'claude' }, text: said }]
}
