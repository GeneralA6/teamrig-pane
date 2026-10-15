import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ResolveFnOutput, ResolveHookContext } from 'node:module';
import { pathToFileURL } from 'node:url';
import { KIT_SPECIFIER, paneResolveHook, paneTarget } from './resolve.ts';

const KIT_URL = 'file:///kit/testing.ts';
const PARENT = pathToFileURL('/plugin/tests/pane.test.ts').href;

/** A file check over a fixed set of paths, slashes made forward so it reads the same on every OS. */
function filesAt(...paths: string[]): (path: string) => boolean {
  return (path) => paths.includes(path.replaceAll('\\', '/').replace(/^[A-Za-z]:/, ''));
}

/** A hook context with only the parent set, as node hands one to a resolve hook. */
function contextFrom(parentURL: string | undefined): ResolveHookContext {
  return { conditions: [], importAttributes: {}, parentURL };
}

describe('paneTarget', () => {
  it('points the engine’s test kit at the node kit', () => {
    assert.equal(paneTarget(KIT_SPECIFIER, PARENT, KIT_URL, filesAt()), KIT_URL);
    assert.equal(paneTarget(KIT_SPECIFIER, undefined, KIT_URL, filesAt()), KIT_URL);
  });

  it('finds a relative import named without its ending, in the order the engine tries them', () => {
    const target = paneTarget('../hooks/view', PARENT, KIT_URL, filesAt('/plugin/hooks/view.tsx', '/plugin/hooks/view/index.ts'));
    assert.equal(target, pathToFileURL('/plugin/hooks/view.tsx').href);
    assert.equal(paneTarget('./core', PARENT, KIT_URL, filesAt('/plugin/tests/core/index.ts')), pathToFileURL('/plugin/tests/core/index.ts').href);
  });

  it('leaves to node a specifier it resolves itself, or one with nothing behind it', () => {
    const any = filesAt('/plugin/hooks/view.ts');
    assert.equal(paneTarget('node:fs', PARENT, KIT_URL, any), undefined);
    assert.equal(paneTarget('../hooks/view.ts', PARENT, KIT_URL, any), undefined);
    assert.equal(paneTarget('../types.json', PARENT, KIT_URL, any), undefined);
    assert.equal(paneTarget('../hooks/view', undefined, KIT_URL, any), undefined);
    assert.equal(paneTarget('../hooks/view', 'data:text/javascript,', KIT_URL, any), undefined);
    assert.equal(paneTarget('../hooks/missing', PARENT, KIT_URL, any), undefined);
  });
});

describe('paneResolveHook', () => {
  it('short-circuits what it finds and hands the rest to node’s resolver', () => {
    const asked: string[] = [];
    const next = (specifier: string): ResolveFnOutput => {
      asked.push(specifier);
      return { url: `node:${specifier}` };
    };
    const hook = paneResolveHook(KIT_URL, filesAt());
    assert.deepEqual(hook(KIT_SPECIFIER, contextFrom(PARENT), next), { url: KIT_URL, shortCircuit: true });
    assert.deepEqual(hook('fs', contextFrom(PARENT), next), { url: 'node:fs' });
    assert.deepEqual(asked, ['fs']);
  });

  it('checks the disk by default', () => {
    const next = (specifier: string): ResolveFnOutput => ({ url: specifier });
    const hook = paneResolveHook(KIT_URL);
    assert.deepEqual(hook('./resolve', contextFrom(import.meta.url), next), { url: new URL('./resolve.ts', import.meta.url).href, shortCircuit: true });
  });
});
