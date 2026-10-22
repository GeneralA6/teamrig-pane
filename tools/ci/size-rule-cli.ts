import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { DEFAULT_COMMITS } from '../../plugins/teamrig-pane/hooks/core/config/defaults.ts';
import { createGit } from '../lib/git.ts';
import { runMain } from '../lib/run-main.ts';
import { revisionsFromGithubEnv, type Revisions } from './github-range.ts';
import { checkCommitSizes } from './size-rule.ts';

/** The base a local run compares with when `--base` is not given. */
const DEFAULT_BASE = 'origin/main';

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      base: { type: 'string' },
      github: { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  const ends: Revisions = values.github
    ? await revisionsFromGithubEnv(process.env, (path) => readFile(path, 'utf8'))
    : { base: values.base ?? DEFAULT_BASE, head: 'HEAD' };
  // The push guard's bounds at teamrig's defaults, as hooks/core holds them at the pinned commit.
  return checkCommitSizes(ends, { git: createGit(process.cwd()), rule: DEFAULT_COMMITS, out: (line) => console.log(line) });
}

process.exitCode = await runMain('size-rule', main, (line) => console.error(line));
