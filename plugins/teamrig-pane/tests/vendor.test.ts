import { describe, expect, test } from 'claude-code/testing'
import { CORE_FILES, headerOf, importsOf, parsePin, pinText, planSync, READ_ENTRY, resolveImport, unreachedFiles, vendoredText } from '../scripts/vendor'

const SHA = '0123456789abcdef0123456789abcdef01234567'

describe('vendor', () => {
  test('a copy is the header naming its teamrig path, then the module byte for byte', async () => {
    const source = "import { asString } from '../core/guards.ts';\nimport type { Task } from './fold.ts';\r\nexport const A = 1;\n"
    expect(vendoredText('register/model.ts', source)).toEqual({
      ok: true,
      text: "// Copied from teamrig's src/register/model.ts by scripts/sync-core.ts: change it there, then run the sync.\n" + source,
    })
    expect(headerOf('read/index.ts').startsWith("// Copied from teamrig's src/read/index.ts")).toBe(true)
  })

  test('finds imports, re-exports across lines, type-only and side-effect imports', async () => {
    const source = [
      "import { a } from './a.ts';",
      'import type { B } from "../b.ts";',
      'export {',
      '  c,',
      '  type D,',
      "} from './c.ts';",
      "export * from './e.ts';",
      "import './side.ts';",
      "// import { not } from './comment.ts' sits in a comment, so the line does not start with import",
    ].join('\n')
    expect(importsOf(source).sort()).toEqual(['../b.ts', './a.ts', './c.ts', './e.ts', './side.ts'])
  })

  test('resolves a relative import under src/, and nothing else', async () => {
    expect(resolveImport('read/index.ts', '../register/fold.ts')).toBe('register/fold.ts')
    expect(resolveImport('register/fold.ts', './model.ts')).toBe('register/model.ts')
    expect(resolveImport('register/fold.ts', './.././core/ids.ts')).toBe('core/ids.ts')
    expect(resolveImport('register/fold.ts', '../../outside.ts')).toBeNull()
    expect(resolveImport('register/fold.ts', 'node:fs')).toBeNull()
    expect(resolveImport('register/fold.ts', 'some-package')).toBeNull()
  })

  test('refuses a module that reaches past the copied set', async () => {
    expect(vendoredText('register/model.ts', "import { readFileSync } from 'node:fs';\n")).toEqual({
      ok: false,
      reason: "teamrig's src/register/model.ts imports node:fs, which hooks/core does not copy",
    })
    expect(vendoredText('register/model.ts', "import ts from 'typescript';\n").ok).toBe(false)
    expect(vendoredText('register/model.ts', "import type { EventLog } from './store.ts';\n").ok).toBe(false)
    expect(vendoredText('register/model.ts', "export { x } from '../../outside.ts';\n").ok).toBe(false)
    expect(vendoredText('register/model.ts', "import './store.ts';\n").ok).toBe(false)
    expect(vendoredText('register/model.ts', "const fs = await import('node:fs');\n")).toEqual({
      ok: false,
      reason: "teamrig's src/register/model.ts has a dynamic import, which hooks/core cannot check",
    })
  })

  test('names the read entry and every module once, each a path under src/', async () => {
    expect(CORE_FILES[0]).toBe(READ_ENTRY)
    expect(new Set(CORE_FILES).size).toBe(CORE_FILES.length)
    expect(CORE_FILES.every(path => /^[a-z]+\/[a-z-]+\.ts$/.test(path))).toBe(true)
  })

  test('names a listed module the read entry no longer reaches', async () => {
    const sources = new Map<string, string>(CORE_FILES.map(path => [path, '']))
    sources.set(READ_ENTRY, CORE_FILES.slice(1).map(path => `export * from '../${path}';`).join('\n'))
    expect(unreachedFiles(sources)).toEqual([])
    sources.set(READ_ENTRY, "export { a } from '../register/fold.ts';\n")
    sources.set('register/fold.ts', "import { b } from './model.ts';\nimport { c } from './fold.ts';\n")
    expect(unreachedFiles(sources)).toEqual(CORE_FILES.filter(path => ![READ_ENTRY, 'register/fold.ts', 'register/model.ts'].includes(path)))
  })

  test('a sync writes only the missing and changed copies, and names every file it does not write', async () => {
    const expected = new Map([
      ['read/index.ts', 'same'],
      ['register/fold.ts', 'new'],
      ['core/ids.ts', 'added'],
    ])
    const present = new Map([
      ['read/index.ts', 'same'],
      ['register/fold.ts', 'old'],
      ['model.ts', 'flat copy'],
      ['guards.ts', 'flat copy'],
    ])
    expect(planSync(expected, present)).toEqual({
      write: [
        ['register/fold.ts', 'new'],
        ['core/ids.ts', 'added'],
      ],
      strays: ['guards.ts', 'model.ts'],
    })
    expect(planSync(expected, expected)).toEqual({ write: [], strays: [] })
  })

  test('reads the pin as a full commit sha, and writes it back the same way', async () => {
    expect(parsePin(pinText({ commit: SHA }))).toEqual({ ok: true, pin: { commit: SHA } })
    expect(pinText({ commit: SHA })).toBe(`{\n  "commit": "${SHA}"\n}\n`)
    expect(parsePin('{torn')).toEqual({ ok: false, reason: 'the pin file is not JSON' })
    for (const text of ['{}', 'null', '"x"', '{"commit": "abc1234"}', `{"commit": "${SHA.toUpperCase()}"}`, '{"commit": 7}']) {
      expect(parsePin(text)).toEqual({ ok: false, reason: 'the pin file needs "commit": a full 40-digit teamrig commit sha' })
    }
  })
})
