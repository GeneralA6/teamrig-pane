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
| priority names (`p2 correctness`) | the team config's `register.priorities`, else teamrig's defaults |

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

With both folders named, the team is still looked for, only to name the priorities; when none is found,
teamrig's defaults name them.

The variables come from the environment Claude Code runs in (its settings' `env` block works too), all read once
when the session starts: after a change, restart or resume the session.

A task's `--ref` is split on `;`. Each part that reads `file:N`, `file:N-M` (at most 3 lines) or `file:N,M` is
quoted from that file: an inbox file from the inbox folder, a `~/` path from the home folder, and a relative path
from the session's folder or a folder above it. Each quoted line is cut at 320 characters.

## WARN lines and their fixes

The pane draws a problem as one `WARN` line above the tasks, keeps the last good tasks drawn, and reads again on
the next poll.

| WARN line | Fix |
| --- | --- |
| `no register found: set TEAMRIG_PANE_TASKS_DIR and TEAMRIG_PANE_INBOX_DIR, write them in <kit home>/pane.json, or start the session in a teamrig team's project (.teamrig.json)` | Start Claude Code in the team's project folder, set `$TEAMRIG_TEAM`, or name the folders. Create a team with teamrig only if the user wants one. |
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
| `WARN the pane could not draw: <error>` | A drawing failed; report it with the error text. |
| In Changes, `WARN <git's first error line>` under a repo | git could not read that repo (or took over 10 seconds). |

## Limits

| Limit | Value |
| --- | --- |
| One file read | 4 MiB, about 13,500 register events |
| Polls | a file stat every 3 seconds; a 60 second tick for due and age labels and for Changes |
| `asked of others` | the newest 8 |
| `finished today` | done or dropped in the last 24 hours, the newest 6 |
| `NOT PICKED UP` | untouched by its owner 24 hours after it was assigned |
| Above the prompt | 6 rows, the last saying how many it left out |
| Dock | asks for 58 columns; the side dock needs a terminal of 110 |
| Changes, per repo | the first 200 files, the rest counted |
| Changes, outside any repo | the newest 20 files |
| One git run | 10 seconds |
| Quoted ref | 3 lines, 320 characters a line |

The pane never writes the register, the inboxes or any repo. It keeps only its size and the pins in the
plugin's own store.
