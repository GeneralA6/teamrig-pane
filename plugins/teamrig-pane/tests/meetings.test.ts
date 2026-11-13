// The Meetings view's source (hooks/meetings.ts): `teamrig meeting list --all --json` read with type guards, the rows it
// cannot read counted; written only when it changed and read only while the view shows; a start press runs `meeting
// start`, one at a time, tells what it answered and reads the list again; each run passes the caller's --session.
import { describe, expect, test } from 'claude-code/testing'
import type { MeetingStart, MeetingsView } from '../types'
import { TICK_MS } from '../hooks/live'
import { LIST_TIMEOUT_MS, LiveMeetings, START_TIMEOUT_MS, listView, parseMeeting, readMeetingList, startOutcome, type MeetingsPorts } from '../hooks/meetings'
import { cliArgv, type CliRun, type TeamrigCli } from '../hooks/teamrig-cli'

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

/** Ports recording each run, publish and tell; `answers` answer the runs in turn, the last one again after. */
function portsOf(answers: readonly (CliRun | Error)[], shown = true): MeetingsPorts & { runs: { args: readonly string[]; timeoutMs: number }[]; views: MeetingsView[]; told: MeetingStart[] } {
  const runs: { args: readonly string[]; timeoutMs: number }[] = []
  const views: MeetingsView[] = []
  const told: MeetingStart[] = []
  return {
    runs,
    views,
    told,
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
    },
    tell: async start => {
      told.push(start)
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

describe('startOutcome', () => {
  test('started, with the lines after its STARTED line; refused, with why', () => {
    const started = ok('STARTED M3 scheduled, Tue 17:00, 30 min, api | Pick the cache\nTOLD api\nWAKES api with the opening prompt\n')
    expect(startOutcome('M3', started)).toEqual({ id: 'M3', outcome: 'started', lines: ['TOLD api', 'WAKES api with the opening prompt'] })
    const refused = { ...started, exitCode: 2, stderr: 'REFUSED M3 is started: meeting start takes a scheduled meeting' }
    expect(startOutcome('M3', refused)).toEqual({ id: 'M3', outcome: 'refused', lines: ['REFUSED M3 is started: meeting start takes a scheduled meeting'] })
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

  test('a start tells it is starting, runs meeting start, tells what it answered, then reads the list again', async () => {
    const started = ok('STARTED M3\nTOLD api\n')
    const ports = portsOf([started, LISTED])
    await new LiveMeetings(CLI, ports).start('M3')
    expect(ports.runs).toEqual([
      { args: cliArgv(CLI.main, ['meeting', 'start', 'M3', '--session', 'lead']), timeoutMs: START_TIMEOUT_MS },
      { args: cliArgv(CLI.main, ['meeting', 'list', '--all', '--json', '--session', 'lead']), timeoutMs: LIST_TIMEOUT_MS },
    ])
    expect(ports.told).toEqual([
      { id: 'M3', outcome: 'starting', lines: [] },
      { id: 'M3', outcome: 'started', lines: ['TOLD api'] },
    ])
  })

  test('a press while a start runs does nothing; a start that does not finish is told as refused', async () => {
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
    const first = live.start('M3')
    await live.start('M3')
    open()
    await first
    expect(ports.told.filter(start => start.outcome === 'starting').length).toBe(1)

    const stuck = portsOf([new Error('timed out')])
    await new LiveMeetings(CLI, stuck).start('M4')
    expect(stuck.told[1]).toEqual({ id: 'M4', outcome: 'refused', lines: ['teamrig meeting start M4 did not finish: timed out'] })
  })
})
