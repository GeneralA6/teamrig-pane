import { describe, expect, test } from 'claude-code/testing'
import type { RefFile, RefFileRead } from '../types'
import { BLOCK_LINES, filePageBlocks, lineBlockKey } from '../hooks/file-page'
import type { Block } from '../hooks/rows'

const BRIEF: RefFile = { file: 'notes/api/t26.md', line: null }
const read = (text: string): RefFileRead => ({ kind: 'read', path: 'C:/kit/teams/web/notes/api/t26.md', text })
/** Each block as its key and its rows' words. */
const words = (blocks: Block[]): [string, string[]][] => blocks.map(block => [block.key, block.rows.map(row => row.spans.map(span => span.text).join(''))])

describe('filePageBlocks', () => {
  test('heads the page with the file and where it was read, then a block per paragraph, its lines as written', () => {
    const blocks = filePageBlocks(BRIEF, read('# T26\r\n\r\nfirst line\nsecond line  \n\n\n- last\n'))
    expect(words(blocks)).toEqual([
      ['file-page', ['api/t26.md', 'C:/kit/teams/web/notes/api/t26.md']],
      ['file-page:para:1', ['# T26']],
      ['file-page:para:3', ['first line', 'second line']],
      ['file-page:para:7', ['- last']],
    ])
    expect(blocks[2]?.rows.map(row => row.key)).toEqual(['file-page:line:3', 'file-page:line:4'])
  })

  test('the line its ref points at is bold and named in the head; tabs draw as two spaces; a wrapped line keeps its indent', () => {
    const blocks = filePageBlocks({ ...BRIEF, line: 2 }, read('if (x) {\n\treturn y\n}'))
    expect(blocks[0]?.rows[1]?.spans).toEqual([{ text: 'C:/kit/teams/web/notes/api/t26.md · line 2', dim: true }])
    expect(blocks[1]?.rows).toEqual([
      { key: 'file-page:line:1', spans: [{ text: 'if (x) {' }], hang: undefined },
      { key: 'file-page:line:2', spans: [{ text: '  return y', bold: true }], hang: { text: '  ' } },
      { key: 'file-page:line:3', spans: [{ text: '}' }], hang: undefined },
    ])
  })

  test(`a run of over ${BLOCK_LINES} lines with no blank line splits, so no block lays out a whole file`, () => {
    const text = Array.from({ length: BLOCK_LINES + 3 }, (_, i) => `line ${i + 1}`).join('\n')
    const blocks = filePageBlocks(BRIEF, read(text)).slice(1)
    expect(blocks.map(block => [block.key, block.rows.length])).toEqual([
      ['file-page:para:1', BLOCK_LINES],
      [`file-page:para:${BLOCK_LINES + 1}`, 3],
    ])
  })

  test('a file not found names each path looked at, or that there was no folder to look in', () => {
    expect(words(filePageBlocks(BRIEF, { kind: 'missing', tried: ['C:/w/notes/api/t26.md', 'C:/kit/teams/web/notes/api/t26.md'] }))).toEqual([
      ['file-page', ['api/t26.md', 'notes/api/t26.md']],
      ['file-page:note', ['Not found. Looked for it at:', 'C:/w/notes/api/t26.md', 'C:/kit/teams/web/notes/api/t26.md']],
    ])
    expect(words(filePageBlocks(BRIEF, { kind: 'missing', tried: [] })).at(-1)).toEqual(['file-page:note', ['Not found: the pane knows no folder to look in.']])
  })

  test('a file not shown says why; an empty one says so; one the pane lost asks for it to be opened again', () => {
    expect(words(filePageBlocks(BRIEF, { kind: 'unreadable', path: 'C:/w/x.md', reason: 'EBUSY: locked.' }))).toEqual([
      ['file-page', ['api/t26.md', 'C:/w/x.md']],
      ['file-page:note', ['Not shown: EBUSY: locked.']],
    ])
    expect(words(filePageBlocks(BRIEF, read(' \n\t\n'))).at(-1)).toEqual(['file-page:note', ['Empty.']])
    expect(words(filePageBlocks(BRIEF, undefined))).toEqual([
      ['file-page', ['api/t26.md', 'notes/api/t26.md']],
      ['file-page:note', ["Not read: open it again from its task's card."]],
    ])
  })
})

describe('lineBlockKey', () => {
  const text = 'a\nb\n\nc\n\n\nd'

  test('lands on the paragraph holding the line, the next one for a blank line, the last past the end', () => {
    expect(lineBlockKey({ ...BRIEF, line: 2 }, read(text))).toBe('file-page:para:1')
    expect(lineBlockKey({ ...BRIEF, line: 3 }, read(text))).toBe('file-page:para:4')
    expect(lineBlockKey({ ...BRIEF, line: 6 }, read(text))).toBe('file-page:para:7')
    expect(lineBlockKey({ ...BRIEF, line: 90 }, read(text))).toBe('file-page:para:7')
  })

  test('none for a ref with no line, a file not read, or an empty one', () => {
    expect(lineBlockKey(BRIEF, read(text))).toBe(null)
    expect(lineBlockKey({ ...BRIEF, line: 2 }, { kind: 'missing', tried: [] })).toBe(null)
    expect(lineBlockKey({ ...BRIEF, line: 2 }, undefined)).toBe(null)
    expect(lineBlockKey({ ...BRIEF, line: 2 }, read(''))).toBe(null)
  })
})
