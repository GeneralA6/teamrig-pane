import { existsSync } from 'node:fs';
import type { ResolveFnOutput, ResolveHookContext } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The engine's test kit, which a plugin test imports and node has no package for. */
export const KIT_SPECIFIER = 'claude-code/testing';

/** The endings a plugin's extensionless import may stand for, in the order the engine's bundler tries them. */
const ENDINGS: readonly string[] = ['.ts', '.tsx', '/index.ts', '/index.tsx'];

const EXPLICIT = /\.[cm]?[jt]sx?$|\.json$/;

/** Where a specifier points when the engine resolves it and node's own resolver would not: the kit, or a module named without its ending. */
export function paneTarget(specifier: string, parentURL: string | undefined, kitURL: string, isFile: (path: string) => boolean): string | undefined {
  if (specifier === KIT_SPECIFIER) {
    return kitURL;
  }
  if (parentURL === undefined || !parentURL.startsWith('file:') || !/^\.\.?\//.test(specifier) || EXPLICIT.test(specifier)) {
    return undefined;
  }
  const base = fileURLToPath(new URL(specifier, parentURL));
  const found = ENDINGS.map((ending) => `${base}${ending}`).find((path) => isFile(path));
  return found === undefined ? undefined : pathToFileURL(found).href;
}

type NextResolve = (specifier: string, context?: Partial<ResolveHookContext>) => ResolveFnOutput;

/**
 * A resolve hook that lets node load a plugin's tests and hooks as the engine does: `claude-code/testing` from
 * the node kit beside this file, a relative import without its ending from the file that has it. Every other
 * specifier goes on to node's resolver.
 */
export function paneResolveHook(kitURL: string, isFile: (path: string) => boolean = existsSync) {
  return (specifier: string, context: ResolveHookContext, nextResolve: NextResolve): ResolveFnOutput => {
    const url = paneTarget(specifier, context.parentURL, kitURL, isFile);
    return url === undefined ? nextResolve(specifier, context) : { url, shortCircuit: true };
  };
}
