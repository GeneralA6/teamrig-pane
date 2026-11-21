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

  it('has the release pull request job and the UI archive build and upload jobs, each stopping within 20 minutes', () => {
    assert.deepEqual([...jobs.keys()], ['release-please', 'ui-archive-build', 'ui-archive-upload']);
    for (const id of jobs.keys()) assert.match(job(id), /^ {4}timeout-minutes: 20$/m, id);
  });

  it('builds the UI archive only after a run that published a release, from the released tag', () => {
    assert.match(
      job('release-please'),
      /^ {4}outputs:\n {6}release_created: \$\{\{ steps\.release\.outputs\.release_created \}\}\n {6}tag_name: \$\{\{ steps\.release\.outputs\.tag_name \}\}$/m,
    );
    const text = job('ui-archive-build');
    assert.match(text, /^ {4}needs: release-please\n {4}if: \$\{\{ needs\.release-please\.outputs\.release_created == 'true' \}\}$/m);
    assert.match(text, /^ {10}ref: \$\{\{ needs\.release-please\.outputs\.tag_name \}\}$/m);
    assert.match(text, /^ {6}- run: npm ci --ignore-scripts\n {6}- run: npm run ui:archive$/m);
  });

  it('builds with the read-only token, which it never names or keeps in the checkout', () => {
    const text = job('ui-archive-build');
    assert.deepEqual(permissionsOf(text), []);
    assert.match(text, /^ {10}persist-credentials: false$/m);
    assert.doesNotMatch(text, /github\.token|GITHUB_TOKEN|GH_TOKEN/);
  });

  it("hands the build's archive and its sha256 to the upload job", () => {
    const text = job('ui-archive-build');
    assert.match(text, /^ {4}outputs:\n {6}sha256: \$\{\{ steps\.hash\.outputs\.sha256 \}\}$/m);
    assert.match(text, /^ {6}- id: hash\n {8}run: echo "sha256=\$\(sha256sum \.tmp\/ui-archive\/teamrig-ui\.json \| cut -d' ' -f1\)" \| tee -a "\$GITHUB_OUTPUT"$/m);
    assert.match(text, /^ {6}- uses: actions\/upload-artifact@[0-9a-f]{40} # v[\d.]+\n {8}with:\n {10}name: teamrig-ui\n {10}path: \.tmp\/ui-archive\/teamrig-ui\.json$/m);
  });

  it('gives the token that writes the release to a job that checks out nothing and runs no package code', () => {
    const text = job('ui-archive-upload');
    assert.match(text, /^ {4}needs: \[release-please, ui-archive-build\]\n {4}if: \$\{\{ needs\.release-please\.outputs\.release_created == 'true' \}\}$/m);
    assert.deepEqual(permissionsOf(text), ['contents: write']);
    assert.deepEqual([...text.matchAll(/uses: ([\w./-]+)@/g)].map((match) => match[1]), ['actions/download-artifact']);
    assert.doesNotMatch(text, /checkout|setup-node|npm/);
    assert.deepEqual(
      [...text.matchAll(/^ *(?:- )?run: (.+)$/gm)].map((match) => match[1]),
      ['echo "$SHA256  teamrig-ui.json" | sha256sum -c -', 'gh release upload "$TAG" teamrig-ui.json --repo "$GITHUB_REPOSITORY"'],
    );
    assert.equal(text.match(/github\.token|GITHUB_TOKEN|GH_TOKEN/g)?.length, 2, 'the token is named once, in one env');
    const upload = text.slice(text.indexOf('      - name: add the archive to the release'));
    assert.match(upload, /^ {10}GH_TOKEN: \$\{\{ github\.token \}\}$/m);
  });

  it("uploads only a file that holds the build's sha256", () => {
    const text = job('ui-archive-upload');
    assert.match(text, /^ {10}SHA256: \$\{\{ needs\.ui-archive-build\.outputs\.sha256 \}\}$/m);
    assert.ok(text.indexOf('sha256sum -c') < text.indexOf('gh release upload'), 'the hash check runs before the upload');
  });

  it('adds the archive to the release by its tag as a plain value, and never replaces one', () => {
    const text = job('ui-archive-upload');
    assert.match(text, /^ {8}run: gh release upload "\$TAG" teamrig-ui\.json --repo "\$GITHUB_REPOSITORY"$/m);
    assert.match(text, /^ {10}TAG: \$\{\{ needs\.release-please\.outputs\.tag_name \}\}$/m);
    assert.doesNotMatch(workflow, /^ *(?:- )?run:.*\$\{\{/m);
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
