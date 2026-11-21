import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { completeImports } from './imports.ts';

/** The emit of a small tree: an entry, a file beside it, a file a folder up and a folder with an index. */
function tree(entry: string): Map<string, string> {
  return new Map([
    ['ui/main.js', entry],
    ['ui/program.js', 'export const program = 1;\n'],
    ['hooks/screen.js', 'export const screen = 1;\n'],
    ['hooks/core/index.js', 'export const core = 1;\n'],
  ]);
}

function entryOf(entry: string): string | undefined {
  return completeImports(tree(entry)).files.get('ui/main.js');
}

describe('completeImports', () => {
  it('gives a specifier that names a file its .js', () => {
    assert.equal(entryOf("import { program } from './program';\n"), "import { program } from './program.js';\n");
    assert.equal(entryOf("import { screen } from '../hooks/screen';\n"), "import { screen } from '../hooks/screen.js';\n");
  });

  it('gives a specifier that names a folder its /index.js', () => {
    assert.equal(entryOf("import { core } from '../hooks/core';\n"), "import { core } from '../hooks/core/index.js';\n");
  });

  it('prefers the file to a folder of the same name', () => {
    const files = tree("import { screen } from '../hooks/screen';\n");
    files.set('hooks/screen/index.js', 'export const other = 1;\n');
    assert.equal(completeImports(files).files.get('ui/main.js'), "import { screen } from '../hooks/screen.js';\n");
  });

  it('completes re-exports, bare imports and dynamic imports, in either quote', () => {
    const entry = [
      "export { program } from './program';",
      'export * from "../hooks/screen";',
      "import './program';",
      "const later = import('../hooks/core');",
      '',
    ].join('\n');
    const completed = completeImports(tree(entry));
    assert.equal(
      completed.files.get('ui/main.js'),
      [
        "export { program } from './program.js';",
        'export * from "../hooks/screen.js";',
        "import './program.js';",
        "const later = import('../hooks/core/index.js');",
        '',
      ].join('\n'),
    );
    assert.equal(completed.changed, 4);
    assert.deepEqual(completed.missing, []);
  });

  it('leaves a specifier that already names a file, a package and a node module', () => {
    const entry = "import './program.js';\nimport process from 'node:process';\nimport ts from 'typescript';\n";
    const completed = completeImports(tree(entry));
    assert.equal(completed.files.get('ui/main.js'), entry);
    assert.equal(completed.changed, 0);
  });

  it('leaves a path that only looks like an import: in a string, a comment or a call of another name', () => {
    const entry = [
      "const words = \"import x from './program'\";",
      "// import y from './program'",
      "const loaded = load('./program');",
      '',
    ].join('\n');
    const completed = completeImports(tree(entry));
    assert.equal(completed.files.get('ui/main.js'), entry);
    assert.equal(completed.changed, 0);
    assert.deepEqual(completed.missing, []);
  });

  it('names each specifier no file answers, in the order written, and leaves it as it is', () => {
    const entry = "import { a } from './absent';\nimport { program } from './program';\nimport { b } from '../gone/away';\n";
    const completed = completeImports(tree(entry));
    assert.deepEqual(completed.missing, [
      { file: 'ui/main.js', specifier: './absent' },
      { file: 'ui/main.js', specifier: '../gone/away' },
    ]);
    assert.equal(
      completed.files.get('ui/main.js'),
      "import { a } from './absent';\nimport { program } from './program.js';\nimport { b } from '../gone/away';\n",
    );
  });

  it('passes a file that is no script as it is', () => {
    const files = tree("import './program';\n");
    files.set('package.json', '{ "type": "module", "main": "./program" }\n');
    assert.equal(completeImports(files).files.get('package.json'), '{ "type": "module", "main": "./program" }\n');
  });

  it('completes every script of the tree, each from its own folder', () => {
    const files = tree("import './program';\n");
    files.set('hooks/screen.js', "import { core } from './core';\nexport const screen = core;\n");
    const completed = completeImports(files);
    assert.equal(completed.files.get('hooks/screen.js'), "import { core } from './core/index.js';\nexport const screen = core;\n");
    assert.equal(completed.changed, 2);
  });
});
