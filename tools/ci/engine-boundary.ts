/**
 * The engine boundary. The pane's hooks are a view model any front end can draw (the Claude Code dock today, a
 * dedicated UI beside it), so only the dock's own files may import the engine's module, `claude-code`. This reads
 * the hooks' sources and names every other file that does, and every file on the list that no longer does, so the
 * list stays the true size of what a second front end has to write again.
 *
 * The dedicated UI (`ui/`) is that second front end, held from the other side: it draws the same view model with
 * no engine at all, so none of its files may import `claude-code` or one of the dock's own files.
 */

import { posix } from 'node:path';

/** A source file of the plugin, by its `/`-separated path from the repository root. */
export interface PluginSource {
  readonly path: string;
  readonly text: string;
}

/** The folder the boundary runs through; `hooks/core/` (teamrig's read modules) is inside it and held like the rest. */
export const HOOKS = 'plugins/teamrig-pane/hooks';

/**
 * The Claude Code dock's own files, the only hooks that may import the engine: its version check, its slash
 * command, the entry that registers every hook and draws the widgets, and its theme's color for each tone.
 */
export const ENGINE_SURFACE: readonly string[] = [
  `${HOOKS}/claude-code-version.ts`,
  `${HOOKS}/command.ts`,
  `${HOOKS}/register.tsx`,
  `${HOOKS}/theme.ts`,
];

/**
 * An import of the engine's module itself, in any form: `from 'claude-code'` (an import or a re-export, type-only
 * too, on the last line of one spread over several), a bare `import 'claude-code'`, and a dynamic `import()` or
 * `require()`. The quote that closes the name keeps `claude-code/testing` and `./claude-code-version` out.
 */
const ENGINE_IMPORT = /\bfrom\s+['"]claude-code['"]|\bimport\s+['"]claude-code['"]|\b(?:import|require)\s*\(\s*['"]claude-code['"]/;

/** The 1-based lines of `text` that import the engine. */
function engineImportLines(text: string): number[] {
  return text.split(/\r?\n/).flatMap((line, index) => (ENGINE_IMPORT.test(line) ? [index + 1] : []));
}

/**
 * What breaks the boundary, one line each; empty when it holds. A source off the `surface` list that imports the
 * engine is named by file and line; a `surface` path that imports no engine (or is no longer a source) is named
 * too, since a list longer than the truth hides how thin the dock really is.
 */
export function engineBoundaryFindings(sources: readonly PluginSource[], surface: readonly string[]): string[] {
  const findings: string[] = [];
  const importing = new Set<string>();
  for (const source of sources) {
    const lines = engineImportLines(source.text);
    if (lines.length === 0) {
      continue;
    }
    importing.add(source.path);
    if (!surface.includes(source.path)) {
      for (const line of lines) {
        findings.push(`${source.path}:${line}: imports claude-code outside the dock's files: use one of the pane's own types, or move the engine's part to a file on the list`);
      }
    }
  }
  for (const path of surface) {
    if (!importing.has(path)) {
      findings.push(`${path}: is listed as the dock's but imports no claude-code: take it off the list`);
    }
  }
  return findings;
}

/** The dedicated UI's folder: a program for any terminal, drawing the hooks' view model with no engine. */
export const UI = 'plugins/teamrig-pane/ui';

/** The engine's module by the name an import gives it. */
const ENGINE = 'claude-code';

/**
 * The module each import on a line names, in the forms `ENGINE_IMPORT` knows: `from '...'`, a bare `import '...'`,
 * and a dynamic `import()` or `require()`.
 */
const IMPORTED = /\bfrom\s+['"]([^'"]+)['"]|\bimport\s+['"]([^'"]+)['"]|\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]/g;

/** A path without its TypeScript or JavaScript extension, the way an import may name a file either way. */
function extensionless(path: string): string {
  return path.replace(/\.(?:tsx?|jsx?)$/, '');
}

/** The modules a line imports, as written. */
function importedOn(line: string): string[] {
  return [...line.matchAll(IMPORTED)].flatMap((match) => {
    const name = match[1] ?? match[2] ?? match[3];
    return name === undefined ? [] : [name];
  });
}

/**
 * The `surface` file a relative import written in the file at `from` lands on, or null: the import's path is
 * resolved from that file's folder, so `../hooks/theme` is the dock's theme and `./theme` of the UI's own is not.
 */
function dockFileOf(from: string, imported: string, surface: readonly string[]): string | null {
  if (!imported.startsWith('.')) {
    return null;
  }
  const target = extensionless(posix.join(posix.dirname(from), imported));
  return surface.find((path) => extensionless(path) === target) ?? null;
}

/**
 * What breaks the dedicated UI's side of the boundary, one line each; empty when it holds. A `ui/` source that
 * imports the engine, or a file of the dock's `surface`, is named by file and line: either one would tie the
 * program for every terminal to Claude Code.
 */
export function uiBoundaryFindings(sources: readonly PluginSource[], surface: readonly string[]): string[] {
  const findings: string[] = [];
  for (const source of sources) {
    source.text.split(/\r?\n/).forEach((line, index) => {
      for (const imported of importedOn(line)) {
        const where = `${source.path}:${index + 1}`;
        const dock = dockFileOf(source.path, imported, surface);
        if (imported === ENGINE) {
          findings.push(`${where}: imports claude-code in the dedicated UI: it runs with no engine, draw from the pane's own types`);
        } else if (dock !== null) {
          findings.push(`${where}: imports the dock's file ${dock} in the dedicated UI: move what both front ends need to a hooks file off the list`);
        }
      }
    });
  }
  return findings;
}
