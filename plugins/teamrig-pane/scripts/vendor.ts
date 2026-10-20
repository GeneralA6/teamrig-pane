// Which teamrig modules the pane reads teamrig's files through, and how each copy is made: teamrig's
// read entry (src/read/index.ts) and every module it reaches, so the pane parses, folds and counts
// exactly as teamrig does and never keeps a reader of its own that a format change can outgrow.
// Pure: sync-core.ts does the git and file work.

/** The module the pane imports; every other copy is only what it reaches. */
export const READ_ENTRY = 'read/index.ts'

/**
 * teamrig's read entry and every module it reaches, by their path under teamrig's `src/`; hooks/core
 * holds each at the same path. Listed, not discovered: a new import in teamrig fails the sync until it
 * is added here, so nothing reaches the installed pane unreviewed.
 */
export const CORE_FILES: readonly string[] = [
  READ_ENTRY,
  'config/defaults.ts',
  'config/launch.ts',
  'config/limits.ts',
  'config/migrate.ts',
  'config/parse.ts',
  'config/priorities.ts',
  'config/reader.ts',
  'config/roster.ts',
  'config/text.ts',
  'config/types.ts',
  'coordinator/targets.ts',
  'core/guards.ts',
  'core/ids.ts',
  'core/jsonl.ts',
  'core/time.ts',
  'core/zone.ts',
  'inbox/marks.ts',
  'inbox/unread.ts',
  'names/rename.ts',
  'readonly-shell/rules.ts',
  'register/card.ts',
  'register/events.ts',
  'register/fold.ts',
  'register/layout.ts',
  'register/marker.ts',
  'register/model.ts',
  'register/snapshot.ts',
  'register/tree.ts',
  'register/verify.ts',
  'register/views.ts',
  'register/waits.ts',
  'rules/keys.ts',
  'turn-log/entry.ts',
]

/** Static imports and re-exports (`import x from '…'`, `export { y } from '…'`), across lines. */
const FROM_CLAUSE = /^\s*(?:import|export)\s[^;]*?\sfrom\s*['"]([^'"]+)['"]/gm
/** A side-effect import, `import '…'`. */
const BARE_IMPORT = /^\s*import\s*['"]([^'"]+)['"]/gm
/** A dynamic import, `import(…)`: its target cannot be checked, so a module holding one is refused. */
const DYNAMIC_IMPORT = /\bimport\s*\(/

export type Vendored = { ok: true; text: string } | { ok: false; reason: string }

/** The header every copy starts with, naming where it comes from. */
export function headerOf(path: string): string {
  return `// Copied from teamrig's src/${path} by scripts/sync-core.ts: change it there, then run the sync.\n`
}

/** Every module `source` imports or re-exports from, as written. */
export function importsOf(source: string): string[] {
  return [...source.matchAll(FROM_CLAUSE), ...source.matchAll(BARE_IMPORT)].flatMap(match => (match[1] === undefined ? [] : [match[1]]))
}

/** A relative import's target as a path under `src/`; null when it is not relative or climbs out of `src/`. */
export function resolveImport(from: string, target: string): string | null {
  if (!target.startsWith('./') && !target.startsWith('../')) return null
  const parts = from.split('/').slice(0, -1)
  for (const part of target.split('/')) {
    if (part === '..') {
      if (parts.pop() === undefined) return null
    } else if (part !== '.') parts.push(part)
  }
  return parts.join('/')
}

/**
 * The copy of teamrig's `src/<path>` that hooks/core holds: the header, then the module byte for byte.
 * Refused when it reaches past the copied set (a `node:` module, a package, a dynamic import, or a
 * teamrig module not in CORE_FILES), so a new dependency in teamrig fails the sync, not the installed pane.
 */
export function vendoredText(path: string, source: string): Vendored {
  if (DYNAMIC_IMPORT.test(source)) return { ok: false, reason: `teamrig's src/${path} has a dynamic import, which hooks/core cannot check` }
  const copied = new Set(CORE_FILES)
  for (const target of importsOf(source)) {
    const resolved = resolveImport(path, target)
    if (resolved === null || !copied.has(resolved)) return { ok: false, reason: `teamrig's src/${path} imports ${target}, which hooks/core does not copy` }
  }
  return { ok: true, text: headerOf(path) + source }
}

/** The CORE_FILES the read entry no longer reaches through `sources` (teamrig's modules by path), so a dropped import drops its copy too. */
export function unreachedFiles(sources: ReadonlyMap<string, string>): string[] {
  const reached = new Set<string>()
  const queue = [READ_ENTRY]
  for (let path = queue.pop(); path !== undefined; path = queue.pop()) {
    if (reached.has(path)) continue
    reached.add(path)
    for (const target of importsOf(sources.get(path) ?? '')) {
      const resolved = resolveImport(path, target)
      if (resolved !== null) queue.push(resolved)
    }
  }
  return CORE_FILES.filter(path => !reached.has(path))
}

/** What a sync changes in hooks/core: the copies to write, and the files there it does not write. */
export type SyncPlan = { write: [path: string, text: string][]; strays: string[] }

/** The copies that are missing or differ from `expected`, and the files `present` holds that no copy names; both by path under hooks/core. */
export function planSync(expected: ReadonlyMap<string, string>, present: ReadonlyMap<string, string>): SyncPlan {
  return {
    write: [...expected].filter(([path, text]) => present.get(path) !== text),
    strays: [...present.keys()].filter(path => !expected.has(path)).sort(),
  }
}

/** The pin file (scripts/teamrig-pin.json): the teamrig commit hooks/core is copied from. */
export type Pin = { commit: string }

const FULL_SHA = /^[0-9a-f]{40}$/

/** The pin in a pin file's text, or why it cannot be used. */
export function parsePin(text: string): { ok: true; pin: Pin } | { ok: false; reason: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'the pin file is not JSON' }
  }
  const commit = typeof raw === 'object' && raw !== null && 'commit' in raw ? raw.commit : undefined
  if (typeof commit !== 'string' || !FULL_SHA.test(commit)) return { ok: false, reason: 'the pin file needs "commit": a full 40-digit teamrig commit sha' }
  return { ok: true, pin: { commit } }
}

/** The pin file's text for a commit, as sync-core.ts writes it. */
export function pinText(pin: Pin): string {
  return `${JSON.stringify(pin, null, 2)}\n`
}
