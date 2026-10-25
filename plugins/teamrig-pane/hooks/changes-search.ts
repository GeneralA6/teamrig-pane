// The Changes view's search (T774): the files of its list (changes.ts) a query names, on the shared search
// (search.ts). A word matches the start of a word in a file's path, in the path it was renamed from, or in its
// repo's folder name or branch; a file written outside any repo by its path alone. Every match is kept, in the view's
// order (each repo's files, then those written outside git): a repo keeps few enough files (CHANGES_KEPT) to show
// whole. A result opens its file's diff, as the view's rows do; an untracked folder and a file outside git have none.
// Pure.
import type { ChangesSnapshot, FileChange, RepoChanges } from '../types'
import { repoName } from './changes'
import { matchRows, type Hit, type SearchSpec } from './search'
import { resultKey } from './search-view'

/** The Changes search's key: its results are keyed `changes-search:<root>:<path>`, its own lines `changes-search-count` and the like. */
export const CHANGES_SEARCH_VIEW = 'changes-search'

/** The fields a word can match the start of a word in. */
export const CHANGES_SEARCHED = ['path', 'from', 'repo', 'branch'] as const
export type ChangesSearchedField = (typeof CHANGES_SEARCHED)[number]

/** A file as searched: one a repo lists, with its repo, or one written outside any repo. */
export type ChangeRow = { kind: 'repo'; repo: RepoChanges; file: FileChange } | { kind: 'outside'; path: string }

/** A file is searched by its path and the one it was renamed from, and its repo's folder name and branch. */
const CHANGES_SEARCH: SearchSpec<ChangeRow, ChangesSearchedField> = {
  fields: [
    { name: 'path', text: row => (row.kind === 'repo' ? row.file.path : row.path) },
    { name: 'from', text: row => (row.kind === 'repo' ? row.file.from : null) },
    { name: 'repo', text: row => (row.kind === 'repo' ? repoName(row.repo.root) : null) },
    { name: 'branch', text: row => (row.kind === 'repo' ? row.repo.branch : null) },
  ],
}

/** A file the query names, with where its words matched. */
export type ChangeHit = Hit<ChangeRow, ChangesSearchedField>

/** The view's files that `query` names, in its order; none for a blank query. A repo git could not read lists none. */
export function searchChanges(changes: ChangesSnapshot, query: string): ChangeHit[] {
  const rows: ChangeRow[] = [
    ...changes.repos.flatMap(repo => repo.files.items.map((file): ChangeRow => ({ kind: 'repo', repo, file }))),
    ...changes.outside.map((path): ChangeRow => ({ kind: 'outside', path })),
  ]
  return matchRows(rows, query, CHANGES_SEARCH)
}

/** The key of `row`'s diff among the open diffs (diff.ts); null for a file with none: an untracked folder, or one outside git. */
export function diffKeyOf(row: ChangeRow): string | null {
  if (row.kind === 'outside') return null
  return row.file.code === '??' && row.file.path.endsWith('/') ? null : `${row.repo.root}:${row.file.path}`
}

/** The key the result for `row` is drawn under: the press that opens its diff, where it has one. */
export function changesResultKey(row: ChangeRow): string {
  return resultKey(CHANGES_SEARCH_VIEW, row.kind === 'repo' ? `${row.repo.root}:${row.file.path}` : `outside:${row.path}`)
}
