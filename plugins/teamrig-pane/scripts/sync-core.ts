// Copies teamrig's read modules into hooks/core (vendor.ts says which and how) from the teamrig commit
// scripts/teamrig-pin.json names, or with --check lists every copy that differs from what a sync
// would write. Runs on Node, outside the pane:
//   node --disable-warning=ExperimentalWarning scripts/sync-core.ts --teamrig <repo> [--ref <commit>] [--check]
// --teamrig is a teamrig git checkout: the modules are read from its history (git cat-file), never
// from its working tree, so a local edit there cannot reach the pane. --ref moves the pin to that
// commit first (a sha, branch or tag; a sync only).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CORE_FILES, parsePin, pinText, planSync, unreachedFiles, vendoredText } from './vendor.ts'

const USAGE = 'usage: sync-core.ts --teamrig <repo> [--ref <commit>] [--check]'
const args = process.argv.slice(2)
const check = args.includes('--check')

function fail(message: string, code: number): never {
  console.error(message)
  process.exit(code)
}

/** The value after `flag`, or undefined when the flag is absent; exits with the usage line when its value is missing. */
function flagValue(flag: string): string | undefined {
  const at = args.indexOf(flag)
  if (at < 0) return undefined
  const value = args[at + 1]
  if (value === undefined || value.startsWith('--')) fail(`${flag} needs a value\n${USAGE}`, 2)
  return value
}

const teamrigDir = flagValue('--teamrig') ?? fail(`--teamrig is required\n${USAGE}`, 2)
const ref = flagValue('--ref')
if (check && ref !== undefined) fail(`--check compares hooks/core with the pin; --ref moves the pin, so they do not go together\n${USAGE}`, 2)
const scriptsDir = dirname(fileURLToPath(import.meta.url))
const coreDir = join(scriptsDir, '..', 'hooks', 'core')
const pinPath = join(scriptsDir, 'teamrig-pin.json')

function git(...gitArgs: string[]): string {
  return execFileSync('git', ['-C', teamrigDir, ...gitArgs], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

/** The commit to copy from: --ref resolved in the teamrig checkout, else the pin. */
function pinnedCommit(): string {
  if (ref !== undefined) {
    try {
      return git('rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`).trim()
    } catch {
      return fail(`REFUSED: ${ref} is not a commit in ${teamrigDir}`, 1)
    }
  }
  if (!existsSync(pinPath)) return fail(`REFUSED: no pin at ${pinPath}; name a teamrig commit with --ref`, 1)
  const read = parsePin(readFileSync(pinPath, 'utf8'))
  return read.ok ? read.pin.commit : fail(`REFUSED: ${read.reason} (${pinPath})`, 1)
}

/** Every file under hooks/core, by its path there with forward slashes. */
function presentFiles(dir: string, prefix = ''): Map<string, string> {
  const files = new Map<string, string>()
  if (!existsSync(dir)) return files
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${prefix}${entry.name}`
    if (entry.isDirectory()) for (const [inner, text] of presentFiles(join(dir, entry.name), `${path}/`)) files.set(inner, text)
    else files.set(path, readFileSync(join(dir, entry.name), 'utf8'))
  }
  return files
}

const commit = pinnedCommit()
const problems: string[] = []
const sources = new Map<string, string>()
for (const path of CORE_FILES) {
  try {
    sources.set(path, git('cat-file', 'blob', `${commit}:src/${path}`))
  } catch {
    problems.push(`teamrig's src/${path} is not in ${commit}`)
  }
}
const expected = new Map<string, string>()
for (const [path, source] of sources) {
  const vendored = vendoredText(path, source)
  if (vendored.ok) expected.set(path, vendored.text)
  else problems.push(vendored.reason)
}
if (problems.length === 0) for (const path of unreachedFiles(sources)) problems.push(`CORE_FILES lists ${path}, which teamrig's read entry no longer reaches`)
if (problems.length > 0) fail(`REFUSED at teamrig ${commit}: ${problems.join('; ')}`, 1)

const plan = planSync(expected, presentFiles(coreDir))
if (check) {
  if (plan.write.length === 0 && plan.strays.length === 0) {
    console.log(`hooks/core matches teamrig ${commit} (${expected.size} files)`)
    process.exit(0)
  }
  fail(`DRIFT from teamrig ${commit}: ${[...plan.write.map(([path]) => `${path} differs`), ...plan.strays.map(path => `${path} is not a copied file`)].join('; ')}`, 1)
}

for (const [path, text] of plan.write) {
  const target = join(coreDir, ...path.split('/'))
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, text)
}
if (ref !== undefined) writeFileSync(pinPath, pinText({ commit }))
console.log(`synced ${plan.write.length} of ${expected.size} core files from teamrig ${commit}`)
if (plan.strays.length > 0) console.log(`WARN hooks/core holds file(s) the sync does not write, which --check fails on until they are deleted: ${plan.strays.join(', ')}`)
