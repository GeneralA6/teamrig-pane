import { isRecord } from '../lib/guards.ts';

/** The tools' test files, as `npm test` runs them. */
export const TEST_FILES: readonly string[] = ['tools/**/*.test.ts'];

/** A test file by its name, whether or not `npm test` runs it: never a source file to cover. */
const TEST_NAME = /\.(test|spec)\.[cm]?[jt]sx?$/;

/** The repository tools' folder: TypeScript only, tested by `npm test`. */
const TOOLS_DIR = 'tools';

/**
 * The plugin's folder: its hooks and scripts (`.ts` and `.tsx`) are measured by its own tests, run here by node
 * through the kit in tools/pane-kit, except the test files that take the engine (`engineTests`).
 */
const PLUGIN_DIR = 'plugins/teamrig-pane';

/** The folders whose code must be tested; each has its own total. */
export const SOURCE_DIRS: readonly string[] = [TOOLS_DIR, PLUGIN_DIR];

/** What the coverage run imports first, so node runs a plugin test as the engine would: tools/pane-kit/register.ts. */
export const PANE_KIT_IMPORT = new URL('../pane-kit/register.ts', import.meta.url).href;

/** Where the policy lives, for the messages that tell a contributor what to edit. */
export const POLICY_FILE = 'tools/ci/coverage.json';

export const METRICS = ['lines', 'branches', 'functions'] as const;
export type Metric = (typeof METRICS)[number];
export type Floors = Readonly<Record<Metric, number>>;

export interface Counts {
  readonly found: number;
  readonly hit: number;
}

export type Coverage = Readonly<Record<Metric, Counts>>;

export interface FileCoverage extends Coverage {
  readonly path: string;
}

/** A lower floor for one file, with the reason a reviewer accepted it. */
export interface CoverageException {
  readonly floors: Partial<Floors>;
  readonly reason: string;
}

export interface CoveragePolicy {
  readonly total: Floors;
  readonly perFile: Floors;
  /** Test doubles and helpers (a folder ends with `/`): neither measured nor required to be loaded. */
  readonly testSupport: readonly string[];
  /** Files with no runtime code, which no test can load, each with the reason. */
  readonly typeOnly: ReadonlyMap<string, string>;
  /** Source files with runtime code that no node test can load yet, each with the reason: listed, never hidden. */
  readonly unmeasured: ReadonlyMap<string, string>;
  /** Code copied from elsewhere and measured there (a folder ends with `/`), each with where. */
  readonly vendored: ReadonlyMap<string, string>;
  /** Plugin test files only the engine can run (they take `$` and `on`), each with the reason. */
  readonly engineTests: ReadonlyMap<string, string>;
  readonly exceptions: ReadonlyMap<string, CoverageException>;
}

export type PolicyResult = { readonly kind: 'ok'; readonly policy: CoveragePolicy } | { readonly kind: 'invalid'; readonly problem: string };

export interface TestSummary {
  readonly tests: number;
  readonly fail: number;
  readonly cancelled: number;
  readonly skipped: number;
  readonly todo: number;
  /** The names on the run's `not ok` lines: a failing test, the suites holding it, and a suite failed outside any test. */
  readonly notOk: readonly string[];
}

type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly problem: string };

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const fail = <T>(problem: string): Parsed<T> => ({ ok: false, problem });

function parseFloors(value: unknown, where: string, allowed: ReadonlySet<string>): Parsed<Partial<Floors>> {
  if (!isRecord(value)) {
    return fail(`${where} must be an object of floors`);
  }
  const floors: Partial<Record<Metric, number>> = {};
  for (const [key, floor] of Object.entries(value)) {
    const metric = METRICS.find((name) => name === key);
    if (metric === undefined) {
      if (allowed.has(key)) {
        continue;
      }
      return fail(`${where}.${key} is not one of ${METRICS.join(', ')}`);
    }
    if (typeof floor !== 'number' || floor < 0 || floor > 100) {
      return fail(`${where}.${key} must be a percentage from 0 to 100`);
    }
    floors[metric] = floor;
  }
  return ok(floors);
}

function fullFloors(value: unknown, where: string): Parsed<Floors> {
  const parsed = parseFloors(value, where, new Set());
  if (!parsed.ok) {
    return parsed;
  }
  const { lines, branches, functions } = parsed.value;
  if (lines === undefined || branches === undefined || functions === undefined) {
    return fail(`${where} needs ${METRICS.join(', ')}`);
  }
  return ok({ lines, branches, functions });
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function parseException(path: string, value: unknown, perFile: Floors): Parsed<CoverageException> {
  const where = `exceptions["${path}"]`;
  const reason = isRecord(value) ? nonEmpty(value['reason']) : undefined;
  if (reason === undefined) {
    return fail(`${where} needs a "reason" a reviewer can check`);
  }
  const parsed = parseFloors(value, where, new Set(['reason']));
  if (!parsed.ok) {
    return parsed;
  }
  const floors = parsed.value;
  const set = METRICS.filter((metric) => floors[metric] !== undefined);
  if (set.length === 0) {
    return fail(`${where} lowers no floor`);
  }
  const notLower = set.find((metric) => (floors[metric] ?? 0) >= perFile[metric]);
  return notLower === undefined ? ok({ floors, reason }) : fail(`${where}.${notLower} must be below the per-file floor of ${perFile[notLower]}`);
}

function parseMap<T>(value: unknown, name: string, entry: (path: string, value: unknown) => Parsed<T>): Parsed<ReadonlyMap<string, T>> {
  if (value === undefined) {
    return ok(new Map());
  }
  if (!isRecord(value)) {
    return fail(`${name} must be an object keyed by file path`);
  }
  const map = new Map<string, T>();
  for (const [path, raw] of Object.entries(value)) {
    const parsed = entry(path, raw);
    if (!parsed.ok) {
      return parsed;
    }
    map.set(path, parsed.value);
  }
  return ok(map);
}

/** An entry of a map whose values are reasons a reviewer can check. */
function reasonEntry(name: string): (path: string, value: unknown) => Parsed<string> {
  return (path, value) => {
    const reason = nonEmpty(value);
    return reason === undefined ? fail(`${name}["${path}"] needs a reason`) : ok(reason);
  };
}

const REASON_MAPS = ['typeOnly', 'unmeasured', 'vendored', 'engineTests'] as const;

const POLICY_KEYS: ReadonlySet<string> = new Set(['$comment', 'total', 'perFile', 'testSupport', ...REASON_MAPS, 'exceptions']);

/** Reads the coverage policy, refusing unknown keys, so a typo never silently relaxes a floor. */
export function parsePolicy(value: unknown): PolicyResult {
  const invalid = (problem: string): PolicyResult => ({ kind: 'invalid', problem });
  if (!isRecord(value)) {
    return invalid('the coverage policy must be a JSON object');
  }
  const unknownKey = Object.keys(value).find((key) => !POLICY_KEYS.has(key));
  if (unknownKey !== undefined) {
    return invalid(`unknown key "${unknownKey}"`);
  }
  const total = fullFloors(value['total'], 'total');
  if (!total.ok) {
    return invalid(total.problem);
  }
  const perFile = fullFloors(value['perFile'], 'perFile');
  if (!perFile.ok) {
    return invalid(perFile.problem);
  }
  const testSupport = value['testSupport'] ?? [];
  if (!Array.isArray(testSupport) || !testSupport.every((entry): entry is string => nonEmpty(entry) !== undefined)) {
    return invalid('testSupport must be a list of file paths or folders ending with /');
  }
  const maps = new Map<(typeof REASON_MAPS)[number], ReadonlyMap<string, string>>();
  for (const name of REASON_MAPS) {
    const parsed = parseMap(value[name], name, reasonEntry(name));
    if (!parsed.ok) {
      return invalid(parsed.problem);
    }
    maps.set(name, parsed.value);
  }
  const exceptions = parseMap(value['exceptions'], 'exceptions', (path, raw) => parseException(path, raw, perFile.value));
  if (!exceptions.ok) {
    return invalid(exceptions.problem);
  }
  const reasons = (name: (typeof REASON_MAPS)[number]): ReadonlyMap<string, string> => maps.get(name) ?? new Map();
  return {
    kind: 'ok',
    policy: {
      total: total.value,
      perFile: perFile.value,
      testSupport,
      typeOnly: reasons('typeOnly'),
      unmeasured: reasons('unmeasured'),
      vendored: reasons('vendored'),
      engineTests: reasons('engineTests'),
      exceptions: exceptions.value,
    },
  };
}

/** Whether a path is one of the entries, a folder entry (ending with `/`) holding everything under it. */
function listedIn(path: string, entries: Iterable<string>): boolean {
  return [...entries].some((entry) => (entry.endsWith('/') ? path.startsWith(entry) : path === entry));
}

function sourceDirOf(path: string): string | undefined {
  return SOURCE_DIRS.find((dir) => path.startsWith(`${dir}/`));
}

/** The plugin's code includes JSX (`.tsx`); the tools are `.ts` only. */
function isSourceName(path: string, dir: string): boolean {
  return path.endsWith('.ts') || (dir === PLUGIN_DIR && path.endsWith('.tsx'));
}

/** The files that must be tested, from a file listing with `/` separators. */
export function sourceFiles(listing: readonly string[], policy: CoveragePolicy): string[] {
  return listing.filter((path) => {
    const dir = sourceDirOf(path);
    return (
      dir !== undefined &&
      isSourceName(path, dir) &&
      !path.endsWith('.d.ts') &&
      !TEST_NAME.test(path) &&
      !listedIn(path, policy.testSupport) &&
      !listedIn(path, policy.vendored.keys())
    );
  });
}

/** The plugin's test files node runs: every one, `.ts`, but those that take the engine. */
export function pluginTests(listing: readonly string[], policy: CoveragePolicy): string[] {
  return listing.filter((path) => path.startsWith(`${PLUGIN_DIR}/`) && path.endsWith('.test.ts') && !policy.engineTests.has(path));
}

function strayReason(path: string, policy: CoveragePolicy): string | undefined {
  const dir = sourceDirOf(path);
  if (dir === PLUGIN_DIR) {
    if (path.endsWith('.test.tsx') && !policy.engineTests.has(path)) {
      return 'node cannot run JSX, so the coverage run never runs it; write it as <name>.test.ts, or list it under engineTests with the reason';
    }
    return path.endsWith('.test.ts') || path.endsWith('.test.tsx') ? undefined : 'the plugin test runner never runs it; name it <name>.test.ts';
  }
  return dir === TOOLS_DIR && path.endsWith('.test.ts')
    ? undefined
    : `\`npm test\` never runs it; name a test <name>.test.ts under ${SOURCE_DIRS.map((source) => `${source}/`).join(' or ')}`;
}

/** Test files no run ever runs: a test that never runs cannot catch a regression. */
export function strayTests(listing: readonly string[], policy: CoveragePolicy): string[] {
  return listing.filter((path) => TEST_NAME.test(path)).flatMap((path) => {
    const reason = strayReason(path, policy);
    return reason === undefined ? [] : [`${path}: ${reason}`];
  });
}

/**
 * The `node --test` arguments for one coverage run of the tools' tests and the plugin's, writing lcov and TAP to
 * the given files. Node strips the types of both (each typecheck holds them to erasableSyntaxOnly).
 */
export function suiteArgs(policy: CoveragePolicy, listing: readonly string[], lcovPath: string, tapPath: string): string[] {
  return [
    `--import=${PANE_KIT_IMPORT}`,
    '--test',
    '--experimental-test-coverage',
    ...SOURCE_DIRS.map((dir) => `--test-coverage-include=${dir}/**`),
    '--test-coverage-exclude=**/*.test.ts',
    ...[...policy.testSupport, ...policy.vendored.keys()].map((entry) => `--test-coverage-exclude=${entry.endsWith('/') ? `${entry}**` : entry}`),
    '--test-reporter=spec',
    '--test-reporter-destination=stdout',
    '--test-reporter=lcov',
    `--test-reporter-destination=${lcovPath}`,
    '--test-reporter=tap',
    `--test-reporter-destination=${tapPath}`,
    ...TEST_FILES,
    ...pluginTests(listing, policy),
  ];
}

/**
 * The environment for the suite run. A run started from inside a test (the gate's own test does)
 * inherits NODE_TEST_CONTEXT, which makes `node --test` act as that runner's child and report to it.
 */
export function suiteEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([key]) => key !== 'NODE_TEST_CONTEXT'));
}

const LCOV_FIELDS:Readonly<Record<string, readonly [Metric, keyof Counts]>> = {
  LF: ['lines', 'found'],
  LH: ['lines', 'hit'],
  BRF: ['branches', 'found'],
  BRH: ['branches', 'hit'],
  FNF: ['functions', 'found'],
  FNH: ['functions', 'hit'],
};

type MutableCoverage = Record<Metric, { found: number; hit: number }>;

function emptyCoverage(): MutableCoverage {
  return { lines: { found: 0, hit: 0 }, branches: { found: 0, hit: 0 }, functions: { found: 0, hit: 0 } };
}

/** Per-file totals from an lcov report; `toRepoPath` turns its absolute paths into repo paths. */
export function parseLcov(text: string, toRepoPath: (absolute: string) => string): FileCoverage[] {
  const files: FileCoverage[] = [];
  let path: string | undefined;
  let coverage = emptyCoverage();
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('SF:')) {
      path = toRepoPath(line.slice(3));
      coverage = emptyCoverage();
    } else if (line === 'end_of_record' && path !== undefined) {
      files.push({ path, ...coverage });
      path = undefined;
    } else {
      const colon = line.indexOf(':');
      const field = colon < 0 ? undefined : LCOV_FIELDS[line.slice(0, colon)];
      if (field !== undefined) {
        coverage[field[0]][field[1]] = Number(line.slice(colon + 1));
      }
    }
  }
  return files;
}

/** The run's totals from TAP output: the top-level `# <name> <n>` lines, and the names its `not ok` lines carry. */
export function parseTapSummary(text: string): TestSummary | undefined {
  const counts = new Map<string, number>();
  for (const [, name, count] of text.matchAll(/^# (tests|fail|cancelled|skipped|todo) (\d+)$/gm)) {
    if (name !== undefined && count !== undefined) {
      counts.set(name, Number(count));
    }
  }
  const tests = counts.get('tests');
  return tests === undefined
    ? undefined
    : {
        tests,
        fail: counts.get('fail') ?? 0,
        cancelled: counts.get('cancelled') ?? 0,
        skipped: counts.get('skipped') ?? 0,
        todo: counts.get('todo') ?? 0,
        notOk: notOkNames(text),
      };
}

/**
 * The names on the TAP's `not ok` lines at any depth, each once, a todo test's left out (node writes its directive as
 * ` # TODO` and escapes a `#` inside a name).
 */
function notOkNames(text: string): string[] {
  const names = [...text.matchAll(/^[ \t]*not ok \d+ - (.*?)\r?$/gm)].flatMap(([, name]) => (name === undefined || / # TODO\b/.test(name) ? [] : [name]));
  return [...new Set(names)];
}

export function percent(counts: Counts): number {
  return counts.found === 0 ? 100 : (100 * counts.hit) / counts.found;
}

/** Rounded down, so a value just under a floor never prints as the floor itself. */
function shown(value: number): string {
  return `${Math.floor(value * 10) / 10}%`;
}

function totalOf(files: readonly FileCoverage[]): Coverage {
  const sum = (metric: Metric): Counts =>
    files.reduce((total, file) => ({ found: total.found + file[metric].found, hit: total.hit + file[metric].hit }), { found: 0, hit: 0 });
  return { lines: sum('lines'), branches: sum('branches'), functions: sum('functions') };
}

function gaps(coverage: Coverage, floors: Partial<Floors>): string[] {
  return METRICS.flatMap((metric) => {
    const floor = floors[metric];
    const value = percent(coverage[metric]);
    return floor !== undefined && value < floor ? [`${metric} ${shown(value)} < ${floor}%`] : [];
  });
}

function runFindings(summary: TestSummary | undefined, status: number | null): string[] {
  if (summary === undefined) {
    return [`the test run wrote no TAP summary (exit status ${String(status)}); it crashed or found no test files`];
  }
  const findings: string[] = [];
  if (summary.tests === 0) {
    findings.push('the test run found no tests');
  }
  if (summary.fail > 0 || summary.cancelled > 0) {
    findings.push(`${summary.fail} failing and ${summary.cancelled} cancelled test(s)`);
  } else if (summary.notOk.length > 0) {
    // node 22 counts a suite whose body throws before any test runs as no failure and exits 0: only its `not ok` shows it.
    findings.push(`${summary.notOk.length} suite(s) failed outside any test, which the run counted as no failure (the error is above): ${summary.notOk.join('; ')}`);
  } else if (status !== 0) {
    findings.push(`the test run exited with status ${String(status)} with no failing test`);
  }
  if (summary.skipped > 0 || summary.todo > 0) {
    findings.push(`${summary.skipped} skipped and ${summary.todo} todo test(s): a test that does not run cannot catch a regression; fix it or delete it`);
  }
  return findings;
}

export interface CoverageRun {
  readonly report: readonly FileCoverage[];
  /** Every file in the source folders, `/`-separated, as `git ls-files` lists them. */
  readonly listing: readonly string[];
  readonly summary: TestSummary | undefined;
  readonly status: number | null;
}

/** What the suite run left behind: each report's text (undefined when the run never wrote it) and the exit status. */
export interface SuiteOutput {
  readonly lcov: string | undefined;
  readonly tap: string | undefined;
  readonly status: number | null;
}

/** The run the floors judge. A report the suite never wrote counts as no coverage and no summary, which fails the gate. */
export function coverageRun(output: SuiteOutput, listing: readonly string[], toRepoPath: (absolute: string) => string): CoverageRun {
  return {
    report: output.lcov === undefined ? [] : parseLcov(output.lcov, toRepoPath),
    listing,
    summary: output.tap === undefined ? undefined : parseTapSummary(output.tap),
    status: output.status,
  };
}

function fileFindings(path: string, file: FileCoverage | undefined, policy: CoveragePolicy): string[] {
  if (policy.typeOnly.has(path)) {
    return file === undefined ? [] : [`${path}: a test loads it, so it is not type-only; remove it from typeOnly in ${POLICY_FILE}`];
  }
  if (policy.unmeasured.has(path)) {
    return file === undefined ? [] : [`${path}: a test loads it now, so it can be measured; remove it from unmeasured in ${POLICY_FILE}`];
  }
  if (file === undefined) {
    return [`${path}: no test loads it; add a test that imports or runs it (a file with only types goes under typeOnly in ${POLICY_FILE})`];
  }
  const exception = policy.exceptions.get(path);
  const missed = gaps(file, { ...policy.perFile, ...exception?.floors });
  if (missed.length > 0) {
    return [`${path}: ${missed.join(', ')}`];
  }
  return exception !== undefined && gaps(file, policy.perFile).length === 0
    ? [`${path}: meets the per-file floors now; remove its exception from ${POLICY_FILE}`]
    : [];
}

/** Everything that fails the gate; empty when the run passes. */
export function coverageFindings(run: CoverageRun, policy: CoveragePolicy): string[] {
  const sources = sourceFiles(run.listing, policy);
  const sourceSet = new Set(sources);
  const byPath = new Map(run.report.filter((file) => sourceSet.has(file.path)).map((file) => [file.path, file]));
  const findings = [...runFindings(run.summary, run.status), ...strayTests(run.listing, policy)];
  findings.push(...sources.flatMap((path) => fileFindings(path, byPath.get(path), policy)));
  for (const path of [...policy.exceptions.keys(), ...policy.typeOnly.keys(), ...policy.unmeasured.keys()]) {
    if (!sourceSet.has(path)) {
      findings.push(`${path}: is listed in ${POLICY_FILE} but is not a source file; remove it`);
    }
  }
  for (const entry of policy.vendored.keys()) {
    if (!run.listing.some((path) => listedIn(path, [entry]))) {
      findings.push(`${entry}: is listed as vendored in ${POLICY_FILE} but holds no file; remove it`);
    }
  }
  for (const path of policy.engineTests.keys()) {
    if (!(run.listing.includes(path) && TEST_NAME.test(path))) {
      findings.push(`${path}: is listed under engineTests in ${POLICY_FILE} but is not a test file; remove it`);
    }
  }
  for (const [dir, files] of measuredByDir([...byPath.values()])) {
    const totalGaps = gaps(totalOf(files), policy.total);
    if (totalGaps.length > 0) {
      findings.push(`total ${dir}/: ${totalGaps.join(', ')}`);
    }
  }
  return findings;
}

/** The measured files of each source folder, in SOURCE_DIRS order, leaving out a folder with none. */
function measuredByDir(files: readonly FileCoverage[]): [string, FileCoverage[]][] {
  return SOURCE_DIRS.map((dir): [string, FileCoverage[]] => [dir, files.filter((file) => file.path.startsWith(`${dir}/`))]).filter(([, measured]) => measured.length > 0);
}

/** One line for a passing run: the test count, then each source folder's totals over its measured files. */
export function coverageTotals(run: CoverageRun, policy: CoveragePolicy): string {
  const sourceSet = new Set(sourceFiles(run.listing, policy));
  const measured = run.report.filter((file) => sourceSet.has(file.path));
  const tests = run.summary === undefined ? '' : `${run.summary.tests} tests; `;
  const folders = measuredByDir(measured).map(([dir, files]) => {
    const total = totalOf(files);
    return `${dir}/ ${files.length} files: ${METRICS.map((metric) => `${metric} ${shown(percent(total[metric]))}`).join(', ')}`;
  });
  return `${tests}${folders.length === 0 ? 'no files measured' : folders.join('; ')}`;
}
