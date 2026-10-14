// Copies the register's core modules into hooks/core (vendor.ts says which and how), or with --check
// lists the copies that differ from what a sync would write. Runs on Node, outside the pane:
//   node --disable-warning=ExperimentalWarning scripts/sync-core.ts --register <dir> --guards <file> [--check]
// --register is the register's folder (its modules are under src/); --guards is the type-guard module
// they import from outside it. Name a staging copy of the register to sync the pane in the same step
// as the register's swap.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CORE_FILES, originOf, vendoredText, type CoreFile } from './vendor.ts'

const USAGE = 'usage: sync-core.ts --register <dir> --guards <file> [--check]'
const args = process.argv.slice(2)
const check = args.includes('--check')
/** The value after `flag`; exits with the usage line when the flag or its value is missing. */
function flagValue(flag: string): string {
  const at = args.indexOf(flag)
  const value = at < 0 ? undefined : args[at + 1]
  if (value === undefined || value.startsWith('--')) {
    console.error(`${flag} is required\n${USAGE}`)
    process.exit(2)
  }
  return value
}
const registerDir = flagValue('--register')
const guardsFile = flagValue('--guards')
const coreDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'core')

/** Where a copy is read from. */
function originPath(file: CoreFile): string {
  return file.source === 'register' ? join(registerDir, 'src', file.name) : guardsFile
}

const problems: string[] = []
const expected = new Map<string, string>()
for (const file of CORE_FILES) {
  const path = originPath(file)
  if (!existsSync(path)) {
    problems.push(`${originOf(file)} is not at ${path}`)
    continue
  }
  const vendored = vendoredText(file, readFileSync(path, 'utf8'))
  if (vendored.ok) expected.set(file.name, vendored.text)
  else problems.push(vendored.reason)
}
if (problems.length > 0) {
  console.error(`REFUSED: ${problems.join('; ')}`)
  process.exit(1)
}

const present = existsSync(coreDir) ? readdirSync(coreDir) : []
const extra = present.filter(name => !expected.has(name))
const drifted = [...expected].filter(([name, text]) => !existsSync(join(coreDir, name)) || readFileSync(join(coreDir, name), 'utf8') !== text)

if (check) {
  if (drifted.length === 0 && extra.length === 0) {
    console.log(`hooks/core matches ${registerDir} (${expected.size} files)`)
    process.exit(0)
  }
  console.error(`DRIFT: ${[...drifted.map(([name]) => `${name} differs`), ...extra.map(name => `${name} is not a core file`)].join('; ')}`)
  process.exit(1)
}

if (extra.length > 0) {
  console.error(`REFUSED: hooks/core holds files the sync does not write (${extra.join(', ')}); remove them by hand`)
  process.exit(1)
}
mkdirSync(coreDir, { recursive: true })
for (const [name, text] of drifted) writeFileSync(join(coreDir, name), text)
console.log(`synced ${drifted.length} of ${expected.size} core files from ${registerDir}`)
