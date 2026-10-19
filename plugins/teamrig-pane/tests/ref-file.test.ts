import { describe, expect, test } from 'claude-code/testing'
import type { RefPlaces } from '../hooks/details'
import { MAX_PAGE_BYTES, RefFileReader, refSegments } from '../hooks/ref-file'
import { MemoryFiles } from './fixtures'

const PLACES: RefPlaces = { inboxDir: 'R/inbox', home: 'C:/Homes/a', cwd: 'C:/w', teamDir: 'C:/kit/teams/web', goalsDoc: null }

describe('refSegments', () => {
  test('a word with a folder and a file name with an extension is a file, the words around it kept as written', () => {
    expect(refSegments('follow-up of T26 in notes/api/t26-findings.md')).toEqual([
      { kind: 'words', text: 'follow-up of T26 in ' },
      { kind: 'file', file: { file: 'notes/api/t26-findings.md', line: null } },
    ])
    expect(refSegments('~/.teamrig/teams/web/notes/po/gaps.md row 5')).toEqual([
      { kind: 'file', file: { file: '~/.teamrig/teams/web/notes/po/gaps.md', line: null } },
      { kind: 'words', text: ' row 5' },
    ])
    expect(refSegments('C:\\w\\api\\x.ts')).toEqual([{ kind: 'file', file: { file: 'C:\\w\\api\\x.ts', line: null } }])
  })

  test('a line after the name is the line the page lands on, with or without a folder; a range lands on its first line', () => {
    expect(refSegments('~/team-notes/board/inbox/po.md:12')).toEqual([{ kind: 'file', file: { file: '~/team-notes/board/inbox/po.md', line: 12 } }])
    expect(refSegments('board.md:6')).toEqual([{ kind: 'file', file: { file: 'board.md', line: 6 } }])
    expect(refSegments('board/po:6')).toEqual([{ kind: 'file', file: { file: 'board/po', line: 6 } }])
    expect(refSegments('docs/R.md:38-41')).toEqual([{ kind: 'file', file: { file: 'docs/R.md', line: 38 } }])
  })

  test('an anchor, a comma or brackets around a path stay words', () => {
    expect(refSegments('notes/s5/churn.md#2, (docs/R.md).')).toEqual([
      { kind: 'file', file: { file: 'notes/s5/churn.md', line: null } },
      { kind: 'words', text: '#2, (' },
      { kind: 'file', file: { file: 'docs/R.md', line: null } },
      { kind: 'words', text: ').' },
    ])
    expect(refSegments('docs/R.md:7, then')).toEqual([
      { kind: 'file', file: { file: 'docs/R.md', line: 7 } },
      { kind: 'words', text: ', then' },
    ])
  })

  test('a web address, a bare name, a folder, a version, a time or a quote ref names no file', () => {
    for (const part of ['https://github.com/acme/app/blob/main/x.md', 'Node.js', 'plugins/teamrig-pane', 'api/v1.2', 'at 10:30', 'owner, in the meeting', 'PR #29']) {
      expect(refSegments(part)).toEqual([{ kind: 'words', text: part }])
    }
  })
})

describe('RefFileReader', () => {
  test('reads the first place that holds the file: up from the session folder, then the team folder', async () => {
    const files = new MemoryFiles()
    files.write('C:/kit/teams/web/notes/api/t26.md', '# T26\n\nfindings')
    expect(await new RefFileReader(files, PLACES).read('notes/api/t26.md')).toEqual({ kind: 'read', path: 'C:/kit/teams/web/notes/api/t26.md', text: '# T26\n\nfindings' })
    files.write('C:/w/notes/api/t26.md', 'nearer')
    expect(await new RefFileReader(files, PLACES).read('notes/api/t26.md')).toEqual({ kind: 'read', path: 'C:/w/notes/api/t26.md', text: 'nearer' })
  })

  test('a file no place holds names every path looked at', async () => {
    expect(await new RefFileReader(new MemoryFiles(), PLACES).read('src/gone.ts')).toEqual({
      kind: 'missing',
      tried: ['C:/w/src/gone.ts', 'C:/src/gone.ts', 'C:/kit/teams/web/src/gone.ts'],
    })
  })

  test('a file over the cap, one that is not text, and a failed read are named with why, never read whole', async () => {
    const files = new MemoryFiles()
    files.write('C:/w/big.log', 'x'.repeat(MAX_PAGE_BYTES + 1))
    files.write('C:/w/a/shot.png', 'PNG\u0000\u0001')
    files.write('C:/w/a/locked.md', 'text')
    const reader = new RefFileReader(files, PLACES)
    expect(await reader.read('C:/w/big.log')).toEqual({ kind: 'unreadable', path: 'C:/w/big.log', reason: '257 KiB, over the 256 KiB a page shows' })
    expect(files.reads).toEqual([])
    expect(await reader.read('a/shot.png')).toEqual({ kind: 'unreadable', path: 'C:/w/a/shot.png', reason: 'not text' })
    files.failNextRead = 'EBUSY: locked'
    expect(await reader.read('a/locked.md')).toEqual({ kind: 'unreadable', path: 'C:/w/a/locked.md', reason: 'EBUSY: locked' })
  })
})
