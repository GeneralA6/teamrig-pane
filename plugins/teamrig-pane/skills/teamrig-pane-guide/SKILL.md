---
name: teamrig-pane-guide
description: Use when a session runs the teamrig task pane, or to learn what it shows, its /teamrig-pane command, keys, Changes tab, where it finds the register and its requirements.
---

# teamrig-pane guide

teamrig-pane is a Claude Code plugin that shows a session's teamrig tasks, and the files it changed in git,
beside the conversation. It only reads: the [teamrig](https://github.com/GeneralA6/teamrig) CLI writes the task
register and the inboxes, and the pane draws what is there. It makes no model calls and uses no tokens.

The pane is pre-release: it runs on Claude Code's function hooks (`hooks/hooks.json` loads `./register.tsx` as a
module in Claude Code's own runtime), an early-access plugin surface that may change between releases.

| File | Read it for |
| --- | --- |
| this file | requirements, install, the command, keys, what each view shows, how it relates to teamrig |
| [reference.md](reference.md) | where the pane finds the register, its settings, every `WARN` line and its fix, limits |
| [teamrig guide](https://github.com/GeneralA6/teamrig/blob/main/plugins/teamrig/skills/teamrig-guide/SKILL.md) | the CLI that writes what the pane shows: tasks, inboxes, rules, hooks |

## Requirements

| Needs | Version or setting | Why |
| --- | --- | --- |
| Claude Code | 2.1.295 or later | CI runs the plugin's tests on 2.1.295, the oldest release they pass on; earlier test kits cannot draw a pane. On an older one the pane draws a `WARN` line with the fix. |
| Fullscreen layout | `"tui": "fullscreen"` in `~/.claude/settings.json` | Only the fullscreen layout docks the pane on the right. Without it the pane sits above the prompt. |
| Terminal width | 110 columns to dock, 144 to open by itself | Narrower, the pane sits above the prompt; `/teamrig-pane` opens it at any width. |
| teamrig | a team with a register | The pane shows the register teamrig writes. Without one it shows a `WARN` line ([reference.md](reference.md#warn-lines-and-their-fixes)). |
| git | on the PATH | Only for the Changes tab, which runs `git status` per repo, and `git diff` and `git grep` to count the changed lines. Without it the pane draws a `WARN` line with the fix. |
| Node.js | none to use it; 22.18 or later to develop it | The pane runs inside Claude Code. The repository's tools and tests run on Node (`engines` in `package.json`). |
| Operating system | Linux, Windows or macOS | CI runs the tests on ubuntu, windows and macos, each on Node 22 and 24, and the plugin tests in Claude Code on each. CI is paused for now: each change is tested before it is pushed on one machine, Node and Claude Code release, so the others go unchecked until CI runs again. |

The pane checks the Claude Code version and git once a session, when it starts, and draws one `WARN` line
above its body for each that falls short ([reference.md](reference.md#warn-lines-and-their-fixes)).

Turn on the fullscreen layout: add `"tui": "fullscreen"` to the top-level object in `~/.claude/settings.json`,
then restart or resume the session. No other setting is needed.

## Install and update

```sh
claude plugin marketplace add GeneralA6/teamrig-pane
claude plugin install teamrig-pane@teamrig-pane
```

Claude Code moves an install only when the version in the plugin's `plugin.json` rises, and every release
raises it. To take the newest one:

```sh
claude plugin marketplace update teamrig-pane
claude plugin update teamrig-pane@teamrig-pane
```

Then run `/reload-plugins` in each open session, or restart it.

## The command

```text
/teamrig-pane [mine | all | auto | <session>]
```

| Form | What it does |
| --- | --- |
| `/teamrig-pane` | Opens the pane (also a minimized one). |
| `/teamrig-pane mine` | Opens it on this session's area. |
| `/teamrig-pane all` | Opens it on every owner's active tasks. |
| `/teamrig-pane <session>` | Pins this Claude Code session to the teamrig session `<session>` names, by its id or its name (as `teamrig who` lists them), then opens it. |
| `/teamrig-pane auto` | Drops the pin: the area follows this session's newest `teamrig inbox read` (or its title binding) again. |

Each form opens the pane. When the pane cannot dock, the command answers with the reason, for example:

```text
Shown above the prompt: the terminal is 96 columns wide and the side dock needs 110. Widen or maximize the window, then /teamrig-pane again.
```

A word that names no session on the team pins nothing and leaves the pane as it is; the answer lists the team's
sessions as `id (name)`:

```text
Not pinned (team shop): web is not a session on this team (sessions: lead (shop-lead), api (shop-api)).
```

The session is looked up as teamrig's own commands look one up, in the team config and its rename log, read again
at each command, so a name given since the pane started counts. With no team config to read (the folders named by
variables or the settings file), the word is taken as the session id, and a word that cannot be one answers
`usage: /teamrig-pane [mine | all | auto | <session>]`. The argument is read in lower case, and `mine`, `all` and
`auto` are always the forms above.

## Keys

Keys work while the pane holds the keyboard: press `ctrl+x tab`, or click the pane.

| Key | What it does |
| --- | --- |
| `t` | The Tasks view |
| `d` | The Changes view |
| `m` | Tasks: this session's area (`mine`) |
| `a` | Tasks: every owner (`all`) |
| `o` | mine: only the tasks done today (the status bar's `done today`); again shows every task |
| `v` | mine: only the verifying tasks (shipped, their proof still to come); again shows every task |
| `w` | mine: only the tasks in progress (`working`); again shows every task |
| `i` | mine: only the waiting tasks; again shows every task |
| `n` | mine: only the open tasks (`not started`); again shows every task |
| `c` | Collapses every expanded task (shown while one is expanded) |
| Enter on a task, or a click on it | Shows its details under it; again hides them |
| `✕`, or `ctrl+x x` | Minimizes the pane to a one-row strip; it never closes |

A plugin cannot bind a key that works from anywhere. For one, add `"ctrl+x t": "command:teamrig-pane"` to
`~/.claude/keybindings.json` (the context it belongs under is unverified).

Minimized, the pane is one row: the `[Tasks] [Changes Δn]` switch and a `minimized` mark. A click on either
button, `t` or `d`, or `/teamrig-pane` opens it in full again. Its size (open or minimized) is kept for the next
session.

## Where the pane sits

| Layout | Width | Where |
| --- | --- | --- |
| fullscreen | 144 columns or more | Docks on the right, and opens by itself when the session starts |
| fullscreen | 110 to 143 columns | Docks on the right when you run `/teamrig-pane` |
| fullscreen | under 110 columns | Above the prompt |
| main screen (not fullscreen) | any | Above the prompt |

Above the prompt it shows at most 6 one-line rows, the last saying how many it left out, because that area is
redrawn on every keystroke. The status bar takes only the rows past the 4 the list keeps. The side dock shows
the whole list.

## The Tasks view

The area is the teamrig session the pane shows as "mine". It comes from a pin (`/teamrig-pane <session>`), else from
the newest `teamrig inbox read --session <id>` run in this Claude Code session (teamrig records which Claude
Code session read). teamrig's prompt hook records the same when it binds a tab by its Claude Code title: a tab
renamed to a session's id or name (`/rename web`) binds at its next prompt, and the pane follows it. With none
of these, the pane says:

```text
No area for this session yet: /rename the tab to its session's id or name, run `inbox read --session <id>`, or /teamrig-pane <session> to pin one.
```

**mine** shows its status bar (below), then a header counting the area's active tasks and unread inbox lines,
`3 active · inbox 2 unread`, then its tasks in sections, each in teamrig's plan order (priority, then due, undated
last, then id) under a bold heading with its count; an empty section is left out:

1. `Verifying`: the change landed, its proof is still to come; these lead, because closing them comes first;
2. `Working on`: in progress;
3. `Up next`: open, not started;
4. `Waiting`: the area's waiting tasks, then the active tasks it asked of other sessions, the newest 8, each
   saying `on <owner>` (a dim line counts the rest, which **all** lists);
5. `Done today`: its tasks done or dropped today, the UTC day the status bar counts, the newest 6, one dim line
   each with the time it closed. Past them a dim line says how many more, how many of those were dropped, and
   that `o` lists every one done today.

The header names the area only for a pin (`web (pinned) · 3 active · inbox 2 unread`); the session's own area
goes unnamed, as its tab names the session. `inbox n unread` counts the lines in the area's inbox past its last
`teamrig inbox read`; it is missing when the area never ran one.

**all** shows every owner's active tasks, grouped by owner, each heading with its counts
(`api · 4 active · 1 waiting · 1 verifying`, a count with none left out), the verifying tasks first
in each group; your own area is highlighted.

A task is two lines, its title and a dim meta line under it:

```text
◐ T12  Build the signup endpoint
       p2 · due Sat 10-17 · in progress since 11:55
```

| Part | Meaning |
| --- | --- |
| `○` `◐` `◑` `■` `✓` `✗` | open, in-progress, verifying, waiting, done, dropped (as `teamrig list` names them) |
| `T12`, the title | The id, bold, and the title, cut at two lines |
| `p2` | Its priority |
| `due Sat 10-17` | Its due date; `verify by` while verifying |
| `in progress since 11:55` | Since when it stands at its status (a time today, else a day); a verifying task's note follows, what will prove it |
| `waiting since 14:00: decision owner, on T5 ready; the copy first` | In red: what a waiting task waits for (a decision, an approval, a task or a time, as `teamrig list` words it), a cleared one `ready`, then its note. An old `blocked` line reads as waiting, with only its note |
| `after T5, T6` | A task not started: the tasks planned before it that are still unfinished |
| `on api` | In `Waiting`: a task asked of another session, and its owner |
| `late 1d` | Past its due, in red |
| `new` | The owner has not touched it yet |
| `not picked up 2d` | The owner has still not touched it 24 hours after it was assigned, in red |
| `asked by lead` | A task not started that another session asked for |

A task done today is one dim line, `✓ T11  Signup API`, the time it closed at the right edge. Other messages:
`Reading the register…` (the first moments, at most 3 seconds), `Nothing active.` (mine) and `No active tasks.` (all).

### The status bar

Over **mine**, one row as wide as the pane shares its cells among the area's tasks by status, in this order:

| Cells | Count | Tasks |
| --- | --- | --- |
| green `█` | `done today` | done today |
| green `▓` | `verifying` | shipped, its proof still to come |
| amber `█` | `working` | in progress |
| red `█` | `waiting` | waiting on a decision, an approval, a task or a time |
| dim `░` | `not started` | open |

Under it, a dim line counts them, each behind its key (`o: 1 done today · v: 1 verifying · w: 2 working · i: 1 waiting`),
leaving out a status with none; where the counts, keys included, are wider than the pane they wrap onto more lines.
Today is the UTC day; tasks done on an earlier day, and dropped ones, are left out. The cells are shared by largest
remainder, and a status with any task gets at least one. With none of these tasks there is no bar, and **all** has
none.

A click on a status's cells or its count, or its key (`o`, `v`, `w`, `i`, `n`), shows that status's tasks alone
under the header: today's done ones newest first, the others in plan order; the other sections hide. Its cells and
count turn bold, and a dim line under the counts reads `showing verifying only, click again for all`. The same
click or key again shows every task; another status switches to it. A shown status that empties keeps its count,
`0 waiting`, so it can still be cleared, and the list says `Nothing waiting.` (`Nothing done today.`, `Nothing
to verify.`, `Nothing in progress.`, `Nothing left to start.` for the others).

The filter belongs to the pane: it holds while you switch to **all** (which it does not filter) or to Changes, and
is never kept across a reload: a new session, `/reload-plugins` or a restart shows every task again.

### A task's details

The register has no description field, so the details are built from what teamrig recorded:

- the ask, quoted from where the task's `--ref` points (`file:N`, `file:N-M` up to 3 lines, or `file:N,M`),
  then the roadmap item of each of its `--goals` from the goals document (see
  [reference.md](reference.md#where-the-register-is));
- who asked, who added it if someone else did, when, its priority as the team config names it, its week and
  goals;
- its newest status note and evidence;
- `see <file>` for each referenced file nothing was quoted from.

A line is quoted only while something still ties it to the task (an inbox line by its date, another line when it
is a goal's roadmap item or names the task id), because boards and docs are rewritten and line numbers drift.

## The Changes view

`[Tasks] [Changes Δ3]` leads the pane in every state. Changes lists the files changed in each git repo the
session works in: the repo of the session's folder and the repo of each file it or one of its agents writes
(Edit, Write, NotebookEdit; a file a shell command changes adds no repo). Until one is found, the view says
`No git repo yet` and why. A worktree is its own repo; once its folder is removed it leaves the view. Each repo has a header
(`<folder> · <branch> · 3 changed`, or `clean`; the branch is left out when the folder bears its name, as a
worktree's often does), then each file with git's two-letter code (`M `, ` M`, `??`), its path from the repo
root, its lines added and removed (`+12 -3`; `+0 -0` for none, `binary` for a binary file; an untracked folder
sums its files) and a rename's source (`← old.ts`). Files written outside any repo come last.

`Δn` counts the listed files, on the button and in the pane's tab title (`Tasks · Δ3`, shown while more than one
pane is open). The view cannot open Claude Code's own `/diff` pane.

Each repo costs one `git --no-optional-locks status --porcelain=v1 -b -z` (it takes no index lock, so it never
blocks a commit), and while it has changed files one `git diff HEAD --numstat -z` and up to two
`git grep --untracked -c` runs to count their lines: on the next 3 second poll after a write or a Bash or
PowerShell call, every 60 seconds, and at once on a switch to Changes. A count git can't give is left out, with no
warning, and git never runs in a folder that is gone.

## How it relates to the teamrig CLI

The pane never writes. To change what it shows, run teamrig (see the
[teamrig guide](https://github.com/GeneralA6/teamrig/blob/main/plugins/teamrig/skills/teamrig-guide/commands.md)):

| To | Run |
| --- | --- |
| bind the pane to your area and clear the unread count | `teamrig inbox read --session <you>` |
| bind a tab you opened yourself, marking nothing read | `/rename <you>`, then send a prompt |
| start, block or finish a task | `teamrig set T12 --status in-progress --session <you>` |
| ask another session for work (shows in `asked of others`) | `teamrig add --owner <session> --title "..." --priority p2 --session <you>` |
| give a task details to quote | `teamrig update T12 --ref "docs/spec.md:40-42" --session <you>` |

The pane reads the register with teamrig's own read modules, copied into the plugin at a pinned teamrig commit,
and a golden test holds its rows to what `teamrig list` prints. It reads files only: a stat every 3 seconds
re-reads a file when its size or time moved, and a 60 second tick moves the due and age labels on. Its state
(the size, a pin) lives in the plugin's own store, never in the register.
