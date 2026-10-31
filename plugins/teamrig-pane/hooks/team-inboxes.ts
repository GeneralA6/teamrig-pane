// The unread inbox lines of the pane's own team's sessions, for the Teams tab (T780): the team's inbox read marks and
// each marked session's inbox file, each re-read only when its stamp moves (source.ts WatchedFile), counted as the
// header counts the pane's own area (source.ts TaskRegisterSource, teamrig's unreadOf). A session that never marked its
// inbox read has no count: its count is unknown, not everything.
import { indexMarks, inboxLines, readMarks, unreadOf, type MarkLogRead } from './core/read/index'
import { lineHash } from './line-hash'
import { WatchedFile, type Files, type RegisterPaths } from './source'

/** Where the team keeps its inbox read marks and its inbox files. */
export type InboxPaths = Pick<RegisterPaths, 'marks' | 'inboxDir'>

/** The team's inbox read marks, and the inbox file of each session counted. */
export class TeamInboxes {
  private readonly files: Files
  private readonly paths: InboxPaths
  private readonly marks: WatchedFile<MarkLogRead>
  /** Each session's inbox file, by id; one no longer counted is dropped. */
  private readonly inboxes = new Map<string, WatchedFile<readonly string[]>>()

  constructor(files: Files, paths: InboxPaths) {
    this.files = files
    this.paths = paths
    this.marks = new WatchedFile(files, paths.marks, readMarks, readMarks(''))
  }

  /** The unread inbox lines of each of `ids` that ever marked its inbox read, by id. A failed read throws. */
  async unread(ids: readonly string[]): Promise<ReadonlyMap<string, number>> {
    await this.marks.refresh()
    const { byArea } = indexMarks(this.marks.current.marks)
    for (const id of this.inboxes.keys()) if (!ids.includes(id) || !byArea.has(id)) this.inboxes.delete(id)
    const counts = new Map<string, number>()
    for (const id of ids) {
      const mark = byArea.get(id)
      if (mark === undefined) continue
      const inbox = this.inboxes.get(id) ?? new WatchedFile<readonly string[]>(this.files, `${this.paths.inboxDir}/${id}.md`, inboxLines, [])
      this.inboxes.set(id, inbox)
      await inbox.refresh()
      counts.set(id, unreadOf(id, inbox.current, mark, lineHash).lines.length)
    }
    return counts
  }
}
