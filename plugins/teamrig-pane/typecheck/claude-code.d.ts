// The engine's `claude-code` module as this plugin calls it, for the typecheck only (tsconfig.pane.json at
// the repo root). Claude Code runs a mod's hooks itself and ships no declarations for this module, so these
// are written from the plugin's own calls: the subset it uses, typed as strictly as those calls allow.
// They prove the plugin agrees with itself; `claude plugin test` runs it in the engine, which is what proves
// the engine agrees. A call the plugin adds that is not here fails the typecheck: add it here, as the
// engine's documentation or a test run shows it, never as `any`. The plugin's own state (`PluginState`)
// is declared in ../types/index.d.ts, the contract the manifest names.

/** The tree a render hook returns: the engine draws it; the plugin never reads one back. */
declare namespace JSX {
  interface Element {
    readonly type: unknown
    readonly props: unknown
  }
  /** Every component takes a `key` among its siblings. */
  interface IntrinsicAttributes {
    readonly key?: string | number | undefined
  }
  /** Children go in a component's `children` prop. */
  interface ElementChildrenAttribute {
    children: unknown
  }
  /** No lowercase host elements: every element is one of the engine's components (`$.ui.resolve`). */
  interface IntrinsicElements {}
}

declare module 'claude-code' {
  /** The theme colors a span may take; the theme picks the actual color. */
  export type ThemeKey = 'warning' | 'error' | 'success' | 'suggestion' | 'subtle' | 'claude'

  /** What a component may hold: elements, text, numbers, nothing, or lists of them. */
  export type Child = JSX.Element | string | number | boolean | null | undefined | readonly Child[]

  export type BoxProps = {
    readonly flexDirection?: 'row' | 'column'
    readonly flexWrap?: 'wrap' | 'nowrap'
    readonly gap?: number
    readonly columnGap?: number
    readonly paddingX?: number
    readonly paddingLeft?: number
    readonly paddingRight?: number
    /** The rows the Box takes, whatever its children need: the docked pane's root is as tall as the engine's window. */
    readonly height?: number
    /** The columns the Box takes, whatever its children need. */
    readonly width?: number
    /** How much of the free space along its parent's direction the Box takes; 0, none, by default. */
    readonly flexGrow?: number
    /** How much the Box gives up when its parent's children need more than it has; 0 keeps its size. */
    readonly flexShrink?: number
    /** `hidden` cuts what its children draw past the Box's edges. */
    readonly overflow?: 'visible' | 'hidden'
    /** A border round the Box in its outer cells, a column each side and a row above and below: `round`, its corners rounded. */
    readonly borderStyle?: 'round'
    /** Draws the border dim. */
    readonly borderDimColor?: boolean
    readonly children?: Child
  }
  export type TextProps = {
    readonly color?: ThemeKey | undefined
    readonly bold?: boolean | undefined
    readonly dimColor?: boolean | undefined
    readonly underline?: boolean | undefined
    readonly wrap?: 'wrap' | 'truncate-end'
    readonly children?: Child
  }
  /** A button: labelled, or `plain` around its children; `hotkey` presses it from the keyboard. */
  export type ButtonProps = {
    readonly label?: string
    readonly hotkey?: string
    readonly variant?: 'primary' | 'secondary'
    readonly plain?: boolean
    readonly onPress: () => void
    readonly children?: Child
  }
  /** A link to `href`, drawn inline in a Text: its children (or `label`) as the text a press opens the address from. */
  export type LinkProps = {
    readonly href: string
    readonly label?: string
    readonly children?: Child
  }
  /**
   * A one-line text field: `key` its address, `label` drawn before it, `placeholder` dim while it is empty, `value`
   * the text it holds when drawn. With `autoFocus` the focus ring starts on it when the pane takes the keyboard; while
   * it has focus every printable key reaches it alone (no hotkey fires) and Esc hands them back. `onInput` runs on
   * each change of its text, `onSubmit` on Enter, `submitLabel` naming what Enter does.
   */
  export type InputProps = {
    readonly key: string
    readonly label?: string
    readonly placeholder?: string
    readonly value?: string
    readonly submitLabel?: string
    readonly autoFocus?: true
    readonly onInput?: (value: string) => void
    readonly onSubmit: (value: string) => void
  }
  export type Component<P> = (props: P) => JSX.Element
  /** The components a render hook draws with, resolved for the surface the request came from. */
  export type Components = {
    readonly Box: Component<BoxProps>
    readonly Text: Component<TextProps>
    readonly Button: Component<ButtonProps>
    readonly Link: Component<LinkProps>
    readonly Input: Component<InputProps>
  }

  /** A value kept under a shape tag: read under another tag, it reads as absent. */
  export type Shaped<T> = { readonly shape: string; readonly value: T }
  /** Each plugin's `$.state` keys and their types; a plugin declares its own entry (module augmentation). */
  export interface PluginState {}
  type Unshaped<V> = V extends Shaped<infer T> ? T : V
  /** One `$.state` key of one plugin, holding a `T`. */
  export interface Atom<T> {
    readonly plugin: string
    readonly key: string
    readonly initial: T
  }
  /** Declares a state key: `initial` until it is written; `shape` tags a value whose type may change between versions. */
  export function atom<P extends keyof PluginState, K extends keyof PluginState[P] & string>(
    id: { readonly plugin: P; readonly key: K },
    initial: Unshaped<PluginState[P][K]>,
    options?: { readonly shape: string },
  ): Atom<Unshaped<PluginState[P][K]>>
  export function read<T>($: Context, atom: Atom<T>): Promise<T>
  /** Reads, applies `change`, writes, and tries again on a miss; resolves to the value written. */
  export function update<T>($: Context, atom: Atom<T>, change: (current: T) => T): Promise<T>

  export type FsStat = { readonly kind: 'file' | 'dir'; readonly size: number; readonly mtimeMs: number; readonly isLink: boolean }
  export type FsEntry = FsStat & { readonly name: string }
  export type ProcessInit = { readonly cwd?: string; readonly timeoutMs?: number }
  export type ProcessResult = {
    readonly exitCode: number
    readonly stdout: string
    readonly stderr: string
    readonly isStdoutTruncated: boolean
    readonly isStderrTruncated: boolean
  }
  /**
   * The engine's version: `version` as `claude --version` prints it (`2.1.280`, or `2.1.280-dev.<date>.<sha>` for a
   * development build), `base` its release (`2.1.280`, `2.1.280-dev`) and `builtAt` an ISO time, each absent when unknown.
   */
  export type SessionVersion = { readonly version: string; readonly base?: string; readonly builtAt?: string }
  /** A timer `$.clock.every` started. */
  export type Timer = { cancel(): void }
  export type CommandSpec = { readonly name: string; readonly description: string; readonly argumentHint?: string }
  export type PaneOpen = { readonly id: string; readonly title?: string; readonly columns?: number }
  /**
   * What `$.ui.scroll` brings into view: an element of this plugin's by `key`, a render instance by `requestId`, or
   * the `start` or `end` of the site `in` names (a pane's id); `block` is where it lands, `nearest` when left out.
   */
  export type UiScrollArgs = {
    readonly to: { readonly key: string } | { readonly requestId: string } | 'start' | 'end'
    readonly in?: string
    readonly block?: 'start' | 'center' | 'end' | 'nearest'
  }
  /** `{}` once the window moved, or why it did not. */
  export type UiScrollResult = { readonly deny?: string }
  /** A site's window asked to move: which pane, the first row it is to show, by how many rows, and who moves it. */
  export type UiScrollInput = {
    readonly component: 'Pane' | 'AbovePrompt'
    readonly requestId: string
    readonly offset: number
    readonly by: number
    readonly bodyRows: number
    readonly contentRows: number
    readonly origin: { readonly kind: 'person' } | { readonly kind: 'plugin'; readonly name: string }
  }
  /** What `$.ui.focus` moves the focus ring onto: an element this plugin drew, by `key`, in the site `requestId` names (a pane's id). */
  export type UiFocusArgs = { readonly requestId: string; readonly key: string }
  /** `{}` once the ring moved, or why it did not: a site that does not hold the keys, or holds them on another plugin's element. */
  export type UiFocusResult = { readonly deny?: string }
  /**
   * A site's focus ring about to move: which site, the `element` taking it and the `plugin` that drew it (both absent
   * for one of the engine's own stops), and who moves it: the person, or a plugin's `$.ui.focus` or `autoFocus`.
   */
  export type UiFocusInput = {
    readonly component: 'Pane' | 'AbovePrompt'
    readonly requestId: string
    readonly plugin?: string
    readonly element?: string
    readonly origin: { readonly kind: 'person' } | { readonly kind: 'plugin'; readonly name: string }
  }

  /** What the plugin asks the engine for; each is an event a test (or another plugin) can answer beneath it. */
  export interface Context {
    readonly command: { register(spec: CommandSpec): Promise<{ command: string }> }
    readonly env: { get(name: string): Promise<string | undefined> }
    readonly fs: { stat(path: string): Promise<FsStat>; exists(path: string): Promise<boolean>; read(path: string): Promise<string>; list(path: string): Promise<FsEntry[]> }
    readonly session: { id(): Promise<string>; version(): Promise<SessionVersion> }
    readonly clock: { now(): Promise<number>; every(ms: number, fn: () => void): Timer }
    readonly store: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void>; delete(key: string): Promise<void> }
    readonly process: { run(argv: readonly string[], init?: ProcessInit): Promise<ProcessResult> }
    readonly ui: {
      open(pane: PaneOpen): Promise<{ isPlaced: boolean }>
      resolve(request: RenderRequest): Components
      scroll(args: UiScrollArgs): Promise<UiScrollResult>
      focus(args: UiFocusArgs): Promise<UiFocusResult>
    }
  }

  /** Where the fullscreen layout would draw a command's pane: the dock needs the fullscreen layout and enough columns. */
  export type CommandPresentation = { readonly isFullscreen: boolean; readonly columns: number }
  /** Who closes a pane: the person (the close mark, ctrl+x x), the plugin itself, or the engine unloading it. */
  export type PaneCloseOrigin = { readonly kind: 'person' | 'plugin' | 'unload' }
  export type SessionStart = { readonly cwd: string; readonly surface: 'terminal'; readonly isInteractive: boolean }
  export type CommandRun = {
    readonly command: string
    readonly args: string
    readonly origin: { readonly kind: 'composer' }
    readonly presentation: CommandPresentation
  }
  /** A pane's props as the engine draws it: docked on the right, or inline above the prompt. */
  export type PaneProps = {
    readonly title: string
    readonly isFocused: boolean
    readonly bodyColumns: number
    readonly placement: 'dock' | 'inline'
    readonly scroll: { readonly offset: number; readonly bodyRows: number }
    readonly view: Readonly<Record<string, unknown>>
  }
  /** The band above the prompt as the engine draws it: one instance, where the surveys draw too. */
  export type AbovePromptProps = {
    /** True while a survey holds the band; a hook yields to it. */
    readonly hasSurvey: boolean
    readonly isWorking: boolean
    /** Rows the band may take; a taller tree scrolls in a window of `scroll.bodyRows`. */
    readonly maxRows: number
    /** Cells the tree is laid out in, the engine's `[-]` at the right end left out. */
    readonly bodyColumns: number
    readonly scroll: { readonly offset: number; readonly bodyRows: number }
    readonly view: Readonly<Record<string, unknown>>
  }
  /** The props of each component the plugin draws. */
  export interface RenderProps {
    Pane: PaneProps
    AbovePrompt: AbovePromptProps
  }
  export type RenderComponent = keyof RenderProps
  /** A request to draw one component, its props that component's. */
  export type RenderInput<C extends RenderComponent> = {
    readonly plugin: string
    readonly surface: 'terminal'
    readonly component: C
    readonly requestId: string
    readonly props: RenderProps[C]
  }
  export type RenderRequest<C extends RenderComponent = RenderComponent> = { [K in C]: RenderInput<K> }[C]

  /** The tool inputs the plugin watches, by tool name. */
  export interface ToolInputs {
    Edit: { readonly file_path: string; readonly old_string: string; readonly new_string: string; readonly replace_all?: boolean }
    Write: { readonly file_path: string; readonly content: string }
    NotebookEdit: { readonly notebook_path: string; readonly new_source: string }
    Bash: { readonly command: string }
    PowerShell: { readonly command: string }
  }
  export type ToolName = keyof ToolInputs
  export type ToolCall<T extends ToolName = ToolName> = { readonly tool: T } & ToolInputs[T]
  /** A tool call's outcome: what it returned, a `deny` when a hook refused it, `isError` when it ran and failed. */
  export type ToolResult = { readonly result?: string; readonly deny?: string; readonly isError?: boolean }

  /** An effect's answer: its value, or why it was refused (`$` rejects with the reason). */
  export type Answer<V> = { readonly value: V; readonly deny?: undefined } | { readonly deny: string; readonly value?: undefined }

  /** Every event, with what narrows a handler to some of them, its payload and its result. */
  export interface Events {
    'session.start': { filter: never; e: SessionStart; result: { readonly cwd?: string } }
    'session.id': { filter: never; e: Readonly<Record<string, never>>; result: Answer<string> }
    'session.version': { filter: never; e: Readonly<Record<string, never>>; result: Answer<SessionVersion> }
    'command.register': { filter: never; e: CommandSpec; result: Answer<{ command: string }> }
    'command.run': { filter: { readonly command: string }; e: CommandRun; result: { readonly text?: string } }
    'ui.open': { filter: { readonly id: string }; e: PaneOpen; result: Answer<{ isPlaced: boolean }> }
    'ui.close': { filter: { readonly id: string }; e: { readonly id: string; readonly origin: PaneCloseOrigin }; result: { readonly deny?: string } }
    'ui.render': { filter: { readonly component: RenderComponent; readonly requestId?: string }; e: RenderRequest; result: JSX.Element }
    'ui.scroll': { filter: { readonly requestId: string }; e: UiScrollInput; result: UiScrollResult }
    'ui.focus': { filter: { readonly requestId: string }; e: UiFocusInput; result: UiFocusResult }
    'fs.stat': { filter: never; e: { readonly path: string }; result: Answer<FsStat> }
    'fs.exists': { filter: never; e: { readonly path: string }; result: Answer<boolean> }
    'fs.read': { filter: never; e: { readonly path: string }; result: Answer<string> }
    'fs.list': { filter: never; e: { readonly path: string }; result: Answer<FsEntry[]> }
    'store.get': { filter: never; e: { readonly key: string }; result: Answer<unknown> }
    'store.set': { filter: never; e: { readonly key: string; readonly value: unknown }; result: Answer<void> }
    'store.delete': { filter: never; e: { readonly key: string }; result: Answer<void> }
    'store.keys': { filter: never; e: Readonly<Record<string, never>>; result: Answer<string[]> }
    'process.run': { filter: never; e: { readonly argv: readonly string[]; readonly init?: ProcessInit }; result: Answer<ProcessResult> }
    'state.get': { filter: never; e: { readonly plugin: string; readonly key: string }; result: Answer<Shaped<unknown> | undefined> }
  }
  export type EventName = keyof Events

  /** Hands the event on to the next handler, the engine's own last. */
  export type Next<E, R> = (e: E) => Promise<R>
  export type Handler<E, R> = ($: Context, e: E, next: Next<E, R>) => R | Promise<R>
  /** A registered handler; `catch` answers in its place when it throws. */
  export interface Registration<E, R> {
    catch(fallback: Handler<E, R>): Registration<E, R>
  }

  /** Registers a handler: for every event of a name, or for those matching `filter`. */
  export interface On {
    <T extends ToolName>(event: 'tool.call', filter: { readonly tool: T }, handler: Handler<ToolCall<T>, ToolResult>): Registration<ToolCall<T>, ToolResult>
    <C extends RenderComponent>(event: 'ui.render', filter: { readonly component: C; readonly requestId?: string }, handler: Handler<RenderInput<C>, JSX.Element>): Registration<RenderInput<C>, JSX.Element>
    <K extends EventName>(event: K, handler: Handler<Events[K]['e'], Events[K]['result']>): Registration<Events[K]['e'], Events[K]['result']>
    <K extends EventName>(event: K, filter: Events[K]['filter'], handler: Handler<Events[K]['e'], Events[K]['result']>): Registration<Events[K]['e'], Events[K]['result']>
  }
  /** A mod's hooks module exports `register`, which the engine calls once with `on`. */
  export type Register = (on: On) => void
}
