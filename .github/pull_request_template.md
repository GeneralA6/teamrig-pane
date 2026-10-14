## What and why
<!-- One or two lines: the behaviour this changes and the reason. -->

## Tests
<!-- Which tests prove it. For a bug fix: the regression test, and that it fails on the old code. -->

## Checklist
- [ ] Every behaviour change has a test; a bug fix has a regression test that fails before the fix.
- [ ] `npm run check` passes locally (typecheck, tools tests with the coverage gate, the plugin test gate, scrub).
- [ ] `npm run pane-test` passes locally.
- [ ] No skipped, focused or todo tests, and no floor lowered in `tools/ci/coverage.json`.
- [ ] Every commit is signed off (`git commit -s`).
- [ ] `hooks/core/` changed only through `scripts/sync-core.ts`, never by hand.
