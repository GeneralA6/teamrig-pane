import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { EXIT_CLEAN, EXIT_FINDINGS } from '../lib/exit.ts';
import { createGit } from '../lib/git.ts';
import { runMain } from '../lib/run-main.ts';
import { DEFAULT_BASE, localChecks, prePushChecks, teamrigCheckout } from './local-checks.ts';
import { type CheckScope, machineDeps, parsePushUpdates, proveHead, provePush } from './local-gate.ts';

/**
 * The local gate (see local-gate.ts): proves the checked-out tree with every check CI runs, once per tree.
 * `--pre-push` is the pre-push hook: it reads the pushed commits from stdin and proves each one with the light
 * checks (T4363), every check but the coverage gate's whole suite, which required CI runs on the pull request; a
 * push to main is refused before any check. `--light` proves the checkout with the light checks by hand.
 * `--teamrig <dir>` names the teamrig checkout the core-sync check reads (see local-checks.ts).
 * Nothing skips it: a push with `--no-verify` is not allowed.
 */
async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      base: { type: 'string', default: DEFAULT_BASE },
      'pre-push': { type: 'boolean', default: false },
      light: { type: 'boolean', default: false },
      teamrig: { type: 'string' },
    },
    strict: true,
    // git passes the pre-push hook the remote's name and URL, which it does not need.
    allowPositionals: true,
  });
  const root = (await createGit(process.cwd()).text(['rev-parse', '--show-toplevel'])).trim();
  const deps = machineDeps(root, process.env, (line) => console.log(line));
  const teamrig = await teamrigCheckout(values.teamrig, deps.git, root, existsSync);
  const scope: CheckScope = values['pre-push'] || values.light ? 'light' : 'full';
  if (scope === 'light') console.log('pre-push checks: every local check but the coverage gate; required CI runs the whole suite on every OS on the pull request');
  const checks = scope === 'light' ? prePushChecks(values.base, teamrig) : localChecks(values.base, teamrig);
  const verdict = values['pre-push'] ? await provePush(parsePushUpdates(readFileSync(0, 'utf8')), checks, deps, scope) : await proveHead(checks, deps, scope);
  if (verdict.passed) return EXIT_CLEAN;
  console.log(`${scope === 'light' ? 'pre-push checks' : 'local checks'}: REFUSED ${verdict.reason}`);
  return EXIT_FINDINGS;
}

process.exitCode = await runMain('local', main, (line) => console.error(line));
