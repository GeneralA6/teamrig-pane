import { describe, expect, test } from 'claude-code/testing'
import { CORE_FILES, originOf, vendoredText } from '../scripts/vendor'

const MODEL = CORE_FILES.find(file => file.name === 'model.ts')
const GUARDS = CORE_FILES.find(file => file.name === 'guards.ts')

describe('vendor', () => {
  test('a copy names its origin and reads the guards locally', async () => {
    if (MODEL === undefined) throw new Error('model.ts is a core file')
    const source = "import { asString } from '../../coordinator/src/guards.ts';\nimport type { Task } from './fold.ts';\n"
    const copy = vendoredText(MODEL, source)
    expect(copy).toEqual({
      ok: true,
      text:
        "// Copied from the register's src/model.ts by scripts/sync-core.ts: change it there, then run the sync.\n" +
        "import { asString } from './guards.ts';\nimport type { Task } from './fold.ts';\n",
    })
  })

  test('makes any outside guards import local, however deep, and leaves a local one as it is', async () => {
    if (MODEL === undefined) throw new Error('model.ts is a core file')
    for (const target of ["'../guards.ts'", "'../../../lib/guards.ts'", "'./guards.ts'"]) {
      const copy = vendoredText(MODEL, `import { isRecord } from ${target};\n`)
      expect(copy.ok && copy.text.endsWith("import { isRecord } from './guards.ts';\n")).toBe(true)
    }
  })

  test('names the guards module by its role, not by a path', async () => {
    if (GUARDS === undefined) throw new Error('guards.ts is a core file')
    expect(originOf(GUARDS)).toBe('the guards module the register imports')
    const copy = vendoredText(GUARDS, 'export function isRecord(value: unknown): boolean { return value !== null }\n')
    expect(copy.ok && copy.text.startsWith('// Copied from the guards module the register imports by scripts/sync-core.ts')).toBe(true)
  })

  test('refuses a module that reaches past the copied set', async () => {
    if (MODEL === undefined) throw new Error('model.ts is a core file')
    expect(vendoredText(MODEL, "import { readFileSync } from 'node:fs';\n")).toEqual({
      ok: false,
      reason: "the register's src/model.ts imports node:fs, which hooks/core does not copy",
    })
    expect(vendoredText(MODEL, "import type { EventLog } from './store.ts';\n").ok).toBe(false)
    expect(vendoredText(MODEL, "import { helper } from '../../coordinator/src/helper.ts';\n").ok).toBe(false)
  })

  test('every core file is named once, and only guards.ts comes from outside the register', async () => {
    const names = CORE_FILES.map(file => file.name)
    expect(new Set(names).size).toBe(names.length)
    expect(CORE_FILES.filter(file => file.source === 'guards').map(file => file.name)).toEqual(['guards.ts'])
  })
})
