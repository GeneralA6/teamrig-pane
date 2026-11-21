import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_OUT, ENTRY, PACKAGE, PACKAGE_TEXT, builtArchive, outOf, versionOf } from './build.ts';

describe('outOf', () => {
  it('is the default folder with no word, and the folder --out names', () => {
    assert.equal(outOf([]), DEFAULT_OUT);
    assert.equal(outOf(['--out', 'dist/ui']), 'dist/ui');
  });

  it('refuses another flag, a flag with no folder and a word too many', () => {
    for (const args of [['--into', 'x'], ['--out'], ['--out', 'x', 'y'], ['x']]) {
      assert.throws(() => outOf(args), /^Error: usage: node tools\/ui-archive\/cli\.ts \[--out <folder>\]$/, args.join(' '));
    }
  });
});

describe('versionOf', () => {
  it('reads the version the manifest names', () => {
    assert.equal(versionOf('{ "name": "teamrig-pane", "version": "0.77.0" }'), '0.77.0');
  });

  it('refuses a manifest that names none, or one that is no text', () => {
    for (const manifest of ['{ "name": "teamrig-pane" }', '{ "version": 77 }', 'null', '"0.77.0"']) {
      assert.throws(() => versionOf(manifest), /^Error: the plugin manifest names no version$/, manifest);
    }
  });
});

const EMITTED = new Map([
  [ENTRY, "import { program } from './program';\nimport { screen } from '../hooks/screen';\n"],
  ['ui/program.js', 'export const program = 1;\n'],
  ['hooks/screen.js', 'export const screen = 1;\n'],
]);

const RELEASE = { version: '0.77.0', interface: '1.2' };

describe('builtArchive', () => {
  it('holds the emit with its imports completed and the package file that makes it modules', () => {
    const built = builtArchive(RELEASE,EMITTED);
    assert.equal(built.completed, 2);
    assert.equal(built.archive.version, '0.77.0');
    assert.equal(built.archive.interface, '1.2');
    assert.equal(built.archive.entry, ENTRY);
    assert.deepEqual(built.archive.files, [
      { path: 'hooks/screen.js', text: 'export const screen = 1;\n' },
      { path: PACKAGE, text: PACKAGE_TEXT },
      { path: ENTRY, text: "import { program } from './program.js';\nimport { screen } from '../hooks/screen.js';\n" },
      { path: 'ui/program.js', text: 'export const program = 1;\n' },
    ]);
    assert.deepEqual(JSON.parse(PACKAGE_TEXT), { type: 'module' });
  });

  it('makes no archive from an emit with an import no file answers, naming each', () => {
    const emitted = new Map([...EMITTED, ['hooks/screen.js', "import './gone';\nimport '../lost/one';\n"]]);
    assert.throws(
      () => builtArchive(RELEASE,emitted),
      /^Error: 2 import\(s\) name no emitted file: hooks\/screen\.js: \.\/gone; hooks\/screen\.js: \.\.\/lost\/one$/,
    );
  });

  it('makes no archive from an emit without the entry', () => {
    const emitted = new Map([['ui/program.js', 'export const program = 1;\n']]);
    assert.throws(() => builtArchive(RELEASE,emitted), /the entry ui\/main\.js is not among the archive's files/);
  });

  it('refuses an emit that brings a package file of its own', () => {
    const emitted = new Map([...EMITTED, [PACKAGE, '{}']]);
    assert.throws(() => builtArchive(RELEASE,emitted), /the emit holds a package\.json of its own/);
  });
});
