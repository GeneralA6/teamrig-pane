import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describe as kitDescribe, equals, expect, matchesObject, nodeBody, test as kitTest } from './testing.ts';

class Point {
  readonly x: number;
  constructor(x: number) {
    this.x = x;
  }
}

describe('the kit’s describe and test', () => {
  const ran: string[] = [];
  kitDescribe('a kit suite', () => {
    kitTest('a kit test runs its body under node', async () => {
      ran.push('ran');
      assert.deepEqual(ran, ['ran']);
    });
  });

  it('runs a body that takes nothing, awaiting it', async () => {
    const seen: string[] = [];
    await nodeBody('plain', async () => {
      seen.push('body');
    })();
    assert.deepEqual(seen, ['body']);
  });

  it('fails a body that takes the engine, naming the policy entry', async () => {
    const takesEngine = (engine: never): never => engine;
    await assert.rejects(nodeBody('engine test', takesEngine), /"engine test" takes the engine \(\$, on\).*engineTests/);
  });
});

describe('equals', () => {
  it('holds a value equal to itself, NaN too, and keeps -0 and 0 apart', () => {
    assert.equal(equals(1, 1), true);
    assert.equal(equals(Number.NaN, Number.NaN), true);
    assert.equal(equals(-0, 0), false);
    assert.equal(equals('a', 'b'), false);
    assert.equal(equals(1, { a: 1 }), false);
    assert.equal(equals(null, {}), false);
  });

  it('compares dates by their time and patterns by source and flags', () => {
    assert.equal(equals(new Date(5), new Date(5)), true);
    assert.equal(equals(new Date(5), new Date(6)), false);
    assert.equal(equals(new Date(5), {}), false);
    assert.equal(equals(/a/g, /a/g), true);
    assert.equal(equals(/a/g, /a/i), false);
    assert.equal(equals({}, /a/), false);
  });

  it('compares arrays item by item', () => {
    assert.equal(equals([1, [2]], [1, [2]]), true);
    assert.equal(equals([1], [1, 2]), false);
    assert.equal(equals([1, 2], [1, 3]), false);
    assert.equal(equals([], {}), false);
  });

  it('compares maps by key and value, and sets by their members', () => {
    assert.equal(equals(new Map([['a', { b: 1 }]]), new Map([['a', { b: 1 }]])), true);
    assert.equal(equals(new Map([['a', 1]]), new Map([['b', 1]])), false);
    assert.equal(equals(new Map([['a', 1]]), new Map()), false);
    assert.equal(equals(new Map(), {}), false);
    assert.equal(equals(new Set([{ a: 1 }]), new Set([{ a: 1 }])), true);
    assert.equal(equals(new Set([1]), new Set([2])), false);
    assert.equal(equals(new Set([1]), new Set([1, 2])), false);
    assert.equal(equals({}, new Set()), false);
  });

  it('reads an undefined field as absent and does not compare prototypes', () => {
    assert.equal(equals({ a: 1, b: undefined }, { a: 1 }), true);
    assert.equal(equals({ a: 1 }, { b: 1 }), false);
    assert.equal(equals({ a: 1 }, { a: 1, b: 2 }), false);
    assert.equal(equals(new Point(1), { x: 1 }), true);
  });
});

describe('matchesObject', () => {
  it('holds an object with every field the expected names, nested', () => {
    assert.equal(matchesObject({ a: 1, b: { c: 2, d: 3 } }, { b: { c: 2 } }), true);
    assert.equal(matchesObject({ a: 1 }, { b: undefined }), false);
    assert.equal(matchesObject({ a: 1 }, { a: 2 }), false);
    assert.equal(matchesObject(1, { a: 1 }), false);
  });

  it('reads arrays item by item at their full length, and dates and patterns by equality', () => {
    assert.equal(matchesObject([{ a: 1, b: 2 }], [{ a: 1 }]), true);
    assert.equal(matchesObject([{ a: 1 }], [{ a: 1 }, { a: 2 }]), false);
    assert.equal(matchesObject({ length: 1 }, [1]), false);
    assert.equal(matchesObject({ at: new Date(1) }, { at: new Date(1) }), true);
    assert.equal(matchesObject(/a/, /a/), true);
  });
});

describe('expect', () => {
  it('passes each matcher that holds', () => {
    expect(1).toBe(1);
    expect({ a: [1] }).toEqual({ a: [1] });
    expect('a pane').toMatch(/pane/);
    expect('a pane').toMatch('pan');
    expect({ a: 1, b: 2 }).toMatchObject({ a: 1 });
    expect('a pane').toContain('pane');
    expect(new Set(['a'])).toContain('a');
    expect(0).toBeDefined();
    expect(undefined).toBeUndefined();
    expect(null).toBeNull();
    expect('x').toBeTruthy();
    expect('').toBeFalsy();
    expect(2).toBeGreaterThan(1);
    expect(2).toBeGreaterThanOrEqual(2);
    expect(1).toBeLessThan(2);
    expect(2).toBeLessThanOrEqual(2);
    expect('ab').toHaveLength(2);
    expect([1]).toHaveLength(1);
    expect({ length: 3 }).toHaveLength(3);
    expect(() => {
      throw new Error('locked');
    }).toThrow();
    expect(() => {
      throw new Error('file locked');
    }).toThrow('locked');
    expect(() => {
      throw 'plain locked';
    }).toThrow(/locked/);
  });

  it('fails a matcher that does not hold, showing the value and what was wanted', () => {
    assert.throws(() => expect(1).toBe(2), { name: 'AssertionError', message: 'expected 1 toBe 2' });
    assert.throws(() => expect(undefined).toBeDefined(), { message: 'expected undefined toBeDefined' });
    expect(null).toBeDefined();
    assert.throws(() => expect(1).toBeNull(), { message: 'expected 1 toBeNull' });
    assert.throws(() => expect(1).toMatch('a'), { message: "expected 1 toMatch 'a'" });
    assert.throws(() => expect(5).toHaveLength(1), { message: 'expected 5 toHaveLength 1' });
    assert.throws(() => expect({}).toHaveLength(0), { message: 'expected {} toHaveLength 0' });
    assert.throws(() => expect(() => undefined).toThrow(), { message: 'expected [Function (anonymous)] toThrow' });
    assert.throws(
      () =>
        expect(() => {
          throw new Error('other');
        }).toThrow('locked'),
      { message: "expected [Function (anonymous)] toThrow 'locked'" },
    );
  });

  it('turns each matcher around under not', () => {
    expect(1).not.toBe(2);
    expect(1).not.not.toBe(1);
    expect([1]).not.toContain(2);
    assert.throws(() => expect(1).not.toBe(1), { message: 'expected 1 not toBe 1' });
    assert.throws(() => expect(undefined).not.toBeUndefined(), { message: 'expected undefined not toBeUndefined' });
  });

  it('refuses a value a matcher cannot weigh', () => {
    assert.throws(() => expect('2').toBeGreaterThan(1), { name: 'TypeError', message: "toBeGreaterThan needs a number, got '2'" });
    assert.throws(() => expect(null).toBeLessThan(1), { name: 'TypeError', message: 'toBeLessThan needs a number, got null' });
    assert.throws(() => expect(1).toContain(1), { name: 'TypeError', message: 'toContain needs a string or an iterable, got 1' });
    assert.throws(() => expect({ a: 1 }).toContain(1), { name: 'TypeError' });
    assert.throws(() => expect('ab').toThrow(), { name: 'TypeError', message: "toThrow needs a function, got 'ab'" });
    assert.throws(() => expect('ab').toContain(1), { message: "expected 'ab' toContain 1" });
  });
});
