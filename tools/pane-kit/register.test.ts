import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import './register.ts';
import * as kit from './testing.ts';

// Imported by name, so TypeScript reads it as a string node resolves at run time, through the hook register.ts adds.
const KIT_MODULE = 'claude-code/testing';
const EXTENSIONLESS = './resolve';

describe('register', () => {
  it('gives a plugin test the node kit for the engine’s test kit, and its extensionless imports', async () => {
    const loaded: unknown = await import(KIT_MODULE);
    const resolve: unknown = await import(EXTENSIONLESS);
    assert.equal(typeof loaded === 'object' && loaded !== null ? Reflect.get(loaded, 'expect') : undefined, kit.expect);
    assert.equal(typeof resolve === 'object' && resolve !== null ? typeof Reflect.get(resolve, 'paneTarget') : undefined, 'function');
  });
});
