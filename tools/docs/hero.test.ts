import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { contrast, mix } from './colour.ts';
import {
  ACTIVE,
  AREA,
  ASKED,
  CAPTIONS,
  CHANGED,
  FINISHED,
  HERO_CLOCK,
  HERO_STEPS,
  PALETTE,
  PANE_CHAR,
  REPO,
  renderHero,
  STATUS_COLOR,
  UNREAD,
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

describe('renderHero', () => {
  it('draws the same bytes every time, as well-formed XML', () => {
    assert.equal(renderHero(), svg);
    assert.equal(root.name, 'svg');
  });

  it('names the picture for screen readers: role, aria-label and a matching title', () => {
    const label = root.attributes.get('aria-label') ?? '';
    assert.equal(root.attributes.get('role'), 'img');
    assert.match(label, /^Claude Code in its fullscreen layout\. Beside the conversation, teamrig-pane docks the session's tasks: /);
    assert.match(label, /T12 Signup form, in progress; T14 Form tests, open; T15 Email check, waiting\./);
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

  it("draws the tasks as the pane does: the area's header, active tasks in plan order, then each section", () => {
    const words = texts('tasks');
    assert.deepEqual(words.slice(2), [
      `${AREA} · ${ACTIVE.length} active · inbox ${UNREAD} unread`,
      'T12 p1 10-16 Signup form',
      'T14 p2 NEW Form tests',
      'T15 p2 Email check',
      'waits on the mail key',
      `asked of others (${ASKED.length})`,
      'T13 →api p2 Mail key',
      `finished today (${FINISHED.length})`,
      'T11 Signup API',
    ]);
    const glyphs = places.filter((place) => inPart(place, 'tasks') && place.element.attributes.has('data-glyph'));
    assert.deepEqual(
      glyphs.map((place) => place.element.attributes.get('data-glyph')),
      [...ACTIVE, ...ASKED, ...FINISHED].map((task) => task.status),
    );
  });

  it('colours each active glyph and id by its status, and dims a finished task throughout', () => {
    const glyphColor = (status: string): string[] =>
      places
        .filter((place) => inPart(place, 'tasks') && place.element.attributes.get('data-glyph') === status)
        .flatMap((place) => placesIn(place.element).flatMap((inner) => [inner.element.attributes.get('fill'), inner.element.attributes.get('stroke')]))
        .filter((color): color is string => color !== undefined && color !== 'none');
    for (const task of ACTIVE) assert.ok(glyphColor(task.status).every((color) => color === STATUS_COLOR[task.status]), task.id);
    assert.ok(glyphColor('done').every((color) => color === PALETTE.muted));
    const finished = places.find((place) => place.element.name === 'text' && textOf(place.element) === 'T11 Signup API');
    const fills = (finished?.element.children ?? []).filter((node): node is XmlElement => typeof node !== 'string').map((node) => node.attributes.get('fill'));
    assert.deepEqual([...new Set(fills)], [PALETTE.muted]);
  });

  it('starts each rule a gap after its measured line', () => {
    const measured = places.filter((place) => place.element.attributes.has('textLength'));
    assert.equal(measured.length, 4);
    for (const place of measured) {
      const words = textOf(place.element);
      const length = words.length * PANE_CHAR;
      assert.equal(place.element.attributes.get('textLength'), length.toFixed(1), words);
      const rule = places.slice(places.indexOf(place)).find((next) => next.element.name === 'path');
      const from = Number(place.element.attributes.get('x')) + length + 8;
      assert.match(rule?.element.attributes.get('d') ?? '', new RegExp(`^M${from.toFixed(1)} `), words);
    }
  });

  it('flips to Changes: the switch counts the files, a ruled repo header, and git codes coloured as the pane colours them', () => {
    assert.deepEqual(texts('changes').slice(0, 3), ['Tasks', `Changes Δ${CHANGED.length}`, `${REPO.name} · ${REPO.branch} · ${CHANGED.length} changed`]);
    const fillOf = (words: string): string | undefined => {
      const text = places.find((place) => inPart(place, 'changes') && place.element.name === 'text' && textOf(place.element) === words);
      const first = (text?.element.children ?? []).find((node): node is XmlElement => typeof node !== 'string');
      return first?.attributes.get('fill');
    };
    assert.deepEqual(
      ['A', 'M', '??'].map(fillOf),
      [PALETTE.green, PALETTE.amber, PALETTE.muted],
    );
    for (const file of CHANGED) assert.ok(texts('changes').some((text) => text.startsWith(`${file.path} +${file.added}`)), file.path);
    const cover = places.find((place) => inPart(place, 'changes') && place.element.name === 'rect');
    assert.equal(cover?.element.attributes.get('fill'), PALETTE.panel);
  });

  it("ends each file with its lines, added in green and removed in red as the pane colours them", () => {
    const spansOf = (path: string): (readonly [string, string | undefined])[] => {
      const text = places.find((place) => inPart(place, 'changes') && place.element.name === 'text' && textOf(place.element).startsWith(path));
      return (text?.element.children ?? []).filter((node): node is XmlElement => typeof node !== 'string').map((node): readonly [string, string | undefined] => [textOf(node), node.attributes.get('fill')]);
    };
    assert.deepEqual(spansOf('src/signup.ts'), [['src/signup.ts', PALETTE.fg], [' +18', PALETTE.green], [' -3', PALETTE.red]]);
    assert.deepEqual(spansOf('docs/signup.md'), [['docs/signup.md', PALETTE.fg], [' +12', PALETTE.green]]);
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

  it('draws no pictographs (emoji), and draws the status glyphs, marker and note arrow as shapes, not characters', () => {
    assert.doesNotMatch(svg, /\p{Extended_Pictographic}/u);
    assert.doesNotMatch(svg, /[○◐■✓✗▸▾↳│─]/u);
  });
});
