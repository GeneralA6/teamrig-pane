import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_COMMITS } from '../../plugins/teamrig-pane/hooks/core/config/defaults.ts';
import { EXIT_CLEAN, EXIT_FINDINGS } from '../lib/exit.ts';
import { FakeGit } from '../lib/fake-git.ts';
import { COMMIT_LOG_FORMAT, COMMIT_LOG_MAX } from './commit-size.ts';
import { checkCommitSizes } from './size-rule.ts';

const SHA = 'a'.repeat(40);
const LOG = `-c core.quotePath=false log -M --numstat --format=${COMMIT_LOG_FORMAT} --max-count=${COMMIT_LOG_MAX} --end-of-options main..HEAD --`;

/** `git log` output for one commit of one file with `lines` added lines. */
function commitOf(path: string, lines: number, body = '', subject = 'change'): string {
  return `\x1e${SHA}\x1f${subject}\x1f${body}\x1f\n\n${lines}\t0\t${path}\n`;
}

async function run(base: string | undefined, git: FakeGit): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  const code = await checkCommitSizes({ base, head: 'HEAD' }, { git, rule: DEFAULT_COMMITS, out: (line) => lines.push(line) });
  return { code, lines };
}

describe('checkCommitSizes', () => {
  it('has nothing to check without a base, and asks git nothing', async () => {
    const git = new FakeGit({});
    assert.deepEqual(await run(undefined, git), { code: EXIT_CLEAN, lines: ['size-rule: no base commit to compare with (a new branch), nothing to check'] });
    assert.deepEqual(git.calls, []);
  });

  it('passes commits within the rule and counts them', async () => {
    const git = new FakeGit({ [LOG]: commitOf('src/a.ts', 400) + commitOf('src/b.ts', 10) });
    assert.deepEqual(await run('main', git), {
      code: EXIT_CLEAN,
      lines: ['size-rule: 2 commit(s) in main..HEAD, none over 400 changed non-test lines or 15 non-test files without a "Large-commit: <reason>" line'],
    });
  });

  it('fails a commit over the line bound with no reason line, and names it', async () => {
    const { code, lines } = await run('main', new FakeGit({ [LOG]: commitOf('src/a.ts', 401) }));
    assert.equal(code, EXIT_FINDINGS);
    assert.deepEqual(lines, [
      `size-rule: 1 commit(s) go over 400 changed non-test lines or 15 non-test files with no "Large-commit: <reason>" line: ${SHA.slice(0, 7)} "change" (401 line(s), 1 file(s)). Split each into logical steps, or give the reason in its message.`,
    ]);
  });

  it('fails a commit over the file bound', async () => {
    const stats = Array.from({ length: 16 }, (_, index) => `1\t0\tsrc/f${index}.ts\n`).join('');
    assert.equal((await run('main', new FakeGit({ [LOG]: `\x1e${SHA}\x1fwide\x1f\x1f\n\n${stats}` }))).code, EXIT_FINDINGS);
  });

  it('passes a large commit whose message gives the reason, and does not count test files', async () => {
    const git = new FakeGit({ [LOG]: commitOf('src/a.ts', 900, 'Large-commit: a generated table') + commitOf('plugins/p/tests/a.test.ts', 900) });
    assert.equal((await run('main', git)).code, EXIT_CLEAN);
  });
});
