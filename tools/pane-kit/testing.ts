import { AssertionError } from 'node:assert';
import { describe as nodeDescribe, test as nodeTest } from 'node:test';
import { inspect } from 'node:util';

// The engine's `claude-code/testing` kit for node, so the coverage gate can measure the plugin code a test
// runs without the engine: describe, test and expect with the matchers plugins/teamrig-pane/typecheck
// declares, each as the engine's expect behaves. A test that takes the engine (`$`, `on`) runs only under
// `claude plugin test`; here it fails, saying so, rather than pass untested.

export function describe(name: string, body: () => void): void {
  nodeDescribe(name, body);
}

/** What node runs for a kit test: `body`, or a failure naming the policy entry when `body` takes the engine. */
export function nodeBody(name: string, body: (...engine: never[]) => unknown): () => Promise<void> {
  return async () => {
    if (body.length > 0) {
      throw new Error(`"${name}" takes the engine ($, on), so only \`claude plugin test\` runs it: list its file under the coverage policy's engineTests`);
    }
    await body();
  };
}

export function test(name: string, body: (...engine: never[]) => unknown): void {
  nodeTest(name, nodeBody(name, body));
}

const show = (value: unknown): string => inspect(value, { depth: 6, breakLength: Infinity });

const isObject = (value: unknown): value is object => typeof value === 'object' && value !== null;

/** The keys of an object whose values are defined: the engine's toEqual treats an undefined field as absent. */
const definedKeys = (value: object): string[] => Object.entries(value).filter(([, field]) => field !== undefined).map(([key]) => key);

const fieldOf = (value: object, key: string): unknown => Reflect.get(value, key);

const isIterable = (value: unknown): value is Iterable<unknown> => isObject(value) && typeof Reflect.get(value, Symbol.iterator) === 'function';

/** Deep equality as the engine's toEqual: undefined fields ignored, prototypes not compared, `-0` and `0` apart. */
export function equals(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (!isObject(a) || !isObject(b)) {
    return false;
  }
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && Object.is(a.getTime(), b.getTime());
  }
  if (a instanceof RegExp || b instanceof RegExp) {
    return a instanceof RegExp && b instanceof RegExp && a.source === b.source && a.flags === b.flags;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => equals(item, b[index]));
  }
  if (a instanceof Map || b instanceof Map) {
    return a instanceof Map && b instanceof Map && a.size === b.size && [...a].every(([key, item]) => b.has(key) && equals(item, b.get(key)));
  }
  if (a instanceof Set || b instanceof Set) {
    return a instanceof Set && b instanceof Set && a.size === b.size && [...a].every((item) => [...b].some((other) => equals(item, other)));
  }
  const keys = definedKeys(a);
  const others = definedKeys(b);
  return keys.length === others.length && keys.every((key) => others.includes(key) && equals(fieldOf(a, key), fieldOf(b, key)));
}

/** Whether `actual` holds everything `expected` names, as toMatchObject reads it: arrays item by item, objects field by field. */
export function matchesObject(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length && expected.every((item, index) => matchesObject(actual[index], item));
  }
  if (isObject(expected) && !(expected instanceof Date) && !(expected instanceof RegExp)) {
    return isObject(actual) && Object.keys(expected).every((key) => key in actual && matchesObject(fieldOf(actual, key), fieldOf(expected, key)));
  }
  return equals(actual, expected);
}

const lengthOf = (value: unknown): number | undefined => {
  if (typeof value === 'string' || Array.isArray(value)) {
    return value.length;
  }
  const length = isObject(value) ? fieldOf(value, 'length') : undefined;
  return typeof length === 'number' ? length : undefined;
};

const numberOf = (value: unknown, matcher: string): number => {
  if (typeof value !== 'number') {
    throw new TypeError(`${matcher} needs a number, got ${show(value)}`);
  }
  return value;
};

const contains = (actual: unknown, expected: unknown): boolean => {
  if (typeof actual === 'string') {
    return typeof expected === 'string' && actual.includes(expected);
  }
  if (isIterable(actual)) {
    return [...actual].some((item) => item === expected);
  }
  throw new TypeError(`toContain needs a string or an iterable, got ${show(actual)}`);
};

const thrownBy = (actual: unknown): { readonly threw: boolean; readonly error?: unknown } => {
  if (typeof actual !== 'function') {
    throw new TypeError(`toThrow needs a function, got ${show(actual)}`);
  }
  try {
    actual();
    return { threw: false };
  } catch (error) {
    return { threw: true, error };
  }
};

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const textMatches = (text: string, expected: RegExp | string): boolean => (typeof expected === 'string' ? text.includes(expected) : expected.test(text));

export interface Matchers {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toMatch(expected: RegExp | string): void;
  toMatchObject(expected: object): void;
  toContain(expected: unknown): void;
  toBeDefined(): void;
  toBeUndefined(): void;
  toBeNull(): void;
  toBeTruthy(): void;
  toBeFalsy(): void;
  toBeGreaterThan(expected: number): void;
  toBeGreaterThanOrEqual(expected: number): void;
  toBeLessThan(expected: number): void;
  toBeLessThanOrEqual(expected: number): void;
  toHaveLength(expected: number): void;
  toThrow(expected?: RegExp | string): void;
  readonly not: Matchers;
}

function matchers(actual: unknown, negated: boolean): Matchers {
  const check = (pass: boolean, matcher: string, expected: unknown, showExpected = true): void => {
    if (pass === negated) {
      const wanted = showExpected ? ` ${show(expected)}` : '';
      throw new AssertionError({ message: `expected ${show(actual)} ${negated ? 'not ' : ''}${matcher}${wanted}`, actual, expected, operator: matcher });
    }
  };
  return {
    toBe: (expected) => check(Object.is(actual, expected), 'toBe', expected),
    toEqual: (expected) => check(equals(actual, expected), 'toEqual', expected),
    toMatch: (expected) => check(typeof actual === 'string' && textMatches(actual, expected), 'toMatch', expected),
    toMatchObject: (expected) => check(matchesObject(actual, expected), 'toMatchObject', expected),
    toContain: (expected) => check(contains(actual, expected), 'toContain', expected),
    toBeDefined: () => check(actual !== undefined, 'toBeDefined', undefined, false),
    toBeUndefined: () => check(actual === undefined, 'toBeUndefined', undefined, false),
    toBeNull: () => check(actual === null, 'toBeNull', null, false),
    toBeTruthy: () => check(Boolean(actual), 'toBeTruthy', true, false),
    toBeFalsy: () => check(!actual, 'toBeFalsy', false, false),
    toBeGreaterThan: (expected) => check(numberOf(actual, 'toBeGreaterThan') > expected, 'toBeGreaterThan', expected),
    toBeGreaterThanOrEqual: (expected) => check(numberOf(actual, 'toBeGreaterThanOrEqual') >= expected, 'toBeGreaterThanOrEqual', expected),
    toBeLessThan: (expected) => check(numberOf(actual, 'toBeLessThan') < expected, 'toBeLessThan', expected),
    toBeLessThanOrEqual: (expected) => check(numberOf(actual, 'toBeLessThanOrEqual') <= expected, 'toBeLessThanOrEqual', expected),
    toHaveLength: (expected) => check(lengthOf(actual) === expected, 'toHaveLength', expected),
    toThrow: (expected) => {
      const outcome = thrownBy(actual);
      check(outcome.threw && (expected === undefined || textMatches(messageOf(outcome.error), expected)), 'toThrow', expected, expected !== undefined);
    },
    get not() {
      return matchers(actual, !negated);
    },
  };
}

export function expect(actual: unknown): Matchers {
  return matchers(actual, false);
}
