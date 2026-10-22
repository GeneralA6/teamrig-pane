import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FakeGit } from '../lib/fake-git.ts';
import { isRecord } from '../lib/guards.ts';
import { DEFAULT_BASE, localChecks, TEAMRIG_CONFIG_KEY, teamrigCheckout } from './local-checks.ts';

const read = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const CI = read('.github/workflows/ci.yml');

/** The npm scripts of the workspace. */
function npmScripts(): ReadonlyMap<string, string> {
  const pkg: unknown = JSON.parse(read('package.json'));
  assert.ok(isRecord(pkg));
  const scripts = pkg['scripts'];
  assert.ok(isRecord(scripts));
  return new Map(Object.entries(scripts).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

/** The one-line commands CI runs, with each `npm run <script>` replaced by the script's `&&`-separated commands. */
function ciCommands(): string[] {
  const scripts = npmScripts();
  const runs = [...CI.matchAll(/^\s*- run: (.+)$/gm)].map((match) => (match[1] ?? '').trim());
  assert.ok(runs.length > 0, 'ci.yml lists no commands');
  return runs.flatMap((command) => {
    const script = /^npm run (\S+)$/.exec(command)?.[1];
    if (script === undefined) return [command];
    const body = scripts.get(script);
    assert.ok(body !== undefined, `CI runs the npm script ${script}, which package.json lacks`);
    return body.split('&&').map((part) => part.trim());
  });
}

const TEAMRIG = resolve('work', 'teamrig');

describe('localChecks', () => {
  const checks = localChecks(DEFAULT_BASE, TEAMRIG);

  it('runs every command CI runs', () => {
    for (const command of ciCommands()) {
      if (command.startsWith('npm ci')) continue; // installing is the developer's setup
      const script = /^node (?:--\S+ )*(\S+\.ts)/.exec(command)?.[1];
      const tsc = /^tsc -p (\S+)$/.exec(command)?.[1];
      if (script !== undefined) assert.ok(checks.some((check) => check.argv.includes(script)), `no local check runs ${script}`);
      else if (tsc !== undefined) assert.ok(checks.some((check) => check.argv.join(' ') === `node node_modules/typescript/bin/tsc -p ${tsc}`), `no local check runs tsc -p ${tsc}`);
      else if (command === 'npm test') assert.ok(checks.some((check) => check.argv.join(' ') === 'node tools/ci/coverage-cli.ts'), 'the coverage gate runs the tests');
      else assert.fail(`CI runs \`${command}\`, which no local check covers: add it to local-checks.ts`);
    }
  });

  it('runs the plugin tests as CI does, in an empty home', () => {
    assert.match(CI, /^\s*claude plugin test plugins\/teamrig-pane$/m);
    assert.deepEqual(
      checks.find((check) => check.name === 'plugin tests'),
      { name: 'plugin tests', argv: ['claude', 'plugin', 'test', 'plugins/teamrig-pane'], isolatedHome: true },
    );
  });

  it('checks hooks/core against the given teamrig checkout from the plugin folder', () => {
    const sync = checks.find((check) => check.name === 'hooks/core matches the teamrig pin');
    assert.deepEqual(sync?.argv.slice(2), ['scripts/sync-core.ts', '--teamrig', TEAMRIG, '--check']);
    assert.equal(sync?.cwd, 'plugins/teamrig-pane');
    assert.match(CI, /working-directory: plugins\/teamrig-pane/);
  });

  it('checks the commits since the base, names each check once and reads no CI event', () => {
    assert.deepEqual(localChecks('upstream/main', TEAMRIG).find((check) => check.name === 'DCO')?.argv, ['node', 'tools/dco/cli.ts', '--range', 'upstream/main..HEAD']);
    assert.deepEqual(localChecks('upstream/main', TEAMRIG).find((check) => check.name === 'size rule')?.argv, ['node', 'tools/ci/size-rule-cli.ts', '--base', 'upstream/main']);
    assert.equal(new Set(checks.map((check) => check.name)).size, checks.length);
    assert.ok(checks.every((check) => !check.argv.includes('--github')));
  });
});

describe('teamrigCheckout', () => {
  const ROOT = resolve('work', 'pane');
  const config = (value: string): FakeGit => new FakeGit({ [`config --default  --get ${TEAMRIG_CONFIG_KEY}`]: value });
  const only = (dir: string) => (path: string): boolean => path === join(dir, '.git');

  it('takes --teamrig first, then the git config, then a teamrig folder beside the repo, each relative to the root', async () => {
    assert.equal(await teamrigCheckout('../mine', config('/elsewhere\n'), ROOT, only(resolve('work', 'mine'))), resolve('work', 'mine'));
    assert.equal(await teamrigCheckout(undefined, config('../configured\n'), ROOT, only(resolve('work', 'configured'))), resolve('work', 'configured'));
    assert.equal(await teamrigCheckout(undefined, config(''), ROOT, only(TEAMRIG)), TEAMRIG);
  });

  it('refuses a folder that is not a git checkout, and says how to name one', async () => {
    await assert.rejects(teamrigCheckout(undefined, config(''), ROOT, () => false), {
      message: `no teamrig checkout at ${TEAMRIG}: the core-sync check reads one; pass --teamrig <dir> or run git config ${TEAMRIG_CONFIG_KEY} <dir>`,
    });
  });
});
