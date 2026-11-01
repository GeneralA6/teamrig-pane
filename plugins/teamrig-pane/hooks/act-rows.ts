// The owner's acts at the bottom of a task's open card and of its page (T1299; owner-acts.ts runs them): a [Note]
// press, and a [Next] press on a task not in progress yet; none on a task done or dropped. The act open on the task
// draws in their place: the Note field with [Send] and [Cancel], Next's preview with [Confirm] and [Cancel], a dim
// line while teamrig runs, and what the last act on it answered above the presses, its lines verbatim in the success
// color, a refusal's in the error one. One act at a time in the pane, so only its task's card draws it. Pure rows
// after the card's (rows.ts, page.ts): the docked layout draws each press as a Button and the field as an Input; inline
// draws none of them (layout.ts).
import type { OwnerAct, OwnerActPress, TaskRow, TaskStatus } from '../types'
import type { Row, Span } from './rows'

/** Where the owner's act stands, pane-wide, which the act rows draw from; null when no act is open. */
export type CardActs = { readonly act: OwnerAct | null }

/** Each press's words. */
export const ACT_TEXT: Readonly<Record<OwnerActPress, string>> = {
  note: '[Note]',
  next: '[Next]',
  send: '[Send]',
  cancel: '[Cancel]',
  confirm: '[Confirm]',
}

/** Between two presses. */
const PRESS_GAP: Span = { text: ' ' }

/** A task in these states takes no act: it is closed. */
const CLOSED: ReadonlySet<TaskStatus> = new Set(['done', 'dropped'])

/** The presses a task takes with no act open on it: Note, and Next unless it is in progress already. */
function restingPresses(task: TaskRow): OwnerActPress[] {
  return task.status === 'in-progress' ? ['note'] : ['note', 'next']
}

/** What the dim line says while teamrig runs an act on `task`. */
function runningText(act: Extract<OwnerAct, { kind: 'previewing' | 'sending' }>): string {
  if (act.kind === 'previewing') return `Asking teamrig what Next on ${act.task} would do…`
  return act.act === 'note' ? `Sending the Note on ${act.task}…` : `Putting ${act.task} next…`
}

/**
 * The act rows of `task`'s card, keyed `<section>-acts:<id>`, `lead` starting each (the guide in the list, none on a
 * page); none for a closed task, nor with `acts` null (a pane with no team, which has no CLI to run them through).
 */
export function actRows(section: string, task: TaskRow, acts: CardActs | null, lead: Span | null): Row[] {
  if (acts === null || CLOSED.has(task.status)) return []
  const key = `${section}-acts:${task.id}`
  const lined = (row: string, spans: Span[]): Row => ({ key: `${key}:${row}`, spans: lead === null ? spans : [lead, ...spans], hang: lead ?? undefined })
  const presses = (list: readonly OwnerActPress[]): Row =>
    lined(
      'presses',
      list.flatMap((press, i): Span[] => {
        const span: Span = { text: ACT_TEXT[press], color: 'suggestion', acts: { task: task.id, press } }
        return i === 0 ? [span] : [PRESS_GAP, span]
      }),
    )
  const said = (lines: readonly string[], style: Omit<Span, 'text'>): Row[] => lines.map((text, i) => lined(`said:${i}`, [{ ...style, text }]))
  const act = acts.act?.task === task.id ? acts.act : null
  if (act === null) return [presses(restingPresses(task))]
  switch (act.kind) {
    case 'noting':
      return [{ ...lined('field', [{ text: `a Note to ${task.id}'s session`, dim: true }]), field: { task: task.id, round: act.round } }, presses(['send', 'cancel'])]
    case 'confirming':
      return [...said(act.lines, {}), presses(['confirm', 'cancel'])]
    case 'previewing':
    case 'sending':
      return [lined('running', [{ text: runningText(act), dim: true }]), presses(restingPresses(task))]
    case 'told':
      return [...said(act.lines, { color: act.outcome === 'done' ? 'success' : 'error' }), presses(restingPresses(task))]
  }
}
