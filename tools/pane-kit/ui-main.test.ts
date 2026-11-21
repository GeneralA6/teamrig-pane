import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The dedicated UI's entry takes the terminal as it loads, so no test can import it: this one runs it as the
// program it is, a `node` process on piped streams, under the kit that resolves the plugin's imports.
const MAIN = fileURLToPath(new URL('../../plugins/teamrig-pane/ui/main.ts', import.meta.url));
const KIT = new URL('./register.ts', import.meta.url).href;

const ESC = '\u001b';
/** The alternate screen taken and given back (ui/terminal.ts ENTER, LEAVE). */
const TAKEN = `${ESC}[?1049h`;
const GIVEN_BACK = `${ESC}[?1049l`;
/** How a frame starts: the cursor sent to the first cell. */
const FRAME = `${ESC}[H`;
/** Long past a cold start on a loaded host; a run that reaches it is killed and fails on its exit code. */
const LIMIT_MS = 60_000;

interface Ended {
  readonly code: number | null;
  readonly out: string;
  readonly err: string;
}

/** Runs the entry, sends `keys` once it drew its first frame, and resolves how it ended. */
function ranWith(keys: string): Promise<Ended> {
  return new Promise<Ended>((resolve, reject) => {
    // A child of a test inherits NODE_TEST_CONTEXT, which is for the runner's own children.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT'));
    const child = spawn(process.execPath, [`--import=${KIT}`, MAIN], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let isSent = false;
    const limit = setTimeout(() => child.kill(), LIMIT_MS);
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      out += chunk;
      if (!isSent && out.includes(FRAME)) {
        isSent = true;
        child.stdin.write(keys);
      }
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      err += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(limit);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(limit);
      resolve({ code, out, err });
    });
  });
}

describe('the dedicated UI entry under node', () => {
  it('takes the screen, draws, and on q gives it back and exits 0', async () => {
    const ended = await ranWith('q');
    assert.equal(ended.err, '');
    assert.equal(ended.code, 0);
    assert.ok(ended.out.startsWith(TAKEN), 'the alternate screen is taken first');
    assert.ok(ended.out.includes(FRAME), 'a frame is drawn');
    assert.ok(ended.out.endsWith(GIVEN_BACK), 'the alternate screen is given back last');
  });

  it('ends on Ctrl+C read as a key, the terminal given back', async () => {
    const ended = await ranWith('\u0003');
    assert.equal(ended.err, '');
    assert.equal(ended.code, 0);
    assert.ok(ended.out.endsWith(GIVEN_BACK), 'the alternate screen is given back last');
  });
});
