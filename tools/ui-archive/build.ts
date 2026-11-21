/**
 * The dedicated UI's archive from what `tsc` emitted: the scripts with their relative imports completed
 * (imports.ts), and beside them the `package.json` that makes Node load them as modules. An emit Node could not
 * load, one import of which names no emitted file, makes no archive.
 */

import { archiveOf, type UiArchive } from './archive.ts';
import { completeImports } from './imports.ts';

/** The script `teamrig ui` starts `node` on: the emit of `plugins/teamrig-pane/ui/main.ts`. */
export const ENTRY = 'ui/main.js';

/** At the archive's root, so every script under it is a module to Node. */
export const PACKAGE = 'package.json';
export const PACKAGE_TEXT = '{"type":"module"}\n';

/** Where the archive is written when `--out` names no folder; under `.tmp/`, which git ignores. */
export const DEFAULT_OUT = '.tmp/ui-archive';

/** The folder the tool's words name: `--out <folder>`, else the default; any other word is refused. */
export function outOf(args: readonly string[]): string {
  if (args.length === 0) return DEFAULT_OUT;
  const [flag, folder, ...rest] = args;
  if (flag !== '--out' || folder === undefined || rest.length > 0) throw new Error('usage: node tools/ui-archive/cli.ts [--out <folder>]');
  return folder;
}

/** The pane release the sources are: the version `manifest`, the text of the plugin's manifest, names. */
export function versionOf(manifest: string): string {
  const read: unknown = JSON.parse(manifest);
  if (typeof read !== 'object' || read === null || !('version' in read) || typeof read.version !== 'string') {
    throw new Error('the plugin manifest names no version');
  }
  return read.version;
}

export interface Built {
  readonly archive: UiArchive;
  /** How many relative imports were given their extension. */
  readonly completed: number;
}

/** The archive of `emitted` (a path from the emit's root to its text) for the pane release `version`. */
export function builtArchive(version: string, emitted: ReadonlyMap<string, string>): Built {
  if (emitted.has(PACKAGE)) throw new Error(`the emit holds a ${PACKAGE} of its own, which the archive writes`);
  const { files, changed, missing } = completeImports(emitted);
  if (missing.length > 0) {
    const lines = missing.map(({ file, specifier }) => `${file}: ${specifier}`);
    throw new Error(`${missing.length} import(s) name no emitted file: ${lines.join('; ')}`);
  }
  return { archive: archiveOf(version, ENTRY, new Map([...files, [PACKAGE, PACKAGE_TEXT]])), completed: changed };
}
