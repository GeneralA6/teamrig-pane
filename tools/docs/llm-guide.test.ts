import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The LLM guide (the plugin's teamrig-pane-guide skill) and the root llms.txt, held to the code: every form of the
 * command, every key, variable, setting and limit the guide names is the one the pane's hooks hold, each documented
 * once; the requirements match the CI pins; and every link resolves. The hooks run in Claude Code's runtime, which
 * node cannot load, so their constants are read from the source text.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PLUGIN = 'plugins/teamrig-pane';
const SKILL_NAME = 'teamrig-pane-guide';
const GUIDE = `${PLUGIN}/skills/${SKILL_NAME}`;
const BLOB = 'https://github.com/GeneralA6/teamrig-pane/blob/main/';
const TEAMRIG_GUIDE = 'https://github.com/GeneralA6/teamrig/blob/main/plugins/teamrig/skills/teamrig-guide/SKILL.md';
const MAX_DESCRIPTION_WORDS = 30;
const NO_EMOJI = /\p{Emoji_Presentation}|\u{FE0F}/u;

interface Doc {
  readonly path: string;
  readonly text: string;
}

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

const guide: readonly Doc[] = readdirSync(join(ROOT, GUIDE))
  .filter((name) => name.endsWith('.md'))
  .sort()
  .map((name) => ({ path: `${GUIDE}/${name}`, text: read(`${GUIDE}/${name}`) }));
const llms: Doc = { path: 'llms.txt', text: read('llms.txt') };
const all = guide.map((doc) => doc.text).join('\n');

function guideText(name: string): string {
  const doc = guide.find((file) => file.path === `${GUIDE}/${name}`);
  if (doc === undefined) {
    throw new Error(`${GUIDE}/${name} is missing`);
  }
  return doc.text;
}

const skill = guideText('SKILL.md');
const reference = guideText('reference.md');

/** The first capture of `pattern` in a hook's source, or a failure naming what moved. */
function captured(file: string, pattern: RegExp): string {
  const value = pattern.exec(read(`${PLUGIN}/hooks/${file}`))?.[1];
  if (value === undefined) {
    throw new Error(`${file} no longer matches ${pattern.source}: update this test with the code`);
  }
  return value;
}

/** A numeric constant of a hook, `NAME = 8` or `NAME = 60_000`. */
function constant(file: string, name: string): number {
  return Number(captured(file, new RegExp(`const ${name} = ([\\d_]+)\\b`)).replaceAll('_', ''));
}

/** The cells of the guide's table rows whose first cell matches `first`. */
function rowsStarting(text: string, first: RegExp): string[] {
  return text.split(/\r?\n/).flatMap((row) => {
    const cell = /^\| ([^|]+?) \|/.exec(row)?.[1];
    return cell !== undefined && first.test(cell) ? [cell] : [];
  });
}

/** The table row whose first cell is `label`; it must be there once. */
function row(text: string, label: string): string {
  const rows = text.split(/\r?\n/).filter((line) => line.startsWith(`| ${label} |`));
  assert.equal(rows.length, 1, `one row for ${label}`);
  return rows[0] ?? '';
}

/** A heading's anchor as GitHub writes it. */
function anchorOf(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');
}

function anchors(text: string): Set<string> {
  return new Set(Array.from(text.matchAll(/^#{1,6} (.+)$/gm), (match) => anchorOf(match[1] ?? '')));
}

describe('the pane guide documents the command', () => {
  const command = captured('command.ts', /export const COMMAND = '([^']+)'/);
  const forms = captured('command.ts', /export const ARGUMENT_HINT = '\[([^\]]+)\]'/).split(' | ');

  it('gives the usage line as the pane answers it', () => {
    assert.ok(skill.includes(`/${command} [${forms.join(' | ')}]`));
    assert.ok(skill.includes(`usage: /${command} [${forms.join(' | ')}]`));
  });

  it('has one row per form of the command, and none the command does not take', () => {
    const documented = rowsStarting(skill, new RegExp(`^\`/${command}( [^\`]+)?\`$`)).map((cell) => cell.slice(command.length + 2, -1).trim());
    assert.deepEqual([...documented].sort(), ['', ...forms].sort());
  });

  it('names the dock width the command checks', () => {
    const dock = constant('command.ts', 'DOCK_MIN_COLUMNS');
    assert.ok(skill.includes(`${dock} columns to dock`), `the requirements name ${dock} columns`);
    assert.ok(skill.includes(`the side dock needs ${dock}.`), 'the example reason is the one the command gives');
  });
});

describe('the pane guide documents the keys', () => {
  it("lists each hotkey of the pane, the status bar's counts' too, and no letter it does not bind", () => {
    const register = read(`${PLUGIN}/hooks/register.tsx`);
    const fixed = Array.from(register.matchAll(/hotkey="([a-z])"/g), (match) => match[1] ?? '');
    const counts = Array.from(read(`${PLUGIN}/hooks/status-bar.ts`).matchAll(/hotkey: '([a-z])'/g), (match) => match[1] ?? '');
    const bound = [...fixed, ...counts].sort();
    const documented = rowsStarting(skill, /^`[a-z]`$/).map((cell) => cell.slice(1, -1)).sort();
    assert.ok(fixed.length > 0, 'register.tsx binds hotkeys');
    assert.ok(counts.length > 0, 'status-bar.ts gives each count a key');
    assert.ok(register.includes('hotkey={piece.hotkey}'), "register.tsx binds the counts' keys");
    assert.deepEqual(documented, bound);
  });
});

describe('the pane guide documents where the register is', () => {
  const variables = Array.from(read(`${PLUGIN}/hooks/places.ts`).matchAll(/'(TEAMRIG_[A-Z_]+)'/g), (match) => match[1] ?? '');

  it('names every variable the pane reads, and none it does not', () => {
    assert.ok(variables.length > 0, 'places.ts names its variables');
    const named = new Set(Array.from(all.matchAll(/\bTEAMRIG_[A-Z_]+\b/g), (match) => match[0]));
    assert.deepEqual([...named].filter((name) => !variables.includes(name)), []);
    assert.deepEqual(variables.filter((name) => !named.has(name)), []);
  });

  it('gives each pane variable its row in the settings table', () => {
    for (const name of variables.filter((variable) => variable.startsWith('TEAMRIG_PANE_'))) {
      assert.ok(row(reference, `\`${name}\``) !== '', name);
    }
  });

  it('names every key the settings file takes', () => {
    const keys = captured('places.ts', /const SETTING_KEYS = \[([^\]]+)\]/)
      .split(',')
      .map((key) => key.trim().replaceAll("'", ''));
    for (const key of keys) {
      assert.ok(reference.includes(`| \`${key}\` |`), key);
    }
    assert.ok(reference.includes(`(known: ${keys.join(', ')})`), 'the unknown-key warning lists them as the pane does');
  });
});

describe('the pane guide states the limits the code holds', () => {
  const limits: readonly (readonly [label: string, values: readonly number[]])[] = [
    ['One file read', [Number(captured('source.ts', /const MAX_READ_BYTES = (\d+) \* 1024 \* 1024\b/))]],
    ['Polls', [constant('live.ts', 'POLL_MS') / 1000, constant('live.ts', 'TICK_MS') / 1000]],
    ['`Waiting`, asked of others', [constant('view.ts', 'MAX_ASKED')]],
    ['`Done today`', [constant('view.ts', 'MAX_FINISHED')]],
    ['Above the prompt', [constant('register.tsx', 'INLINE_MAX_ROWS'), constant('status-bar.ts', 'INLINE_LIST_ROWS')]],
    ['Dock', [constant('register.tsx', 'DOCK_COLUMNS'), constant('command.ts', 'DOCK_MIN_COLUMNS')]],
    ['Changes, per repo', [constant('changes.ts', 'CHANGES_KEPT')]],
    ['Changes, outside any repo', [constant('changes.ts', 'OUTSIDE_KEPT')]],
    ['One git run', [constant('register.tsx', 'GIT_TIMEOUT_MS') / 1000]],
    ['Quoted ref', [constant('details.ts', 'MAX_QUOTED_LINES'), constant('details.ts', 'MAX_QUOTE_CHARS')]],
    ['Card links', [constant('links.ts', 'MAX_LINKS'), constant('links.ts', 'MAX_ADDRESS_CHARS')]],
    ['Search results', [constant('search.ts', 'MAX_RESULTS')]],
  ];

  for (const [label, values] of limits) {
    it(`names ${label}: ${values.join(', ')}`, () => {
      const cells = row(reference, label);
      for (const value of values) {
        assert.ok(Number.isFinite(value) && value > 0, `${label} reads a number from the code`);
        assert.match(cells, new RegExp(`\\b${value}\\b`), `${label} names ${value}`);
      }
    });
  }
});

describe('the pane guide skill', () => {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skill)?.[1] ?? '';
  const description = /^description:\s*(.+)$/m.exec(front)?.[1]?.trim() ?? '';

  it('is named after its folder', () => {
    assert.equal(/^name:\s*(\S+)\s*$/m.exec(front)?.[1], SKILL_NAME);
  });

  it(`has a plain description of at most ${MAX_DESCRIPTION_WORDS} words`, () => {
    assert.ok(description !== '', 'SKILL.md has a description');
    assert.ok(description.split(/\s+/).length <= MAX_DESCRIPTION_WORDS, `${description.split(/\s+/).length} words`);
    assert.doesNotMatch(description, /:\s/, 'no ": ", so it stays a plain YAML value');
  });

  it("never gives /teamrig, the teamrig plugin's own name, as the pane's command", () => {
    assert.doesNotMatch(all, /`\/teamrig(?![\w-])/);
  });

  it('links the teamrig guide', () => {
    assert.ok(skill.includes(TEAMRIG_GUIDE));
  });

  it('has no emoji', () => {
    assert.deepEqual(
      [...guide, llms].filter((doc) => NO_EMOJI.test(doc.text)).map((doc) => doc.path),
      [],
    );
  });

  it('has relative links and anchors that resolve', () => {
    const problems = guide.flatMap((doc) =>
      Array.from(doc.text.matchAll(/\]\(([\w.-]+\.md)(?:#([\w-]+))?\)/g), (match) => {
        const target = `${GUIDE}/${match[1] ?? ''}`;
        const anchor = match[2];
        if (!existsSync(join(ROOT, target))) {
          return `${doc.path}: ${target} does not exist`;
        }
        return anchor === undefined || anchors(read(target)).has(anchor) ? undefined : `${doc.path}: ${target} has no #${anchor}`;
      }).filter((problem) => problem !== undefined),
    );
    assert.deepEqual(problems, []);
  });
});

describe('llms.txt', () => {
  it('only links: a title, a one-line summary, headings and link bullets', () => {
    const other = llms.text
      .split(/\r?\n/)
      .filter((line) => line !== '' && !/^# \S/.test(line) && !/^> \S/.test(line) && !/^## \S/.test(line) && !/^- \[[^\]]+\]\(https:\/\/[^)]+\)/.test(line));
    assert.deepEqual(other, []);
  });

  it('links every guide file, and each link into this repository resolves', () => {
    assert.deepEqual(
      guide.filter((doc) => !llms.text.includes(`${BLOB}${doc.path})`)).map((doc) => doc.path),
      [],
    );
    const missing = Array.from(llms.text.matchAll(/https:\/\/github\.com\/GeneralA6\/teamrig-pane\/blob\/main\/([^)\s#]+)/g), (match) => match[1] ?? '').filter(
      (path) => !existsSync(join(ROOT, path)),
    );
    assert.deepEqual(missing, []);
  });

  it('links the teamrig guide', () => {
    assert.ok(llms.text.includes(TEAMRIG_GUIDE));
  });
});

describe('the requirements in the pane guide', () => {
  const ci = read('.github/workflows/ci.yml');
  const requirements = row(skill, 'Claude Code');

  it('name the Claude Code release CI tests the plugin on', () => {
    const pinned = /@anthropic-ai\/claude-code@([\d.]+)/.exec(ci)?.[1];
    assert.ok(pinned !== undefined, 'ci.yml pins Claude Code');
    assert.match(requirements, new RegExp(`${pinned.replaceAll('.', '\\.')} or later`));
  });

  it('name the Node.js version package.json requires', () => {
    const node = /"node":\s*">=([\d.]+)"/.exec(read('package.json'))?.[1];
    assert.ok(node !== undefined, 'package.json gives engines.node as >=x.y');
    assert.ok(row(skill, 'Node.js').includes(`${node} or later`));
  });

  it('name the operating systems and Node.js versions CI tests on', () => {
    const list = (key: string): string[] =>
      (new RegExp(`^\\s*${key}: \\[([^\\]]+)\\]`, 'm').exec(ci)?.[1] ?? '').split(',').map((item) => item.trim().replace(/-latest$/, ''));
    const systems = list('os');
    const nodes = list('node');
    assert.ok(systems.length > 1 && nodes.length > 1, 'ci.yml has an os and node matrix');
    const cells = row(skill, 'Operating system');
    assert.ok(cells.includes(`CI runs the tests on ${systems.slice(0, -1).join(', ')} and ${systems.at(-1) ?? ''}`), `names ${systems.join(', ')}`);
    assert.ok(cells.includes(`Node ${nodes.join(' and ')}`), `names Node ${nodes.join(' and ')}`);
  });

  it('say how to turn on the fullscreen layout the dock needs', () => {
    const reason = captured('command.ts', /The side dock needs the fullscreen layout \(("tui": "fullscreen") in/);
    assert.ok(skill.includes(`add \`${reason}\``));
    assert.ok(skill.includes('~/.claude/settings.json'));
  });
});
