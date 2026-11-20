/**
 * The engine boundary. The pane's hooks are a view model any front end can draw (the Claude Code dock today, a
 * dedicated UI beside it), so only the dock's own files may import the engine's module, `claude-code`. This reads
 * the hooks' sources and names every other file that does, and every file on the list that no longer does, so the
 * list stays the true size of what a second front end has to write again.
 */

/** A source file under the plugin's hooks, by its `/`-separated path from the repository root. */
export interface HookSource {
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
export function engineBoundaryFindings(sources: readonly HookSource[], surface: readonly string[]): string[] {
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
