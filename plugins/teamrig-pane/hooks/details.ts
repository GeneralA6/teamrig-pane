// The ask behind a task, quoted from where its ref points, for the card an open task shows (card.ts).
// A ref is `file:line` parts, and a line number drifts when its file is rewritten, so a line is
// quoted only when something still ties it to the task:
// - an inbox line (`inbox/<area>.md`) by its date. teamrig only appends to an inbox until someone
//   trims or rewrites it, so line N stays the line that asked; one dated more than a day after the
//   task was created means the inbox was trimmed or rewritten since.
// - any other line by its goal or the task's id. It must be a roadmap item (`- [ ] G10.1e ...`,
//   `- S4 ...`) of one of the task's goals, sit inside one, or name the task (boards cite register
//   ids). Other board and agenda lines are only named (T6's board/po.md:6 came to hold another item).
// Each goal's own roadmap item is read too, found by its id rather than a line number, so a task
// whose refs quote nothing still says what it serves; one a ref already quoted is not read twice.
// Quotes read as plain text: bullet, checkbox, bold and code marks stripped, a long line cut between
// characters (graphemes, width.ts), never inside an emoji.
import type { GoalItem, RefQuote, TaskDetail, TaskRow } from '../types'
import { slashed, type Files } from './source'
import { graphemes } from './width'

/** `path:N`, `path:N-M` (a range) or `path:N,M` (two lines). */
const LINE_REF = /^(.+):(\d+)(?:([-,])(\d+))?$/
/** The inbox file a path names, however it spells the directory (`~/`, absolute, either slash). */
const INBOX_FILE = /(?:^|[\\/])inbox[\\/]([a-z][a-z0-9-]{0,31})\.md$/
/** An inbox line as `>>` appends it: `- 2026-10-13 09:12 ...`, its bullet sometimes left out. */
const DATED_LINE = /^(?:- )?(\d{4}-\d{2}-\d{2})\b/
/** A roadmap item for a goal, `  - [~] G10.1h **title**` or `  - S4 title`: its indent and goal id. */
const GOAL_ITEM = /^(\s*)- (?:\[.\] )?(?:\*\*)?(G\d+(?:\.\d+)*[a-z]?|S\d+[a-z]?)\b/
const HEADING = /^#{1,6} /
const ABSOLUTE = /^(?:[A-Za-z]:)?\//
const DAY_MS = 86_400_000
/** Most lines one ref quotes. */
export const MAX_QUOTED_LINES = 3
/** Longest quoted line, in characters (graphemes); the rest stays in the file. */
export const MAX_QUOTE_CHARS = 320

/** A ref part's file and the line numbers it points at. */
export type LineRef = { file: string; lines: number[] }
/**
 * Where ref files are found: inboxes in the register's inbox folder, `~/` under home, a relative
 * path up from the session's folder, then in the team's folder (`teamDir`, which holds the team's `notes/`);
 * `goalsDoc` is where goal items are looked up by id (null: none are quoted).
 */
export type RefPlaces = { inboxDir: string | null; home: string | null; cwd: string | null; teamDir: string | null; goalsDoc: string | null }

/** A ref's parts: `;`-separated, each a `file:line` ref or a short quote ref; none for a task with no ref. */
export function refParts(ref: string | null): string[] {
  if (ref === null) return []
  return ref
    .split(';')
    .map(part => part.trim())
    .filter(part => part !== '')
}

/** The file and lines a ref part points at (a range capped at MAX_QUOTED_LINES); null for a quote ref. */
export function lineRef(part: string): LineRef | null {
  const [, file, first, separator, second] = LINE_REF.exec(part) ?? []
  if (file === undefined || first === undefined) return null
  const from = Number(first)
  const to = second === undefined ? from : Number(second)
  if (from < 1 || to < from) return null
  if (separator === ',') return { file, lines: [from, to] }
  const count = Math.min(to - from + 1, MAX_QUOTED_LINES)
  return { file, lines: Array.from({ length: count }, (_, i) => from + i) }
}

/** The area whose inbox a file is; null for any other file. */
export function inboxArea(file: string): string | null {
  return INBOX_FILE.exec(file)?.[1] ?? null
}

/** A file as a person reads it: its folder and name. */
export function fileLabel(file: string): string {
  return slashed(file).split('/').slice(-2).join('/')
}

/** A folder and each folder above it, nearest first. */
function foldersUp(folder: string): string[] {
  const parts = slashed(folder).split('/')
  return parts.map((_, i) => parts.slice(0, parts.length - i).join('/'))
}

/**
 * Every path a ref's file may be at, nearest first: refs are written relative to the workspace root, or to the
 * team's folder (`notes/api/t26-findings.md`).
 */
export function candidatePaths(file: string, places: RefPlaces): string[] {
  const path = slashed(file)
  const area = inboxArea(path)
  if (area !== null) return places.inboxDir === null ? [] : [`${slashed(places.inboxDir)}/${area}.md`]
  if (path.startsWith('~/')) return places.home === null ? [] : [`${slashed(places.home)}/${path.slice(2)}`]
  if (ABSOLUTE.test(path)) return [path]
  const up = places.cwd === null ? [] : foldersUp(places.cwd)
  const team = places.teamDir === null ? [] : [slashed(places.teamDir)]
  return [...up, ...team].map(folder => `${folder}/${path}`)
}

/** A quoted line as plain text, cut at MAX_QUOTE_CHARS characters. */
export function plainText(line: string): string {
  const text = line.trim().replace(/^- (?:\[.\] )?/, '').replaceAll('**', '').replaceAll('`', '')
  if (text.length <= MAX_QUOTE_CHARS) return text
  const parts = graphemes(text)
  return parts.length <= MAX_QUOTE_CHARS ? text : `${parts.slice(0, MAX_QUOTE_CHARS - 1).join('').trimEnd()}…`
}

/** The day a dated inbox line was written, or null when it is not dated. */
function lineDay(line: string): number | null {
  const day = DATED_LINE.exec(line)?.[1]
  return day === undefined ? null : Date.parse(day)
}

/**
 * Inbox lines, quoted; null when one is missing, the first is undated, or any is dated more than a
 * day after `createdAt` (a day of slack for local-time stamps).
 */
export function datedLines(content: string, lines: readonly number[], createdAt: string): string[] | null {
  const all = content.split('\n')
  const latest = Date.parse(createdAt.slice(0, 10)) + DAY_MS
  const quoted: string[] = []
  for (const [index, number] of lines.entries()) {
    const line = all[number - 1]?.trimEnd()
    if (line === undefined) return null
    const day = lineDay(line)
    if ((day === null && index === 0) || (day !== null && day > latest)) return null
    quoted.push(plainText(line))
  }
  return quoted
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length
}

/**
 * The goal a line belongs to: its own item's goal id, else that of the goal item it sits inside
 * (each less indented line above it is the item holding it). Null outside any goal item, and a
 * heading ends the search.
 */
export function governingGoal(all: readonly string[], index: number): string | null {
  const own = all[index]
  if (own === undefined) return null
  const self = GOAL_ITEM.exec(own)?.[2]
  if (self !== undefined) return self
  let indent = indentOf(own)
  for (let i = index - 1; i >= 0 && indent > 0; i--) {
    const line = all[i] ?? ''
    if (HEADING.test(line)) return null
    if (line.trim() === '' || indentOf(line) >= indent) continue
    const goal = GOAL_ITEM.exec(line)?.[2]
    if (goal !== undefined) return goal
    indent = indentOf(line)
  }
  return null
}

/** Whether a task goal covers a line's goal: the same id, or a sub-goal (G10.2 covers G10.2c, not G10.20). */
export function coversGoal(taskGoal: string, lineGoal: string): boolean {
  return lineGoal === taskGoal || (lineGoal.startsWith(taskGoal) && /[a-z.]/.test(lineGoal.charAt(taskGoal.length)))
}

/** Whether a line names the task by its id (`T41`, not `T410`). */
function namesTask(line: string, id: string): boolean {
  return line.split(/[^A-Za-z0-9]+/).includes(id)
}

/** Doc lines, quoted; null when one is missing, blank, or neither inside one of the task's goals nor naming the task. */
export function anchoredLines(
  content: string,
  lines: readonly number[],
  task: Pick<TaskRow, 'id' | 'goals'>,
): string[] | null {
  const all = content.split('\n').map(line => line.trimEnd())
  const quoted: string[] = []
  for (const number of lines) {
    const line = all[number - 1]
    if (line === undefined || line.trim() === '') return null
    const goal = governingGoal(all, number - 1)
    const inGoal = goal !== null && task.goals.some(taskGoal => coversGoal(taskGoal, goal))
    if (!inGoal && !namesTask(line, task.id)) return null
    quoted.push(plainText(line))
  }
  return quoted
}

/** The goal's own item as plain text: the first line whose item id is the goal; null when it has none. */
export function goalItem(content: string, goal: string): string | null {
  const line = content.split('\n').find(each => GOAL_ITEM.exec(each)?.[2] === goal)
  return line === undefined ? null : plainText(line)
}

/** Reads the lines a task's refs point at, and its goals' items, when the person opens its card. */
export class TaskDetails {
  private readonly files: Files
  private readonly places: RefPlaces

  constructor(files: Files, places: RefPlaces) {
    this.files = files
    this.places = places
  }

  async load(task: TaskRow): Promise<TaskDetail> {
    const quotes: RefQuote[] = []
    for (const part of refParts(task.ref)) {
      const lines = await this.quote(part, task)
      if (lines !== null) quotes.push({ ref: part, lines })
    }
    return { ref: task.ref, quotes, goals: await this.goalItems(task, quotes) }
  }

  /** The part's lines while they still say what the task points at; null when they cannot be quoted. */
  private async quote(part: string, task: TaskRow): Promise<string[] | null> {
    const ref = lineRef(part)
    if (ref === null) return null
    const content = await this.firstFile(candidatePaths(ref.file, this.places))
    if (content === null) return null
    return inboxArea(ref.file) === null ? anchoredLines(content, ref.lines, task) : datedLines(content, ref.lines, task.createdAt)
  }

  /** The items of the task's goals that its refs did not already quote, in the goals' order. */
  private async goalItems(task: TaskRow, quoted: readonly RefQuote[]): Promise<GoalItem[]> {
    const doc = this.places.goalsDoc
    if (doc === null || task.goals.length === 0) return []
    const content = await this.firstFile(candidatePaths(doc, this.places))
    if (content === null) return []
    const shown = new Set(quoted.flatMap(quote => quote.lines))
    return task.goals.flatMap(goal => {
      const text = goalItem(content, goal)
      return text === null || shown.has(text) ? [] : [{ goal, text }]
    })
  }

  private async firstFile(paths: readonly string[]): Promise<string | null> {
    for (const path of paths) if ((await this.files.stamp(path)) !== null) return this.files.read(path)
    return null
  }
}
