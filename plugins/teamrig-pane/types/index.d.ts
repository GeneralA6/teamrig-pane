/** A stored register status, as hooks/core/model.ts spells it (hooks/log.ts fails to compile when they part). */
export type TaskStatus = 'open' | 'in-progress' | 'blocked' | 'verifying' | 'done' | 'dropped'

/** What a reader sees (hooks/core/shown.ts): `blocked` while a blocker or wait is open, `paused` under a pause. */
export type ShownStatus = TaskStatus | 'paused'

/** What kind of work a task is (register v2, hooks/core/model.ts KINDS; hooks/log.ts fails to compile when they part). */
export type TaskKind = 'code' | 'research' | 'design' | 'ops' | 'decision' | 'owner-action'

/** A progress note (`note T12 "..."`): the newest few show in a task's details. */
export type NoteLine = { at: string; by: string; text: string }

/** A task a detail line names (a parent, sub-task or blocker): drawn as its glyph, id and title. */
export type RelatedTask = { id: string; shown: ShownStatus; title: string }

/** An open wait on something outside the register: `owner: approve the rotation`. */
export type WaitLine = { on: string; what: string }

/** The first few of a list, and how many it left out. */
export type Cut<T> = { items: T[]; more: number }

/** One task as the register's events leave it: the fields the pane draws. */
export type TaskRow = {
  id: string
  title: string
  owner: string
  tier: number
  due: string | null
  /** The stored status. */
  status: TaskStatus
  /** What a reader sees: `blocked` while a blocker or wait is open, `paused` under a pause, else the stored status. */
  shown: ShownStatus
  /** The register's list markers: `⛔T194` blocker, `⏳owner` wait, `↑T205` parent, `⏸P1` pause, `✓2/5` children, `🔍10-15` proof due. */
  markers: readonly string[]
  /** What holds it back: the active tasks it is blocked by, then its open waits as `owner: <what>`. */
  holds: readonly string[]
  /** The pause in force on it, as `P1: <note>`; null when none. */
  pause: string | null
  /** The newest status note (why it is blocked, what was done). */
  note: string | null
  /** The newest evidence recorded (a sha or a path); a status without one keeps it. */
  evidence: string | null
  /** The newest progress notes, newest first (hooks/log.ts NOTES_SHOWN), and how many older ones there are. */
  notes: Cut<NoteLine>
  /** The ask and what done looks like (the register's `--detail`); null when none. */
  detail: string | null
  // Register v2 (an event written before v2 leaves each empty): drawn only in the expanded details, each only when set.
  kind: TaskKind | null
  labels: readonly string[]
  /** The planned start, and the owner's expected finish (`YYYY-MM-DD` or `YYYY-MM-DD HH:MM`); null when none. */
  start: string | null
  eta: string | null
  /** How often the due and the eta moved after their first value. */
  dueRevisions: number
  etaRevisions: number
  /** The actuals: the first move to in-progress, and the event that made it done (null while it is not done). */
  startedAt: string | null
  doneAt: string | null
  /**
   * Its size as the register's `show` writes it (hooks/core/estimates.ts): `est 1.5d (initial 1d) ≈ 0.16B = 2.1% of a
   * fleet week` with a fresh usage run, `est 1.5d` in its own unit without one; null when neither it nor a sub-task has one.
   */
  estimate: string | null
  /** When a `verifying` task's proof is due; null when none. */
  evidenceDue: string | null
  /** The task it is part of; null when none. */
  parent: RelatedTask | null
  /** Its sub-tasks, by task number (hooks/log.ts CHILDREN_SHOWN). */
  children: Cut<RelatedTask>
  /** The tasks it is blocked by, finished ones too (they no longer hold it). */
  blockedBy: readonly RelatedTask[]
  /** Its open waits. */
  waits: readonly WaitLine[]
  /** Who asked: `owner` (the human owner), `lead`, or a session name. */
  source: string
  /** Where the ask is written: `file:line` refs, `;`-separated, or a short quote ref. */
  ref: string
  /** The roadmap goals it serves (`G10.2a`). */
  goals: readonly string[]
  createdBy: string
  createdAt: string
  /** The newest event of any kind. */
  updatedAt: string
  /** When the current owner got the task: its create, or the newest handoff. */
  assignedAt: string
  /** The owner's newest event since then; null = the owner has not touched it. */
  ownerSeenAt: string | null
}

/** How the pane knows this session's area: pinned by /tasklist, or its newest `inbox read`. */
export type AreaSource = 'pinned' | 'inbox-read'

/** Everything a drawing needs, rebuilt when a register file changes. */
export type Snapshot = {
  /** The tasks a drawing can show: the active ones and those finished within a day (hooks/view.ts RECENT_MS). */
  tasks: TaskRow[]
  area: string | null
  areaSource: AreaSource | null
  /** Unread lines in board/inbox/<area>.md; null when the area never ran `inbox read`. */
  unreadInbox: number | null
  /** What the pane could not read: a failed load (the last good tasks stay drawn) or skipped register lines. */
  problem: string | null
  /** When it was built, so due and age labels move on without a file change. */
  now: number
}

/** Lines quoted for a task (hooks/details.ts): from one part of its ref, or a goal's roadmap item; `ref` names where. */
export type RefQuote = { ref: string; lines: string[] }

/** What an expanded task shows beyond its row: the quotes, read for the ref the task had then. */
export type TaskDetail = { ref: string; quotes: RefQuote[] }

/** The tasks the person expanded, by id; a task absent is collapsed. */
export type ExpandedTasks = { readonly [id: string]: TaskDetail }

/** `open`: the pane in full; `minimized`: its one-row strip (hooks/size.ts), what the person's close (✕) does. */
export type PaneSize = 'open' | 'minimized'

/** One file `git status` lists: its two-letter code (`XY`: ` M`, `A `, `??`), its path from the repo root, and where a rename or copy came from. */
export type FileChange = { code: string; path: string; from: string | null }

/** One repo the session works in, as its last `git status` left it (hooks/changes.ts). */
export type RepoChanges = {
  /** The repo's root, as `git rev-parse --show-toplevel` spells it: a worktree's own. */
  root: string
  /** The checked-out branch; null when detached or unread. */
  branch: string | null
  /** The changed files, the first CHANGES_KEPT of them, and how many more there are. */
  files: Cut<FileChange>
  /** True when git wrote more than the 4 MiB a run keeps, so the list stops short. */
  isPartial: boolean
  /** Why the repo could not be read; null when it was. */
  problem: string | null
}

/** The Changes view's data: each repo the session works in, then the files it wrote outside any repo, newest first. */
export type ChangesSnapshot = { repos: RepoChanges[]; outside: string[]; isRead: boolean }

/** What the pane's body shows, picked with the switch over it: the register's tasks, or the session's git changes (hooks/changes.ts). */
export type PaneView = 'tasks' | 'changes'

/** `mine`: this session's area; `all`: every owner's active tasks. */
export type ViewMode = 'mine' | 'all'

declare module 'claude-code' {
  interface PluginState {
    // The snapshot and the changes are kept under shape tags (hooks/register.tsx SNAPSHOT_SHAPE, CHANGES_SHAPE), so a reload never draws one an older pane wrote.
    'teamrig-pane': {
      snapshot: Shaped<Snapshot>
      mode: ViewMode
      expanded: ExpandedTasks
      size: PaneSize
      view: PaneView
      changes: Shaped<ChangesSnapshot>
    }
  }
}
