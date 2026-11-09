// The band's previous conversation (T2249): the area's conversation before the one Claude Code runs now, so after a
// /clear the band above the prompt names what came before and opens it. A POLL_MS poll reads it from the turn log
// (turn-log.ts previous) only while it is not settled for the area and the Claude Code session id of now: a /clear
// starts a new id, and the conversation before it gains no line after it. It settles once the conversation of now
// wrote its first line (the previous one then ends where it began, which its title's tasks read), or with none to
// name. A poll never rejects: a failed read or write leaves the band as last drawn, and the next poll reads again.
import type { LogConversation } from '../types'
import { POLL_MS, type Timer } from './live'
import { sameConversation, type TurnLogReader } from './turn-log'

/** What the poll needs: the reader, the clock, the area and Claude Code session of now, and the write that redraws the band. */
export type PreviousPorts = {
  reader: Pick<TurnLogReader, 'previous'>
  now: () => Promise<number>
  /** The session's area, whose turn log folder it reads; null for none. */
  area: () => Promise<string | null>
  /** The Claude Code session id it works in now. */
  claude: () => Promise<string>
  publish: (previous: LogConversation | null) => Promise<void>
}

/** True for a read the next poll need not repeat: none to name, or one the conversation of now already follows. */
function isSettled(previous: LogConversation | null): boolean {
  return previous === null || previous.nextAt !== null
}

/** Two reads that draw the same band. */
function samePrevious(a: LogConversation | null, b: LogConversation | null): boolean {
  return a === null || b === null ? a === b : sameConversation(a, b)
}

export class LivePrevious {
  private readonly ports: PreviousPorts
  private timers: Timer[] = []
  private isPolling = false
  /** The area and Claude Code session id of the last settled read; null before one. */
  private settledFor: string | null = null
  /** What it last wrote; undefined before a write. */
  private shown: LogConversation | null | undefined = undefined

  constructor(ports: PreviousPorts) {
    this.ports = ports
  }

  startTimers(every: (ms: number, fn: () => void) => Timer): void {
    this.stop()
    this.timers = [every(POLL_MS, () => void this.poll())]
  }

  stop(): void {
    for (const timer of this.timers) timer.cancel()
    this.timers = []
  }

  /** Reads the previous conversation again unless settled for the area and conversation of now, and writes it when it changed. */
  async poll(): Promise<void> {
    if (this.isPolling) return
    this.isPolling = true
    try {
      const area = await this.ports.area()
      const claude = await this.ports.claude()
      const readFor = JSON.stringify([area, claude])
      if (readFor === this.settledFor) return
      const previous = area === null ? null : await this.ports.reader.previous(area, claude, await this.ports.now())
      if (this.shown === undefined || !samePrevious(this.shown, previous)) {
        await this.ports.publish(previous)
        this.shown = previous
      }
      this.settledFor = isSettled(previous) ? readFor : null
    } catch {
      // The next poll reads again.
    } finally {
      this.isPolling = false
    }
  }
}
