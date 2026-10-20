// The Log view's reads (hooks/turn-log.ts): a turn log line read into an entry, the sessions listed with their
// newest prompt, a session's page of the last 24 h under its cap, each file read again only when it moved, and the
// poll that writes the list or the page only when it changed, over a fake disk.
import { describe, expect, test } from 'claude-code/testing'
import type { LogList, LogPage } from '../types'
import { POLL_MS } from '../hooks/live'
import { LOG_PAGE_CHARS, LiveLog, TurnLogReader, parseTurnLine, parseTurnLines, type LogDirEntry, type LogFiles } from '../hooks/turn-log'

const DIR = '/kit/teams/web/state/turn-log'
const NOW = Date.parse('2026-10-19T20:30:00Z')
const MINUTE = 60_000

/** A turn log line as teamrig writes it. */
function line(at: string, kind: string, text: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ v: 1, at, kind, text, claude: 'c-1', ...extra })
}

/** A disk of turn log files: each folder lists what lies right under it, `reads` lists each read, `fail` makes a path's read or list throw. */
function fakeDisk() {
  const files = new Map<string, { text: string; mtimeMs: number }>()
  const fail = new Map<string, Error>()
  const reads: string[] = []
  let tick = 1_000
  const ports: LogFiles = {
    list: async dir => {
      const failed = fail.get(dir)
      if (failed !== undefined) throw failed
      const prefix = `${dir}/`
      const entries = new Map<string, LogDirEntry>()
      for (const [path, file] of files) {
        if (!path.startsWith(prefix)) continue
        const [name = '', ...deeper] = path.slice(prefix.length).split('/')
        entries.set(name, deeper.length > 0 ? { name, kind: 'dir', size: 0, mtimeMs: 0 } : { name, kind: 'file', size: file.text.length, mtimeMs: file.mtimeMs })
      }
      return entries.size === 0 ? null : [...entries.values()]
    },
    read: async path => {
      reads.push(path.slice(DIR.length + 1))
      const failed = fail.get(path)
      if (failed !== undefined) throw failed
      const file = files.get(path)
      if (file === undefined) throw new Error(`ENOENT: ${path}`)
      return file.text
    },
  }
  return {
    ports,
    reads,
    fail,
    /** Writes `session`'s file of `hour`, moving its mtime as an append would. */
    write: (session: string, hour: string, lines: string[]) => void files.set(`${DIR}/${session}/${hour}.jsonl`, { text: `${lines.join('\n')}\n`, mtimeMs: tick++ }),
    put: (path: string) => void files.set(`${DIR}/${path}`, { text: '', mtimeMs: tick++ }),
  }
}

describe('parseTurnLine', () => {
  test('reads a line of version 1, its cut mark included, and ignores fields it does not know', () => {
    expect(parseTurnLine(line('2026-10-19T20:01:00Z', 'prompt', 'ship it', { upTo: 'x', extra: 1 }))).toEqual({
      at: '2026-10-19T20:01:00Z',
      kind: 'prompt',
      text: 'ship it',
      claude: 'c-1',
      isCut: false,
    })
    expect(parseTurnLine(line('2026-10-19T20:02:00Z', 'reply', '…end', { truncated: true }))?.isCut).toBe(true)
    expect(parseTurnLine(line('2026-10-19T20:03:00Z', 'clear', 'context compacted'))?.kind).toBe('clear')
  })

  test('skips a line of another version, a torn line, one missing a field, one of an unknown kind, and one that is no object', () => {
    expect(parseTurnLine(JSON.stringify({ v: 2, at: 'a', kind: 'prompt', text: 't', claude: 'c' }))).toBeNull()
    expect(parseTurnLine('{"v":1,"at":"2026-10-19T20:0')).toBeNull()
    expect(parseTurnLine(JSON.stringify({ v: 1, at: 'a', kind: 'prompt', text: 't' }))).toBeNull()
    expect(parseTurnLine(JSON.stringify({ v: 1, at: 'a', kind: 'prompt', text: 3, claude: 'c' }))).toBeNull()
    expect(parseTurnLine(JSON.stringify({ v: 1, at: 'a', kind: 'tool', text: 't', claude: 'c' }))).toBeNull()
    expect(parseTurnLine('[1]')).toBeNull()
    expect(parseTurnLine('null')).toBeNull()
  })

  test("a file's lines, oldest first: CRLF ends, blank lines and a torn last line are skipped", () => {
    const text = [line('2026-10-19T20:01:00Z', 'prompt', 'a'), '', line('2026-10-19T20:02:00Z', 'reply', 'b'), '{"v":1,"at'].join('\r\n')
    expect(parseTurnLines(text).map(entry => entry.text)).toEqual(['a', 'b'])
  })
})

describe('TurnLogReader.list', () => {
  test('says when there is no team, no turn log folder, or the folder could not be read', async () => {
    const disk = fakeDisk()
    expect(await new TurnLogReader(disk.ports, null).list(NOW)).toEqual({ kind: 'no-team' })
    expect(await new TurnLogReader(disk.ports, DIR).list(NOW)).toEqual({ kind: 'no-log' })
    disk.fail.set(DIR, new Error('EPERM: operation not permitted, scandir'))
    expect(await new TurnLogReader(disk.ports, DIR).list(NOW)).toEqual({ kind: 'failed', reason: 'EPERM: operation not permitted, scandir' })
  })

  test('lists the sessions with an hour file of the last 24 h, the newest change first, each with its newest prompt of the window', async () => {
    const disk = fakeDisk()
    disk.write('old', '2026-10-18T19', [line('2026-10-18T19:10:00Z', 'prompt', 'too old')])
    disk.write('api', '2026-10-18T20', [line('2026-10-18T20:10:00Z', 'prompt', 'before the window'), line('2026-10-18T20:45:00Z', 'reply', 'done')])
    disk.write('lead', '2026-10-19T19', [line('2026-10-19T19:05:00Z', 'prompt', '\n  plan the week  \nsecond line')])
    disk.write('lead', '2026-10-19T20', [line('2026-10-19T20:05:00Z', 'reply', 'on it'), line('2026-10-19T20:06:00Z', 'clear', 'context cleared (/clear)')])
    disk.put('Not_A_Session/2026-10-19T20.jsonl')
    disk.put('notes.txt')
    disk.put('lead/notes.txt')

    const list = await new TurnLogReader(disk.ports, DIR).list(NOW)
    expect(list).toEqual({
      kind: 'sessions',
      sessions: [
        { id: 'lead', changedAt: 1_003, lastPrompt: 'plan the week' },
        { id: 'api', changedAt: 1_001, lastPrompt: null },
      ],
    })
    // The old session's file ends before the window, so it is never read.
    expect(disk.reads).not.toContain('old/2026-10-18T19.jsonl')
  })

  test("cuts a long prompt's first line, and reads again only a file that moved", async () => {
    const disk = fakeDisk()
    disk.write('lead', '2026-10-19T19', [line('2026-10-19T19:05:00Z', 'prompt', 'x'.repeat(500))])
    disk.write('api', '2026-10-19T20', [line('2026-10-19T20:05:00Z', 'prompt', 'first')])
    const reader = new TurnLogReader(disk.ports, DIR)

    const first = await reader.list(NOW)
    expect(first.kind === 'sessions' ? first.sessions.map(session => session.lastPrompt?.length) : []).toEqual([5, 200])
    expect(disk.reads.length).toBe(2)

    disk.reads.length = 0
    await reader.list(NOW)
    expect(disk.reads).toEqual([])

    disk.write('api', '2026-10-19T20', [line('2026-10-19T20:05:00Z', 'prompt', 'first'), line('2026-10-19T20:20:00Z', 'prompt', 'second')])
    const moved = await reader.list(NOW)
    expect(disk.reads).toEqual(['api/2026-10-19T20.jsonl'])
    expect(moved.kind === 'sessions' ? moved.sessions[0] : null).toEqual({ id: 'api', changedAt: 1_002, lastPrompt: 'second' })
  })
})

describe('TurnLogReader.page', () => {
  test("holds the session's lines of the last 24 h oldest first, across its hour files, its clears included", async () => {
    const disk = fakeDisk()
    disk.write('lead', '2026-10-18T19', [line('2026-10-18T19:59:00Z', 'prompt', 'outside')])
    disk.write('lead', '2026-10-18T20', [line('2026-10-18T20:29:00Z', 'prompt', 'just before'), line('2026-10-18T20:31:00Z', 'reply', 'just in')])
    disk.write('lead', '2026-10-19T20', [line('2026-10-19T20:00:00Z', 'clear', 'context compacted'), line('2026-10-19T20:01:00Z', 'prompt', 'next')])

    const page = await new TurnLogReader(disk.ports, DIR).page('lead', NOW)
    expect(page.session).toBe('lead')
    expect(page.entries.map(entry => `${entry.kind}:${entry.text}`)).toEqual(['reply:just in', 'clear:context compacted', 'prompt:next'])
    expect(page.isCut).toBe(false)
    expect(page.problem).toBeNull()
    expect(disk.reads).not.toContain('lead/2026-10-18T19.jsonl')
  })

  test('keeps the newest lines up to its cap, leaving older files unread, and always the newest line', async () => {
    const disk = fakeDisk()
    // Two of these and the newest line fit; the oldest line does not.
    const big = 'y'.repeat(LOG_PAGE_CHARS / 2 - 4)
    disk.write('lead', '2026-10-19T17', [line('2026-10-19T17:00:00Z', 'prompt', 'never read')])
    disk.write('lead', '2026-10-19T18', [line('2026-10-19T18:00:00Z', 'prompt', 'oldest'), line('2026-10-19T18:01:00Z', 'reply', big)])
    disk.write('lead', '2026-10-19T19', [line('2026-10-19T19:00:00Z', 'reply', big), line('2026-10-19T19:01:00Z', 'prompt', 'newest')])

    const page = await new TurnLogReader(disk.ports, DIR).page('lead', NOW)
    expect(page.entries.map(entry => entry.text.slice(0, 6))).toEqual(['yyyyyy', 'yyyyyy', 'newest'])
    expect(page.isCut).toBe(true)
    expect(disk.reads).toEqual(['lead/2026-10-19T19.jsonl', 'lead/2026-10-19T18.jsonl'])

    const huge = new TurnLogReader(disk.ports, DIR)
    disk.write('lead', '2026-10-19T20', [line('2026-10-19T20:00:00Z', 'reply', 'z'.repeat(LOG_PAGE_CHARS + 1))])
    const alone = await huge.page('lead', NOW)
    expect(alone.entries.map(entry => entry.text.length)).toEqual([LOG_PAGE_CHARS + 1])
    expect(alone.isCut).toBe(true)
  })

  test("a file that fails to read is named, the others' lines still shown; a gone folder or no team shows none", async () => {
    const disk = fakeDisk()
    disk.write('lead', '2026-10-19T19', [line('2026-10-19T19:00:00Z', 'prompt', 'kept')])
    disk.write('lead', '2026-10-19T20', [line('2026-10-19T20:00:00Z', 'prompt', 'locked')])
    disk.fail.set(`${DIR}/lead/2026-10-19T20.jsonl`, new Error('EBUSY: resource busy or locked'))

    const page = await new TurnLogReader(disk.ports, DIR).page('lead', NOW)
    expect(page.entries.map(entry => entry.text)).toEqual(['kept'])
    expect(page.problem).toBe(`${DIR}/lead/2026-10-19T20.jsonl: EBUSY: resource busy or locked`)

    expect(await new TurnLogReader(disk.ports, DIR).page('gone', NOW)).toEqual({ session: 'gone', entries: [], isCut: false, problem: null })
    expect((await new TurnLogReader(disk.ports, null).page('lead', NOW)).problem).toBe('The pane found no team, so no turn log.')
    disk.fail.set(`${DIR}/lead`, new Error('EPERM: operation not permitted'))
    expect((await new TurnLogReader(disk.ports, DIR).page('lead', NOW)).problem).toBe('EPERM: operation not permitted')
  })

  test('answers the same page while nothing moved, reading nothing; a write or a line leaving the window gives a new one', async () => {
    const disk = fakeDisk()
    disk.write('lead', '2026-10-18T20', [line('2026-10-18T20:40:00Z', 'prompt', 'early')])
    disk.write('lead', '2026-10-19T20', [line('2026-10-19T20:00:00Z', 'prompt', 'late')])
    const reader = new TurnLogReader(disk.ports, DIR)

    const first = await reader.page('lead', NOW)
    disk.reads.length = 0
    expect(await reader.page('lead', NOW + MINUTE)).toBe(first)
    expect(disk.reads).toEqual([])

    const later = await reader.page('lead', NOW + 15 * MINUTE)
    expect(later).not.toBe(first)
    expect(later.entries.map(entry => entry.text)).toEqual(['late'])

    disk.write('lead', '2026-10-19T20', [line('2026-10-19T20:00:00Z', 'prompt', 'late'), line('2026-10-19T20:40:00Z', 'reply', 'more')])
    const moved = await reader.page('lead', NOW + 15 * MINUTE)
    expect(moved.entries.map(entry => entry.text)).toEqual(['late', 'more'])
    expect(disk.reads).toEqual(['lead/2026-10-19T20.jsonl'])
  })
})

/** A LiveLog over the fake disk, with what the view shows set by the test, and each write it made. */
function fakeLive(disk: ReturnType<typeof fakeDisk>) {
  const shown: { view: boolean; page: string | null } = { view: true, page: null }
  const lists: LogList[] = []
  const pages: (LogPage | null)[] = []
  let failWrites = false
  const live = new LiveLog({
    reader: new TurnLogReader(disk.ports, DIR),
    now: async () => NOW,
    isShown: async () => shown.view,
    shownPage: async () => shown.page,
    publishList: async list => {
      if (failWrites) throw new Error('write refused')
      lists.push(list)
    },
    publishPage: async page => {
      if (failWrites) throw new Error('write refused')
      pages.push(page)
      shown.page = page?.session ?? null
    },
  })
  const setFailWrites = (fails: boolean) => {
    failWrites = fails
  }
  return { live, shown, lists, pages, failWrites: setFailWrites }
}

describe('LiveLog', () => {
  test('a poll while the view shows writes the list once, again only when it changed; hidden, it reads nothing', async () => {
    const disk = fakeDisk()
    disk.write('lead', '2026-10-19T20', [line('2026-10-19T20:00:00Z', 'prompt', 'hello')])
    const { live, shown, lists } = fakeLive(disk)

    await live.poll()
    await live.poll()
    expect(lists.length).toBe(1)

    disk.write('api', '2026-10-19T20', [line('2026-10-19T20:10:00Z', 'prompt', 'news')])
    await live.poll()
    expect(lists.at(-1)).toMatchObject({ kind: 'sessions', sessions: [{ id: 'api' }, { id: 'lead' }] })

    shown.view = false
    disk.reads.length = 0
    disk.write('api', '2026-10-19T20', [line('2026-10-19T20:20:00Z', 'prompt', 'unseen')])
    await live.poll()
    expect(disk.reads).toEqual([])
    expect(lists.length).toBe(2)
  })

  test('open writes the page; a poll writes it again only when it moved; close goes back to the list, read again', async () => {
    const disk = fakeDisk()
    disk.write('lead', '2026-10-19T20', [line('2026-10-19T20:00:00Z', 'prompt', 'hello')])
    const { live, lists, pages } = fakeLive(disk)
    await live.refresh()

    await live.open('lead')
    await live.poll()
    expect(pages.map(page => page?.entries.length)).toEqual([1])

    disk.write('lead', '2026-10-19T20', [line('2026-10-19T20:00:00Z', 'prompt', 'hello'), line('2026-10-19T20:05:00Z', 'reply', 'hi')])
    await live.poll()
    expect(pages.map(page => page?.entries.length)).toEqual([1, 2])

    await live.close()
    expect(pages.at(-1)).toBeNull()
    expect(lists.length).toBe(2)
  })

  test('a failed write never rejects and is written by the next poll; two refreshes at once read once', async () => {
    const disk = fakeDisk()
    disk.write('lead', '2026-10-19T20', [line('2026-10-19T20:00:00Z', 'prompt', 'hello')])
    const { live, lists, failWrites } = fakeLive(disk)

    failWrites(true)
    await live.poll()
    expect(lists).toEqual([])
    failWrites(false)
    await live.poll()
    expect(lists.length).toBe(1)

    disk.write('api', '2026-10-19T20', [line('2026-10-19T20:10:00Z', 'prompt', 'news')])
    disk.reads.length = 0
    await Promise.all([live.refresh(), live.refresh()])
    expect(disk.reads).toEqual(['api/2026-10-19T20.jsonl'])
  })

  test('polls every POLL_MS from its start until it stops', () => {
    const { live } = fakeLive(fakeDisk())
    const timers: { ms: number; isCancelled: boolean }[] = []
    live.startTimers(ms => {
      const timer = { ms, isCancelled: false }
      timers.push(timer)
      return {
        cancel: () => {
          timer.isCancelled = true
        },
      }
    })
    expect(timers).toEqual([{ ms: POLL_MS, isCancelled: false }])
    live.stop()
    expect(timers[0]?.isCancelled).toBe(true)
  })
})
