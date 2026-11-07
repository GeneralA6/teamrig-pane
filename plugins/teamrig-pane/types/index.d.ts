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
  /** 0 is the most urgent (teamrig's own level for work done right now); drawn `p0` in a list, `Priority 0` on a card. */
  priority: number
  /** What the item is (`teamrig add --type`); null when no one set it, which reads as a task. */
  type: 'task' | 'bug' | null
  /** Whether the bug sits in a critical area (`teamrig add --critical`); only a bug takes it. */
  critical: boolean
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
  /** Its size in percent of the weekly limit (`teamrig update --size`); null when no one sized it. */
  size: number | null
  /** The leader who pinned it to the top of its owner's list (`teamrig update --pin`); null when not pinned. */
  pin: string | null
  /** The work class it was given (`--class`); null when none, and it counts as the team's default class. */
  workClass: string | null
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

/** Who leads the team's sessions: teamrig's lead tree (T781) over the team's config, as hooks/leads.ts reads it. */
export type TeamLeads = {
  /** The team's lead, `roles.lead`. */
  lead: string
  /** Each session on the team but the lead, to its direct leader: the sub-lead that lists it, else the lead. */
  leaderOf: Readonly<Record<string, string>>
}

/**
 * A register event a task's owner wrote on its own task (hooks/work.ts): the session, the task, and when (ms), what
 * the Log view titles a conversation by.
 */
export type WorkMark = { readonly session: string; readonly task: string; readonly at: number }

/**
 * A line of the session's own inbox as the Inbox view shows it (hooks/inbox.ts): its key, when it was posted (ms), who
 * sent it (null for a line with no `<from>: `), its words, and whether it lies past the area's read mark.
 */
export type InboxItem = {
  readonly key: string
  readonly at: number
  readonly from: string | null
  readonly text: string
  readonly unread: boolean
}

/** Everything a drawing needs, rebuilt when a register file changes. */
export type Snapshot = {
  /** The tasks a drawing can show: the active ones and those finished within HELD_DAYS of the fold (hooks/done.ts isHeldFinished). */
  tasks: TaskRow[]
  area: string | null
  areaSource: AreaSource | null
  /** The session's team, as the pane found it (hooks/places.ts TeamFiles); null when it found none. */
  team: string | null
  /**
   * The area's name on its team, what teamrig's commands message it by: teamrig's Roster over the team's config and
   * rename log (hooks/source.ts), so a rename shows on the next poll. Null with no area, no team or no config file
   * teamrig reads, or an area that is not on the team.
   */
  areaName: string | null
  /**
   * Who leads whom on the team, for the card's Lead row: re-read with the names when the team's config moves
   * (hooks/source.ts). Null with no team or no config file teamrig reads.
   */
  leads: TeamLeads | null
  /**
   * Each session's events on its own tasks over the hours the team keeps its turn log (`turnLog.keepHours`), oldest
   * first (hooks/work.ts): the Log view titles each conversation by the tasks its session worked in it. Re-read with
   * the tasks when the register moves; empty with no team or no team config, which have no turn log.
   */
  work: readonly WorkMark[]
  /** Unread lines in `<inbox>/<area>.md`, past its read mark as teamrig finds it; null when the area never ran `inbox read`. */
  unreadInbox: number | null
  /**
   * The lines of `<inbox>/<area>.md` the Inbox view shows (hooks/inbox.ts inboxItems): those of the last 24 hours and
   * the unread ones, in the file's order, as the last poll found them; empty with no area.
   */
  inbox: readonly InboxItem[]
  /** What the pane could not read: a failed load (the last good tasks stay drawn), or the lines teamrig's reader skipped. */
  problem: string | null
  /**
   * Hours a task may stand untouched by its owner before it reads NOT PICKED UP: the team config's
   * `register.check.notPickedUpAfterHours`, as teamrig's `register check` reads it.
   */
  notPickedUpAfterHours: number
  /**
   * The IANA name of the team's zone (`Asia/Jerusalem`): the team config's `timeZone`, else the machine's, as teamrig
   * resolves it. Every time prints on its clock, and a stored bare day is a day of it (hooks/zone.ts).
   */
  timeZone: string
  /**
   * Who the owner is in a task's `source`: the team config's `register.ownerSource` (default `owner`), which the Done
   * page's Owner asked group reads (core register/done-groups.ts).
   */
  ownerSource: string
  /** How the team ranks its tasks: the team config's `focus`, which plan order and a row's class and score read (hooks/ranking.ts). */
  focus: RankFocus
  /**
   * The goals of the team and the teams above it, as the last poll found them (hooks/tree-goals.ts): what a Roadmap
   * task's score and the goal named beside it read. Moves when a rank or a parent does.
   */
  goals: GoalRanks
  /**
   * Each session's cards on the owner, keyed by its id, as the last poll found them (hooks/owner-cards.ts): recounted
   * when the register moves and, while a card is put off, each minute, so one comes back with no file change. A
   * session with none is absent.
   */
  ownerCards: Readonly<Record<string, SessionOwnerCards>>
  /** Each session's tasks counted, as the register last folded (hooks/task-counts.ts): recounted when it moves. */
  taskCounts: TaskCounts
  /** When it was built, so due and age labels move on without a file change. */
  now: number
}

/**
 * Each goal's parent and rank by its tag, what a ranking reads of a goal (core register/ranking.ts `goals`). Plain data,
 * not a Map, as a snapshot crosses `$.state`.
 */
export type GoalRanks = Readonly<Record<string, { readonly parent: string | null; readonly rank: number | null }>>

/**
 * The `focus` keys a ranking reads, as teamrig's config sets them (core register/ranking.ts RankingFocus). This contract
 * cannot import, so it spells them out, and hooks/log.ts holds the two equal.
 */
export type RankFocus = {
  readonly defaultClass: string
  readonly roadmapClass: string
  readonly maintenanceClass: string
  readonly parkAfterDays: number
  readonly score: {
    readonly rankValues: readonly number[]
    readonly roadmapUnranked: number
    readonly maintenanceValue: number
    readonly maintenanceBug: number
    readonly maintenanceCritical: number
    readonly improvementsValue: number
    readonly overdueValue: number
    readonly dueSoonValue: number
    readonly dueSoonDays: number
    readonly unblocksShare: number
    readonly ownerOrderValues: readonly number[]
    readonly defaultSizePct: number
    readonly minSizePct: number
  }
  readonly expedite: { readonly critical: boolean; readonly ownerP1: boolean }
}

/** What the team config sets that the snapshot carries: the NOT PICKED UP hours, the team's zone, the owner's marker and how it ranks. */
export type DrawnSettings = Pick<Snapshot, 'notPickedUpAfterHours' | 'timeZone' | 'ownerSource' | 'focus'>

/** What the team config says about the owner's waits: its `register.ownerSource` and `register.requireDecisionCard`, and how they rank. */
export type OwnerSettings = { readonly ownerSource: string; readonly requireDecisionCard: boolean; readonly focus: RankFocus }

/** What the pane reads from the team config: what the snapshot carries, and what decides which cards are the owner's. */
export type TeamSettings = DrawnSettings & OwnerSettings

/** A card waiting on the owner (hooks/owner-cards.ts): its task's id and title. */
export type OwnerCard = { readonly id: string; readonly title: string }

/** A card the owner put off (Later), with when the lead asks it again, in teamrig's words (`Mon 11-02`). */
export type LaterOwnerCard = OwnerCard & { readonly until: string }

/** One session's cards on the owner, as `teamrig meet` asks them: those the lead asks now, then those put off, soonest back first. */
export type SessionOwnerCards = { readonly due: readonly OwnerCard[]; readonly later: readonly LaterOwnerCard[] }

/** One session's tasks (hooks/task-counts.ts): those done, those verifying, and every one it owns but the dropped. */
export type SessionTaskCounts = { readonly done: number; readonly verifying: number; readonly total: number }

/**
 * The register's tasks counted by owner (hooks/task-counts.ts), an owner of none absent, and whether a compaction
 * archived the tasks finished long ago, which the counts then miss.
 */
export type TaskCounts = { readonly bySession: Readonly<Record<string, SessionTaskCounts>>; readonly archived: boolean }

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
  /** True on a branch with no commit yet: there is no HEAD, so its lines are the staged ones (against the empty tree). */
  isUnborn: boolean
  /** Why the repo could not be read; null when it was. */
  problem: string | null
}

/** The Changes view's data: each repo the session works in, then the files it wrote outside any repo, newest first. */
export type ChangesSnapshot = { repos: RepoChanges[]; outside: string[]; isRead: boolean }

/** The repo roots and outside files the session has found, all a reloaded pane needs to read them again. */
export type KnownChanges = { roots: string[]; outside: string[] }

/**
 * One line of a file's diff as drawn (hooks/diff.ts): a hunk's `@@` line, a line added, removed or the same around
 * them (its text without git's marker), or a note git writes (`\ No newline at end of file`, `Binary files … differ`).
 */
export type DiffLine = { kind: 'hunk' | 'add' | 'del' | 'same' | 'note'; text: string }

/**
 * A Changes file's open diff (hooks/diff.ts): being read; read, its first DIFF_KEPT lines and how many more it has
 * (`isCut` when git wrote more than the 4 MiB a run keeps, so the count stops short too); or why git could not read it.
 */
export type FileDiff =
  | { kind: 'reading' }
  | { kind: 'read'; lines: DiffLine[]; more: number; isCut: boolean }
  | { kind: 'failed'; problem: string }

/** The Changes files whose diffs are open, by their row's key (`<repo root>:<path>`, hooks/changes-rows.ts). */
export type OpenDiffs = { readonly [file: string]: FileDiff }

/**
 * A file written outside git as it was before the session first wrote it (hooks/outside-copies.ts), what its diff is
 * drawn against: not there yet; its text; too big to keep (its size); not text; or why it could not be read.
 */
export type OutsideCopy =
  | { readonly kind: 'none' }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'large'; readonly bytes: number }
  | { readonly kind: 'binary' }
  | { readonly kind: 'unread'; readonly problem: string }

/** The copies kept of the files written outside git, by path as the tool call named it. */
export type OutsideCopies = { readonly [path: string]: OutsideCopy }

/** A version's three numbers: `2.1.295` is major 2, minor 1, patch 295. */
export type Version = { major: number; minor: number; patch: number }

/** What the pane needs and lacks (hooks/requirements.ts), each drawn as one line with its fix. */
export type RequirementProblem =
  | { kind: 'claude-code-old'; running: Version }
  | { kind: 'git-unstartable'; reason: string }
  | { kind: 'check-failed'; requirement: 'Claude Code'; reason: string }

/**
 * What the pane's body shows, picked with the switch over it: the register's tasks, the session's git changes
 * (hooks/changes.ts), the team sessions' prompts and replies (hooks/turn-log.ts), the session's inbox lines
 * (hooks/inbox.ts), the team tree (hooks/team.ts), the team's meetings (hooks/meetings.ts), or the registers' numbers
 * (hooks/stats-source.ts).
 */
export type PaneView = 'tasks' | 'changes' | 'log' | 'inbox' | 'team' | 'meetings' | 'stats'

/**
 * A team folder the Teams tab's last read could not read (hooks/team-source.ts): its team id, why, and whether the tree
 * draws the team as it last read it (true) or leaves it out, never read before (false).
 */
export type TeamFolderFailure = { readonly team: string; readonly reason: string; readonly isLastRead: boolean }

/**
 * The Teams tab's tree (hooks/team-source.ts): the tree of teams that holds the pane's team (hooks/team.ts), its root
 * null when the team's config is missing or teamrig refuses it, and the team folders that read failed; or that it is
 * not read yet, that the pane found no team, or why the team folders could not be listed, the register read, or the
 * pane's own team folder read before any read of it worked.
 */
export type TeamView =
  | { readonly kind: 'tree'; readonly root: import('../hooks/team').TeamTreeNode | null; readonly failures: readonly TeamFolderFailure[] }
  | { readonly kind: 'reading' }
  | { readonly kind: 'no-team' }
  | { readonly kind: 'failed'; readonly reason: string }

/**
 * What the Stats tab folds (hooks/stats-source.ts): every team in the tree of teams that holds the pane's team, one
 * team with the teams under it, or one session's tasks in its team.
 */
export type StatsChoice =
  | { readonly kind: 'tree' }
  | { readonly kind: 'team'; readonly team: string }
  | { readonly kind: 'session'; readonly team: string; readonly session: string }

/**
 * teamrig's stats fold less the tasks behind its counts (core register/stats.ts RegisterStats.tasks): the view keeps
 * only the list a Health tile's press opened, as slim rows (StatsList), never the register's tasks, which are heavy.
 */
export type StatsNumbers = Omit<import('../hooks/core/read/index').RegisterStats, 'tasks'>

/**
 * The tasks behind a Health count a tile's press lists (core register/stats.ts StatsTasks): the active ones, those
 * opened or closed in the range, the overdue ones, their p1 part, and those waiting on the owner.
 */
export type StatsListKind = keyof import('../hooks/core/read/index').StatsTasks

/** One task of a Stats list: the team that holds it now and the fields its row draws. */
export type StatsListRow = {
  readonly team: string
  readonly id: string
  readonly title: string
  readonly owner: string
  readonly status: TaskStatus
  readonly priority: number
  /** As teamrig keeps it: `YYYY-MM-DD` or `YYYY-MM-DD HH:MM`, UTC; a bare day means its end. */
  readonly due: string | null
}

/** The tasks behind one Health count (hooks/stats-source.ts listsOf): p1 first, then by due date, but the owner's waits the oldest first. */
export type StatsList = { readonly kind: StatsListKind; readonly rows: readonly StatsListRow[] }

/**
 * The Stats tab's numbers (hooks/stats-source.ts): the scope they fold, a team no longer in the tree folded as the
 * tree; the range; the tree's teams, root first and depth first, for the scope presses; teamrig's stats fold and its
 * Health tiles; the tasks behind the count a tile's press picked, null while none is; the scope's week, its teams'
 * week files summed (hooks/team.ts weekOf), null for none this week; and the team folders and registers whose read
 * failed. Or that it is not read yet, that the pane's team has no config teamrig takes, or why the team folders could
 * not be listed or the pane's own team read before any read of it worked.
 */
export type StatsView =
  | {
      readonly kind: 'stats'
      readonly scope: StatsChoice
      readonly range: import('../hooks/core/read/index').StatsRange
      readonly teams: readonly string[]
      readonly stats: StatsNumbers
      readonly health: import('../hooks/core/read/index').RegisterHealth
      readonly list: StatsList | null
      readonly week: import('../hooks/team').TeamWeek | null
      readonly failures: readonly TeamFolderFailure[]
    }
  | { readonly kind: 'reading' }
  | { readonly kind: 'no-team' }
  | { readonly kind: 'failed'; readonly reason: string }

/** A meeting's status as teamrig keeps it (its meeting schedule's statuses). */
export type MeetingStatus = 'scheduled' | 'started' | 'done' | 'dropped'

/**
 * A meeting the Meetings view lists (hooks/meetings.ts), as `teamrig meeting list --json` prints it: its id (`M<n>`),
 * when it starts (epoch ms) and that time on the team's clock, its length in minutes, the session met (whose tab a
 * start brings to the front, or opens), the others joining, the tasks it settles, what it is about, its brief's path
 * (null for none), its status, and whether it is missed: scheduled, its slot over with no start.
 */
export type Meeting = {
  readonly id: string
  readonly at: number
  readonly atText: string
  readonly minutes: number
  readonly session: string
  readonly with: readonly string[]
  readonly tasks: readonly string[]
  readonly about: string
  readonly brief: string | null
  readonly status: MeetingStatus
  readonly missed: boolean
}

/**
 * The Meetings view's list (hooks/meetings.ts): the team's scheduled and started meetings by time, and how many of the
 * meetings teamrig printed the pane could not read (a newer teamrig's); or that it is not read yet, that the pane found
 * no team, or why the list could not be read (no teamrig CLI, a refusal).
 */
export type MeetingsView =
  | { readonly kind: 'list'; readonly meetings: readonly Meeting[]; readonly unreadable: number }
  | { readonly kind: 'reading' }
  | { readonly kind: 'no-team' }
  | { readonly kind: 'failed'; readonly reason: string }

/**
 * What the last [Start meeting] press answered (hooks/meetings.ts): the meeting, whether teamrig is still starting it,
 * started it or refused, and the lines it printed after its STARTED line (who it told, the tab it fronted or opened),
 * or why it refused.
 */
export type MeetingStart = { readonly id: string; readonly outcome: 'starting' | 'started' | 'refused'; readonly lines: readonly string[] }

/**
 * What the last [Meet] press on the Teams tab answered (hooks/owner-meet.ts): the session, whether teamrig is still
 * asking it, asked it to bring the owner its cards, or refused, and the lines it printed (the tab it woke or opened),
 * or why it refused.
 */
export type MeetAnswer = { readonly session: string; readonly outcome: 'asking' | 'asked' | 'refused'; readonly lines: readonly string[] }

/** The owner's two acts on a task card (hooks/owner-acts.ts): a Note to its session, or putting it Next on its list. */
export type OwnerActName = 'note' | 'next'

/** A press of an owner act on a task card: open the Note field, ask Next's preview, send the Note, cancel, confirm Next. */
export type OwnerActPress = 'note' | 'next' | 'send' | 'cancel' | 'confirm'

/**
 * Where the owner's act on a task card stands (hooks/owner-acts.ts), one at a time in the pane: the Note field open
 * (each opening a new round, so a new field), Next's preview being read, the preview waiting on a confirm, an act
 * running, or what the last one answered: its lines on success, its refusal verbatim.
 */
export type OwnerAct =
  | { readonly kind: 'noting'; readonly task: string; readonly round: number }
  | { readonly kind: 'previewing'; readonly task: string }
  | { readonly kind: 'confirming'; readonly task: string; readonly lines: readonly string[] }
  | { readonly kind: 'sending'; readonly task: string; readonly act: OwnerActName }
  | {
      readonly kind: 'told'
      readonly task: string
      readonly act: OwnerActName
      readonly outcome: 'done' | 'refused'
      readonly lines: readonly string[]
    }

/** What a turn log line records: a prompt the person sent, a reply the session showed, or a clear or compaction of its context. */
export type TurnKind = 'prompt' | 'reply' | 'clear'

/**
 * One line of a session's turn log (hooks/turn-log.ts), as teamrig writes it: when, what, its text (secret shapes
 * redacted, at most 64k characters), the Claude Code session it came from (a /clear starts a new one in the same
 * tab), and whether teamrig cut its text, keeping the end.
 */
export type TurnEntry = {
  readonly at: string
  readonly kind: TurnKind
  readonly text: string
  readonly claude: string
  readonly isCut: boolean
}

/** How a conversation opened: the first line of the owner's first words in it, else of Claude's first reply. */
export type LogOpening = { readonly by: 'owner' | 'claude'; readonly line: string }

/**
 * A conversation the Log view lists (hooks/turn-log.ts): a session's lines with one Claude Code session id (a /clear
 * starts a new one, a compaction keeps it), when its first and last lines of the window were written (ms), when the
 * session's next conversation began (null for its newest), how many lines it has in the window, and how it opened
 * (null when it holds harness notices alone).
 */
export type LogConversation = {
  readonly session: string
  readonly claude: string
  readonly firstAt: number
  readonly lastAt: number
  readonly nextAt: number | null
  readonly lines: number
  readonly opening: LogOpening | null
}

/** What a press on the Log view's list opens: a session's conversation, by its Claude Code session id. */
export type LogRead = { readonly session: string; readonly claude: string }

/**
 * The Log view's list (hooks/turn-log.ts): each session's conversations with a line in the last `hours` (the team
 * config's `turnLog.keepHours`), the newest last line first; or that it is not read yet, that the pane found no team,
 * that the team has no config file (teamrig refuses such a team and writes it no turn log), that it has no turn log
 * folder (teamrig writes none before its turn log version or with turnLog.enabled false), or why the folder could not
 * be read.
 */
export type LogList =
  | { readonly kind: 'conversations'; readonly hours: number; readonly conversations: readonly LogConversation[] }
  | { readonly kind: 'reading' }
  | { readonly kind: 'no-team' }
  | { readonly kind: 'no-config' }
  | { readonly kind: 'no-log' }
  | { readonly kind: 'failed'; readonly reason: string }

/**
 * A conversation's page in the Log view: the session's newest lines with its Claude Code session id `claude`, of the
 * last `hours` (the team config's `turnLog.keepHours`), oldest first, at most LOG_PAGE_CHARS of text (`isCut` when
 * older lines are left out), and why a file of it could not be read (null when all were).
 */
export type LogPage = {
  readonly session: string
  readonly claude: string
  readonly hours: number
  readonly entries: readonly TurnEntry[]
  readonly isCut: boolean
  readonly problem: string | null
}

/**
 * A place the tasks view shows (hooks/nav.ts): the list, remembering the key of the element a page was opened from
 * (null when none) so a return scrolls back to it, a task's page by its id, or a search (hooks/search.ts) by its
 * query, the words its Find field holds ('' before any is typed), the Done page (hooks/done-rows.ts) by its week,
 * the `YYYY-MM-DD` Monday it shows, a reference file's page (hooks/file-page.ts) by the file as its ref writes it
 * and the line it lands on, or the Keys page (hooks/keys-page.ts), one page.
 */
export type Place =
  | { readonly kind: 'list'; readonly row: string | null }
  | { readonly kind: 'task'; readonly id: string }
  | { readonly kind: 'search'; readonly query: string }
  | { readonly kind: 'done'; readonly week: string }
  | { readonly kind: 'file'; readonly file: string; readonly line: number | null }
  | { readonly kind: 'keys' }

/** The places the person went through, oldest first (at most hooks/nav.ts NAV_PLACES), and the index of the one shown. */
export type Nav = { readonly places: readonly Place[]; readonly at: number }

/**
 * The Find field's round (hooks/find-field.ts): the field is drawn under a key naming `round`, holding `text` as drawn,
 * what it should hold when the round started (the query of the search shown, else ''). Typing never starts a round;
 * a step that changes what the field should hold does.
 */
export type FindField = { readonly round: number; readonly text: string }

/** What the focus ring last landed on (hooks/find-field.ts): the Find field, a result of the Tasks search, or any other element. */
export type RingStop = 'field' | 'result' | 'other'

/** How many times the pane's focus ring landed on an element (the engine's ui.focus event, hooks/find-field.ts), and what the last landing was on. */
export type RingLandings = { readonly count: number; readonly on: RingStop }

/** What each page a place names read for its task when it opened (hooks/details.ts), by task id. */
export type PageDetails = { readonly [id: string]: TaskDetail }

/** What each file page a place names read when it opened (hooks/ref-file.ts), by the file as its ref writes it. */
export type FilePages = { readonly [file: string]: RefFileRead }

/** `mine`: this session's area; `all`: every owner's active tasks. */
export type ViewMode = 'mine' | 'all'

/** A segment of the status bar over the area's tasks (hooks/status-bar.ts): done today, verifying, in progress, waiting, open. */
export type BarStatus = 'done-today' | 'verifying' | 'working' | 'waiting' | 'not-started'

/**
 * A project teamrig is not set up for (hooks/places.ts): the session's folder, where a pointer file would tie it to a
 * team, and the teams in the kit home, by id: none on the machine likely means teamrig is not installed.
 */
export type ProjectSetup = { readonly project: string; readonly teams: readonly string[] }

/** What the Tasks view shows in place of tasks in a project teamrig is not set up for (hooks/setup.ts): its setup, and the problem the last look found. */
export type SetupView = { readonly setup: ProjectSetup; readonly problem: string | null }

/** Where a reveal lands its target in the docked body's window (hooks/frame.ts revealed): its top, middle or bottom, or the least move that shows it. */
export type RevealBlock = 'start' | 'center' | 'end' | 'nearest'

/**
 * Where a step wants the docked body's window (hooks/body-scroll.ts): at an offset (the person's scrolls), at the
 * body's end (a Log page, which stays there as its lines come in), or where the element keyed `key` shows (a step back
 * to the list, into a file's page).
 */
export type ScrollTarget =
  | { readonly kind: 'offset'; readonly offset: number }
  | { readonly kind: 'end' }
  | { readonly kind: 'reveal'; readonly key: string; readonly block: RevealBlock }

/** The last step's target, `seq` counting the steps, so a drawing tells a new reveal from one it settled. */
export type BodyScroll = { readonly seq: number; readonly to: ScrollTarget }

declare module 'claude-code' {
  interface PluginState {
    // The snapshot, the open cards, the changes, the known repos, the places, the pages' details and the file pages' reads, the open diffs, the outside files' copies, the Log view's list and page, the focus ring's landings, the setup, the body's window, the team tree, the meetings and the Stats tab's numbers are kept under shape tags (hooks/register.tsx SNAPSHOT_SHAPE, CARDS_SHAPE, CHANGES_SHAPE, KNOWN_SHAPE, NAV_SHAPE, FILES_SHAPE, DIFFS_SHAPE, COPIES_SHAPE, LOG_SHAPE, RING_SHAPE, SETUP_SHAPE, SCROLL_SHAPE, TEAM_SHAPE, MEETINGS_SHAPE, STATS_SHAPE), so a reload never draws one an older pane wrote.
    'teamrig-pane': {
      snapshot: Shaped<Snapshot>
      mode: ViewMode
      expanded: Shaped<ExpandedTasks>
      /** The Tasks view's headings whose tasks are folded away (hooks/rows.ts paneBlocks): a section's key in mine, `owner:<id>` in all. */
      tasksFolded: readonly string[]
      size: PaneSize
      view: PaneView
      changes: Shaped<ChangesSnapshot>
      known: Shaped<KnownChanges>
      /** The Changes files whose diffs are open (hooks/diff.ts), as git last read them. */
      diffs: Shaped<OpenDiffs>
      /** The files written outside git as they were before the session first wrote them (hooks/outside-copies.ts). */
      copies: Shaped<OutsideCopies>
      /** The conversations the Log view lists (hooks/turn-log.ts), as last read. */
      logList: Shaped<LogList>
      /** The conversation page the Log view shows, as last read; null while it shows the list. */
      logPage: Shaped<LogPage | null>
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
      ring: Shaped<RingLandings>
      /** Whether the banner (hooks/banner.ts) in the band above the prompt shows its task's card; a press on it opens and closes it. */
      banner: boolean
      /** What the Tasks view shows in a project teamrig is not set up for (hooks/setup.ts), null once a register is found. */
      setup: Shaped<SetupView | null>
      /** Where the docked body's window is to stand: the last step that moved it (hooks/body-scroll.ts). */
      bodyScroll: Shaped<BodyScroll>
      /** The team tree the Teams tab shows (hooks/team-source.ts), as last read. */
      teamTree: Shaped<TeamView>
      /** The Teams tab's nodes the person opened or closed against their default (hooks/team.ts teamRows), by key. */
      teamToggled: readonly string[]
      /** The team's meetings the Meetings view shows (hooks/meetings.ts), as last read. */
      meetings: Shaped<MeetingsView>
      /** The Meetings view's meetings whose cards are open (hooks/meetings-rows.ts meetingKey), by key. */
      meetingsOpen: readonly string[]
      /** What the last [Start meeting] press answered; null before one, and after a session start or a switch to the view. */
      meetingStart: MeetingStart | null
      /** What the last [Meet] press on the Teams tab answered; null before one, and after a session start or a switch to the tab. */
      ownerMeet: MeetAnswer | null
      /** Where the owner's Note or Next on a task card stands (hooks/owner-acts.ts); null before one, after a cancel and after a session start. */
      ownerAct: OwnerAct | null
      /** The Stats tab's numbers (hooks/stats-source.ts), as last folded. */
      stats: Shaped<StatsView>
      /** What the Stats tab folds: the tree, a team or a session (its scope row's presses pick it). */
      statsScope: StatsChoice
      /** The days the Stats tab folds (its range row's presses pick them). */
      statsRange: import('../hooks/core/read/index').StatsRange
      /** The Health count whose tasks the Stats tab lists in place of its numbers (a tile's press picks it, back clears it); null for the numbers. */
      statsList: StatsListKind | null
      /** The Teams tab row whose [Stats] opened the Stats tab, back's landing; null when the tab shows from its switch. */
      statsFrom: string | null
      /** The Stats tab's sections the person opened or closed against their default (hooks/stats-rows.ts isSectionOpen), by key. */
      statsToggled: readonly string[]
      /** The Done page's days, groups and `n more` rows the person flipped against their default (hooks/done-rows.ts), by key. */
      doneToggled: readonly string[]
    }
  }
}
