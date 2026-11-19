import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EXIT_CLEAN, EXIT_FINDINGS } from '../lib/exit.ts';
import { FakeGit } from '../lib/fake-git.ts';
import { GitError } from '../lib/git.ts';
import { checkCommitSubjects, COMMIT_TYPES, subjectProblem } from './commit-subjects.ts';

const LOG_FORMAT = '--format=%H%x00%an%x00%ae%x00%P%x00%B%x1e';
const logKey = (range: string): string => `log ${LOG_FORMAT} ${range} --`;

/** `git log` output for commits given as [sha, message]. */
function logOf(commits: readonly (readonly [string, string])[]): string {
  return commits.map(([sha, message]) => `${sha}\x00Dana Example\x00dana@example.com\x00${'0'.repeat(40)}\x00${message}\n\x1e\n`).join('');
}

async function run(base: string | undefined, head: string, git: FakeGit): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  const code = await checkCommitSubjects({ base, head }, { git, out: (line) => lines.push(line) });
  return { code, lines };
}

describe('subjectProblem', () => {
  it('takes every type, with an area or without, and a breaking mark', () => {
    for (const type of COMMIT_TYPES) assert.equal(subjectProblem(`${type}: do it`), null, type);
    assert.equal(subjectProblem('fix(work): the list reads layout 5'), null);
    assert.equal(subjectProblem('feat(views)!: the Meetings view drops a meeting'), null);
    assert.equal(subjectProblem('chore(main): release teamrig-pane 0.76.0'), null);
  });

  it('refuses the old area-only subject, an unknown type, a missing space and an empty what', () => {
    assert.equal(subjectProblem('core: sync hooks/core'), '"core" is no commit type; use one of ' + COMMIT_TYPES.join(', '));
    assert.equal(subjectProblem('plugin: pane version 0.75.0, why'), '"plugin" is no commit type; use one of ' + COMMIT_TYPES.join(', '));
    assert.equal(subjectProblem('Fix the list'), 'it does not start with <type>: or <type>(<area>):');
    assert.equal(subjectProblem('fix:the list'), 'it does not start with <type>: or <type>(<area>):');
    assert.equal(subjectProblem('fix(): the list'), 'it does not start with <type>: or <type>(<area>):');
    assert.equal(subjectProblem('fix: '), 'it does not start with <type>: or <type>(<area>):');
    assert.equal(subjectProblem('Revert "fix: the list"'), 'it does not start with <type>: or <type>(<area>):');
  });
});

describe('checkCommitSubjects', () => {
  it('passes a range whose every subject is typed, reading only the first line of each message', async () => {
    const git = new FakeGit({ [logKey('main..HEAD')]: logOf([['a'.repeat(40), 'fix(work): x\n\nplugin: a body line'], ['b'.repeat(40), 'docs: y']]) });
    const { code, lines } = await run('main', 'HEAD', git);
    assert.equal(code, EXIT_CLEAN);
    assert.deepEqual(lines, ['commit-subjects: 2 commit(s) in main..HEAD, each subject <type>(<area>): <what>']);
  });

  it('names each wrong commit and says how to reword it', async () => {
    const git = new FakeGit({ [logKey('main..HEAD')]: logOf([['a'.repeat(40), 'fix: x'], ['b'.repeat(40), 'tools: y\r\n\r\nwhy']]) });
    const { code, lines } = await run('main', 'HEAD', git);
    assert.equal(code, EXIT_FINDINGS);
    assert.equal(lines[0], 'commit-subjects: 1 of 2 commit(s) in main..HEAD have a subject the release workflow cannot read:');
    assert.equal(lines[1], `  bbbbbbbbb "tools: y": "tools" is no commit type; use one of ${COMMIT_TYPES.join(', ')}`);
    assert.match(lines[2] ?? '', /^commit-subjects: reword it as <type>\(<area>\): <what>.*git commit --amend.*git rebase -i <base>.*--force-with-lease$/);
  });

  it('checks the head commit alone when the run has no base, as a run by hand on the release pull request', async () => {
    const git = new FakeGit({ [logKey('abc~1..abc')]: logOf([['c'.repeat(40), 'chore(main): release teamrig-pane 0.76.0']]) });
    const { code, lines } = await run(undefined, 'abc', git);
    assert.equal(code, EXIT_CLEAN);
    assert.deepEqual(lines, ['commit-subjects: 1 commit(s) in abc~1..abc, each subject <type>(<area>): <what>']);
  });

  it('stops when git cannot list the range', async () => {
    const git = new FakeGit({ [logKey('nope..HEAD')]: new GitError(['log'], 'fatal: bad revision', new Error('exit 128')) });
    await assert.rejects(run('nope', 'HEAD', git), { message: 'git cannot list the commits in nope..HEAD' });
  });
});
