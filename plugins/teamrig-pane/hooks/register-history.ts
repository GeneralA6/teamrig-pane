// A register's whole history for the Stats tab (T1419): every archive segment, then the live log, in write order, as
// teamrig's history read takes them (core register/layout.ts historyPlan). The stats fold reaches past what a
// compaction left in the working set, so it reads the history, not the snapshot. The tail is re-read only when its
// stamp moves (source.ts WatchedFile) and each segment once, as a segment is never rewritten after its rotation.
import { historyPlan, layoutPaths, readEvents, type EventLogRead, type LayoutPaths, type RegisterEvent } from './core/read/index'
import { readSegment, WatchedFile, type Files } from './source'

export class RegisterHistory {
  private readonly files: Files
  private readonly paths: LayoutPaths
  private readonly tail: WatchedFile<EventLogRead>
  /** The segments the tail names, by number, as their events: each is read once. */
  private segments = new Map<number, readonly RegisterEvent[]>()
  private value: readonly RegisterEvent[] = []
  /** True until a read put the history together: a failed one (a segment missing or locked) is retried on the next refresh, though no file moved. */
  private stale = true
  private changes = 0

  constructor(files: Files, eventsPath: string) {
    this.files = files
    this.paths = layoutPaths(eventsPath)
    this.tail = new WatchedFile(files, this.paths.tail, readEvents, readEvents(''))
  }

  /** Every event in write order: the segments', then the tail's; none before a read worked. */
  get events(): readonly RegisterEvent[] {
    return this.value
  }

  /** How many reads changed the history: a fold keyed on it folds again only when it moved. */
  get version(): number {
    return this.changes
  }

  /** True when the history changed. A throw keeps the last good history, and the next refresh tries again. */
  async refresh(): Promise<boolean> {
    const tailMoved = await this.tail.refresh()
    if (!tailMoved && !this.stale) return false
    this.stale = true
    const plan = historyPlan(this.tail.current)
    const segments = new Map<number, readonly RegisterEvent[]>()
    for (const n of plan.segments) segments.set(n, this.segments.get(n) ?? (await readSegment(this.files, this.paths, n)).events)
    this.segments = segments
    this.value = [...[...segments.values()].flat(), ...this.tail.current.events]
    this.stale = false
    this.changes += 1
    return true
  }
}
