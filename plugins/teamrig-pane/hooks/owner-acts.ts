// The owner's Note and Next at the bottom of a task's open card and of its page (T1299). Note opens a field whose text
// `teamrig owner note <task> --text` keeps in the task's history and sends to the task's session. Next reads `teamrig
// owner next <task> --preview` into a confirm, the ring on its Cancel first, and the confirm runs `teamrig owner next
// <task>`, which pins the task atop its session's list, wakes the session and tells the lead. One act at a time in the
// pane and one run at a time: a press while a run goes does nothing. After a run the card says what the CLI answered,
// its lines on success, its refusal verbatim. The CLI finds the team from the tab's folder, the team whose register
// the pane reads. Runs the CLI only; no model calls.
import type { OwnerAct, OwnerActName, OwnerActPress } from '../types'
import { messageOf } from './errors'
import { actKey, noteKey } from './press-keys'
import { cliArgv, failureLines, linesOf, type CliRun, type TeamrigCli } from './teamrig-cli'

/** An owner act reads the register, writes a line or a pin and posts an inbox line: far under this. */
export const ACT_TIMEOUT_MS = 60_000

export type ActPorts = {
  /** Runs `argv`, the teamrig CLI and its words (teamrig-cli.ts cliArgv); rejects when it cannot start or outlasts `timeoutMs`. */
  run: (argv: readonly string[], timeoutMs: number) => Promise<CliRun>
  /** Writes where the act stands, null when none is open; rejects when it cannot. */
  tell: (act: OwnerAct | null) => Promise<void>
  /** Moves the focus ring onto the press or field keyed `key` (press-keys.ts actKey, noteKey). */
  focus: (key: string) => Promise<void>
}

/** A run of the CLI, or why it gave no answer. */
type Ran = { readonly kind: 'ran'; readonly run: CliRun } | { readonly kind: 'failed'; readonly lines: readonly string[] }

/** The words of `teamrig owner note`: the task and the Note's text. */
export function noteArgs(task: string, text: string): string[] {
  return ['owner', 'note', task, '--text', text]
}

/** The words of `teamrig owner next`, `--preview` for the confirm's lines, which writes nothing. */
export function nextArgs(task: string, preview: boolean): string[] {
  return preview ? ['owner', 'next', task, '--preview'] : ['owner', 'next', task]
}

/**
 * What an act's run answered: done, with the lines it printed, its row first and then who it told or could not wake
 * (stderr); else refused, with why.
 */
export function actOutcome(task: string, act: OwnerActName, run: CliRun): OwnerAct {
  if (run.exitCode !== 0) return { kind: 'told', task, act, outcome: 'refused', lines: failureLines(run, `owner ${act} ${task}`) }
  return { kind: 'told', task, act, outcome: 'done', lines: [...linesOf(run.stdout), ...linesOf(run.stderr)] }
}

/** Runs the owner's Note and Next on a task, one press at a time. */
export class OwnerActs {
  private readonly cli: TeamrigCli
  private readonly ports: ActPorts
  /** Where the act stands, as last told. */
  private act: OwnerAct | null = null
  /** The Note fields opened so far: each opening draws a new one, empty. */
  private round = 0
  /** The open Note field's text as typed: kept here, never drawn back, as the engine drops typing when a drawn value changes. */
  private draft = ''
  private isRunning = false

  constructor(cli: TeamrigCli, ports: ActPorts) {
    this.cli = cli
    this.ports = ports
  }

  /** A press of an owner act on `task`'s card (press-keys.ts actKey), to its step. */
  async press(press: OwnerActPress, task: string): Promise<void> {
    switch (press) {
      case 'note':
        return this.openNote(task)
      case 'next':
        return this.askNext(task)
      case 'send':
        return this.sendNote(task)
      case 'cancel':
        return this.cancel(task)
      case 'confirm':
        return this.confirmNext(task)
    }
  }

  /** Opens a new, empty Note field on `task`'s card, closing any other act, and moves the ring into it. */
  async openNote(task: string): Promise<void> {
    await this.step(async () => {
      this.round += 1
      this.draft = ''
      await this.show({ kind: 'noting', task, round: this.round })
      await this.ports.focus(noteKey(task, this.round))
    })
  }

  /** Keeps what the Note field holds, as typed. */
  typed(text: string): void {
    this.draft = text
  }

  /**
   * Sends the Note typed on `task`'s card, `text` when given (Enter in the field hands it), else what was typed. An
   * empty Note leaves the field open; a press on a card whose field is not open does nothing.
   */
  async sendNote(task: string, text?: string): Promise<void> {
    if (!this.holds('noting', task)) return
    if (text !== undefined) this.typed(text)
    const note = this.draft.trim()
    if (note === '') return
    await this.step(async () => {
      await this.show({ kind: 'sending', task, act: 'note' })
      await this.show(await this.answer(task, 'note', noteArgs(task, note)))
      await this.ports.focus(actKey('note', task))
    })
  }

  /** Reads what Next on `task` would do into a confirm, the ring on its Cancel; a refused preview is told as the answer. */
  async askNext(task: string): Promise<void> {
    await this.step(async () => {
      await this.show({ kind: 'previewing', task })
      const ran = await this.ran(task, 'next', nextArgs(task, true))
      if (ran.kind === 'ran' && ran.run.exitCode === 0) {
        await this.show({ kind: 'confirming', task, lines: linesOf(ran.run.stdout) })
        await this.ports.focus(actKey('cancel', task))
        return
      }
      await this.show(ran.kind === 'ran' ? actOutcome(task, 'next', ran.run) : refused(task, 'next', ran.lines))
    })
  }

  /** Puts `task` next, from its confirm; a press on a card with no confirm open does nothing. */
  async confirmNext(task: string): Promise<void> {
    if (!this.holds('confirming', task)) return
    await this.step(async () => {
      await this.show({ kind: 'sending', task, act: 'next' })
      await this.show(await this.answer(task, 'next', nextArgs(task, false)))
      await this.ports.focus(actKey('next', task))
    })
  }

  /** Closes `task`'s Note field or Next confirm, the ring back on the press that opened it. */
  async cancel(task: string): Promise<void> {
    const act = this.act
    if (act === null || act.task !== task || (act.kind !== 'noting' && act.kind !== 'confirming')) return
    await this.step(async () => {
      await this.show(null)
      await this.ports.focus(actKey(act.kind === 'noting' ? 'note' : 'next', task))
    })
  }

  /** True when the act open is `kind` on `task`. */
  private holds(kind: 'noting' | 'confirming', task: string): boolean {
    return this.act?.kind === kind && this.act.task === task
  }

  /** Runs `act`'s step unless one runs now. A tell or focus that fails ends the step, the last act left drawn. */
  private async step(act: () => Promise<void>): Promise<void> {
    if (this.isRunning) return
    this.isRunning = true
    try {
      await act()
    } catch {
      // A failed tell leaves the last act drawn; a failed focus leaves the ring where it was.
    } finally {
      this.isRunning = false
    }
  }

  /** Tells where the act stands, and keeps it once told. */
  private async show(act: OwnerAct | null): Promise<void> {
    await this.ports.tell(act)
    this.act = act
  }

  /** What a run of `teamrig <args>` answered, as the card says it. */
  private async answer(task: string, act: OwnerActName, args: readonly string[]): Promise<OwnerAct> {
    const ran = await this.ran(task, act, args)
    return ran.kind === 'ran' ? actOutcome(task, act, ran.run) : refused(task, act, ran.lines)
  }

  /** Runs `teamrig <args>`; with no CLI found, or a run that does not finish, why it gave no answer. */
  private async ran(task: string, act: OwnerActName, args: readonly string[]): Promise<Ran> {
    const cli = this.cli
    if (cli.kind === 'missing') return { kind: 'failed', lines: [cli.problem] }
    try {
      return { kind: 'ran', run: await this.ports.run(cliArgv(cli.main, args), ACT_TIMEOUT_MS) }
    } catch (error) {
      return { kind: 'failed', lines: [`teamrig owner ${act} ${task} did not finish: ${messageOf(error)}`] }
    }
  }
}

/** A refused act, told with `lines`. */
function refused(task: string, act: OwnerActName, lines: readonly string[]): OwnerAct {
  return { kind: 'told', task, act, outcome: 'refused', lines }
}
