# teamrig-pane

**Your session's tasks, beside the conversation.** teamrig-pane is a Claude Code plugin that docks the
session's tasks from a [teamrig](https://github.com/GeneralA6/teamrig) task register on the right of
Claude Code's fullscreen UI, and flips to the session's git changes with one key. It reads files only:
no model calls, so no tokens.

```sh
claude plugin marketplace add GeneralA6/teamrig-pane
claude plugin install teamrig-pane@teamrig-pane
```

or, from a session, `/plugin install teamrig-pane --marketplace GeneralA6/teamrig-pane`. The pane is
tested on Claude Code 2.1.295 and later.

Then run `/teamrig` in a session. The pane docks on the right in the fullscreen layout
(`"tui": "fullscreen"`) from 110 columns, and opens by itself from 144; anywhere else it sits above the
prompt.

> **Pre-release.** The pane is built on Claude Code's function hooks, an early-access plugin surface
> that may change between releases. Nothing is stable yet and there is no release.

## What it shows

- **Tasks:** the session's area (its active tasks in plan order, what blocks them, what it asked of
  others, what it finished today, its unread inbox lines), or every owner's tasks with `all`. Press a
  task to expand its details: the ask quoted from where its ref points, its goals, notes, sub-tasks
  and waits.
- **Changes:** the files changed in each git repo the session works in, from
  `git status --porcelain`, refreshed after each write.

## Where it finds the register

By default, where teamrig keeps the register of the session's team (`~/.teamrig/teams/<team>/state`,
the team named by `$TEAMRIG_TEAM` or the nearest `.teamrig.json`). Each folder can be named instead by
a `TEAMRIG_PANE_*` variable or in `~/.teamrig/pane.json`; see
[Where the register is](plugins/teamrig-pane/README.md#where-the-register-is).

The plugin's own [README](plugins/teamrig-pane/README.md) covers every view, key and limit.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Licensed under [Apache-2.0](LICENSE).
