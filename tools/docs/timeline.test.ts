import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ascending, keyframesIn, rulesIn, valueOf } from './stylesheet.ts';
import { FADE, Timeline } from './timeline.ts';

const CLOCK = { loop: 10, end: 9, rest: 8 } as const;

describe('Timeline', () => {
  it('refuses a clock whose rest, end and loop are out of order', () => {
    for (const clock of [
      { loop: 10, end: 9, rest: 0 },
      { loop: 10, end: 9, rest: 9 },
      { loop: 10, end: 10, rest: 8 },
    ]) {
      assert.throws(() => new Timeline(clock), RangeError);
    }
  });

  it('names its classes a0, a1, ... in the order they are made, and writes nothing before', () => {
    const t = new Timeline(CLOCK);
    assert.equal(t.css(), '');
    assert.equal(t.show(1), 'a0');
    assert.equal(t.show(2, { to: 4 }), 'a1');
    assert.equal(t.css().split('\n').length, 4);
  });
});

describe('Timeline.show', () => {
  it('fades and rises in, holds, then fades and sinks out, on keyframes that ascend', () => {
    const t = new Timeline(CLOCK);
    t.show(2, { to: 5 });
    assert.equal(
      t.css().split('\n')[0],
      '@keyframes a0{0%,20.000%{opacity:0;transform:translateY(5px)}23.000%,47.000%{opacity:1;transform:translateY(0)}50.000%,100%{opacity:0;transform:translateY(5px)}}',
    );
    const stops = keyframesIn(t.css()).get('a0')?.stops ?? [];
    assert.equal(stops.length, 6);
    assert.ok(ascending(stops), stops.join(' '));
  });

  it('only fades, with no movement, for the fade motion', () => {
    const t = new Timeline(CLOCK);
    t.show(2, { to: 5, motion: 'fade' });
    assert.doesNotMatch(t.css(), /transform/);
  });

  it('shows its part still when the rest moment falls in [from, to), and runs the class on the loop', () => {
    const t = new Timeline(CLOCK);
    const shown = [t.show(1), t.show(8, { to: 8.7 }), t.show(1, { to: 8 }), t.show(8.2)];
    const rules = rulesIn(t.css());
    const opacity = shown.map((name) => valueOf(rules.get(`.${name}`) ?? '', 'opacity'));
    assert.deepEqual(opacity, ['1', '1', '0', '0']);
    assert.equal(valueOf(rules.get('.a0') ?? '', 'animation'), 'a0 10s linear infinite');
  });

  it('shows a part until the clock ends unless told otherwise', () => {
    const t = new Timeline(CLOCK);
    t.show(1);
    assert.match(t.css(), /87\.000%\{opacity:1;transform:translateY\(0\)\}90\.000%,100%/);
  });

  it(`refuses a window of ${2 * FADE}s or less, one that starts at 0 or one that runs past the loop`, () => {
    const t = new Timeline(CLOCK);
    assert.throws(() => t.show(2, { to: 2 + 2 * FADE }), /needs more than 0.6s inside the 10s loop/);
    assert.throws(() => t.show(0, { to: 3 }), RangeError);
    assert.throws(() => t.show(5, { to: 10 }), RangeError);
    assert.doesNotThrow(() => t.show(2, { to: 2.61 }));
  });
});
