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
  /** What the task is and why, in plain words (`teamrig add --description`, a GitHub issue's body); null for a task written before teamrig kept one. */
  description: string | null
  owner: string
  /** 1 is the most urgent; drawn `p1` in a list, `Priority 1` on a card. */
  priority: number
  /** What the team config calls the priority (`register.priorities`); null when it names none. */
  priorityName: string | null
  /** `YYYY-MM-DD` or `YYYY-MM-DD HH:MM`, UTC; a bare day means its end. */
  due: string | null
  status: TaskStatus
  /** The note of the newest status change (why it waits, what was done). */
  note: string | null
  /** What proves a verifying task (`set --proof`); null in any other status, and for one set verifying before teamrig kept it, whose note says it. */
  proof: string | null
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
  /** The tasks a drawing can show: the active ones and those finished within HELD_DAYS of the fold (hooks/done.ts isHeldFinished). */
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

/** Lines quoted for a task (hooks/details.ts) from one part of its ref; `ref` names that part. */
export type RefQuote = { ref: string; lines: string[] }

/** A goal's roadmap item (hooks/details.ts): the goal id and the item's text as plain words, which starts with the id. */
export type GoalItem = { goal: string; text: string }

/**
 * What an open task's card (hooks/card.ts) reads beyond the register: the quotes, read for the ref the task had then,
 * and the roadmap items of its goals that no quote already holds.
 */
export type TaskDetail = { ref: string | null; quotes: RefQuote[]; goals: GoalItem[] }

/** A file a task's ref names (hooks/ref-file.ts): as the ref writes it (`~/`, relative or absolute), and the line it points at, null for none. */
export type RefFile = { readonly file: string; readonly line: number | null }

/**
 * A reference file as its page read it (hooks/ref-file.ts): the path it was found at and its text, the paths looked at
 * when none held it, or the path and why it is not shown (too big, not text, a failed read).
 */
export type RefFileRead =
  | { readonly kind: 'read'; readonly path: string; readonly text: string }
  | { readonly kind: 'missing'; readonly tried: readonly string[] }
  | { readonly kind: 'unreadable'; readonly path: string; readonly reason: string }

/** The tasks whose card the person opened, by id; a task absent shows its meta line. */
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

/**
 * A place the tasks view shows (hooks/nav.ts): the list, remembering the key of the element a page was opened from
 * (null when none) so a return scrolls back to it, a task's page by its id, or a search (hooks/search.ts) by its
 * query, the words its Find field holds ('' before any is typed), the Done page (hooks/done-rows.ts) by its week,
 * the `YYYY-MM-DD` Monday it shows, or a reference file's page (hooks/file-page.ts) by the file as its ref writes it
 * and the line it lands on.
 */
export type Place =
  | { readonly kind: 'list'; readonly row: string | null }
  | { readonly kind: 'task'; readonly id: string }
  | { readonly kind: 'search'; readonly query: string }
  | { readonly kind: 'done'; readonly week: string }
  | { readonly kind: 'file'; readonly file: string; readonly line: number | null }

/** The places the person went through, oldest first (at most hooks/nav.ts NAV_PLACES), and the index of the one shown. */
export type Nav = { readonly places: readonly Place[]; readonly at: number }

/**
 * The Find field's round (hooks/find-field.ts): the field is drawn under a key naming `round`, holding `text` as drawn,
 * what it should hold when the round started (the query of the search shown, else ''). Typing never starts a round;
 * a step that changes what the field should hold does.
 */
export type FindField = { readonly round: number; readonly text: string }

/**
 * How many times the pane's focus ring landed on an element (the engine's ui.focus event, hooks/find-field.ts), and
 * whether the last landing was on the Find field.
 */
export type RingLandings = { readonly count: number; readonly onField: boolean }

/** What each page a place names read for its task when it opened (hooks/details.ts), by task id. */
export type PageDetails = { readonly [id: string]: TaskDetail }

/** What each file page a place names read when it opened (hooks/ref-file.ts), by the file as its ref writes it. */
export type FilePages = { readonly [file: string]: RefFileRead }

/** `mine`: this session's area; `all`: every owner's active tasks. */
export type ViewMode = 'mine' | 'all'

/** A segment of the status bar over the area's tasks (hooks/status-bar.ts): done today, verifying, in progress, waiting, open. */
export type BarStatus = 'done-today' | 'verifying' | 'working' | 'waiting' | 'not-started'

declare module 'claude-code' {
  interface PluginState {
    // The snapshot, the open cards, the changes, the known repos, the places, the pages' details and the file pages' reads are kept under shape tags (hooks/register.tsx SNAPSHOT_SHAPE, CARDS_SHAPE, CHANGES_SHAPE, KNOWN_SHAPE, NAV_SHAPE, FILES_SHAPE), so a reload never draws one an older pane wrote.
    'teamrig-pane': {
      snapshot: Shaped<Snapshot>
      mode: ViewMode
      expanded: Shaped<ExpandedTasks>
      size: PaneSize
      view: PaneView
      changes: Shaped<ChangesSnapshot>
      known: Shaped<KnownChanges>
      requirements: RequirementProblem[]
      /** The status the status bar filters the mine view to, null for all; cleared at each session start, a hot reload's too. */
      filter: BarStatus | null
      /** Where the tasks view is (hooks/nav.ts): the list, a task's page, a search with its query, the Done page with its week or a file's page, and the way back. */
      nav: Shaped<Nav>
      pages: Shaped<PageDetails>
      filePages: Shaped<FilePages>
      /** The Find field's round and the text it holds as drawn (hooks/find-field.ts). */
      findField: FindField
      /** The focus ring's landings in the pane (hooks/find-field.ts): the line under the Find field reads them. */
      ring: RingLandings
      /** The key of the pane element the focus ring last landed on, null for none: a windowed body (hooks/window.ts) always draws it. */
      held: string | null
      /** Whether the banner (hooks/banner.ts) shows its task's card; a press on it opens and closes it. */
      banner: boolean
    }
  }
}
