import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINE_SURFACE, engineBoundaryFindings, HOOKS, type HookSource } from './engine-boundary.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const DOCK = 'plugins/p/hooks/register.tsx';
const OUTSIDE = "imports claude-code outside the dock's files: use one of the pane's own types, or move the engine's part to a file on the list";
const STALE = "is listed as the dock's but imports no claude-code: take it off the list";

/** Every TypeScript source under the plugin's hooks, as the repository holds it now. */
function hookSources(): HookSource[] {
  const folder = join(ROOT, ...HOOKS.split('/'));
  return readdirSync(folder, { recursive: true, encoding: 'utf8' })
    .map((name) => name.replaceAll('\\', '/'))
    .filter((name) => /\.tsx?$/.test(name))
    .sort()
    .map((name) => ({ path: `${HOOKS}/${name}`, text: readFileSync(join(folder, ...name.split('/')), 'utf8') }));
}

describe('engine boundary', () => {
  it('passes when only the listed files import the engine', () => {
    assert.deepEqual(
      engineBoundaryFindings(
        [
          { path: DOCK, text: "import { atom } from 'claude-code'\nimport { rowsOf } from './rows'\n" },
          { path: 'plugins/p/hooks/rows.ts', text: "import type { Row } from '../types'\nexport const rowsOf = (): Row[] => []\n" },
        ],
        [DOCK],
      ),
      [],
    );
  });

  it('names each import of the engine off the list by file and line, in every form', () => {
    const text = [
      "import type { ThemeKey } from 'claude-code'",
      'import {',
      '  atom,',
      '} from "claude-code"',
      "import 'claude-code'",
      "export type { Context } from 'claude-code'",
      "const engine = await import('claude-code')",
      'const old = require( "claude-code" )',
    ].join('\r\n');
    assert.deepEqual(
      engineBoundaryFindings(
        [
          { path: DOCK, text: "import { atom } from 'claude-code'\n" },
          { path: 'plugins/p/hooks/rows.ts', text },
        ],
        [DOCK],
      ),
      [1, 4, 5, 6, 7, 8].map((line) => `plugins/p/hooks/rows.ts:${line}: ${OUTSIDE}`),
    );
  });

  it('leaves look-alikes alone: the test kit, a file named after the engine, the name as a value', () => {
    const text = [
      "import { expect } from 'claude-code/testing'",
      "import { claudeCodeCheck } from './claude-code-version'",
      "import { kit } from 'claude-code-kit'",
      "export const HOST = 'claude-code'",
      "export const kind = { kind: 'claude-code-old' }",
    ].join('\n');
    assert.deepEqual(
      engineBoundaryFindings(
        [
          { path: DOCK, text: "import { atom } from 'claude-code'\n" },
          { path: 'plugins/p/hooks/rows.ts', text },
        ],
        [DOCK],
      ),
      [],
    );
  });

  it('names a listed file that imports no engine, or is gone', () => {
    assert.deepEqual(
      engineBoundaryFindings(
        [
          { path: DOCK, text: "import { atom } from 'claude-code'\n" },
          { path: 'plugins/p/hooks/theme.ts', text: "import type { Tone } from './tone'\n" },
        ],
        [DOCK, 'plugins/p/hooks/theme.ts', 'plugins/p/hooks/gone.ts'],
      ),
      [`plugins/p/hooks/theme.ts: ${STALE}`, `plugins/p/hooks/gone.ts: ${STALE}`],
    );
  });

  it('holds over the hooks as they are: only the dock files import the engine, and each of them does', () => {
    const sources = hookSources();
    assert.ok(
      sources.some((source) => source.path.startsWith(`${HOOKS}/core/`)),
      'the read reaches hooks/core',
    );
    assert.deepEqual(engineBoundaryFindings(sources, ENGINE_SURFACE), []);
  });
});
