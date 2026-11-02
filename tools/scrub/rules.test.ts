import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GENERIC_RULES } from './rules.ts';
import { scanText } from './scan.ts';

// Fixtures are assembled at runtime so this file never holds a literal the scrub would flag.
const join = (...parts: string[]): string => parts.join('');
const ruleIds = (text: string): string[] => scanText('fixture', text, GENERIC_RULES).map((finding) => finding.ruleId);
const BACKSLASH = '\\';

describe('generic scrub rules', () => {
  it('flags absolute paths inside a user home on Windows, macOS and Linux', () => {
    assert.deepEqual(ruleIds(join('C:', BACKSLASH, 'Users', BACKSLASH, 'dana', BACKSLASH, 'repo')), ['home-path']);
    assert.deepEqual(ruleIds(join('D:/', 'Users/dana/repo')), ['home-path']);
    assert.deepEqual(ruleIds(join('open /', 'home/dana/x and /', 'Users/dana/y')), ['home-path', 'home-path']);
  });

  it('accepts placeholder users and home-relative paths', () => {
    const text = join('C:', BACKSLASH, 'Users', BACKSLASH, '<you> ~/x $HOME/x /', 'home/user/x /', 'Users/you/x');
    assert.deepEqual(ruleIds(text), []);
  });

  it('flags e-mail addresses', () => {
    assert.deepEqual(ruleIds(join('mail dana', '@', 'acme.io today')), ['email']);
  });

  it('accepts documentation, noreply and SSH remote addresses and package specs', () => {
    const text = [
      join('a', '@', 'example.com'),
      join('b', '@', 'sub.example.org'),
      join('noreply', '@', 'anthropic.com'),
      join('1+dana', '@', 'users.noreply.github.com'),
      join('noreply', '@', 'github.com'),
      join('git', '@', 'github.com:owner/repo.git'),
      join('typescript', '@', '5.9.3'),
      '@types/node',
    ].join(' ');
    assert.deepEqual(ruleIds(text), []);
  });

  it('flags IPv4 addresses outside loopback and documentation ranges', () => {
    assert.deepEqual(ruleIds(['10', '1', '2', '3'].join('.')), ['ipv4']);
  });

  it('accepts loopback, documentation ranges and dotted version strings', () => {
    const text = [
      ['127', '0', '0', '1'],
      ['0', '0', '0', '0'],
      ['192', '0', '2', '10'],
      ['198', '51', '100', '7'],
      ['203', '0', '113', '9'],
      ['v1', '2', '3', '4'],
      ['1', '2', '3', '4', '5'],
    ]
      .map((parts) => parts.join('.'))
      .join(' ');
    assert.deepEqual(ruleIds(text), []);
  });

  it('flags internal host names', () => {
    assert.deepEqual(ruleIds(join('db.', 'internal')), ['internal-host']);
  });

  it('flags common secret formats', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['private-key', join('-----BEGIN ', 'RSA PRIVATE KEY-----')],
      ['github-token', join('ghp', '_', 'a'.repeat(36))],
      ['github-token', join('github', '_pat_', 'b'.repeat(50))],
      ['anthropic-key', join('sk-', 'ant-', 'c'.repeat(40))],
      ['sk-key', join('sk-', 'd4'.repeat(20))],
      ['aws-key', join('AKIA', 'ABCDEFGHIJKLMNOP')],
      ['slack-token', join('xoxb', '-', '1'.repeat(12))],
      ['google-key', join('AIza', 'e'.repeat(35))],
      ['stripe-key', join('sk', '_live_', 'j'.repeat(24))],
      ['jwt', join('eyJ', 'f'.repeat(10), '.eyJ', 'g'.repeat(10), '.', 'h'.repeat(10))],
      ['assigned-secret', join('password', ': "', 'i'.repeat(16), '"')],
      ['assigned-secret', join('DB_', 'PASSWORD', '="', 'k3'.repeat(8), '"')],
    ];
    for (const [rule, text] of cases) {
      assert.deepEqual(ruleIds(text), [rule], rule);
    }
  });

  it('accepts a secret-like name bound to a placeholder', () => {
    assert.deepEqual(ruleIds(join('token', ': "', '${user_config.TOKEN}', '"')), []);
  });

  // teamrig's core judges these values names, not secrets; the copied doc comment of secret-patterns.ts holds both.
  it('accepts a secret-like name bound to the name of a secret', () => {
    assert.deepEqual(ruleIds(join('TOKEN', '="', 'SOME_READ_', 'TOKEN', '"')), []);
    assert.deepEqual(ruleIds(join('secret', ': "', 'app-api-', 'secrets', '"')), []);
  });

  it('accepts a claim token bound to a uuid, as teamrig judges it, and refuses that uuid under a bare token', () => {
    const uuid = join('3f9a8b7c', '-1d2e-4f5a-8b6c-', '0123456789ab');
    assert.deepEqual(ruleIds(join('claim', 'Token', ': "', uuid, '"')), []);
    assert.deepEqual(ruleIds(join('token', ': "', uuid, '"')), ['assigned-secret']);
  });

  it('fails closed on a match without its captured part: no allow check accepts it', () => {
    const bare = /x/.exec('x');
    assert.ok(bare !== null);
    for (const id of ['home-path', 'email', 'assigned-secret']) {
      const isAllowed = GENERIC_RULES.find((rule) => rule.id === id)?.isAllowed;
      assert.ok(isAllowed !== undefined, id);
      assert.equal(isAllowed(bare), false, id);
    }
  });
});
