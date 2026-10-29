// The format numbers of the files teamrig keeps, as its read modules declare them, and the ones hooks/core
// trails teamrig main by: a format raise in teamrig fails the pane's gate until hooks/core is synced, so a
// pane never goes on skipping the lines a newer teamrig writes. Pure: sync-core.ts does the git and file work.

/**
 * A format number as teamrig declares one (its CONTRIBUTING, Stored files): `export const <NAME>_VERSION = <n>`
 * or `export const <NAME>_FORMAT = <n>`, on a line of its own.
 */
const FORMAT_NUMBER = /^export const ([A-Z][A-Z0-9_]*_(?:VERSION|FORMAT)) = (\d+);?\s*$/gm

/** Every format number the modules' sources declare, by name; a name two modules declare keeps the higher number. */
export function formatNumbers(sources: Iterable<string>): Map<string, number> {
  const numbers = new Map<string, number>()
  for (const source of sources) {
    for (const match of source.matchAll(FORMAT_NUMBER)) {
      const [, name, value] = match
      if (name === undefined || value === undefined) continue
      const held = numbers.get(name)
      numbers.set(name, held === undefined ? Number(value) : Math.max(held, Number(value)))
    }
  }
  return numbers
}

/** A format number hooks/core trails teamrig main by: lower there, or not declared there at all (undefined). */
export type TrailingFormat = { name: string; core: number | undefined; main: number }

/** The format numbers `core` (hooks/core's) holds lower than `main` (teamrig main's), or lacks, by name. */
export function trailingFormats(core: ReadonlyMap<string, number>, main: ReadonlyMap<string, number>): TrailingFormat[] {
  return [...main]
    .filter(([name, number]) => {
      const held = core.get(name)
      return held === undefined || held < number
    })
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, number]) => ({ name, core: core.get(name), main: number }))
}

/** How the check names a trailing format: `EVENT_VERSION 2, teamrig main 3`, or `HIRE_FORMAT 2 only in teamrig main`. */
export function trailingText({ name, core, main }: TrailingFormat): string {
  return core === undefined ? `${name} ${main} only in teamrig main` : `${name} ${core}, teamrig main ${main}`
}
