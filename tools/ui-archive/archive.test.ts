import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ARCHIVE_FORMAT, archiveOf, archiveText, isArchivePath, sha256Of } from './archive.ts';

const FILES = new Map([
  ['ui/main.js', 'export {};\n'],
  ['package.json', '{"type":"module"}\n'],
  ['hooks/core/index.js', 'export const core = 1;\n'],
]);

describe('isArchivePath', () => {
  it('takes a relative path of plain names', () => {
    for (const path of ['package.json', 'ui/main.js', 'hooks/core/config/parse.js', 'a-b/c_d.test.js']) {
      assert.equal(isArchivePath(path), true, path);
    }
  });

  it('refuses a path that could leave the folder, or that an OS reads another way', () => {
    const refused = ['', '/etc/x', '../x.js', 'ui/../../x.js', './x.js', 'ui//x.js', 'ui/', 'ui\\x.js', 'C:/x.js', '.env', 'ui/.x', 'ui/a b.js', 'ui/x.js\n'];
    for (const path of refused) {
      assert.equal(isArchivePath(path), false, JSON.stringify(path));
    }
  });
});

describe('archiveOf', () => {
  it('holds the files in path order, whatever order they came in', () => {
    const archive = archiveOf('1.2.3', 'ui/main.js', FILES);
    assert.equal(archive.format, ARCHIVE_FORMAT);
    assert.equal(archive.version, '1.2.3');
    assert.equal(archive.entry, 'ui/main.js');
    assert.deepEqual(archive.files, [
      { path: 'hooks/core/index.js', text: 'export const core = 1;\n' },
      { path: 'package.json', text: '{"type":"module"}\n' },
      { path: 'ui/main.js', text: 'export {};\n' },
    ]);
  });

  it('gives the same bytes for the same files in another order', () => {
    const reversed = new Map([...FILES].reverse());
    assert.equal(archiveText(archiveOf('1.2.3', 'ui/main.js', reversed)), archiveText(archiveOf('1.2.3', 'ui/main.js', FILES)));
  });

  it('refuses a path that could leave the folder, naming it', () => {
    const files = new Map([...FILES, ['../outside.js', 'x'], ['ui/ok.js', 'y'], ['/root.js', 'z']]);
    assert.throws(() => archiveOf('1.2.3', 'ui/main.js', files), /not a path an archive may hold: \.\.\/outside\.js, \/root\.js$/);
  });

  it('refuses an entry that is not among the files', () => {
    assert.throws(() => archiveOf('1.2.3', 'ui/absent.js', FILES), /the entry ui\/absent\.js is not among the archive's files/);
  });
});

describe('archiveText and sha256Of', () => {
  it('writes one JSON document that reads back as the archive, ended by a newline', () => {
    const archive = archiveOf('1.2.3', 'ui/main.js', FILES);
    const text = archiveText(archive);
    assert.ok(text.endsWith('}\n'));
    assert.deepEqual(JSON.parse(text), archive);
  });

  it('hashes the text as UTF-8', () => {
    // The published test vectors of SHA-256 for the empty string and for "abc".
    assert.equal(sha256Of(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    assert.equal(sha256Of('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('changes the hash when a file changes', () => {
    const changed = new Map([...FILES, ['ui/main.js', 'export { };\n']]);
    assert.notEqual(
      sha256Of(archiveText(archiveOf('1.2.3', 'ui/main.js', changed))),
      sha256Of(archiveText(archiveOf('1.2.3', 'ui/main.js', FILES))),
    );
  });
});
