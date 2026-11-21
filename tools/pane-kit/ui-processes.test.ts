import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Processes } from '../../plugins/teamrig-pane/ui/processes.ts';

// The dedicated UI's process port runs real programs, so a plugin spec (which also runs under the engine's runner,
// with no `node:` module) cannot hold it: these run `node` children.
const NODE = process.execPath;
/** Long past a cold start of `node` on a loaded host. */
const TIMEOUT_MS = 60_000;
/** A child that never ends by itself. */
const WAITS = ['-e', 'setInterval(() => {}, 1000)'];
const HERE = fileURLToPath(new URL('.', import.meta.url));

/** The words that run `script` in a `node` child. */
const node = (script: string): string[] => [NODE, '-e', script];

describe('the programs the UI runs', () => {
  it('answers a run with its exit code and what it wrote on each stream', async () => {
    const run = await new Processes().run(node("process.stdout.write('out'); process.stderr.write('err'); process.exitCode = 3"), {
      timeoutMs: TIMEOUT_MS,
    });
    assert.deepEqual(run, { exitCode: 3, stdout: 'out', stderr: 'err', isStdoutTruncated: false });
  });

  it('runs in the folder it is given', async () => {
    const run = await new Processes().run(node('process.stdout.write(process.cwd())'), { cwd: HERE, timeoutMs: TIMEOUT_MS });
    assert.equal(realpathSync(run.stdout), realpathSync(HERE));
  });

  it('cuts stdout at the cap and says so; stdout that fits is whole', async () => {
    const cut = await new Processes(4).run(node("process.stdout.write('123456')"), { timeoutMs: TIMEOUT_MS });
    assert.deepEqual([cut.stdout, cut.isStdoutTruncated], ['1234', true]);
    const whole = await new Processes(6).run(node("process.stdout.write('123456')"), { timeoutMs: TIMEOUT_MS });
    assert.deepEqual([whole.stdout, whole.isStdoutTruncated], ['123456', false]);
  });

  it('rejects a program that cannot start, and an empty command', async () => {
    const processes = new Processes();
    await assert.rejects(processes.run(['teamrig-pane-no-such-program'], { timeoutMs: TIMEOUT_MS }), /ENOENT/);
    await assert.rejects(processes.run([], { timeoutMs: TIMEOUT_MS }), /no program to run/);
  });

  it('stops a run that outlasts its time, and rejects naming it', async () => {
    await assert.rejects(new Processes().run([NODE, ...WAITS], { timeoutMs: 300 }), /gave no answer in 300 ms/);
  });

  it('stops every run under way when told to, and runs none after', async () => {
    const processes = new Processes();
    const first = processes.run([NODE, ...WAITS], { timeoutMs: TIMEOUT_MS });
    const second = processes.run([NODE, ...WAITS], { timeoutMs: TIMEOUT_MS });
    processes.stopAll();
    const ends = await Promise.allSettled([first, second]);
    assert.deepEqual(
      ends.map(end => end.status === 'rejected' && /was stopped by/.test(String(end.reason))),
      [true, true],
    );
    await assert.rejects(processes.run(node(''), { timeoutMs: TIMEOUT_MS }), /the program is ending/);
  });
});
