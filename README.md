# teamrig-pane

**Your tasks, beside the conversation.**

A Claude Code plugin that docks your session's tasks on the right of the conversation, and flips to
the files you changed with one press. Part of [teamrig](https://github.com/GeneralA6/teamrig).

![Claude Code with teamrig-pane docked beside the conversation: the session's tasks under Working on, Up next, Waiting, Asked of others and Done today, each with a dim line saying why it stands there, then one press on Changes lists the files changed in its repo.](docs/images/hero.svg)

> **Pre-release.** The pane is built on Claude Code's function hooks, an early-access plugin surface
> that may change between releases. Nothing is stable yet and there is no release.

## Get started

```sh
claude plugin marketplace add GeneralA6/teamrig-pane
claude plugin install teamrig-pane@teamrig-pane
```

Then run `/teamrig-pane` in a session. In the fullscreen layout the pane docks on the right from 110
columns and opens by itself from 144; anywhere else it sits above the prompt.

### Requirements

Claude Code 2.1.295 or later in its fullscreen layout (`"tui": "fullscreen"` in its settings), and teamrig.
It checks the rest itself: if something is missing, such as git, a newer Claude Code, room to dock or a team,
the pane says so and how to fix it.

## Update

Claude Code moves an install only when the version in the plugin's `plugin.json` rises, and every release raises it.
To take the newest one:

```sh
claude plugin marketplace update teamrig-pane
claude plugin update teamrig-pane@teamrig-pane
```

Then run `/reload-plugins` in each open session, or restart it. Claude Code does not check this marketplace for
updates by itself unless you turn on its auto-update in `/plugin`, under Marketplaces.

## Why it's different

![Six cards. Your tasks, always in view: docked beside the conversation, in plan order. The whole team at a glance: every owner's tasks with how many are active or waiting. What needs you stands out: waiting, overdue, new and not picked up are marked. Details on a click. Changes, one press away. Fast, and costs no tokens: it reads files, never the model.](docs/images/features.svg)

It is part of Claude Code's own screen, not another window: nothing to switch to, nothing else to keep running.
Docked, its title and controls stay put while the list scrolls under them, a scroll bar at its side.

## What it shows

- **Tasks:** a bar of how your work stands (done today, verifying, working, waiting, not
  started; a click shows one status alone), then your tasks under Verifying, Working on, Up next,
  Waiting, Asked of others and Done today, each with a dim line saying why it stands there (what a waiting one
  waits for, what an open one comes after, which other session's task needs it, whose a task you asked for is).
  `/teamrig-pane all` shows every owner's tasks, your own first, and `/teamrig-pane <session>`
  shows another session's, named by its id or its name.
- **Details:** click a task, or press Enter on it, to open its card in place of its dim line: its
  description, status, note and proof, its priority, due date and week, the tasks it comes after and
  those of other sessions that need it, its
  goals, who asked, when it was added and by whom, where its ask is written, its evidence and its links. `c` closes every card. A click on a task
  id in a card opens that task's page, and a click on a file it references opens the file at the line it names, with
  back and forward (`b`, `f`) and a trail of where you went. In the dock a card ends in `[Note]`, which sends what you
  type to the task's session through `teamrig owner note`, and `[Next]`, which shows what `teamrig owner next` would
  do and, once confirmed, puts the task atop its session's list.
- **Find:** in the Tasks view the dock shows a Find field under its Tasks, Changes, Log, Inbox, Teams and Meetings switch (`s` or a click puts the cursor in it) that lists, as you type, the
  tasks the pane holds whose id, title, owner, goals, note, evidence or ref match your words, the matches underlined; Enter opens the top one's page.
  On the Inbox view the same field finds lines by sender or words, over the Log view's list conversations by their
  tasks, how they opened or their session, on the Changes view changed files by path, repo or branch, and on the Teams
  tab sessions by id, name, roles or hire scope.
  A line under it says where your keys go: into the search, to the pane's keys, or to Claude's prompt.
- **Archive:** `h` lists the tasks finished this week, a day at a time; `p` and `l` step a week back
  and forward over the last 8 days the pane holds, and `teamrig list --status done,dropped` lists older ones.
- **Changes:** the files changed in each git repo the session works in, each with its lines added and removed;
  a click on a file opens its diff under it, `+` lines green and `-` lines red.
- **Log:** each conversation of the team's sessions in the last 24 h, from the turn log teamrig writes, so a `/clear`
  or a compaction never takes away what a tab showed: the newest first, each titled by the task its session worked
  while it ran (else by how it opened) over its session, its times and its count of lines; a press opens one, its
  lines oldest first, kept current as it writes, each split by who spoke (owner,
  Claude, another session, a subagent, the harness's dim notices) with its markdown drawn, and `b` goes back to the
  list.
- **Inbox:** the session's own inbox lines of the last 24 hours and every unread one, the newest first, each with
  its sender and time and the unread ones marked `●`; the switch's button counts them, `Inbox (2)`. Reading them
  there marks nothing read: `teamrig inbox read` does.
- **Teams:** the tree of teams the session's team is in, read from teamrig's team folders: each team's counts of
  active and retired sessions, its lead over the sessions each leader leads, the retired ones in a group of their own
  and the child teams under their parent; each session's row gives its id, its name, how many sessions it leads
  (`(2)`), its roles, each in a colour of its own, and how many of its cards wait on the owner, with a `[Meet]` press
  that has teamrig ask it to bring them now; the pane's own row starts with a green `►`; the switch's button counts the
  cards, `Teams (2)`. A press on a row closes or opens what lies under it; a session's card adds its hire or retire and
  how many of its tasks are done and verifying.
- **Meetings:** the meetings booked for the session's team, by time: each one's time, length, who meets and what it
  settles, the next one marked and a missed one red. A press opens its card (what it is about, who joins, its tasks
  with their status, its brief), and a scheduled one's `[Start meeting]` runs `teamrig meeting start` for you.
  Press the switch, or `t`, `d`, `g`, `u`, `e` and `j` while the pane holds the keyboard.

## How it reads teamrig

- **The same reader.** teamrig's own read modules are copied into the plugin at a pinned commit, and
  a golden test holds the pane's rows to what `teamrig list` prints.
- **Files only.** A stat every 3 s re-reads a file only when its size or time moved, plus a tick every
  60 s. The exceptions run the CLI of the teamrig plugin installed in Claude Code: the Meetings view
  (`teamrig meeting list` every 60 s while it shows, `teamrig meeting start` on a press) and the Teams tab's `[Meet]`
  (`teamrig meet` on a press). No model calls, so no tokens.
- **Your team's register.** The team comes from `$TEAMRIG_TEAM` or the nearest `.teamrig.json`; a project
  with none shows how to set it up. See [Where the register is](plugins/teamrig-pane/README.md#where-the-register-is).

Using an AI assistant? Point it at [llms.txt](llms.txt): the pane explained for language models, with a link
to teamrig's guide.

[Plugin README](plugins/teamrig-pane/README.md) (every view, key and limit) ·
[Contributing](CONTRIBUTING.md) · [teamrig](https://github.com/GeneralA6/teamrig)

## Licence

[Apache License 2.0](LICENSE). Every copy keeps the [NOTICE](NOTICE) file, and a changed copy you share takes a name of
its own ([the name policy](TRADEMARKS.md)).
