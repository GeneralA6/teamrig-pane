import { describe, expect, test } from 'claude-code/testing'
import { formatNumbers, trailingFormats, trailingText } from '../scripts/formats'

describe('formats', () => {
  test('reads each exported _VERSION and _FORMAT number, on a line of its own, with or without a semicolon', async () => {
    const events = '// Copied from teamrig\nexport const EVENT_VERSION = 3;\r\nexport const TASK_LINE_VERSION = 2\n'
    const hiring = 'export const HIRE_FORMAT = 2;\nexport const SHIPPED_CONFIG_FORMAT: ConfigFormat = { version: 5 };\n'
    const others = [
      'const LOCAL_VERSION = 9;',
      'export const MAX_SIZE_PCT = 100;',
      '  export const INDENTED_VERSION = 4;',
      'export const NAMED_VERSION = SOME_VERSION;',
      '// export const COMMENTED_VERSION = 5;',
      'export const VERSION = 6;',
    ].join('\n')
    expect([...formatNumbers([events, hiring, others])]).toEqual([
      ['EVENT_VERSION', 3],
      ['TASK_LINE_VERSION', 2],
      ['HIRE_FORMAT', 2],
    ])
    expect(formatNumbers([]).size).toBe(0)
  })

  test('a name two modules declare keeps the higher number', async () => {
    expect(formatNumbers(['export const MARK_VERSION = 2;', 'export const MARK_VERSION = 1;']).get('MARK_VERSION')).toBe(2)
    expect(formatNumbers(['export const MARK_VERSION = 1;', 'export const MARK_VERSION = 2;']).get('MARK_VERSION')).toBe(2)
  })

  test("names each number hooks/core holds lower than teamrig main's, or lacks, by name", async () => {
    const core = new Map([
      ['EVENT_VERSION', 2],
      ['CONFIG_VERSION', 5],
      ['MARK_VERSION', 2],
      ['OLD_FORMAT', 1],
    ])
    const main = new Map([
      ['MARK_VERSION', 1],
      ['EVENT_VERSION', 3],
      ['HIRE_FORMAT', 2],
      ['CONFIG_VERSION', 5],
    ])
    const trailing = trailingFormats(core, main)
    expect(trailing).toEqual([
      { name: 'EVENT_VERSION', core: 2, main: 3 },
      { name: 'HIRE_FORMAT', core: undefined, main: 2 },
    ])
    expect(trailing.map(trailingText)).toEqual(['EVENT_VERSION 2, teamrig main 3', 'HIRE_FORMAT 2 only in teamrig main'])
    expect(trailingFormats(main, main)).toEqual([])
  })
})
