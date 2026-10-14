import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TempRepo } from '../lib/temp-repo.ts';

const CLI = fileURLToPath(new URL('./plugin-tests-cli.ts', import.meta.url));

const RUNNING = "import { expect, test } from 'claude-code/testing'\ntest('draws', async () => {\n  expect(1).toBe(1)\n})\n";

describe('plugin test gate cli', () => {
  let repo: TempRepo;
  beforeEach(() => {
    repo = new TempRepo('plugin-tests').init();
  });
  afterEach(() => repo.remove());

  it('passes when every plugin test runs, counting tracked and untracked sources', () => {
    repo.write('plugins/p/tests/pane.test.ts', RUNNING);
    repo.write('plugins/p/hooks/register.tsx', 'export const register = 1\n');
    repo.write('plugins/p/README.md', 'test.skip in prose is not a source\n');
    repo.git('add', 'plugins/p/tests/pane.test.ts');
    const result = repo.run(CLI);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'plugin tests: clean (2 source(s))\n');
  });

  it('skips ignored files and a tracked file deleted from the tree', () => {
    repo.write('plugins/p/tests/pane.test.ts', RUNNING);
    repo.write('.gitignore', 'plugins/p/types/\n');
    repo.write('plugins/p/types/engine.test.ts', "test.only('ignored', async () => {})\n");
    repo.write('plugins/p/tests/gone.test.ts', "test.only('gone', async () => {})\n");
    repo.git('add', '.');
    rmSync(join(repo.dir, 'plugins', 'p', 'tests', 'gone.test.ts'));
    const result = repo.run(CLI);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'plugin tests: clean (1 source(s))\n');
  });

  it('fails and lists each held test', () => {
    repo.write('plugins/p/tests/pane.test.ts', `${RUNNING}test.todo('later')\n`);
    const result = repo.run(CLI);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(
      result.stdout,
      'plugin tests: 1 finding(s); every test runs (see CONTRIBUTING.md):\n  plugins/p/tests/pane.test.ts:5: test.todo keeps a test from running as written\n',
    );
  });

  it('reports a git failure as a usage error, outside a repository', () => {
    const bare = new TempRepo('plugin-tests-bare');
    try {
      const result = bare.run(CLI);
      assert.equal(result.status, 2);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /^plugin-tests: /);
    } finally {
      bare.remove();
    }
  });

  it('fails when the plugins have no tests', () => {
    repo.write('plugins/p/hooks/register.tsx', 'export const register = 1\n');
    const result = repo.run(CLI);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /^plugin tests: 1 finding\(s\);.*\n {2}no plugin test files /);
  });
});
