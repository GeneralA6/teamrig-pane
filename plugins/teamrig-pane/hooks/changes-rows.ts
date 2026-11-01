// The Changes view as blocks of rows (rows.ts): per repo a ruled header (its folder, `branch <name>` unless
// the folder bears its name, and how many files changed; only the folder while git can't read it),
// its files under it as its card, each row what git's two-letter code says in words (`changed`, `renamed`, `new`…,
// a staged change marked `(staged)`), the path and its lines added and removed (`binary` for a binary file); then
// the files written outside any repo, by path, as the card of their own ruled header. A dim line that says a press
// opens a diff leads the first repo with one to open, or the outside files when no repo has one. Each file's row is a
// press of its own that opens its diff (diff.ts) under it, `+` lines green and `-` red, each cut at DIFF_LINE_ROWS
// screen lines; an untracked folder has no diff to open. The switch's badge and the tab
// title count the same files. While the Find field holds a query, the view draws its search (changes-search.ts) on
// the shared search view (search-view.ts) instead: the count, then each file it names as its row draws it, over its
// repo and branch, the words that matched underlined; a press on one opens its diff under it.
import type { ChangesSnapshot, DiffLine, FileChange, FileDiff, LineCount, OpenDiffs, RepoChanges } from '../types'
import { changeCount, repoName } from './changes'
import { CHANGES_SEARCH_VIEW, changesResultKey, diffKeyOf, type ChangeHit } from './changes-search'
import { NO_DIFFS, OUTSIDE, type DiffFile } from './diff'
import { heading, single, type Block, type Row, type Span } from './rows'
import { marksOf, type Mark } from './search'
import { markedSpans, searchViewBlocks, type Noun } from './search-view'

/** The cells a file's row gives what changed, the longest word (`conflict`) and a space, so the paths line up. */
const CHANGE_COLUMNS = 'conflict '.length
/** Where a wrapped path goes on: under the path, past what changed; where a result's place goes too. */
const UNDER_PATH: Span = { text: ' '.repeat(CHANGE_COLUMNS) }
/** Where an open diff's lines start, under its file's row: indented less than the path, so a narrow dock keeps room for them. */
const UNDER_ROW: Span = { text: '   ' }
/** Where a wrapped diff line goes on: under its text, past its marker. */
const UNDER_DIFF_TEXT: Span = { text: `${UNDER_ROW.text} ` }
/** The dim line over the first repo's files with a diff to open. */
export const DIFF_HINT = 'click a file for its diff'
/** A detached repo's branch, or one git did not name. */
const NO_BRANCH = 'no branch'
/** The most screen lines one diff line wraps onto, the last ending in `…`: a minified line would fill the pane. */
export const DIFF_LINE_ROWS = 3
/** What an empty Find field shows on the Changes view. */
export const CHANGES_SEARCH_HINT = 'Type words to find a changed file by its path, its repo or its branch.'
/** What a query no file matches shows. */
export const CHANGES_NOTHING_FOUND = 'Nothing matches. The Changes view searches the files changed in its repos and those written outside git.'
/** A Changes search counts files. */
const FILE_NOUN: Noun = { one: 'file', many: 'files' }

/** The Find field's query on the Changes view and the files it names (changes-search.ts searchChanges), in the view's order. */
export type ChangesSearch = { query: string; hits: readonly ChangeHit[] }
/** Where a query's words matched in a file's path and in the path it was renamed from. */
type FileMarks = { path: readonly Mark[]; from: readonly Mark[] }
const UNMARKED: FileMarks = { path: [], from: [] }

/** `Changes 3`, the changed files counted, or `Changes` while nothing changed: the switch's button. */
export function changesLabel(changes: ChangesSnapshot): string {
  const count = changeCount(changes)
  return count > 0 ? `Changes ${count}` : 'Changes'
}

/** `Tasks · 3 changed`, or `Tasks` while nothing changed: the pane's tab title. */
export function paneTitle(changes: ChangesSnapshot): string {
  const count = changeCount(changes)
  return count > 0 ? `Tasks · ${count} changed` : 'Tasks'
}

/** What a letter of git's code says changed: `M` and `T` (its type) changed, `A` added, `D` deleted, `R` renamed, `C` copied. */
function letterWord(letter: string): string {
  switch (letter) {
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    default:
      return 'changed'
  }
}

/** True for the codes git gives a file a merge left in conflict: either side `U`, or both added or both deleted. */
function isConflict(code: string): boolean {
  return code.includes('U') || code === 'AA' || code === 'DD'
}

/** What a file's code says in words, and what it adds after the file: where the change is, and the second change made since it was staged. */
type ChangeWords = { word: Span; after: string | null }

/**
 * Git's two-letter code (`XY`: the index's letter, then the work tree's) in words: an untracked file `new` (dim), not
 * in git yet; a conflict `conflict` in red; a staged change its word in green, `staged`, and what changed in the work
 * tree since; a change in the work tree alone its word in yellow.
 */
export function changeWords(code: string): ChangeWords {
  if (code === '??') return { word: { text: 'new', dim: true }, after: 'not in git yet' }
  if (isConflict(code)) return { word: { text: 'conflict', color: 'error' }, after: null }
  const [index = ' ', tree = ' '] = code
  if (index === ' ') return { word: { text: letterWord(tree), color: 'warning' }, after: null }
  return { word: { text: letterWord(index), color: 'success' }, after: tree === ' ' ? 'staged' : `staged, ${letterWord(tree)} since` }
}

/** A file's changed lines: `+12` added in green, `-3` removed in red, `+0 -0` dim when neither (a mode change, an empty file); nothing while uncounted. */
export function lineSpans(lines: LineCount | null): Span[] {
  if (lines === null) return []
  if (lines.kind === 'binary') return [{ text: ' binary', dim: true }]
  if (lines.added === 0 && lines.removed === 0) return [{ text: ' +0 -0', dim: true }]
  const added: Span[] = lines.added > 0 ? [{ text: ` +${lines.added}`, color: 'success' }] : []
  const removed: Span[] = lines.removed > 0 ? [{ text: ` -${lines.removed}`, color: 'error' }] : []
  return [...added, ...removed]
}

/** `text` after `lead`, in `style`, its `marks` (counted in `text`) underlined: one span while none are. */
function ledSpans(lead: string, text: string, marks: readonly Mark[], style: Omit<Span, 'text'>): Span[] {
  return markedSpans(`${lead}${text}`, marks.map(mark => ({ start: mark.start + lead.length, end: mark.end + lead.length })), style)
}

/** What changed in a file (changeWords) in its column, its path, lines, the path it was renamed from and what changeWords adds, the `marks` in its paths underlined. */
function fileSpans(file: FileChange, marks: FileMarks = UNMARKED): Span[] {
  const { word, after } = changeWords(file.code)
  const from = file.from === null ? [] : ledSpans(' ← ', file.from, marks.from, { dim: true })
  const said: Span[] = after === null ? [] : [{ text: ` (${after})`, dim: true }]
  return [{ ...word, text: word.text.padEnd(CHANGE_COLUMNS) }, ...markedSpans(file.path, marks.path, {}), ...lineSpans(file.lines), ...from, ...said]
}

/** A file's row, a press that opens its diff (keyed as the row is), unless it has none (diffKeyOf): git diffs no folder against nothing. */
function fileRow(repo: RepoChanges, file: FileChange): Row {
  const expands = diffKeyOf({ kind: 'repo', repo, file })
  return { key: `${repo.root}:${file.path}`, spans: fileSpans(file), hang: UNDER_PATH, ...(expands === null ? {} : { expands }) }
}

/** A diff line as drawn: `+` and its text green, `-` and its text red, the same lines plain behind a space, a hunk's `@@` line and git's notes dim. */
function diffLineSpan(line: DiffLine): Span {
  switch (line.kind) {
    case 'add':
      return { text: `+${line.text}`, color: 'success' }
    case 'del':
      return { text: `-${line.text}`, color: 'error' }
    case 'same':
      return { text: ` ${line.text}` }
    case 'hunk':
    case 'note':
      return { text: line.text, dim: true }
  }
}

/** What follows an open diff's lines: how many more it has, and that git's patch stopped short when it did. */
function moreWords(more: number, isCut: boolean): string | null {
  if (isCut) return `… ${more > 0 ? `${more}+` : 'some'} more lines: git's diff ran past 4 MiB and stops short`
  return more > 0 ? `… ${more} more lines` : null
}

/**
 * An open diff's rows, under its file's (`key`): `Reading the diff…` while it is read, why it could not be (git for
 * a repo's file, the file or its copy for one outside git: `from`), or its lines and how many more it has.
 */
export function diffRows(key: string, diff: FileDiff, from: DiffFile['kind']): Row[] {
  const note = (spans: Span[]): Row[] => [{ key: `diff:${key}`, spans: [UNDER_ROW, ...spans], hang: UNDER_ROW }]
  switch (diff.kind) {
    case 'reading':
      return note([{ text: 'Reading the diff…', dim: true }])
    case 'failed':
      return note([{ text: `WARN ${from === 'repo' ? 'git ' : ''}could not read the diff: ${diff.problem}`, color: 'warning' }])
    case 'read': {
      const more = moreWords(diff.more, diff.isCut)
      if (diff.lines.length === 0 && more === null) return note([{ text: 'No line changed: a mode change, a rename or an empty file.', dim: true }])
      const rows = diff.lines.map(
        (line, i): Row => ({ key: `diff:${key}:${i}`, spans: [UNDER_ROW, diffLineSpan(line)], hang: UNDER_DIFF_TEXT, maxLines: DIFF_LINE_ROWS }),
      )
      return more === null ? rows : [...rows, { key: `diff:${key}:more`, spans: [UNDER_ROW, { text: more, dim: true }] }]
    }
  }
}

/** A read repo's branch and count, ` · branch main · 3 files`; the branch left out when the folder bears its name, as a worktree's does. */
function repoState(repo: RepoChanges, name: string): Span[] {
  const count = repo.files.items.length + repo.files.more
  const branch: Span[] = repo.branch === name ? [] : [{ text: ` · ${repo.branch === null ? NO_BRANCH : `branch ${repo.branch}`}`, dim: true }]
  return [...branch, { text: count > 0 ? ` · ${count} ${count === 1 ? FILE_NOUN.one : FILE_NOUN.many}` : ' · clean', dim: true }]
}

/** True when a repo lists a file whose row opens a diff (diffKeyOf): an untracked folder alone opens none. */
function hasDiffs(repo: RepoChanges): boolean {
  return repo.problem === null && repo.files.items.some(file => diffKeyOf({ kind: 'repo', repo, file }) !== null)
}

/** A repo's ruled header and its files as its card, led by DIFF_HINT when `isHinted`. */
function repoBlocks(repo: RepoChanges, index: number, diffs: OpenDiffs, isHinted: boolean): Block[] {
  const name = repoName(repo.root)
  // Git did not read a repo with a problem: it has no branch or files to show, only why.
  const header: Span[] = [{ text: name, bold: true }, ...(repo.problem === null ? repoState(repo, name) : [])]
  // The first repo sits under the buttons, already a gap away.
  const head: Block = { key: `repo:${repo.root}`, opensSection: index > 0, rows: [{ key: `repo:${repo.root}`, spans: header, rule: true }] }
  if (repo.problem !== null) return [head, single(`problem:${repo.root}`, [{ text: `WARN ${repo.problem}`, color: 'warning' }], { text: '  ' })]
  const hint: Row[] = isHinted ? [{ key: `${repo.root}:hint`, spans: [{ text: DIFF_HINT, dim: true }] }] : []
  const rows = [
    ...hint,
    ...repo.files.items.flatMap(file => {
      const row = fileRow(repo, file)
      const diff = row.expands === undefined ? undefined : diffs[row.expands]
      return diff === undefined ? [row] : [row, ...diffRows(row.key, diff, 'repo')]
    }),
  ]
  if (repo.files.more > 0) rows.push({ key: `${repo.root}:more`, spans: [{ text: `… ${repo.files.more} more`, dim: true }] })
  if (repo.isPartial) rows.push({ key: `${repo.root}:partial`, spans: [{ text: "… git's list ran past 4 MiB and stops short", dim: true }] })
  // The files are the header's card, drawn under it outside any press, so each file's row is a press of its own.
  return rows.length === 0 ? [head] : [{ ...head, card: rows }]
}

/** Where a result's file is: its repo's folder and its branch (left out as the list leaves it out), or outside git. */
function whereSpans(hit: ChangeHit): Span[] {
  const { row } = hit
  if (row.kind === 'outside') return [{ text: 'written outside git', dim: true }]
  const name = repoName(row.repo.root)
  const branch =
    row.repo.branch === name ? [] : row.repo.branch === null ? [{ text: ` · ${NO_BRANCH}`, dim: true }] : ledSpans(' · branch ', row.repo.branch, marksOf(hit, 'branch'), { dim: true })
  return [...markedSpans(name, marksOf(hit, 'repo'), { dim: true }), ...branch]
}

/** A result: its file as its row draws it, over where it is, the words that matched underlined; a press opens its diff, drawn under it as its card. */
function resultBlock(hit: ChangeHit, diffs: OpenDiffs): Block {
  const { row } = hit
  const key = changesResultKey(row)
  const spans = row.kind === 'repo' ? fileSpans(row.file, { path: marksOf(hit, 'path'), from: marksOf(hit, 'from') }) : markedSpans(row.path, marksOf(hit, 'path'), {})
  // Where it is sits under the path: past what changed in a repo's file, under an outside file's path that has none.
  const under = row.kind === 'repo' ? UNDER_PATH : UNDER_ROW
  const rows: Row[] = [
    { key, spans, hang: under },
    { key: `${key}:where`, spans: [under, ...whereSpans(hit)], hang: under },
  ]
  const expands = diffKeyOf(row)
  if (expands === null) return { key, rows }
  const diff = diffs[expands]
  return { key, rows, expands, ...(diff === undefined ? {} : { card: diffRows(key, diff, row.kind) }) }
}

/** The search's body: the hint, the line that says nothing matched, or the count and the files it names. */
function foundBlocks(search: ChangesSearch, diffs: OpenDiffs): Block[] {
  const results = search.hits.map(hit => resultBlock(hit, diffs))
  const total = search.hits.length
  return searchViewBlocks({ key: CHANGES_SEARCH_VIEW, query: search.query, hint: CHANGES_SEARCH_HINT, nothing: CHANGES_NOTHING_FOUND, noun: FILE_NOUN, results, shown: total, total })
}

/**
 * The body under the switch in the Changes view. With no git to start (`isGitMissing`) and nothing found, it is
 * empty: the WARN line above it says why, where `Reading git…` would never end and `No git repo yet` would blame
 * the folder. `diffs` are the files' open diffs. While `search` holds the Find field's query, the search's body
 * once git has been read.
 */
export function changesBlocks(changes: ChangesSnapshot, isGitMissing = false, diffs: OpenDiffs = NO_DIFFS, search: ChangesSearch | null = null): Block[] {
  if (isGitMissing && changes.repos.length === 0 && changes.outside.length === 0) return []
  if (!changes.isRead) return [single('reading', [{ text: 'Reading git…', dim: true }])]
  if (search !== null) return foundBlocks(search, diffs)
  if (changes.repos.length === 0 && changes.outside.length === 0)
    return [single('no-repo', [{ text: 'No git repo yet: the session folder is in none, and no file the session or its agents edited (Edit, Write) is in one.' }])]
  // The hint shows once, over the first files a press opens a diff of: a repo's, else those outside git.
  const hinted = changes.repos.findIndex(hasDiffs)
  const blocks = changes.repos.flatMap((repo, i) => repoBlocks(repo, i, diffs, i === hinted))
  if (changes.outside.length === 0) return blocks
  return [...blocks, outsideBlock(changes.outside, diffs, hinted === -1, blocks.length > 0)]
}

/** The files written outside git under their ruled header, as its card (repoBlocks' pattern), each a press that opens its diff under it; led by DIFF_HINT when `isHinted`. */
function outsideBlock(outside: readonly string[], diffs: OpenDiffs, isHinted: boolean, opensSection: boolean): Block {
  const head = heading('outside', [{ text: `written outside git (${outside.length})`, dim: true }])
  const hint: Row[] = isHinted ? [{ key: 'outside-hint', spans: [{ text: DIFF_HINT, dim: true }] }] : []
  const rows = outside.flatMap(path => {
    const key = `${OUTSIDE}${path}`
    const row: Row = { key, spans: [{ text: path }], hang: { text: '  ' }, expands: key }
    const diff = diffs[key]
    return diff === undefined ? [row] : [row, ...diffRows(key, diff, 'outside')]
  })
  return { ...head, opensSection, card: [...hint, ...rows] }
}
