/** A task's status as teamrig's read entry spells it (hooks/log.ts fails to compile when they part). */
export type TaskStatus = 'open' | 'in-progress' | 'verifying' | 'waiting' | 'done' | 'dropped'

/**
 * One thing a waiting task waits for, as teamrig's read entry types it (hooks/log.ts fails to compile when they
 * part): a decision or approval by a session or the owner, another task, or a UTC time (`YYYY-MM-DD HH:MM`).
 */
export type WaitRow =
  | { readonly kind: 'decision' | 'approval'; readonly who: string }
  | { readonly kind: 'task'; readonly id: string }
  | { readonly kind: 'time'; readonly at: string }

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
  /** The note of the newest status change (why it waits, what was done). */
  note: string | null
  /** The newest evidence recorded (a sha or a path); a status change without one keeps it. */
  evidence: string | null
  /** The skill the newest status change names (`none` for a one-off); null when it named none. */
  skill: string | null
  /** When the task took its status: its create, or the newest status event that changed it (a repeat keeps it). */
  statusAt: string
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
  /** The newest event of any kind, and the session that wrote it. */
  updatedAt: string
  updatedBy: string
  /** When the task took its priority: its create, or the newest update that changed it. */
  priorityAt: string
  /** When the current owner got the task: its create, or the newest handoff. */
  assignedAt: string
  /** The owner's newest event since then; null = the owner has not touched it. */
  ownerSeenAt: string | null
  /** What a waiting task waits for; empty in any other status, and for an old `blocked` line, which reads as waiting. */
  waits: readonly WaitRow[]
  /** The tasks to finish before this one starts (`after T5`, its plan dependency); empty when none. */
  after: readonly string[]
}

/**
 * How the pane knows this session's area: pinned by /teamrig-pane, or its newest `inbox read` mark, which teamrig's
 * prompt hook also writes when it binds a tab by its Claude Code title.
 */
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

/**
 * A file's changed lines: added and removed against HEAD (`git diff --numstat`), an untracked file's (or folder's)
 * all added; `binary` when git counts no lines in it.
 */
export type LineCount = { kind: 'text'; added: number; removed: number } | { kind: 'binary' }

/**
 * One file `git status` lists: its two-letter code (`XY`: ` M`, `A `, `??`), its path from the repo root, where a
 * rename or copy came from, and its changed lines (null when git could not count them).
 */
export type FileChange = { code: string; path: string; from: string | null; lines: LineCount | null }

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

/** The repo roots and outside files the session has found, all a reloaded pane needs to read them again. */
export type KnownChanges = { roots: string[]; outside: string[] }

/** A version's three numbers: `2.1.295` is major 2, minor 1, patch 295. */
export type Version = { major: number; minor: number; patch: number }

/** What the pane needs and lacks (hooks/requirements.ts), each drawn as one line with its fix. */
export type RequirementProblem =
  | { kind: 'claude-code-old'; running: Version }
  | { kind: 'git-unstartable'; reason: string }
  | { kind: 'check-failed'; requirement: 'Claude Code'; reason: string }

/** What the pane's body shows, picked with the switch over it: the register's tasks, or the session's git changes (hooks/changes.ts). */
export type PaneView = 'tasks' | 'changes'

/** `mine`: this session's area; `all`: every owner's active tasks. */
export type ViewMode = 'mine' | 'all'

/** A segment of the status bar over the area's tasks (hooks/status-bar.ts): done today, verifying, in progress, waiting, open. */
export type BarStatus = 'done-today' | 'verifying' | 'working' | 'waiting' | 'not-started'

declare module 'claude-code' {
  interface PluginState {
    // The snapshot, the changes and the known repos are kept under shape tags (hooks/register.tsx SNAPSHOT_SHAPE, CHANGES_SHAPE, KNOWN_SHAPE), so a reload never draws one an older pane wrote.
    'teamrig-pane': {
      snapshot: Shaped<Snapshot>
      mode: ViewMode
      expanded: ExpandedTasks
      size: PaneSize
      view: PaneView
      changes: Shaped<ChangesSnapshot>
      known: Shaped<KnownChanges>
      requirements: RequirementProblem[]
      /** The status the status bar filters the mine view to, null for all; cleared at each session start, a hot reload's too. */
      filter: BarStatus | null
    }
  }
}
