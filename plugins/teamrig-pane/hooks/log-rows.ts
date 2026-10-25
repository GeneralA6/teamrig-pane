// The Log view as blocks of rows (rows.ts). The list: each conversation of the hours teamrig keeps the turn log
// (turn-log.ts), the newest last line first, titled by the tasks its session worked while it ran, else by how it
// opened (log-title.ts), over its session, its times and its count of lines; a press on one opens its page. While the
// Find field holds a query, the list draws its search (log-search.ts) on the shared search view (search-view.ts)
// instead: the count, then the conversations it names as the list draws them, the words that matched underlined. The
// page: the conversation's lines of those hours, oldest first (the view opens it at its end), under the same title. Each
// prompt and reply is split by who spoke (turn-text.ts): the owner's
// words, Claude's reply, another session's message and a subagent's report each a head (who, when, whether teamrig
// cut it) over its words with their markdown drawn as styles (markdown.ts); a harness notice dim lines led by its
// time. One block per paragraph, as a file page splits them (file-page.ts), so the window draws only the paragraphs
// in sight; a clear or compaction of the context is one dim rule. teamrig writes UTC times; each prints on the team's
// clock, zone-marked (zone.ts). Pure.
import type { LogConversation, LogList, LogPage, LogRead, TurnEntry } from '../types'
import { paragraphs } from './file-page'
import { LOG_SEARCH_VIEW, logResultKey, type LogHit } from './log-search'
import { titleSpans, UNTITLED, type Worked } from './log-title'
import { markdownParagraphs, type MarkParagraph } from './markdown'
import { SEPARATOR, single, type Block, type Row, type Span } from './rows'
import { marksOf, type Mark } from './search'
import { markedRun, markedSpans, searchViewBlocks, type Noun } from './search-view'
import { LOG_PAGE_CHARS } from './turn-log'
import { turnParts, type Speaker, type TurnPart } from './turn-text'
import { momentWords, type Clock } from './zone'

const LIST = 'log'
const PAGE = 'log-page'
/** The most lines a conversation's title takes in the list. */
const TITLE_LINES = 2
/** What an empty Find field shows on the Log view's list. */
export const LOG_SEARCH_HINT = 'Type words to find a conversation by its tasks, how it opened or its session.'
/** A Log search counts conversations. */
const CONVERSATION_NOUN: Noun = { one: 'conversation', many: 'conversations' }

/** What a query no conversation matches shows: the list holds those of the last `hours`. */
export function logNothingFound(hours: number): string {
  return `Nothing matches. The Log view searches its conversations of the last ${hours} h.`
}

/** The Find field's query on the Log view's list and the conversations it names (log-search.ts searchLog), in the list's order. */
export type LogSearch = { query: string; hits: readonly LogHit[] }

/** The key of a conversation's row in the list, the press that opens its page: a return from the page lands on it. */
export function conversationKey(read: LogRead): string {
  return `${LIST}:conv:${read.session}:${read.claude}`
}

/** `21:04 IDT` on the zone's day of the clock's `now`, else `Mon 10-19 21:04 IDT`; an unreadable time as written. */
function timeWords(iso: string, clock: Clock): string {
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? iso : momentWords(ms, clock)
}

function note(key: string, text: string): Block {
  return single(key, [{ text, dim: true }])
}

/** `3 lines`, `1 line`. */
function lineCount(count: number): string {
  return `${count} ${count === 1 ? 'line' : 'lines'}`
}

/**
 * A conversation's row keyed `key`: `title`, over its session (`sessionMarks` underlined), when its first and last
 * lines of the window came and how many; a press opens its page.
 */
function conversationBlock(conversation: LogConversation, clock: Clock, key: string, title: Span[], sessionMarks: readonly Mark[]): Block {
  const read: LogRead = { session: conversation.session, claude: conversation.claude }
  const first = timeWords(new Date(conversation.firstAt).toISOString(), clock)
  const last = timeWords(new Date(conversation.lastAt).toISOString(), clock)
  const when = first === last ? first : `${first}–${last}`
  return {
    key,
    rows: [
      { key, spans: title, maxLines: TITLE_LINES },
      { key: `${key}:what`, spans: markedSpans(`${conversation.session} · ${when} · ${lineCount(conversation.lines)}`, sessionMarks, { dim: true }) },
    ],
    reads: read,
  }
}

/** The search's body: the hint, the line that says nothing matched, or the count and the conversations it names. */
function foundBlocks(search: LogSearch, hours: number, clock: Clock): Block[] {
  const results = search.hits.map(hit => {
    const { conversation, title } = hit.row
    return conversationBlock(conversation, clock, logResultKey(conversation), markedRun(title ?? [UNTITLED], marksOf(hit, 'title')), marksOf(hit, 'session'))
  })
  const total = search.hits.length
  return searchViewBlocks({ key: LOG_SEARCH_VIEW, query: search.query, hint: LOG_SEARCH_HINT, nothing: logNothingFound(hours), noun: CONVERSATION_NOUN, results, shown: total, total })
}

/**
 * The Log view's list at the clock, each conversation titled by what it worked, or why it has none; while `search`
 * holds the Find field's query, the search's body instead.
 */
export function logListBlocks(list: LogList, clock: Clock, worked: Worked, search: LogSearch | null = null): Block[] {
  switch (list.kind) {
    case 'reading':
      return [note(`${LIST}:note`, 'Reading the turn logs…')]
    case 'no-team':
      return [note(`${LIST}:note`, "No team found: the Log view shows a team's turn logs, which teamrig writes for each session.")]
    case 'no-config':
      return [note(`${LIST}:note`, 'No turn logs: the team has no config file, and teamrig writes turn logs only for a team with one.')]
    case 'no-log':
      return [note(`${LIST}:note`, "No turn logs yet: a teamrig with the turn log writes each session's prompts and replies, unless the team config sets turnLog.enabled to false.")]
    case 'failed':
      return [single(`${LIST}:note`, [{ text: `The turn logs could not be read: ${list.reason.replace(/\.$/, '')}.`, color: 'warning' }])]
    case 'conversations':
      if (search !== null) return foundBlocks(search, list.hours, clock)
      if (list.conversations.length === 0) return [note(`${LIST}:note`, `No session wrote a prompt or a reply in the last ${list.hours} h.`)]
      return [
        note(`${LIST}:intro`, `Each conversation of the last ${list.hours} h, titled by the task it worked, the newest first.`),
        ...list.conversations.map(conversation => conversationBlock(conversation, clock, conversationKey(conversation), titleSpans(conversation, worked), [])),
      ]
  }
}

/** A paragraph's lines as rows under `key`, each keyed by its line's number in its part. */
function lineRows(key: string, paragraph: MarkParagraph): Row[] {
  return paragraph.lines.map((line): Row => ({ key: `${key}:line:${line.at}`, spans: line.spans, hang: line.hang, ...(line.rule ? { rule: true } : {}) }))
}

/** A speaker with a head of its own: everyone but the harness, whose notices are dim lines. */
type Voice = Exclude<Speaker, { kind: 'system' }>

/** What a part's head calls who spoke it. */
function voiceSpan(voice: Voice): Span {
  switch (voice.kind) {
    case 'owner':
      return { text: 'owner', bold: true, color: 'suggestion' }
    case 'claude':
      return { text: 'Claude', bold: true, color: 'claude' }
    case 'session':
      return { text: `message from ${voice.name}`, bold: true, color: 'warning' }
    case 'subagent':
      return { text: 'subagent report', bold: true, color: 'subtle' }
  }
}

/** Who heads an entry with no words. */
const SILENT: Readonly<Record<'prompt' | 'reply', Voice>> = { prompt: { kind: 'owner' }, reply: { kind: 'claude' } }

/** A harness notice's blocks under `key`, a paragraph a block: dim lines, `head` (its time, whether it was cut) leading the first. */
function noticeBlocks(text: string, key: string, head: Span[]): Block[] {
  return paragraphs(text).map((paragraph, p): Block => ({
    key: p === 0 ? key : `${key}:para:${paragraph.first}`,
    rows: paragraph.lines.map((line, i): Row => ({
      key: `${key}:line:${paragraph.first + i}`,
      spans: [...(p === 0 && i === 0 ? [...head, SEPARATOR] : []), { text: line, dim: true }],
    })),
  }))
}

/** A part's blocks under `key`: a notice's dim lines, or a head (who spoke, `head`) over its first paragraph, then its others. */
function partBlocks(part: TurnPart, key: string, head: Span[]): Block[] {
  const speaker = part.speaker
  if (speaker.kind === 'system') return noticeBlocks(part.text, key, head)
  const [first, ...rest] = markdownParagraphs(part.text)
  return [
    { key, rows: [{ key, spans: [voiceSpan(speaker), SEPARATOR, ...head] }, ...(first === undefined ? [] : lineRows(key, first))] },
    ...rest.map((paragraph): Block => ({ key: `${key}:para:${paragraph.first}`, rows: lineRows(key, paragraph) })),
  ]
}

/** One entry's blocks under `key`: a clear's rule, or each part of a prompt or reply, its time in each head and the cut mark in the first. */
function entryBlocks(entry: TurnEntry, key: string, clock: Clock): Block[] {
  const when: Span = { text: timeWords(entry.at, clock), dim: true }
  if (entry.kind === 'clear') return [note(key, `── ${when.text} · ${entry.text} ──`)]
  const cut: Span[] = entry.isCut ? [SEPARATOR, { text: 'cut, its end kept', dim: true }] : []
  const parts = turnParts(entry.kind, entry.text)
  if (parts.length === 0) return [single(key, [voiceSpan(SILENT[entry.kind]), SEPARATOR, when, ...cut])]
  return parts.flatMap((part, i) => (i === 0 ? partBlocks(part, key, [when, ...cut]) : partBlocks(part, `${key}:part:${i}`, [when])))
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

/**
 * A conversation's page at the clock: its title as the list draws it, over its session and what it holds (the
 * session's name alone when the list does not hold it), a note for what it leaves out or could not read, then its lines.
 */
export function logPageBlocks(page: LogPage, clock: Clock, list: LogList, worked: Worked): Block[] {
  const count = page.entries.length
  const what = `last ${page.hours} h · ${lineCount(count)}, the newest last`
  const conversation = list.kind === 'conversations' ? list.conversations.find(shown => shown.session === page.session && shown.claude === page.claude) : undefined
  const title: Block = {
    key: PAGE,
    rows:
      conversation === undefined
        ? [
            { key: PAGE, spans: [{ text: page.session, bold: true }] },
            { key: `${PAGE}:what`, spans: [{ text: what, dim: true }] },
          ]
        : [
            { key: PAGE, spans: titleSpans(conversation, worked) },
            { key: `${PAGE}:what`, spans: [{ text: `${page.session} · ${what}`, dim: true }] },
          ],
  }
  const cut = page.isCut ? [note(`${PAGE}:cut`, `Older lines left out: the page holds the newest ${LOG_PAGE_CHARS / 1024} KiB of text.`)] : []
  const problem = page.problem === null ? [] : [single(`${PAGE}:problem`, [{ text: `Not all read: ${page.problem.replace(/\.$/, '')}.`, color: 'warning' }])]
  if (count === 0) return [title, ...problem, note(`${PAGE}:empty`, `Nothing in the last ${page.hours} h.`)]
  const keys = entryKeys(page.entries)
  return [title, ...cut, ...problem, ...page.entries.flatMap((entry, i) => entryBlocks(entry, keys[i] ?? `${PAGE}:${i}`, clock))]
}
