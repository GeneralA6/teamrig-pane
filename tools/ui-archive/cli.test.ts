import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARCHIVE_FORMAT, ARCHIVE_NAME, isArchivePath, sha256Of, type UiArchive } from './archive.ts';
import { ENTRY } from './build.ts';

// The archive is proven as it is used: built from this tree by the tool, written out file by file as `teamrig ui`
// will, and started with plain `node`, no kit and no loader, on piped streams.
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CLI = fileURLToPath(new URL('./cli.ts', import.meta.url));

const ESC = '\u001b';
/** The alternate screen taken and given back (ui/terminal.ts ENTER, LEAVE). */
const TAKEN = `${ESC}[?1049h`;
const GIVEN_BACK = `${ESC}[?1049l`;
/** How a frame starts: the cursor sent to the first cell. */
const FRAME = `${ESC}[H`;
/** Long past a cold start on a loaded host; a run that reaches it is killed and fails on its exit code. */
const LIMIT_MS = 60_000;

/** A child of a test inherits NODE_TEST_CONTEXT, which is for the runner's own children. */
function childEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT'));
}

function isUiArchive(value: unknown): value is UiArchive {
  if (typeof value !== 'object' || value === null) return false;
  if (!('format' in value) || value.format !== ARCHIVE_FORMAT) return false;
  if (!('version' in value) || typeof value.version !== 'string') return false;
  if (!('entry' in value) || typeof value.entry !== 'string') return false;
  if (!('files' in value) || !Array.isArray(value.files)) return false;
  return value.files.every(
    (file: unknown) =>
      typeof file === 'object' && file !== null && 'path' in file && typeof file.path === 'string' && 'text' in file && typeof file.text === 'string',
  );
}

interface Ended {
  readonly code: number | null;
  readonly out: string;
  readonly err: string;
}

/** Runs `node` on `script`, sends `keys` once it drew its first frame, and resolves how it ended. */
function ranWith(script: string, keys: string): Promise<Ended> {
  return new Promise<Ended>((done, reject) => {
    const child = spawn(process.execPath, [script], { env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
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
      done({ code, out, err });
    });
  });
}

describe('the ui archive tool', () => {
  let folder = '';
  let printed = '';
  let status: number | null = null;

  before(() => {
    folder = mkdtempSync(join(tmpdir(), 'teamrig-ui-archive-'));
    const run = spawnSync(process.execPath, [CLI, '--out', join(folder, 'out')], { cwd: ROOT, env: childEnv(), encoding: 'utf8' });
    printed = `${run.stdout}${run.stderr}`;
    status = run.status;
  });

  after(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  function archiveRead(): { text: string; archive: UiArchive } {
    const text = readFileSync(join(folder, 'out', ARCHIVE_NAME), 'utf8');
    const archive: unknown = JSON.parse(text);
    assert.ok(isUiArchive(archive), 'the file is an archive of this format');
    return { text, archive };
  }

  it('builds the archive of this tree and prints the sha256 of its bytes', () => {
    assert.equal(status, 0, printed);
    const { text, archive } = archiveRead();
    assert.match(printed, /^ui archive: \d+ file\(s\) of \d+\.\d+\.\d+, \d+ import\(s\) completed, in /);
    assert.ok(printed.includes(`sha256 ${sha256Of(text)}\n`), printed);
    assert.equal(archive.entry, ENTRY);
    assert.ok(archive.files.some((file) => file.path === ENTRY));
    assert.ok(archive.files.every((file) => isArchivePath(file.path)));
    assert.deepEqual(
      archive.files.filter((file) => !file.path.endsWith('.js')).map((file) => file.path),
      ['package.json'],
    );
  });

  it('holds a program plain node runs: it takes the screen, draws, and on q gives it back and exits 0', async () => {
    const { archive } = archiveRead();
    const unpacked = join(folder, 'unpacked');
    for (const file of archive.files) {
      const path = join(unpacked, ...file.path.split('/'));
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, file.text, 'utf8');
    }
    const ended = await ranWith(join(unpacked, ...archive.entry.split('/')), 'q');
    assert.equal(ended.err, '');
    assert.equal(ended.code, 0);
    assert.ok(ended.out.startsWith(TAKEN), 'the alternate screen is taken first');
    assert.ok(ended.out.includes(FRAME), 'a frame is drawn');
    assert.ok(ended.out.endsWith(GIVEN_BACK), 'the alternate screen is given back last');
  });

  it('says the emit failed and writes no archive where tsc cannot run: a folder that is no checkout', () => {
    const elsewhere = join(folder, 'elsewhere');
    mkdirSync(elsewhere);
    const run = spawnSync(process.execPath, [CLI, '--out', 'out'], { cwd: elsewhere, env: childEnv(), encoding: 'utf8' });
    assert.equal(run.status, 1, `${run.stdout}${run.stderr}`);
    assert.match(run.stdout, /^ui archive: the emit failed \(tsc exit 1\):\n/);
    assert.equal(existsSync(join(elsewhere, 'out')), false);
  });

  it('refuses a word it does not know', () => {
    const run = spawnSync(process.execPath, [CLI, '--into', 'x'], { cwd: ROOT, env: childEnv(), encoding: 'utf8' });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /ui-archive: usage: node tools\/ui-archive\/cli\.ts \[--out <folder>\]/);
  });
});
