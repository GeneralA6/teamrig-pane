// The Keys page: each key the pane answers once, the groups as one grid at the body's width.
import { describe, expect, test } from 'claude-code/testing'
import { barKeys, KEY_GROUPS, KEYS_HOTKEY, KEYS_LABEL, keysBlocks } from '../hooks/keys-page'
import type { Block } from '../hooks/rows'

/** Each block's rows as the words they draw. */
function wordsOf(blocks: readonly Block[]): string[][] {
  return blocks.map(block => block.rows.map(row => row.spans.map(span => span.text).join('')))
}

describe('keys page', () => {
  test('lists every key once, each one a hotkey can be (a digit or a lowercase letter), its own key among them', () => {
    const keys = [...KEY_GROUPS.flatMap(group => group.entries.map(entry => entry.key)), ...barKeys().split(' ')]
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.filter(key => !/^[0-9a-z]$/.test(key))).toEqual([])
    expect(KEY_GROUPS.flatMap(group => group.entries).filter(entry => entry.key === KEYS_HOTKEY)).toEqual([{ key: KEYS_HOTKEY, what: KEYS_LABEL }])
    expect(barKeys()).toBe('o v w i n')
  })

  test('at 48 columns each group is three columns of the widest entry (14 cells) with 2 between, then the bar and the focus keys', () => {
    expect(wordsOf(keysBlocks(48))).toEqual([
      [`${'t  Tasks'.padEnd(16)}${'d  Changes'.padEnd(16)}g  Log`, `${'u  Inbox'.padEnd(16)}${'e  Teams'.padEnd(16)}j  Meetings`],
      [`${'s  Find'.padEnd(16)}${'m  mine'.padEnd(16)}a  all`, `${'h  archive'.padEnd(16)}${'c  close cards'.padEnd(16)}k  keys`],
      [`${'b  back'.padEnd(16)}${'f  forward'.padEnd(16)}p  week before`, 'l  week after'],
      ['o v w i n  only that status; again shows all'],
      ['ctrl+x tab, or a click: keys to the pane', 'Esc: keys back to Claude', 'ctrl+x x, or ✕: minimize the pane'],
    ])
  })

  test('a narrower body takes fewer columns, one at least, and no row ends in padding', () => {
    expect(wordsOf(keysBlocks(30))[0]).toEqual([`${'t  Tasks'.padEnd(16)}d  Changes`, `${'g  Log'.padEnd(16)}u  Inbox`, `${'e  Teams'.padEnd(16)}j  Meetings`])
    expect(wordsOf(keysBlocks(10))[0]).toEqual(['t  Tasks', 'd  Changes', 'g  Log', 'u  Inbox', 'e  Teams', 'j  Meetings'])
  })

  test('a key is bold, its words plain; the bar line wraps under its words', () => {
    const [views, , , bar] = keysBlocks(48)
    expect(views?.rows[0]?.spans.slice(0, 2)).toEqual([{ text: 't', bold: true }, { text: '  Tasks' }])
    expect(bar?.rows[0]?.spans[0]).toEqual({ text: 'o v w i n', bold: true })
    expect(bar?.rows[0]?.hang).toEqual({ text: ' '.repeat(11) })
  })
})
