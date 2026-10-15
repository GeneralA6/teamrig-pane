# teamrig-pane

Install it from a session. It needs Claude Code 2.1.295 or later, the oldest it is tested on, and says so on
an older one:

    /plugin install teamrig-pane --marketplace GeneralA6/teamrig-pane

Docks the session's tasks from teamrig's task register (its tasks folder: `events.jsonl`, with the
`inbox-marks.jsonl` that `teamrig inbox read` writes; see Where the register is, below) on the right of
Claude Code's fullscreen UI. It reads files only: a stat poll
every 3 s re-reads a file only when its size or mtime moved, and a 60 s tick moves the due/age
labels on. No model calls, so no tokens. A switch over the list flips it to the session's git changes
(Tasks and Changes, below).

- **mine**: the session's area, under its status bar (Status bar, below). Shows active tasks in
  teamrig's plan order (priority, then due with undated last, then id), each with its priority (`p2`)
  and due, NEW / NOT PICKED UP (untouched after 24 h) / overdue flags and, under a waiting task, what
  it waits for and its note. Verifying tasks lead, under `verifying (N)`: they are the nearest to
  done, so closing them comes first, and the rest follow under `other active (M)`. With none verifying,
  neither heading shows. Then what the area asked of others (the newest 8), what it finished today,
  the UTC day the status bar counts (the newest 6 under `finished today (N)`, then a dim line saying
  how many more, how many of those were dropped, and that `o` lists every one done today), and how
  many of its inbox lines are unread.
- **all**: every owner's active tasks, each owner's heading with its counts, a count with none left
  out (`api · 4 active · 1 waiting · 1 verifying`), and the verifying tasks first in
  each group.

A task's glyph is its status as `teamrig list` names it: `○` open, `◐` in progress, `◑` verifying,
`■` waiting, `✓` done, `✗` dropped. A verifying task's change has landed and waits for what proves
it works; under it, `↳ proof: <note>` says what that is. A waiting task waits on a decision, an
approval, another task or a time (`teamrig set --status waiting --waits`); under it, `↳` says which, then
its note (`↳ decision owner · until Fri 10-16 14:00; the copy first`). An old `blocked` line reads as
waiting, with only its note.

The area is taken from the session's newest `teamrig inbox read --session <id>` (its mark in
`inbox-marks.jsonl` names the Claude Code session), or pinned with `/teamrig-pane <session>`. A tab
teamrig binds by its Claude Code title (`/rename web`) gets the same mark, so the pane follows it too.

`/teamrig-pane [mine | all | auto | <session>]` opens the pane, switches the view, follows the inbox read
again (`auto`) or pins a session, named by its id or its name; a word that names no session pins nothing
and lists the team's sessions. In the pane, `m` and `a` switch views, and `o`, `v`, `w`, `i` and `n`
show one status's tasks alone (Status bar, below).

In the side dock the tasks sit a blank line apart, each wrapped title line starting under the task's
id, and a ruled heading opens each section (verifying, other active, asked of others, finished
today, each owner in `all`).
Lines are measured in display cells, per character as the reader sees it (`hooks/width.ts`): CJK,
fullwidth forms and emoji take two cells, an emoji sequence (a ZWJ family, a skin tone, a flag) is one
character, and a cut never lands inside one, so no line runs past the pane's edge. However narrow the
dock is resized, its lines wrap to its own width, a wrapped line's indent cut to half the line.

The register has no description field, so a task's details are built from what it does record. Click
a task (`▸`), or focus the pane and press Enter on it, to expand it (`▾`). The details hang under
its id on a `│` guide, a bare guide line between the quotes and the facts:

- the ask and what it serves, quoted as plain text from where its ref points (`file:N`, `N-M` up to
  3 lines, or `N,M`), then the roadmap item of each of its goals (`--goals G10.1g`, `S4`);
- who asked, who added it if someone else did, when, its priority as the team config names it
  (`p2 correctness`), its week and its goals;
- its newest status note and evidence, with the status;
- `see folder/file` for the files nothing was quoted from.

A task's list line never grows: these facts show only in its details.

Boards, agendas and docs are rewritten and their line numbers drift, so a line is quoted only while
something still ties it to the task: an inbox line by its date (inboxes are append-only; one dated
more than a day after the task was created is dropped), and any other line when it is a roadmap item
of one of the task's goals, sits inside one, or names the task's id. A goal's own item is found by
its id in the goals document (`TEAMRIG_PANE_GOALS_DOC`, a path from the workspace root; unset, no goal items are quoted), so it never drifts. A task with no goals whose refs point
at boards shows only its `see` line.
Press the row again to collapse it, or `c` to collapse every task.

The pane docks on the right only in the fullscreen layout (`"tui": "fullscreen"`) with the terminal at
least 110 columns wide; anywhere else it sits above the prompt, and `/teamrig-pane` says which condition
failed. A session opens it by itself from 144 columns; `/teamrig-pane` opens it at any width.

Above the prompt it shows at most 6 one-line rows, the last saying how many it left out: that area
is redrawn on every keystroke, so a full list there slows typing. The status bar takes only the rows
past the 4 the list keeps, its own lines first to last, so it never pushes the tasks out. The side
dock shows the whole list.

## Status bar

Over the mine view's tasks, a row as wide as the pane shares its cells among the area's tasks by
status, in this order: done today (green `█`), verifying (green `▓`), working, that is in progress
(amber `█`), waiting (red `█`) and not started, that is open (dim `░`). Today is the UTC day, the one
the due labels are in; tasks done on an earlier day, and dropped ones, are left out. The cells are
shared by largest remainder, and a status with any task gets at least one. Under the row a dim line
counts them, each behind its key (`o: 1 done today · v: 1 verifying · w: 2 working`), skipping a
status with none; where the counts, keys included, are wider than the pane they wrap onto more lines.
An area with none of these tasks draws no bar, and the all view has none.

A press on a status's cells or its count, or its key while the pane holds the keyboard (`o` done
today, `v` verifying, `w` working, `i` waiting, `n` not started), shows only that status's tasks
under the header: done today newest first, the others in plan order, every other section hidden. Its
cells and count turn bold, and a dim line under the counts reads `showing verifying only, click again
for all`. The same press again shows every task; one on another status switches to it. A shown status
that empties keeps its count at 0 (`0 waiting`), so a press still clears it, and the list says so
(`Nothing waiting.`). The filter is the pane's own state: it holds while you switch to all (which it
does not filter) or to Changes, and is never kept across a reload; a new session, or a reload, shows
every task again.

## Minimizing, not closing

The close mark (`✕`, or `ctrl+x x`) minimizes the pane to a one-row strip instead of closing it, so a
stray click never loses it. The close is refused (a `ui.close` veto), so the pane also keeps its place
among the panes the person opened: a later open needs 110 columns, not the 144 an unasked open needs.
The strip is the Tasks / Changes switch (below) and a `minimized` mark. To open it in full again, click
either button, which opens the pane on that view, press `t` or `d` while the pane holds the keyboard
(`ctrl+x tab` or a click on it), or run `/teamrig-pane`. The size is kept in `$.store` (`paneSize`, one
for the plugin), so the next session, after a restart or a hot reload too, opens as the last one was
left. The plugin's own close and an unload still close it.

A mod can't bind a key that works from anywhere. For one, add `"ctrl+x t": "command:teamrig-pane"` to
`~/.claude/keybindings.json` (the context it belongs under is unverified).

What the host draws and the mod can't change:

- the `✕` is on every pane and can't be hidden: only what it does is the mod's;
- docked, a minimized pane keeps the dock width the person gave it (the host has no collapsed dock, its
  floor is 24 columns and the person's width beats the mod's request), so minimizing frees no
  transcript width; above the prompt the frame fits its one row.


## Where the register is

By default the pane reads the register where teamrig keeps it for the session's team:
`<kit home>/teams/<team>/state` (the kit home is `$TEAMRIG_HOME`, else `~/.teamrig`; the team is
`$TEAMRIG_TEAM`, else the nearest `.teamrig.json` up from the session's folder), with its inbox in
`state/inbox`. A team config's `paths.state` and `paths.inbox` move them, as they do for teamrig, and
its `register.priorities` name the priorities (teamrig's defaults when it names none, or when the team
has no config). With both folders named below, the session's team is still looked for, only to name
the priorities: when none can be found or read, teamrig's defaults name them.

Any folder can be named instead, each on its own; a variable wins over the settings file, which wins
over the team default:

| Variable | Setting | What it holds |
| --- | --- | --- |
| `TEAMRIG_PANE_TASKS_DIR` | `tasksDir` | `events.jsonl`, `inbox-marks.jsonl` |
| `TEAMRIG_PANE_INBOX_DIR` | `inboxDir` | one `<area>.md` inbox per area |
| `TEAMRIG_PANE_GOALS_DOC` | `goalsDoc` | the goals document, a path from the workspace root (unset: no goal items are quoted) |

The settings file is `<kit home>/pane.json`, or the file `TEAMRIG_PANE_SETTINGS` names, a JSON object
of those settings; a folder in it is absolute or starts with `~/`:

    { "tasksDir": "~/notes/tasks", "inboxDir": "~/notes/board/inbox" }

The variables are read from the environment Claude Code runs in (its settings' `env` block works
too), all of it once when the session starts. When nothing names the register, or the settings file,
the pointer file or the team config cannot be used, the pane draws one `WARN` line saying what to set
or what is wrong.

## Tasks and Changes

The switch, `[Tasks] [Changes Δ3]`, leads the pane in every state: open, in a dock however narrow (its
two buttons wrap under each other rather than clip), above the prompt, and as the minimized strip. While
the pane holds the keyboard, `t` presses Tasks and `d` Changes (`c` already collapses tasks).

Changes lists the files changed in the git repos the session works in: the repo of the session's folder,
and the repo of each file the session or one of its agents writes (Edit, Write, NotebookEdit; a file a
shell command changes adds no repo). Until one is found it says why: `No git repo yet: the session folder
is in none, and no file the session or its agents edited (Edit, Write) is in one.` A worktree is its own repo
(`git rev-parse --show-toplevel`, asked once a folder), and leaves the list once its folder is removed:
git never runs in a folder that is gone. Each repo gets a ruled header (`mods-pane-v2 · pane-v2 · 3
changed`, or `clean`; the branch is left out when the folder bears its name, as a worktree's often does),
then its files: git's two-letter code (the staged letter green, the unstaged one yellow, `??` untracked
dim), the path from the repo root, its lines (`+12` added in green, `-3` removed in red; `+0 -0` or
`binary` dim; an untracked folder sums its files) and a rename's source (`← old.ts`). The first 200
files a repo are listed and the rest counted; a repo git can't read shows only its folder in the header
and git's first error line under it. Files written outside any repo come last, the newest 20. When git can't be
started at all (`git --version`, run once a session), a `WARN` line above the view says so, and the view lists
nothing rather than wait on git.

Each repo costs one `git --no-optional-locks status --porcelain=v1 -b -z` (no index lock, so it never
blocks a commit; 10 s timeout), and while it has changed files one `git diff HEAD --numstat -z` and up
to two `git grep --untracked -c` runs for their lines (also lock-free; a count git can't give is left
out, with no warning): on the next 3 s poll after a write or a shell call (Bash, PowerShell; a burst of
edits costs one run), every 60 s for changes made from elsewhere, and at once on a switch to Changes.
Git only, no model calls. After a hot reload the repos and files already found stay known, also after a
version that changes how the drawn changes are kept.

`Δn` on the Changes button counts the files the view lists, and so does the pane's tab title
(`Tasks · Δ3`). The title is set by opening the open pane again under the same id, only when the count
moves.

What the host draws and the mod can't change:

- there is no fixed header: the body scrolls as one, so in a long list the switch scrolls up out of view
  with the rows;
- the tab strip, and so the title's `Δn`, shows only while more than one pane is open;
- a mod can't show or focus the built-in Diff pane (`/diff`), so Changes is the plugin's own list of
  git's changes: each file and its line counts, not the diff itself.

## Reading the register

The pane parses and folds the register, reads the inbox marks and reads the team config with teamrig's
own modules, so every event type and status teamrig writes reads here too, and a line the pane cannot
read is one teamrig cannot read either. The lines teamrig's reader skips (unreadable, from a newer
teamrig, or an event naming no task) are counted on one `WARN` line worded as teamrig's own
(`events.jsonl: 1 unreadable line(s), ...`), above the tasks. `scripts/sync-core.ts` copies teamrig's read entry (`src/read/index.ts`) and every module it
reaches into `hooks/core/`, each at its path under teamrig's `src/` (which ones and how: `scripts/vendor.ts`),
from the teamrig commit `scripts/teamrig-pin.json` names. It refuses a module that imports anything
outside the copied set, and a listed module the read entry no longer reaches. Never edit `hooks/core/`
by hand: change teamrig, then sync.

A read that fails leaves the last good tasks drawn under a `WARN` line naming the problem, and the next
poll reads again. A file refused as locked or denied (`EBUSY`, `EPERM`, `EACCES`) counts as there,
even where Windows then answers that it does not exist; only a path that is not there reads empty. A
drawing that throws shows one `WARN the pane could not draw: …` line under the buttons, never a blank
pane.

One read copies at most 4 MiB (`$.fs.read` rejects a bigger file and has no ranged read). The register
is append-only, about 310 bytes an event in a working register, so `events.jsonl` reaches that near
13,500 events unless it is rotated. A file over it is named with its size (`events.jsonl is 4.12 MiB, over the 4 MiB a pane can
read at once`) from its stamp, never read, and the last good tasks stay drawn; a pane started then has
none to draw. Under it, the whole register is re-read and refolded only when a file moved, and the
snapshot every draw reads keeps only the tasks a view can show (active, or finished today), so
drawing grows with the live tasks, never with the register's history. Through the engine's test
harness, 20,000 of its shorter events (3.4 MiB, 4,082 tasks, 409 kept) load and draw in 185-200 ms,
a redraw takes 43-48 ms and a switch to `all` 36-40 ms (three runs, 2026-10-15); a poll with nothing
new reads nothing.

`$.state` outlives a hot reload, so the snapshot is kept under a shape tag (`SNAPSHOT_SHAPE` in
`hooks/register.tsx`): bump it whenever the `Snapshot` or `TaskRow` type changes, and a reloaded pane
reads what the older code wrote as not yet read, drawing `Reading the register…` until its first poll
(at most 3 s), instead of rows with fields missing or a `No area` line it has not looked for yet. The
drawn changes are kept the same way (`CHANGES_SHAPE`), and the repos and files found apart from them
under a shape of their own (`KNOWN_SHAPE`, bumped only when `KnownChanges` changes), so a bump of
`CHANGES_SHAPE` never makes a reloaded pane forget the repos the session found.

After teamrig changes those modules, move the pin, sync and commit the copy with the pin:

    node --disable-warning=ExperimentalWarning scripts/sync-core.ts --teamrig <repo> --ref <commit>   # move the pin, write hooks/core
    node --disable-warning=ExperimentalWarning scripts/sync-core.ts --teamrig <repo> --check          # list drift from the pin, exit 1

`--teamrig` is a teamrig git checkout; the modules are read from its history (`git cat-file`), never
from its working tree, so a local edit there cannot reach the pane. `--ref` takes a sha, branch or tag
and writes the commit it names to the pin. `--check` also fails on a file under `hooks/core/` that no
copy names; the local gate runs it before each push, and CI, when it runs, as the `hooks/core matches the teamrig pin` job. The plugin contract (`types/index.d.ts`) cannot import, so it spells the status unions
out; a spec fails when the register adds or drops a status the pane has no glyph for.

Then capture teamrig again at the new pin, and commit the capture with the sync:

    node --disable-warning=ExperimentalWarning scripts/golden.ts --teamrig <repo>   # write tests/golden-register.ts

It copies teamrig's CLI from the same history at the pin into a scratch folder, makes a team and
writes a register there with it (every event kind, a cleared ref, a rename, a priority only the team
config names, an inbox read, trimmed and rewritten, and lines teamrig skips), and keeps the files
with what `teamrig list` and `teamrig inbox status` printed for them, and what `list` printed for
teamrig's own register fixtures. `tests/golden.test.ts` then holds the pane to that output: its rows
print as teamrig's list lines, its unread counts and its `WARN` line equal teamrig's. Never edit the
capture by hand.

Checks: `claude plugin validate .` and `claude plugin test .` run it in the engine. `npm run typecheck:pane`, from the
repository root, typechecks its hooks, tests and scripts under `tsconfig.pane.json`, against `typecheck/`: the
engine ships no declarations for `claude-code` or `claude-code/testing`, so those files declare the subset the
plugin calls. A call it adds that they lack fails the typecheck; declare it there, never as `any`.
