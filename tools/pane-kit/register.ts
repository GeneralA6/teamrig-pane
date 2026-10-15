import { registerHooks } from 'node:module';
import { paneResolveHook } from './resolve.ts';

// Loaded with `--import` by the coverage gate's plugin run, before any plugin test: from here on a plugin
// test's `claude-code/testing` is the node kit, and its extensionless imports resolve as the engine resolves them.
registerHooks({ resolve: paneResolveHook(new URL('./testing.ts', import.meta.url).href) });
