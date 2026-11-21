import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isRecord, recordField, stringField, type JsonRecord } from '../lib/guards.ts';

const read = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const workflow = read('.github/workflows/release.yml');

/** Each job's text, from its `  <id>:` line to the next job's. */
const jobs: ReadonlyMap<string, string> = new Map(
  (workflow.split(/^jobs:\n/m)[1] ?? '')
    .split(/^(?= {2}[\w-]+:$)/m)
    .map((block) => [/^ {2}([\w-]+):$/m.exec(block)?.[1] ?? '', block]),
);
const job = (id: string): string => {
  const text = jobs.get(id);
  assert.ok(text !== undefined, `release.yml has the job ${id}`);
  return text;
};

/** A job's own permissions block, as `name: level` lines; empty when it keeps the workflow's read-only token. */
const permissionsOf = (text: string): readonly string[] =>
  [...(/^ {4}permissions:\n((?: {6}.+\n)+)/m.exec(text)?.[1] ?? '').matchAll(/^ {6}(.+)$/gm)].map((match) => match[1] ?? '');

function readRecord(path: string): JsonRecord {
  const parsed: unknown = JSON.parse(read(path));
  assert.ok(isRecord(parsed), `${path} is a JSON object`);
  return parsed;
}

describe('release.yml', () => {
  it('runs on each push to main, and by hand, with a read-only token by default', () => {
    assert.match(workflow, /^on:\n(?: {2}#.*\n)*? {2}push:\n {4}branches: \[main\]\n {2}workflow_dispatch:\n/m);
    assert.match(workflow, /^permissions:\n {2}contents: read\n/m);
  });

  it('runs one release at a time and never cancels one half-way', () => {
    assert.match(workflow, /^concurrency:\n {2}group: release\n {2}cancel-in-progress: false\n/m);
  });

  it('has the release pull request job and the UI archive job, each stopping within 20 minutes', () => {
    assert.deepEqual([...jobs.keys()], ['release-please', 'ui-archive']);
    for (const id of jobs.keys()) assert.match(job(id), /^ {4}timeout-minutes: 20$/m, id);
  });

  it('builds the UI archive only after a run that published a release, from the released tag', () => {
    assert.match(
      job('release-please'),
      /^ {4}outputs:\n {6}release_created: \$\{\{ steps\.release\.outputs\.release_created \}\}\n {6}tag_name: \$\{\{ steps\.release\.outputs\.tag_name \}\}$/m,
    );
    const text = job('ui-archive');
    assert.match(text, /^ {4}needs: release-please\n {4}if: \$\{\{ needs\.release-please\.outputs\.release_created == 'true' \}\}$/m);
    assert.match(text, /^ {10}ref: \$\{\{ needs\.release-please\.outputs\.tag_name \}\}$/m);
    assert.match(text, /^ {6}- run: npm ci --ignore-scripts\n {6}- run: npm run ui:archive$/m);
  });

  it('hands the token that writes the release to the upload step alone, after the build', () => {
    const text = job('ui-archive');
    assert.deepEqual(permissionsOf(text), ['contents: write']);
    assert.match(text, /^ {10}persist-credentials: false$/m);
    assert.equal(text.match(/github\.token|GITHUB_TOKEN|GH_TOKEN/g)?.length, 2, 'the token is named once, in one env');
    const upload = text.slice(text.indexOf('      - name: add the archive to the release'));
    assert.match(upload, /^ {10}GH_TOKEN: \$\{\{ github\.token \}\}$/m);
    assert.ok(text.indexOf('npm run ui:archive') < text.indexOf('GH_TOKEN'), 'the build runs before any step holds the token');
  });

  it('adds the archive to the release by its tag as a plain value, and never replaces one', () => {
    const text = job('ui-archive');
    assert.match(text, /^ {8}run: gh release upload "\$TAG" \.tmp\/ui-archive\/teamrig-ui\.json --repo "\$GITHUB_REPOSITORY"$/m);
    assert.match(text, /^ {10}TAG: \$\{\{ needs\.release-please\.outputs\.tag_name \}\}$/m);
    assert.doesNotMatch(text, /^ *(?:- )?run:.*\$\{\{/m);
    assert.doesNotMatch(text, /^ *(?:- )?run:.*--clobber/m);
  });

  it('keeps the release pull request on main, with only the writes it needs', () => {
    const text = job('release-please');
    assert.match(text, /^ {4}if: \$\{\{ !github\.event\.repository\.private && github\.ref == 'refs\/heads\/main' \}\}$/m);
    assert.deepEqual(permissionsOf(text), ['actions: write', 'contents: write', 'pull-requests: write']);
    assert.match(text, /^ {10}config-file: release-please-config\.json\n {10}manifest-file: \.release-please-manifest\.json$/m);
  });

  it('runs ci.yml on the release pull request, which the job token cannot start by opening it', () => {
    assert.match(job('release-please'), /run: gh workflow run ci\.yml --repo "\$GITHUB_REPOSITORY" --ref "\$\(node -p 'JSON\.parse\(process\.env\.PR\)\.headBranchName'\)"\n/);
  });

  it('takes the release pull request in as a plain value, so a run that opens none still passes', () => {
    // A step's env is read even when its `if` skips it, and fromJSON of an empty output fails the job (teamrig run 44371173015).
    assert.match(job('release-please'), /^ {10}PR: \$\{\{ steps\.release\.outputs\.pr \}\}$/m);
    assert.doesNotMatch(workflow, /fromJSON\(/);
  });

  it('pins each action to a full commit sha and reads no secret', () => {
    for (const [, ref] of workflow.matchAll(/uses: [\w./-]+@(\S+)/g)) assert.match(ref ?? '', /^[0-9a-f]{40}$/);
    assert.doesNotMatch(workflow, /secrets\./);
  });
});

describe('release-please-config.json', () => {
  const config = readRecord('release-please-config.json');
  const root = recordField(recordField(config, 'packages') ?? {}, '.') ?? {};

  it("raises the version in plugin.json, the pane's one version file", () => {
    assert.deepEqual(root['extra-files'], [{ type: 'json', path: 'plugins/teamrig-pane/.claude-plugin/plugin.json', jsonpath: '$.version' }]);
  });

  it('tags main teamrig-pane-v<version>, leaving v<version> to a published build an install can pin', () => {
    assert.equal(stringField(root, 'component'), 'teamrig-pane');
    assert.equal(root['include-component-in-tag'], true);
  });

  it('raises the minor for a breaking change while the version is 0.x, as the patch is for a fix', () => {
    assert.equal(root['bump-minor-pre-major'], true);
    assert.equal(root['bump-patch-for-minor-pre-major'], undefined);
  });

  it('signs off its commits as the Actions bot, which the DCO gate reads as their author', () => {
    assert.equal(stringField(config, 'signoff'), 'github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>');
  });

  it('starts from a commit of main, not from the whole history', () => {
    assert.match(stringField(config, 'bootstrap-sha') ?? '', /^[0-9a-f]{40}$/);
  });

  it("holds main's version in its manifest, the one plugin.json holds: only a release pull request raises it", () => {
    const released = stringField(readRecord('.release-please-manifest.json'), '.') ?? '';
    assert.match(released, /^\d+\.\d+\.\d+$/);
    assert.equal(stringField(readRecord('plugins/teamrig-pane/.claude-plugin/plugin.json'), 'version'), released);
  });
});
