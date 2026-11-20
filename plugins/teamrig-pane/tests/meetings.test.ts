// The Meetings view's source (hooks/meetings.ts): `teamrig meeting list --all --json` read with type guards, the rows it
// cannot read counted; written only when it changed and read only while the view shows; a card's ask press opens its
// second line and Back closes it; a run press closes it and runs `meeting start|end|drop|move|postpone`, one at a time,
// tells what it answered and reads the list again; each run passes the caller's --session (T2778).
import { describe, expect, test } from 'claude-code/testing'
import type { MeetingAnswer, MeetingAsked, MeetingsView } from '../types'
import { RUN_GRACE_MS, bounded } from '../hooks/bounded-run'
import { TimeZone } from '../hooks/core/read/index'
import { TICK_MS } from '../hooks/live'
import {
  LIST_TIMEOUT_MS,
  LiveMeetings,
  RUN_TIMEOUT_MS,
  listView,
  meetingWords,
  movedAt,
  parseMeeting,
  readMeetingList,
  runOutcome,
  type MeetingsPorts,
} from '../hooks/meetings'
import { cliArgv, type CliRun, type TeamrigCli } from '../hooks/teamrig-cli'
import { zoneNamed, type Clock } from '../hooks/zone'

const CLI: TeamrigCli = { kind: 'found', main: 'K/teamrig/dist/cli/main.js' }
const PRINTED = {
  id: 'M3',
  at: '2026-10-13T15:00:00.000Z',
  atText: 'Tue 10-13 17:00',
  minutes: 30,
  session: 'api',
  with: ['lead'],
  tasks: ['T12'],
  about: 'Pick the cache',
  brief: 'notes/api/brief.md',
  status: 'scheduled',
  missed: false,
}
const MEETING = { ...PRINTED, at: Date.parse(PRINTED.at) }

function ok(stdout: string): CliRun {
  return { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false }
}

const LISTED = ok(JSON.stringify({ meetings: [PRINTED] }))

/** 2026-10-13 14:00 UTC, the clock the runs read. */
const NOW = Date.UTC(2026, 9, 13, 14, 0)
const UTC_CLOCK: Clock = { now: NOW, zone: TimeZone.UTC }

type Recorded = { runs: { args: readonly string[]; timeoutMs: number }[]; views: MeetingsView[]; told: MeetingAnswer[]; asked: (MeetingAsked | null)[]; atom: { value: MeetingsView } }

/** Ports recording each run, publish, tell and ask; `answers` answer the runs in turn, the last one again after. */
function portsOf(answers: readonly (CliRun | Error)[], shown = true): MeetingsPorts & Recorded {
  const runs: Recorded['runs'] = []
  const views: MeetingsView[] = []
  const told: MeetingAnswer[] = []
  const asked: (MeetingAsked | null)[] = []
  const held: { value: MeetingsView } = { value: { kind: 'reading' } }
  return {
    held: async () => held.value,
    atom: held,
    runs,
    views,
    told,
    asked,
    clock: async () => UTC_CLOCK,
    ask: async line => {
      asked.push(line)
    },
    run: async (args, timeoutMs) => {
      runs.push({ args, timeoutMs })
      const answer = answers[Math.min(runs.length, answers.length) - 1] ?? LISTED
      if (answer instanceof Error) throw answer
      return answer
    },
    caller: async () => 'lead',
    isShown: async () => shown,
    publish: async view => {
      views.push(view)
      held.value = view
    },
    tell: async answer => {
      told.push(answer)
    },
  }
}

describe('parseMeeting', () => {
  test('reads a printed meeting, its time as epoch ms; one missing a field or of another type is null', () => {
    expect(parseMeeting(PRINTED)).toEqual(MEETING)
    expect(parseMeeting({ ...PRINTED, brief: null })).toEqual({ ...MEETING, brief: null })
    expect(parseMeeting({ ...PRINTED, at: 'soon' })).toBe(null)
    expect(parseMeeting({ ...PRINTED, status: 'moved' })).toBe(null)
    expect(parseMeeting({ ...PRINTED, with: 'lead' })).toBe(null)
    expect(parseMeeting({ ...PRINTED, missed: 'no' })).toBe(null)
    expect(parseMeeting([PRINTED])).toBe(null)
  })
})

describe('readMeetingList', () => {
  test('the meetings it reads and a count of the ones it cannot; output that is no list is null', () => {
    expect(readMeetingList(JSON.stringify({ meetings: [PRINTED, { id: 'M4' }] }))).toEqual({ meetings: [MEETING], unreadable: 1 })
    expect(readMeetingList('{"meetings": [')).toBe(null)
    expect(readMeetingList(JSON.stringify({ rows: [] }))).toBe(null)
  })
})

describe('listView', () => {
  test('a list; a refusal says what teamrig wrote, else its exit code; cut or unreadable output asks for an update', () => {
    expect(listView(LISTED)).toEqual({ kind: 'list', meetings: [MEETING], unreadable: 0 })
    expect(listView({ ...LISTED, exitCode: 2, stderr: 'REFUSED no team here\n' })).toEqual({ kind: 'failed', reason: 'REFUSED no team here' })
    expect(listView({ ...LISTED, exitCode: 1 })).toEqual({ kind: 'failed', reason: 'teamrig meeting list exited 1' })
    const unreadable: MeetingsView = { kind: 'failed', reason: 'teamrig printed no meeting list the pane can read: update teamrig' }
    expect(listView({ ...LISTED, isStdoutTruncated: true })).toEqual(unreadable)
    expect(listView(ok('MEETINGS 0 scheduled or started'))).toEqual(unreadable)
  })
})

describe('runOutcome', () => {
  test('done, with the lines after its first word; refused, with why', () => {
    const started = ok('STARTED M3 scheduled, Tue 17:00, 30 min, api | Pick the cache\nTOLD api\nWAKES api with the opening prompt\n')
    expect(runOutcome('M3', 'start', started)).toEqual({ id: 'M3', verb: 'start', outcome: 'done', lines: ['TOLD api', 'WAKES api with the opening prompt'] })
    const refused = { ...started, exitCode: 2, stderr: 'REFUSED M3 is started: meeting start takes a scheduled meeting' }
    expect(runOutcome('M3', 'start', refused)).toEqual({ id: 'M3', verb: 'start', outcome: 'refused', lines: ['REFUSED M3 is started: meeting start takes a scheduled meeting'] })
  })

  test("each verb drops its own first word only: an end keeps another verb's line", () => {
    expect(runOutcome('M3', 'move', ok('MOVED M3 to Wed 17:00\nTOLD api\n')).lines).toEqual(['TOLD api'])
    expect(runOutcome('M3', 'drop', ok('DROPPED M3\n')).lines).toEqual([])
    expect(runOutcome('M1', 'end', ok('ENDED M1\nSTARTED M2\n')).lines).toEqual(['STARTED M2'])
    expect(runOutcome('M1', 'postpone', ok('POSTPONED M1 to 15:00\n')).lines).toEqual([])
  })
})

describe('movedAt', () => {
  test('in an hour is an hour on, up to the whole minute after', () => {
    expect(movedAt({ kind: 'in-1h' }, UTC_CLOCK)).toBe(NOW + 60 * 60 * 1000)
    expect(movedAt({ kind: 'in-1h' }, { ...UTC_CLOCK, now: NOW + 1 })).toBe(NOW + 61 * 60 * 1000)
  })

  test("tomorrow is the team's next calendar day at the meeting's wall time, across a clock change and a day line", () => {
    // Israel leaves summer time on Sun 10-25: a 17:00 IDT meeting moved on Sat goes to Sun 17:00 IST, 15:00 UTC.
    const israel: Clock = { now: Date.UTC(2026, 9, 24, 12, 0), zone: zoneNamed('Asia/Jerusalem') }
    expect(movedAt({ kind: 'tomorrow', from: Date.UTC(2026, 9, 24, 14, 0) }, israel)).toBe(Date.UTC(2026, 9, 25, 15, 0))
    // 23:30 UTC on 10-13 is already 10-14 08:30 in Tokyo: tomorrow there is 10-15 08:30 JST.
    const tokyo: Clock = { now: Date.UTC(2026, 9, 13, 23, 30), zone: zoneNamed('Asia/Tokyo') }
    expect(movedAt({ kind: 'tomorrow', from: Date.UTC(2026, 9, 13, 23, 30) }, tokyo)).toBe(Date.UTC(2026, 9, 14, 23, 30))
    // A meeting set for another day keeps its wall time: tomorrow counts from now, not from the meeting.
    expect(movedAt({ kind: 'tomorrow', from: Date.UTC(2026, 9, 20, 9, 15) }, UTC_CLOCK)).toBe(Date.UTC(2026, 9, 14, 9, 15))
  })
})

describe('meetingWords', () => {
  test("each verb's words: start and end the id alone, drop its reason as the note, move and postpone their time as ISO", () => {
    expect(meetingWords('M3', { verb: 'start' }, UTC_CLOCK)).toEqual(['meeting', 'start', 'M3'])
    expect(meetingWords('M1', { verb: 'end' }, UTC_CLOCK)).toEqual(['meeting', 'end', 'M1'])
    expect(meetingWords('M3', { verb: 'drop', why: 'Covered elsewhere' }, UTC_CLOCK)).toEqual(['meeting', 'drop', 'M3', '--note', 'Covered elsewhere'])
    expect(meetingWords('M3', { verb: 'move', to: { kind: 'in-1h' } }, UTC_CLOCK)).toEqual(['meeting', 'move', 'M3', '--at', '2026-10-13T15:00:00.000Z'])
    const tomorrow = { kind: 'tomorrow', from: Date.UTC(2026, 9, 13, 13, 0) } as const
    expect(meetingWords('M1', { verb: 'postpone', to: tomorrow }, UTC_CLOCK)).toEqual(['meeting', 'postpone', 'M1', '--at', '2026-10-14T13:00:00.000Z'])
  })
})

describe('LiveMeetings', () => {
  test("reads the list with the caller's --session and writes it only when it changed", async () => {
    const ports = portsOf([LISTED])
    const live = new LiveMeetings(CLI, ports)
    await live.refresh()
    await live.refresh()
    expect(ports.runs).toEqual([
      { args: cliArgv(CLI.main, ['meeting', 'list', '--all', '--json', '--session', 'lead']), timeoutMs: LIST_TIMEOUT_MS },
      { args: cliArgv(CLI.main, ['meeting', 'list', '--all', '--json', '--session', 'lead']), timeoutMs: LIST_TIMEOUT_MS },
    ])
    expect(ports.views).toEqual([{ kind: 'list', meetings: [MEETING], unreadable: 0 }])
  })

  test('with no caller known, no --session: the CLI asks its own variable', async () => {
    const ports = { ...portsOf([LISTED]), caller: async () => null }
    await new LiveMeetings(CLI, ports).refresh()
    expect(ports.runs[0]?.args).toEqual(cliArgv(CLI.main, ['meeting', 'list', '--all', '--json']))
  })

  test('no CLI, or a run that does not finish, shows why', async () => {
    const missing = portsOf([])
    await new LiveMeetings({ kind: 'missing', problem: 'no plugin list' }, missing).refresh()
    expect([missing.runs, missing.views]).toEqual([[], [{ kind: 'failed', reason: 'no plugin list' }]])
    const stuck = portsOf([new Error('timed out')])
    await new LiveMeetings(CLI, stuck).refresh()
    expect(stuck.views).toEqual([{ kind: 'failed', reason: 'teamrig meeting list did not finish: timed out' }])
  })

  test('polls every TICK_MS, reading only while the view shows', async () => {
    const hidden = portsOf([LISTED], false)
    const live = new LiveMeetings(CLI, hidden)
    const every: number[] = []
    live.startTimers(ms => {
      every.push(ms)
      return { cancel: () => undefined }
    })
    await live.poll()
    expect([every, hidden.runs]).toEqual([[TICK_MS], []])
    const shown = portsOf([LISTED])
    await new LiveMeetings(CLI, shown).poll()
    expect(shown.views.length).toBe(1)
  })

  test('a run press closes the second line, tells it is running, runs its verb, tells what it answered, then reads the list again', async () => {
    const started = ok('STARTED M3\nTOLD api\n')
    const ports = portsOf([started, LISTED])
    await new LiveMeetings(CLI, ports).press({ kind: 'run', id: 'M3', run: { verb: 'start' } })
    expect(ports.asked).toEqual([null])
    expect(ports.runs).toEqual([
      { args: cliArgv(CLI.main, ['meeting', 'start', 'M3', '--session', 'lead']), timeoutMs: RUN_TIMEOUT_MS },
      { args: cliArgv(CLI.main, ['meeting', 'list', '--all', '--json', '--session', 'lead']), timeoutMs: LIST_TIMEOUT_MS },
    ])
    expect(ports.told).toEqual([
      { id: 'M3', verb: 'start', outcome: 'running', lines: [] },
      { id: 'M3', verb: 'start', outcome: 'done', lines: ['TOLD api'] },
    ])
  })

  test('a move press runs meeting move at the time the clock port gives; a drop passes its reason', async () => {
    const ports = portsOf([ok('MOVED M3\n'), LISTED, ok('DROPPED M3\n'), LISTED])
    const live = new LiveMeetings(CLI, ports)
    await live.press({ kind: 'run', id: 'M3', run: { verb: 'move', to: { kind: 'in-1h' } } })
    await live.press({ kind: 'run', id: 'M3', run: { verb: 'drop', why: 'Not needed' } })
    expect(ports.runs.filter(run => !run.args.includes('list')).map(run => run.args)).toEqual([
      cliArgv(CLI.main, ['meeting', 'move', 'M3', '--at', '2026-10-13T15:00:00.000Z', '--session', 'lead']),
      cliArgv(CLI.main, ['meeting', 'drop', 'M3', '--note', 'Not needed', '--session', 'lead']),
    ])
    expect(ports.told.map(answer => [answer.verb, answer.outcome])).toEqual([
      ['move', 'running'],
      ['move', 'done'],
      ['drop', 'running'],
      ['drop', 'done'],
    ])
  })

  test('an ask press opens its second line and Back closes it, running nothing', async () => {
    const ports = portsOf([LISTED])
    const live = new LiveMeetings(CLI, ports)
    await live.press({ kind: 'ask', id: 'M1', ask: 'end' })
    await live.press({ kind: 'back', id: 'M1' })
    expect([ports.asked, ports.runs, ports.told]).toEqual([[{ id: 'M1', ask: 'end' }, null], [], []])
  })

  test('with no CLI a run press is told as refused with why', async () => {
    const ports = portsOf([])
    await new LiveMeetings({ kind: 'missing', problem: 'no plugin list' }, ports).press({ kind: 'run', id: 'M1', run: { verb: 'end' } })
    expect(ports.told[1]).toEqual({ id: 'M1', verb: 'end', outcome: 'refused', lines: ['no plugin list'] })
  })

  test('a press while a run runs does nothing; a run that does not finish is told as refused', async () => {
    // Only the start waits, on a gate made before it runs (the start reaches its run a few awaits after the press);
    // the list read after it answers at once.
    let open = (): void => undefined
    const gate = new Promise<void>(resolve => {
      open = resolve
    })
    const ports = portsOf([ok('STARTED M3\n')])
    const slow: MeetingsPorts = {
      ...ports,
      run: async (args, timeoutMs) => {
        if (args.includes('start')) await gate
        return ports.run(args, timeoutMs)
      },
    }
    const live = new LiveMeetings(CLI, slow)
    const first = live.run('M3', { verb: 'start' })
    await live.run('M3', { verb: 'drop', why: 'Not needed' })
    open()
    await first
    expect(ports.told.filter(answer => answer.outcome === 'running')).toEqual([{ id: 'M3', verb: 'start', outcome: 'running', lines: [] }])

    const stuck = portsOf([new Error('timed out')])
    await new LiveMeetings(CLI, stuck).run('M4', { verb: 'start' })
    expect(stuck.told[1]).toEqual({ id: 'M4', verb: 'start', outcome: 'refused', lines: ['teamrig meeting start M4 did not finish: timed out'] })
  })

  test('a run the engine never settles fails once the bound passes and frees the read for the next one (T2807)', async () => {
    // The bound's timer, fired by hand once the read reached its run (the caller is asked first); the first run never
    // settles, the ones after answer at once.
    let fire = (): void => undefined
    let arm = (): void => undefined
    const isArmed = new Promise<void>(resolve => {
      arm = resolve
    })
    const every = (_ms: number, fn: () => void): { cancel: () => void } => {
      fire = fn
      arm()
      return { cancel: () => undefined }
    }
    const ports = portsOf([LISTED])
    let isFirst = true
    const hung: MeetingsPorts = {
      ...ports,
      run: (args, timeoutMs) => {
        const answer = isFirst ? new Promise<CliRun>(() => undefined) : ports.run(args, timeoutMs)
        isFirst = false
        return bounded(answer, timeoutMs, every)
      },
    }
    const live = new LiveMeetings(CLI, hung)
    const first = live.refresh()
    await isArmed
    fire()
    await first
    const limitS = (LIST_TIMEOUT_MS + RUN_GRACE_MS) / 1000
    expect(ports.views).toEqual([{ kind: 'failed', reason: `teamrig meeting list did not finish: no answer in ${limitS} s` }])
    await live.refresh()
    expect(ports.views[1]).toEqual({ kind: 'list', meetings: [MEETING], unreadable: 0 })
  })
})

describe('LiveMeetings against the view the engine holds', () => {
  test('a view the engine set back to its default is written again by the next read that answers the same', async () => {
    const ports = portsOf([])
    const live = new LiveMeetings({ kind: 'missing', problem: 'teamrig is not installed' }, ports)
    await live.refresh()
    expect(ports.views).toEqual([{ kind: 'failed', reason: 'teamrig is not installed' }])

    ports.atom.value = { kind: 'reading' }
    await live.poll()
    expect(ports.views).toEqual([{ kind: 'failed', reason: 'teamrig is not installed' }, { kind: 'failed', reason: 'teamrig is not installed' }])
    expect(ports.atom.value).toEqual({ kind: 'failed', reason: 'teamrig is not installed' })
  })

  test('a view the engine still holds is not written again', async () => {
    const ports = portsOf([])
    const live = new LiveMeetings(CLI, ports)
    await live.refresh()
    await live.poll()
    await live.poll()
    expect(ports.views.length).toBe(1)
  })
})
