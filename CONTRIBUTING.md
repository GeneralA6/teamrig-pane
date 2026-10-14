# Contributing

## Setup
Node.js 22.18 or later and Claude Code. Then, once per clone:

```sh
npm ci --ignore-scripts
npm run setup
```

`npm run setup` installs the git hooks: the scrub and DCO checks below run before each commit.

## Sign-off (DCO)
Every commit must carry a `Signed-off-by:` line that matches the commit author, certifying the
[Developer Certificate of Origin 1.1](https://developercertificate.org/). Add it with:

```sh
git commit -s
```

The `commit-msg` hook and CI both reject a commit without it.

## Tests
Every change ships tests, so the next change cannot break it unnoticed:
- A new behaviour gets a test that would fail without it. A bug fix gets a regression test that
  fails on the old code: run it before the fix and watch it fail.
- The plugin's tests live in `plugins/teamrig-pane/tests/` and run under Claude Code's plugin test
  runner, in the environment the plugin's hooks run in, with the engine's fakes for files, git, the
  clock and the store: `npm run pane-test` (`claude plugin test plugins/teamrig-pane`).
- The repository tools' tests live beside the code as `<name>.test.ts` under `tools/` (`node:test`):
  `npm test`. They run on Linux, Windows and macOS: build paths with `path.join`, never with literal
  separators.
- No skipped, focused or todo tests: a test that does not run catches nothing.

`npm run check` runs the tools' gates CI runs on the tree: typecheck, coverage and scrub. Its coverage
gate (`npm run coverage`) fails when any tools test fails or is skipped, a source file under `tools/`
is loaded by no test, or a file or the total falls below the floors in `tools/ci/coverage.json`. Never
lower a floor to pass a change.

`hooks/core/` is a copy of the register's own modules, made by `scripts/sync-core.ts`; never edit it
by hand (the plugin README says how to sync it).

## Branches and releases
- Every change is its own branch off `main` and lands through a pull request once every CI check
  passes on its head; it is rebase-merged and the branch is deleted.
- Nothing is pushed to `main` directly, and release tags are set only by the maintainer. Installs
  track `main`.

## Scrub checks
Two checks keep private data out of the history:
1. **Generic** (in this repo, run by the hooks and CI): absolute home paths, e-mail addresses,
   IP addresses, internal host names and common secret formats.
2. **Private denylist** (optional, never committed): a file of your own terms, wired in with
   `git config --local teamrig.scrubDenylist <path>`. Once configured, the hooks fail closed if
   the file is missing.

Write test data that looks like a secret by building it at runtime (for example
`'ghp' + '_' + 'x'.repeat(36)`), so the source never holds the literal.
