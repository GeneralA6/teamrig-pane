/**
 * The plugin test gate. `claude plugin test` has no flag that fails on a test kept from running, so
 * this reads the plugins' test sources: a skipped or todo test passes while it catches nothing, a
 * focused one silently skips every other test in its file, and a file that imports the test kit
 * without a test name is never run at all.
 */

/** A source file under `plugins/`, by its `/`-separated path from the repository root. */
export interface PluginSource {
  readonly path: string;
  readonly text: string;
}

/** `test.skip`, `describe.only`, `it.todo` and the like, and the `xit(` / `xtest(` / `xdescribe(` spellings. */
const HELD_CALL = /\b(?:test|it|describe)\.(?:skip|only|todo|skipIf|todoIf|failing)\b|\bx(?:it|test|describe)\s*\(/g;

/** The module a plugin's tests import their runner's `test`, `expect` and `mock` from. */
const TEST_KIT = /\bfrom\s+['"]claude-code\/testing['"]/;

/** A file `claude plugin test` runs: `*.test.ts` or `*.test.tsx`. */
const TEST_FILE = /\.test\.tsx?$/;

/** What keeps the plugins' tests from all running as written, one line each; empty when nothing does. */
export function pluginTestFindings(sources: readonly PluginSource[]): string[] {
  const tests = sources.filter((source) => TEST_FILE.test(source.path));
  if (tests.length === 0) {
    return ['no plugin test files (plugins/<name>/**/*.test.ts or *.test.tsx): the plugin tests would pass without running'];
  }
  const findings: string[] = [];
  for (const source of tests) {
    source.text.split(/\r?\n/).forEach((line, index) => {
      for (const match of line.matchAll(HELD_CALL)) {
        findings.push(`${source.path}:${index + 1}: ${match[0].replace(/\s*\($/, '')} keeps a test from running as written`);
      }
    });
  }
  for (const source of sources) {
    if (!TEST_FILE.test(source.path) && TEST_KIT.test(source.text)) {
      findings.push(`${source.path}: imports claude-code/testing but is not named *.test.ts or *.test.tsx, so its tests never run`);
    }
  }
  return findings;
}
