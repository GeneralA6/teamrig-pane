import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { drawPictures, IMAGES_DIR } from './images.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const readme = readFileSync(`${ROOT}README.md`, 'utf8');
const ci = readFileSync(`${ROOT}.github/workflows/ci.yml`, 'utf8');
const pluginReadme = readFileSync(`${ROOT}plugins/teamrig-pane/README.md`, 'utf8');
const TEAMRIG = 'https://github.com/GeneralA6/teamrig';

/** Every Markdown link and image target in the README, without its `#anchor`. */
const targets = [...readme.matchAll(/\]\(([^)\s]+)\)/g)].map(([, target = '']) => target.split('#')[0] ?? '');

describe('README', () => {
  it('opens with the name and the line that says what the pane is for', () => {
    assert.match(readme, /^# teamrig-pane\n\n\*\*Your tasks, beside the conversation\.\*\*\n/);
  });

  it('shows every picture with a text alternative a screen reader can stand on', () => {
    for (const picture of drawPictures()) {
      const [, alt = ''] = readme.match(new RegExp(`!\\[([^\\]]*)\\]\\(${IMAGES_DIR}/${picture.file.replace('.', '\\.')}\\)`)) ?? [];
      assert.ok(alt.length > 40, `${picture.file}: ${alt}`);
      assert.doesNotMatch(alt, /^(hero|image|screenshot|features)\b/i);
    }
  });

  it('lists what the pane needs: the Claude Code version CI installs, teamrig, the fullscreen layout, git', () => {
    const [, needs = ''] = readme.match(/\n### Requirements\n([\s\S]*?)\n## /) ?? [];
    const [, tested = ''] = ci.match(/@anthropic-ai\/claude-code@(\d+\.\d+\.\d+)/) ?? [];
    assert.notEqual(tested, '');
    assert.match(needs, new RegExp(`^- Claude Code, tested on ${tested.replaceAll('.', '\\.')} and later\\.$`, 'm'));
    for (const need of [/^- teamrig:/m, /`"tui": "fullscreen"`/, /at least 110 columns/, /^- git, for the Changes view\./m, /Windows, macOS or Linux/]) {
      assert.match(needs, need);
    }
  });

  it('points AI assistants at llms.txt', () => {
    assert.match(readme, /Using an AI assistant\? Point it at \[[^\]]*llms\.txt\]\(https:\/\/github\.com\/GeneralA6\/teamrig\/blob\/main\/llms\.txt\)/);
  });

  it('says it is part of teamrig, and links teamrig', () => {
    assert.match(readme, new RegExp(`Part of \\[teamrig\\]\\(${TEAMRIG}\\)`));
  });

  it('names the command that opens the pane, and only that one', () => {
    assert.match(readme, /run `\/teamrig-pane`/);
    assert.doesNotMatch(readme, /\/tasklist/);
  });

  it("never gives /teamrig, the teamrig plugin's own command, as the pane's, here or in the plugin README", () => {
    for (const text of [readme, pluginReadme]) assert.doesNotMatch(text, /`\/teamrig(?![\w-])/);
  });

  it('links the plugin README, CONTRIBUTING and the licence, and every local link resolves', () => {
    for (const path of ['plugins/teamrig-pane/README.md', 'CONTRIBUTING.md', 'LICENSE']) assert.ok(targets.includes(path), path);
    for (const target of targets.filter((path) => !/^https?:/.test(path))) assert.ok(existsSync(`${ROOT}${target}`), target);
  });

  it('tells how to update: refresh the marketplace, update the plugin, then reload or restart', () => {
    const [, update = ''] = readme.match(/\n## Update\n([\s\S]*?)\n## /) ?? [];
    assert.match(update, /```sh\nclaude plugin marketplace update teamrig-pane\nclaude plugin update teamrig-pane@teamrig-pane\n```/);
    assert.match(update, /`\/reload-plugins`[^.]*, or restart it/);
    assert.match(update, /auto-update/);
  });

  it('draws no pictographs (emoji)', () => {
    assert.doesNotMatch(readme, /\p{Extended_Pictographic}/u);
  });
});
