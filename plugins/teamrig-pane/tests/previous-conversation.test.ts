// The band's previous conversation (hooks/previous-conversation.ts): a poll reads it for the area and the Claude Code
// session of now until it settles, again when either moves, writes it only when it changed, and never rejects.
import { describe, expect, test } from 'claude-code/testing'
import type { LogConversation } from '../types'
import { POLL_MS, type Timer } from '../hooks/live'
import { LivePrevious } from '../hooks/previous-conversation'

const NOW = Date.parse('2026-10-19T20:30:00Z')

/** A conversation of `session` with the id `claude`; `nextAt` null while the conversation of now wrote no line. */
function conversation(session: string, claude: string, nextAt: number | null): LogConversation {
  return { session, claude, firstAt: NOW - 60_000, lastAt: NOW - 30_000, nextAt, lines: 2, opening: { by: 'owner', line: 'plan the week' } }
}

/** A poll over a fake reader: `answers` holds what each read for `area|claude` answers, `reads` each read, `fail` makes reads or writes throw. */
function fakePrevious() {
  const state = { area: 'lead' as string | null, claude: 'c-2' }
  const answers = new Map<string, LogConversation | null>()
  const reads: string[] = []
  const written: (LogConversation | null)[] = []
  const fail = { read: false, write: false }
  const live = new LivePrevious({
    reader: {
      previous: async (session, claude, now) => {
        reads.push(`${session}|${claude}`)
        if (now !== NOW) throw new Error(`read at ${now}`)
        if (fail.read) throw new Error('EBUSY: resource busy')
        return answers.get(`${session}|${claude}`) ?? null
      },
    },
    now: async () => NOW,
    area: async () => state.area,
    claude: async () => state.claude,
    publish: async previous => {
      if (fail.write) throw new Error('write failed')
      written.push(previous)
    },
  })
  return { live, state, answers, reads, written, fail }
}

describe('LivePrevious', () => {
  test('writes the previous conversation once, and reads no more once the conversation of now follows it', async () => {
    const kit = fakePrevious()
    kit.answers.set('lead|c-2', conversation('lead', 'c-1', NOW - 10_000))
    await kit.live.poll()
    await kit.live.poll()
    expect(kit.written).toEqual([conversation('lead', 'c-1', NOW - 10_000)])
    expect(kit.reads).toEqual(['lead|c-2'])
  })

  test('reads again at each poll while the conversation of now wrote no line, writing only a change', async () => {
    const kit = fakePrevious()
    kit.answers.set('lead|c-2', conversation('lead', 'c-1', null))
    await kit.live.poll()
    await kit.live.poll()
    expect(kit.reads).toEqual(['lead|c-2', 'lead|c-2'])
    expect(kit.written).toEqual([conversation('lead', 'c-1', null)])

    kit.answers.set('lead|c-2', conversation('lead', 'c-1', NOW - 5_000))
    await kit.live.poll()
    await kit.live.poll()
    expect(kit.reads.length).toBe(3)
    expect(kit.written.at(-1)).toEqual(conversation('lead', 'c-1', NOW - 5_000))
  })

  test('reads again after a /clear starts a new Claude Code session, and after the area moves', async () => {
    const kit = fakePrevious()
    kit.answers.set('lead|c-2', conversation('lead', 'c-1', NOW - 10_000))
    kit.answers.set('lead|c-3', conversation('lead', 'c-2', NOW - 5_000))
    kit.answers.set('api|c-3', conversation('api', 'c-0', NOW - 1_000))
    await kit.live.poll()
    kit.state.claude = 'c-3'
    await kit.live.poll()
    kit.state.area = 'api'
    await kit.live.poll()
    expect(kit.reads).toEqual(['lead|c-2', 'lead|c-3', 'api|c-3'])
    expect(kit.written.map(each => each?.claude)).toEqual(['c-1', 'c-2', 'c-0'])
  })

  test('writes none and reads nothing with no area; none to name settles too', async () => {
    const kit = fakePrevious()
    kit.state.area = null
    await kit.live.poll()
    await kit.live.poll()
    expect(kit.reads).toEqual([])
    expect(kit.written).toEqual([null])

    kit.state.area = 'lead'
    await kit.live.poll()
    await kit.live.poll()
    expect(kit.reads).toEqual(['lead|c-2'])
    expect(kit.written).toEqual([null])
  })

  test('a failed read or write never rejects, and the next poll reads and writes again', async () => {
    const kit = fakePrevious()
    kit.answers.set('lead|c-2', conversation('lead', 'c-1', NOW - 10_000))
    kit.fail.read = true
    await kit.live.poll()
    expect(kit.written).toEqual([])
    kit.fail.read = false
    kit.fail.write = true
    await kit.live.poll()
    expect(kit.written).toEqual([])
    kit.fail.write = false
    await kit.live.poll()
    expect(kit.written).toEqual([conversation('lead', 'c-1', NOW - 10_000)])
    expect(kit.reads.length).toBe(3)
  })

  test('polls every POLL_MS once started, and stop cancels the timer', async () => {
    const kit = fakePrevious()
    const asked: number[] = []
    let cancelled = 0
    kit.live.startTimers((ms): Timer => {
      asked.push(ms)
      return { cancel: () => void cancelled++ }
    })
    expect(asked).toEqual([POLL_MS])
    kit.live.stop()
    expect(cancelled).toBe(1)
  })
})
