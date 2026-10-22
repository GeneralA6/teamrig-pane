---
name: dev-ship-change
description: Land a finished teamrig-pane change through small signed commits, the plugin version raise, npm run check and pane-test, a push through the local gate and a rebase-merged pull request.
---

# Ship a change

1. Work on a branch cut from the newest main: `git fetch origin && git switch -c <branch> origin/main`. A worktree
   works too (`git worktree add -b <branch> <path> origin/main`, then `npm ci --ignore-scripts` in it).
2. Commit each logical change once its step passes, with `git commit -s`. Subjects follow the log, `area: what`
   (`pane:`, `card:`, `core:`, `docs:`, `test:`, `ci:`, `tools:`). A commit past 400 changed non-test lines or 15
   non-test files carries a `Large-commit: <reason>` line; the `size rule` (`tools/ci/size-rule-cli.ts`) fails one
   without it.
3. A change under `plugins/teamrig-pane/` raises the version in `plugins/teamrig-pane/.claude-plugin/plugin.json`,
   in its own commit, `plugin: version X.Y.Z, <why>`. While the version is 0.x, the minor for a feature or a change
   that breaks how people use it, else the patch. Installs move only when this version rises. Check it with
   `node tools/ci/plugin-version-cli.ts`.
4. `npm run check` (typecheck, the coverage gate, the plugin test gate, scrub, the doc pictures, the version gate and
   the size rule), then `npm run pane-test`: the plugin tests in Claude Code's runner.
5. `git push -u origin <branch>`: the pre-push hook runs the local gate (`tools/ci/local.ts`, its checks listed in
   `tools/ci/local-checks.ts`) on the committed tree. Never `--no-verify`.
6. Open the pull request and fill in the template (`.github/pull_request_template.md`). It is rebase-merged once
   every check passes on its head (the local gate while CI is paused), and the branch is deleted.

## Traps

- Main moved while you worked: rebase onto `origin/main` and set the version raise again from main's version.
- The local gate proves a committed tree, so it refuses uncommitted changes, at its start and at its end: commit or
  stash first, and leave the tree alone while it runs.
- `npm run check` never runs `plugins/teamrig-pane/tests/pane.test.ts`: only `npm run pane-test` and the local gate's
  `plugin tests` step do, in the engine.
- `plugins/teamrig-pane/hooks/core/` changes only through a sync (`dev-sync-core`), never by hand.
- A missing sign-off: `git commit --amend -s` for the last commit; the `commit-msg` hook from `npm run setup` catches
  it before the push.

Last verified: 2026-10-22
