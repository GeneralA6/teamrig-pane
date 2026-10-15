// Keeps the session's snapshot in step with the register's files, at no model-token cost:
// a stat poll every POLL_MS re-reads only a file whose size or mtime moved, and a TICK_MS
// tick moves the due/age labels on. Each write of the snapshot redraws the pane, so a poll or
// tick whose snapshot would draw the same pane (view.ts sameView) writes nothing. A per-session pin (/tasklist <area>) is kept in $.store,
// so a resumed session keeps it.
// The session id is read on every poll: after /clear the process goes on under a new id
// and no session.start fires, so an id captured once would follow the old session.
// The engine allows $ only at its call sites in a hook, so session.start hands this class
// ports built from $ calls rather than $ itself.
// Neither timer ever rejects: a failed poll or tick shows as the pane's problem over the last good
// tasks, and when even that write fails the pane stays as last drawn and the next poll tries again.
import type { Snapshot } from '../types'
import { SESSION_NAME } from './core/read/index'
import type { TaskRegisterSource } from './source'
import { sameView } from './view'

export const POLL_MS = 3_000
export const TICK_MS = 60_000

export type Timer = { cancel: () => void }

export type LivePorts = {
  /** The register, or the problem the pane shows while nothing names where it is (places.ts). */
  source: TaskRegisterSource | { missing: string }
  sessionId: () => Promise<string>
  now: () => Promise<number>
  /** Writes the snapshot atom (each write redraws the pane). */
  publish: (change: (current: Snapshot) => Snapshot) => Promise<void>
  /** The session's stored pin, as $.store.get answers it. */
  loadPin: (claudeSession: string) => Promise<unknown>
  /** Saves (or with null clears) the session's pin. */
  savePin: (claudeSession: string, area: string | null) => Promise<void>
}

export function pinKey(claudeSession: string): string {
  return `pin:${claudeSession}`
}

/** A stored pin, if it is still a valid area name. */
export function storedPin(value: unknown): string | null {
  return typeof value === 'string' && SESSION_NAME.test(value) ? value : null
}

type BoundSession = { id: string; pinned: string | null }

export class LiveRegister {
  private timers: Timer[] = []
  private isPolling = false
  private session: BoundSession | null = null
  /** Set after a failed poll, a new pin or a new session, so the next good poll redraws even when no file moved. */
  private mustPublish = true
  /** The snapshot it last wrote; null until its first write (a hot reload starts it over). */
  private shown: Snapshot | null = null

  constructor(private readonly ports: LivePorts) {}

  /** Starts the poll and the label tick on the engine's clock; neither rejects. */
  startTimers(every: (ms: number, fn: () => void) => Timer): void {
    this.stop()
    this.timers = [every(POLL_MS, () => void this.refresh()), every(TICK_MS, () => void this.tick())]
  }

  /** Moves `now` on, writing only when a due, NEW/NOT PICKED UP or finished label changes with it. */
  async tick(): Promise<void> {
    try {
      const now = await this.ports.now()
      if (this.shown !== null && sameView(this.shown, { ...this.shown, now })) return
      await this.write(s => ({ ...s, now }))
    } catch (error) {
      this.mustPublish = true
      await this.showProblem(messageOf(error))
    }
  }

  stop(): void {
    for (const timer of this.timers) timer.cancel()
    this.timers = []
  }

  async refresh(): Promise<void> {
    if (this.isPolling) return
    this.isPolling = true
    try {
      const source = this.ports.source
      if ('missing' in source) return await this.showProblem(source.missing)
      const session = await this.currentSession()
      const now = await this.ports.now()
      const next = await source.poll({
        claudeSession: session.id,
        pinned: session.pinned,
        now,
        force: this.mustPublish,
      })
      this.mustPublish = false
      if (next && (this.shown === null || !sameView(this.shown, next))) await this.write(() => next)
    } catch (error) {
      this.mustPublish = true
      await this.showProblem(messageOf(error))
    } finally {
      this.isPolling = false
    }
  }

  /** Pins this session to `area`, or with null follows its `inbox read` again. */
  async pin(area: string | null): Promise<void> {
    const session = await this.currentSession()
    await this.ports.savePin(session.id, area)
    this.session = { id: session.id, pinned: area }
    this.mustPublish = true
    await this.refresh()
  }

  private async currentSession(): Promise<BoundSession> {
    const id = await this.ports.sessionId()
    if (this.session?.id === id) return this.session
    this.session = { id, pinned: storedPin(await this.ports.loadPin(id)) }
    this.mustPublish = true
    return this.session
  }

  /** Shows `problem` over the last good tasks; a write that fails too is left to the next poll (mustPublish is set). */
  private async showProblem(problem: string): Promise<void> {
    if (this.shown?.problem === problem) return
    try {
      await this.write(s => ({ ...s, problem }))
    } catch {
      // Nothing is left to draw it with: the pane keeps its last frame, never a blank one.
    }
  }

  /** Publishes `change`, remembering what it wrote only once the write landed (a retried write applies it again). */
  private async write(change: (current: Snapshot) => Snapshot): Promise<void> {
    const written: { last: Snapshot | null } = { last: null }
    await this.ports.publish(current => {
      written.last = change(current)
      return written.last
    })
    if (written.last !== null) this.shown = written.last
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
