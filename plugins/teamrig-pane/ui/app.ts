// The dedicated UI's loop: it draws the screen every front end reads (screen.ts, head.ts) with the painter, and turns
// a terminal's keys into the presses the dock runs (press.ts). It keeps only what a terminal front end alone knows:
// the ring's key, the field typed in, the window's settled reveal. Everything else is the store's, so a write by a
// press, a reader or the wheel asks for a drawing, and a burst of them is one (coalesce.ts). Keys and drawings run
// one at a time, in the order asked, and a key is followed by a drawing before the next is answered: a press never
// runs on a screen the person did not see.
import { scrolledTo, settle, type Settled } from '../hooks/body-scroll'
import { FIRST_MEMO, landedOn, type KeysMemo } from '../hooks/find-field'
import { revealed, WHEEL_ROWS, type View } from '../hooks/frame'
import { headOf, type Head } from '../hooks/head'
import type { Drawn } from '../hooks/layout'
import { currentPlace } from '../hooks/nav'
import type { PaneStore } from '../hooks/pane-store'
import { runPress, submitFind, typeFind, type PressDeps } from '../hooks/press'
import { placeOf } from '../hooks/press-keys'
import type { NoteField } from '../hooks/rows'
import { screenOf, type Screen, type ScreenLook } from '../hooks/screen'
import { graphemes } from '../hooks/width'
import { coalesced, type Defer } from './coalesce'
import type { Key, KeyName } from './keys'
import { bodyColumns, paint, type Frame } from './paint'
import { FIND_KEY, type Typing } from './paint-head'
import { backHit, findRowOf, hitAt, hitOf, hotkeyHit, noteFieldOf, ringOrder, stepped } from './ring'
import type { Stop } from './row'
import type { Terminal } from './terminal'
import { watched } from './watched-store'

/** Moves the focus ring onto the stop keyed `key`. */
export type Focus = (key: string) => Promise<void>

/** The readers and actors a press runs through; the app adds the rest of PressDeps. */
export type Ports = Omit<PressDeps, 'store' | 'snap' | 'shown' | 'place' | 'focus'>

/** Who takes an owner's note: told of each change as it is typed, and of the note on Enter. */
export type Noting = { typed(text: string): void; send(task: string, text: string): Promise<void> }

/** What acts outside the store; `noting` null while there is no team to send a note through. */
export type Front = { readonly ports: Ports; readonly noting: Noting | null }

/** What a drawing reads that the terminal does not say (screen.ts ScreenLook). */
export type FrontLook = Pick<ScreenLook, 'noteHold' | 'wraps' | 'hostOld' | 'tieHint'>

export type AppDeps = {
  readonly store: PaneStore
  readonly terminal: Terminal
  /**
   * The ports as they stand, asked at each drawing and each press, so one that comes late is used from then. `focus`
   * is the app's own ring, the same function each time: an act that opens a field moves the ring into it.
   */
  readonly front: (focus: Focus) => Front
  readonly look: FrontLook
  /** Runs a drawing a tick later (coalesce.ts). */
  readonly defer: Defer
}

/** The key that ends the program when no stop drawn takes it as its hotkey. */
export const QUIT = 'q'
/** The Find field's second hotkey, the one terminals know a search by. */
export const FIND_SLASH = '/'

/** What was last drawn: keys are answered on it. */
type Drawing = { readonly screen: Screen; readonly head: Head; readonly frame: Frame }

/** The field the ring stands on, with what is typed in it; `note` null for the Find field. */
type Field = Typing & { readonly note: NoteField | null }

class App {
  readonly #deps: AppDeps
  readonly #store: PaneStore
  readonly #redraw: () => void
  readonly #ended: (error: unknown) => void
  #memo: KeysMemo = FIRST_MEMO
  #settled: Settled | null = null
  #ring: string | null = null
  #field: Field | null = null
  #last: Drawing | null = null
  /** True from an ask for a drawing until one starts: a drawing a key was followed by answers the asks before it. */
  #isAsked = false
  #isOver = false
  /** The keys and drawings asked for, one at a time. */
  #work: Promise<void> = Promise.resolve()

  constructor(deps: AppDeps, ended: (error: unknown) => void) {
    this.#deps = deps
    this.#ended = ended
    this.#redraw = coalesced(
      () => this.#queued(() => (this.#isAsked ? this.#draw() : Promise.resolve())),
      deps.defer,
      error => this.#end(error),
    )
    this.#store = watched(deps.store, () => this.#ask())
  }

  start(): void {
    const { terminal } = this.#deps
    terminal.onKey(key => {
      this.#queued(async () => {
        await this.#answer(key)
        await this.#draw()
      }).catch((error: unknown) => this.#end(error))
    })
    terminal.onResize(() => this.#ask())
    this.#ask()
  }

  #ask(): void {
    this.#isAsked = true
    this.#redraw()
  }

  /** Runs `step` after every step asked before it; a step that throws tells its asker and the next still runs. */
  #queued(step: () => Promise<void>): Promise<void> {
    const done = this.#work.then(step)
    this.#work = done.catch(() => undefined)
    return done
  }

  /** Gives the terminal back and tells who ran the app: `error` undefined for the person's quit. */
  #end(error: unknown): void {
    if (this.#isOver) return
    this.#isOver = true
    this.#deps.terminal.close()
    this.#ended(error)
  }

  #front(): Front {
    return this.#deps.front(this.#focus)
  }

  async #draw(): Promise<void> {
    if (this.#isOver) return
    this.#isAsked = false
    const { terminal, look } = this.#deps
    const size = terminal.size()
    const columns = bodyColumns(size)
    const screen = await screenOf(this.#store, {
      ...look,
      inline: false,
      columns,
      bodyRows: size.rows,
      canAct: this.#front().ports.acting !== null,
      isHeld: true,
      memo: this.#memo,
    })
    this.#memo = screen.memo
    const head = headOf(screen, { inline: false, columns, isHeld: true })
    const field = this.#fieldOn(head, screen.body)
    this.#field = field
    const at = (offset: number): Frame => paint(head, screen.body, { size, offset, ring: this.#ring, typing: field })
    const first = at(this.#last?.frame.view?.offset ?? 0)
    const frame = first.view === null ? first : this.#landed(first, first.view, screen, at)
    this.#last = { screen, head, frame }
    if (!this.#isOver) terminal.draw(frame.lines)
  }

  /** The frame with the window where the store's last scroll step puts it (body-scroll.ts settle). */
  #landed(first: Frame, view: View, screen: Screen, at: (offset: number) => Frame): Frame {
    const landed = settle(screen.scroll, this.#settled, first.places, view)
    this.#settled = landed.settled
    return landed.offset === view.offset ? first : at(landed.offset)
  }

  /**
   * The field typed in at this drawing: the one the ring stands on, the Find field or a card's Note field, as the
   * dock's field takes the keys once the ring is in it. What was typed is kept while the ring stays; a field the
   * ring comes to starts from the words its round holds, a Note field empty.
   */
  #fieldOn(head: Head, body: readonly Drawn[]): Field | null {
    const ring = this.#ring
    if (ring === null) return null
    const kept = this.#field !== null && this.#field.key === ring ? this.#field : null
    const find = findRowOf(head)
    if (find !== null && find.key === ring) return kept ?? { key: ring, text: find.text, note: null }
    const note = noteFieldOf(body, ring)
    return note === null ? null : (kept ?? { key: ring, text: '', note })
  }

  #pressDeps(drawing: Drawing): PressDeps {
    const { screen } = drawing
    return { ...this.#front().ports, store: this.#store, snap: screen.snap, shown: screen.current, place: currentPlace(screen.at), focus: this.#focus }
  }

  /** Moves the ring onto `key`, counts the landing, and moves the window the least that shows the stop. */
  readonly #focus: Focus = async key => {
    this.#ring = key
    await this.#store.update('ring', current => landedOn(current, key))
    const view = this.#last?.frame.view ?? null
    const place = this.#last === null ? null : placeOf(this.#last.frame.places, key)
    if (view === null || place === null) return
    await this.#scrollTo(view, revealed(place, view, 'nearest'))
  }

  async #scrollTo(view: View, wanted: number): Promise<void> {
    const offset = Math.min(Math.max(0, wanted), view.maxOffset)
    if (offset !== view.offset) await this.#store.update('bodyScroll', current => scrolledTo(current, { kind: 'offset', offset }))
  }

  async #scroll(frame: Frame, to: (view: View) => number): Promise<void> {
    if (frame.view !== null) await this.#scrollTo(frame.view, to(frame.view))
  }

  async #answer(key: Key): Promise<void> {
    const drawing = this.#last
    if (this.#isOver || drawing === null) return
    if (this.#field !== null && (await this.#typed(this.#field, key, drawing))) return
    switch (key.kind) {
      case 'char':
        return this.#char(key.char, drawing)
      case 'click':
        return this.#press(hitAt(drawing.frame, key.column, key.line), drawing)
      case 'wheel':
        return this.#scroll(drawing.frame, view => view.offset + key.by * WHEEL_ROWS)
      case 'key':
        return this.#named(key.name, drawing)
    }
  }

  /** A key in the field typed in; false for a key the field leaves to the pane (Tab, the arrows, a click, Ctrl+C). */
  async #typed(field: Field, key: Key, drawing: Drawing): Promise<boolean> {
    if (key.kind === 'char') {
      await this.#retype(field, `${field.text}${key.char}`)
      return true
    }
    if (key.kind !== 'key') return false
    switch (key.name) {
      case 'backspace':
        await this.#retype(field, graphemes(field.text).slice(0, -1).join(''))
        return true
      case 'enter':
        await this.#submit(field, drawing)
        return true
      case 'escape':
        await this.#leave(field)
        return true
      default:
        return false
    }
  }

  async #retype(field: Field, text: string): Promise<void> {
    this.#field = { ...field, text }
    if (field.note === null) await typeFind(this.#store, text)
    else this.#front().noting?.typed(text)
  }

  async #submit(field: Field, drawing: Drawing): Promise<void> {
    if (field.note !== null) {
      await this.#front().noting?.send(field.note.task, field.text)
      return
    }
    const submits = findRowOf(drawing.head)?.submits ?? null
    if (submits !== null) await submitFind(submits, field.text, this.#pressDeps(drawing))
  }

  /** Esc in a field: the Find field's ring goes to its button; a Note field is closed by its card's Cancel. */
  async #leave(field: Field): Promise<void> {
    if (field.note === null) await this.#focus(FIND_KEY)
    else await this.#front().ports.acting?.press('cancel', field.note.task)
  }

  async #char(char: string, drawing: Drawing): Promise<void> {
    const { frame } = drawing
    const hit = hotkeyHit(frame, char) ?? (char === FIND_SLASH ? hitOf(frame, FIND_KEY) : null)
    if (hit === null && char === QUIT) return this.#end(undefined)
    return this.#press(hit, drawing)
  }

  async #named(name: KeyName, drawing: Drawing): Promise<void> {
    const { frame } = drawing
    switch (name) {
      case 'tab':
        return this.#step(frame, 1)
      case 'back-tab':
        return this.#step(frame, -1)
      case 'enter':
        return this.#press(hitOf(frame, this.#ring), drawing)
      case 'escape':
        return this.#press(backHit(frame), drawing)
      case 'up':
        return this.#scroll(frame, view => view.offset - 1)
      case 'down':
        return this.#scroll(frame, view => view.offset + 1)
      case 'page-up':
        return this.#scroll(frame, view => view.offset - Math.max(1, view.visibleRows))
      case 'page-down':
        return this.#scroll(frame, view => view.offset + Math.max(1, view.visibleRows))
      case 'home':
        return this.#scroll(frame, () => 0)
      case 'end':
        return this.#scroll(frame, view => view.maxOffset)
      case 'interrupt':
        return this.#end(undefined)
      case 'backspace':
      case 'delete':
      case 'left':
      case 'right':
        return
    }
  }

  /** Tab and Shift+Tab: a field is a stop of the ring, so the step from one typed in is on from it. */
  async #step(frame: Frame, by: 1 | -1): Promise<void> {
    const next = stepped(ringOrder(frame), this.#ring, by)
    if (next !== null) await this.#focus(next)
  }

  /** Enter or a click on a stop: the ring lands on it, and its press runs; a Note field only takes the ring. */
  async #press(stop: Stop | null, drawing: Drawing): Promise<void> {
    if (stop === null) return
    await this.#focus(stop.key)
    if (stop.target.kind === 'press') await runPress(stop.target.press, this.#pressDeps(drawing))
  }
}

/**
 * Runs the UI on `deps.terminal` until the person quits (`q`, Ctrl+C), then resolves; a drawing or a press that
 * throws rejects with what it threw. Either way the terminal is given back first.
 */
export function runApp(deps: AppDeps): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    new App(deps, error => (error === undefined ? resolve() : reject(error))).start()
  })
}
