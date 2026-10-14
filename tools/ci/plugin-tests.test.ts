import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pluginTestFindings } from './plugin-tests.ts';

const RUNNING = ["import { expect, test } from 'claude-code/testing'", "test('draws', async () => {", '  expect(1).toBe(1)', '})'].join('\n');

describe('plugin test gate', () => {
  it('passes plugin tests that all run, and helpers that do not import the test kit', () => {
    assert.deepEqual(
      pluginTestFindings([
        { path: 'plugins/p/tests/pane.test.ts', text: RUNNING },
        { path: 'plugins/p/tests/view.test.tsx', text: RUNNING },
        { path: 'plugins/p/tests/fixtures.ts', text: "export const NOW = 1\n// a test.skip in prose is not a call: it never says why\n" },
      ]),
      [],
    );
  });

  it('names each skipped, focused or todo test by file and line, however it is spelled', () => {
    const text = [
      "test.skip('a', async () => {})",
      "describe.only('b', () => {})",
      "it.todo('c')",
      "test.skipIf(true)('d', async () => {})",
      "test.failing('e', async () => {}); xit ('f', () => {})",
      "xdescribe('g', () => {}); xtest('h', () => {})",
    ].join('\r\n');
    assert.deepEqual(pluginTestFindings([{ path: 'plugins/p/tests/held.test.ts', text }]), [
      'plugins/p/tests/held.test.ts:1: test.skip keeps a test from running as written',
      'plugins/p/tests/held.test.ts:2: describe.only keeps a test from running as written',
      'plugins/p/tests/held.test.ts:3: it.todo keeps a test from running as written',
      'plugins/p/tests/held.test.ts:4: test.skipIf keeps a test from running as written',
      'plugins/p/tests/held.test.ts:5: test.failing keeps a test from running as written',
      'plugins/p/tests/held.test.ts:5: xit keeps a test from running as written',
      'plugins/p/tests/held.test.ts:6: xdescribe keeps a test from running as written',
      'plugins/p/tests/held.test.ts:6: xtest keeps a test from running as written',
    ]);
  });

  it('leaves look-alikes alone: a property, a longer name, a method on another object', () => {
    const text = ["test('a', async () => { skip.only = 1; contest.skip; mock.only(); latest.todo })", 'const xitem = xits(1)'].join('\n');
    assert.deepEqual(pluginTestFindings([{ path: 'plugins/p/tests/a.test.ts', text }]), []);
  });

  it('flags a file that imports the test kit but is not named so the runner runs it', () => {
    assert.deepEqual(
      pluginTestFindings([
        { path: 'plugins/p/tests/a.test.ts', text: RUNNING },
        { path: 'plugins/p/tests/b.spec.ts', text: RUNNING },
        { path: 'plugins/p/tests/c.ts', text: 'import { test } from "claude-code/testing"\n' },
      ]),
      [
        'plugins/p/tests/b.spec.ts: imports claude-code/testing but is not named *.test.ts or *.test.tsx, so its tests never run',
        'plugins/p/tests/c.ts: imports claude-code/testing but is not named *.test.ts or *.test.tsx, so its tests never run',
      ],
    );
  });

  it('fails when there are no plugin test files at all', () => {
    const none = ['no plugin test files (plugins/<name>/**/*.test.ts or *.test.tsx): the plugin tests would pass without running'];
    assert.deepEqual(pluginTestFindings([]), none);
    assert.deepEqual(pluginTestFindings([{ path: 'plugins/p/hooks/register.tsx', text: 'export const register = 1\n' }]), none);
  });
});
