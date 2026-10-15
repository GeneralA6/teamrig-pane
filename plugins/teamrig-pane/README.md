# teamrig-pane

Install it from a session (it is tested on Claude Code 2.1.295 and later):

    /plugin install teamrig-pane --marketplace GeneralA6/teamrig-pane

Docks the session's tasks from the task register (its tasks folder: `events.jsonl`, with its
`aliases.jsonl` renames and `pauses.jsonl` pauses; see Where the register is, below) on the right of Claude Code's fullscreen UI. It reads files only: a stat poll
every 3 s re-reads a file only when its size or mtime moved, and a 60 s tick moves the due/age
labels on. No model calls, so no tokens. A switch over the list flips it to the session's git changes
(Tasks and Changes, below).

- **mine**: the session's area. Shows active tasks in plan order (tier, then due, then id), with
  NEW / NOT PICKED UP (untouched after 24 h) / overdue flags, the register's list markers and what
  holds a blocked task, plus what the area asked of others, what it finished in the last day and its
  unread inbox lines.
- **all**: every owner's active tasks, with blocked counts.

A task's glyph is the status the register's `list` shows: `○` open, `◐` in progress, `■` blocked
(stored, or held by an active `blocked-by` task or an open wait), `◇` verifying, `◌` paused, `✓` done,
`✗` dropped. Its markers follow the due date: `⛔T194` blocker, `⏳owner` open wait, `↑T205` parent,
`⏸P1` pause, `✓2/5` children done, `🔍10-15` proof due. Under a blocked task: its blocked note, then
`waits on T194 · owner: <what>`.

The area is taken from the session's newest `inbox read --session <area>`
(`inbox-marks.jsonl` in the tasks folder), or pinned with `/tasklist <area>`.

`/tasklist [mine | all | auto | <area>]` opens the pane, switches the view, follows the inbox read
again (`auto`) or pins an area. In the pane, `m` and `a` switch views.

In the side dock the tasks sit a blank line apart, each wrapped title line starting under the task's
id, and a ruled heading opens each section (asked of others, finished today, each owner in `all`).
Lines are measured in display cells, per character as the reader sees it (`hooks/width.ts`): CJK,
fullwidth forms and emoji take two cells, an emoji sequence (a ZWJ family, a skin tone, a flag) is one
character, and a cut never lands inside one, so no line runs past the pane's edge. However narrow the
dock is resized, its lines wrap to its own width, a wrapped line's indent cut to half the line.

The register has no description field, so a task's details are built from what it does record. Click
a task (`▸`), or focus the pane and press Enter on it, to expand it (`▾`). The details hang under
its id on a `│` guide, a bare guide line between the quotes and the facts:

- the task's `--detail` (the ask and what done looks like), when the register has one;
- the ask and what it serves, quoted as plain text from where its ref points (`file:N`, `N-M` up to
  3 lines, or `N,M`), then the roadmap item of each of its goals (`--goals G10.1g`, `S4`);
- who asked, who added it if someone else did, when, and its goals;
- the register v2 facts, each only when it has a value: `kind code · labels token-saving`; the dates
  (`start 10-15 · started 10-14 12:19 · eta 10-19 (moved 2×) · done … · due moved 1×`); its size as
  the register's `show` writes it (`est 1.5d (initial 1d) ≈ 0.16B = 2.1% of a fleet week`);
- its newest status note and evidence, with the status, then `evidence due 10-15 06:00` while a
  verifying task's proof is due;
- its parent (`part of ◐ T205 <title>`), its sub-tasks (the first 8 by number, `+N more`) and the
  tasks it is blocked by, finished ones too, each a tree line with its status glyph and title;
- its open waits (`waits on owner: <what>`, one line each) and the pause in force (`paused P1: …`);
- its newest 3 progress notes, newest first (`10-14 16:04 po: …`, then `+N older`: the register's
  `show` has them all);
- `see folder/file` for the files nothing was quoted from.

An estimate is a share of a fleet week only while the newest token-usage run
(`usage-YYYY-MM-DD.json` in the token-usage folder, written by a usage report) is at most 7 days
old; with none, or a stale one, it reads in its own unit (`est 1.5d`). The pane lists that folder at
most once a minute and re-reads the run only when it changed. A task's list line never grows: the
facts show only in its details.

Boards, agendas and docs are rewritten and their line numbers drift, so a line is quoted only while
something still ties it to the task: an inbox line by its date (inboxes are append-only; one dated
more than a day after the task was created is dropped), and any other line when it is a roadmap item
of one of the task's goals, sits inside one, or names the task's id. A goal's own item is found by
its id in the goals document (`TEAMRIG_PANE_GOALS_DOC`, a path from the workspace root; unset, no goal items are quoted), so it never drifts. A task with no goals whose refs point
at boards shows only its `see` line, under its `--detail` when it has one.
Press the row again to collapse it, or `c` to collapse every task.

The pane docks on the right only in the fullscreen layout (`"tui": "fullscreen"`) with the terminal at
least 110 columns wide; anywhere else it sits above the prompt, and `/tasklist` says which condition
failed. A session opens it by itself from 144 columns; `/tasklist` opens it at any width.

Above the prompt it shows at most 6 one-line rows, the last saying how many it left out: that area
is redrawn on every keystroke, so a full list there slows typing. The side dock shows the whole list.

## Minimizing, not closing

The close mark (`✕`, or `ctrl+x x`) minimizes the pane to a one-row strip instead of closing it, so a
stray click never loses it. The close is refused (a `ui.close` veto), so the pane also keeps its place
among the panes the person opened: a later open needs 110 columns, not the 144 an unasked open needs.
The strip is the Tasks / Changes switch (below) and a `minimized` mark. To open it in full again, click
either button, which opens the pane on that view, press `t` or `d` while the pane holds the keyboard
(`ctrl+x tab` or a click on it), or run `/tasklist`. The size is kept in `$.store` (`paneSize`, one
for the plugin), so the next session, after a restart or a hot reload too, opens as the last one was
left. The plugin's own close and an unload still close it.

A mod can't bind a key that works from anywhere. For one, add `"ctrl+x t": "command:tasklist"` to
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
`state/inbox` and token-usage runs in `state/token-usage`. A team config's `paths.state` and
`paths.inbox` move them, as they do for teamrig.

Any folder can be named instead, each on its own; a variable wins over the settings file, which wins
over the team default:

| Variable | Setting | What it holds |
| --- | --- | --- |
| `TEAMRIG_PANE_TASKS_DIR` | `tasksDir` | `events.jsonl`, `aliases.jsonl`, `pauses.jsonl`, `inbox-marks.jsonl` |
| `TEAMRIG_PANE_INBOX_DIR` | `inboxDir` | one `<area>.md` inbox per area |
| `TEAMRIG_PANE_USAGE_DIR` | `usageDir` | `usage-YYYY-MM-DD.json` token-usage runs |
| `TEAMRIG_PANE_GOALS_DOC` | `goalsDoc` | the goals document, a path from the workspace root (unset: no goal items are quoted) |

The settings file is `<kit home>/pane.json`, or the file `TEAMRIG_PANE_SETTINGS` names, a JSON object
of those settings; a folder in it is absolute or starts with `~/`:

    { "tasksDir": "~/notes/tasks", "inboxDir": "~/notes/board/inbox", "usageDir": "~/notes/token-usage" }

The variables are read from the environment Claude Code runs in (its settings' `env` block works
too), all of it once when the session starts. When nothing names the register, or the settings file,
the pointer file or the team config cannot be used, the pane draws one `⚠` line saying what to set
or what is wrong.

## Tasks and Changes

The switch, `[Tasks] [Changes Δ3]`, leads the pane in every state: open, in a dock however narrow (its
two buttons wrap under each other rather than clip), above the prompt, and as the minimized strip. While
the pane holds the keyboard, `t` presses Tasks and `d` Changes (`c` already collapses tasks).

Changes lists the files changed in the git repos the session works in: the repo of the session's folder,
and the repo of each file the session writes (Edit, Write, NotebookEdit). A worktree is its own repo
(`git rev-parse --show-toplevel`, asked once a folder). Each repo gets a ruled header (`mods-pane-v2 ·
pane-v2 · 3 changed`, or `clean`), then its files: git's two-letter code (the staged letter green, the
unstaged one yellow, `??` untracked dim), the path from the repo root and a rename's source
(`← old.ts`). The first 200 files a repo are listed and the rest counted; a repo git can't read shows
git's first error line. Files written outside any repo come last, the newest 20.

Each repo costs one `git --no-optional-locks status --porcelain=v1 -b -z` (no index lock, so it never
blocks a commit; 10 s timeout): on the next 3 s poll after a write or a shell call (Bash, PowerShell; a
burst of edits costs one run), every 60 s for changes made from elsewhere, and at once on a switch to
Changes. Git only, no model calls. After a hot reload the repos and files already drawn stay known.

`Δn` on the Changes button counts the files the view lists, and so does the pane's tab title
(`Tasks · Δ3`). The title is set by opening the open pane again under the same id, only when the count
moves.

What the host draws and the mod can't change:

- there is no fixed header: the body scrolls as one, so in a long list the switch scrolls up out of view
  with the rows;
- the tab strip, and so the title's `Δn`, shows only while more than one pane is open;
- a mod can't show or focus the built-in Diff pane (`/diff`), so Changes is the plugin's own git status
  list: files, not their lines.

## Reading the register

The pane parses, renames and folds the register with the register's own modules, so every event type,
status and rename it writes reads here too, and a line the pane cannot read is one the register cannot
read either. `scripts/sync-core.ts` copies teamrig's read entry (`src/read/index.ts`) and every module it
reaches into `hooks/core/`, each at its path under teamrig's `src/` (which ones and how: `scripts/vendor.ts`),
from the teamrig commit `scripts/teamrig-pin.json` names. It refuses a module that imports anything
outside the copied set, and a listed module the read entry no longer reaches. Never edit `hooks/core/`
by hand: change teamrig, then sync.

A read that fails leaves the last good tasks drawn under a `⚠` line naming the problem, and the next
poll reads again. A file refused as locked or denied (`EBUSY`, `EPERM`, `EACCES`) counts as there,
even where Windows then answers that it does not exist; only a path that is not there reads empty. A drawing that throws shows one `⚠ the pane could not
draw: …` line under the buttons, never a blank pane.

One read copies at most 4 MiB (`$.fs.read` rejects a bigger file and has no ranged read). The register
is append-only, about 320 bytes an event, so `events.jsonl` reaches that near 13,000 events unless it
is rotated. A file over it is named with its size (`events.jsonl is 4.12 MiB, over the 4 MiB a pane can
read at once`) from its stamp, never read, and the last good tasks stay drawn; a pane started then has
none to draw. Under it, the whole register is re-read and refolded only when a file moved, and the
snapshot every draw reads keeps only the tasks a view can show (active, or finished within a day), so
drawing grows with the live tasks, never with the register's history. Through the engine's test
harness, 20,000 events (3.2 MiB, 4,082 tasks, 409 kept) load and draw in 350-400 ms, a redraw takes
75-95 ms and a switch to `all` 65 ms; a poll with nothing new reads nothing.

`$.state` outlives a hot reload, so the snapshot is kept under a shape tag (`SNAPSHOT_SHAPE` in
`hooks/register.tsx`): bump it whenever the `Snapshot` or `TaskRow` type changes, and a reloaded pane
reads what the older code wrote as not yet read, drawing `Reading the register…` until its first poll
(at most 3 s), instead of rows with fields missing or a `No area` line it has not looked for yet.

After teamrig changes those modules, move the pin, sync and commit the copy with the pin:

    node --disable-warning=ExperimentalWarning scripts/sync-core.ts --teamrig <repo> --ref <commit>   # move the pin, write hooks/core
    node --disable-warning=ExperimentalWarning scripts/sync-core.ts --teamrig <repo> --check          # list drift from the pin, exit 1

`--teamrig` is a teamrig git checkout; the modules are read from its history (`git cat-file`), never
from its working tree, so a local edit there cannot reach the pane. `--ref` takes a sha, branch or tag
and writes the commit it names to the pin. `--check` also fails on a file under `hooks/core/` that no
copy names. The plugin
contract (`types/index.d.ts`) cannot import, so it spells the status unions out; a spec fails when
the register adds or drops a status the pane has no glyph for.

Checks: `claude plugin validate .` and `claude plugin test .` (neither typechecks).
