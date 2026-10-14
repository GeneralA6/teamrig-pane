// The Changes view as blocks of rows (rows.ts): per repo a ruled header (its folder, branch and how many
// files changed), then its files as one block, each row git's two-letter code and the path; then the
// files written outside any repo. The switch's badge and the tab title count the same files.
import type { ChangesSnapshot, FileChange, RepoChanges } from '../types'
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

function fileRow(root: string, file: FileChange): Row {
  const from: Span[] = file.from === null ? [] : [{ text: ` ← ${file.from}`, dim: true }]
  return { key: `${root}:${file.path}`, spans: [...codeSpans(file.code), { text: ` ${file.path}` }, ...from], hang: UNDER_PATH }
}

function repoBlocks(repo: RepoChanges, index: number): Block[] {
  const count = repo.files.items.length + repo.files.more
  const header: Span[] = [
    { text: repoName(repo.root), bold: true },
    { text: ` · ${repo.branch ?? 'detached'}`, dim: true },
    { text: count > 0 ? ` · ${count} changed` : ' · clean', dim: true },
  ]
  // The first repo sits under the buttons, already a gap away.
  const head: Block = { key: `repo:${repo.root}`, opensSection: index > 0, rows: [{ key: `repo:${repo.root}`, spans: header, rule: true }] }
  if (repo.problem !== null) return [head, single(`problem:${repo.root}`, [{ text: `⚠ ${repo.problem}`, color: 'warning' }], { text: '  ' })]
  const rows = repo.files.items.map(file => fileRow(repo.root, file))
  if (repo.files.more > 0) rows.push({ key: `${repo.root}:more`, spans: [{ text: `… ${repo.files.more} more`, dim: true }] })
  if (repo.isPartial) rows.push({ key: `${repo.root}:partial`, spans: [{ text: "… git's list ran past 4 MiB and stops short", dim: true }] })
  return rows.length === 0 ? [head] : [head, { key: `files:${repo.root}`, rows }]
}

/** The body under the switch in the Changes view. */
export function changesBlocks(changes: ChangesSnapshot): Block[] {
  if (!changes.isRead) return [single('reading', [{ text: 'Reading git…', dim: true }])]
  if (changes.repos.length === 0 && changes.outside.length === 0)
    return [single('no-repo', [{ text: 'No git repo yet: the session folder is in none. A file the session writes adds its repo.', dim: true }])]
  const blocks = changes.repos.flatMap(repoBlocks)
  if (changes.outside.length === 0) return blocks
  const outside = heading('outside', [{ text: `written outside git (${changes.outside.length})`, dim: true }])
  const rows: Row[] = changes.outside.map(path => ({ key: `outside:${path}`, spans: [{ text: path }], hang: { text: '  ' } }))
  return [...blocks, { ...outside, opensSection: blocks.length > 0 }, { key: 'outside-files', rows }]
}
