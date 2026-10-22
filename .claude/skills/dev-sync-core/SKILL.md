---
name: dev-sync-core
description: Move the pane's copy of teamrig's read modules to a new teamrig commit, check it against the pin, and capture the golden register again.
---

# Sync hooks/core

`plugins/teamrig-pane/hooks/core/` is a byte copy of teamrig's read entry and every module it reaches, at the commit
`plugins/teamrig-pane/scripts/teamrig-pin.json` names. Read the plugin README's
[Reading the register](../../../plugins/teamrig-pane/README.md#reading-the-register) first.

1. On a branch (`dev-ship-change`), with a teamrig git checkout that holds the commit, move the pin and write the copy:
   `node --disable-warning=ExperimentalWarning plugins/teamrig-pane/scripts/sync-core.ts --teamrig <repo> --ref <commit>`.
2. Check it: the same command with `--check` instead of `--ref <commit>` lists every file that differs from the pin,
   and exits 1 on any.
3. Capture teamrig again at the new pin:
   `node --disable-warning=ExperimentalWarning plugins/teamrig-pane/scripts/golden.ts --teamrig <repo>` rewrites
   `plugins/teamrig-pane/tests/golden-register.ts`, which `plugins/teamrig-pane/tests/golden.test.ts` holds the pane to.
4. A new module the read entry reaches goes into the list in `plugins/teamrig-pane/scripts/vendor.ts`, so the import
   check accepts it.
5. Commit the copy, the pin and the capture together, `core: sync hooks/core to teamrig <sha>, <why>`, with a
   `Large-commit: <reason>` line when the copy passes the size limits. Raise the plugin version in its own commit.

## Traps

- The scripts read teamrig's git history, never its working tree: commit (or fetch) the teamrig change first, then
  pass its sha.
- Never edit `plugins/teamrig-pane/hooks/core/` or the golden capture by hand: `--check`, the local gate and the
  golden test fail on any difference.
- The plugin contract (`plugins/teamrig-pane/types/index.d.ts`) cannot import, so it spells the status unions out
  by hand; a spec fails when the register adds or drops a status the pane has no glyph for.

Last verified: 2026-10-22
