# teamrig-pane reference

Where the pane finds what it reads, what it says when it cannot, and its limits. Start at [SKILL.md](SKILL.md).

## Where the register is

By default the pane reads the register where teamrig keeps it for the session's team:

| What | Default place |
| --- | --- |
| kit home | `$TEAMRIG_HOME`, else `~/.teamrig` |
| team | `$TEAMRIG_TEAM`, else the `team` in the nearest `.teamrig.json` up from the session's folder |
| tasks folder (`events.jsonl`, `inbox-marks.jsonl`) | `<kit home>/teams/<team>/state`, or the team config's `paths.state` |
| inbox folder (one `<area>.md` per area) | `<tasks folder>/inbox`, or the team config's `paths.inbox` |

The team config is `<kit home>/teams/<team>/config.json`, read with teamrig's own reader. A relative
`paths.state` or `paths.inbox` is taken from the team's folder.

Any folder can be named instead, each on its own. A variable wins over the settings file, which wins over the
team default:

| Variable | Setting | What it names |
| --- | --- | --- |
| `TEAMRIG_PANE_TASKS_DIR` | `tasksDir` | the tasks folder |
| `TEAMRIG_PANE_INBOX_DIR` | `inboxDir` | the inbox folder |
| `TEAMRIG_PANE_GOALS_DOC` | `goalsDoc` | the goals document, a path from the workspace root; unset, no goal items are quoted |
| `TEAMRIG_PANE_SETTINGS` | | the settings file, in place of `<kit home>/pane.json` |

The settings file is one JSON object of those settings. A folder in it is absolute or starts with `~/`:

```json
{ "tasksDir": "~/notes/tasks", "inboxDir": "~/notes/board/inbox" }
```

With both folders named, the team is still looked for, for the files that name its sessions and for its
notes; when none is found, the pane goes without them.

The variables come from the environment Claude Code runs in (its settings' `env` block works too), all read once
when the session starts: after a change, restart or resume the session.

A task's `--ref` is split on `;`. Each part that reads `file:N`, `file:N-M` (at most 3 lines) or `file:N,M` is
quoted from that file: an inbox file from the inbox folder, a `~/` path from the home folder, and a relative path
from the session's folder or a folder above it. Each quoted line is cut at 320 characters.

## WARN lines and their fixes

The pane draws a problem as one `WARN` line above the tasks, keeps the last good tasks drawn, and reads again on
the next poll. A project teamrig is not set up for (no team, no folder named) is no problem: the pane shows
the setup step alone, and a problem a later look finds is a `WARN` line over it.

| WARN line | Fix |
| --- | --- |
| `no register found: set TEAMRIG_PANE_TASKS_DIR and TEAMRIG_PANE_INBOX_DIR, write them in <kit home>/pane.json, or start the session in a teamrig team's project (.teamrig.json)` | One folder is named alone, or the session has no folder: name both folders, or drop the one named and start Claude Code in the team's project folder. |
| `... or set TEAMRIG_HOME for teamrig's register` | No home folder is known: set `$TEAMRIG_HOME`. |
| `<path> is not JSON; expected {"team": "<id>"}` | Fix the `.teamrig.json` pointer. |
| `<path> has no "team" text; expected {"team": "<id>"}` | Add the team id to the pointer. |
| `<from>: "<team>" is not a team id (a lowercase letter, then lowercase letters, digits or -, at most 32)` | Fix `$TEAMRIG_TEAM` or the pointer. |
| `<kit home>/teams/<team>/config.json: <problem>` | Run `teamrig config validate` and fix what it lists. |
| `<path> (TEAMRIG_PANE_SETTINGS) is not there` | Point the variable at an existing file, or unset it. |
| `<path> is not a JSON object; expected {"tasksDir": "...", ...}` | Fix the settings file. |
| `<path>: unknown key "<key>" (known: tasksDir, inboxDir, goalsDoc)` | Remove or rename the key. |
| `<path>: "<key>" must be an absolute folder or start with ~/` | Write the folder as an absolute path or from `~/`. |
| `<path> cannot be read (<error>)` | Check the file's permissions; the pane reads again on the next poll. |
| `events.jsonl: 1 unreadable line(s), 0 line(s) from a newer teamrig, 0 event(s) naming no task` | The same lines teamrig skips: run `teamrig doctor`, and update teamrig-pane if teamrig is newer. |
| `events.jsonl is 4.12 MiB, over the 4 MiB a pane can read at once: it needs rotating` | The register outgrew one read; the last good tasks stay drawn. Report it to the team's lead. |
| `Claude Code <version> is older than teamrig-pane needs (2.1.295 or later): run claude update, then restart Claude Code.` | Update Claude Code, then restart it. Checked once a session, when it starts. |
| `git could not be started (<reason>): install it from git-scm.com, then restart Claude Code. The Changes view needs it.` | Install git, or put it on the PATH, then restart Claude Code. The Tasks view works without it; the Changes view stays empty. |
| `The teamrig-pane check for Claude Code failed (<reason>).` | The engine gave no version; the pane works on. Report it with the reason. |
| `WARN the pane could not draw: <error>` | A drawing failed; report it with the error text. |
| In Changes, `No git repo yet: the session folder is in none, …` | Nothing to list yet: the session's folder is in no git repo, and no file the session or its agents edited is in one. The first file edited (Edit, Write, NotebookEdit) in a repo adds that repo; a file a shell command changes adds none. |
| In Conversations, `No turn logs yet: …` | The team has no turn-log folder: teamrig writes one once it runs a version with the turn log, unless the team config sets `turnLog.enabled` to false. |
| In Conversations, `The turn logs could not be read: <error>.` | The turn-log folder could not be listed; the pane tries again on the next poll. |
| On a conversation's page, `Not all read: <file>: <error>.` | One hour's file could not be read; the page shows the rest and tries again on the next poll. |
| In Changes, `WARN <git's first error line>` under a repo | git could not read that repo (or took over 10 seconds); its header then names only the folder. A worktree whose folder was removed shows no warning: it leaves the view. |
| In Meetings, `The meetings could not be read: no plugin list at <path>: install the teamrig plugin.` (or `no teamrig plugin with its CLI in <path>`) | The view runs the CLI of the teamrig plugin installed in Claude Code, found once a session: `claude plugin install teamrig@teamrig`, then restart or resume the session. |
| In Meetings, `The meetings could not be read: teamrig printed no meeting list the pane can read: update teamrig.` | The teamrig plugin is older than 0.208.0: update it, then restart or resume the session. |
| In Meetings, `The meetings could not be read: <teamrig's error>.` | teamrig refused the list, or did not finish in 30 seconds (`node` not on the PATH says `spawn node ENOENT`); fix what it says. The view tries again every 60 seconds while it shows. |
| In Meetings, `WARN 2 meetings teamrig printed are in a newer format: update the pane.` | teamrig is newer than the pane: update teamrig-pane. The meetings it can read still show. |
| In Meetings, `M3 did not start:` and teamrig's reason | `teamrig meeting start` refused the start (the meeting was started, ended or dropped since the list was read), or did not finish in 60 seconds. |

## Limits

| Limit | Value |
| --- | --- |
| One file read | 4 MiB, about 13,500 register events |
| Polls | a file stat every 3 seconds; a 60 second tick for due and age labels, for Changes and for the Meetings view |
| Stats | the team folders, the scoped registers' history and the goals of those teams and the teams above them every 3 seconds while the tab shows, folded again only when a history, the scope, the range or the minute moved |
| Meetings | `teamrig meeting list --json` every 60 seconds while the view shows, given 30 seconds to answer; a start is given 60 seconds |
| `Waiting`, asked of others | the first 8 asked of other sessions, after the area's own waiting tasks; the heading and the status bar count them all, a dim line the rest |
| `Done today` | done or dropped on the team's day, the newest 6; the heading and the status bar count them all, a dim line the rest |
| `not picked up` | untouched by its owner 24 hours after it was assigned |
| Above the prompt | 6 rows, the last saying how many it left out; the status bar takes those past the list's 4 |
| Dock | asks for 58 columns; the side dock needs a terminal of 110 |
| Changes, per repo | the first 200 files, the rest counted |
| Changes, outside any repo | the newest 20 files |
| One git run | 10 seconds; a line count that takes longer is left out |
| Quoted ref | 3 lines, 320 characters a line |
| Card links | 5 a card; an address over 2048 characters, once percent-encoded, is left out |
| Pages | 20 places kept, the oldest dropped first; the trail names the last 4 |
| Conversations | each session's turn log over the hours teamrig keeps it (the team config's `turnLog.keepHours`, 24 by default); a session's page holds the newest 256 KiB of text and notes the older lines it left out |
| A reference file's page | 256 KiB, read whole as the page opens; a larger file, or one that is not text, says why it is not shown |
| Search results | 30 shown, the active first, under a dim line counting every match |
| A Claude dialog (a permission prompt, a question) | while it is open, Claude Code sends the pane no keys, clicks or wheel scroll, and tells it nothing: answer the dialog first |
| Done page | 4 rows a group before `▸ n more`; the tasks finished in the last 8 days, teamrig's own retention |

The pane never writes the register, the inboxes or any repo itself: the Meetings view's `[Start meeting]` runs
`teamrig meeting start`, the Teams tab's `[Meet]` runs `teamrig meet` and its `[Wake]` `teamrig owner wake`, and a card's `[Note]` and `[Next]` run
`teamrig owner note` and `teamrig owner next`, and teamrig writes what they change. It keeps only its size and the
pins in the plugin's own store.
