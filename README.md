# teamrig-pane

**Your tasks, beside the conversation.**

A Claude Code plugin that docks your session's tasks on the right of the conversation, and flips to
the files you changed with one press. Part of [teamrig](https://github.com/GeneralA6/teamrig).

![Claude Code with teamrig-pane docked beside the conversation: the session's active tasks in plan order, what a waiting task waits for, what it asked of others and what it finished today, then one press on Changes lists the files changed in its repo.](docs/images/hero.svg)

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

## What it shows

- **Tasks:** a bar of how your work stands (done today, verifying, working, waiting, not
  started; a click shows one status alone), then your active tasks in plan order, the verifying ones
  first, what each waiting one waits for, what you asked of others, what you finished today and your unread
  inbox lines. `/teamrig-pane all` shows every owner's tasks, and
  `/teamrig-pane <session>` shows another session's, named by its id or its name.
- **Details:** click a task, or press Enter on it, to read its ask, quoted from the file its ref
  points at, then who asked and when, its goals and its status note.
- **Changes:** the files changed in each git repo the session works in, each with its lines added and removed.
  Press the switch, or `t` and `d` while the pane holds the keyboard.

## How it reads teamrig

- **The same reader.** teamrig's own read modules are copied into the plugin at a pinned commit, and
  a golden test holds the pane's rows to what `teamrig list` prints.
- **Files only.** A stat every 3 s re-reads a file only when its size or time moved, plus a tick every
  60 s. No model calls, so no tokens.
- **Your team's register.** The team comes from `$TEAMRIG_TEAM` or the nearest `.teamrig.json`; see
  [Where the register is](plugins/teamrig-pane/README.md#where-the-register-is).

Using an AI assistant? Point it at [llms.txt](llms.txt): the pane explained for language models, with a link
to teamrig's guide.

[Plugin README](plugins/teamrig-pane/README.md) (every view, key and limit) ·
[Contributing](CONTRIBUTING.md) · [teamrig](https://github.com/GeneralA6/teamrig) ·
Licensed under [Apache-2.0](LICENSE).
