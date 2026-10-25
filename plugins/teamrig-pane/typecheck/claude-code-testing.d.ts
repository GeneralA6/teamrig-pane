// The engine's `claude-code/testing` kit as this plugin's tests call it, for the typecheck only (see
// claude-code.d.ts beside it for why it is written here and what proves it). `claude plugin test` runs
// each test file in the engine with this kit.

declare module 'claude-code/testing' {
  import type { On, RenderComponent, RenderInput, RenderProps, SessionStart, CommandRun, ToolCall, ToolName, ToolResult, UiFocusInput, UiFocusResult, UiScrollInput, UiScrollResult } from 'claude-code'

  export interface Matchers {
    toBe(expected: unknown): void
    toEqual(expected: unknown): void
    toMatch(expected: RegExp | string): void
    toMatchObject(expected: object): void
    toContain(expected: unknown): void
    toBeDefined(): void
    toBeUndefined(): void
    toBeNull(): void
    toBeTruthy(): void
    toBeFalsy(): void
    toBeGreaterThan(expected: number): void
    toBeGreaterThanOrEqual(expected: number): void
    toBeLessThan(expected: number): void
    toBeLessThanOrEqual(expected: number): void
    toHaveLength(expected: number): void
    toThrow(expected?: RegExp | string): void
    readonly not: Matchers
  }
  export function expect(actual: unknown): Matchers

  /** A drawn element a query found: its component, its props and the text inside it. */
  export type FoundNode = { readonly type: string; readonly props: Readonly<Record<string, unknown>>; readonly text: string }
  export type NodeQuery = { readonly type?: string; readonly text?: RegExp | string }
  /** A component mounted as the engine would draw it, driven like a person would. */
  export interface Mounted<C extends RenderComponent> {
    find(query: NodeQuery): Promise<FoundNode | undefined>
    findAll(query: NodeQuery): Promise<FoundNode[]>
    /** Presses the button with this key. */
    press(target: { readonly key: string }): Promise<void>
    /** Types `text` into the field with this key: a change (`onInput`), or by default a submit (Enter, `onSubmit`). */
    input(target: { readonly key: string; readonly text: string; readonly kind?: 'change' | 'submit' }): Promise<unknown>
    /** Draws it again with new props (a resize, a scroll, a move inline). */
    redraw(props: RenderProps[C]): Promise<void>
    /** The tree it drew last, as plain data. */
    drawn(): Promise<unknown>
  }
  /** The pane mounted. */
  export type MountedPane = Mounted<'Pane'>
  /** The engine around the plugin under test: the person's and the session's side of it. */
  export interface TestEngine {
    readonly session: { start(e: SessionStart): Promise<void> }
    readonly command: { run(e: CommandRun): Promise<{ readonly text?: string }> }
    readonly ui: {
      mount<C extends RenderComponent>(request: RenderInput<C>): Promise<Mounted<C>>
      /** Raises `ui.focus` as the engine does when the ring moves: through the plugin's hooks, then the test's own beneath them. */
      focus(e: UiFocusInput): Promise<UiFocusResult>
      /** Raises `ui.scroll` as the engine does when a window is asked to move: through the plugin's hooks, then the test's own beneath them. */
      scroll(e: UiScrollInput): Promise<UiScrollResult>
    }
    readonly tool: { call<T extends ToolName>(input: ToolCall<T>): Promise<ToolResult> }
  }
  /** The engine's clock under test: `advance` runs the timers due, `settle` lets pending work finish. */
  export interface FakeClock {
    now(): number
    advance(ms: number): Promise<void>
    settle(): Promise<void>
  }
  export const mock: {
    /** Answers `$.env.get` from `env`. */
    env(on: On, env: Readonly<Record<string, string>>): void
    /** Answers `$.clock` from a clock that starts at `now` and moves only when told. */
    clock(on: On, start: { readonly now: number }): FakeClock
  }

  export function describe(name: string, body: () => void): void
  /** A test; one that takes `$` and `on` runs the plugin in the engine, answering beneath it with `on`. */
  export function test(name: string, body: ($: TestEngine, on: On) => unknown): void
}
