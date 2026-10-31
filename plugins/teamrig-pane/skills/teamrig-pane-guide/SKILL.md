---
name: teamrig-pane-guide
description: Use when running the teamrig task pane, or to learn what it shows, its /teamrig-pane command, keys, Changes, Log, Inbox, Teams, Meetings views, where it finds the register, requirements.
---

# teamrig-pane guide

teamrig-pane is a Claude Code plugin that shows a session's teamrig tasks, and the files it changed in git,
beside the conversation. It only reads: the [teamrig](https://github.com/GeneralA6/teamrig) CLI writes the task
register and the inboxes, and the pane draws what is there. Two places run teamrig's CLI instead: the Meetings view, to
list the team's meetings and to start one, and the Teams tab's `[Meet]`, to have a session bring the owner its cards.
It makes no model calls and uses no tokens.

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
| teamrig | a team with a register; for the Meetings view, the teamrig plugin 0.208.0 or later installed in Claude Code, and for the Teams tab's `[Meet]`, 0.209.0 or later | The pane shows the register teamrig writes. Without one it shows a `WARN` line ([reference.md](reference.md#warn-lines-and-their-fixes)). The Meetings view and `[Meet]` run the CLI of the teamrig plugin it finds in Claude Code's plugin list. |
| git | on the PATH | Only for the Changes tab, which runs `git status` per repo, `git diff` and `git grep` to count the changed lines, and `git diff` for each file's diff you open. Without it the pane draws a `WARN` line with the fix. |
| Node.js | `node` on the PATH for the Meetings view and `[Meet]`, as teamrig needs; 22.18 or later to develop it | The pane runs inside Claude Code; the Meetings view and `[Meet]` run teamrig's CLI with `node`. The repository's tools and tests run on Node (`engines` in `package.json`). |
| Operating system | Linux, Windows or macOS | CI runs the tests on ubuntu, windows and macos, each on Node 22 and 24, and the plugin tests in Claude Code on each. CI checks only once the repository is public: until then each change is tested before it is pushed on one machine, Node and Claude Code release, so the others go unchecked. |

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

Keys work while the pane holds the keyboard: press `ctrl+x tab`, or click the pane. In the dock, the line under the
Find field says where they go now (see [Find](#find)). A Claude dialog, such as a permission prompt, takes the
keys, clicks and wheel scroll from the pane until it is answered: Claude Code's rule, not the pane's. In the dock,
`k: keys` at the end of the Tasks view's mode row opens the Keys page (`Tasks › Keys`), which lists these keys in
groups (the views, the list's own, a page's steps, the status bar's) and how the keys come to the pane; back returns.

| Key | What it does |
| --- | --- |
| `t` | The Tasks view |
| `d` | The Changes view |
| `g` | The Log view: each conversation of the team's sessions, titled by its task (see [The Log view](#the-log-view)) |
| `u` | The Inbox view: this session's inbox lines of the last 24 hours and every unread one (see [The Inbox view](#the-inbox-view)) |
| `e` | The Teams tab: the tree of teams the session's team is in, each lead over the sessions it leads (see [The Teams tab](#the-teams-tab)) |
| `j` | The Meetings view: the team's booked meetings by time, each a press that opens its card, where a scheduled one starts (see [The Meetings view](#the-meetings-view)) |
| `m` | Tasks: this session's area (`mine`) |
| `a` | Tasks: every owner (`all`) |
| `o` | mine: only the tasks done today (the status bar's `done today`); again shows every task |
| `v` | mine: only the verifying tasks (shipped, their proof still to come); again shows every task |
| `w` | mine: only the tasks in progress (`working`); again shows every task |
| `i` | mine: only the waiting tasks; again shows every task |
| `n` | mine: only the open tasks (`not started`); again shows every task |
| `c` | `close cards`: closes every open card (shown while one is open, after a dim `·` on the mode row) |
| `k` | In the dock: `k: keys`, the last of the mode row, opens the Keys page, every key in this table on one page |
| Enter on a task, or a click on it | Opens its card in place of its meta line; again closes it |
| A click on a task id in a card | Opens that task's page (see [A task's page](#a-tasks-page)) |
| A click on a file in a card's `Reference` row | Opens that file's page, at the line its ref names (see [A reference file's page](#a-reference-files-page)) |
| A click on the banner above the prompt | Opens the current task's card under its title; again closes it |
| A click on the banner's `open in pane` | Opens the pane, minimized or never opened too, at the current task's page; back shows the list at its row |
| `b` | On a page: back to the place before it; on the list, shown only while a page lies ahead; on a conversation's Log page, back to the list |
| `f` | Forward to the place back left, while there is one |
| `s` | In the dock's Tasks, Inbox, Changes and Teams views and on the Log view's list: puts the cursor in the Find field under the switch, which searches what the view holds (see [Find](#find)); emptying it, or `clear`, closes the search; Esc hands the keys back to Claude's prompt |
| `h` | In the dock: `archive ›`, the Archive page of this week's finished tasks (see [Archive](#archive)) |
| `p` | On the Archive page: the week before, while the pane holds it |
| `l` | On the Archive page: the week after, up to this week |
| `✕`, or `ctrl+x x` | Minimizes the pane to a one-row strip; it never closes |

A plugin cannot bind a key that works from anywhere. For one, add `"ctrl+x t": "command:teamrig-pane"` to
`~/.claude/keybindings.json` (the context it belongs under is unverified).

The banner, in the band above the prompt, leads with the session's name, then the task the session works on
(`acme-po · ◐ T595  Current-task banner`): its area's task in progress that took its status last, else its
first open task in plan order after a dim `next`. It follows the register
as the list does, whether the pane is open, minimized or never drawn. A click opens that task's description,
status, note, proof, priority and due under it; a second click closes it. Its `open in pane` button, at the band's
right end beside the `[-]`, opens the
pane, minimized or never opened too, at that task's page, with back to the list at its row. A survey takes the
band while it is up, and its `[-]` (or `ctrl+x ctrl+a`) folds it.

Minimized, the pane is the `[Tasks] [Changes n] [Log] [Inbox (n)] [Teams] [Meetings]` switch, then a dim `· minimized, press a view`
(on a row of its own, with no `·`, in a dock too narrow for both). A
click on any of its buttons, `t`, `d`, `g`, `u`, `e` or `j`, or `/teamrig-pane` opens it in full again. Its size (open or minimized) is kept for the next
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

Docked, a title line leads every view and page, so with panes open in several tabs a glance tells them apart:
the session as its tab title names it, bold: its team in brackets, then its name as teamrig messages it without the
team's prefix (`[acme] pane` for `acme-pane`, `[acme] team-lead`), ` (pinned)` after it for a pin. The area id is left
out. With no area it reads `[<team>] no session`. Docked, it heads the controls, which stay put while the body scrolls under them in a
window of its own, a scroll bar at its right while the body holds more than the window shows: the mouse wheel
scrolls it in every view, and Tab onto a row out of sight brings it into view. A dock too narrow for its buttons,
whose header would take over half its rows, scrolls as one. Above the prompt and in the minimized strip the pane
draws no title.

## The Tasks view

In a project teamrig is not set up for (no `.teamrig.json` up from the session's folder, no `$TEAMRIG_TEAM`, no
folder named), the pane shows how to set it up and nothing else, in every view: no Tasks / Changes / Log switch, no
Find row, no mine / all / archive (the minimized strip keeps its switch, and a press opens the setup):

```text
teamrig is not set up for this project
No .teamrig.json in <project> or a folder above it, and no team named by $TEAMRIG_TEAM.
Set up a team: ask Claude here, or run /teamrig:team-setup. It proposes the sessions, then makes the team and ties this project to it.
The pane looks again every few seconds and lists the tasks once a team is found.
```

With no team under the kit home, the step opens with installing teamrig: `Install teamrig if it is not (claude plugin
marketplace add GeneralA6/teamrig, then claude plugin install teamrig@teamrig), then set up a team: …`. The pane
looks again every 3 s and shows the team's tasks, with the switch, Find and the mode buttons, once it finds one, with
no restart. To help the user, ask what the team is for and run the team-setup skill only if they want a team. The pane
no longer lists two other ways, which still work when the user asks: join a team already made by writing
`{"team": "<id>"}` to `<project>/.teamrig.json`, or keep tasks outside teamrig by naming `tasksDir` and `inboxDir`
in `<kit home>/pane.json`.

The area is the teamrig session the pane shows as "mine". It comes from a pin (`/teamrig-pane <session>`), else from
the newest `teamrig inbox read --session <id>` run in this Claude Code session (teamrig records which Claude
Code session read). teamrig's prompt hook records the same when it binds a tab by its Claude Code title: a tab
renamed to a session's id or name (`/rename web`) binds at its next prompt, and the pane follows it. With none
of these, the Tasks and Inbox views list the team's sessions, the lead first, each a press that pins the tab to it
as `/teamrig-pane <session>` does:

```text
This tab is not tied to a session of team web yet. Press the one this tab is:
lead   api   etl   security
(or /teamrig-pane <session>)
```

With no team config the pane can read, it names the command alone: `This tab is not tied to a session yet:
/teamrig-pane <session> ties it to one.`

**mine** shows its status bar (below), then a header counting the area's active tasks, `3 active`, then its tasks
in sections, each in teamrig's plan order (priority, then the date it works to, undated last, then id: its own due,
or an earlier one of an active task that needs it) under a bold heading with its count; an empty section is left out:

1. `Verifying`: the change landed, its proof is still to come; these lead, because closing them comes first;
2. `Working on`: in progress;
3. `Up next`: open, not started;
4. `Waiting`: the area's own waiting tasks;
5. `Asked of others`: the active tasks it asked of other sessions, the first 8, each saying whose it is (`api's`);
   a dim line counts the rest, which `i` lists;
6. `Done today`: its tasks done or dropped today, the team's day, the newest 6, one dim line each with the time it
   closed. Past them a dim line says how many more, which `o` lists.

A heading's count is the status bar's count for its section, the tasks past a cap included; the bar's `waiting`
count is Waiting's and Asked of others' together.

The header names the area only for a pin (`web (pinned) · 3 active`); the session's own area goes unnamed, as the
title line above names the session. The area's unread inbox lines are counted on the switch's Inbox button (see
[The Inbox view](#the-inbox-view)).

**all** shows every owner's active tasks, grouped by owner: your own area first, highlighted and marked `(you)`
(`(pinned)` for the area a pin shows), then the others by name. Each heading has its counts
(`api · 4 active · 1 waiting · 1 verifying`, a count with none left out), and the verifying tasks come first
in each group.

A task is two lines, its title and a dim meta line under it:

```text
◐ T12  Build the signup endpoint
       p2 · due Sat 10-17 · in progress since 11:55 IDT
```

| Part | Meaning |
| --- | --- |
| `○` `◐` `◑` `■` `✓` `✗` | open, in-progress, verifying, waiting, done, dropped (as `teamrig list` names them) |
| `T12`, the title | The id, bold, and the title, cut at two lines; whole while its card is open |
| `p2` | Its priority; `p0`, teamrig's own level for work done right now, comes before every other |
| `bug`, `critical bug` | What the item is past a plain task (`teamrig add --type bug`, `--critical`); a task says nothing |
| `due Sat 10-17` | The date it works to: its own due, or an earlier one of an active task that needs it, which it names (`due Wed 10-14 (from T7)`); `verify by` while verifying |
| `in progress since 11:55 IDT` | Since when it stands at its status (a time today, else a day, on the team's clock); a verifying task's note follows, what will prove it |
| `waiting since 14:00 IDT: decision owner, on T5 ready; the copy first` | In red: what a waiting task waits for (a decision, an approval, a task or a time, as `teamrig list` words it), a cleared one `ready`, then its note. An old `blocked` line reads as waiting, with only its note |
| `after T5, T6` | A task not started: the tasks planned before it that are still unfinished |
| `needed by T7 (beta, due Thu 10-22) +1` | Whom it holds up, as `teamrig list` says it: the active task of another session that needs it and is due first, its owner and due (left out when the due already says `(from T7)`), and how many more |
| `api's` | In `Asked of others`: a task asked of another session, and whose it is |
| `late 1d` | Past its due, in red |
| `new` | The owner has not touched it yet |
| `not picked up 2d` | The owner has still not touched it 24 hours after it was assigned, in red |
| `asked by lead` | A task not started that another session asked for |

A task done today is one dim line, `✓ T11  Signup API`, the time it closed at the right edge. Other messages:
`Reading the register…` (the first moments, at most 3 seconds), `Nothing active.` (mine) and `No active tasks.` (all).
While the tasks it asked of others are all mine holds, the line says so:
`Nothing of yours is active. 1 task you asked of others is below.` (for a pin, `Nothing of web's is active. 2 tasks it
asked of others are below.`).

### The status bar

Over **mine**, one row as wide as the pane shares its cells among the tasks of its sections, a status for each, in
this order:

| Cells | Count | Tasks |
| --- | --- | --- |
| green `█` | `done today` | done or dropped today |
| green `▓` | `verifying` | shipped, its proof still to come |
| amber `█` | `working` | in progress |
| red `█` | `waiting` | its own, waiting on a decision, an approval, a task or a time, and those it asked of other sessions |
| dim `░` | `not started` | open |

Under it, a dim line counts them, each behind its key and the glyph its section's rows wear, in their color
(`o: ✓ 1 done today · v: ◑ 1 verifying · w: ◐ 2 working · i: ■ 1 waiting`), so the counts are the glyphs' legend,
leaving out a status with none; where the counts, keys included, are wider than the pane they wrap onto more lines.
Today is the team's day; tasks closed on an earlier day are left out. Each count is the one its section's heading
names (`waiting`, Waiting's and Asked of others' together). The cells are shared by largest
remainder, and a status with any task gets at least one. With none of these tasks there is no bar, and **all** has
none.

A click on a status's cells or its count, or its key (`o`, `v`, `w`, `i`, `n`), shows that status's tasks alone
under the header, every one its count names: today's done ones newest first, the others in plan order (the waiting
ones the area's own first); the other sections hide. Its cells and count turn bold, and the dim line under the
counts, `click a count to show only those` while every task shows, reads `showing verifying only, click again for
all`; either wraps by words onto more lines where the pane is narrower. The same
click or key again shows every task; another status switches to it. A shown status that empties keeps its count,
`0 waiting`, so it can still be cleared, and the list says `Nothing waiting.` (`Nothing done today.`, `Nothing
to verify.`, `Nothing in progress.`, `Nothing left to start.` for the others).

The filter belongs to the pane: it holds while you switch to **all** (which it does not filter) or to Changes or Log, and
is never kept across a reload: a new session, `/reload-plugins` or a restart shows every task again.

### A task's card

A press on a task (Enter, or a click) opens its card: the title shows whole and the card takes the meta line's
place; another press closes it, as the card's dim last line says, and `c` closes every card. A done-today row opens
the same card. The card shows
what teamrig recorded for the task, one labelled row per fact in a task tracker's words, each only when it has a
value:

```text
◐ T12  Build the signup endpoint
    │ Description  The signup endpoint, email first
    │ Status       in progress since 11:55 IDT by api
    │ Owner        api
    │ Lead         lead
    │ Priority     2
    │ Due          Sat 10-17
    │ Planned      this week
    │ After        T5 (done)
    │ Needed by    T14 (web, due Mon 10-19)
    │ Goal         G10.2 Accounts
    │ Origin       Asked and added by lead Tue 10-13
    │ Reference    inbox/api.md
    │ Evidence     abc1234
    │ Links        https://github.com/acme/app/pull/7
    │ press the title again to close
```

| Row | What it holds |
| --- | --- |
| `Description` | What the task is and why, as written with it (`teamrig add --description`, or the body of the GitHub issue it came from); for a task written before teamrig kept one, the ask quoted from where its `--ref` points (`file:N`, `file:N-M` up to 3 lines, or `file:N,M`) |
| `Status` | `not started`, `in progress`, `waiting`, `verifying`, `done` or `dropped`, since when, and who set it when that was the task's newest change; then why a waiting task waits, in red |
| `Note` | Its newest status note |
| `Proof` | What proves a verifying task (`teamrig set --proof`), in green |
| `Owner` | The session that owns it, on every card |
| `Lead` | The lead its owner answers to, from the team's config: the sub-lead that lists it, else the lead (for the lead's own tasks too); none when the pane read no team config |
| `Priority` | Its priority, a number |
| `Type` | `bug` or `critical bug`; none for a task |
| `Due` | The date it works to, `late 2d` in red once past it, a date taken from a task that needs it naming that task (`Wed 10-14 (from T7)`); `Verify by` while it is verifying |
| `Planned` | The week plan it is in, against the team's week: `this week`, `next week`, `week of Mon 10-26`, or `not in a week plan` |
| `After` | The tasks planned before it (`--after`), each with its status |
| `Needed by` | Each active task of another owner that needs it (planned after it, or waiting on it), with its owner and due, the one due first |
| `Goal` | The roadmap item of each of its `--goals` from the goals document (see [reference.md](reference.md#where-the-register-is)), else the bare id |
| `Origin` | Who asked, then who wrote it and when: `Asked by owner, added by lead Tue 10-13`; `Asked and added by lead 13:00 IDT` when one session did both; `GitHub issue #12, added by ...` for a task teamrig opened from one |
| `Reference` | Where its ask is written: each file by its folder and name (`inbox/po.md`), a click away from its page, other words as written |
| `Evidence` | Its evidence |
| `Links` | Up to 5 links: the GitHub issue a task teamrig opened from one came from (its ref `gh:<owner>/<repo>#<number>`), then each web address written in its description, ref, newest note, proof and evidence, once each |

There is no row for a parent, sub-tasks or history: the register keeps none of them for a task. A link never
splits; one wider than its line is shortened with `…` and still opens its whole address. Each task id the pane
holds, in any row, is underlined and opens that task's page; one inside a web address stays part of it.

A line is quoted only while something still ties it to the task (an inbox line by its date, another line when it
is a goal's roadmap item or names the task id), because boards and docs are rewritten and line numbers drift.

### A task's page

A click on a task id in a card opens that task's page: its title whole and its card, the body to itself, under
back and forward and a trail of the last places:

```text
‹ back  forward ›
Tasks › T50 › T58
────────────────────────────────────────────────

○ T58  Read the source
Description  Read the source nightly
Status       not started since Sat 10-10 by lead
Owner        etl
Lead         lead
Priority     3
Planned      this week
Goal         G10.2
Origin       Asked by owner, added by lead Sat 10-10
Reference    docs/x.md
```

| Part | What it does |
| --- | --- |
| `‹ back`, `forward ›` | Step through the places, as a browser's back and forward do (`b`, `f`); dim words when there is nowhere to go |
| The trail | The last 4 places: the one shown bold, those ahead of it dim, the others a click away; `…` where places were left out |
| A task id on the page | Opens that task's page next; a click from an older place drops the places ahead of it |

The pane keeps 20 places, the oldest dropped first. A page opens at its top and has no status bar. Back to the list
brings the card you left to the middle of the dock, and the list keeps back and forward while a page lies ahead of
it; `Tasks` (`t`), `mine` and `all` show the list alone. A task that closed over 8 days ago says so on its page. Above
the prompt ids are plain words and no page shows.

### A reference file's page

A click on a file in a card's `Reference` row opens that file's page, under the same back, forward and trail: its
folder and name, where it was read, then its text as plain lines, read whole as the page opens:

```text
‹ back  forward ›
Tasks › T58 › t26-findings.md
────────────────────────────────────────────────

api/t26-findings.md
C:/kit/teams/web/notes/api/t26-findings.md · line 6
```

A ref that names a line (`board.md:6`) opens the page at that line, drawn bold. Tabs draw as two spaces and a wrapped
line keeps its indent. The pane looks for the file where it looks for the lines a card quotes: an inbox in the inbox
folder, `~/` under the home folder, a relative path in the session's folder and each folder above it, then in the
team's folder. A file it does not find lists each path it looked at; one over 256 KiB, or not text, says why it is
not shown. The page shows the file as it was when the page opened: open it again from the card for a newer one.

### Find

In the Tasks view, the Inbox view, the Changes view, over the Log view's list and on the Teams tab (see
[The Changes view](#the-changes-view), [The Log view](#the-log-view), [The Inbox view](#the-inbox-view) and
[The Teams tab](#the-teams-tab)), the dock shows a Find field under its switch. `s` or a click puts the cursor in it; it
never takes the keys by itself, so the pane's other keys keep working. As you type, the body counts the tasks
the pane holds that every word matches, on a dim line, then lists them, the matched words underlined:

```text
2 tasks match

○ T50  Load the feed
       etl's

○ T58  Read the source
       etl's
```

| Part | What it does |
| --- | --- |
| A word | Matches, case aside, a task's id (`T52` or `52`) or the start of a word in its title, owner, who asked, goals, week, note, evidence or ref; one that starts with a mark (`.md`) matches anywhere |
| An active result | Its title row, then a dim line of whose it is and the other fields a word matched in, each named (`etl's · note: …tests pass…`) |
| A finished result | One dim line with when it closed |
| A click on a result | Opens its page; `‹ back` (`b`) returns to the results |
| Enter | With one match, opens its page and moves the cursor onto its `‹ back`, so `b`, `f` and `s` work there; with more, moves the cursor onto the first result |
| Enter on a result | Opens its page; ↑↓ move to the next or the one before |
| `clear` (shown while searching), or an empty field | Closes the search and shows the place before it; `clear` keeps the cursor in the field |

The pane searches what it holds: every area's active tasks and those finished in the last 8 days, never older ones. The
active matches come in plan order, then the finished ones, newest first. The dim line over them counts every match
(`2 tasks match`, `1 task matches`); at most 30 show, and past that the line says so (`34 tasks match, 30 shown: add
a word to narrow them`). When nothing matches, one dim line says so. The trail names a search by its words
(`Search "etl the"`). Esc hands the keys back to the prompt and leaves the results drawn. Above the prompt no page
shows, so there is no search.

A line under the field says where your keys go now:

| The line | Where the keys go |
| --- | --- |
| `Typing searches · Enter: open · Esc: to Claude` (bold) | Into the field, with one match or none: each key changes the search |
| `Typing searches · Enter: to the results · Esc: to Claude` (bold) | Into the field, with more matches; Enter moves the cursor onto the first result |
| `On a result · Enter: open · ↑↓: move · s: search · Esc: to Claude` | On a result of the search; `s` moves the keys back into the field |
| `Keys on the pane · s: search · Esc: to Claude` | To the pane's keys; `s` moves them into the field |
| `Keys go to Claude · click the field to search` | To Claude's prompt; a click on the field gives them back to it, the query kept |

The keys go to Claude's prompt on Esc, a click outside the pane, a Claude dialog, or a key the pane does not use
pressed while the cursor is on one of its buttons.

### Archive

`archive ›` (`h`), in the dock's mode row after mine and all and a dim `·`, opens the Archive page on this week (a week starts Monday 00:00
on the team's clock and is named by that Monday, as the register's week fields are): the view's tasks closed done or dropped, a day at a time, newest first, each
on one dim line with when it closed:

```text
‹ back  forward ›
Tasks › Archive 10-12
────────────────────────────────────────────────

‹ prev  week of Mon 10-12  next ›

Archive · po · 1 done · 0 dropped

Tue 10-13

✓ T7  Fix the loader                   12:00 IDT
```

| Part | What it does |
| --- | --- |
| `‹ prev` (`p`), `next ›` (`l`) | The week before and the week after, dim where the pane holds none; a step changes the week in place, so `‹ back` returns to where the page was opened from |
| `Archive · po · 1 done · 0 dropped` | Whose tasks (in mine the area's, every owner's when the session has none; in all every owner's) and how many closed done and dropped that week |
| A day | A dim line, `Tue 10-13`, then the tasks closed that day, newest first |
| A task | `✓` done or `✗` dropped, its id and title, when it closed (in all, its owner too); a click opens its page, and back returns to the week |
| `3 more this week: search finds them` | Past 50 rows, the rest counted |
| `The pane holds tasks finished since Mon 10-05 14:00 IDT; teamrig list --status done,dropped lists older ones.` | Ends the oldest week the pane holds |

The pane holds the tasks finished in the last 8 days, the days teamrig's own rotation keeps finished tasks in its
working set, so the Archive page reaches back to the week those days start in, never further; `teamrig list --status
done,dropped` reads the register's whole history. A week with none says `Nothing finished this week.` The trail names
the page by its week (`Done 10-12`). Above the prompt no page shows, so there is no Archive page.

## The Changes view

`[Tasks] [Changes 3]` sits under the title line in every state, and is the whole minimized strip. Changes lists the files changed in each git repo the
session works in: the repo of the session's folder and the repo of each file it or one of its agents writes
(Edit, Write, NotebookEdit; a file a shell command changes adds no repo). Until one is found, the view says
`No git repo yet` and why. A worktree is its own repo; once its folder is removed it leaves the view. Each repo has a header
(`<folder> · branch <branch> · 3 files`, `1 file` or `clean`; `no branch` while detached; the branch is left out
when the folder bears its name, as a worktree's often does), the first repo with a diff to open led by a dim
`click a file for its diff`. Each file's row says in words what git's two-letter code means: `changed`, `added`,
`deleted`, `renamed`, `copied` (green when staged, yellow when in the work tree alone), `new` (dim, not in git yet)
or `conflict` (red); then its path from the repo root, its lines added and removed (`+12 -3`; `+0 -0` for none,
`binary` for a binary file; an untracked folder sums its files), a rename's source (`← old.ts`) and, dim,
`(staged)`, `(staged, changed since)` or `(not in git yet)`. Files written outside any repo come last.

A click on a file's row, or Enter on it, opens its diff under it and a second one closes it: each hunk's `@@` line
dim, `+` lines green, `-` lines red, the lines around them plain. It is git's diff of the file against the last
commit (its staged and unstaged edits, as the row counts them; an untracked file's every line added), the first 200
lines shown and the rest counted, each line cut at 3 screen lines. An open diff follows the file's edits and closes
when the file leaves the list; an untracked folder opens none.

The Find field (`s`) in the dock searches the listed files: each word matches the start of a word in a file's path, the
path it was renamed from, or its repo's folder name or branch. The body counts the matches (`2 files match`) and draws
each as its row does, over its repo and branch, the matched words underlined; a press on one opens its diff under it.
Enter with one match opens its diff, with more moves the cursor onto the first match that has a diff; switching views
closes the search.

The number after Changes counts the listed files, on the button (`Changes 3`) and in the pane's tab title
(`Tasks · 3 changed`, shown while more than one pane is open). The view cannot open Claude Code's own `/diff` pane:
the diff under a file is the pane's own.

Each repo costs one `git --no-optional-locks status --porcelain=v1 -b -z` (it takes no index lock, so it never
blocks a commit), and while it has changed files one `git diff HEAD --numstat -z` and up to two
`git grep --untracked -c` runs to count their lines: on the next 3 second poll after a write or a Bash or
PowerShell call, every 60 seconds, and at once on a switch to Changes; each open diff is one more `git diff` then.
A count git can't give is left out, with no warning, and git never runs in a folder that is gone.

## The Log view

`g`, or Log on the switch, lists each conversation of the team's sessions that wrote a prompt or a reply in the hours
teamrig keeps their turn log (the team config's `turnLog.keepHours`, 24 by default), the one with the newest line first.
A conversation is what one session said from a `/clear` to its next one; a compaction keeps it. Each is titled by the
tasks its session worked while it ran (a task it owns whose status or details it changed, from the register), each
id bold before its title, else by how it opened (the owner's first words, else Claude's first reply, dim) in two lines
at most; under the title, its session, the times of its first and last lines and its count of lines. It reads the turn
log teamrig writes for every session of the team (`<team state>/turn-log/<session>/<UTC hour>.jsonl`), so a `/clear`
or a compaction never takes away what a tab showed. With no team, a team with no config file (teamrig writes no turn
log for one), no turn log yet (teamrig writes none while the team's `turnLog.enabled` is off) or a folder it cannot
read, the view says which.

The Find field (`s`) over the list searches its conversations: each word matches the start of a word in a
conversation's title as the list draws it (a task's id among them) or in its session's name. The body counts the
matches (`1 conversation matches`) and draws them as the list does, the matched words underlined. Enter with one match
opens its page, with more moves the cursor onto the first; back from the page returns to the results. A page draws no
field; switching views closes the search.

A press on a conversation (a click, or Enter on it) opens its page under `back` (`b`) and the trail `Log › <title>`: its title, then its lines oldest
first, the newest at the end where the page opens. Each prompt and reply is split by who spoke, each part a head line over its words:
`owner · 20:05 IDT` (the words typed at the tab), `Claude` (a reply), `message from <session>` and `subagent report`.
The harness's notices and reminders in a prompt are dim lines led by their time, without their tags and ids, and
markdown is drawn as styles (bold, code, links, headings, items, quotes, code blocks, rules, tables), never as its
marks. A `/clear` is a dim rule. teamrig keeps a text's last 64,000 characters, and a cut one says `cut, its end kept`. The page holds the newest
256 KiB of text and says when it left older lines out. Log, from a page or another view, shows the list; above the
prompt the list shows, never a page.

While the view shows, it lists the session folders on each 3 second poll and reads an hour's file again only when
its size or time moved; on another view, or minimized, it reads nothing.

## The Inbox view

`u`, or Inbox on the switch, shows this session's own inbox (a pin's area when pinned): the lines of the last 24 hours,
read ones too, and every unread one whatever its age, the newest first, under a dim count:

```text
2 unread · 1 read in the last 24 hours

● lead · 13:00 IDT
  ship the Inbox view

● qa · Mon 10-12 18:00 IDT
  the checks pass

  docs · 10:00 IDT
  the docs are merged
```

Each line gives its sender, bold, and when it was posted on the team's clock, over its words drawn whole; `●` marks an
unread one. A line without teamrig's stamp is left out. The switch's button counts the unread lines, `Inbox (2)`, and
reads `Inbox` with none; an area that never ran `teamrig inbox read` marks none unread. Reading the view marks nothing
read: the session's `teamrig inbox read` does.

The Find field (`s`) searches the lines shown: each word matches the start of a word in a line's sender or words. The
body counts the matches (`1 line matches`) and draws them with the matched words underlined. A line has nothing to
open, so Enter leaves the results as they are; switching views closes the search.

## The Teams tab

`e`, or Teams on the switch, shows the tree of teams the session's team is in, from the top team down. Each team's row
counts its active and retired sessions. Under it are its lead, each leader over the sessions it leads (the config's
`leads`), the retired sessions in a group of their own, and its child teams (`team.parent`). A session's row gives its
id (bold), its current name where it differs, then, dim: how many sessions it leads (`(2)`), its roles, and its hire and
review day or its retire day; then how many of its cards wait on the owner (the config's `register.ownerSource`) now,
`? 2 decisions`, with a `[Meet]` press, and when the next card the owner put off comes back (`later Mon 11-02`, dim).
A retired session is a dim `○`. A press on a team's or retired group's row (a click,
Enter or Space) closes it or opens it again; on a session's row it opens or closes its card. A leader's row has two
presses: its mark folds the sessions it leads, its id opens its card. Teams and leaders start open, a retired group
closed, and the state stays across a hot reload. There are no ← and → keys: the engine binds keys only to buttons. With
no team, no config teamrig can read, or a folder it cannot read, the view says which.

`[Meet]` runs `teamrig meet <session>`: teamrig wakes a running session with an inbox line asking it to bring the owner
its cards now, or opens it in a new tab to do so, and refuses one with no card waiting on the owner. What teamrig
answered leads the tab: `Asking web for its cards…`, then `Asked web for its cards:` with teamrig's lines, or
`web was not asked:` and why. One meet runs at a time, given 60 seconds. Docked, a row with a `[Meet]` holds two
presses, its id opening its card; inline, the row opens the card. The switch's Teams button counts the cards waiting on
the owner now across the team, `Teams (2)`; a card put off counts again once it comes back.

A card lists, each only when known: Role (its roles, and `leads 2 sessions`), Led by, Launch (model and effort), Hired or Rehired (day, by whom, review day),
Scope, Reason, Now (its tasks in progress, each id opening its page), Decisions (its cards waiting on the owner now),
Later (those the owner put off, soonest back first, with when each comes back), each id opening its page, and Inbox
(unread lines, opening its inbox, the pane's own in the Inbox view); a retired session's card gives its retire: day, by
whom, why, Heir and Handover (a press opens it). Now, Decisions, Later, Inbox and the counts of cards on the owner show
for the pane's own team only. A page a card opens shows in the Tasks view; back shows the tasks list.

The Find field (`s`) searches the tree: each word matches the start of a word in a session's id, name,
roles or hire scope, retired ones too. The body counts the matches and draws each under its team and leaders; a press
opens or closes its card, and Enter with one match opens it. Switching to Tasks closes the search, as Teams does a Tasks
search. Cleared, the tree draws as before: a match under a closed row stays hidden there.

It reads each team folder's config, rename log and hire log (`~/.teamrig/teams/<team>`) with teamrig's own readers.
While the view shows, it reads a file again on a 3 second poll only when its size or time moved; on another view, or
minimized, it reads nothing.

## The Meetings view

`j`, or Meetings on the switch, lists the meetings booked for the session's team, the scheduled and started ones, by
time. A ruled header counts them and the missed ones (`3 meetings · 1 missed`). A meeting's row gives its mark, its id,
when it starts on the team's clock, its length, and the session met with those joining; under it, dim, what it is about
and the tasks it settles:

    › M3  Tue 10-13 15:00 IDT · 30 min · web with lead · next
          the pricing tiers · T1

| Mark | Meaning |
| --- | --- |
| `›`, `next` | the first scheduled meeting not missed; `now` once its time came |
| `○` | one more scheduled meeting |
| `!`, a red `missed` | a scheduled meeting whose slot ended with no start |
| `◐`, `started` | a started meeting |

A press on a row (a click, Enter or Space) opens its card in place of the dim line, and again closes it: About, With,
Tasks (each with its title and status; an id the register holds opens its page), Brief (a press opens the file) and,
on a scheduled meeting, `[Start meeting]`. That press runs `teamrig meeting start <id>` as the session
(`$TEAMRIG_SESSION`, else the area the pane shows), as typing it would. What teamrig answered leads the list:
`Starting M3…`, then `Started M3.` with teamrig's lines (`TOLD lead`), or `M3 did not start:` and why. One start runs
at a time.

The view runs the CLI of the teamrig plugin installed in Claude Code, with `node`: `teamrig meeting list --json` when
the view opens and every 60 seconds while it shows; on another view, or minimized, it runs nothing. With no teamrig
plugin, one older than 0.208.0, or a list that fails, it says why
([reference.md](reference.md#warn-lines-and-their-fixes)). It has no Find field: a schedule is a few rows.

## How it relates to the teamrig CLI

The pane never writes, but for the Meetings view's `[Start meeting]`, which runs `teamrig meeting start`, and the Teams
tab's `[Meet]`, which runs `teamrig meet`. To change
what it shows, run teamrig (see the
[teamrig guide](https://github.com/GeneralA6/teamrig/blob/main/plugins/teamrig/skills/teamrig-guide/commands.md)):

| To | Run |
| --- | --- |
| bind the pane to your area and clear the unread count | `teamrig inbox read --session <you>` |
| bind a tab you opened yourself, marking nothing read | `/rename <you>`, then send a prompt |
| start, block or finish a task | `teamrig set T12 --status in-progress --session <you>` |
| ask another session for work (shows in `asked of others`) | `teamrig add --owner <session> --title "..." --priority p2 --session <you>` |
| give a task details to quote | `teamrig update T12 --ref "docs/spec.md:40-42" --session <you>` |
| book a meeting (shows in Meetings) | `teamrig meeting schedule --meets <session> --at <time> --about "..." --session <you>` |

The pane reads the register with teamrig's own read modules, copied into the plugin at a pinned teamrig commit,
and a golden test holds its rows to what `teamrig list` prints. Besides the Meetings view and `[Meet]`, which run teamrig's CLI, it
reads files only: a stat every 3 seconds
re-reads a file when its size or time moved, and a 60 second tick moves the due and age labels on. Its state
(the size, a pin) lives in the plugin's own store, never in the register.
