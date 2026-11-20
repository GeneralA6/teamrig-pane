// One run of `teamrig read` (hooks/read-port.ts): every document a poll asks for goes in one run, with the revision
// held of each handed back; a failed or cut run is a failure with its reason and no documents; a document that is
// missing, unreadable or unchanged from nothing held is a named problem beside the ones that were read; a missing CLI
// or a run that does not finish is a failure, never a throw (T4742).
import { describe, expect, test } from 'claude-code/testing'
import { READ_TIMEOUT_MS, readDocuments, readResult, readWords, type ReadAsk, type ReadPorts } from '../hooks/read-port'
import { cliArgv, type CliRun, type TeamrigCli } from '../hooks/teamrig-cli'

const CLI: TeamrigCli = { kind: 'found', main: 'K/teamrig/dist/cli/main.js' }
const TASKS = { interface: '1.0', document: 'tasks', revision: 'r7', tasks: [] }
const INBOX = { interface: '1.0', document: 'inbox', revision: 'r2', lines: [] }
const WHOLE: readonly ReadAsk[] = [
  { name: 'tasks', held: null },
  { name: 'inbox', held: null },
]

function ok(...printed: readonly unknown[]): CliRun {
  return { exitCode: 0, stdout: printed.map(value => JSON.stringify(value)).join('\n'), stderr: '', isStdoutTruncated: false }
}

type Recorded = { runs: { argv: readonly string[]; timeoutMs: number }[] }

/** Ports recording each run; `answer` answers it, an Error by rejecting. */
function portsOf(answer: CliRun | Error, caller: string | null = 'api'): ReadPorts & Recorded {
  const runs: Recorded['runs'] = []
  return {
    runs,
    run: (argv, timeoutMs) => {
      runs.push({ argv, timeoutMs })
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)
    },
    caller: () => Promise.resolve(caller),
  }
}

describe('readWords', () => {
  test('asks for every document in one run, as JSON', () => {
    expect(readWords(WHOLE, null)).toEqual(['read', 'tasks', 'inbox', '--json'])
  })

  test('hands back the revisions held in one flag, and runs as the caller', () => {
    const asks: readonly ReadAsk[] = [
      { name: 'tasks', held: 'r7' },
      { name: 'inbox', held: null },
      { name: 'config', held: 'c1' },
    ]
    expect(readWords(asks, 'api')).toEqual(['read', 'tasks', 'inbox', 'config', '--json', '--unless', 'tasks=r7,config=c1', '--session', 'api'])
  })

  test('with one revision held the flag names it alone', () => {
    expect(readWords([{ name: 'tasks', held: 'r7' }, { name: 'inbox', held: null }], null)).toEqual(['read', 'tasks', 'inbox', '--json', '--unless', 'tasks=r7'])
  })
})

describe('readResult', () => {
  test('serves each document asked for under its name', () => {
    const result = readResult(ok(TASKS, INBOX), WHOLE)
    expect(result.kind).toBe('read')
    if (result.kind !== 'read') return
    expect([...result.documents.keys()]).toEqual(['tasks', 'inbox'])
    expect(result.documents.get('tasks')?.revision).toBe('r7')
    expect(result.problems).toEqual([])
  })

  test('a failed run is a failure with what it wrote, else its exit code', () => {
    const said: CliRun = { exitCode: 2, stdout: JSON.stringify(TASKS), stderr: 'REFUSED: no team here\n', isStdoutTruncated: false }
    expect(readResult(said, WHOLE)).toEqual({ kind: 'failed', reason: 'REFUSED: no team here' })
    expect(readResult({ ...said, stderr: '' }, WHOLE)).toEqual({ kind: 'failed', reason: 'teamrig read exited 2' })
  })

  test('a cut answer is a failure, with no document read from its start', () => {
    expect(readResult({ ...ok(TASKS, INBOX), isStdoutTruncated: true }, WHOLE)).toEqual({
      kind: 'failed',
      reason: 'teamrig read printed more than the pane can take in one run',
    })
  })

  test('a document that was not printed is a problem beside the ones read', () => {
    const result = readResult(ok(TASKS), WHOLE)
    expect(result.kind === 'read' ? [...result.documents.keys()] : null).toEqual(['tasks'])
    expect(result.kind === 'read' ? result.problems : null).toEqual(['teamrig read printed no inbox document'])
  })

  test('a line it cannot read is a problem, and its document is told as not printed', () => {
    const result = readResult(ok(TASKS, { ...INBOX, interface: '2.0' }), WHOLE)
    expect(result.kind === 'read' ? result.problems : null).toEqual([
      'teamrig printed interface 2.0, newer than the pane reads: update teamrig-pane',
      'teamrig read printed no inbox document',
    ])
  })

  test('unchanged is taken for a revision held', () => {
    const unchanged = { interface: '1.0', document: 'tasks', revision: 'r7', unchanged: true }
    const result = readResult(ok(unchanged, INBOX), [{ name: 'tasks', held: 'r7' }, { name: 'inbox', held: null }])
    expect(result.kind === 'read' ? result.documents.get('tasks')?.isUnchanged : null).toBe(true)
    expect(result.kind === 'read' ? result.problems : null).toEqual([])
  })

  test('unchanged from nothing held is a problem, told once, never a document', () => {
    const unchanged = { interface: '1.0', document: 'tasks', revision: 'r7', unchanged: true }
    const result = readResult(ok(unchanged, INBOX), WHOLE)
    expect(result.kind === 'read' ? [...result.documents.keys()] : null).toEqual(['inbox'])
    expect(result.kind === 'read' ? result.problems : null).toEqual(['teamrig read answered tasks as unchanged to a read that held none of it'])
  })

  test('a document that was not asked for is left out', () => {
    const result = readResult(ok(TASKS, INBOX), [{ name: 'inbox', held: null }])
    expect(result.kind === 'read' ? [...result.documents.keys()] : null).toEqual(['inbox'])
  })

  test('an answer with nothing to read is a failure that says why', () => {
    expect(readResult(ok(), WHOLE)).toEqual({ kind: 'failed', reason: 'teamrig read printed no document the pane can read: update teamrig' })
    expect(readResult({ ...ok(), stdout: 'READ tasks: 3 open' }, WHOLE)).toEqual({ kind: 'failed', reason: 'teamrig printed a line that is no JSON' })
  })
})

describe('readDocuments', () => {
  test('runs the CLI once for every document, as the caller, within the read timeout', async () => {
    const ports = portsOf(ok(TASKS, INBOX))
    const result = await readDocuments(CLI, ports, WHOLE)
    expect(result.kind).toBe('read')
    expect(ports.runs).toEqual([{ argv: cliArgv(CLI.main, ['read', 'tasks', 'inbox', '--json', '--session', 'api']), timeoutMs: READ_TIMEOUT_MS }])
  })

  test('a tab that knows no session leaves the caller to the CLI', async () => {
    const ports = portsOf(ok(TASKS, INBOX), null)
    await readDocuments(CLI, ports, WHOLE)
    expect(ports.runs.map(run => run.argv)).toEqual([cliArgv(CLI.main, ['read', 'tasks', 'inbox', '--json'])])
  })

  test('with nothing to read it runs nothing', async () => {
    const ports = portsOf(ok(TASKS))
    expect(await readDocuments(CLI, ports, [])).toEqual({ kind: 'read', documents: new Map(), problems: [] })
    expect(ports.runs).toEqual([])
  })

  test('a missing CLI is a failure with its problem, and nothing runs', async () => {
    const ports = portsOf(ok(TASKS))
    expect(await readDocuments({ kind: 'missing', problem: 'no teamrig command on the PATH' }, ports, WHOLE)).toEqual({
      kind: 'failed',
      reason: 'no teamrig command on the PATH',
    })
    expect(ports.runs).toEqual([])
  })

  test('a run that does not finish is a failure, never a throw', async () => {
    expect(await readDocuments(CLI, portsOf(new Error('no answer in 35 s')), WHOLE)).toEqual({
      kind: 'failed',
      reason: 'teamrig read did not finish: no answer in 35 s',
    })
  })
})
