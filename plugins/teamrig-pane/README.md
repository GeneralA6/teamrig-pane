# teamrig-pane

Install it from a session. It needs Claude Code 2.1.295 or later, the oldest it is tested on, and says so on
an older one:

    /plugin install teamrig-pane --marketplace GeneralA6/teamrig-pane

Docks the session's tasks from teamrig's task register (its tasks folder: `events.jsonl`, with the
`inbox-marks.jsonl` that `teamrig inbox read` writes; see Where the register is, below) on the right of
Claude Code's fullscreen UI. It reads files only: a stat poll
every 3 s re-reads a file only when its size or mtime moved, and a 60 s tick moves the due/age
labels on. No model calls, so no tokens. Every time is on the team's clock and zone-marked
(`14:20 IDT`), as teamrig prints it: the team config's `timeZone`, else the machine's zone (the
session's `TZ`, else the system's). A switch over the list flips it to the session's git changes, or
to each team session's prompts and replies (Tasks, Changes and Log, below).

- **mine**: the session's area, under its status bar (Status bar, below) and a header counting its
  active tasks and unread inbox lines (`3 active · inbox 1 unread`; a pin names the area first,
  `web (pinned) · 3 active · …`). Its tasks follow in sections, each in teamrig's plan order (priority,
  then the date it works to with undated last, then id: its own due, or an earlier one of an active task
  that needs it) under a bold heading with its count, an empty one left out:
  `Verifying` (the nearest to done, so closing them comes first), `Working on`, `Up next`, `Waiting`
  (its own waiting tasks, then the first 8 it asked of other sessions, each saying `on <owner>`) and
  `Done today` (its tasks done or dropped on the team's day, the newest 6). A heading's count is the
  status bar's count for its section, the tasks past a cap included; under a capped section a dim line
  says how many more and the key that lists them all (`i`, `o`).
- **all**: every owner's active tasks, each owner's heading with its counts, a count with none left
  out (`api · 4 active · 1 waiting · 1 verifying`), and the verifying tasks first in
  each group.

A task is two lines: its status mark, bold id and title (cut at two lines, whole while its card is open), then a dim meta line under
the title. The mark is its status as `teamrig list` names it: `○` open, `◐` in progress, `◑` verifying,
`■` waiting, `✓` done, `✗` dropped. The meta line reads `p2 · due Sat 10-17 · in progress since 11:55 IDT`:
its priority, the date it works to (its own due, or an earlier one of an active task that needs it,
which it names: `due Wed 10-14 (from T7)`; `verify by` while verifying), since when it stands at its status
and why, whom it holds up, then what needs a look. A verifying task's change has landed and waits for what proves it works: its
note says what that is (`verifying since 09:10 IDT: tests pass on main`). A waiting task waits on a
decision, an approval, another task or a time (`teamrig set --status waiting --waits`): in red, its line
names each, a cleared one `ready`, then its note (`waiting since 14:00 IDT: decision owner, on T1 ready,
until Fri 10-16 14:00 IDT; the copy first`). An old `blocked` line reads as waiting, with only its note. A
task not started names the tasks planned before it that are still unfinished (`after T1, T2`). A task the
active task of another session needs says so, as `teamrig list` does: `needed by T7 (beta, due Thu 10-22) +1`,
the one due first, its owner and due (left out when the due already says `(from T7)`), and how many more.
Then the flags: `late 1d` (red, past its due), `new` (its owner has not touched it yet), `not picked up 2d` (red,
still untouched 24 hours after it was assigned) and `asked by lead` on a task not started that another
session asked for. A task done today is one dim line, `✓ T11  Signup API`, the time it closed at the
right edge.

The area is taken from the session's newest `teamrig inbox read --session <id>` (its mark in
`inbox-marks.jsonl` names the Claude Code session), or pinned with `/teamrig-pane <session>`. A tab
teamrig binds by its Claude Code title (`/rename web`) gets the same mark, so the pane follows it too.

`/teamrig-pane [mine | all | auto | <session>]` opens the pane, switches the view, follows the inbox read
again (`auto`) or pins a session, named by its id or its name; a word that names no session pins nothing
and lists the team's sessions. In the pane, `m` and `a` switch views, and `o`, `v`, `w`, `i` and `n`
show one status's tasks alone (Status bar, below); on a task's page `b` and `f` go back and forward, and
in the dock the Find field (`s`) searches the tasks and `archive` (`h`) lists the finished ones a week at a time
(below).

In the side dock the tasks sit a blank line apart, each wrapped title and meta line starting under the
title, and a blank line and a bold heading open each section (each owner in `all`).
Lines are measured in display cells, per character as the reader sees it (`hooks/width.ts`): CJK,
fullwidth forms and emoji take two cells, an emoji sequence (a ZWJ family, a skin tone, a flag) is one
character, and a cut never lands inside one, so no line runs past the pane's edge. However narrow the
dock is resized, its lines wrap to its own width, a wrapped line's indent cut to half the line.

A task's card shows what the register records for it, in the words a task tracker uses. Click a
task, or focus the pane and press Enter on it, to open its card: its title shows whole and the card
takes its meta line's place; again closes it, and `c` closes every card. A done-today row opens the
same card. Each row of the card hangs on a dim `│` guide, a dim label, then its value, wrapped under
the value column, and shows only when it has a value:

- **Description:** what the task is and why, as written with it (`teamrig add --description`, or the
  body of the GitHub issue it came from); a task written before teamrig kept one shows the ask quoted as
  plain text from where its ref points (`file:N`, `N-M` up to 3 lines, or `N,M`);
- **Status:** `not started`, `in progress`, `waiting`, `verifying`, `done` or `dropped`, since when,
  and who set it when that was the task's newest change, then why a waiting task waits, in red;
- **Note:** its newest status note;
- **Proof:** what proves a verifying task, in green;
- **Priority:** its number;
- **Due:** the date it works to, `late 2d` in red once past it, a date taken from a task that needs it
  naming that task (`Wed 10-14 (from T7)`); **Verify by** while it is verifying;
- **Week:** its planning week, by its first day;
- **After:** the tasks planned before it, each with its status (`T5 (done)`);
- **Needed by:** each active task of another owner that needs it, with its owner and due
  (`T7 (beta, due Thu 10-22)`), the one due first;
- **Goal:** the roadmap item of each of its goals (`--goals G10.1g`, `S4`), else the bare id;
- **From:** who asked, or `GitHub issue #12` for a task teamrig opened from one;
- **Added:** when it was written and by whom;
- **Owner:** its owner, in another area's list;
- **Reference:** where its ask is written: each file by its folder and name (`inbox/po.md`), a click
  away from its page (below), other words as written;
- **Evidence:** its evidence;
- **Links:** up to 5 addresses, each a link: the GitHub issue a task teamrig opened from one came
  from (its ref `gh:<owner>/<repo>#<number>`), then each web address written in its description, its ref,
  its newest note, its proof and its evidence, once each. A link never splits; one wider than its line is shortened with
  `…` and still opens its whole address. Each task id the pane holds is underlined and opens that
  task's page (below); one inside a web address stays part of it.

The card has no row for a parent, sub-tasks or history: the register keeps none of them for a task.

A click on a task id in a card (in its `After` or `Needed by` row, or written in a note) opens that task's page: its
title whole and its card, the body to itself. Over it, `‹ back` and `forward ›` (`b`, `f`; dim words when
there is nowhere to go) step through the places you went, as a browser does, and a trail under them names
the last 4 (`Tasks › T50 › T58`): the one shown bold, those ahead of it dim, the rest a click away, `…` where
places were left out. The pane keeps 20 places, the oldest dropped first, and a click from an older place
drops those ahead of it. A page opens at its top and has no status bar; back to the list brings the card
you left to the middle of the dock, and the list keeps back and forward while a page lies ahead of it.
`Tasks` (`t`), `mine` and `all` show the list alone. A task that closed over 8 days ago says so on
its page. Above the prompt ids are plain words and no page shows.

A click on a file in a card's `Reference` row opens that file's page, a place among the others: its folder and
name, where it was read, then its text as plain lines, read whole as the page opens (tabs as two spaces, a wrapped
line under its own indent). A ref that names a line (`board.md:6`) opens the page at that line, drawn bold. The pane
looks for the file where it looks for the lines a card quotes: an inbox in the inbox folder, `~/` under the home
folder, a relative path in the session's folder and each folder above it, then in the team's folder. A file it does
not find lists each path it looked at; one over 256 KiB, or not text, says why it is not shown.

In the dock, a click on the header's `inbox 2 unread` opens the area's inbox the same way, as a file's page, at its
first unread line, drawn bold (at the newest line when none is unread). Reading it there marks nothing read: the
pane never writes an inbox, so the count drops only when the session runs `teamrig inbox read`.

The dock always shows a Find field under its Tasks, Changes and Log switch; `s` or a click puts the cursor in it, and
it never takes the keys by itself, so the pane's other keys keep working. Each word typed must match, case
aside, a task's id (`T52` or `52`) or the start of a word in its title, owner, who asked, goals, week, note,
evidence or ref (one that starts with a mark, `.md`, matches anywhere), and the body lists the matches as
you type, the matched words underlined: an active task as its title and a dim line of whose it is and the
fields matched, a finished one on one dim line with when it closed. It searches what the pane holds, every
area's active tasks and those finished in the last 8 days, never older ones: the active ones in plan order, then
the finished ones newest first, at most 30, with a dim line counting the rest. A click on a result opens
its page, Enter opens the top one's, and back returns to the results; the trail names the search by its
words. Emptying the field or `clear` (shown while searching) closes the search, the cursor staying in the field;
Enter moves the cursor onto the page's `‹ back`, so `b`, `f` and `s` work there. Esc only hands the keys back.
A line under the field says where the keys go: `Typing searches` (bold) while they type into it,
`Keys on the pane` while the pane's keys answer (`s` moves them into the field), and `Keys go to Claude` while
Claude's prompt has them (a click on the field gives them back, the query kept). A Claude dialog, such as a
permission prompt, takes the keys, clicks and wheel scroll from the pane until it is answered: that is Claude
Code's rule, not the pane's.

`archive` (`h`, in the dock's mine and all row) opens the Archive page on this week, a week starting
Monday 00:00 on the team's clock: the view's tasks closed done or dropped, a dim line a day, newest first, each task on one
dim line with when it closed (in `all`, its owner too), at most 50 with a dim line counting the rest. Its
head names whose tasks and how many were done and dropped. `‹ prev` (`p`) and `next ›` (`l`) step a
week back and forward in place, so back returns to where the page was opened from; a click on a task
opens its page, and back returns to the week. The pane holds the tasks finished in the last 8 days, so
the steps reach back to the week those days start in, and that week ends with a dim line naming
`teamrig list --status done,dropped` for older ones.

Boards, agendas and docs are rewritten and their line numbers drift, so a line is quoted only while
something still ties it to the task: an inbox line by its date (inboxes are append-only; one dated
more than a day after the task was created is dropped), and any other line when it is a roadmap item
of one of the task's goals, sits inside one, or names the task's id. A goal's own item is found by
its id in the goals document (`TEAMRIG_PANE_GOALS_DOC`, a path from the workspace root; unset, no goal items are quoted), so it never drifts. A task with no description, no goals
and refs that point at boards may quote nothing: its card then has no Description row, only its Reference.

The pane docks on the right only in the fullscreen layout (`"tui": "fullscreen"`) with the terminal at
least 110 columns wide; anywhere else it sits above the prompt, and `/teamrig-pane` says which condition
failed. A session opens it by itself from 144 columns; `/teamrig-pane` opens it at any width.

Above the prompt it shows at most 6 one-line rows, the last saying how many it left out: that area
is redrawn on every keystroke, so a full list there slows typing. The status bar takes only the rows
past the 4 the list keeps, its own lines first to last, so it never pushes the tasks out. The side
dock shows the whole list.

## Status bar

Over the mine view's tasks, a row as wide as the pane shares its cells among the tasks of its sections,
a status for each, in this order: done today (green `█`), verifying (green `▓`), working, that is in
progress (amber `█`), waiting (red `█`: its own waiting tasks and those it asked of other sessions) and
not started, that is open (dim `░`). Today is the team's day, the one the due labels are in: a task done
or dropped today is done today, one closed on an earlier day is left out. Each count is the one its
section's heading names. The cells are
shared by largest remainder, and a status with any task gets at least one. Under the row a dim line
counts them, each behind its key (`o: 1 done today · v: 1 verifying · w: 2 working`), skipping a
status with none; where the counts, keys included, are wider than the pane they wrap onto more lines.
An area with none of these tasks draws no bar, and the all view has none.

A press on a status's cells or its count, or its key while the pane holds the keyboard (`o` done
today, `v` verifying, `w` working, `i` waiting, `n` not started), shows only that status's tasks
under the header, every one its count names: done today newest first, the others in plan order (the
waiting ones the area's own first), every other section hidden. Its
cells and count turn bold, and a dim line under the counts reads `showing verifying only, click again
for all`. The same press again shows every task; one on another status switches to it. A shown status
that empties keeps its count at 0 (`0 waiting`), so a press still clears it, and the list says so
(`Nothing waiting.`). The filter is the pane's own state: it holds while you switch to all (which it
does not filter) or to Changes or Log, and is never kept across a reload; a new session, or a reload, shows
every task again.

## The banner

The band above the prompt names the task the session works on: its area's task in progress that took its
status last (`◐ T595  Current-task banner outside the pane`), else its first open task in plan order after a
dim `next`, else a dim `nothing in progress or open`. It follows the register as the list does, cut at one
line, whether the pane is open, minimized or never drawn; a session with no area gets no band from the pane. A
click on it opens the task's description, status, note, proof, priority and due under its title; a second
click closes it. The band is the engine's, directly above the prompt input, in the terminal and the desktop
app: the one place outside a pane where a plugin draws a part a click reaches, as no plugin gets a row atop the
terminal. A survey takes the band while it is up, its `[-]` (or `ctrl+x ctrl+a`) folds it, and a card taller
than the band scrolls in it. The press has no key of its own: a band's key would answer that key typed in an
empty prompt.

## Minimizing, not closing

The close mark (`✕`, or `ctrl+x x`) minimizes the pane to a one-row strip instead of closing it, so a
stray click never loses it. The close is refused (a `ui.close` veto), so the pane also keeps its place
among the panes the person opened: a later open needs 110 columns, not the 144 an unasked open needs.
The strip is the Tasks / Changes / Log switch (below) and a `minimized` mark. To open it in full again, click
any of its buttons, which opens the pane on that view, press `t`, `d` or `g` while the pane holds the keyboard
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
`state/inbox`. A team config's `paths.state` and `paths.inbox` move them, as they do for teamrig. With
both folders named below, the session's team is still looked for, for the files that name its sessions
and for its notes: when none can be found or read, the pane goes without them.

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

## Tasks, Changes and Log

The switch, `[Tasks] [Changes Δ3] [Log]`, leads the pane in every state: open, in a dock however narrow (its
buttons wrap under each other rather than clip), above the prompt, and as the minimized strip. While
the pane holds the keyboard, `t` presses Tasks, `d` Changes and `g` Log (`c` already closes the cards).

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

A press on a file's row (a click, or Enter on it) opens its diff under it, as `/diff` shows one, and a second
press closes it: each hunk's `@@` line dim, then its lines, `+` added in green, `-` removed in red and the
lines around them plain. A tracked file's diff is `git --no-optional-locks diff HEAD -- <path>`, its staged and
unstaged edits as its row counts them (`--cached`, the staged lines, on a branch with no commit yet; a rename's
names its old path too, so it shows as one file); an untracked file's is `git diff --no-index` against nothing.
Color, external diff tools and textconv filters are off, whatever git's config says. The first 200 lines show
and the rest are counted (`… 40 more lines`); a line wraps under its text and stops at 3 screen lines, ending in
`…`, so a minified line can't fill the pane. A binary file shows git's `Binary files … differ`, a diff git
can't read a `WARN` line with git's first error line. An untracked folder opens no diff. An open diff is read
again with each read of the changes below, one git run per open file, so it follows the edits; a file that
leaves the list (committed, say) closes its diff. The open diffs stay open across a hot reload.

Each repo costs one `git --no-optional-locks status --porcelain=v1 -b -z` (no index lock, so it never
blocks a commit; 10 s timeout), and while it has changed files one `git diff HEAD --numstat -z` and up
to two `git grep --untracked -c` runs for their lines (also lock-free; a count git can't give is left
out, with no warning): on the next 3 s poll after a write or a shell call (Bash, PowerShell; a burst of
edits costs one run), every 60 s for changes made from elsewhere, and at once on a switch to Changes;
each open diff is one more run then. Git only, no model calls. After a hot reload the repos and files already found stay known, also after a
version that changes how the drawn changes are kept.

`Δn` on the Changes button counts the files the view lists, and so does the pane's tab title
(`Tasks · Δ3`). The title is set by opening the open pane again under the same id, only when the count
moves.

What the host draws and the mod can't change:

- there is no fixed header: the body scrolls as one, so in a long list the switch scrolls up out of view
  with the rows;
- the tab strip, and so the title's `Δn`, shows only while more than one pane is open;
- a mod can't show or focus the built-in Diff pane (`/diff`), so Changes is the plugin's own list of
  git's changes, and its own diff of each file under it.

### Log

Log shows each session's prompts and replies of the hours teamrig keeps them, from the turn log it writes for every
session of the team (`<team state>/turn-log/<session>/<UTC hour>.jsonl`, one file an hour, kept the team config's
`turnLog.keepHours`, 24 by default), so a `/clear` or a compaction never takes away what a tab showed. It reads each
line with teamrig's own reader, and files only, only while it shows: no model calls, no tokens.

The view lists the team's sessions that wrote a line in those hours, the one whose log changed last first: each its
id and when its log last changed, over its newest prompt in two lines at most (`no prompt in the last 24 h` when it has
replies alone, with the team's hours). Until there is one it says why: no team, a team with no config file (teamrig
writes no turn log for one), no turn log yet (teamrig writes none while the team's `turnLog.enabled` is off), a
folder it could not read, or no session in the window.

A press on a session (a click, or Enter on it) opens its page under a `back` button (`b`): a head with the session and
how many lines it shows, then its lines oldest first, so the newest is at the end, where the page opens. Each prompt and
reply has a head line (`prompt · 20:05 IDT`, `reply · 20:06 IDT`, a time of an earlier day with its day) over its text, a long
reply wrapped under its own indent; teamrig keeps a text's last 64,000 characters, and a cut one says `cut, its end
kept`. A `/clear` is a dim rule, `── 20:07 IDT · context cleared (/clear) ──`. The page holds the newest 256 KiB of text and
says when it left older lines out; a file it could not read is named in a `Not all read` line, and the rest still
shows.

While it shows, the list or the open page is read again on each 3 s poll: the session folders are listed, and an hour's
file is read again only when its size or time moved. The Log button, from a page or another view, shows the list.
Above the prompt the list shows, never a page.

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
snapshot every draw reads keeps only the tasks a view can show (active, or finished in the last 8 days,
the days teamrig's own rotation keeps finished tasks in its working set), so drawing grows with the live
tasks and the last days' finished ones, never with the register's history. Through the engine's test
harness, 20,000 of its shorter events (3.4 MiB, 4,082 tasks, 409 kept) load and draw in 185-200 ms,
a redraw takes 43-48 ms and a switch to `all` 36-40 ms (three runs, 2026-10-15); a poll with nothing
new reads nothing.

Every scroll, focus move, keystroke and poll write draws the pane again, so a docked draw lays out
only the rows near what you see (`hooks/window.ts`): those within two screenfuls of the scroll window,
plus the focused element, the row a page was opened from and the list's first and last rows, each with
a screenful around it. Each run of the other rows is one empty box as tall as they are, so the body
keeps its height and the scrollbar its place, and the wrapped lines of a row that did not change are
kept from the draw before. The plugin's own work per draw (`mine` view, 56 columns, 40 rows shown,
median, 2026-10-18, before the first and last rows were kept) at 100, 500 and 2,000 tasks fell from
11, 53 and 212 ms to 1.7, 7 and 28 ms, and the elements the host lays out from 576, 2,843 and 11,676
to 102 at each size. Keeping the list's ends adds at most two screenfuls of rows at any size, so Tab
from the last row and Shift+Tab from the top wrap to the list's true ends.

`$.state` outlives a hot reload, so the snapshot is kept under a shape tag (`SNAPSHOT_SHAPE` in
`hooks/register.tsx`): bump it whenever the `Snapshot` or `TaskRow` type changes, and a reloaded pane
reads what the older code wrote as not yet read, drawing `Reading the register…` until its first poll
(at most 3 s), instead of rows with fields missing or a `No area` line it has not looked for yet. The
drawn changes are kept the same way (`CHANGES_SHAPE`), the open diffs too (`DIFFS_SHAPE`, bumped when
`FileDiff` or `DiffLine` changes), and the repos and files found apart from them
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
