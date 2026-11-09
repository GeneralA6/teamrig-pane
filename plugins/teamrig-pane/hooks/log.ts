// The rows the pane draws, from tasks as teamrig folds its register. hooks/core is a copy of teamrig's
// read entry (src/read/index.ts) and the modules it reaches, written by scripts/sync-core.ts, so every
// event, status and line teamrig writes reads here as teamrig's own commands read it (T248). This file
// only maps a folded task to the row the pane draws.
import type { AnswerRow, DecisionRow, RankFocus, TaskRow, TaskSpend, TaskStatus, WaitRow } from '../types'
import type { RankingFocus, StoredSpend, Task, TaskStatus as ReadStatus, WaitReason } from './core/read/index'

/** True only when A and B are the same union. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
// The plugin contract (types/index.d.ts) cannot import, so it spells the statuses out: this fails a
// typecheck (an editor, tsc) the day teamrig adds a status the contract does not have, or drops one.
// `claude plugin test` does not typecheck, so tests/logic.test.ts checks the statuses at run time.
export const STATUS_CONTRACT_MATCHES: Same<TaskStatus, ReadStatus> = true
// The same for what a waiting task waits for.
export const WAIT_CONTRACT_MATCHES: Same<WaitRow, WaitReason> = true
// The same for an item's type (a task or a bug).
export const ITEM_TYPE_CONTRACT_MATCHES: Same<TaskRow['type'], Task['type']> = true
// The same for the `focus` keys a ranking reads.
export const FOCUS_CONTRACT_MATCHES: Same<RankFocus, RankingFocus> = true
// The same for the lead's answer to an approval wait and the owner's decision on a card, which say whether a
// waiting task can move (core register/can-move.ts).
export const ANSWER_CONTRACT_MATCHES: Same<AnswerRow | null, Task['answer']> = true
export const DECISION_CONTRACT_MATCHES: Same<DecisionRow | null, Task['decided']> = true
// The same for what tasks have cost, which a ranking sizes them by (core register/ranking.ts storedSizing).
export const SPEND_CONTRACT_MATCHES: Same<TaskSpend, StoredSpend> = true

/** A task as the pane draws it. */
export function rowOf(task: Task): TaskRow {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    owner: task.owner,
    priority: task.priority,
    type: task.type,
    critical: task.critical,
    due: task.due,
    status: task.status,
    note: task.note,
    proof: task.proof,
    evidence: task.evidence,
    skill: task.skill,
    statusAt: task.statusAt,
    source: task.source,
    ref: task.ref,
    goals: task.goals,
    week: task.week,
    size: task.size,
    pin: task.pin,
    workClass: task.workClass,
    createdBy: task.createdBy,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    updatedBy: task.updatedBy,
    priorityAt: task.priorityAt,
    assignedAt: task.assignedAt,
    ownerSeenAt: task.ownerSeenAt,
    waits: task.waits,
    answer: task.answer,
    decided: task.decided,
    after: task.after,
  }
}
