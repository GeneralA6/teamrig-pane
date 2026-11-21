import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { EXIT_CLEAN, EXIT_FINDINGS } from '../lib/exit.ts';
import { runMain } from '../lib/run-main.ts';
import { ARCHIVE_NAME, archiveText, sha256Of } from './archive.ts';
import { builtArchive, outOf, versionOf } from './build.ts';
import { SPEAKS } from '../../plugins/teamrig-pane/hooks/interface.ts';

/** Every file under `folder`, by its `/`-separated path from it. */
function filesUnder(folder: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const entry of readdirSync(folder, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files.set(relative(folder, path).split(sep).join('/'), readFileSync(path, 'utf8'));
  }
  return files;
}

/**
 * Emits the dedicated UI with `tsc` (tsconfig.ui.json) into a folder of its own, completes the emit's imports and
 * writes the archive `teamrig ui` fetches, printing the sha256 its release pins. Run from the repository root.
 */
async function main(): Promise<number> {
  const root = realpathSync(process.cwd());
  const out = resolve(root, outOf(process.argv.slice(2)));
  const emit = mkdtempSync(join(tmpdir(), 'teamrig-ui-emit-'));
  try {
    const tsc = spawnSync(
      process.execPath,
      [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.ui.json', '--outDir', emit],
      { cwd: root, encoding: 'utf8' },
    );
    // A `tsc` that could not start has no exit code, and is told the same way.
    if (tsc.status !== 0) {
      console.log(`ui archive: the emit failed (tsc exit ${String(tsc.status)}):`);
      console.log(`${tsc.stdout}${tsc.stderr}`.trimEnd());
      return EXIT_FINDINGS;
    }
    const manifest = readFileSync(join(root, 'plugins', 'teamrig-pane', '.claude-plugin', 'plugin.json'), 'utf8');
    const { archive, completed } = builtArchive({ version: versionOf(manifest), interface: SPEAKS }, filesUnder(emit));
    const text = archiveText(archive);
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, ARCHIVE_NAME), text, 'utf8');
    console.log(`ui archive: ${archive.files.length} file(s) of ${archive.version} for interface ${archive.interface}, ${completed} import(s) completed, in ${join(out, ARCHIVE_NAME)}`);
    console.log(`sha256 ${sha256Of(text)}`);
    return EXIT_CLEAN;
  } finally {
    rmSync(emit, { recursive: true, force: true });
  }
}

process.exitCode = await runMain('ui-archive', main, (line) => console.error(line));
