---
name: teamrig-pane-guide
description: Use when running the teamrig task pane, or to learn what it shows, its /teamrig-pane command, keys, Changes, Conversations, Inbox, Teams, Meetings, Stats views, where it finds the register, requirements.
---

# teamrig-pane guide

teamrig-pane is a Claude Code plugin that shows a session's teamrig tasks, and the files it changed in git,
beside the conversation. It only reads: the [teamrig](https://github.com/GeneralA6/teamrig) CLI writes the task
register and the inboxes, and the pane draws what is there. Two places run teamrig's CLI instead: the Meetings view, to
list the team's meetings and to start one, and the Teams tab's `[Meet]`, to have a session bring the owner its cards,
and `[Wake]`, to wake a session by hand.
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
| teamrig | a team with a register; for the Meetings view, the teamrig plugin 0.208.0 or later installed in Claude Code, for the Teams tab's `[Meet]`, 0.209.0 or later, and for its `[Wake]`, 0.319.0 or later | The pane shows the register teamrig writes. Without one it shows a `WARN` line ([reference.md](reference.md#warn-lines-and-their-fixes)). The Meetings view, `[Meet]` and `[Wake]` run the CLI of the teamrig plugin it finds in Claude Code's plugin list. |
| git | on the PATH | Only for the Changes tab, which runs `git status` per repo, `git diff` and `git grep` to count the changed lines, and `git diff` for each file's diff you open. Without it the pane draws a `WARN` line with the fix. |
| Node.js | `node` on the PATH for the Meetings view, `[Meet]` and `[Wake]`, as teamrig needs; 22.18 or later to develop it | The pane runs inside Claude Code; the Meetings view, `[Meet]` and `[Wake]` run teamrig's CLI with `node`. The repository's tools and tests run on Node (`engines` in `package.json`). |
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
| `g` | The Conversations view: each conversation of the team's sessions, titled by its task (see [The Conversations view](#the-conversations-view)) |
| `u` | The Inbox view: this session's inbox lines of the last 24 hours and every unread one (see [The Inbox view](#the-inbox-view)) |
| `e` | The Teams tab: the tree of teams the session's team is in, each lead over the sessions it leads (see [The Teams tab](#the-teams-tab)) |
| `j` | The Meetings view: the team's booked meetings by time, each a press that opens its card, where a scheduled one starts (see [The Meetings view](#the-meetings-view)) |
| `r` | The Stats tab: the tree's registers folded into Health tiles and the flow of work, for the scope and range it picks (see [The Stats tab](#the-stats-tab)) |
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
| Enter on a Tasks view heading, or a click on it | Folds its tasks away, `▸` leading the heading; again shows them |
| A click on a task id in a card | Opens that task's page (see [A task's page](#a-tasks-page)) |
| A click on a card's `[Note]` or `[Next]`, or Enter on it | In the dock: the owner's Note to the task's session, or its Next after a confirm (see [Note and Next](#note-and-next)) |
| A click on a file in a card's `Reference` row | Opens that file's page, at the line its ref names (see [A reference file's page](#a-reference-files-page)) |
| A click on the banner above the prompt | Opens the current task's card under its title; again closes it |
| A click on the banner's `open in pane` | Opens the pane, minimized or never opened too, at the current task's page; back shows the list at its row |
| A click on the previous conversation's title, over the banner | Opens its tasks' whole titles, when it ran and how it opened under it; again closes them |
| A click on the previous conversation's `open in pane`, over the banner | Opens the pane at that conversation's page in the Conversations view |
| A click on `all conversations`, over the banner | Opens the pane at the Conversations list |
| `b` | On a page: back to the place before it; on the list, shown only while a page lies ahead; on a conversation's page, back to the list; on a Stats list of tasks, back to the numbers |
| `f` | Forward to the place back left, while there is one |
| `s` | In the dock's Tasks, Inbox, Changes and Teams views and on the Conversations list: puts the cursor in the Find field under the switch, which searches what the view holds (see [Find](#find)); emptying it, or `clear`, closes the search; Esc hands the keys back to Claude's prompt |
| `h` | In the dock: `done ›`, the Done page of this week's finished tasks (see [Done](#done)) |
| `p` | On the Done page: the week before, while the pane holds it |
| `l` | On the Done page: the week after, up to this week |
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

Over the banner, a row in a dim round frame names the area's previous conversation, so after a `/clear` the band
says what came before: a dim `previous ·`, then its title as the Conversations list draws it, cut at one line, with
`open in pane` (its page) and `all conversations` (the list). A click on its title opens each task it worked with
its whole title, when it ran with its count of lines, and how it opened; a second click closes them. It is the area's newest conversation in the kept hours of the turn log
other than the one running now, read again only when the session's conversation changes. With none to name, no
turn log or a session with no area, the band is the banner alone.

Minimized, the pane is the `[Tasks] [Changes n] [Conversations] [Inbox (n)] [Teams] [Meetings] [Stats]` switch, then a dim `· minimized, press a view`
(on a row of its own, with no `·`, in a dock too narrow for both). A
click on any of its buttons, `t`, `d`, `g`, `u`, `e`, `j` or `r`, or `/teamrig-pane` opens it in full again. Its size (open or minimized) is kept for the next
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
folder named), the pane shows how to set it up and nothing else, in every view: no Tasks / Changes / Conversations switch, no
Find row, no mine / all / done (the minimized strip keeps its switch, and a press opens the setup):

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
in sections, each in teamrig's plan order (the pinned task, then band, then score, the highest first, then a started
task, then the date it works to, undated last: its own due, or an earlier one of an active task that needs it) under a
bold heading with its count; an empty section is left out:

1. `Verifying`: the change landed, its proof is still to come; these lead, because closing them comes first;
2. `Working on`: in progress;
3. `Up next`: open, not started;
4. `Waiting`: the area's own waiting tasks;
5. `Asked of others`: the active tasks it asked of other sessions, the first 8, each saying whose it is (`api's`);
   a dim line counts the rest, which `i` lists;
6. `Done today`: its tasks done or dropped today, the team's day, the newest 6, one dim line each with the time it
   closed. Past them a dim line says how many more, which `o` lists.

A heading's count is the status bar's count for its section, the tasks past a cap included; the bar's `waiting`
count is Waiting's and Asked of others' together. A parked task (teamrig's park rule: open, classed past Roadmap and
Maintenance, quiet for `focus.parkAfterDays`) is left out of the sections, their counts, the bar and **all**, as
`teamrig list` leaves it out; a search still finds it. The plan order and the park rule read the tasks the team
tree's other registers hold, as teamrig does: a task after another team's open task waits behind those that can
move, and one another team's active task needs is never parked.

The header names the area only for a pin (`web (pinned) · 3 active`); the session's own area goes unnamed, as the
title line above names the session. The area's unread inbox lines are counted on the switch's Inbox button (see
[The Inbox view](#the-inbox-view)).

**all** shows every owner's active tasks, grouped by owner: your own area first, highlighted and marked `(you)`
(`(pinned)` for the area a pin shows), then the others by name. Each heading has its counts
(`api · 4 active · 1 waiting · 1 verifying`, a count with none left out), and the verifying tasks come first
in each group.

A press on a heading (a click, Enter or Space), a section's in mine or an owner's in all, folds its tasks away, the
dim line counting the rest too, and leaves the heading alone with `▸` before it (`▸ Done today (8)`); a second press
shows them again. Each heading folds by itself, the folds stay across a switch between mine and all and across a hot
reload, and a status bar filter lists its status's tasks whether its section is folded or not.

A task is two lines, its title and a dim meta line under it:

```text
◐ T12  Build the signup endpoint
       Roadmap · score 6.67 · p2 · due Sat 10-17 · in progress since 11:55 IDT
```

| Part | Meaning |
| --- | --- |
| `○` `◐` `◑` `■` `✓` `✗` | open, in-progress, verifying, waiting, done, dropped (as `teamrig list` names them) |
| `T12`, the title | The id, bold, and the title, cut at two lines; whole while its card is open |
| `Roadmap`, `Maintenance`, `Improvements` | Its work class, as `teamrig list` prints it; a finished task keeps it |
| `score 6.67` | Its score in plan order, as `teamrig list` prints it; none on a finished task, which holds no place in the order. A Roadmap task scores by the rank of the goal it serves, read from the team's goals and those of the teams above, as `teamrig list` reads them. A task's size is what `teamrig list` sizes it by: its own size, else the median of like tasks, less what it spent this week, read from the team's `usage/tasks.week.json` |
| `p2` | Its priority; `p0`, teamrig's own level for work done right now, goes ahead of every score |
| `pinned` | The one task a leader above its owner pinned (`teamrig update --pin`), which tops the owner's list |
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

The filter belongs to the pane: it holds while you switch to **all** (which it does not filter) or to Changes or Conversations, and
is never kept across a reload: a new session, `/reload-plugins` or a restart shows every task again.

### A task's card

A press on a task (Enter, or a click) opens its card: the title shows whole and the card takes the meta line's
place; another press on the title closes it, and `c` closes every card. A done-today row opens the same card. The
card shows
what teamrig recorded for the task, one labelled row per fact in a task tracker's words, each only when it has a
value:

```text
◐ T12  Build the signup endpoint
    │ Description  The signup endpoint, email first
    │ Status       in progress since 11:55 IDT by api
    │ Owner        api
    │ Lead         lead
    │ Priority     2
    │ Class        Roadmap
    │ Score        6.67
    │ Due          Sat 10-17
    │ Planned      this week
    │ After        T5 (done)
    │ Needed by    T14 (web, due Mon 10-19)
    │ Goal         G10.2 Accounts
    │ Origin       Asked and added by lead Tue 10-13
    │ Reference    inbox/api.md
    │ Evidence     abc1234
    │ Links        https://github.com/acme/app/pull/7
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
| `Class` | Its work class: `Roadmap`, `Maintenance` or `Improvements` |
| `Score` | Its score in plan order; none on a finished task |
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

#### Note and Next

In the dock, with a team to run them through, a card ends in the owner's acts: `[Note]`, and `[Next]` on a task not
in progress yet; a task done or dropped has none, and none show above the prompt. They run the teamrig CLI the
Meetings view runs, and teamrig writes what they change:

| Press | What it does |
| --- | --- |
| `[Note]` | Opens an empty field under the card, the cursor in it, over `[Send]` and `[Cancel]`. Enter or `[Send]` runs `teamrig owner note <task> --text "<what you typed>"`, which keeps the Note in the task's history and sends it to the task's session; an empty field sends nothing |
| `[Next]` | Runs `teamrig owner next <task> --preview`, which writes nothing, and shows what it would do over `[Confirm]` and `[Cancel]`, the cursor on `[Cancel]`. `[Confirm]` runs `teamrig owner next <task>`: the task goes atop its session's list, the session is woken and the lead told |
| `[Cancel]` | Closes the field or the confirm, the cursor back on the press that opened it |

Esc in the Note field only hands the keys back to Claude's prompt, the field staying open (Claude Code tells the
pane nothing of it): `[Cancel]` closes it. While the field is open the list holds still as it stood when the field
opened, so a task added above the card cannot move the cursor out of the field; it catches up once the field closes.
teamrig's answer shows over the presses, its lines as printed: green when it was done, red with why when refused. One
act runs at a time, and a press while one runs does nothing.

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
Class        Improvements
Score        3.33
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

In the Tasks view, the Inbox view, the Changes view, over the Conversations list and on the Teams tab (see
[The Changes view](#the-changes-view), [The Conversations view](#the-conversations-view), [The Inbox view](#the-inbox-view) and
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

### Done

`done ›` (`h`), in the dock's mode row after mine and all and a dim `·`, opens the Done page on this week (the team's
planning week, starting on the weekday of the plan in force, Monday with no plan, at 00:00 on the team's clock): the
view's tasks closed done or dropped, each day a heading that folds, newest first, and under an open day its groups:

```text
‹ back  forward ›
Tasks › Done 10-13
────────────────────────────────────────────────

‹ prev  week of Tue 10-13  next ›

Done · po · 8 done · 1 dropped

▾ Today so far · Tue 10-13 · 6 done
  Owner asked (5)
    ✓ T7  Fix the loader               12:00 IDT
    ✓ T8  Feed the pages               12:40 IDT
    ✓ T9  Trim the log                 13:05 IDT
    ✓ T11  Name the rows              13:30 IDT
    ▸ 1 more
  ▸ Other work (1)
▸ Mon 10-12 · 2 done · 1 owner asked · 1 dropped
```

| Part | What it does |
| --- | --- |
| `‹ prev` (`p`), `next ›` (`l`) | The week before and the week after, dim where the pane holds none; a step changes the week in place, so `‹ back` returns to where the page was opened from |
| `Done · po · 8 done · 1 dropped` | Whose tasks (in mine the area's, every owner's when the session has none; in all every owner's) and how many closed done and dropped that week |
| A day | A heading a press opens or closes: the newest starts open, `▾ Today so far` leading today; a closed day counts what it holds (done, then owner asked, for a goal, urgent and dropped where not zero) |
| A group | `Owner asked (5)`, a goal's tag, `Urgent p1`, `This week's plan`, `Other work`, then `Dropped`, in that order, each task in one group: a press folds it; Other work and Dropped start closed |
| `▸ 1 more` | Past 4 rows a group counts the rest; a press opens them in place |
| A task | `✓` done or `✗` dropped, its id and title, when it closed (in all, its owner too); a click opens its page, and back returns to the week |
| `The pane holds tasks finished since Mon 10-05 14:00 IDT; teamrig list --status done,dropped lists older ones.` | Ends the oldest week the pane holds |

The pane holds the tasks finished in the last 8 days, the days teamrig's own rotation keeps finished tasks in its
working set, so the Done page reaches back to the week those days start in, never further; `teamrig list --status
done,dropped` reads the register's whole history. A week with none says `Nothing finished this week.` The trail names
the page by its week (`Done 10-13`). Above the prompt no page shows, so there is no Done page.

## The Changes view

`[Tasks] [Changes 3]` sits under the title line in every state, and is the whole minimized strip. Changes lists the files changed in each git repo the
session works in: the repo of the session's folder and the repo of each file it or one of its agents writes
(Edit, Write, NotebookEdit; a file a shell command changes adds no repo). Until one is found, the view says
`No git repo yet` and why. A worktree is its own repo; once its folder is removed it leaves the view. Each repo has a header
(`<folder> · branch <branch> · 3 files`, `1 file` or `clean`; `no branch` while detached; the branch is left out
when the folder bears its name, as a worktree's often does), the first repo with a diff to open led by a dim
`click a file for its diff` (the files written outside git, when no repo has one). Each file's row says in words what git's two-letter code means: `changed`, `added`,
`deleted`, `renamed`, `copied` (green when staged, yellow when in the work tree alone), `new` (dim, not in git yet)
or `conflict` (red); then its path from the repo root, its lines added and removed (`+12 -3`; `+0 -0` for none,
`binary` for a binary file; an untracked folder sums its files), a rename's source (`← old.ts`) and, dim,
`(staged)`, `(staged, changed since)` or `(not in git yet)`. Files written outside any repo come last.

A click on a file's row, or Enter on it, opens its diff under it and a second one closes it: each hunk's `@@` line
dim, `+` lines green, `-` lines red, the lines around them plain. It is git's diff of the file against the last
commit (its staged and unstaged edits, as the row counts them; an untracked file's every line added), the first 200
lines shown and the rest counted, each line cut at 3 screen lines. An open diff follows the file's edits and closes
when the file leaves the list; an untracked folder opens none. A file written outside any repo opens its diff the
same way, against a copy the pane kept just before the session first wrote it (a new file's every line added); a file
over 64 KiB or not text shows a note, and one written before the pane kept a copy says so.

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
PowerShell call, every 60 seconds, and at once on a switch to Changes; each open diff of a repo's file is one more `git diff` then.
A count git can't give is left out, with no warning, and git never runs in a folder that is gone.

## The Conversations view

`g`, or Conversations on the switch, lists each conversation of the team's sessions that wrote a prompt or a reply in the hours
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

A press on a conversation (a click, or Enter on it) opens its page under `back` (`b`) and the trail `Conversations › <title>`: its title, then its lines oldest
first, the newest at the end where the page opens. Each prompt and reply is split by who spoke, each part a head line over its words:
`owner · 20:05 IDT` (the words typed at the tab), `Claude` (a reply), `message from <session>` and `subagent report`.
The harness's notices and reminders in a prompt are dim lines led by their time, without their tags and ids, and
markdown is drawn as styles (bold, code, links, headings, items, quotes, code blocks, rules, tables), never as its
marks. A `/clear` is a dim rule. teamrig keeps a text's last 64,000 characters, and a cut one says `cut, its end kept`. The page holds the newest
256 KiB of text and says when it left older lines out. Conversations, from a page or another view, shows the list; above the
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
counts its active and retired sessions, then gives its week with its child teams' (`week ███████░░░ 35% of 52%`): ten
cells for the part of the account's week planned for it, filled as far as it used it, green up to how far the week has
gone, amber past that (ahead of plan); behind its plan, a dim `│` marks how far the week has gone (`████░│░░░░`). The
percents are its used and planned parts of the account's week. A team planned no part of the week draws an empty bar
until it uses some, then an amber one; one with no week file for the running week draws no week. A team's week adds a
child team's only on one account and one reset: a child team on another keeps its week on its own row. Under it are its lead, each leader over the sessions it leads (the config's
`leads`), the retired sessions in a group of their own, and its child teams (`team.parent`). A session's row gives its
current name (bold), how many sessions it leads (`(2)`, dim), its roles, each in a colour of
its own (lead, `sub-lead` for a leader that is not the lead, delivery owner, security reviewer); then how many of its
cards wait on the owner (the config's `register.ownerSource`) now, `? 2 decisions`, with a `[Meet]` press, and when the
next card the owner put off comes back (`later Mon 11-02`, dim), then a `[Wake]` press on an active session's row. Its
hire, review and retire days are on its card. The
row of the session whose pane it is starts with a green `▶`. A retired session is a dim `○`. Docked, a row's presses
sit on its words: a press on a team's mark or name, or on a retired group's row (a click, Enter or Space), closes it or
opens it again; on a session's name it opens or closes its card; on a leader's mark it folds the sessions it leads.
Inline, where a row is one press, the row does the first of these. Each team's and session's row ends in `[Stats]`,
which opens the Stats tab on that team (its child teams rolled in) or that session (the tasks it owns); `b` then goes
back to the Teams tab at that row. Inline `[Stats]` is words only, as `[Meet]` and `[Wake]` are. Teams and leaders start open, a
retired group closed, and the state stays across a hot reload. There are no ← and → keys: the engine binds keys only to buttons. With
no team, no config teamrig can read, or a failed read of the team folder list, or of its own team's folder before one
worked, the view says which. Any other team folder it cannot read gets a `WARN team <id> could not be read: …` line
above the tree, and that team draws as last read, or is left out until a read of it works.

`[Meet]` runs `teamrig meet <session>`: teamrig wakes a running session with an inbox line asking it to bring the owner
its cards now, or opens it in a new tab to do so, and refuses one with no card waiting on the owner. What teamrig
answered leads the tab: `Asking web for its cards…`, then `Asked web for its cards:` with teamrig's lines, or
`web was not asked:` and why. The session's row answers too, in the press's place, so the answer shows where it was
pressed: `Asking…`, then `Asked 19:41 IST`, when teamrig asked it, on the team's clock, with no press until the Teams
tab opens again from the switch or the session starts, so it cannot be asked twice; a refused one keeps the press,
then `not asked`. One press runs at a time, a meet or a wake; a meet is given 60 seconds. Inline, a row with a `[Meet]`
opens the card. The switch's Teams button counts the cards waiting on the owner now across the team, `Teams (2)`; a
card put off counts again once it comes back.

`[Wake]` runs `teamrig owner wake <team>/<id>`, the owner's wake by hand of any session of the tree: an idle running
session gets an inbox line that wakes it to work its task list, one not running opens in a new tab, and one in a turn,
at a tool call or waiting on the person is refused with nothing posted. Its answer shows as a meet's does: `Waking web…`,
then `Woke web:` with teamrig's line, or `web was not woken:` and why, leads the tab, and the row shows `Waking…`, then
`Woke 19:41 IST` with no press, or the press again, then `not woken`. A wake is given 120 seconds, as opening a tab
waits for it to come up. A retired session's row has none, nor the row of the session whose pane it is, the tab the
owner types in.

A card lists, each only when known: Id (where it differs from the name), Role (its roles in their colours, and `leads 2 sessions`), Led by, Launch (model
and effort), Hired or Rehired (day, by whom, review day), Scope, Reason, Now (its tasks in progress, each id opening its
page), Tasks (how many it finished of all it owns but the dropped and how many wait on their proof, `1 done of 4 · 1
verifying`; dim `older ones archived` once a compaction moved the old ones out of the register, dim `no tasks` for
none), Decisions (its cards waiting on the owner now), Later (those the owner put off, soonest back first, with when
each comes back), each id opening its page, and Inbox (unread lines, opening its inbox, the pane's own in the Inbox
view); a retired session's card gives its id and its retire: day, by whom, why, Heir and Handover (a press opens it). Now, Tasks,
Decisions, Later, Inbox and the counts of cards on the owner show for the pane's own team only. A page a card opens shows in the Tasks view; back shows the tasks list.

The Find field (`s`) searches the tree: each word matches the start of a word in a session's id, name,
roles or hire scope, retired ones too. The body counts the matches and draws each under its team and leaders, an id the name does not hold on a dim line under its row; a press
opens or closes its card, and Enter with one match opens it. Switching to Tasks closes the search, as Teams does a Tasks
search. Cleared, the tree draws as before: a match under a closed row stays hidden there.

It reads each team folder's config, rename log, hire log and the week file teamrig's budget hooks write
(`usage/team.week.json` in its state folder) under `~/.teamrig/teams/<team>`, with teamrig's own readers.
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

## The Stats tab

`r`, or Stats on the switch, folds the registers of the tree of teams the session's team is in into the numbers
`teamrig stats` prints. Two rows of presses lead it, the pick in brackets: the scope (the tree, each team, and a picked
session, whose press goes back to its team) and the range (7, 30, 90 or 180 days, a year, or all):

    Scope  [tree]  acme  tools
    Range  [7 d]  30 d  90 d  180 d  1 y  all

A Teams tab row's `[Stats]` opens the tab on that row's team or session: `‹ back` (`b`) and the trail `Teams › Stats`
then lead it, and back shows the Teams tab at that row. A Health count's list keeps its own back first, and a press on
the switch drops the row's.

| Section | What it shows |
| --- | --- |
| Health | Under its heading, a tile a measure, its `●` green, amber or red beside teamrig's words for it (the HEALTH line of `teamrig stats`, but for its `backlog clears` forecast), and the scope's week against its plan. Each count of tasks above none (`64 closed`, `81 opened`, `308 active`, the overdue count and its `p1 10`, the owner decisions) is a press that lists those tasks (see below) |
| Flow | Its header is its range and headline, `last 7 d · opened · closed (dropped) · net`, so it answers folded; a press folds it (`▸`) and opens it. Open: the active tasks at each day's end, the newest 14 days with bars of what opened and closed, the burn-up and the cumulative flow over the range, each part after a blank row and each day's bar a blank column from the next (no `$` limit-day marks yet: the pane has no source for those days) |
| New work | Closed by default, like the six after it; its header is `N in 7 d · M with no goal`. Open: where the new tasks came from (another session, self-made, the owner, the lead, GitHub) as a share bar over its legend, then their type, priority and how many have no goal |
| Speed | Header: the range of the teams' lead time medians and the tasks done never started. Open: each team's lead and cycle time, median and p85, as a table (a line a team where it does not fit), then the active tasks by age |
| Delays | Header: the overdue count and its p1. Open: those counts, each a press that lists the tasks, each team's when the scope holds two or more, the share done by its due date as a bar a team, the days late and the dues moved |
| Waits | Header: the waiting count and the owner's decisions with the oldest's age. Open: what the waiting tasks wait on as a share bar over its legend (a note when one task waiting on two things makes them add past the count), and the owner's decisions, a press that lists them |
| Bugs | Header: the active bugs, those opened and fixed in the range. Open: opened and fixed as bars on one scale, their share of new work and the dropped share of the closes |
| People | Header: how many sessions closed a task done in the range. Open: the 8 that closed the most, each name over a bar and a press that scopes the tab to that session, then a dim line counting the rest |
| Goals | The goals the scope's tasks can serve, its teams' and the teams' above them, over their whole history whatever the range. Header: the goals at risk and late, else how many (`no goals` with none). Open: a row a goal, its tag, a timeline on one axis for every goal (`░` its start to its target, `█` a day a task of it was done, `│` today; left out where the pane is too narrow), its done of all its tasks, the day its open tasks end at its 14-day pace (`—` with none), and its state, `late N d`, `at risk`, `on track` or `done` in red, amber, green or dim. A press on a row opens the goal's card: its title, start and target, parent, each move of its target, its pace and its tasks. Last, a dim line counting the range's done tasks that served no goal |

A press on a Health count draws its tasks in place of the numbers, under `‹ back` and a trail such as
`Stats › Overdue (35)`: a dim line saying what the list holds in the scope (and the range, for the opened and closed
ones) and its order (p1 first, then by due date; the owner decisions the oldest wait first), then each task's row over a
dim line of its owner, priority, due date and, for another team's task, that team. A press on one of the own team's
tasks that the pane holds opens its page; `b` or `‹ back` returns to the numbers. An empty list says `No tasks.`

It reads files only, every 3 seconds while it shows and at once on a press: the team folders, each scoped team's
register history once a scope takes it in, and the goals of those teams and the teams above them. A folder or register it cannot read is a `WARN` line naming it, its
numbers kept from the last read. It has no Find field.

## How it relates to the teamrig CLI

The pane never writes, but for the Meetings view's `[Start meeting]`, which runs `teamrig meeting start`, the Teams
tab's `[Meet]` and `[Wake]`, which run `teamrig meet` and `teamrig owner wake`, and a card's `[Note]` and `[Next]`, which run `teamrig owner note` and
`teamrig owner next` (see [Note and Next](#note-and-next)). To change
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
and a golden test holds its rows to what `teamrig list` prints. Besides the Meetings view, `[Meet]` and `[Wake]`, which run teamrig's CLI, it
reads files only: a stat every 3 seconds
re-reads a file when its size or time moved, and a 60 second tick moves the due and age labels on. Its state
(the size, a pin) lives in the plugin's own store, never in the register.
