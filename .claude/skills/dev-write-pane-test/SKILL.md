---
name: dev-write-pane-test
description: Write a teamrig-pane plugin test for Claude Code's plugin test runner, with the engine's fakes and the shared fixtures, or a node test where the runner cannot go.
---

# Write a pane test

1. Pick the place. A hook's logic: `plugins/teamrig-pane/tests/<name>.test.ts`, importing `describe`, `expect` and
   `test` from `claude-code/testing`. A repository tool: `tools/<folder>/<name>.test.ts` beside it, on `node:test`. A
   plugin script that acts only when imported: `tools/pane-scripts/`, as `tools/pane-scripts/golden-clock.test.ts`
   does, since the runner refuses a dynamic `import()`.
2. Build the register from `plugins/teamrig-pane/tests/fixtures.ts`: `createLine`, `statusLine`, `verifyingLine`,
   `updateLine` and `markLine` write event lines, `NOW` and `HOUR` set the clock, `MemoryFiles` stands in for the
   files. Never a real home folder or the wall clock.
3. A test that mounts the pane and answers the engine's effects (env, clock, store, session id, files) goes in
   `plugins/teamrig-pane/tests/pane.test.ts`, which takes the engine's `$` and `on`.
4. Run it: `npm run pane-test` runs every plugin test in the engine; `npm run coverage` runs the tools tests and the
   plugin tests under node, with `tools/pane-kit/` standing in for the engine, and fails a source file no test loads
   or one below the floors in `tools/ci/coverage.json`.
5. `npm run typecheck`: the plugin's files typecheck against `plugins/teamrig-pane/typecheck/`, which declares the
   engine calls the plugin makes. Declare a new one there, never as `any`.

## Traps

- `npm run coverage` skips `plugins/teamrig-pane/tests/pane.test.ts`: only the engine can run it.
- The drawn tree keeps no React key on a `Text`: reach it through its parent `Box`'s children, and assert what the
  pane reads as with `screenOf` in `plugins/teamrig-pane/tests/pane.test.ts`.
- `plugins/teamrig-pane/tests/pane.test.ts` holds a binary byte: search it with `grep -a`, and edit it with a tool
  that keeps the bytes as they are.
- No skipped, focused or todo tests, and a file that imports `claude-code/testing` is named `*.test.ts`: the plugin
  test gate (`npm run plugin-tests`) fails both.
- Tools tests run on Linux, Windows and macOS: build paths with `path.join`, never with literal separators.

Last verified: 2026-10-22
