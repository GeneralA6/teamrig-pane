import { join, resolve } from 'node:path';
import type { Git } from '../lib/git.ts';
import type { LocalCheck } from './local-gate.ts';

/** TypeScript's compiler, run by this Node (npm cannot be spawned without a shell on Windows). */
const TSC = 'node_modules/typescript/bin/tsc';

/** The base the commit checks compare with when `--base` is not given. */
export const DEFAULT_BASE = 'origin/main';

/** The git config key naming the teamrig checkout the core-sync check reads. */
export const TEAMRIG_CONFIG_KEY = 'teamrig.checkout';

/**
 * The teamrig checkout `sync-core.ts --check` compares hooks/core with, relative to the repo root: `--teamrig`,
 * else the clone's `teamrig.checkout` git config, else a `teamrig` folder beside the repo. Throws when it is
 * not a git checkout.
 */
export async function teamrigCheckout(option: string | undefined, git: Git, root: string, exists: (path: string) => boolean): Promise<string> {
  const configured = (await git.text(['config', '--default', '', '--get', TEAMRIG_CONFIG_KEY])).trim();
  const dir = resolve(root, option ?? (configured === '' ? join('..', 'teamrig') : configured));
  if (!exists(join(dir, '.git'))) {
    throw new Error(`no teamrig checkout at ${dir}: the core-sync check reads one; pass --teamrig <dir> or run git config ${TEAMRIG_CONFIG_KEY} <dir>`);
  }
  return dir;
}

/**
 * Every check CI runs on a pull request, in the order the local gate runs them (fast ones first). The
 * coverage gate runs the whole test suite, so `npm test` is not repeated; `npm run typecheck` is its two
 * steps. Unlike CI, it runs on one machine, one Node and the Claude Code installed there (CI pins one
 * release for the plugin tests): a failure only another OS, Node or release shows goes unseen.
 */
export function localChecks(base: string, teamrig: string): readonly LocalCheck[] {
  const range = `${base}..HEAD`;
  return [
    { name: 'scrub: tree', argv: ['node', 'tools/scrub/cli.ts', '--tree'] },
    { name: 'scrub: commits', argv: ['node', 'tools/scrub/cli.ts', '--range', range] },
    { name: 'DCO', argv: ['node', 'tools/dco/cli.ts', '--range', range] },
    { name: 'size rule', argv: ['node', 'tools/ci/size-rule-cli.ts', '--base', base] },
    { name: 'plugin tests: none skipped', argv: ['node', 'tools/ci/plugin-tests-cli.ts'] },
    { name: 'doc pictures', argv: ['node', 'tools/docs/images-cli.ts', '--check'] },
    { name: 'plugin version gate', argv: ['node', 'tools/ci/plugin-version-cli.ts', '--base', base] },
    {
      name: 'hooks/core matches the teamrig pin',
      argv: ['node', '--disable-warning=ExperimentalWarning', 'scripts/sync-core.ts', '--teamrig', teamrig, '--check'],
      cwd: 'plugins/teamrig-pane',
    },
    { name: 'typecheck', argv: ['node', TSC, '-p', 'tsconfig.json'] },
    { name: 'typecheck: pane', argv: ['node', TSC, '-p', 'tsconfig.pane.json'] },
    { name: 'coverage gate', argv: ['node', 'tools/ci/coverage-cli.ts'] },
    { name: 'plugin tests', argv: ['claude', 'plugin', 'test', 'plugins/teamrig-pane'], isolatedHome: true },
  ];
}
