// The Changes view as blocks of rows (rows.ts): per repo a ruled header (its folder, its branch unless
// the folder bears its name, and how many files changed; only the folder while git can't read it),
// then its files as one block, each row git's two-letter code, the path and its lines
// added and removed (`binary` for a binary file); then the files written outside any repo. The switch's
// badge and the tab title count the same files.
import type { ChangesSnapshot, FileChange, LineCount, RepoChanges } from '../types'
import { changeCount } from './changes'
import { heading, single, type Block, type Row, type Span } from './rows'

/** Where a wrapped path goes on: under the path, past the code. */
const UNDER_PATH: Span = { text: '   ' }

/** `Changes Δ3`, or `Changes` while nothing changed: the switch's button. */
export function changesLabel(changes: ChangesSnapshot): string {
  const count = changeCount(changes)
  return count > 0 ? `Changes Δ${count}` : 'Changes'
}

/** `Tasks · Δ3`, or `Tasks` while nothing changed: the pane's tab title. */
export function paneTitle(changes: ChangesSnapshot): string {
  const count = changeCount(changes)
  return count > 0 ? `Tasks · Δ${count}` : 'Tasks'
}

/** The folder name a repo's root ends in. */
function repoName(root: string): string {
  return root.split(/[\\/]/).filter(part => part !== '').at(-1) ?? root
}

/** The code's index letter in green (staged), its work-tree letter in yellow; `??` (untracked) dim. */
function codeSpans(code: string): Span[] {
  if (code === '??') return [{ text: '??', dim: true }]
  const [index = ' ', tree = ' '] = code
  return [
    index === ' ' ? { text: ' ' } : { text: index, color: 'success' },
    tree === ' ' ? { text: ' ' } : { text: tree, color: 'warning' },
  ]
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

function fileRow(root: string, file: FileChange): Row {
  const from: Span[] = file.from === null ? [] : [{ text: ` ← ${file.from}`, dim: true }]
  return { key: `${root}:${file.path}`, spans: [...codeSpans(file.code), { text: ` ${file.path}` }, ...lineSpans(file.lines), ...from], hang: UNDER_PATH }
}

/** A read repo's branch and count, ` · main · 3 changed`; the branch left out when the folder bears its name, as a worktree's does. */
function repoState(repo: RepoChanges, name: string): Span[] {
  const count = repo.files.items.length + repo.files.more
  const branch: Span[] = repo.branch === name ? [] : [{ text: ` · ${repo.branch ?? 'detached'}`, dim: true }]
  return [...branch, { text: count > 0 ? ` · ${count} changed` : ' · clean', dim: true }]
}

function repoBlocks(repo: RepoChanges, index: number): Block[] {
  const name = repoName(repo.root)
  // Git did not read a repo with a problem: it has no branch or files to show, only why.
  const header: Span[] = [{ text: name, bold: true }, ...(repo.problem === null ? repoState(repo, name) : [])]
  // The first repo sits under the buttons, already a gap away.
  const head: Block = { key: `repo:${repo.root}`, opensSection: index > 0, rows: [{ key: `repo:${repo.root}`, spans: header, rule: true }] }
  if (repo.problem !== null) return [head, single(`problem:${repo.root}`, [{ text: `WARN ${repo.problem}`, color: 'warning' }], { text: '  ' })]
  const rows = repo.files.items.map(file => fileRow(repo.root, file))
  if (repo.files.more > 0) rows.push({ key: `${repo.root}:more`, spans: [{ text: `… ${repo.files.more} more`, dim: true }] })
  if (repo.isPartial) rows.push({ key: `${repo.root}:partial`, spans: [{ text: "… git's list ran past 4 MiB and stops short", dim: true }] })
  return rows.length === 0 ? [head] : [head, { key: `files:${repo.root}`, rows }]
}

/** The body under the switch in the Changes view. */
export function changesBlocks(changes: ChangesSnapshot): Block[] {
  if (!changes.isRead) return [single('reading', [{ text: 'Reading git…', dim: true }])]
  if (changes.repos.length === 0 && changes.outside.length === 0)
    return [single('no-repo', [{ text: 'No git repo yet: the session folder is in none, and no file the session or its agents edited (Edit, Write) is in one.' }])]
  const blocks = changes.repos.flatMap(repoBlocks)
  if (changes.outside.length === 0) return blocks
  const outside = heading('outside', [{ text: `written outside git (${changes.outside.length})`, dim: true }])
  const rows: Row[] = changes.outside.map(path => ({ key: `outside:${path}`, spans: [{ text: path }], hang: { text: '  ' } }))
  return [...blocks, { ...outside, opensSection: blocks.length > 0 }, { key: 'outside-files', rows }]
}
