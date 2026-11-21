// The programs the UI runs (the teamrig CLI, git), as the dock runs them through the engine's `$.process.run`: one
// answer a run, its exit code and what it wrote. A run that cannot start, outlasts its time or is stopped rejects.
// The children still running are kept, so the program can stop them all as it ends: a child left running would hold
// the process open after the terminal is given back.
import { spawn, type ChildProcess } from 'node:child_process'

/** The most of a run's stdout that is kept, in characters: far over the largest document the UI reads. */
export const STDOUT_CAP = 32 * 1024 * 1024

/** What a run answers: the fields of the engine's own result that the pane reads (hooks/teamrig-cli.ts CliRun). */
export type ProcessRun = { exitCode: number; stdout: string; stderr: string; isStdoutTruncated: boolean }

export type RunInit = { readonly cwd?: string; readonly timeoutMs: number }

/** Runs programs, and stops the ones still running when told to. */
export class Processes {
  private readonly cap: number
  private readonly running = new Set<ChildProcess>()
  private isStopped = false

  constructor(cap: number = STDOUT_CAP) {
    this.cap = cap
  }

  /** Runs `argv`, in `init.cwd` when given; resolves what it answered, with stdout cut at the cap and said to be. */
  run(argv: readonly string[], init: RunInit): Promise<ProcessRun> {
    const [command, ...args] = argv
    if (command === undefined) return Promise.reject(new Error('no program to run'))
    if (this.isStopped) return Promise.reject(new Error(`${command} was not run: the program is ending`))
    return new Promise<ProcessRun>((resolve, reject) => {
      const child = spawn(command, args, {
        ...(init.cwd === undefined ? {} : { cwd: init.cwd }),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      this.running.add(child)
      let stdout = ''
      let stderr = ''
      let isStdoutTruncated = false
      const limit = setTimeout(() => {
        child.kill()
        reject(new Error(`${command} gave no answer in ${init.timeoutMs} ms`))
      }, init.timeoutMs)
      const ended = (): void => {
        clearTimeout(limit)
        this.running.delete(child)
      }
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        const room = this.cap - stdout.length
        if (chunk.length > room) isStdoutTruncated = true
        stdout += chunk.slice(0, Math.max(room, 0))
      })
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
        stderr += chunk
      })
      child.on('error', error => {
        ended()
        reject(error)
      })
      child.on('close', (code, signal) => {
        ended()
        if (code === null) reject(new Error(`${command} was stopped by ${signal ?? 'a signal'}`))
        else resolve({ exitCode: code, stdout, stderr, isStdoutTruncated })
      })
    })
  }

  /** Stops every run under way, each rejecting, and refuses the ones asked for after. */
  stopAll(): void {
    this.isStopped = true
    for (const child of this.running) child.kill()
  }
}
