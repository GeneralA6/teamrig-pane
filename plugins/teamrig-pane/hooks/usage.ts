// The token-usage run an estimate's share of a fleet week is read from (register v2 design §14), found as the
// register's usage-store.ts finds it: the newest `usage-YYYY-MM-DD.json` by the date in its name, a run that is not
// JSON or not a list reading as none. The status-line snapshots beside it (live/) are not read: they give only the
// weekly % left, which no estimate text uses. A run is written a few times a day, so the folder is listed at most
// every USAGE_LIST_MS and the run re-read only when its listed size or mtime moved.
import { parseUsageRun, type UsageRun } from './core/rates'
import type { Files } from './source'

const RUN_FILE = /^usage-(\d{4}-\d{2}-\d{2})\.json$/
export const USAGE_LIST_MS = 60_000

function json(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

export class UsageRuns {
  private listedAt: number | null = null
  private readKey: string | null = null
  private run: UsageRun | null = null

  constructor(
    private readonly files: Files,
    private readonly dir: string,
  ) {}

  get current(): UsageRun | null {
    return this.run
  }

  /**
   * True when the newest run changed. A run that cannot be read now (locked, gone since the listing) keeps the last
   * one read and is tried again at the next listing; a failed listing throws to the poll, as a failed register read does.
   */
  async refresh(now: number): Promise<boolean> {
    if (this.listedAt !== null && now - this.listedAt < USAGE_LIST_MS) return false
    this.listedAt = now
    const runs = (await this.files.list(this.dir))
      .flatMap(entry => {
        const date = RUN_FILE.exec(entry.name)?.[1]
        return date === undefined ? [] : [{ ...entry, date }]
      })
      .sort((a, b) => a.date.localeCompare(b.date))
    const newest = runs[runs.length - 1]
    const key = newest === undefined ? 'none' : `${newest.name}:${newest.mtimeMs}:${newest.size}`
    if (key === this.readKey) return false
    if (newest === undefined) {
      this.run = null
    } else {
      let text: string
      try {
        text = await this.files.read(`${this.dir}/${newest.name}`)
      } catch {
        return false
      }
      this.run = parseUsageRun(newest.date, json(text))
    }
    this.readKey = key
    return true
  }
}
