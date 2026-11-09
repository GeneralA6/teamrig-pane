import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TempRepo, type CliRun } from '../lib/temp-repo.ts';

/** The repo's own hook scripts, run as git runs them in a clone. */
const HOOKS_DIR = fileURLToPath(new URL('../../.githooks/', import.meta.url));
const HOOK_NAMES = ['pre-commit', 'commit-msg', 'pre-push'] as const;
const MESSAGE_FILE = '.git/COMMIT_EDITMSG';

/**
 * A stand-in for a command a hook runs: it logs one line (its name, arguments and, for the two that read the pushed
 * refs, its stdin) and refuses as `teamrig secrets <REFUSE>` would.
 */
function recorder(name: string): string {
  return [
    "import { appendFileSync, readFileSync } from 'node:fs'",
    `const name = ${JSON.stringify(name)}`,
    'const args = process.argv.slice(2)',
    "const reads = name === 'local' || args[1] === 'pushed'",
    "const stdin = reads ? ` < ${JSON.stringify(readFileSync(0, 'utf8'))}` : ''",
    "appendFileSync(process.env.HOOK_LOG ?? 'hook.log', `${[name, ...args].join(' ')}${stdin}\\n`)",
    "process.exitCode = name === 'teamrig' && args[1] === process.env.REFUSE ? 1 : 0",
    '',
  ].join('\n');
}

/** The PATH of this run without any folder that holds a `teamrig` command, as a clone without teamrig has it. */
function pathWithoutTeamrig(): string {
  const holdsTeamrig = (dir: string): boolean => ['', '.cmd', '.exe'].some((ext) => existsSync(join(dir, `teamrig${ext}`)));
  return (process.env['PATH'] ?? '')
    .split(delimiter)
    .filter((dir) => dir !== '' && !holdsTeamrig(dir))
    .join(delimiter);
}

/** A clone running the repo hooks, whose tools are recorders, with a bare remote to push to. */
class HookedClone {
  readonly repo = new TempRepo('githooks').init();
  private readonly log = join(this.repo.outside, 'calls.log');
  private readonly bin = join(this.repo.outside, 'bin');
  private edits = 0;

  constructor() {
    for (const hook of HOOK_NAMES) {
      const script = this.repo.write(`.githooks/${hook}`, '');
      copyFileSync(join(HOOKS_DIR, hook), script);
      chmodSync(script, 0o755);
    }
    this.repo.git('config', 'core.hooksPath', '.githooks');
    this.repo.write('package.json', '{ "type": "module" }\n');
    this.repo.write('tools/scrub/cli.ts', recorder('scrub'));
    this.repo.write('tools/dco/cli.ts', recorder('dco'));
    this.repo.write('tools/ci/local.ts', recorder('local'));
    mkdirSync(this.bin);
    const fake = join(this.bin, 'teamrig.ts');
    writeFileSync(fake, recorder('teamrig'));
    writeFileSync(join(this.bin, 'teamrig'), `#!/bin/sh\nexec '${process.execPath}' '${fake}' "$@"\n`);
    chmodSync(join(this.bin, 'teamrig'), 0o755);
    const remote = join(this.repo.outside, 'remote.git');
    this.repo.git('init', '-q', '--bare', remote);
    this.repo.git('remote', 'add', 'origin', remote);
    writeFileSync(this.log, '');
  }

  /** The variables of a run with teamrig on PATH or not, and the `teamrig secrets` subcommand that refuses, if any. */
  env(teamrig: boolean, refuse?: 'staged' | 'message' | 'pushed'): Record<string, string | undefined> {
    const path = pathWithoutTeamrig();
    return { PATH: teamrig ? `${this.bin}${delimiter}${path}` : path, HOOK_LOG: this.log, REFUSE: refuse };
  }

  commit(env: Record<string, string | undefined>): CliRun {
    this.edits += 1;
    this.repo.write('a.txt', `edit ${this.edits}\n`);
    this.repo.git('add', 'a.txt');
    return this.repo.gitWith(env, 'commit', '-q', '-s', '-m', 'Change a file');
  }

  push(env: Record<string, string | undefined>): CliRun {
    return this.repo.gitWith(env, 'push', '-q', 'origin', 'HEAD:refs/heads/topic');
  }

  /** The line git writes to a pre-push hook's stdin for the push of HEAD to a new `topic`, as both steps read it. */
  pushedRefs(): string {
    return JSON.stringify(`HEAD ${this.repo.git('rev-parse', 'HEAD').trim()} refs/heads/topic ${'0'.repeat(40)}\n`);
  }

  /** The commands the hooks ran since the last call, one line each. */
  calls(): string[] {
    const lines = readFileSync(this.log, 'utf8').split('\n').filter((line) => line !== '');
    writeFileSync(this.log, '');
    return lines;
  }
}

function withClone(test: (clone: HookedClone) => void): void {
  const clone = new HookedClone();
  try {
    test(clone);
  } finally {
    clone.repo.remove();
  }
}

describe('the repo git hooks', () => {
  it('run the secret scan before the scrub in a commit, and on the pushed refs before the local gate', () => {
    withClone((clone) => {
      const committed = clone.commit(clone.env(true));
      assert.equal(committed.status, 0, committed.stderr);
      assert.deepEqual(clone.calls(), [
        'teamrig secrets staged',
        'scrub --staged',
        `dco --message ${MESSAGE_FILE}`,
        `teamrig secrets message ${MESSAGE_FILE}`,
        `scrub --message ${MESSAGE_FILE}`,
      ]);
      const pushed = clone.push(clone.env(true));
      assert.equal(pushed.status, 0, pushed.stderr);
      assert.deepEqual(clone.calls(), [`teamrig secrets pushed origin < ${clone.pushedRefs()}`, `local --pre-push < ${clone.pushedRefs()}`]);
    });
  });

  it('refuse a commit whose staged change the scan refuses, before the scrub runs', () => {
    withClone((clone) => {
      assert.notEqual(clone.commit(clone.env(true, 'staged')).status, 0);
      assert.deepEqual(clone.calls(), ['teamrig secrets staged']);
      assert.equal(clone.repo.gitWith({}, 'rev-parse', '-q', '--verify', 'HEAD').status, 1);
    });
  });

  it('refuse a commit whose message the scan refuses, before the message scrub runs', () => {
    withClone((clone) => {
      assert.notEqual(clone.commit(clone.env(true, 'message')).status, 0);
      assert.deepEqual(clone.calls(), ['teamrig secrets staged', 'scrub --staged', `dco --message ${MESSAGE_FILE}`, `teamrig secrets message ${MESSAGE_FILE}`]);
      assert.equal(clone.repo.gitWith({}, 'rev-parse', '-q', '--verify', 'HEAD').status, 1);
    });
  });

  it('refuse a push the scan refuses, before the local gate runs', () => {
    withClone((clone) => {
      assert.equal(clone.commit(clone.env(true)).status, 0);
      clone.calls();
      assert.notEqual(clone.push(clone.env(true, 'pushed')).status, 0);
      assert.deepEqual(clone.calls(), [`teamrig secrets pushed origin < ${clone.pushedRefs()}`]);
      assert.equal(clone.repo.git('ls-remote', 'origin', 'refs/heads/topic'), '');
    });
  });

  it('without teamrig on PATH, say the scan is skipped and still run the scrub, sign-off and local gate', () => {
    withClone((clone) => {
      const committed = clone.commit(clone.env(false));
      assert.equal(committed.status, 0, committed.stderr);
      const pushed = clone.push(clone.env(false));
      assert.equal(pushed.status, 0, pushed.stderr);
      assert.deepEqual(clone.calls(), ['scrub --staged', `dco --message ${MESSAGE_FILE}`, `scrub --message ${MESSAGE_FILE}`, `local --pre-push < ${clone.pushedRefs()}`]);
      for (const [hook, sub, output] of [['pre-commit', 'staged', committed.stderr], ['commit-msg', 'message', committed.stderr], ['pre-push', 'pushed', pushed.stderr]] as const) {
        assert.ok(output.includes(`${hook}: teamrig is not on PATH, so the secret scan (teamrig secrets ${sub}) is skipped\n`), output);
      }
    });
  });
});
