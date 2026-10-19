// The golden register: what scripts/golden.ts captures from the real teamrig CLI at the pinned commit,
// and the module it writes it to (tests/golden-register.ts) for the parity test (tests/golden.test.ts).
// Pure, so the pane's tests can import it.

/** The folder every captured path is moved under, in place of the scratch folder the CLI ran in. */
export const GOLDEN_ROOT = 'G:/golden'

/** The Claude Code session that runs `inbox read`, so its mark names the session as a hook's would. */
export const GOLDEN_SESSION = '00000000-0000-4000-8000-000000000001'

/** The variable golden-clock.ts reads in each CLI run of a capture: the instant, in ms, the run's clock is fixed at. */
export const GOLDEN_CLOCK_VARIABLE = 'GOLDEN_CLOCK_MS'

/** The instant of a capture's first CLI run; each later run is a minute on, so every capture writes and prints the same. */
export const GOLDEN_START = Date.UTC(2026, 9, 17, 11, 0)
const RUN_STEP_MS = 60_000

/** A capture's clock: the instant of each CLI run in turn, GOLDEN_START and then a minute apart. */
export class GoldenClock {
  private runs = 0

  next(): number {
    const at = GOLDEN_START + this.runs * RUN_STEP_MS
    this.runs += 1
    return at
  }
}

/** The instant $GOLDEN_CLOCK_MS names; a missing or broken one throws, so a run never falls back to the real clock. */
export function clockAt(value: string | undefined): number {
  const ms = value === undefined || value.trim() === '' ? Number.NaN : Number(value)
  if (!Number.isSafeInteger(ms)) throw new Error(`${GOLDEN_CLOCK_VARIABLE} must name an instant in whole ms, not ${JSON.stringify(value ?? null)}`)
  return ms
}

/** A read of the real clock that golden-clock.ts cannot fix, as it fixes Date.now alone: `new Date()`, `Date()`, a timer. */
const OTHER_CLOCK_READ = /\bnew Date\(\s*\)|(?<![.\w])Date\(\s*\)|\bperformance\.now\(|\bprocess\.hrtime\b/

/** The lines (from 1) of `source` that read the real clock other than through Date.now: a capture refuses such a teamrig. */
export function realClockReads(source: string): number[] {
  return source.split('\n').flatMap((line, index) => (OTHER_CLOCK_READ.test(line) ? [index + 1] : []))
}

/** One inbox state: the files as teamrig left them and what `teamrig inbox status` printed for them. */
export type InboxState = { label: string; inbox: string; marks: string; status: string }

/** One of teamrig's own register fixtures and what `teamrig list --status all --all` (every field) printed for it. */
export type ListedFixture = { name: string; events: string; list: string; warn: string }

export type GoldenRegister = {
  /** The teamrig commit whose CLI wrote it: the pin in scripts/teamrig-pin.json then. */
  pin: string
  /** The instant the final `list` ran at (GoldenClock), in ms: the clock the test reads at, so every task finished on the way is still drawn. */
  generatedAt: number
  /** The files the pane reads, by path under GOLDEN_ROOT: `kit/...` (the kit home) and `proj/...` (the project). */
  files: Record<string, string>
  /** `teamrig list --status all --all` (every field) on the final register: what it printed, and its WARN line ('' when none). */
  list: string
  warn: string
  inbox: InboxState[]
  fixtures: ListedFixture[]
}

/** `text` with `root`, spelled with either slash, replaced by GOLDEN_ROOT, so no local path is kept. */
export function underGoldenRoot(text: string, root: string): string {
  const forward = root.replaceAll('\\', '/')
  const back = forward.replaceAll('/', '\\')
  return text.split(back).join(GOLDEN_ROOT).split(forward).join(GOLDEN_ROOT)
}

/** The module tests/golden-register.ts: the capture as one typed constant. */
export function goldenModule(golden: GoldenRegister): string {
  return [
    `// Written by scripts/golden.ts from teamrig ${golden.pin}: rerun it after a sync, never edit it by hand.`,
    "import type { GoldenRegister } from '../scripts/golden-format'",
    '',
    `export const GOLDEN: GoldenRegister = ${JSON.stringify(golden, null, 2)}`,
    '',
  ].join('\n')
}
