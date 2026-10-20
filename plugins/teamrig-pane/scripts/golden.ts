// Writes tests/golden-register.ts: a register the real teamrig CLI writes at the commit
// scripts/teamrig-pin.json names, and what teamrig prints for it, so tests/golden.test.ts holds the
// pane's rows, unread counts and WARN line to teamrig's own. Runs on Node, outside the pane:
//   node --disable-warning=ExperimentalWarning scripts/golden.ts --teamrig <repo>
// --teamrig is a teamrig git checkout: teamrig's package.json and src/ are copied from its history
// at the pin (git cat-file), never from its working tree, into a scratch folder the CLI runs from.
// Rerun it after each sync-core sync, so the capture always comes from the code the pane copied.
// Each CLI run reads a fixed clock (golden-clock.ts, a minute after the last run's), so a rerun at the same pin
// writes the same file.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DEFAULT_REGISTER } from '../hooks/core/read/index.ts'
import {
  GOLDEN_CLOCK_VARIABLE,
  GOLDEN_SESSION,
  GoldenClock,
  goldenModule,
  realClockReads,
  underGoldenRoot,
  type GoldenRegister,
  type InboxState,
  type ListedFixture,
} from './golden-format.ts'
import { parsePin } from './vendor.ts'

const USAGE = 'usage: golden.ts --teamrig <repo>'
const TEAM = 'demo'
const FIXTURES = ['events-v0.jsonl', 'events-v1.jsonl', 'events-v2.jsonl']
/** Longer than any CLI run takes: a run past it (a lock wait that the fixed clock never ends) stops the capture. */
const RUN_TIMEOUT_MS = 60_000
const args = process.argv.slice(2)

/** A capture that cannot go on, with the exit code to end on; thrown so the scratch folder is still removed. */
class Stop extends Error {
  readonly code: number
  constructor(message: string, code: number) {
    super(message)
    this.code = code
  }
}

function fail(message: string, code: number): never {
  throw new Stop(message, code)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value)
}

const at = args.indexOf('--teamrig')
const teamrigArg = at < 0 ? undefined : args[at + 1]
if (teamrigArg === undefined || teamrigArg.startsWith('--')) {
  console.error(`--teamrig needs a teamrig checkout\n${USAGE}`)
  process.exit(2)
}
const teamrigDir = teamrigArg
const scriptsDir = dirname(fileURLToPath(import.meta.url))
const pinRead = parsePin(readFileSync(join(scriptsDir, 'teamrig-pin.json'), 'utf8'))
if (!pinRead.ok) {
  console.error(`REFUSED: ${pinRead.reason}`)
  process.exit(1)
}
const pin = pinRead.pin.commit

const root = realpathSync(mkdtempSync(join(tmpdir(), 'teamrig-golden-')))
const cli = join(root, 'teamrig')
const kit = join(root, 'kit')
const project = join(root, 'proj')
const state = join(kit, 'teams', TEAM, 'state')
const eventsFile = join(state, 'events.jsonl')
const marksFile = join(state, 'inbox-marks.jsonl')
const inboxFile = join(state, 'inbox', 'alpha.md')
const configFile = join(kit, 'teams', TEAM, 'config.json')
const clock = new GoldenClock()
const clockPreload = pathToFileURL(join(scriptsDir, 'golden-clock.ts')).href

function git(gitArgs: readonly string[], input?: string): Buffer {
  return execFileSync('git', ['-C', teamrigDir, ...gitArgs], { input, maxBuffer: 256 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] })
}

/**
 * Writes teamrig's package.json and src/ (its tests left out) at the pin under `cli`, read from git history. A source
 * that reads a timer clock stops the capture, as golden-clock.ts fixes the Date clock alone.
 */
function copyTeamrig(): void {
  const paths = git(['ls-tree', '-r', '-z', '--name-only', pin, '--', 'package.json', 'src'])
    .toString('utf8')
    .split('\0')
    .filter(path => path !== '' && !path.endsWith('.test.ts'))
  const batch = git(['cat-file', '--batch'], `${paths.map(path => `${pin}:${path}`).join('\n')}\n`)
  const clockReads: string[] = []
  let offset = 0
  for (const path of paths) {
    const headerEnd = batch.indexOf(10, offset)
    const header = batch.subarray(offset, headerEnd).toString('utf8').split(' ')
    const size = Number(header[2])
    if (header[1] !== 'blob' || !Number.isInteger(size)) fail(`REFUSED: git cat-file answered "${header.join(' ')}" for ${path}`, 1)
    const target = join(cli, ...path.split('/'))
    const content = batch.subarray(headerEnd + 1, headerEnd + 1 + size)
    if (path.endsWith('.ts')) clockReads.push(...realClockReads(content.toString('utf8')).map(line => `${path}:${line}`))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
    offset = headerEnd + 1 + size + 1
  }
  if (clockReads.length > 0) fail(`REFUSED: teamrig ${pin} reads a timer clock, which golden-clock.ts cannot fix: ${clockReads.join(', ')}`, 1)
}

/** The environment without anything that points teamrig at a real team or session. */
const BASE_ENV = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('TEAMRIG_') && key !== 'CLAUDE_CODE_SESSION_ID' && key !== 'CLAUDE_PROJECT_DIR'),
)

/** What a CLI run printed, and the instant its clock was fixed at. */
type Printed = { stdout: string; stderr: string; at: number }

/** claudeSession: the Claude Code session it runs as; at: its clock's instant, else the capture clock's next. */
type RunOptions = { claudeSession?: string; at?: number }

/**
 * Runs the copied teamrig CLI in the project folder against the scratch kit home, its clock fixed (golden-clock.ts);
 * any exit but 0, or a run past RUN_TIMEOUT_MS, stops the capture.
 */
function teamrig(argv: readonly string[], options: RunOptions = {}): Printed {
  const at = options.at ?? clock.next()
  const session = options.claudeSession === undefined ? {} : { CLAUDE_CODE_SESSION_ID: options.claudeSession }
  const env = { ...BASE_ENV, TEAMRIG_HOME: kit, [GOLDEN_CLOCK_VARIABLE]: String(at), ...session }
  const main = join(cli, 'src', 'cli', 'main.ts')
  const argvWithClock = ['--disable-warning=ExperimentalWarning', '--import', clockPreload, main, ...argv]
  const ran = spawnSync(process.execPath, argvWithClock, { cwd: project, env, encoding: 'utf8', timeout: RUN_TIMEOUT_MS })
  if (ran.error !== undefined) fail(`REFUSED: teamrig ${argv.join(' ')} did not finish: ${ran.error.message}`, 1)
  if (ran.status !== 0) fail(`REFUSED: teamrig ${argv.join(' ')} exited ${String(ran.status)}: ${ran.stderr}${ran.stdout}`, 1)
  return { stdout: ran.stdout, stderr: ran.stderr, at }
}

/** `teamrig <argv> --session <session>`: the command as that session runs it. */
function as(session: string, ...argv: string[]): Printed {
  return teamrig([...argv, '--session', session])
}

/** The config text with one more named priority under `register.priorities`, after teamrig's defaults when it names none. */
function withPriority(text: string, priority: { id: number; name: string }): string {
  const config: unknown = JSON.parse(text)
  if (!isRecord(config)) return fail(`REFUSED: ${configFile} is not a JSON object`, 1)
  const register = isRecord(config['register']) ? config['register'] : {}
  const named = register['priorities']
  const priorities = isList(named) ? named : DEFAULT_REGISTER.priorities
  return `${JSON.stringify({ ...config, register: { ...register, priorities: [...priorities, priority] } }, null, 2)}\n`
}

/** A status line of the register, moved to a task id no create names. */
function orphanOf(events: string): string {
  for (const line of events.split('\n')) {
    const event: unknown = line.trim() === '' ? null : JSON.parse(line)
    if (isRecord(event) && event['type'] === 'status') return JSON.stringify({ ...event, id: 'T99' })
  }
  return fail(`REFUSED: ${eventsFile} holds no status line to copy`, 1)
}

const read = (path: string) => readFileSync(path, 'utf8')
const clean = (text: string) => underGoldenRoot(text, root)

/** The inbox files now and what `inbox status` prints for them. */
function inboxState(label: string): InboxState {
  return { label, inbox: clean(read(inboxFile)), marks: clean(read(marksFile)), status: clean(as('alpha', 'inbox', 'status').stdout) }
}

try {
  copyTeamrig()
  mkdirSync(project)

  // Every event kind, a null ref (no --ref, then update --ref none), a priority-only update, a goal with a space.
  teamrig(['team', 'create', TEAM, '--sessions', 'lead,alpha,beta', '--project', project])
  as('lead', 'add', '--owner', 'alpha', '--priority', 'p1', '--title', 'First task with ref', '--description', 'The first task, with a ref', '--ref', 'msg 10-15')
  as('lead', 'add', '--owner', 'alpha', '--priority', 'p3', '--title', 'No ref task', '--description', 'A task with no ref')
  as('lead', 'add', '--owner', 'alpha', '--priority', 'p2', '--title', 'Goals task', '--description', 'A task with goals, a due and a week', '--ref', 'doc:1', '--goals', 'G1,roadmap goal', '--due', '2026-10-20', '--week', '2026-10-12')
  as('alpha', 'add', '--owner', 'beta', '--priority', 'p4', '--title', 'Beta task from alpha', '--description', 'A task one session asks of another', '--ref', 'x')
  as('lead', 'add', '--owner', 'alpha', '--priority', 'p5', '--title', 'To be dropped', '--description', 'A task dropped later', '--ref', 'r')
  as('alpha', 'set', 'T1', '--status', 'in-progress')
  as('alpha', 'set', 'T2', '--status', 'waiting', '--waits', 'decision:owner,time:2030-01-09 12:00', '--note', 'waiting on beta')
  as('alpha', 'update', 'T3', '--after', 'T1')
  as('beta', 'set', 'T4', '--status', 'done', '--note', 'shipped', '--evidence', 'sha abc', '--skill', 'none')
  as('alpha', 'set', 'T5', '--status', 'dropped', '--note', 'not needed')
  as('lead', 'update', 'T2', '--priority', 'p2')
  as('alpha', 'update', 'T1', '--ref', 'none')
  as('alpha', 'update', 'T3', '--priority', 'p1', '--title', 'Goals task renamed')
  // A rename the pane never reads: owners stay session ids.
  as('lead', 'rename', 'alpha', 'alpha-team')
  // A priority only the team config names.
  writeFileSync(configFile, withPriority(read(configFile), { id: 7, name: 'icebox' }))
  as('lead', 'add', '--owner', 'alpha', '--priority', 'p7', '--title', 'Icebox task', '--description', 'A task at a priority only the config names')
  // A task of another session that needs one of alpha's, so alpha's row says whom it holds up.
  as('beta', 'add', '--owner', 'beta', '--priority', 'p3', '--title', 'Beta task after T1', '--description', 'A task that needs a task of another session', '--after', 'T1', '--due', '2026-10-22')

  // The inbox: read to its second line, one more line, then trimmed from the top, then rewritten.
  as('lead', 'inbox', 'add', '--to', 'alpha', '--text', 'first line')
  as('lead', 'inbox', 'add', '--to', 'alpha', '--text', 'second line')
  teamrig(['inbox', 'read', '--session', 'alpha'], { claudeSession: GOLDEN_SESSION })
  as('lead', 'inbox', 'add', '--to', 'alpha', '--text', 'third line')
  const inbox = [inboxState('after a read and one more line')]
  writeFileSync(inboxFile, read(inboxFile).split('\n').slice(1).join('\n'))
  inbox.push(inboxState('trimmed from the top'))
  writeFileSync(inboxFile, 'a rewritten line\nanother rewritten line\n')
  inbox.push(inboxState('rewritten'))

  // Lines teamrig skips: one from a newer teamrig, one torn, one naming no task.
  const events = read(eventsFile)
  const newer = JSON.stringify({ v: 3, type: 'vote', id: 'T1', at: new Date(clock.next()).toISOString(), by: 'lead', choice: 'ship' })
  writeFileSync(eventsFile, `${events}${newer}\n{"v":2,"type":"status","id":"T2"\n${orphanOf(events)}\n`)
  const listed = teamrig(['list', '--status', 'all', '--all'])
  const generatedAt = listed.at
  const files: Record<string, string> = {
    'kit/teams/demo/config.json': clean(read(configFile)),
    'kit/teams/demo/state/events.jsonl': clean(read(eventsFile)),
    'kit/teams/demo/state/inbox-marks.jsonl': clean(read(marksFile)),
    'kit/teams/demo/state/inbox/alpha.md': clean(read(inboxFile)),
    'proj/.teamrig.json': clean(read(join(project, '.teamrig.json'))),
  }

  // teamrig's own register fixtures, listed by the same CLI at the same instant, which the test reads them at.
  const fixtures: ListedFixture[] = FIXTURES.map(name => {
    const text = git(['cat-file', 'blob', `${pin}:src/register/testdata/${name}`]).toString('utf8')
    writeFileSync(eventsFile, text)
    const printed = teamrig(['list', '--status', 'all', '--all'], { at: generatedAt })
    return { name, events: text, list: clean(printed.stdout), warn: clean(printed.stderr) }
  })

  const golden: GoldenRegister = { pin, generatedAt, files, list: clean(listed.stdout), warn: clean(listed.stderr), inbox, fixtures }
  const target = join(scriptsDir, '..', 'tests', 'golden-register.ts')
  writeFileSync(target, goldenModule(golden))
  console.log(`wrote ${target} from teamrig ${pin}`)
} catch (error) {
  if (!(error instanceof Stop)) throw error
  console.error(error.message)
  process.exitCode = error.code
} finally {
  rmSync(root, { recursive: true, force: true })
}
