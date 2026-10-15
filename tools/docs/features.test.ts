import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURES, FEATURES_HEIGHT, renderFeatures } from './features.ts';
import { animationsIn } from './stylesheet.ts';
import { themeStyle, TOKENS } from './theme.ts';
import { parseXml, placesIn, textOf } from './xml.ts';

const svg = renderFeatures();
const root = parseXml(svg);
const places = placesIn(root);
const css = textOf(places.find((place) => place.element.name === 'style')?.element ?? '');
const number = (value: string | undefined): number => Number(value ?? Number.NaN);

describe('renderFeatures', () => {
  it('draws the same bytes every time, as well-formed XML', () => {
    assert.equal(renderFeatures(), svg);
    assert.equal(root.name, 'svg');
  });

  it('names the picture for screen readers: role, aria-label and a matching title', () => {
    const label = root.attributes.get('aria-label') ?? '';
    assert.equal(root.attributes.get('role'), 'img');
    assert.ok(label.startsWith('What teamrig-pane does for you: Your tasks, always in view. Docked beside the conversation, '), label);
    assert.ok(label.endsWith('Fast, and costs no tokens. It reads files, never the model, and only when they change.'), label);
    assert.equal(textOf(places.find((place) => place.element.name === 'title')?.element ?? ''), label);
  });

  it('writes every card: its title and its lines, each card with its own icon', () => {
    const words = places.filter((place) => place.element.name === 'text').map((place) => textOf(place.element));
    assert.deepEqual(words, FEATURES.flatMap((feature) => [feature.title, ...feature.lines]));
    assert.equal(new Set(FEATURES.map((feature) => feature.icon)).size, FEATURES.length);
  });

  it('keeps every title and line short enough for its card', () => {
    for (const feature of FEATURES) {
      assert.ok(feature.title.length <= 26, feature.title);
      for (const line of feature.lines) assert.ok(line.length <= 38, line);
    }
  });

  it('lays the cards out in rows of three that fill the picture and never overlap', () => {
    const cards = places.filter((place) => place.element.attributes.get('class') === 'card').map(({ element }) => {
      const [x, y] = [number(element.attributes.get('x')), number(element.attributes.get('y'))];
      return { x, y, right: x + number(element.attributes.get('width')), bottom: y + number(element.attributes.get('height')) };
    });
    assert.equal(cards.length, FEATURES.length);
    assert.equal(FEATURES_HEIGHT, 416);
    assert.equal(root.attributes.get('height'), String(FEATURES_HEIGHT));
    assert.ok(cards.every((card) => card.x >= 0 && card.y >= 0 && card.right <= 960 && card.bottom <= FEATURES_HEIGHT));
    for (const [i, a] of cards.entries()) {
      for (const b of cards.slice(i + 1)) assert.ok(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y, `cards ${i} and ${cards.indexOf(b)} overlap`);
    }
  });

  it('opens its stylesheet with the theme, colours only with its tokens, and does not move', () => {
    assert.ok(css.trimStart().startsWith(themeStyle().join('\n')));
    for (const [, name = ''] of css.matchAll(/var\(--([\w-]+)\)/g)) assert.ok(Object.hasOwn(TOKENS, name), `--${name}`);
    assert.equal(animationsIn(css).size, 0);
  });

  it('draws no pictographs (emoji)', () => {
    assert.doesNotMatch(svg, /\p{Extended_Pictographic}/u);
  });
});
