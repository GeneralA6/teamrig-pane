import { describe, expect, test } from 'claude-code/testing'
import { WrapCache, dockLayout, wrapRow } from '../hooks/layout'
import type { Block, Row } from '../hooks/rows'
import { KEPT_WIDTHS, cells } from '../hooks/width'

describe('WrapCache', () => {
  const row: Row = { key: 'r', spans: [{ text: '○ T1 · a title that wraps over lines' }], hang: { text: '  ' } }

  test('hands back the lines wrapped by the layout before for a row that did not change, and wraps it as wrapRow does', () => {
    const cache = new WrapCache()
    const first = cache.wrap(row, 12)
    expect(first).toEqual(wrapRow(row, 12))
    cache.settle()
    expect(cache.wrap({ ...row, key: 'moved' }, 12)).toBe(first)
  })

  test('wraps again for other columns or other spans, and forgets a row the last layout did not use', () => {
    const cache = new WrapCache()
    const first = cache.wrap(row, 12)
    expect(cache.wrap(row, 20)).not.toBe(first)
    expect(cache.wrap({ ...row, spans: [{ text: 'other words' }] }, 12)).toEqual(wrapRow({ ...row, spans: [{ text: 'other words' }] }, 12))
    cache.settle()
    cache.settle()
    const again = cache.wrap(row, 12)
    expect(again).not.toBe(first)
    expect(again).toEqual(first)
  })

  test('dockLayout draws the same with the rows of a layout before as with none', () => {
    const blocks: Block[] = [
      { key: 'a', toggle: 'T1', rows: [row, { key: 'm', spans: [{ text: 'meta · due 10-20', dim: true }] }] },
      { key: 'b', rows: [{ key: 'h', spans: [{ text: '── next' }], rule: true }], opensSection: true },
    ]
    const cache = new WrapCache()
    const cold = dockLayout(blocks, 16, cache)
    expect(cold).toEqual(dockLayout(blocks, 16))
    expect(dockLayout(blocks, 16, cache)).toEqual(cold)
  })
})

describe('cells', () => {
  test('counts a non-ASCII text the same each time, past the widths it keeps too', () => {
    expect(cells('○ · ⛔')).toBe(6)
    expect(cells('○ · ⛔')).toBe(6)
    for (let i = 0; i <= KEPT_WIDTHS; i++) expect(cells(`○${i}`)).toBe(1 + String(i).length)
    expect(cells('○ · ⛔')).toBe(6)
  })
})
