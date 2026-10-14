import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT_CLEAN, EXIT_FINDINGS } from '../lib/exit.ts';
import { createGit } from '../lib/git.ts';
import { runMain } from '../lib/run-main.ts';
import { pluginTestFindings } from './plugin-tests.ts';

/** TypeScript and JavaScript sources, where a plugin's tests and their helpers live. */
const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/;

/**
 * Fails when a plugin test is skipped, focused or todo, when a file imports the test kit without a
 * test name, or when there are no plugin tests at all. Reads every source under `plugins/` git
 * tracks or would add (untracked files count, ignored ones such as the engine's types do not).
 */
async function main(): Promise<number> {
  const root = realpathSync(process.cwd());
  const listed = await createGit(root).text(['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'plugins']);
  const sources = listed
    .split('\0')
    .filter((path) => SOURCE.test(path) && existsSync(join(root, ...path.split('/'))))
    .map((path) => ({ path, text: readFileSync(join(root, ...path.split('/')), 'utf8') }));
  const findings = pluginTestFindings(sources);
  if (findings.length === 0) {
    console.log(`plugin tests: clean (${sources.length} source(s))`);
    return EXIT_CLEAN;
  }
  console.log(`plugin tests: ${findings.length} finding(s); every test runs (see CONTRIBUTING.md):`);
  findings.forEach((finding) => console.log(`  ${finding}`));
  return EXIT_FINDINGS;
}

process.exitCode = await runMain('plugin-tests', main, (line) => console.error(line));
