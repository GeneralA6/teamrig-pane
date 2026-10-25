// The Changes view's search (hooks/changes-search.ts): the files of its list a query names by the start of a word in
// their path, the path they were renamed from, or their repo's folder name or branch; a file written outside git by its
// path alone. A result opens its file's diff, keyed as the list's row is; an untracked folder and a file outside git
// have none.
import { describe, expect, test } from 'claude-code/testing'
import type { ChangesSnapshot, FileChange, RepoChanges } from '../types'
import { CHANGES_SEARCH_VIEW, changesResultKey, diffKeyOf, searchChanges, type ChangeHit, type ChangeRow } from '../hooks/changes-search'
import { marksOf } from '../hooks/search'
import { isResultOf } from '../hooks/search-view'

const PANE = 'C:/work/pane'
const API = 'C:/work/api'
const OUTSIDE = 'C:/notes/plan.md'

function change(code: string, path: string, from: string | null = null): FileChange {
  return { code, path, from, lines: null }
}

function repo(root: string, branch: string | null, files: FileChange[]): RepoChanges {
  return { root, branch, files: { items: files, more: 0 }, isPartial: false, isUnborn: false, problem: null }
}

/** pane on pane-v2 holds a changed file, a rename and an untracked folder; api on main one changed file; one file outside git. */
const CHANGES: ChangesSnapshot = {
  repos: [
    repo(PANE, 'pane-v2', [change(' M', 'hooks/a.ts'), change('R ', 'hooks/new.ts', 'hooks/old.ts'), change('??', 'tests/')]),
    repo(API, 'main', [change(' M', 'src/route.ts')]),
  ],
  outside: [OUTSIDE],
  isRead: true,
}
const search = (query: string) => searchChanges(CHANGES, query)
const idOf = (row: ChangeRow) => (row.kind === 'repo' ? `${row.repo.root}:${row.file.path}` : `outside:${row.path}`)
const idsOf = (hits: readonly ChangeHit[]) => hits.map(hit => idOf(hit.row))

/** The `n`th file the pane repo lists, as searched. */
function paneRow(n: number): ChangeRow {
  const [pane] = CHANGES.repos
  const file = pane?.files.items[n]
  if (pane === undefined || file === undefined) throw new Error(`no pane file ${n}`)
  return { kind: 'repo', repo: pane, file }
}

describe('searchChanges', () => {
  test("a word names a file by the start of a word in its path or the path it was renamed from, in the view's order", () => {
    const hooks = search('hooks')
    expect(idsOf(hooks)).toEqual([`${PANE}:hooks/a.ts`, `${PANE}:hooks/new.ts`])
    expect(hooks.map(hit => marksOf(hit, 'path'))).toEqual([[{ start: 0, end: 5 }], [{ start: 0, end: 5 }]])
    const old = search('old')
    expect(idsOf(old)).toEqual([`${PANE}:hooks/new.ts`])
    expect(old.map(hit => [marksOf(hit, 'path'), marksOf(hit, 'from')])).toEqual([[[], [{ start: 6, end: 9 }]]])
    // Every word must match.
    expect(idsOf(search('hooks new'))).toEqual([`${PANE}:hooks/new.ts`])
    // The middle of a word is no start.
    expect(search('ooks')).toEqual([])
  })

  test('a word that starts with a mark matches anywhere in a path', () => {
    expect(idsOf(search('.ts'))).toEqual([`${PANE}:hooks/a.ts`, `${PANE}:hooks/new.ts`, `${API}:src/route.ts`])
    expect(idsOf(search('/a'))).toEqual([`${PANE}:hooks/a.ts`])
  })

  test("a word names every file of a repo by its folder's name or its branch", () => {
    const api = search('api')
    expect(idsOf(api)).toEqual([`${API}:src/route.ts`])
    expect(api.map(hit => marksOf(hit, 'repo'))).toEqual([[{ start: 0, end: 3 }]])
    const v2 = search('v2')
    expect(idsOf(v2)).toEqual([`${PANE}:hooks/a.ts`, `${PANE}:hooks/new.ts`, `${PANE}:tests/`])
    expect(v2.map(hit => marksOf(hit, 'branch'))).toEqual([[{ start: 5, end: 7 }], [{ start: 5, end: 7 }], [{ start: 5, end: 7 }]])
    expect(idsOf(search('main'))).toEqual([`${API}:src/route.ts`])
  })

  test('a file written outside git is named by its path alone', () => {
    expect(idsOf(search('plan'))).toEqual([`outside:${OUTSIDE}`])
    expect(idsOf(search('notes plan'))).toEqual([`outside:${OUTSIDE}`])
  })

  test('none for a blank query, or before git is read', () => {
    expect(search('  ')).toEqual([])
    expect(searchChanges({ repos: [], outside: [], isRead: false }, 'hooks')).toEqual([])
  })
})

describe('changes search results', () => {
  test("a result's diff is keyed as the list's row opens it; an untracked folder and a file outside git have none", () => {
    expect(diffKeyOf(paneRow(0))).toBe(`${PANE}:hooks/a.ts`)
    expect(diffKeyOf(paneRow(1))).toBe(`${PANE}:hooks/new.ts`)
    expect(diffKeyOf(paneRow(2))).toBeNull()
    expect(diffKeyOf({ kind: 'outside', path: OUTSIDE })).toBeNull()
    // An untracked file, unlike a folder, diffs against nothing.
    const [pane] = CHANGES.repos
    if (pane === undefined) throw new Error('no pane repo')
    expect(diffKeyOf({ kind: 'repo', repo: pane, file: change('??', 'notes.md') })).toBe(`${PANE}:notes.md`)
  })

  test("a result is keyed by the Changes search's view and its file", () => {
    const key = changesResultKey(paneRow(0))
    expect(key).toBe(`changes-search:${PANE}:hooks/a.ts`)
    expect(isResultOf(CHANGES_SEARCH_VIEW, key)).toBe(true)
    expect(changesResultKey({ kind: 'outside', path: OUTSIDE })).toBe(`changes-search:outside:${OUTSIDE}`)
  })
})
