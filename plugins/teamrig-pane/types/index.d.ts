/** A task's status as teamrig's read entry spells it (hooks/log.ts fails to compile when they part). */
export type TaskStatus = 'open' | 'in-progress' | 'blocked' | 'done' | 'dropped'

/** The first few of a list, and how many it left out. */
export type Cut<T> = { items: T[]; more: number }

/** One task as teamrig's register folds it: the fields the pane draws. */
export type TaskRow = {
  id: string
  title: string
  owner: string
  /** 1 is the most urgent; drawn `p1`. */
  priority: number
  /** What the team config calls the priority (`register.priorities`); null when it names none. */
  priorityName: string | null
  /** `YYYY-MM-DD` or `YYYY-MM-DD HH:MM`, UTC; a bare day means its end. */
  due: string | null
  status: TaskStatus
  /** The note of the newest status change (why it is blocked, what was done). */
  note: string | null
  /** The newest evidence recorded (a sha or a path); a status change without one keeps it. */
  evidence: string | null
  /** Who asked: the config's `ownerSource` (the human owner), or a session name. */
  source: string
  /** Where the ask is written: `file:line` refs, `;`-separated, or a short quote ref; null when none. */
  ref: string | null
  /** The goals it serves, as written. */
  goals: readonly string[]
  /** The `YYYY-MM-DD` start of the planning week it belongs to; null when none. */
  week: string | null
  createdBy: string
  createdAt: string
  /** The newest event of any kind. */
  updatedAt: string
  /** When the current owner got the task: its create, or the newest handoff. */
  assignedAt: string
  /** The owner's newest event since then; null = the owner has not touched it. */
  ownerSeenAt: string | null
}

/** How the pane knows this session's area: pinned by /teamrig, or its newest `inbox read`. */
export type AreaSource = 'pinned' | 'inbox-read'

/** Everything a drawing needs, rebuilt when a register file changes. */
export type Snapshot = {
  /** The tasks a drawing can show: the active ones and those finished within a day (hooks/view.ts RECENT_MS). */
  tasks: TaskRow[]
  area: string | null
  areaSource: AreaSource | null
  /** Unread lines in `<inbox>/<area>.md`, past its read mark as teamrig finds it; null when the area never ran `inbox read`. */
  unreadInbox: number | null
  /** What the pane could not read: a failed load (the last good tasks stay drawn), or the lines teamrig's reader skipped. */
  problem: string | null
  /** When it was built, so due and age labels move on without a file change. */
  now: number
}

/** Lines quoted for a task (hooks/details.ts): from one part of its ref, or a goal's roadmap item; `ref` names where. */
export type RefQuote = { ref: string; lines: string[] }

/** What an expanded task shows beyond its row: the quotes, read for the ref the task had then. */
export type TaskDetail = { ref: string | null; quotes: RefQuote[] }

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
