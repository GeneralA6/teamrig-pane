# Contributing

## Setup
Node.js 22.18 or later and Claude Code. Then, once per clone:

```sh
npm ci          # also points git at .githooks (npm's prepare runs the setup)
npm run setup   # the same hook setup, for a clone installed with --ignore-scripts
```

The git hooks run the scrub and DCO checks below before each commit, and the [local gate](#the-local-gate) before
each push. `npm run check` first checks that git runs them, and fails until `npm run setup` ran. Where teamrig is on
PATH, each hook first runs its secret scan (`teamrig secrets staged`, `message` and `pushed`), which refuses a commit
or push that adds a secret, named by place and shape; a machine without teamrig on PATH skips the scan with a line
saying so.

## How we work
Every contributor, and every Claude Code session opened in this repo, works the same way. [CLAUDE.md](CLAUDE.md) holds
the rules that apply on every turn, and the project skills in `.claude/skills/` the steps of each repeated job:

| Skill | Use it for |
| --- | --- |
| [`dev-write-pane-test`](.claude/skills/dev-write-pane-test/SKILL.md) | a plugin test in the engine, or a node test where the runner cannot go |
| [`dev-update-docs`](.claude/skills/dev-update-docs/SKILL.md) | the docs a change must update, and the tests that hold them to the code |
| [`dev-sync-core`](.claude/skills/dev-sync-core/SKILL.md) | moving `hooks/core/` to a new teamrig commit, and the golden capture after it |
| [`dev-ship-change`](.claude/skills/dev-ship-change/SKILL.md) | from the last commit to the merge: version raise, checks, push, pull request |

- **One branch per change**, cut from the newest `origin/main` (see [Branches and releases](#branches-and-releases)).
- **One logical change per commit**: a fix with its tests, a refactor apart from what it enables, a mechanical change
  alone, each committed once its step passes, so a reviewer reads one idea at a time and a bad step reverts alone. A
  commit past 400 changed non-test lines or 15 non-test files carries a `Large-commit: <reason>` line saying why it
  cannot be split; these are the limits teamrig itself applies to a team's pushes.
- **Docs in the same pull request** as the change they describe, so `main` never documents what it does not do.
- **Typed code with no casts**: no `any`, no `as unknown as`; narrow `unknown` with a type guard.
- When a step in a skill turns out wrong, fix the skill in the same pull request.

## Sign-off (DCO)
Every commit must carry a `Signed-off-by:` line that matches the commit author, certifying the
[Developer Certificate of Origin 1.1](https://developercertificate.org/). Add it with:

```sh
git commit -s
```

The `commit-msg` hook and the local gate both reject a commit without it.

## Tests
Every change ships tests, so the next change cannot break it unnoticed:
- A new behaviour gets a test that would fail without it. A bug fix gets a regression test that
  fails on the old code: run it before the fix and watch it fail.
- The plugin's tests live in `plugins/teamrig-pane/tests/` and run under Claude Code's plugin test
  runner, in the environment the plugin's hooks run in, with the engine's fakes for files, git, the
  clock and the store: `npm run pane-test` (`claude plugin test plugins/teamrig-pane`). That runner
  refuses a dynamic `import()`, so a plugin script that acts only when imported (the golden capture's
  `node --import` clock preload) is tested under node in `tools/pane-scripts/`.
- The repository tools' tests live beside the code as `<name>.test.ts` under `tools/` (`node:test`):
  `npm test`. They run on Linux, Windows and macOS: build paths with `path.join`, never with literal
  separators.
- No skipped, focused or todo tests: a test that does not run catches nothing. The plugin test gate
  (`npm run plugin-tests`) fails on one in a plugin test, and on a file that imports
  `claude-code/testing` without a `*.test.ts` or `*.test.tsx` name, which the runner never runs.

`npm run check` checks that git runs the repo hooks, then runs the gates CI runs on the tree: typecheck (`tools/` under `tsconfig.json`, the plugin's
hooks, tests and scripts under `tsconfig.pane.json`), coverage, the plugin test gate and
scrub. Its coverage gate (`npm run coverage`) runs the tools tests and the plugin's `*.test.ts` under
node, with `tools/pane-kit/` standing in for the engine (`claude-code/testing` and the plugin's `.ts`
import paths), and measures both. It fails when any of those tests fails or is skipped, a source file
under `tools/` or `plugins/teamrig-pane/` is loaded by no test, or a file, or either folder's total,
falls below the floors in `tools/ci/coverage.json`. That file names, each with its reason, the code
it does not measure: `hooks/core/` (vendored; teamrig measures it), the files no node test can load
yet, and the plugin tests only the engine can run. Never lower a floor or add an entry to pass a
change: add the test. Once the repository is public, CI also runs `npm test` and the plugin
tests on Linux, Windows and macOS under node 22 and 24, with a pinned Claude Code release
(`.github/workflows/ci.yml`); until then, the local gate runs them on your machine.

`hooks/core/` is a copy of teamrig's read modules at the commit `scripts/teamrig-pin.json` names, made
by `scripts/sync-core.ts`; never edit it by hand. The `hooks/core matches the teamrig pin` check (a CI job
and a step of the local gate) runs `sync-core.ts --check` against teamrig and fails on any difference;
in CI it checks out the public teamrig repository, and the local gate reads a teamrig checkout on your
machine. The `hooks/core reads teamrig main's formats` check (a step of
that job and of the local gate) runs `sync-core.ts --formats`: it fails while a format number in
`hooks/core/` (an `export const <NAME>_VERSION` or `_FORMAT`, as teamrig declares the format of each file
it keeps) is lower than teamrig main's, or missing, so a format teamrig raised fails the next pane push
until a sync brings the pane the reader for it. After each sync, rerun `scripts/golden.ts` so
`tests/golden-register.ts` holds what teamrig at the new pin writes and prints (the plugin README says
how).

## The local gate
CI (`.github/workflows/ci.yml`) runs on each pull request and each push to `main`, but every job skips while the
repository is private, where GitHub Actions minutes bill, so it checks only once the repository is public. Its
`every check passed` job passes only when every other job did: the one check `main` requires (see
[Pull requests](#pull-requests)). Whether CI runs or not, the `pre-push` hook that `npm ci` sets runs every check CI
runs (`tools/ci/local.ts`; the list is `tools/ci/local-checks.ts`) on the commit being pushed. Run it by hand with
`node tools/ci/local.ts`.
- It refuses a push to `main`, before any check: every change lands through a pull request. On GitHub,
  `.github/workflows/main-push-alert.yml` opens an issue when main changes outside a pull request anyway (from a
  clone without the hooks), so the owner hears of it; a commit made in GitHub's web editor raises none.
- It proves a committed tree: it refuses uncommitted changes, and a pushed commit that is not checked out.
- It stops at the first failing check and prints its output.
- A pass is recorded in the clone's git folder (`local-ci/<tree>.json`, shared by its worktrees), so a tree is
  checked once; a new commit is checked again.
- The core-sync check reads a teamrig git checkout: `--teamrig <dir>`, else the clone's
  `git config teamrig.checkout <dir>`, else a `teamrig` folder beside this repository.
- The plugin tests run in the Claude Code on your PATH, with an empty home folder as on a CI runner.
- It cannot be skipped: never push with `--no-verify`.

It runs on one machine, one Node and the Claude Code installed there, so a failure that only another OS,
Node version or the pinned Claude Code release shows goes unseen until the repository is public.

## Branches and releases
- Every change is its own branch off `main` and lands through a pull request once every check
  passes on its head (the local gate until the repository is public); it is rebase-merged and the branch is deleted.
- Each commit is one logical change. The `size rule` (`tools/ci/size-rule-cli.ts`, run by the local gate, CI
  and `npm run check`) fails a commit over 400 changed non-test lines or 15 non-test files whose message has
  no `Large-commit: <reason>` line: teamrig's push guard rule at its defaults, so a pull request meets it too.
- Nothing is pushed to `main` directly, and release tags are set only by the maintainer.
- Installs take the version in `plugins/teamrig-pane/.claude-plugin/plugin.json`, not the newest commit:
  `claude plugin update` moves an install only when that version rises. So a change to anything under
  `plugins/teamrig-pane/` raises it, as MAJOR.MINOR.PATCH: while it is 0.x, the minor for a new feature
  or a change that breaks how people use it, the patch for a fix. The `plugin version gate`
  (`tools/ci/plugin-version-cli.ts`, run by the local gate and `npm run check`) fails a pull request that does not, and
  one that gives the marketplace entry a version of its own, which Claude Code ignores. How users update:
  [Update](README.md#update).

## Pull requests
- **From a fork**: fork the repository, branch off its `main`, and open the pull request against this repository's
  `main`. CI runs it with no secrets and a read-only token, and an outside contributor's run waits for the
  maintainer to approve it.
- **Your commit e-mail**: the `Signed-off-by:` line carries your commit e-mail, and the scrub refuses an e-mail
  address in a commit message unless it is one of GitHub's no-reply addresses. Before your first commit, set the
  no-reply address GitHub shows under Settings, Emails: `git config user.email <id>+<user>@users.noreply.github.com`.
- **A version clash**: when `main` moves on with a version raise of its own, rebase onto it. `plugin.json` clashes:
  take `main`'s side and raise the version above it again, in its own commit as before.
- **Review**: a code owner (`.github/CODEOWNERS`: the maintainer) reviews the code and approves the last push, and a
  new push dismisses an approval given before it. A change to the git hooks, their setup, CI or the scrub
  (`.githooks/`, `.github/`, `tools/setup/`, `tools/scrub/`, `tools/ci/`) also gets a security review.
- **Rules on `main`**: `.github/rulesets/` holds the repository's two rulesets for `main`, imported under Settings,
  Rules, Rulesets. `main` lets no one push, force-push or delete it and takes a change only through a pull request,
  rebase-merged once its `every check passed` check passed on the newest `main`; `main review` asks a code owner
  to approve the last push, which only the maintainer's own pull requests skip. `tools/ci/rulesets.test.ts` holds
  them to `ci.yml` and `.github/CODEOWNERS`.

## Scrub checks
Two checks keep private data out of the history:
1. **Generic** (in this repo, run by the hooks, the local gate and CI): absolute home paths, e-mail addresses,
   IP addresses, internal host names and common secret formats.
2. **Private denylist** (optional, never committed): a file of your own terms, wired in with
   `git config --local teamrig.scrubDenylist <path>`. Once configured, the hooks fail closed if
   the file is missing.

Write test data that looks like a secret by building it at runtime (for example
`'ghp' + '_' + 'x'.repeat(36)`), so the source never holds the literal.
