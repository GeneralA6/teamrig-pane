import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { contrast, mix } from './colour.ts';
import {
  AREA,
  CAPTIONS,
  CHANGE_COLUMNS,
  CHANGED,
  DIFF_HINT,
  DONE_TODAY,
  HERO_CLOCK,
  HERO_STEPS,
  PALETTE,
  PANE_CHAR,
  PANE_COLUMNS,
  PANE_X,
  REPO,
  renderHero,
  SECTIONS,
  STATUS_COLOR,
} from './hero.ts';
import { animationsIn, ascending, keyframesIn, mediaIn, rulesIn, valueOf } from './stylesheet.ts';
import { themeStyle, TOKENS } from './theme.ts';
import { FADE } from './timeline.ts';
import { parseXml, placesIn, textOf, type XmlElement, type XmlPlace } from './xml.ts';

const svg = renderHero();
const root = parseXml(svg);
const places = placesIn(root);
const css = textOf(places.find((place) => place.element.name === 'style')?.element ?? '');
const rules = rulesIn(css);
const frames = keyframesIn(css);

const classesOf = (element: XmlElement | undefined): string[] => (element?.attributes.get('class') ?? '').split(/\s+/).filter((name) => name !== '');
const animationOf = (element: XmlElement | undefined): string => classesOf(element).find((name) => /^a\d+$/.test(name)) ?? '';
const parts = (name: string): XmlPlace[] => places.filter((place) => place.element.attributes.get('data-part') === name);
const part = (name: string): XmlElement | undefined => parts(name)[0]?.element;
const inPart = (place: XmlPlace, name: string): boolean => place.path.some((element) => element.attributes.get('data-part') === name);
const texts = (name: string): string[] =>
  places.filter((place) => place.element.name === 'text' && inPart(place, name)).map((place) => textOf(place.element));

/** Seen in the still picture (motion off): every class on the element or above it that sets an opacity sets 1. */
const still = (place: XmlPlace): boolean =>
  place.path.every((element) => classesOf(element).every((name) => (valueOf(rules.get(`.${name}`) ?? '', 'opacity') ?? '1') === '1'));

/** An animation's keyframe stops in seconds: hidden until [1], shown from [2] to [3], hidden again from [4]. */
const secondsOf = (name: string): number[] => (frames.get(name)?.stops ?? []).map((stop) => (stop * HERO_CLOCK.loop) / 100);
const close = (a: number | undefined, b: number | undefined): boolean => a !== undefined && b !== undefined && Math.abs(a - b) < 0.01;
/** When a part shows and hides again, in seconds. */
const shown = (element: XmlElement | undefined): [number | undefined, number | undefined] => {
  const stops = secondsOf(animationOf(element));
  return [stops[1], stops[4]];
};

const number = (element: XmlElement, name: string): number => Number(element.attributes.get(name) ?? Number.NaN);
/** A text's spans: their words, their fill, and whether they are bold. */
const spansIn = (element: XmlElement | undefined): (readonly [string, string | undefined, boolean])[] =>
  (element?.children ?? [])
    .filter((node): node is XmlElement => typeof node !== 'string')
    .map((node): readonly [string, string | undefined, boolean] => [textOf(node), node.attributes.get('fill'), node.attributes.get('font-weight') === '600']);
/** The Tasks view's text that reads `words`. */
const taskText = (words: string): XmlElement | undefined =>
  places.find((place) => inPart(place, 'tasks') && place.element.name === 'text' && textOf(place.element) === words)?.element;

/** The pane's character for each status mark the picture draws as a shape (rows.ts GLYPH). */
const MARKS = new Map([
  ['open', '○'],
  ['in-progress', '◐'],
  ['waiting', '■'],
  ['done', '✓'],
]);
const STATUS_COLORS = new Map<string, string>(Object.entries(STATUS_COLOR));

/** Something drawn in a view of the pane, set in the pane's columns: a text, or a status mark as the pane's character. */
interface Cell {
  readonly y: number;
  readonly column: number;
  readonly text: string;
}

/** A row of a view of the pane as the terminal draws it, on its baseline. */
interface PaneRow {
  readonly y: number;
  readonly text: string;
}

/**
 * Every text of a view (`tasks` or `changes`) at the column it starts in (an end-anchored one ending at its x) on its
 * baseline, and every status mark at the column it is centred on, on the baseline of its row. The switch's labels are
 * left out: they sit centred on their buttons, not on the pane's grid.
 */
function cellsIn(part: string): Cell[] {
  return places
    .filter((place) => inPart(place, part))
    .flatMap(({ element }): Cell[] => {
      const status = element.attributes.get('data-glyph');
      if (status !== undefined) {
        const [, x = '', y = ''] = /^translate\(([\d.]+) ([\d.]+)\)$/.exec(element.attributes.get('transform') ?? '') ?? [];
        return [{ y: Number(y) + 5, column: (Number(x) - PANE_X) / PANE_CHAR - 0.5, text: MARKS.get(status) ?? '?' }];
      }
      const anchor = element.attributes.get('text-anchor');
      if (element.name !== 'text' || anchor === 'middle') return [];
      const text = textOf(element);
      return [{ y: number(element, 'y'), column: (number(element, 'x') - PANE_X) / PANE_CHAR - (anchor === 'end' ? text.length : 0), text }];
    });
}

/** A view as the terminal's rows, top to bottom: each cell's characters in their columns, spaces between. */
function rowsOf(drawn: readonly Cell[]): PaneRow[] {
  return [...new Set(drawn.map((cell) => cell.y))]
    .sort((a, b) => a - b)
    .map((y) => {
      const chars: string[] = [];
      for (const cell of drawn.filter((each) => each.y === y)) {
        [...cell.text].forEach((char, i) => {
          chars[Math.round(cell.column) + i] = char;
        });
      }
      return { y, text: Array.from({ length: chars.length }, (_, i) => chars[i] ?? ' ').join('') };
    });
}

const cells = cellsIn('tasks');
/** The Tasks view as the terminal's rows. */
const paneRows = rowsOf(cells);

describe('renderHero', () => {
  it('draws the same bytes every time, as well-formed XML', () => {
    assert.equal(renderHero(), svg);
    assert.equal(root.name, 'svg');
  });

  it('names the picture for screen readers: role, aria-label and a matching title', () => {
    const label = root.attributes.get('aria-label') ?? '';
    assert.equal(root.attributes.get('role'), 'img');
    assert.match(label, /^Claude Code in its fullscreen layout\. Beside the conversation, teamrig-pane docks the session's tasks in sections, /);
    assert.ok(
      label.includes(
        'Working on: T12 Signup form (p1, in progress since 11:55). Up next: T14 Form tests (p2, after T12, new). ' +
          'Waiting: T9 Email check (p2, waiting since 10:20: on T13). Asked of others: T13 Mail key (api\'s, p2, due Thu 10-22). ' +
          'Done today: T11 Signup API, done at 09:40.',
      ),
      label,
    );
    assert.match(label, /flips the pane to the 3 files changed in the session's repo, and back\.$/);
    assert.equal(textOf(places.find((place) => place.element.name === 'title')?.element ?? ''), label);
  });

  it('runs every animated class on keyframes that exist and ascend from 0% to 100%, and uses every class it defines', () => {
    const animated = animationsIn(css);
    assert.equal(animated.size, 6);
    for (const [selector, name] of animated) {
      const stops = frames.get(name)?.stops ?? [];
      assert.ok(ascending(stops), `${selector}: ${stops.join(' ')}`);
      assert.deepEqual([stops[0], stops.at(-1)], [0, 100], selector);
    }
    const used = new Set(places.flatMap((place) => classesOf(place.element)).filter((name) => /^a\d+$/.test(name)));
    assert.deepEqual([...used].sort(), [...animated.values()].sort());
  });

  it('stops all motion when the reader asks for reduced motion', () => {
    assert.equal(mediaIn(css).get('(prefers-reduced-motion:reduce)'), '*{animation:none!important}');
  });

  it('shows the window, then the tasks, then Changes, then the tasks again, and fades it all out together', () => {
    assert.ok(close(shown(part('window'))[0], HERO_STEPS.window));
    assert.ok(close(shown(part('tasks'))[0], HERO_STEPS.tasks));
    assert.ok(HERO_STEPS.window < HERO_STEPS.tasks && HERO_STEPS.tasks < HERO_STEPS.changes && HERO_STEPS.changes < HERO_STEPS.back);
    const [from, to] = shown(part('changes'));
    assert.ok(close(from, HERO_STEPS.changes) && close(to, HERO_STEPS.back), `${from} ${to}`);
    for (const name of ['window', 'tasks']) assert.ok(close(shown(part(name))[1], HERO_CLOCK.end), name);
  });

  it('captions each view while it shows, one caption at a time', () => {
    const captions = parts('caption').map((place) => [textOf(place.element), ...shown(place.element)] as const);
    assert.deepEqual(
      captions.map(([words]) => words),
      [CAPTIONS.tasks, CAPTIONS.changes, CAPTIONS.tasks],
    );
    assert.ok(close(captions[0]?.[1], HERO_STEPS.tasks) && close(captions[1]?.[1], HERO_STEPS.changes) && close(captions[2]?.[1], HERO_STEPS.back));
    for (let i = 1; i < captions.length; i += 1) {
      const before = captions[i - 1]?.[2] ?? Infinity;
      const next = captions[i]?.[1] ?? -Infinity;
      assert.ok(before <= next, `caption ${i - 1} hides at ${before}s, after caption ${i} shows at ${next}s`);
    }
  });

  it('rests on the tasks with their caption: after Changes has faded, and before the loop clears', () => {
    assert.ok(HERO_STEPS.back + FADE < HERO_CLOCK.rest && HERO_CLOCK.rest < HERO_CLOCK.end);
    for (const name of ['window', 'tasks']) assert.ok(parts(name).every(still), name);
    assert.ok(!parts('changes').some(still));
    assert.deepEqual(
      parts('caption').filter(still).map((place) => textOf(place.element)),
      [CAPTIONS.tasks],
    );
  });

  it("draws the tasks as the pane's rows: a header naming no area, then Working on, Up next, Waiting, Asked of others and Done today", () => {
    assert.deepEqual(
      paneRows.map((row) => row.text),
      [
        '3 active',
        'Working on (1)',
        '◐ T12  Signup form',
        '       p1 · in progress since 11:55',
        'Up next (1)',
        '○ T14  Form tests',
        '       p2 · after T12 · new',
        'Waiting (1)',
        '■ T9  Email check',
        '      p2 · waiting since 10:20: on T13',
        'Asked of others (1)',
        '○ T13  Mail key',
        "       api's · p2 · due Thu 10-22",
        'Done today (1)',
        '✓ T11  Signup API                09:40',
      ],
    );
    assert.deepEqual(
      SECTIONS.map((section) => section.name),
      ['Working on', 'Up next', 'Waiting', 'Asked of others'],
    );
    assert.equal(DONE_TODAY.length, 1);
  });

  it("sets every part on the pane's column grid, within its columns, and nothing over anything else", () => {
    assert.equal(PANE_COLUMNS, 38);
    for (const cell of cells) assert.ok(Math.abs(cell.column - Math.round(cell.column)) < 1e-9, `${cell.text}: column ${cell.column}`);
    for (const row of paneRows) assert.ok(row.text.length <= PANE_COLUMNS, `${row.text.length} columns: ${row.text}`);
    for (const row of paneRows) {
      const spans = cells.filter((cell) => cell.y === row.y).map((cell) => [Math.round(cell.column), Math.round(cell.column) + cell.text.length] as const);
      for (const [i, [from, to]] of spans.entries()) {
        for (const [other, next] of spans.slice(i + 1)) assert.ok(to <= other || next <= from, row.text);
      }
    }
  });

  it('spaces the rows a line apart at least, a heading further from what is above it than a task, and keeps them inside the pane', () => {
    const above = paneRows.slice(1).map((row, i) => ({ text: row.text, gap: row.y - (paneRows[i]?.y ?? 0) }));
    const gaps = (pattern: RegExp): number[] => above.filter((row) => pattern.test(row.text)).map((row) => row.gap);
    const headings = gaps(/^\S.* \(\d+\)$/);
    const titles = gaps(/^[○◐■✓] /);
    const metas = gaps(/^ /);
    assert.deepEqual([headings.length, titles.length, metas.length], [5, 5, 4]);
    assert.ok(Math.min(...metas) >= 16, metas.join(' '));
    assert.ok(Math.min(...titles) > Math.max(...metas), titles.join(' '));
    assert.ok(Math.min(...headings) > Math.max(...titles), headings.join(' '));
    const pane = places.find((place) => inPart(place, 'pane') && place.element.name === 'rect')?.element;
    const bottom = pane === undefined ? Number.NaN : number(pane, 'y') + number(pane, 'height');
    assert.ok((paneRows.at(-1)?.y ?? Infinity) + 16 <= bottom, `last row at ${paneRows.at(-1)?.y}, pane ends at ${bottom}`);
  });

  it("colours each mark by its status, keeps each id bold in the text colour, and dims the meta line but where it needs a look", () => {
    const marks = places.filter((place) => inPart(place, 'tasks') && place.element.attributes.has('data-glyph')).map((place) => place.element);
    assert.deepEqual(
      marks.map((mark) => mark.attributes.get('data-glyph')),
      [...SECTIONS.flatMap((section) => section.tasks.map((task) => task.status)), ...DONE_TODAY.map(() => 'done')],
    );
    for (const mark of marks) {
      const status = mark.attributes.get('data-glyph') ?? '';
      const colours = placesIn(mark)
        .flatMap((inner) => [inner.element.attributes.get('fill'), inner.element.attributes.get('stroke')])
        .filter((color): color is string => color !== undefined && color !== 'none');
      assert.deepEqual([...new Set(colours)], [STATUS_COLORS.get(status)], status);
    }
    assert.deepEqual(
      [STATUS_COLOR.open, STATUS_COLOR['in-progress'], STATUS_COLOR.waiting, STATUS_COLOR.done],
      [PALETTE.fg, PALETTE.amber, PALETTE.red, PALETTE.green],
    );
    assert.deepEqual(spansIn(taskText('T12')), [['T12', PALETTE.fg, true]]);
    assert.deepEqual(spansIn(taskText('Signup form')), [['Signup form', PALETTE.fg, false]]);
    assert.deepEqual(spansIn(taskText('p1 · in progress since 11:55')), [
      ['p1', PALETTE.muted, false],
      [' · ', PALETTE.muted, false],
      ['in progress since 11:55', PALETTE.muted, false],
    ]);
    assert.deepEqual(spansIn(taskText('p2 · after T12 · new')), [
      ['p2', PALETTE.muted, false],
      [' · ', PALETTE.muted, false],
      ['after T12', PALETTE.muted, false],
      [' · ', PALETTE.muted, false],
      ['new', PALETTE.blue, false],
    ]);
    assert.deepEqual(spansIn(taskText('p2 · waiting since 10:20: on T13')), [
      ['p2', PALETTE.muted, false],
      [' · ', PALETTE.muted, false],
      ['waiting since 10:20: on T13', PALETTE.red, false],
    ]);
    assert.deepEqual(spansIn(taskText("api's · p2 · due Thu 10-22")).map(([words, fill]) => [words, fill]), [
      ["api's", PALETTE.muted],
      [' · ', PALETTE.muted],
      ['p2', PALETTE.muted],
      [' · ', PALETTE.muted],
      ['due Thu 10-22', PALETTE.muted],
    ]);
  });

  it('draws a task done today dim on one line, its tick green and the time it closed at the right edge', () => {
    for (const words of ['T11', 'Signup API', '09:40']) assert.deepEqual(spansIn(taskText(words)), [[words, PALETTE.muted, false]], words);
    assert.equal(taskText('09:40')?.attributes.get('text-anchor'), 'end');
    assert.equal(Number(taskText('09:40')?.attributes.get('x')), PANE_X + PANE_COLUMNS * PANE_CHAR);
  });

  it("heads the list with the session's active count alone, naming no area and no inbox, and each section with its name and count", () => {
    assert.deepEqual(spansIn(taskText('3 active')), [['3 active', PALETTE.muted, false]]);
    assert.equal(texts('window').filter((words) => words === AREA).length, 1, 'only the tab names the area');
    for (const [name, count] of [['Working on', 1], ['Up next', 1], ['Waiting', 1], ['Asked of others', 1], ['Done today', 1]] as const) {
      assert.deepEqual(spansIn(taskText(`${name} (${count})`)), [
        [name, PALETTE.fg, true],
        [` (${count})`, PALETTE.muted, false],
      ]);
    }
  });

  it('starts each rule a gap after its measured line', () => {
    const measured = places.filter((place) => place.element.attributes.has('textLength'));
    assert.equal(measured.length, 2);
    for (const place of measured) {
      const words = textOf(place.element);
      const length = words.length * PANE_CHAR;
      assert.equal(place.element.attributes.get('textLength'), length.toFixed(1), words);
      const rule = places.slice(places.indexOf(place)).find((next) => next.element.name === 'path');
      const from = Number(place.element.attributes.get('x')) + length + 8;
      assert.match(rule?.element.attributes.get('d') ?? '', new RegExp(`^M${from.toFixed(1)} `), words);
    }
  });

  it('flips to Changes: the switch counts the files, a ruled repo header, the hint, and what changed in words coloured as the pane colours them', () => {
    assert.deepEqual(texts('changes').slice(0, 4), ['Tasks', `Changes ${CHANGED.length}`, `${REPO.name} · branch ${REPO.branch} · ${CHANGED.length} files`, DIFF_HINT]);
    const fillOf = (words: string): string | undefined => {
      const text = places.find((place) => inPart(place, 'changes') && place.element.name === 'text' && textOf(place.element) === words);
      const first = (text?.element.children ?? []).find((node): node is XmlElement => typeof node !== 'string');
      return first?.attributes.get('fill');
    };
    assert.deepEqual(
      [DIFF_HINT, 'added', 'changed', 'new'].map(fillOf),
      [PALETTE.muted, PALETTE.green, PALETTE.amber, PALETTE.muted],
    );
    for (const file of CHANGED) assert.ok(texts('changes').some((text) => text.startsWith(`${file.path} +${file.added}`)), file.path);
    const cover = places.find((place) => inPart(place, 'changes') && place.element.name === 'rect');
    assert.equal(cover?.element.attributes.get('fill'), PALETTE.panel);
  });

  it("sets each file's row as the pane draws it: its word in a column of its own, so the paths line up, within the pane's columns", () => {
    const rows = rowsOf(cellsIn('changes')).map((row) => row.text);
    assert.deepEqual(rows.slice(2), [
      'added    src/signup.ts +42 (staged)',
      'changed  src/routes.ts +18 -3',
      'new      signup.md +9 (not in git yet)',
    ]);
    assert.ok(rows.slice(2).every((row) => row.length <= PANE_COLUMNS && row.slice(CHANGE_COLUMNS - 1, CHANGE_COLUMNS) === ' '), rows.join('\n'));
  });

  it("ends each file with its lines, added in green and removed in red as the pane colours them, then what the pane adds, dim", () => {
    const spansOf = (path: string): (readonly [string, string | undefined])[] => {
      const text = places.find((place) => inPart(place, 'changes') && place.element.name === 'text' && textOf(place.element).startsWith(path));
      return (text?.element.children ?? []).filter((node): node is XmlElement => typeof node !== 'string').map((node): readonly [string, string | undefined] => [textOf(node), node.attributes.get('fill')]);
    };
    assert.deepEqual(spansOf('src/routes.ts'), [['src/routes.ts', PALETTE.fg], [' +18', PALETTE.green], [' -3', PALETTE.red]]);
    assert.deepEqual(spansOf('signup.md'), [['signup.md', PALETTE.fg], [' +9', PALETTE.green], [' (not in git yet)', PALETTE.muted]]);
  });

  it('fills the button of the view it shows', () => {
    const primary = (view: string): (string | undefined)[] =>
      places
        .filter((place) => place.element.attributes.get('data-button') === view)
        .map((place) => (inPart(place, 'tasks') ? 'tasks' : 'changes') + ':' + (place.element.attributes.get('fill') ?? ''));
    assert.deepEqual(primary('tasks'), [`tasks:${PALETTE.lead}`, 'changes:none']);
    assert.deepEqual(primary('changes'), ['tasks:none', `changes:${PALETTE.lead}`]);
  });

  it('opens its stylesheet with the theme, colours only with its tokens, and leaves the captions to the theme', () => {
    assert.ok(css.trimStart().startsWith(themeStyle().join('\n')));
    for (const [, name = ''] of css.matchAll(/var\(--([\w-]+)\)/g)) assert.ok(Object.hasOwn(TOKENS, name), `--${name}`);
    for (const place of parts('caption')) assert.equal(place.element.attributes.get('fill'), undefined);
  });

  it("colours every word in the window itself, in tspans, so the theme's text colour never reaches it", () => {
    const windowTexts = places.filter((place) => place.element.name === 'text' && inPart(place, 'window'));
    assert.ok(windowTexts.length > 20);
    for (const place of windowTexts) {
      for (const node of place.element.children) {
        if (typeof node === 'string') assert.equal(node.trim(), '', textOf(place.element));
        else assert.ok(node.name === 'tspan' && node.attributes.has('fill'), textOf(place.element));
      }
    }
  });

  it('keeps every word in the window readable on the window and the pane, and a filled button readable too', () => {
    const tspans = places.filter((place) => place.element.name === 'tspan' && inPart(place, 'window'));
    assert.ok(tspans.every((place) => !place.element.attributes.has('fill-opacity')));
    const colours = new Set(tspans.map((place) => place.element.attributes.get('fill') ?? ''));
    assert.deepEqual([...colours].sort(), [PALETTE.amber, PALETTE.blue, PALETTE.fg, PALETTE.green, PALETTE.muted, PALETTE.red].sort());
    for (const colour of colours) {
      for (const ground of [PALETTE.bg, PALETTE.panel]) assert.ok(contrast(colour, ground) >= 4.5, `${colour} on ${ground}`);
    }
    assert.ok(contrast(PALETTE.fg, mix(PALETTE.lead, PALETTE.panel, 0.2)) >= 4.5);
  });

  it('draws no pictographs (emoji), and draws the status marks as shapes, not characters', () => {
    assert.doesNotMatch(svg, /\p{Extended_Pictographic}/u);
    assert.doesNotMatch(svg, /[○◐■✓✗▸▾↳│─]/u);
  });
});
