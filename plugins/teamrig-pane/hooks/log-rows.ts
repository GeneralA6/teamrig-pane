// The Log view as blocks of rows (rows.ts). The list: each team session with a turn log file of the last LOG_HOURS
// (turn-log.ts), the newest change first, its id bold and when its log last changed, over its newest prompt's first
// line; a press on a session opens its page. The page: the session's lines of the last LOG_HOURS, oldest first (the
// view opens it at its end), each prompt and reply a head (what it is, when, whether teamrig cut it) over its text,
// one block per paragraph as a file page splits them (file-page.ts), so the window draws only the paragraphs in
// sight; a clear or compaction of the context is one dim rule. teamrig writes UTC times; each prints on the team's
// clock, zone-marked (zone.ts). Pure.
import type { LogList, LogPage, LogSession, TurnEntry } from '../types'
import { paragraphs, type Paragraph } from './file-page'
import { SEPARATOR, single, type Block, type Row, type Span } from './rows'
import { LOG_HOURS, LOG_PAGE_CHARS } from './turn-log'
import { dayOf, type Clock } from './zone'

const LIST = 'log'
const PAGE = 'log-page'
/** The most lines a session's newest prompt takes in the list. */
const PROMPT_LINES = 2

/** The key of a session's row in the list, the press that opens its page: a return from the page lands on it. */
export function sessionKey(id: string): string {
  return `${LIST}:session:${id}`
}

/** `21:04 IDT` on the zone's day of the clock's `now`, else `Mon 10-19 21:04 IDT`; an unreadable time as written. */
function timeWords(iso: string, { now, zone }: Clock): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return iso
  const date = new Date(ms)
  return dayOf(ms, zone) === dayOf(now, zone) ? zone.clock(date) : zone.weekdayMinute(date)
}

function note(key: string, text: string): Block {
  return single(key, [{ text, dim: true }])
}

/** A session's row: its id and when its log last changed, over its newest prompt; a press opens its page. */
function sessionBlock(session: LogSession, clock: Clock): Block {
  const key = sessionKey(session.id)
  const when = timeWords(new Date(session.changedAt).toISOString(), clock)
  const prompt = session.lastPrompt ?? `no prompt in the last ${LOG_HOURS} h`
  return {
    key,
    rows: [
      { key, spans: [{ text: session.id, bold: true }, SEPARATOR, { text: when, dim: true }] },
      { key: `${key}:prompt`, spans: [{ text: prompt, dim: true }], maxLines: PROMPT_LINES },
    ],
    reads: session.id,
  }
}

/** The Log view's list at the clock, or why it has none. */
export function logListBlocks(list: LogList, clock: Clock): Block[] {
  switch (list.kind) {
    case 'reading':
      return [note(`${LIST}:note`, 'Reading the turn logs…')]
    case 'no-team':
      return [note(`${LIST}:note`, "No team found: the Log view shows a team's turn logs, which teamrig writes for each session.")]
    case 'no-log':
      return [note(`${LIST}:note`, "No turn logs yet: a teamrig with the turn log writes each session's prompts and replies, unless the team config sets turnLog.enabled to false.")]
    case 'failed':
      return [single(`${LIST}:note`, [{ text: `The turn logs could not be read: ${list.reason.replace(/\.$/, '')}.`, color: 'warning' }])]
    case 'sessions':
      if (list.sessions.length === 0) return [note(`${LIST}:note`, `No session wrote a prompt or a reply in the last ${LOG_HOURS} h.`)]
      return [
        note(`${LIST}:intro`, `Each session's prompts and replies of the last ${LOG_HOURS} h, the newest change first.`),
        ...list.sessions.map(session => sessionBlock(session, clock)),
      ]
  }
}

/** A paragraph's lines, each wrapping under its own indent. */
function lineRows(key: string, paragraph: Paragraph): Row[] {
  return paragraph.lines.map((text, i): Row => {
    const indent = text.slice(0, text.length - text.trimStart().length)
    return { key: `${key}:line:${paragraph.first + i}`, spans: [{ text }], hang: indent === '' ? undefined : { text: indent } }
  })
}

/** What an entry's head calls it. */
const KIND_WORDS: Readonly<Record<'prompt' | 'reply', Span>> = {
  prompt: { text: 'prompt', bold: true, color: 'suggestion' },
  reply: { text: 'reply', bold: true, color: 'claude' },
}

/** One entry's blocks under `key`: a clear's rule, or a prompt's or reply's head with its first paragraph, then its other paragraphs. */
function entryBlocks(entry: TurnEntry, key: string, clock: Clock): Block[] {
  const when = timeWords(entry.at, clock)
  if (entry.kind === 'clear') return [note(key, `── ${when} · ${entry.text} ──`)]
  const cut: Span[] = entry.isCut ? [SEPARATOR, { text: 'cut, its end kept', dim: true }] : []
  const head: Row = { key, spans: [KIND_WORDS[entry.kind], SEPARATOR, { text: when, dim: true }, ...cut] }
  const [first, ...rest] = paragraphs(entry.text)
  return [
    { key, rows: [head, ...(first === undefined ? [] : lineRows(key, first))] },
    ...rest.map((paragraph): Block => ({ key: `${key}:para:${paragraph.first}`, rows: lineRows(key, paragraph) })),
  ]
}

/** Each entry's key: its time and kind, with a count where two share them, so a key holds while older lines leave the window. */
function entryKeys(entries: readonly TurnEntry[]): string[] {
  const seen = new Map<string, number>()
  return entries.map(entry => {
    const base = `${PAGE}:${entry.at}:${entry.kind}`
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return count === 0 ? base : `${base}:${count}`
  })
}

/** A session's page at the clock: its name and what it holds, a note for what it leaves out or could not read, then its lines. */
export function logPageBlocks(page: LogPage, clock: Clock): Block[] {
  const count = page.entries.length
  const title: Block = {
    key: PAGE,
    rows: [
      { key: PAGE, spans: [{ text: page.session, bold: true }] },
      { key: `${PAGE}:what`, spans: [{ text: `last ${LOG_HOURS} h · ${count} ${count === 1 ? 'line' : 'lines'}, the newest last`, dim: true }] },
    ],
  }
  const cut = page.isCut ? [note(`${PAGE}:cut`, `Older lines left out: the page holds the newest ${LOG_PAGE_CHARS / 1024} KiB of text.`)] : []
  const problem = page.problem === null ? [] : [single(`${PAGE}:problem`, [{ text: `Not all read: ${page.problem.replace(/\.$/, '')}.`, color: 'warning' }])]
  if (count === 0) return [title, ...problem, note(`${PAGE}:empty`, `Nothing in the last ${LOG_HOURS} h.`)]
  const keys = entryKeys(page.entries)
  return [title, ...cut, ...problem, ...page.entries.flatMap((entry, i) => entryBlocks(entry, keys[i] ?? `${PAGE}:${i}`, clock))]
}
