import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ARCHIVE_FORMAT, archiveOf, archiveText, isArchivePath, isInterfaceText, sha256Of } from './archive.ts';

const HEAD = { version: '1.2.3', interface: '1.0', entry: 'ui/main.js' };

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
    const archive = archiveOf(HEAD,FILES);
    assert.equal(archive.format, ARCHIVE_FORMAT);
    assert.equal(archive.version, '1.2.3');
    assert.equal(archive.interface, '1.0');
    assert.equal(archive.entry, 'ui/main.js');
    assert.deepEqual(archive.files, [
      { path: 'hooks/core/index.js', text: 'export const core = 1;\n' },
      { path: 'package.json', text: '{"type":"module"}\n' },
      { path: 'ui/main.js', text: 'export {};\n' },
    ]);
  });

  it('gives the same bytes for the same files in another order', () => {
    const reversed = new Map([...FILES].reverse());
    assert.equal(archiveText(archiveOf(HEAD,reversed)), archiveText(archiveOf(HEAD,FILES)));
  });

  it('refuses a path that could leave the folder, naming it', () => {
    const files = new Map([...FILES, ['../outside.js', 'x'], ['ui/ok.js', 'y'], ['/root.js', 'z']]);
    assert.throws(() => archiveOf(HEAD,files), /not a path an archive may hold: \.\.\/outside\.js, \/root\.js$/);
  });

  it('refuses an entry that is not among the files', () => {
    assert.throws(() => archiveOf({ ...HEAD, entry: 'ui/absent.js' }, FILES), /the entry ui\/absent\.js is not among the archive's files/);
  });
});

describe('the interface version', () => {
  it('is <major>.<minor> in digits, each with one spelling', () => {
    for (const text of ['1.0', '0.1', '2.14', '10.0', '999999.999999']) {
      assert.equal(isInterfaceText(text), true, text);
    }
    for (const text of ['', '1', '1.', '.0', '1.0.0', '01.0', '1.00', '1.x', 'v1.0', ' 1.0', '1.0\n', '-1.0', '1.-0', '1000000.0']) {
      assert.equal(isInterfaceText(text), false, JSON.stringify(text));
    }
  });

  it('is refused by archiveOf when it is not spelled so, and no archive is made', () => {
    assert.throws(() => archiveOf({ ...HEAD, interface: '1' }, FILES), /^Error: not an interface version, <major>\.<minor>: "1"$/);
    assert.throws(() => archiveOf({ ...HEAD, interface: '' }, FILES), /^Error: not an interface version, <major>\.<minor>: ""$/);
  });

  it('is part of the bytes: another version gives another hash', () => {
    assert.notEqual(sha256Of(archiveText(archiveOf({ ...HEAD, interface: '1.1' }, FILES))), sha256Of(archiveText(archiveOf(HEAD, FILES))));
  });
});

describe('archiveText and sha256Of', () => {
  it('writes one JSON document that reads back as the archive, ended by a newline', () => {
    const archive = archiveOf(HEAD,FILES);
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
      sha256Of(archiveText(archiveOf(HEAD,changed))),
      sha256Of(archiveText(archiveOf(HEAD,FILES))),
    );
  });
});
