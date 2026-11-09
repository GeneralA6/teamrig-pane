// The Log view's reads (hooks/turn-log.ts): a turn log line read into an entry by teamrig's parseEntry, each
// session's conversations listed with how they opened, a conversation's page of the team's kept hours under its cap,
// each file read again only when it moved, and the poll that writes the list or the page only when it changed, over
// a fake disk.
import { describe, expect, test } from 'claude-code/testing'
import type { LogList, LogPage, LogRead } from '../types'
import { POLL_MS } from '../hooks/live'
import {
  LOG_PAGE_CHARS,
  LiveLog,
  TurnLogReader,
  conversationsOf,
  parseTurnLines,
  type ListEntry,
  type LogDirEntry,
  type LogFiles,
  type TurnLogPlace,
} from '../hooks/turn-log'

const DIR = '/kit/teams/web/state/turn-log'
/** The team's turn log, kept teamrig's default 24 h. */
const LOG: TurnLogPlace = { dir: DIR, keepHours: 24 }
const NOW = Date.parse('2026-10-19T20:30:00Z')
const MINUTE = 60_000
/** A harness notice, which a prompt holds with or without the owner's words. */
const NOTICE = '<task-notification>\n<summary>Background command "tests" completed</summary>\n</task-notification>'

/** A turn log line as teamrig writes it, in conversation c-1 unless `extra` names another. */
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

describe('parseTurnLines', () => {
  test('reads a line of version 1, its cut mark included, and ignores fields it does not know', () => {
    expect(parseTurnLines(line('2026-10-19T20:01:00Z', 'prompt', 'ship it', { upTo: 'x', extra: 1 }))).toEqual([
      { at: '2026-10-19T20:01:00Z', kind: 'prompt', text: 'ship it', claude: 'c-1', isCut: false },
    ])
    expect(parseTurnLines(line('2026-10-19T20:02:00Z', 'reply', '…end', { truncated: true }))[0]?.isCut).toBe(true)
    expect(parseTurnLines(line('2026-10-19T20:03:00Z', 'clear', 'context compacted'))[0]?.kind).toBe('clear')
  })

  test('skips a line of another version or none, a torn line, one missing a field, one of an unknown kind, and one that is no object', () => {
    expect(parseTurnLines(JSON.stringify({ v: 2, at: 'a', kind: 'prompt', text: 't', claude: 'c' }))).toEqual([])
    expect(parseTurnLines(JSON.stringify({ at: 'a', kind: 'prompt', text: 't', claude: 'c' }))).toEqual([])
    expect(parseTurnLines('{"v":1,"at":"2026-10-19T20:0')).toEqual([])
    expect(parseTurnLines(JSON.stringify({ v: 1, at: 'a', kind: 'prompt', text: 't' }))).toEqual([])
    expect(parseTurnLines(JSON.stringify({ v: 1, at: 'a', kind: 'prompt', text: 3, claude: 'c' }))).toEqual([])
    expect(parseTurnLines(JSON.stringify({ v: 1, at: 'a', kind: 'tool', text: 't', claude: 'c' }))).toEqual([])
    expect(parseTurnLines('[1]')).toEqual([])
    expect(parseTurnLines('null')).toEqual([])
  })

  test("a file's lines, oldest first: CRLF ends, blank lines and a torn last line are skipped", () => {
    const text = [line('2026-10-19T20:01:00Z', 'prompt', 'a'), '', line('2026-10-19T20:02:00Z', 'reply', 'b'), '{"v":1,"at'].join('\r\n')
    expect(parseTurnLines(text).map(entry => entry.text)).toEqual(['a', 'b'])
  })
})

describe('conversationsOf', () => {
  test("groups a session's entries by Claude Code session id, the oldest first, each knowing when the next began", () => {
    const entries: ListEntry[] = [
      { at: 5, claude: 'late', owner: null, reply: null },
      { at: 1, claude: 'early', owner: null, reply: null },
      { at: 2, claude: 'early', owner: null, reply: 'first reply' },
      { at: 3, claude: 'early', owner: 'hi', reply: null },
    ]
    // The owner's words open a conversation before an earlier reply; a conversation of neither has no opening.
    expect(conversationsOf('lead', entries)).toEqual([
      { session: 'lead', claude: 'early', firstAt: 1, lastAt: 3, nextAt: 5, lines: 3, opening: { by: 'owner', line: 'hi' } },
      { session: 'lead', claude: 'late', firstAt: 5, lastAt: 5, nextAt: null, lines: 1, opening: null },
    ])
    expect(conversationsOf('lead', [])).toEqual([])
  })
})

describe('TurnLogReader.list', () => {
  test('says when there is no turn log folder, or the folder could not be read', async () => {
    const disk = fakeDisk()
    expect(await new TurnLogReader(disk.ports, LOG).list(NOW)).toEqual({ kind: 'no-log' })
    disk.fail.set(DIR, new Error('EPERM: operation not permitted, scandir'))
    expect(await new TurnLogReader(disk.ports, LOG).list(NOW)).toEqual({ kind: 'failed', reason: 'EPERM: operation not permitted, scandir' })
  })

  test('lists the conversations with a line of the last 24 h, the newest last line first, each with how it opened', async () => {
    const disk = fakeDisk()
    disk.write('old', '2026-10-18T19', [line('2026-10-18T19:10:00Z', 'prompt', 'too old')])
    disk.write('api', '2026-10-18T20', [line('2026-10-18T20:10:00Z', 'prompt', 'before the window'), line('2026-10-18T20:45:00Z', 'reply', 'done')])
    disk.write('lead', '2026-10-19T19', [line('2026-10-19T19:05:00Z', 'prompt', '\n  plan the week  \nsecond line')])
    disk.write('lead', '2026-10-19T20', [line('2026-10-19T20:05:00Z', 'reply', 'on it'), line('2026-10-19T20:06:00Z', 'clear', 'context compacted')])
    disk.put('Not_A_Session/2026-10-19T20.jsonl')
    disk.put('notes.txt')
    disk.put('lead/notes.txt')

    const list = await new TurnLogReader(disk.ports, LOG).list(NOW)
    // api's prompt is older than the window, so its reply opens what is left of its conversation.
    expect(list).toEqual({
      kind: 'conversations',
      hours: 24,
      conversations: [
        {
          session: 'lead',
          claude: 'c-1',
          firstAt: Date.parse('2026-10-19T19:05:00Z'),
          lastAt: Date.parse('2026-10-19T20:06:00Z'),
          nextAt: null,
          lines: 3,
          opening: { by: 'owner', line: 'plan the week' },
        },
        {
          session: 'api',
          claude: 'c-1',
          firstAt: Date.parse('2026-10-18T20:45:00Z'),
          lastAt: Date.parse('2026-10-18T20:45:00Z'),
          nextAt: null,
          lines: 1,
          opening: { by: 'claude', line: 'done' },
        },
      ],
    })
    // The old session's file ends before the window, so it is never read.
    expect(disk.reads).not.toContain('old/2026-10-18T19.jsonl')
  })

  test('a /clear opens a new conversation, its clear line carrying the new id, and a compaction keeps the id', async () => {
    const disk = fakeDisk()
    disk.write('lead', '2026-10-19T19', [
      line('2026-10-19T19:00:00Z', 'prompt', 'ship T855'),
      line('2026-10-19T19:20:00Z', 'clear', 'context compacted'),
      line('2026-10-19T19:30:00Z', 'reply', 'shipped'),
      line('2026-10-19T19:40:00Z', 'clear', 'context cleared (/clear)', { claude: 'c-2' }),
    ])
    disk.write('lead', '2026-10-19T20', [line('2026-10-19T20:00:00Z', 'reply', 'reading the handover', { claude: 'c-2' })])

    expect(await new TurnLogReader(disk.ports, LOG).list(NOW)).toEqual({
      kind: 'conversations',
      hours: 24,
      conversations: [
        {
          session: 'lead',
          claude: 'c-2',
          firstAt: Date.parse('2026-10-19T19:40:00Z'),
          lastAt: Date.parse('2026-10-19T20:00:00Z'),
          nextAt: null,
          lines: 2,
          opening: { by: 'claude', line: 'reading the handover' },
        },
        {
          session: 'lead',
          claude: 'c-1',
          firstAt: Date.parse('2026-10-19T19:00:00Z'),
          lastAt: Date.parse('2026-10-19T19:30:00Z'),
          nextAt: Date.parse('2026-10-19T19:40:00Z'),
          lines: 3,
          opening: { by: 'owner', line: 'ship T855' },
        },
      ],
    })
  })

  test("opens with the owner's words past a harness notice, and with none for a conversation of notices alone", async () => {
    const disk = fakeDisk()
    disk.write('lead', '2026-10-19T19', [line('2026-10-19T19:00:00Z', 'prompt', NOTICE)])
    disk.write('api', '2026-10-19T20', [line('2026-10-19T20:00:00Z', 'prompt', `${NOTICE}\nnow ship it`)])

    const list = await new TurnLogReader(disk.ports, LOG).list(NOW)
    expect(list.kind === 'conversations' ? list.conversations.map(conversation => [conversation.session, conversation.opening]) : []).toEqual([
      ['api', { by: 'owner', line: 'now ship it' }],
      ['lead', null],
    ])
  })

  test("the window is the team's kept hours: a session whose files end before it is left out, and its older lines off the page", async () => {
    const disk = fakeDisk()
    disk.write('api', '2026-10-19T17', [line('2026-10-19T17:50:00Z', 'prompt', 'before the window')])
    disk.write('lead', '2026-10-19T18', [line('2026-10-19T18:10:00Z', 'prompt', 'too old'), line('2026-10-19T18:40:00Z', 'prompt', 'in time')])
    disk.write('lead', '2026-10-19T20', [line('2026-10-19T20:05:00Z', 'reply', 'done')])
    // Kept 2 h, the window at NOW starts at 18:30.
    const reader = new TurnLogReader(disk.ports, { dir: DIR, keepHours: 2 })

    expect(await reader.list(NOW)).toEqual({
      kind: 'conversations',
      hours: 2,
      conversations: [
        {
          session: 'lead',
          claude: 'c-1',
          firstAt: Date.parse('2026-10-19T18:40:00Z'),
          lastAt: Date.parse('2026-10-19T20:05:00Z'),
          nextAt: null,
          lines: 2,
          opening: { by: 'owner', line: 'in time' },
        },
      ],
    })
    const page = await reader.page('lead', 'c-1', NOW)
    expect(page.hours).toBe(2)
    expect(page.entries.map(entry => entry.text)).toEqual(['in time', 'done'])
    expect(disk.reads).not.toContain('api/2026-10-19T17.jsonl')
  })

  test("cuts a long opening's first line, and reads again only a file that moved", async () => {
    const disk = fakeDisk()
    disk.write('lead', '2026-10-19T19', [line('2026-10-19T19:05:00Z', 'prompt', 'x'.repeat(500))])
    disk.write('api', '2026-10-19T20', [line('2026-10-19T20:05:00Z', 'prompt', 'first')])
    const reader = new TurnLogReader(disk.ports, LOG)

    const first = await reader.list(NOW)
    expect(first.kind === 'conversations' ? first.conversations.map(conversation => conversation.opening?.line.length) : []).toEqual([5, 200])
    expect(disk.reads.length).toBe(2)

    disk.reads.length = 0
    await reader.list(NOW)
    expect(disk.reads).toEqual([])

    disk.write('api', '2026-10-19T20', [line('2026-10-19T20:05:00Z', 'prompt', 'first'), line('2026-10-19T20:20:00Z', 'prompt', 'second')])
    const moved = await reader.list(NOW)
    expect(disk.reads).toEqual(['api/2026-10-19T20.jsonl'])
    // A later prompt moves the conversation's last line, never how it opened.
    expect(moved.kind === 'conversations' ? moved.conversations[0] : null).toEqual({
      session: 'api',
      claude: 'c-1',
      firstAt: Date.parse('2026-10-19T20:05:00Z'),
      lastAt: Date.parse('2026-10-19T20:20:00Z'),
      nextAt: null,
      lines: 2,
      opening: { by: 'owner', line: 'first' },
    })
  })
})

describe('TurnLogReader.previous', () => {
  test("picks the session's conversation with the newest last line other than the one it works in now", async () => {
    const disk = fakeDisk()
    disk.write('lead', '2026-10-19T18', [line('2026-10-19T18:05:00Z', 'prompt', 'oldest', { claude: 'c-1' })])
    disk.write('lead', '2026-10-19T19', [
      line('2026-10-19T19:05:00Z', 'prompt', 'plan the week', { claude: 'c-2' }),
      line('2026-10-19T19:40:00Z', 'reply', 'planned', { claude: 'c-2' }),
    ])
    disk.write('lead', '2026-10-19T20', [line('2026-10-19T20:10:00Z', 'prompt', 'now', { claude: 'c-3' })])

    expect(await new TurnLogReader(disk.ports, LOG).previous('lead', 'c-3', NOW)).toEqual({
      session: 'lead',
      claude: 'c-2',
      firstAt: Date.parse('2026-10-19T19:05:00Z'),
      lastAt: Date.parse('2026-10-19T19:40:00Z'),
      nextAt: Date.parse('2026-10-19T20:10:00Z'),
      lines: 2,
      opening: { by: 'owner', line: 'plan the week' },
    })
    // Before the conversation of now wrote a line, the newest one is the previous.
    expect((await new TurnLogReader(disk.ports, LOG).previous('lead', 'c-4', NOW))?.claude).toBe('c-3')
  })

  test('answers null with only the conversation of now, none in the window, or no folder for the session', async () => {
    const disk = fakeDisk()
    disk.write('lead', '2026-10-19T18', [line('2026-10-19T18:05:00Z', 'prompt', 'now', { claude: 'c-1' })])
    disk.write('api', '2026-10-18T19', [line('2026-10-18T19:10:00Z', 'prompt', 'too old', { claude: 'c-9' })])
    const reader = new TurnLogReader(disk.ports, LOG)
    expect(await reader.previous('lead', 'c-1', NOW)).toBe(null)
    expect(await reader.previous('api', 'c-1', NOW)).toBe(null)
    expect(await reader.previous('web', 'c-1', NOW)).toBe(null)
  })

  test("reads only the session's own folder, and throws on a failed read", async () => {
    const disk = fakeDisk()
    disk.write('lead', '2026-10-19T19', [line('2026-10-19T19:05:00Z', 'prompt', 'before', { claude: 'c-1' })])
    disk.write('api', '2026-10-19T19', [line('2026-10-19T19:06:00Z', 'prompt', 'other session', { claude: 'c-5' })])
    const reader = new TurnLogReader(disk.ports, LOG)
    expect((await reader.previous('lead', 'c-2', NOW))?.claude).toBe('c-1')
    expect(disk.reads).toEqual(['lead/2026-10-19T19.jsonl'])
    disk.write('lead', '2026-10-19T19', [line('2026-10-19T19:05:00Z', 'prompt', 'moved', { claude: 'c-1' })])
    disk.fail.set(`${DIR}/lead/2026-10-19T19.jsonl`, new Error('EBUSY: resource busy'))
    const failed = await reader.previous('lead', 'c-2', NOW).then(
      () => 'read',
      (error: unknown) => (error instanceof Error ? error.message : 'no error'),
    )
    expect(failed).toBe('EBUSY: resource busy')
  })
})

describe('TurnLogReader.page', () => {
  test("holds the conversation's lines of the last 24 h oldest first, across its hour files, its clears included", async () => {
    const disk = fakeDisk()
    disk.write('lead', '2026-10-18T19', [line('2026-10-18T19:59:00Z', 'prompt', 'outside')])
    disk.write('lead', '2026-10-18T20', [line('2026-10-18T20:29:00Z', 'prompt', 'just before'), line('2026-10-18T20:31:00Z', 'reply', 'just in')])
    disk.write('lead', '2026-10-19T20', [line('2026-10-19T20:00:00Z', 'clear', 'context compacted'), line('2026-10-19T20:01:00Z', 'prompt', 'next')])

    const page = await new TurnLogReader(disk.ports, LOG).page('lead', 'c-1', NOW)
    expect(page.session).toBe('lead')
    expect(page.claude).toBe('c-1')
    expect(page.hours).toBe(24)
    expect(page.entries.map(entry => `${entry.kind}:${entry.text}`)).toEqual(['reply:just in', 'clear:context compacted', 'prompt:next'])
    expect(page.isCut).toBe(false)
    expect(page.problem).toBeNull()
    expect(disk.reads).not.toContain('lead/2026-10-18T19.jsonl')
  })

  test("holds only its conversation's lines, and a page of the session's other conversation reads the same files for its own", async () => {
    const disk = fakeDisk()
    disk.write('lead', '2026-10-19T20', [
      line('2026-10-19T20:00:00Z', 'prompt', 'first'),
      line('2026-10-19T20:05:00Z', 'clear', 'context cleared (/clear)', { claude: 'c-2' }),
      line('2026-10-19T20:06:00Z', 'reply', 'second', { claude: 'c-2' }),
    ])
    const reader = new TurnLogReader(disk.ports, LOG)

    expect((await reader.page('lead', 'c-1', NOW)).entries.map(entry => entry.text)).toEqual(['first'])
    disk.reads.length = 0
    const next = await reader.page('lead', 'c-2', NOW)
    expect(next.claude).toBe('c-2')
    expect(next.entries.map(entry => `${entry.kind}:${entry.text}`)).toEqual(['clear:context cleared (/clear)', 'reply:second'])
    // The file did not move, so the second page reads nothing.
    expect(disk.reads).toEqual([])
  })

  test('keeps the newest lines up to its cap, leaving older files unread, and always the newest line', async () => {
    const disk = fakeDisk()
    // Two of these and the newest line fit; the oldest line does not.
    const big = 'y'.repeat(LOG_PAGE_CHARS / 2 - 4)
    disk.write('lead', '2026-10-19T17', [line('2026-10-19T17:00:00Z', 'prompt', 'never read')])
    disk.write('lead', '2026-10-19T18', [line('2026-10-19T18:00:00Z', 'prompt', 'oldest'), line('2026-10-19T18:01:00Z', 'reply', big)])
    disk.write('lead', '2026-10-19T19', [line('2026-10-19T19:00:00Z', 'reply', big), line('2026-10-19T19:01:00Z', 'prompt', 'newest')])

    const page = await new TurnLogReader(disk.ports, LOG).page('lead', 'c-1', NOW)
    expect(page.entries.map(entry => entry.text.slice(0, 6))).toEqual(['yyyyyy', 'yyyyyy', 'newest'])
    expect(page.isCut).toBe(true)
    expect(disk.reads).toEqual(['lead/2026-10-19T19.jsonl', 'lead/2026-10-19T18.jsonl'])

    const huge = new TurnLogReader(disk.ports, LOG)
    disk.write('lead', '2026-10-19T20', [line('2026-10-19T20:00:00Z', 'reply', 'z'.repeat(LOG_PAGE_CHARS + 1))])
    const alone = await huge.page('lead', 'c-1', NOW)
    expect(alone.entries.map(entry => entry.text.length)).toEqual([LOG_PAGE_CHARS + 1])
    expect(alone.isCut).toBe(true)
  })

  test("a file that fails to read is named, the others' lines still shown; a gone folder shows none", async () => {
    const disk = fakeDisk()
    disk.write('lead', '2026-10-19T19', [line('2026-10-19T19:00:00Z', 'prompt', 'kept')])
    disk.write('lead', '2026-10-19T20', [line('2026-10-19T20:00:00Z', 'prompt', 'locked')])
    disk.fail.set(`${DIR}/lead/2026-10-19T20.jsonl`, new Error('EBUSY: resource busy or locked'))

    const page = await new TurnLogReader(disk.ports, LOG).page('lead', 'c-1', NOW)
    expect(page.entries.map(entry => entry.text)).toEqual(['kept'])
    expect(page.problem).toBe(`${DIR}/lead/2026-10-19T20.jsonl: EBUSY: resource busy or locked`)

    expect(await new TurnLogReader(disk.ports, LOG).page('gone', 'c-1', NOW)).toEqual({ session: 'gone', claude: 'c-1', hours: 24, entries: [], isCut: false, problem: null })
    disk.fail.set(`${DIR}/lead`, new Error('EPERM: operation not permitted'))
    expect((await new TurnLogReader(disk.ports, LOG).page('lead', 'c-1', NOW)).problem).toBe('EPERM: operation not permitted')
  })

  test('answers the same page while nothing moved, reading nothing; a write or a line leaving the window gives a new one', async () => {
    const disk = fakeDisk()
    disk.write('lead', '2026-10-18T20', [line('2026-10-18T20:40:00Z', 'prompt', 'early')])
    disk.write('lead', '2026-10-19T20', [line('2026-10-19T20:00:00Z', 'prompt', 'late')])
    const reader = new TurnLogReader(disk.ports, LOG)

    const first = await reader.page('lead', 'c-1', NOW)
    disk.reads.length = 0
    expect(await reader.page('lead', 'c-1', NOW + MINUTE)).toBe(first)
    expect(disk.reads).toEqual([])

    const later = await reader.page('lead', 'c-1', NOW + 15 * MINUTE)
    expect(later).not.toBe(first)
    expect(later.entries.map(entry => entry.text)).toEqual(['late'])

    disk.write('lead', '2026-10-19T20', [line('2026-10-19T20:00:00Z', 'prompt', 'late'), line('2026-10-19T20:40:00Z', 'reply', 'more')])
    const moved = await reader.page('lead', 'c-1', NOW + 15 * MINUTE)
    expect(moved.entries.map(entry => entry.text)).toEqual(['late', 'more'])
    expect(disk.reads).toEqual(['lead/2026-10-19T20.jsonl'])
  })
})

/** A LiveLog over the fake disk, with what the view shows set by the test, and each write it made. */
function fakeLive(disk: ReturnType<typeof fakeDisk>) {
  const shown: { view: boolean; page: LogRead | null } = { view: true, page: null }
  const lists: LogList[] = []
  const pages: (LogPage | null)[] = []
  let failWrites = false
  const live = new LiveLog({
    reader: new TurnLogReader(disk.ports, LOG),
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
      shown.page = page === null ? null : { session: page.session, claude: page.claude }
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
    expect(lists.at(-1)).toMatchObject({ kind: 'conversations', conversations: [{ session: 'api' }, { session: 'lead' }] })

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

    await live.open({ session: 'lead', claude: 'c-1' })
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
