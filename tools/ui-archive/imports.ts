/**
 * The step after the emit that makes the dedicated UI run under plain Node. The plugin's sources import each other
 * with no extension (`from '../hooks/screen'`), which the engine and the specs' kit resolve; Node resolves no such
 * name, and `tsc` rewrites only a specifier that ends in `.ts`. So every relative specifier of the emitted files
 * that names no file as it stands is given the `.js` it means, or `/index.js` where it names a folder. A specifier
 * that fits neither is told, never guessed: the archive is not made from a tree Node could not load.
 */

import { posix } from 'node:path';
import ts from 'typescript';

/** A relative specifier no emitted file answers, and the file that holds it. */
export interface MissingImport {
  readonly file: string;
  readonly specifier: string;
}

export interface Completed {
  /** Every file given, by its `/`-separated path from the emit's root, the specifiers of the scripts completed. */
  readonly files: ReadonlyMap<string, string>;
  /** How many specifiers were completed. */
  readonly changed: number;
  readonly missing: readonly MissingImport[];
}

/** A script Node loads as a module; only these are read for imports. */
const SCRIPT = /\.js$/;

/** A specifier that reaches a file beside the one that holds it, never a package or a `node:` module. */
function isRelative(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

/** The string literals of `source` that name a module: static imports, re-exports and dynamic `import()`. */
function specifiersOf(source: ts.SourceFile): ts.StringLiteral[] {
  const found: ts.StringLiteral[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined) {
      if (ts.isStringLiteral(node.moduleSpecifier)) found.push(node.moduleSpecifier);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [first] = node.arguments;
      if (first !== undefined && ts.isStringLiteral(first)) found.push(first);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/**
 * What `specifier`, written in `file`, must say for Node to load it: itself when it names a file, else with `.js`,
 * else with `/index.js`; null when none of the three is among `paths`. The file comes before the folder, as the
 * typecheck's own resolution has it.
 */
function completedSpecifier(file: string, specifier: string, paths: ReadonlySet<string>): string | null {
  const target = posix.join(posix.dirname(file), specifier);
  if (paths.has(target)) return specifier;
  if (paths.has(`${target}.js`)) return `${specifier}.js`;
  if (paths.has(`${target}/index.js`)) return `${specifier}/index.js`;
  return null;
}

/**
 * `files` (a path from the emit's root to its text) with every relative specifier of its scripts completed. A file
 * that is no script is passed as it is. Only the text between a specifier's quotes changes.
 */
export function completeImports(files: ReadonlyMap<string, string>): Completed {
  const paths = new Set(files.keys());
  const out = new Map<string, string>();
  const missing: MissingImport[] = [];
  let changed = 0;
  for (const [file, text] of files) {
    if (!SCRIPT.test(file)) {
      out.set(file, text);
      continue;
    }
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2023, false, ts.ScriptKind.JS);
    let rewritten = text;
    // From the last specifier to the first, so a splice never moves one still to be read.
    for (const literal of specifiersOf(source).reverse()) {
      if (!isRelative(literal.text)) continue;
      const completed = completedSpecifier(file, literal.text, paths);
      if (completed === null) {
        missing.push({ file, specifier: literal.text });
        continue;
      }
      if (completed === literal.text) continue;
      // Inside the quotes: the literal's own text, which holds no escape once it named a path of the emit.
      const from = literal.getStart(source) + 1;
      rewritten = rewritten.slice(0, from) + completed + rewritten.slice(literal.end - 1);
      changed += 1;
    }
    out.set(file, rewritten);
  }
  missing.reverse();
  return { files: out, changed, missing };
}
