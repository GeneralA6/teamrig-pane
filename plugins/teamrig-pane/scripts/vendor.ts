// Which register modules the pane reads the register through, and how each copy is made: the
// register's own parser, fold, renames, pauses, token rates, shown status and estimate wording, so
// the pane never keeps a reader of its own that a new event type can outgrow. Pure: sync-core.ts
// does the file work.

/**
 * A module copied into hooks/core, by its name there: `register` modules come from the register's
 * `src/` folder, `guards` is the type-guard module those modules import from outside it.
 */
export type CoreFile = { name: string; source: 'register' | 'guards' }

export const CORE_FILES: readonly CoreFile[] = [
  { name: 'guards.ts', source: 'guards' },
  { name: 'model.ts', source: 'register' },
  { name: 'events.ts', source: 'register' },
  { name: 'graph.ts', source: 'register' },
  { name: 'fold.ts', source: 'register' },
  { name: 'relations.ts', source: 'register' },
  { name: 'ports.ts', source: 'register' },
  { name: 'names.ts', source: 'register' },
  { name: 'pauses.ts', source: 'register' },
  { name: 'rates.ts', source: 'register' },
  { name: 'shown.ts', source: 'register' },
  { name: 'estimates.ts', source: 'register' },
]

/** A relative import of a guards module outside the module's own folder (`'../../x/src/guards.ts'`). */
const GUARDS_IMPORT = /'(?:\.\.\/)+(?:[^'\/]+\/)*guards\.ts'/g
const IMPORT_FROM = /^import\s[^;]*?from\s+'([^']+)'/gm

export type Vendored = { ok: true; text: string } | { ok: false; reason: string }

/** Where `file` comes from, as its header and a refusal name it. */
export function originOf(file: CoreFile): string {
  return file.source === 'register' ? `the register's src/${file.name}` : 'the guards module the register imports'
}

/**
 * The copy of `file` that hooks/core holds: a header naming its origin, and the guards import made
 * local. Refused when the module reaches past the copied set (a node: module, or a register file not
 * in CORE_FILES), so a new dependency in the register fails the sync instead of the installed pane.
 */
export function vendoredText(file: CoreFile, source: string): Vendored {
  const text = source.replaceAll(GUARDS_IMPORT, "'./guards.ts'")
  const local = new Set(CORE_FILES.map(f => `./${f.name}`))
  for (const match of text.matchAll(IMPORT_FROM)) {
    const target = match[1]
    if (target !== undefined && !local.has(target)) return { ok: false, reason: `${originOf(file)} imports ${target}, which hooks/core does not copy` }
  }
  const header = `// Copied from ${originOf(file)} by scripts/sync-core.ts: change it there, then run the sync.\n`
  return { ok: true, text: header + text }
}
