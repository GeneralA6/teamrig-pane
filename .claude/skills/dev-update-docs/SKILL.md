---
name: dev-update-docs
description: Find which teamrig-pane docs a change must update in the same pull request, redraw the pictures, and run the tests that hold the docs to the code.
---

# Update the docs

Docs land in the same pull request as the change they describe. What each kind of change touches:

| Change | Update | Held by |
| --- | --- | --- |
| A feature people see | `README.md`, `plugins/teamrig-pane/README.md`, the guide in `plugins/teamrig-pane/skills/teamrig-pane-guide/` and `llms.txt` | `tools/docs/readme.test.ts`, `tools/docs/llm-guide.test.ts` |
| A key, a form of `/teamrig-pane`, a variable, a setting or a limit | the guide's tables, in its `SKILL.md` or `reference.md` | `tools/docs/llm-guide.test.ts` |
| The Claude Code release CI pins | `.github/workflows/ci.yml`, then the Requirements in the README and in the guide | `tools/docs/readme.test.ts`, `tools/docs/llm-guide.test.ts` |
| A picture | its drawing in `tools/docs/` (`tools/docs/hero.ts`, `tools/docs/features.ts`), then `npm run docs:images` | the `doc pictures` check (`node tools/docs/images-cli.ts --check`) |
| How we build or ship | `CONTRIBUTING.md`, `CLAUDE.md` and these skills | `tools/docs/contributor-kit.test.ts` |

Then `npm test` for the doc tests and `npm run check`.

## Traps

- Docs say what is true now: a change that makes something work, or stop working, updates its page in the same pull
  request.
- The pictures in `docs/images/` are drawn, never edited by hand: change the drawing and run `npm run docs:images`.
- Write docs for the user: what it does for them and how to fix each problem the pane names, not how it is built.

Last verified: 2026-10-22
